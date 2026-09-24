// The traffic map: Gateways and their listeners on the left, the routes that
// attach to them in the middle, and the Services those routes send requests
// to on the right -- the path a request takes, drawn as a path.
//
// A broken link is drawn as a broken line, where it breaks: a route a Gateway
// did not accept, a Service that does not exist, one with nothing ready behind
// it. Hovering anything lights up everything it is connected to; clicking it
// says in the inspector what it is and what is wrong with it.
(function () {
    'use strict';

    var sdk = window.k8sdockside;
    var E = window.EnvoyGateway;
    var K = window.EnvoyKit;
    var P = window.EnvoyParts;
    var el = K.el;
    var add = K.add;

    var POLL = 10000;

    var state = {
        model: null,
        sig: '',
        selected: null, // { type: 'gateway'|'route'|'backend', key }
        hover: null,
        gateway: '',
        query: '',
        problems: false,
        nodes: {}, // key -> element
        ports: {}, // gateway key + '#' + listener name -> element
    };

    var $ = function (id) {
        return document.getElementById(id);
    };

    function fail(err) {
        $('error').textContent = (err && err.message) || String(err);
        $('error').hidden = false;
    }

    function open(ref) {
        sdk.open(ref).catch(fail);
    }

    // ----- what is shown --------------------------------------------------------

    function matches(text) {
        return String(text || '').toLowerCase().indexOf(state.query) >= 0;
    }

    /** The routes, gateways and backends left once the filters have had their say. */
    function visible(model) {
        var routes = model.routes.filter(function (r) {
            if (state.gateway && !r.parents.some(function (p) { return p.gateway && p.gateway.key === state.gateway; })) return false;
            if (state.problems && r.tone === 'ok') return false;
            return true;
        });
        var gateways = model.gateways.filter(function (g) {
            if (state.gateway && g.key !== state.gateway) return false;
            if (state.problems && g.tone === 'ok' && !routes.some(function (r) { return g.routes.indexOf(r) >= 0; })) return false;
            return true;
        });

        if (state.query) {
            var hit = {};
            gateways.forEach(function (g) {
                if (matches(g.name) || g.addresses.some(matches) || g.listeners.some(function (l) { return matches(l.hostname); })) hit[g.key] = true;
            });
            routes.forEach(function (r) {
                var direct = matches(r.name) || r.hostnames.some(matches);
                var viaBackend = r.rules.some(function (rule) {
                    return rule.backends.some(function (b) {
                        return matches(b.backend.name);
                    });
                });
                if (direct || viaBackend) {
                    hit[r.key] = true;
                    r.parents.forEach(function (p) {
                        if (p.gateway) hit[p.gateway.key] = true;
                    });
                }
            });
            gateways.forEach(function (g) {
                if (hit[g.key] && matches(g.name)) {
                    g.routes.forEach(function (r) {
                        hit[r.key] = true;
                    });
                }
            });
            routes = routes.filter(function (r) {
                return hit[r.key];
            });
            gateways = gateways.filter(function (g) {
                return hit[g.key];
            });
        }

        var seen = {};
        var backends = [];
        routes.forEach(function (r) {
            r.rules.forEach(function (rule) {
                rule.backends.forEach(function (b) {
                    if (seen[b.backend.key]) return;
                    seen[b.backend.key] = true;
                    backends.push(b.backend);
                });
            });
        });

        // Routes in the order of the gateways they hang off, so the lines
        // cross as little as a column layout lets them.
        var order = {};
        gateways.forEach(function (g, i) {
            order[g.key] = i;
        });
        routes.sort(function (a, b) {
            var ga = Math.min.apply(null, a.parents.map(function (p) { return p.gateway ? order[p.gateway.key] || 0 : 99; }).concat([99]));
            var gb = Math.min.apply(null, b.parents.map(function (p) { return p.gateway ? order[p.gateway.key] || 0 : 99; }).concat([99]));
            return ga - gb || a.name.localeCompare(b.name);
        });
        var rOrder = {};
        routes.forEach(function (r, i) {
            rOrder[r.key] = i;
        });
        backends.sort(function (a, b) {
            var ra = Math.min.apply(null, a.routes.map(function (r) { return rOrder[r.key] === undefined ? 99 : rOrder[r.key]; }));
            var rb = Math.min.apply(null, b.routes.map(function (r) { return rOrder[r.key] === undefined ? 99 : rOrder[r.key]; }));
            return ra - rb || a.name.localeCompare(b.name);
        });

        return { gateways: gateways, routes: routes, backends: backends };
    }

    // ----- what is connected to what --------------------------------------------

    /** Everything connected to one thing: the set the hover lights up. */
    function connected(sel) {
        var lit = {};
        var model = state.model;
        if (!sel || !model) return lit;
        function route(r) {
            lit[r.key] = true;
            r.parents.forEach(function (p) {
                if (!p.gateway) return;
                lit[p.gateway.key] = true;
                (p.listeners || []).forEach(function (l) {
                    lit[p.gateway.key + '#' + l.name] = true;
                });
            });
            r.rules.forEach(function (rule) {
                rule.backends.forEach(function (b) {
                    lit[b.backend.key] = true;
                });
            });
        }
        if (sel.type === 'gateway') {
            var g = byKey(model.gateways, sel.key);
            if (g) {
                lit[g.key] = true;
                g.routes.forEach(route);
            }
        } else if (sel.type === 'listener') {
            var gw = byKey(model.gateways, sel.gateway);
            var l = gw && gw.listeners.filter(function (x) { return x.name === sel.name; })[0];
            if (l) {
                l.routes.forEach(function (r) {
                    route(r);
                });
                // Only this listener's port, not the others the routes also use.
                Object.keys(lit).forEach(function (k) {
                    if (k.indexOf(gw.key + '#') === 0 && k !== gw.key + '#' + l.name) delete lit[k];
                });
                lit[gw.key] = true;
                lit[gw.key + '#' + l.name] = true;
            }
        } else if (sel.type === 'route') {
            var r = byKey(model.routes, sel.key);
            if (r) route(r);
        } else if (sel.type === 'backend') {
            var b = byKey(model.backends, sel.key);
            if (b) {
                lit[b.key] = true;
                b.routes.forEach(function (r) {
                    lit[r.key] = true;
                    r.parents.forEach(function (p) {
                        if (!p.gateway) return;
                        lit[p.gateway.key] = true;
                        (p.listeners || []).forEach(function (l) {
                            lit[p.gateway.key + '#' + l.name] = true;
                        });
                    });
                });
            }
        }
        return lit;
    }

    function byKey(list, key) {
        for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
        return null;
    }

    // ----- drawing the nodes ----------------------------------------------------------

    function nodeEvents(node, sel) {
        node.addEventListener('mouseenter', function () {
            state.hover = sel;
            light();
        });
        node.addEventListener('mouseleave', function () {
            state.hover = null;
            light();
        });
        node.addEventListener('click', function (e) {
            e.stopPropagation();
            state.selected = sel;
            light();
            inspect();
        });
        node.addEventListener('focus', function () {
            state.hover = sel;
            light();
        });
        node.addEventListener('blur', function () {
            state.hover = null;
            light();
        });
    }

    function gatewayNode(g) {
        var node = el('div', 'node gateway ' + g.tone);
        node.tabIndex = 0;
        node.setAttribute('role', 'button');
        var head = el('div', 'node-head');
        add(head, K.icon('gateway'), el('span', 'node-name', g.name), K.dot(g.tone, g.headline));
        node.appendChild(head);
        node.appendChild(el('div', 'node-sub', g.addresses.length ? g.addresses.join(', ') : g.headline));
        var ports = el('div', 'ports');
        g.listeners.forEach(function (l) {
            var port = el('div', 'port');
            add(port, el('span', 'proto', l.protocol + ' ' + l.port), el('span', 'host', l.hostname || 'any host'), K.dot(l.tone));
            port.title = l.name + (l.problems[0] ? ' — ' + E.words(l.problems[0].reason) + (l.problems[0].message ? ': ' + l.problems[0].message : '') : '') + (l.attached !== null ? ' · ' + E.plural(l.attached, 'route') : '');
            port.addEventListener('mouseenter', function (e) {
                e.stopPropagation();
                state.hover = { type: 'listener', gateway: g.key, name: l.name };
                light();
            });
            port.addEventListener('mouseleave', function () {
                state.hover = { type: 'gateway', key: g.key };
                light();
            });
            state.ports[g.key + '#' + l.name] = port;
            ports.appendChild(port);
        });
        node.appendChild(ports);
        if (g.policies.length) {
            var chips = el('div', 'node-chips');
            add(chips, P.policyChips(g.policies, open));
            node.appendChild(chips);
        }
        nodeEvents(node, { type: 'gateway', key: g.key });
        state.nodes[g.key] = node;
        return node;
    }

    function routeNode(r) {
        var node = el('div', 'node route ' + r.tone);
        node.tabIndex = 0;
        node.setAttribute('role', 'button');
        var head = el('div', 'node-head');
        add(head, K.icon('route'), el('span', 'node-name', r.name), K.dot(r.tone));
        node.appendChild(head);
        var sub = r.hostnames.length ? r.hostnames.join(', ') : 'every host on the listener';
        node.appendChild(el('div', 'node-sub', r.type.label + ' · ' + r.namespace + ' · ' + sub));
        var bad = r.parents.filter(function (p) {
            return p.tone === 'error';
        })[0];
        if (bad) node.appendChild(el('div', 'rb-says error', bad.says));
        if (r.policies.length) {
            var chips = el('div', 'node-chips');
            add(chips, P.policyChips(r.policies, open));
            node.appendChild(chips);
        }
        nodeEvents(node, { type: 'route', key: r.key });
        state.nodes[r.key] = node;
        return node;
    }

    function backendNode(b) {
        var node = el('div', 'node backend ' + b.tone);
        node.tabIndex = 0;
        node.setAttribute('role', 'button');
        var head = el('div', 'node-head');
        add(head, K.icon('backend'), el('span', 'node-name', b.name + (b.port ? ':' + b.port : '')), K.dot(b.tone));
        node.appendChild(head);
        node.appendChild(el('div', 'node-sub', (b.kind === 'Service' ? b.namespace : b.kind + ' · ' + b.namespace) + ' · ' + b.says));
        nodeEvents(node, { type: 'backend', key: b.key });
        state.nodes[b.key] = node;
        return node;
    }

    function column(title, iconName, items, draw, emptyText) {
        var col = el('div', 'map-column');
        var h = el('h3', '');
        add(h, K.icon(iconName), el('span', '', title), el('span', 'faint', String(items.length)));
        col.appendChild(h);
        if (!items.length) col.appendChild(el('p', 'faint small', emptyText));
        items.forEach(function (i) {
            col.appendChild(draw(i));
        });
        return col;
    }

    function drawMap() {
        var model = state.model;
        var map = K.clear($('map'));
        state.nodes = {};
        state.ports = {};
        if (!model.installed || !model.gateways.length) {
            var e = K.empty(
                model.installed ? 'No Gateways yet' : 'Envoy Gateway is not in this cluster',
                model.installed ? 'Create a Gateway with an Envoy Gateway GatewayClass and it appears here, with every route attached to it.' : 'Nothing to draw.',
            );
            e.classList.add('map-empty');
            map.appendChild(e);
            return;
        }
        var v = visible(model);
        state.visible = v;
        add(
            map,
            column('Gateways', 'gateway', v.gateways, gatewayNode, 'None match.'),
            column('Routes', 'route', v.routes, routeNode, v.gateways.length ? 'No routes attached.' : 'None match.'),
            column('Backends', 'backend', v.backends, backendNode, 'Nowhere to send requests.'),
        );
        var edges = K.svg('svg', { class: 'map-edges', 'aria-hidden': 'true' });
        map.appendChild(edges);
        state.edgesEl = edges;
        requestAnimationFrame(drawEdges);
        light();
    }

    // ----- drawing the edges -----------------------------------------------------------

    function anchor(node, side, box) {
        var r = node.getBoundingClientRect();
        return {
            x: (side === 'right' ? r.right : r.left) - box.left,
            y: r.top + r.height / 2 - box.top,
        };
    }

    function curve(a, b) {
        var dx = Math.max(24, (b.x - a.x) / 2);
        return 'M' + a.x + ' ' + a.y + ' C' + (a.x + dx) + ' ' + a.y + ', ' + (b.x - dx) + ' ' + b.y + ', ' + b.x + ' ' + b.y;
    }

    function drawEdges() {
        var edges = state.edgesEl;
        if (!edges || !state.visible) return;
        K.clear(edges);
        var box = $('map').getBoundingClientRect();
        edges.setAttribute('viewBox', '0 0 ' + box.width + ' ' + box.height);
        state.edgeEls = [];

        state.visible.routes.forEach(function (r) {
            var to = state.nodes[r.key];
            if (!to) return;
            r.parents.forEach(function (p) {
                if (!p.gateway || !state.nodes[p.gateway.key]) return;
                var froms = (p.listeners || []).length
                    ? p.listeners.map(function (l) {
                          return { el: state.ports[p.gateway.key + '#' + l.name], key: p.gateway.key + '#' + l.name };
                      })
                    : [{ el: state.nodes[p.gateway.key], key: p.gateway.key }];
                froms.forEach(function (f) {
                    if (!f.el) return;
                    var path = K.svg('path', { d: curve(anchor(f.el, 'right', box), anchor(to, 'left', box)), class: 'edge ' + (p.tone === 'ok' ? '' : p.tone) });
                    path.dataset.a = f.key;
                    path.dataset.b = r.key;
                    path.dataset.g = p.gateway.key;
                    edges.appendChild(path);
                    state.edgeEls.push(path);
                });
            });
            r.rules.forEach(function (rule) {
                rule.backends.forEach(function (b) {
                    var target = state.nodes[b.backend.key];
                    if (!target) return;
                    var a = anchor(to, 'right', box);
                    var z = anchor(target, 'left', box);
                    var path = K.svg('path', { d: curve(a, z), class: 'edge ' + (b.backend.tone === 'ok' ? '' : b.backend.tone) });
                    path.dataset.a = r.key;
                    path.dataset.b = b.backend.key;
                    edges.appendChild(path);
                    state.edgeEls.push(path);
                    if (rule.backends.length > 1) {
                        var label = K.svg('text', { x: z.x - 30, y: z.y - 4, class: 'edge-label' });
                        label.textContent = Math.round(b.share * 100) + '%';
                        edges.appendChild(label);
                    }
                });
            });
        });
        light();
    }

    function light() {
        var map = $('map');
        var sel = state.hover || state.selected;
        var lit = connected(sel);
        var tracing = !!sel && Object.keys(lit).length > 0;
        map.classList.toggle('tracing', tracing);
        Object.keys(state.nodes).forEach(function (k) {
            state.nodes[k].classList.toggle('lit', !!lit[k]);
            state.nodes[k].classList.toggle('selected', !!state.selected && state.selected.key === k);
        });
        Object.keys(state.ports).forEach(function (k) {
            state.ports[k].classList.toggle('lit', tracing && !!lit[k]);
        });
        (state.edgeEls || []).forEach(function (e) {
            var on = lit[e.dataset.a] && lit[e.dataset.b];
            e.classList.toggle('lit', tracing && !!on);
        });
    }

    // ----- the inspector --------------------------------------------------------------------

    function kv(pairs) {
        var dl = el('dl', 'kv');
        pairs.forEach(function (p) {
            if (p[1] === null || p[1] === undefined || p[1] === '') return;
            dl.appendChild(el('dt', '', p[0]));
            var dd = el('dd', '');
            add(dd, typeof p[1] === 'string' ? el('span', '', p[1]) : p[1]);
            dl.appendChild(dd);
        });
        return dl;
    }

    function inspectGateway(box, g) {
        var h = el('h2', '');
        add(h, K.icon('gateway'), el('span', '', g.name));
        box.appendChild(h);
        box.appendChild(K.pill(g.tone, g.headline));
        box.appendChild(
            kv([
                ['Namespace', g.namespace],
                ['Class', g.className],
                ['Addresses', g.addresses.join(', ') || 'none yet'],
                ['Routes', String(g.routes.length)],
            ]),
        );
        box.appendChild(el('p', 'sub-heading', 'Listeners'));
        var list = el('div', 'listeners');
        g.listeners.forEach(function (l) {
            list.appendChild(P.listenerRow(l));
            l.problems.forEach(function (c) {
                list.appendChild(el('p', 'says error', E.words(c.reason) + (c.message ? ': ' + c.message : '')));
            });
        });
        box.appendChild(list);
        box.appendChild(el('p', 'sub-heading', 'Proxies'));
        box.appendChild(P.proxyDots(g));
        if (g.policies.length) {
            box.appendChild(el('p', 'sub-heading', 'Policies'));
            var chips = el('div', 'node-chips');
            add(chips, P.policyChips(g.policies, open));
            box.appendChild(chips);
        }
        var actions = el('div', 'actions');
        add(
            actions,
            K.button('Open', 'open', function () {
                open(g.ref);
            }),
            g.proxies[0]
                ? K.button('Proxy logs', 'logs', function () {
                      sdk.logs(g.proxies[0].ref).catch(fail);
                  }, 'quiet')
                : null,
        );
        box.appendChild(actions);
    }

    function inspectRoute(box, r) {
        var h = el('h2', '');
        add(h, K.icon('route'), el('span', '', r.name));
        box.appendChild(h);
        box.appendChild(
            kv([
                ['Kind', r.type.kind],
                ['Namespace', r.namespace],
                ['Hosts', r.hostnames.join(', ') || 'every host on the listener'],
            ]),
        );
        box.appendChild(el('p', 'sub-heading', 'Attached to'));
        var parents = el('div', 'parents');
        r.parents.forEach(function (p) {
            var row = el('div', 'parent');
            add(
                row,
                K.icon('gateway'),
                p.gateway
                    ? K.link(p.name + (p.sectionName ? ' · ' + p.sectionName : ''), function () {
                          open(p.gateway.ref);
                      })
                    : el('span', '', p.namespace + '/' + p.name),
                K.pill(p.tone, p.says),
            );
            parents.appendChild(row);
            if (p.message) parents.appendChild(el('p', 'says ' + (p.tone === 'error' ? 'error' : 'warn'), p.message));
        });
        box.appendChild(parents);
        box.appendChild(el('p', 'sub-heading', 'Rules'));
        box.appendChild(P.rulesView(r, open));
        if (r.policies.length) {
            box.appendChild(el('p', 'sub-heading', 'Policies'));
            var chips = el('div', 'node-chips');
            add(chips, P.policyChips(r.policies, open));
            box.appendChild(chips);
        }
        var actions = el('div', 'actions');
        actions.appendChild(K.button('Open', 'open', function () {
            open(r.ref);
        }));
        box.appendChild(actions);
    }

    function inspectBackend(box, b) {
        var h = el('h2', '');
        add(h, K.icon('backend'), el('span', '', b.name));
        box.appendChild(h);
        if (b.says) box.appendChild(el('p', 'says ' + b.tone, b.says + (b.consequence ? ' — ' + b.consequence : '')));
        box.appendChild(
            kv([
                ['Kind', b.kind],
                ['Namespace', b.namespace],
                ['Port', b.port ? String(b.port) : ''],
                ['Type', b.serviceType || ''],
                ['Endpoints', b.total === null ? '' : b.ready + ' ready of ' + b.total],
            ]),
        );
        box.appendChild(el('p', 'sub-heading', 'Used by'));
        var list = el('div', 'parents');
        b.routes.forEach(function (r) {
            var row = el('div', 'parent');
            add(row, K.icon('route'), K.link(r.name, function () {
                open(r.ref);
            }), el('span', 'faint small', r.namespace));
            list.appendChild(row);
        });
        box.appendChild(list);
        if (b.ref) {
            var actions = el('div', 'actions');
            actions.appendChild(K.button('Open', 'open', function () {
                open(b.ref);
            }));
            box.appendChild(actions);
        }
    }

    function inspect() {
        var box = K.clear($('inspector'));
        var model = state.model;
        var sel = state.selected;
        var item = null;
        if (sel && model) {
            item = byKey(sel.type === 'gateway' ? model.gateways : sel.type === 'route' ? model.routes : model.backends, sel.key);
        }
        if (!item) {
            box.appendChild(el('p', 'sub-heading', 'Inspector'));
            box.appendChild(el('p', 'dim', 'Click a Gateway, a route or a backend to see what it is and what is wrong with it.'));
            if (model && model.findings.length) {
                var n = model.findings.filter(function (f) {
                    return f.tone === 'error';
                }).length;
                if (n) box.appendChild(el('p', 'says error', E.plural(n, 'problem') + ' on this map — the broken lines show where.'));
            }
            return;
        }
        if (sel.type === 'gateway') inspectGateway(box, item);
        else if (sel.type === 'route') inspectRoute(box, item);
        else inspectBackend(box, item);
    }

    // ----- the loop --------------------------------------------------------------------------

    function fillGateways(model) {
        var select = $('gateway');
        var current = state.gateway;
        K.clear(select);
        var all = el('option', '', 'Every Gateway');
        all.value = '';
        select.appendChild(all);
        model.gateways.forEach(function (g) {
            var o = el('option', '', g.namespace + '/' + g.name);
            o.value = g.key;
            select.appendChild(o);
        });
        if (current && !byKey(model.gateways, current)) state.gateway = '';
        select.value = state.gateway;
    }

    function draw() {
        var model = state.model;
        $('where').textContent = model.installed
            ? E.plural(model.gateways.length, 'Gateway') + ' · ' + E.plural(model.routes.length, 'route') + ' · ' + E.plural(model.backends.length, 'backend')
            : 'Envoy Gateway is not in this cluster';
        fillGateways(model);
        drawMap();
        inspect();
    }

    function poll() {
        return E.load(sdk)
            .then(function (raw) {
                var model = E.build(raw);
                $('error').hidden = true;
                var sig = E.signature(model);
                state.model = model;
                if (sig !== state.sig) {
                    state.sig = sig;
                    draw();
                }
            })
            .catch(fail);
    }

    $('mark').appendChild(K.icon('map'));
    $('query').addEventListener('input', function (e) {
        state.query = e.target.value.trim().toLowerCase();
        if (state.model) drawMap();
    });
    $('gateway').addEventListener('change', function (e) {
        state.gateway = e.target.value;
        if (state.model) drawMap();
    });
    $('problems').addEventListener('change', function (e) {
        state.problems = e.target.checked;
        if (state.model) drawMap();
    });
    $('map').addEventListener('click', function () {
        state.selected = null;
        light();
        inspect();
    });
    if (window.ResizeObserver) {
        new ResizeObserver(function () {
            requestAnimationFrame(drawEdges);
        }).observe($('map'));
    }

    sdk.ready()
        .then(function () {
            // The overview's "Trace" hands a Gateway over through storage.
            if (!sdk.storage) return null;
            return sdk.storage.get('focus').then(function (key) {
                if (!key) return;
                state.gateway = key;
                state.selected = { type: 'gateway', key: key };
                return sdk.storage.remove('focus');
            });
        })
        .catch(function () {})
        .then(poll)
        .then(function () {
            setInterval(poll, POLL);
        })
        .catch(fail);
})();
