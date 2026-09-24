// The Envoy Gateway model every page of this plugin draws from.
//
// What Envoy Gateway serves is spread across a dozen kinds: a GatewayClass
// names the controller, a Gateway its listeners, routes attach to those
// listeners and name Services, policies attach to any of them, and the
// proxies doing the work are pods in another namespace. Read once per poll
// through the k8sdockside bridge and joined up here, so the pages only have to
// draw -- and so every page says the same thing about the same object.
(function () {
    'use strict';

    var GROUP = 'gateway.envoyproxy.io';
    var CONTROLLER = 'gateway.envoyproxy.io/gatewayclass-controller';

    var KINDS = {
        classes: 'gatewayclasses',
        gateways: 'gateways',
        httproutes: 'httproutes',
        grpcroutes: 'grpcroutes',
        tlsroutes: 'tlsroutes',
        tcproutes: 'tcproutes',
        udproutes: 'udproutes',
        services: 'services',
        slices: 'endpointslices',
        pods: 'pods',
        events: 'events',
        envoyproxies: 'crd:envoyproxies.' + GROUP,
        ctp: 'crd:clienttrafficpolicies.' + GROUP,
        btp: 'crd:backendtrafficpolicies.' + GROUP,
        sp: 'crd:securitypolicies.' + GROUP,
        eep: 'crd:envoyextensionpolicies.' + GROUP,
        epp: 'crd:envoypatchpolicies.' + GROUP,
        backends: 'crd:backends.' + GROUP,
        filters: 'crd:httproutefilters.' + GROUP,
    };

    // The route kinds, as the Gateway API names them and as the app does.
    var ROUTES = [
        { kind: 'HTTPRoute', appKind: KINDS.httproutes, label: 'HTTP', key: 'http' },
        { kind: 'GRPCRoute', appKind: KINDS.grpcroutes, label: 'gRPC', key: 'grpc' },
        { kind: 'TLSRoute', appKind: KINDS.tlsroutes, label: 'TLS', key: 'tls' },
        { kind: 'TCPRoute', appKind: KINDS.tcproutes, label: 'TCP', key: 'tcp' },
        { kind: 'UDPRoute', appKind: KINDS.udproutes, label: 'UDP', key: 'udp' },
    ];

    // The policy kinds, with the word a person would use for each.
    var POLICIES = [
        {
            kind: 'ClientTrafficPolicy',
            appKind: KINDS.ctp,
            key: 'ctp',
            label: 'Client traffic',
            icon: 'client',
            about: 'How Envoy talks to clients: TLS, timeouts, connection limits, HTTP versions, client IPs.',
        },
        {
            kind: 'BackendTrafficPolicy',
            appKind: KINDS.btp,
            key: 'btp',
            label: 'Backend traffic',
            icon: 'gauge',
            about: 'How Envoy talks to backends: rate limits, retries, timeouts, circuit breakers, load balancing.',
        },
        {
            kind: 'SecurityPolicy',
            appKind: KINDS.sp,
            key: 'sp',
            label: 'Security',
            icon: 'shield',
            about: 'Who may send requests: CORS, JWT, OIDC, API keys, basic auth, external auth, IP rules.',
        },
        {
            kind: 'EnvoyExtensionPolicy',
            appKind: KINDS.eep,
            key: 'eep',
            label: 'Extensions',
            icon: 'puzzle',
            about: 'Code Envoy runs on each request: Wasm modules, external processors, Lua.',
        },
        {
            kind: 'EnvoyPatchPolicy',
            appKind: KINDS.epp,
            key: 'epp',
            label: 'Patches',
            icon: 'patch',
            about: 'Raw changes to the Envoy configuration Envoy Gateway generates. The last resort.',
        },
    ];

    // The labels Envoy Gateway puts on the proxies it runs, and on its own
    // controller.
    var PROXY_SELECTOR = 'app.kubernetes.io/managed-by=envoy-gateway,app.kubernetes.io/component=proxy';
    var CONTROLLER_SELECTOR = 'control-plane=envoy-gateway';
    var OWNING_NAME = 'gateway.envoyproxy.io/owning-gateway-name';
    var OWNING_NAMESPACE = 'gateway.envoyproxy.io/owning-gateway-namespace';

    var TONE_RANK = { error: 3, warn: 2, info: 1, ok: 0, muted: -1 };

    function worst(a, b) {
        return (TONE_RANK[a] || 0) >= (TONE_RANK[b] || 0) ? a : b;
    }

    // ----- small readers ------------------------------------------------------

    function meta(o) {
        return (o && o.metadata) || {};
    }

    function keyOf(kind, namespace, name) {
        return kind + '/' + (namespace || '') + '/' + name;
    }

    function arr(v) {
        return Array.isArray(v) ? v : [];
    }

    /** One condition of a conditions list, or null. */
    function cond(conditions, type) {
        var list = arr(conditions);
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].type === type) {
                return {
                    type: type,
                    status: list[i].status,
                    reason: list[i].reason || '',
                    message: list[i].message || '',
                    at: list[i].lastTransitionTime || '',
                };
            }
        }
        return null;
    }

    function isTrue(c) {
        return !!c && c.status === 'True';
    }

    function isFalse(c) {
        return !!c && c.status === 'False';
    }

    /** "NoMatchingListenerHostname" -> "No matching listener hostname". */
    function words(reason) {
        if (!reason) return '';
        var spaced = String(reason)
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
        return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
    }

    function plural(n, one, many) {
        return n + ' ' + (n === 1 ? one : many || one + 's');
    }

    /** "10s", "1m30s" and friends, as a person says them. */
    function duration(text) {
        if (!text) return '';
        var s = String(text);
        var m = s.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
        if (!m) return s;
        var unit = { ms: 'ms', s: ' s', m: ' min', h: ' h' }[m[2]];
        return m[1] + unit;
    }

    // ----- reading the cluster ------------------------------------------------

    /**
     * Lists a kind, and says whether the cluster serves it. A kind the cluster
     * does not have -- TCPRoute on a cluster without the experimental channel
     * -- is an empty list, not a failure.
     */
    function listing(sdk, kind, query) {
        var q = Object.assign({ kind: kind }, query || {});
        return sdk.list(q).then(
            function (items) {
                return { items: items || [], error: '' };
            },
            function (err) {
                return { items: [], error: (err && err.message) || String(err) };
            },
        );
    }

    /**
     * Reads everything the pages need. Policies, routes and backends are read
     * in every namespace: that is where people put them, and a Gateway in one
     * namespace routinely serves routes from ten others.
     */
    function load(sdk) {
        var reads = {
            classes: listing(sdk, KINDS.classes),
            gateways: listing(sdk, KINDS.gateways),
            services: listing(sdk, KINDS.services),
            slices: listing(sdk, KINDS.slices),
            proxies: listing(sdk, KINDS.pods, { selector: PROXY_SELECTOR }),
            controller: listing(sdk, KINDS.pods, { selector: CONTROLLER_SELECTOR }),
            envoyproxies: listing(sdk, KINDS.envoyproxies),
            backends: listing(sdk, KINDS.backends),
            filters: listing(sdk, KINDS.filters),
        };
        ROUTES.forEach(function (r) {
            reads['route:' + r.kind] = listing(sdk, r.appKind);
        });
        POLICIES.forEach(function (p) {
            reads['policy:' + p.kind] = listing(sdk, p.appKind);
        });
        var names = Object.keys(reads);
        return Promise.all(
            names.map(function (n) {
                return reads[n];
            }),
        ).then(function (results) {
            var raw = { errors: {} };
            names.forEach(function (n, i) {
                raw[n] = results[i].items;
                if (results[i].error) raw.errors[n] = results[i].error;
            });
            return raw;
        });
    }

    // ----- joining it up -------------------------------------------------------

    function podReady(pod) {
        var statuses = arr(pod.status && pod.status.containerStatuses);
        if (!statuses.length) return false;
        return statuses.every(function (c) {
            return c.ready;
        });
    }

    function podInfo(pod) {
        var m = meta(pod);
        var restarts = 0;
        arr(pod.status && pod.status.containerStatuses).forEach(function (c) {
            restarts += c.restartCount || 0;
        });
        return {
            namespace: m.namespace,
            name: m.name,
            ready: podReady(pod),
            phase: (pod.status && pod.status.phase) || '',
            restarts: restarts,
            node: (pod.spec && pod.spec.nodeName) || '',
            image: (pod.spec && arr(pod.spec.containers)[0] && pod.spec.containers[0].image) || '',
            ref: { kind: KINDS.pods, namespace: m.namespace, name: m.name },
        };
    }

    /** Ready and total endpoints behind each Service, from its EndpointSlices. */
    function endpointsByService(slices) {
        var out = {};
        slices.forEach(function (s) {
            var m = meta(s);
            var svc = (m.labels || {})['kubernetes.io/service-name'];
            if (!svc) return;
            var k = m.namespace + '/' + svc;
            var entry = out[k] || (out[k] = { ready: 0, total: 0 });
            arr(s.endpoints).forEach(function (e) {
                var n = arr(e.addresses).length || 1;
                entry.total += n;
                // A missing ready condition means ready, as kube-proxy reads it.
                if (!e.conditions || e.conditions.ready !== false) entry.ready += n;
            });
        });
        return out;
    }

    function listenerText(l) {
        var bits = [l.protocol + ' ' + l.port];
        if (l.hostname) bits.push(l.hostname);
        return bits.join(' · ');
    }

    function buildGateway(g, classes, proxiesByGateway) {
        var m = meta(g);
        var spec = g.spec || {};
        var status = g.status || {};
        var accepted = cond(status.conditions, 'Accepted');
        var programmed = cond(status.conditions, 'Programmed');
        var statusListeners = {};
        arr(status.listeners).forEach(function (l) {
            statusListeners[l.name] = l;
        });

        var listeners = arr(spec.listeners).map(function (l) {
            var st = statusListeners[l.name] || {};
            var conds = arr(st.conditions);
            var problems = [];
            var lAccepted = cond(conds, 'Accepted');
            var lProgrammed = cond(conds, 'Programmed');
            var lResolved = cond(conds, 'ResolvedRefs');
            var lConflicted = cond(conds, 'Conflicted');
            if (isFalse(lAccepted)) problems.push(lAccepted);
            if (isFalse(lResolved)) problems.push(lResolved);
            if (isTrue(lConflicted)) problems.push(lConflicted);
            if (isFalse(lProgrammed) && !problems.length) problems.push(lProgrammed);
            var tls = l.tls || null;
            var listener = {
                name: l.name,
                port: l.port,
                protocol: l.protocol || '',
                hostname: l.hostname || '',
                tlsMode: tls ? tls.mode || 'Terminate' : '',
                certificates: arr(tls && tls.certificateRefs).map(function (c) {
                    return (c.namespace ? c.namespace + '/' : '') + c.name;
                }),
                allowedFrom: (l.allowedRoutes && l.allowedRoutes.namespaces && l.allowedRoutes.namespaces.from) || 'Same',
                attached: typeof st.attachedRoutes === 'number' ? st.attachedRoutes : null,
                problems: problems,
                tone: problems.length ? 'error' : lProgrammed ? (isTrue(lProgrammed) ? 'ok' : 'warn') : 'muted',
                routes: [],
            };
            listener.text = listenerText(listener);
            return listener;
        });

        var key = keyOf('Gateway', m.namespace, m.name);
        var proxies = proxiesByGateway[m.namespace + '/' + m.name] || [];
        var readyProxies = proxies.filter(function (p) {
            return p.ready;
        }).length;
        var addresses = arr(status.addresses).map(function (a) {
            return a.value;
        });

        var tone = 'ok';
        var headline = 'Serving';
        if (isFalse(accepted)) {
            tone = 'error';
            headline = 'Not accepted';
        } else if (isFalse(programmed)) {
            tone = 'error';
            headline = 'Not programmed';
        } else if (!programmed) {
            tone = 'warn';
            headline = 'Waiting for Envoy Gateway';
        } else if (proxies.length && !readyProxies) {
            tone = 'error';
            headline = 'No proxy ready';
        } else if (!addresses.length) {
            tone = 'warn';
            headline = 'No address yet';
        } else if (proxies.length && readyProxies < proxies.length) {
            tone = 'warn';
            headline = 'Some proxies not ready';
        }
        var broken = listeners.filter(function (l) {
            return l.tone === 'error';
        }).length;
        if (broken && tone === 'ok') {
            tone = 'warn';
            headline = broken === listeners.length ? 'No listener working' : plural(broken, 'listener') + ' not working';
            if (broken === listeners.length) tone = 'error';
        }

        return {
            key: key,
            namespace: m.namespace,
            name: m.name,
            className: spec.gatewayClassName || '',
            classOk: !!classes[spec.gatewayClassName],
            labels: m.labels || {},
            listeners: listeners,
            addresses: addresses,
            accepted: accepted,
            programmed: programmed,
            proxies: proxies,
            readyProxies: readyProxies,
            infrastructure: (spec.infrastructure && spec.infrastructure.parametersRef) || null,
            tone: tone,
            headline: headline,
            routes: [],
            policies: [],
            ref: { kind: KINDS.gateways, namespace: m.namespace, name: m.name },
            created: m.creationTimestamp || '',
        };
    }

    // ----- routes ---------------------------------------------------------------

    function matchText(kindKey, match) {
        if (!match) return 'everything';
        var parts = [];
        if (kindKey === 'grpc') {
            var method = match.method || {};
            if (method.service || method.method) {
                parts.push((method.service || '*') + '/' + (method.method || '*'));
            }
        } else {
            if (match.method) parts.push(match.method);
            var path = match.path;
            if (path && path.value !== undefined) {
                var type = path.type || 'PathPrefix';
                if (type === 'Exact') parts.push(path.value);
                else if (type === 'RegularExpression') parts.push('~ ' + path.value);
                else parts.push(path.value === '/' ? '/…' : path.value.replace(/\/$/, '') + '/…');
            }
            arr(match.queryParams).forEach(function (q) {
                parts.push('?' + q.name + (q.type === 'RegularExpression' ? '~' : '=') + q.value);
            });
        }
        arr(match.headers).forEach(function (h) {
            parts.push(h.name + (h.type === 'RegularExpression' ? ' ~ ' : ': ') + h.value);
        });
        return parts.length ? parts.join('  ') : 'everything';
    }

    function filterText(f, filtersByName) {
        switch (f.type) {
            case 'RequestHeaderModifier':
            case 'ResponseHeaderModifier': {
                var mod = f.requestHeaderModifier || f.responseHeaderModifier || {};
                var which = f.type === 'RequestHeaderModifier' ? 'request' : 'response';
                var n = arr(mod.set).length + arr(mod.add).length + arr(mod.remove).length;
                return 'Changes ' + plural(n, which + ' header');
            }
            case 'RequestRedirect': {
                var r = f.requestRedirect || {};
                var to = [r.scheme ? r.scheme + '://' : '', r.hostname || '', r.port ? ':' + r.port : ''].join('');
                return 'Redirects' + (to ? ' to ' + to : '') + ' (' + (r.statusCode || 302) + ')';
            }
            case 'URLRewrite': {
                var u = f.urlRewrite || {};
                var bits = [];
                if (u.hostname) bits.push('host ' + u.hostname);
                if (u.path) bits.push('path ' + (u.path.replaceFullPath || u.path.replacePrefixMatch || ''));
                return 'Rewrites ' + (bits.join(', ') || 'the URL');
            }
            case 'RequestMirror':
                return 'Mirrors to ' + ((f.requestMirror && f.requestMirror.backendRef && f.requestMirror.backendRef.name) || 'another backend');
            case 'CORS':
                return 'Answers CORS';
            case 'ExtensionRef': {
                var ref = f.extensionRef || {};
                var found = filtersByName[ref.name];
                if (ref.kind === 'HTTPRouteFilter' && found) return 'Envoy filter ' + ref.name + ': ' + routeFilterText(found);
                return (ref.kind || 'Extension') + ' ' + (ref.name || '');
            }
            default:
                return f.type || 'Filter';
        }
    }

    /** What an Envoy Gateway HTTPRouteFilter does, in a few words. */
    function routeFilterText(obj) {
        var spec = obj.spec || {};
        if (spec.directResponse) {
            return 'answers ' + (spec.directResponse.statusCode || 200) + ' itself';
        }
        if (spec.urlRewrite) {
            var u = spec.urlRewrite;
            if (u.path && u.path.replaceRegexMatch) return 'rewrites the path by pattern';
            if (u.hostname) return 'rewrites the host from ' + (u.hostname.type || 'a header');
            return 'rewrites the URL';
        }
        if (spec.credentialInjection) return 'adds a credential to the request';
        return 'custom behaviour';
    }

    function buildRoute(obj, rk, ctx) {
        var m = meta(obj);
        var spec = obj.spec || {};
        var status = obj.status || {};
        var ns = m.namespace;

        var statusByParent = {};
        arr(status.parents).forEach(function (p) {
            var r = p.parentRef || {};
            statusByParent[(r.namespace || ns) + '/' + r.name + '/' + (r.sectionName || '')] = p;
        });

        var parents = arr(spec.parentRefs)
            .filter(function (p) {
                return !p.kind || p.kind === 'Gateway';
            })
            .map(function (p) {
                var pns = p.namespace || ns;
                var gw = ctx.gatewaysByKey[keyOf('Gateway', pns, p.name)] || null;
                var st = statusByParent[pns + '/' + p.name + '/' + (p.sectionName || '')] || null;
                var conds = st ? arr(st.conditions) : [];
                var accepted = cond(conds, 'Accepted');
                var resolved = cond(conds, 'ResolvedRefs');
                var tone = 'ok';
                var says = 'Attached';
                if (!gw) {
                    tone = ctx.anyGateway[pns + '/' + p.name] ? 'muted' : 'error';
                    says = ctx.anyGateway[pns + '/' + p.name] ? 'Served by another controller' : 'No such Gateway';
                } else if (isFalse(accepted)) {
                    tone = 'error';
                    says = words(accepted.reason) || 'Not accepted';
                } else if (isFalse(resolved)) {
                    tone = 'error';
                    says = words(resolved.reason) || 'References not resolved';
                } else if (!accepted) {
                    tone = 'warn';
                    says = 'Waiting for Envoy Gateway';
                }
                return {
                    namespace: pns,
                    name: p.name,
                    sectionName: p.sectionName || '',
                    port: p.port || null,
                    gateway: gw,
                    accepted: accepted,
                    resolved: resolved,
                    tone: tone,
                    says: says,
                    message: (isFalse(accepted) && accepted.message) || (isFalse(resolved) && resolved.message) || '',
                };
            });

        var rules = arr(spec.rules).map(function (rule, index) {
            var backends = arr(rule.backendRefs).map(function (b) {
                var kind = b.kind || 'Service';
                var bns = b.namespace || ns;
                var backend = ctx.backend(kind, bns, b.name, b.port);
                var weight = b.weight === undefined ? 1 : b.weight;
                return { backend: backend, weight: weight, port: b.port || null };
            });
            var totalWeight = backends.reduce(function (n, b) {
                return n + b.weight;
            }, 0);
            backends.forEach(function (b) {
                b.share = totalWeight ? b.weight / totalWeight : 0;
            });
            var matches = arr(rule.matches).length ? arr(rule.matches) : [null];
            return {
                index: index,
                name: rule.name || '',
                matches: matches.map(function (mt) {
                    return matchText(rk.key, mt);
                }),
                filters: arr(rule.filters).map(function (f) {
                    return filterText(f, ctx.filtersByName[ns] || {});
                }),
                backends: backends,
                timeout: (rule.timeouts && (rule.timeouts.request || rule.timeouts.backendRequest)) || '',
            };
        });

        var tone = 'muted';
        var own = parents.filter(function (p) {
            return p.gateway;
        });
        own.forEach(function (p) {
            tone = tone === 'muted' ? p.tone : worst(tone, p.tone);
        });
        rules.forEach(function (r) {
            r.backends.forEach(function (b) {
                if (b.backend.tone === 'error') tone = worst(tone, 'error');
                else if (b.backend.tone === 'warn') tone = worst(tone, 'warn');
            });
        });

        return {
            key: keyOf(rk.kind, ns, m.name),
            type: rk,
            namespace: ns,
            name: m.name,
            labels: m.labels || {},
            hostnames: arr(spec.hostnames),
            parents: parents,
            ours: own.length > 0 || parents.some(function (p) {
                return p.tone === 'error' && !ctx.anyGateway[p.namespace + '/' + p.name];
            }),
            rules: rules,
            tone: tone,
            policies: [],
            ref: { kind: rk.appKind, namespace: ns, name: m.name },
        };
    }

    // ----- policies -----------------------------------------------------------------

    function limitText(limit) {
        if (!limit) return '';
        return limit.requests + ' requests per ' + String(limit.unit || 'second').toLowerCase();
    }

    function clientSummary(spec) {
        var out = [];
        var tls = spec.tls || {};
        if (tls.minVersion || tls.maxVersion) {
            out.push('TLS ' + (tls.minVersion || '1.2') + (tls.maxVersion ? ' to ' + tls.maxVersion : ' or newer'));
        }
        if (arr(tls.alpnProtocols).length) out.push('Offers ' + tls.alpnProtocols.join(', '));
        if (tls.clientValidation) out.push('Asks clients for a certificate (mTLS)' + (tls.clientValidation.optional ? ', optionally' : ''));
        var timeout = spec.timeout || {};
        if (timeout.http && timeout.http.requestReceivedTimeout) out.push('Gives clients ' + duration(timeout.http.requestReceivedTimeout) + ' to send a request');
        if (timeout.http && timeout.http.idleTimeout) out.push('Closes idle connections after ' + duration(timeout.http.idleTimeout));
        var conn = spec.connection || {};
        if (conn.connectionLimit && conn.connectionLimit.value) out.push('At most ' + conn.connectionLimit.value + ' connections');
        if (conn.bufferLimit) out.push('Buffers up to ' + conn.bufferLimit + ' per connection');
        if (spec.http3) out.push('Serves HTTP/3');
        if (spec.http2 && spec.http2.maxConcurrentStreams) out.push('At most ' + spec.http2.maxConcurrentStreams + ' HTTP/2 streams per connection');
        if (spec.http1 && spec.http1.http10) out.push('Accepts HTTP/1.0');
        var ip = spec.clientIPDetection || {};
        if (ip.xForwardedFor) out.push('Takes the client IP from X-Forwarded-For' + (ip.xForwardedFor.numTrustedHops ? ', trusting ' + plural(ip.xForwardedFor.numTrustedHops, 'hop') : ''));
        if (ip.customHeader) out.push('Takes the client IP from ' + ip.customHeader.name);
        if (spec.enableProxyProtocol || spec.proxyProtocol) out.push('Expects the PROXY protocol');
        if (spec.headers && spec.headers.xForwardedClientCert) out.push('Forwards the client certificate (XFCC)');
        if (spec.path && spec.path.escapedSlashesAction) out.push('Escaped slashes: ' + words(spec.path.escapedSlashesAction).toLowerCase());
        if (spec.tcpKeepalive) out.push('Keeps client connections alive with TCP keepalive');
        return out;
    }

    function backendSummary(spec) {
        var out = [];
        var rl = spec.rateLimit;
        if (rl) {
            var rules = arr((rl.local && rl.local.rules) || (rl.global && rl.global.rules));
            var scope = rl.global || rl.type === 'Global' ? 'across all proxies' : 'per proxy';
            if (rules.length === 1) out.push('Rate limit: ' + limitText(rules[0].limit) + ', ' + scope);
            else if (rules.length) out.push('Rate limit: ' + plural(rules.length, 'rule') + ', ' + scope);
        }
        var retry = spec.retry;
        if (retry) {
            var on = [];
            var ro = retry.retryOn || {};
            if (arr(ro.httpStatusCodes).length) on.push(ro.httpStatusCodes.join(', '));
            if (arr(ro.triggers).length) on.push(ro.triggers.join(', '));
            out.push('Retries ' + (retry.numRetries !== undefined ? plural(retry.numRetries, 'time') : '') + (on.length ? ' on ' + on.join('; ') : ''));
        }
        var timeout = spec.timeout || {};
        if (timeout.http && timeout.http.requestTimeout) out.push('Gives backends ' + duration(timeout.http.requestTimeout) + ' to answer');
        if (timeout.http && timeout.http.connectionIdleTimeout) out.push('Closes idle backend connections after ' + duration(timeout.http.connectionIdleTimeout));
        if (timeout.tcp && timeout.tcp.connectTimeout) out.push('Gives up connecting after ' + duration(timeout.tcp.connectTimeout));
        var cb = spec.circuitBreaker;
        if (cb) {
            var bits = [];
            if (cb.maxConnections) bits.push(cb.maxConnections + ' connections');
            if (cb.maxPendingRequests) bits.push(cb.maxPendingRequests + ' waiting');
            if (cb.maxParallelRequests) bits.push(cb.maxParallelRequests + ' in flight');
            out.push('Circuit breaker' + (bits.length ? ': at most ' + bits.join(', ') : ''));
        }
        var hc = spec.healthCheck;
        if (hc && hc.active) out.push('Checks backends actively' + (hc.active.http && hc.active.http.path ? ' on ' + hc.active.http.path : ''));
        if (hc && hc.passive) out.push('Ejects backends after ' + (hc.passive.consecutive5XxErrors || 5) + ' errors in a row');
        if (spec.loadBalancer && spec.loadBalancer.type) out.push('Balances by ' + words(spec.loadBalancer.type).toLowerCase());
        var fault = spec.faultInjection;
        if (fault && fault.delay) out.push('Injects delays of ' + duration(fault.delay.fixedDelay) + ' (testing)');
        if (fault && fault.abort) out.push('Injects errors (' + (fault.abort.httpStatus || 'aborts') + ', testing)');
        if (arr(spec.compression).length) out.push('Compresses responses (' + spec.compression.map(function (c) { return c.type; }).join(', ') + ')');
        if (spec.useClientProtocol) out.push('Talks to backends in the client’s HTTP version');
        if (spec.proxyProtocol) out.push('Sends the PROXY protocol to backends');
        if (spec.tcpKeepalive) out.push('Keeps backend connections alive with TCP keepalive');
        return out;
    }

    function securitySummary(spec) {
        var out = [];
        if (spec.cors) {
            var origins = arr(spec.cors.allowOrigins);
            out.push('CORS: allows ' + (origins.length ? origins.slice(0, 3).join(', ') + (origins.length > 3 ? ' and ' + (origins.length - 3) + ' more' : '') : 'no origins'));
        }
        if (spec.jwt) {
            var providers = arr(spec.jwt.providers);
            out.push('Requires a JWT from ' + (providers.map(function (p) { return p.issuer || p.name; }).join(', ') || 'a provider') + (spec.jwt.optional ? ' (optional)' : ''));
        }
        if (spec.oidc) out.push('Signs users in with OIDC at ' + ((spec.oidc.provider && spec.oidc.provider.issuer) || 'a provider'));
        if (spec.basicAuth) out.push('Requires a user name and password (basic auth)');
        if (spec.apiKeyAuth) out.push('Requires an API key');
        if (spec.extAuth) out.push('Asks an external ' + (spec.extAuth.grpc ? 'gRPC' : 'HTTP') + ' service whether to allow each request');
        if (spec.authorization) {
            var az = spec.authorization;
            out.push('Authorization: ' + plural(arr(az.rules).length, 'rule') + ', otherwise ' + String(az.defaultAction || 'Deny').toLowerCase());
        }
        return out;
    }

    function extensionSummary(spec) {
        var out = [];
        if (arr(spec.wasm).length) out.push('Runs ' + plural(spec.wasm.length, 'Wasm module'));
        if (arr(spec.extProc).length) out.push('Sends requests through ' + plural(spec.extProc.length, 'external processor'));
        if (arr(spec.lua).length) out.push('Runs ' + plural(spec.lua.length, 'Lua script'));
        return out;
    }

    function patchSummary(spec) {
        var n = arr(spec.jsonPatches).length;
        return [plural(n, 'JSON patch', 'JSON patches') + ' to the generated Envoy configuration'];
    }

    var SUMMARIES = { ctp: clientSummary, btp: backendSummary, sp: securitySummary, eep: extensionSummary, epp: patchSummary };

    /** Every target a policy names, by ref or by selector. */
    function policyTargets(obj, ctx) {
        var m = meta(obj);
        var spec = obj.spec || {};
        var ns = m.namespace;
        var refs = arr(spec.targetRefs).slice();
        if (spec.targetRef) refs.push(spec.targetRef);
        var out = refs.map(function (r) {
            var target = ctx.targets[keyOf(r.kind, ns, r.name)] || null;
            return { kind: r.kind, namespace: ns, name: r.name, sectionName: r.sectionName || '', target: target };
        });
        arr(spec.targetSelectors).forEach(function (sel) {
            var want = sel.matchLabels || {};
            Object.keys(ctx.targets).forEach(function (k) {
                var t = ctx.targets[k];
                if (t.kind !== sel.kind || t.namespace !== ns) return;
                var labels = t.object.labels || {};
                var all = Object.keys(want).every(function (l) {
                    return labels[l] === want[l];
                });
                if (all) out.push({ kind: t.kind, namespace: ns, name: t.object.name, sectionName: '', target: t, selected: true });
            });
        });
        return out;
    }

    function buildPolicy(obj, pk, ctx) {
        var m = meta(obj);
        var spec = obj.spec || {};
        var ancestors = arr(obj.status && obj.status.ancestors).map(function (a) {
            var r = a.ancestorRef || {};
            var conds = arr(a.conditions);
            var accepted = cond(conds, 'Accepted');
            var extra = conds.filter(function (c) {
                return c.type !== 'Accepted' && c.status === 'True' && /Overridden|Conflict|Merged|Degraded|Warning/.test(c.type);
            });
            return {
                name: (r.namespace ? r.namespace + '/' : '') + r.name + (r.sectionName ? ' · ' + r.sectionName : ''),
                kind: r.kind || 'Gateway',
                accepted: accepted,
                notes: extra.map(function (c) {
                    return words(c.reason || c.type) + (c.message ? ': ' + c.message : '');
                }),
            };
        });

        var targets = policyTargets(obj, ctx);
        var tone = 'ok';
        var says = 'Accepted';
        var message = '';
        var rejected = ancestors.filter(function (a) {
            return isFalse(a.accepted);
        });
        if (rejected.length) {
            tone = 'error';
            says = words(rejected[0].accepted.reason) || 'Not accepted';
            message = rejected[0].accepted.message;
        } else if (!targets.length) {
            tone = 'warn';
            says = 'Targets nothing';
        } else if (targets.every(function (t) { return !t.target; })) {
            tone = 'error';
            says = 'Its target does not exist';
        } else if (!ancestors.length) {
            tone = 'warn';
            says = 'No status yet';
        } else if (ancestors.some(function (a) { return a.notes.length; })) {
            tone = 'warn';
            says = 'Partly overridden';
        }

        var summary = (SUMMARIES[pk.key] || function () {
            return [];
        })(spec);

        var policy = {
            key: keyOf(pk.kind, m.namespace, m.name),
            type: pk,
            namespace: m.namespace,
            name: m.name,
            targets: targets,
            ancestors: ancestors,
            tone: tone,
            says: says,
            message: message,
            summary: summary.length ? summary : ['No settings that this plugin knows how to describe'],
            ref: { kind: pk.appKind, namespace: m.namespace, name: m.name },
        };
        targets.forEach(function (t) {
            if (t.target) t.target.object.policies.push(policy);
        });
        return policy;
    }

    // ----- findings ------------------------------------------------------------------

    function findings(model) {
        var out = [];
        function push(tone, title, detail, ref) {
            out.push({ tone: tone, title: title, detail: detail || '', ref: ref || null });
        }

        if (model.installed && !model.controller.length) {
            push('warn', 'Envoy Gateway’s controller was not found', 'No pod labelled ' + CONTROLLER_SELECTOR + ' — it may run under other labels, or not at all.');
        } else if (model.controller.length && !model.controller.some(function (p) { return p.ready; })) {
            push('error', 'Envoy Gateway’s controller is not ready', 'Nothing new is configured until it is: changes to Gateways, routes and policies wait.', model.controller[0].ref);
        }

        model.gateways.forEach(function (g) {
            if (isFalse(g.accepted)) push('error', g.name + ' was not accepted', words(g.accepted.reason) + (g.accepted.message ? ' — ' + g.accepted.message : ''), g.ref);
            else if (isFalse(g.programmed)) push('error', g.name + ' is not programmed', words(g.programmed.reason) + (g.programmed.message ? ' — ' + g.programmed.message : ''), g.ref);
            else if (g.programmed && !g.addresses.length) push('warn', g.name + ' has no address yet', 'Its Service is waiting for a load balancer to give it one.', g.ref);
            if (g.proxies.length && !g.readyProxies) push('error', 'No proxy is ready for ' + g.name, 'Every request to it fails until one is.', g.proxies[0].ref);
            else if (g.readyProxies < g.proxies.length) push('warn', g.readyProxies + ' of ' + g.proxies.length + ' proxies ready for ' + g.name, '', g.ref);
            g.listeners.forEach(function (l) {
                l.problems.forEach(function (c) {
                    push('error', 'Listener ' + l.name + ' on ' + g.name + ': ' + words(c.reason).toLowerCase(), c.message, g.ref);
                });
                if (!l.problems.length && l.attached === 0 && l.protocol !== 'TLS' && l.tlsMode !== 'Passthrough') {
                    push('info', 'Listener ' + l.name + ' on ' + g.name + ' has no routes', 'It accepts connections and answers every request with a 404.', g.ref);
                }
            });
        });

        model.routes.forEach(function (r) {
            r.parents.forEach(function (p) {
                if (p.tone === 'error') {
                    push('error', r.type.label + ' route ' + r.name + ': ' + p.says.toLowerCase(), (p.message || '') + (p.gateway ? '' : ' It names ' + p.namespace + '/' + p.name + '.'), r.ref);
                }
            });
            r.rules.forEach(function (rule) {
                rule.backends.forEach(function (b) {
                    if (b.backend.tone === 'error') push('error', r.name + ' → ' + b.backend.name + ': ' + b.backend.says.toLowerCase(), b.backend.consequence, b.backend.ref || r.ref);
                });
            });
        });

        model.policies.forEach(function (p) {
            if (p.tone === 'error' || p.tone === 'warn') {
                push(p.tone, p.type.label + ' policy ' + p.name + ': ' + p.says.toLowerCase(), p.message, p.ref);
            }
        });

        // A backend named by several rules is one problem, not several.
        var seen = {};
        out = out.filter(function (f) {
            var k = f.tone + f.title;
            if (seen[k]) return false;
            seen[k] = true;
            return true;
        });
        return out.sort(function (a, b) {
            return (TONE_RANK[b.tone] || 0) - (TONE_RANK[a.tone] || 0);
        });
    }

    function verdict(model) {
        if (!model.installed) {
            return { tone: 'muted', title: 'Envoy Gateway is not in this cluster', text: 'None of its GatewayClasses or custom resources were found.' };
        }
        if (!model.gateways.length) {
            return {
                tone: 'info',
                title: 'No Gateways yet',
                text: model.classes.length
                    ? 'Envoy Gateway is installed, with ' + plural(model.classes.length, 'GatewayClass', 'GatewayClasses') + '. A Gateway using one is what makes it start a proxy.'
                    : 'Envoy Gateway is installed, but no GatewayClass names it as its controller yet.',
            };
        }
        var errors = model.findings.filter(function (f) {
            return f.tone === 'error';
        }).length;
        var warns = model.findings.filter(function (f) {
            return f.tone === 'warn';
        }).length;
        var serving = model.gateways.filter(function (g) {
            return g.tone === 'ok';
        }).length;
        var routeCount = model.routes.length;
        var text =
            plural(model.gateways.length, 'Gateway') + ' with ' + plural(model.listenerCount, 'listener') + ', ' +
            plural(routeCount, 'route') + ' to ' + plural(model.backends.length, 'backend') + ', and ' +
            plural(model.policies.length, 'policy', 'policies') + '.';
        if (errors) return { tone: 'error', title: plural(errors, 'problem') + ' stopping traffic', text: text };
        if (warns) return { tone: 'warn', title: plural(warns, 'thing') + ' to look at', text: text };
        if (serving === model.gateways.length) {
            return { tone: 'ok', title: model.gateways.length === 1 ? 'The Gateway is serving' : 'Every Gateway is serving', text: text };
        }
        return { tone: 'warn', title: plural(model.gateways.length - serving, 'Gateway') + ' not serving yet', text: text };
    }

    // ----- the whole thing -------------------------------------------------------------

    function build(raw) {
        var classes = {};
        var classList = raw.classes
            .filter(function (c) {
                return c.spec && c.spec.controllerName === CONTROLLER;
            })
            .map(function (c) {
                var m = meta(c);
                var accepted = cond(c.status && c.status.conditions, 'Accepted');
                var entry = {
                    name: m.name,
                    accepted: accepted,
                    tone: isFalse(accepted) ? 'error' : isTrue(accepted) ? 'ok' : 'warn',
                    parameters: (c.spec && c.spec.parametersRef) || null,
                    ref: { kind: KINDS.classes, name: m.name },
                };
                classes[m.name] = entry;
                return entry;
            });

        var proxies = raw.proxies.map(function (p) {
            var info = podInfo(p);
            var labels = meta(p).labels || {};
            info.gateway = (labels[OWNING_NAMESPACE] || '') + '/' + (labels[OWNING_NAME] || '');
            return info;
        });
        var proxiesByGateway = {};
        proxies.forEach(function (p) {
            (proxiesByGateway[p.gateway] = proxiesByGateway[p.gateway] || []).push(p);
        });

        var anyGateway = {};
        raw.gateways.forEach(function (g) {
            anyGateway[meta(g).namespace + '/' + meta(g).name] = true;
        });
        var gateways = raw.gateways
            .filter(function (g) {
                return g.spec && classes[g.spec.gatewayClassName];
            })
            .map(function (g) {
                return buildGateway(g, classes, proxiesByGateway);
            });
        var gatewaysByKey = {};
        gateways.forEach(function (g) {
            gatewaysByKey[g.key] = g;
        });

        var services = {};
        raw.services.forEach(function (s) {
            services[meta(s).namespace + '/' + meta(s).name] = s;
        });
        var egBackends = {};
        raw.backends.forEach(function (b) {
            egBackends[meta(b).namespace + '/' + meta(b).name] = b;
        });
        var endpoints = endpointsByService(raw.slices);
        var filtersByName = {};
        raw.filters.forEach(function (f) {
            var m = meta(f);
            (filtersByName[m.namespace] = filtersByName[m.namespace] || {})[m.name] = f;
        });

        var backends = {};
        function backend(kind, ns, name, port) {
            var k = keyOf(kind, ns, name);
            if (backends[k]) return backends[k];
            var b = { key: k, kind: kind, namespace: ns, name: name, port: port, routes: [], tone: 'ok', says: '', consequence: '', ref: null, ready: null, total: null };
            if (kind === 'Service') {
                var svc = services[ns + '/' + name];
                if (!svc) {
                    b.tone = 'error';
                    b.says = 'Service not found';
                    b.consequence = 'Requests to this rule are answered with a 500.';
                } else {
                    b.ref = { kind: KINDS.services, namespace: ns, name: name };
                    b.serviceType = (svc.spec && svc.spec.type) || 'ClusterIP';
                    if (b.serviceType === 'ExternalName') {
                        b.says = 'External: ' + svc.spec.externalName;
                    } else {
                        var e = endpoints[ns + '/' + name] || { ready: 0, total: 0 };
                        b.ready = e.ready;
                        b.total = e.total;
                        if (!e.ready) {
                            b.tone = 'error';
                            b.says = e.total ? 'No endpoint ready' : 'No endpoints';
                            b.consequence = 'Requests to it are answered with a 503 until a pod behind it is ready.';
                        } else if (e.ready < e.total) {
                            b.tone = 'warn';
                            b.says = e.ready + ' of ' + e.total + ' ready';
                        } else {
                            b.says = plural(e.ready, 'endpoint') + ' ready';
                        }
                    }
                }
            } else if (kind === 'Backend') {
                var eb = egBackends[ns + '/' + name];
                if (!eb) {
                    b.tone = 'error';
                    b.says = 'Backend not found';
                    b.consequence = 'Requests to this rule fail.';
                } else {
                    b.ref = { kind: KINDS.backends, namespace: ns, name: name };
                    var eps = arr(eb.spec && eb.spec.endpoints).map(function (ep) {
                        if (ep.fqdn) return ep.fqdn.hostname + ':' + ep.fqdn.port;
                        if (ep.ip) return ep.ip.address + ':' + ep.ip.port;
                        if (ep.unix) return 'unix:' + ep.unix.path;
                        return '?';
                    });
                    b.says = eps.length ? eps.slice(0, 2).join(', ') + (eps.length > 2 ? ' …' : '') : 'No endpoints';
                    if (!eps.length) b.tone = 'error';
                    var bAccepted = cond(eb.status && eb.status.conditions, 'Accepted');
                    if (isFalse(bAccepted)) {
                        b.tone = 'error';
                        b.says = words(bAccepted.reason) || 'Not accepted';
                    }
                }
            } else {
                b.tone = 'muted';
                b.says = kind;
            }
            backends[k] = b;
            return b;
        }

        var ctx = {
            gatewaysByKey: gatewaysByKey,
            anyGateway: anyGateway,
            backend: backend,
            filtersByName: filtersByName,
            targets: {},
        };

        var routes = [];
        ROUTES.forEach(function (rk) {
            (raw['route:' + rk.kind] || []).forEach(function (obj) {
                var route = buildRoute(obj, rk, ctx);
                if (!route.ours) return;
                routes.push(route);
            });
        });

        // Wire routes to their Gateways, listeners and backends.
        routes.forEach(function (r) {
            r.parents.forEach(function (p) {
                if (!p.gateway) return;
                if (p.gateway.routes.indexOf(r) < 0) p.gateway.routes.push(r);
                p.listeners = p.gateway.listeners.filter(function (l) {
                    if (p.sectionName) return l.name === p.sectionName;
                    if (p.port) return l.port === p.port;
                    return true;
                });
                p.listeners.forEach(function (l) {
                    if (l.routes.indexOf(r) < 0) l.routes.push(r);
                });
            });
            r.rules.forEach(function (rule) {
                rule.backends.forEach(function (b) {
                    if (b.backend.routes.indexOf(r) < 0) b.backend.routes.push(r);
                });
            });
        });

        gateways.forEach(function (g) {
            ctx.targets[keyOf('Gateway', g.namespace, g.name)] = { kind: 'Gateway', namespace: g.namespace, object: g };
        });
        routes.forEach(function (r) {
            ctx.targets[keyOf(r.type.kind, r.namespace, r.name)] = { kind: r.type.kind, namespace: r.namespace, object: r };
        });

        var policies = [];
        POLICIES.forEach(function (pk) {
            (raw['policy:' + pk.kind] || []).forEach(function (obj) {
                policies.push(buildPolicy(obj, pk, ctx));
            });
        });

        var envoyProxies = raw.envoyproxies.map(function (e) {
            var m = meta(e);
            var k8s = (e.spec && e.spec.provider && e.spec.provider.kubernetes) || {};
            return {
                namespace: m.namespace,
                name: m.name,
                replicas: k8s.envoyDeployment && k8s.envoyDeployment.replicas,
                serviceType: k8s.envoyService && k8s.envoyService.type,
                ref: { kind: KINDS.envoyproxies, namespace: m.namespace, name: m.name },
            };
        });

        var controller = raw.controller.map(podInfo);
        var installed =
            classList.length > 0 ||
            controller.length > 0 ||
            !raw.errors['policy:SecurityPolicy'] ||
            !raw.errors.envoyproxies;

        var model = {
            installed: installed,
            classes: classList,
            gateways: gateways,
            routes: routes,
            backends: Object.keys(backends).map(function (k) {
                return backends[k];
            }),
            policies: policies,
            proxies: proxies,
            controller: controller,
            envoyProxies: envoyProxies,
            listenerCount: gateways.reduce(function (n, g) {
                return n + g.listeners.length;
            }, 0),
            errors: raw.errors,
        };
        // The version is the controller image's tag: what `helm list` would say,
        // without needing to read Helm's Secrets.
        var image = (controller[0] && controller[0].image) || '';
        var tag = image.indexOf('@') < 0 && image.lastIndexOf(':') > image.lastIndexOf('/') ? image.slice(image.lastIndexOf(':') + 1) : '';
        model.version = tag;
        model.findings = findings(model);
        model.verdict = verdict(model);
        return model;
    }

    /** A short fingerprint of what the model says, to redraw only on change. */
    function signature(model) {
        return JSON.stringify({
            g: model.gateways.map(function (g) {
                return [g.key, g.tone, g.addresses, g.readyProxies, g.proxies.length, g.listeners.map(function (l) { return [l.tone, l.attached]; })];
            }),
            r: model.routes.map(function (r) {
                return [r.key, r.tone, r.hostnames, r.parents.map(function (p) { return p.says; }), r.rules.map(function (x) {
                    return [x.matches, x.filters, x.backends.map(function (b) { return [b.backend.key, b.weight]; })];
                })];
            }),
            b: model.backends.map(function (b) {
                return [b.key, b.tone, b.ready, b.total];
            }),
            p: model.policies.map(function (p) {
                return [p.key, p.tone, p.says, p.summary, p.targets.map(function (t) { return t.kind + t.name + !!t.target; })];
            }),
            c: model.controller.map(function (p) {
                return p.ready;
            }),
        });
    }

    window.EnvoyGateway = {
        KINDS: KINDS,
        ROUTES: ROUTES,
        POLICIES: POLICIES,
        CONTROLLER: CONTROLLER,
        load: load,
        build: build,
        signature: signature,
        cond: cond,
        words: words,
        plural: plural,
        worst: worst,
        keyOf: keyOf,
        routeFilterText: routeFilterText,
    };
})();
