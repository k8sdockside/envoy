// Envoy Gateway's own overview, in place of the page the app generates for
// every plugin. It answers what the generated one does -- is it even
// installed here? -- and then what that page cannot: whether traffic is
// actually getting through, what stands in its way, and how it is doing.
(function () {
    'use strict';

    var sdk = window.k8sdockside;
    var E = window.EnvoyGateway;
    var K = window.EnvoyKit;
    var P = window.EnvoyParts;
    var el = K.el;
    var add = K.add;

    var POLL = 10000;
    var CHARTS_EVERY = 60000;
    var EVENTS_EVERY = 30000;
    var CHART_MINUTES = 60;

    // The kinds whose events are about Envoy Gateway, when an event does not
    // say which controller wrote it.
    var EVENT_KINDS = ['Gateway', 'GatewayClass', 'HTTPRoute', 'GRPCRoute', 'TLSRoute', 'TCPRoute', 'UDPRoute', 'EnvoyProxy']
        .concat(E.POLICIES.map(function (p) {
            return p.kind;
        }));

    var state = { ctx: null, model: null, sig: '', charts: null, events: null };

    var $ = function (id) {
        return document.getElementById(id);
    };

    function fail(err) {
        $('error').textContent = (err && err.message) || String(err);
        $('error').hidden = false;
    }

    function clearError() {
        $('error').hidden = true;
    }

    function open(ref) {
        sdk.open(ref).catch(fail);
    }

    function openView(id) {
        sdk.openView(id).catch(fail);
    }

    /** Opens the map on one Gateway, remembering the choice for the map to read. */
    function trace(g) {
        var go = function () {
            openView('map');
        };
        if (sdk.storage) sdk.storage.set('focus', g.key).then(go, go);
        else go();
    }

    // ----- the hero and the tiles -----------------------------------------------

    function drawHero(model) {
        var hero = K.clear($('hero'));
        var v = model.verdict;
        hero.className = 'hero ' + v.tone;
        var mark = el('div', 'hero-mark');
        mark.appendChild(K.icon(v.tone === 'ok' ? 'check' : v.tone === 'error' || v.tone === 'warn' ? 'alert' : 'gateway'));
        var text = el('div', '');
        add(text, el('h1', '', v.title), el('p', '', v.text));
        if (model.installed && model.gateways.length) {
            var actions = el('div', 'hero-actions');
            add(
                actions,
                K.button('Traffic map', 'map', function () {
                    openView('map');
                }),
                K.button('Policies', 'shield', function () {
                    openView('policies');
                }, 'quiet'),
            );
            text.appendChild(actions);
        }
        add(hero, mark, text);
    }

    function tile(label, iconName, value, total, tone, onClick, title) {
        var node = el('button', 'tile ' + tone);
        node.type = 'button';
        var head = el('span', 'tile-label');
        add(head, K.icon(iconName), el('span', '', label));
        var v = el('span', 'tile-value', String(value));
        if (total !== null && total !== undefined) v.appendChild(el('span', 'of', '/' + total));
        add(node, head, v);
        if (title) node.title = title;
        node.addEventListener('click', onClick);
        return node;
    }

    function ratioTone(n, total) {
        if (!total) return 'muted';
        if (n === total) return 'ok';
        return n === 0 ? 'error' : 'warn';
    }

    function drawTiles(model) {
        var box = K.clear($('tiles'));
        box.hidden = !model.installed || !model.gateways.length;
        if (box.hidden) return;

        var serving = model.gateways.filter(function (g) {
            return g.tone === 'ok';
        }).length;
        var listeners = 0;
        var working = 0;
        model.gateways.forEach(function (g) {
            g.listeners.forEach(function (l) {
                listeners++;
                if (l.tone !== 'error') working++;
            });
        });
        var goodRoutes = model.routes.filter(function (r) {
            return r.tone === 'ok';
        }).length;
        var goodBackends = model.backends.filter(function (b) {
            return b.tone !== 'error';
        }).length;
        var accepted = model.policies.filter(function (p) {
            return p.tone === 'ok';
        }).length;
        var ready = model.proxies.filter(function (p) {
            return p.ready;
        }).length;

        add(
            box,
            tile('Gateways serving', 'gateway', serving, model.gateways.length, ratioTone(serving, model.gateways.length), function () {
                open({ kind: E.KINDS.gateways });
            }),
            tile('Listeners working', 'listener', working, listeners, ratioTone(working, listeners), function () {
                openView('map');
            }),
            tile('Routes attached', 'route', goodRoutes, model.routes.length, ratioTone(goodRoutes, model.routes.length), function () {
                openView('map');
            }, 'Routes accepted by their Gateway, with every backend found'),
            tile('Backends reachable', 'backend', goodBackends, model.backends.length, ratioTone(goodBackends, model.backends.length), function () {
                openView('map');
            }, 'Backends that exist and have a ready endpoint'),
            tile('Policies accepted', 'shield', accepted, model.policies.length, model.policies.length ? ratioTone(accepted, model.policies.length) : 'muted', function () {
                openView('policies');
            }),
            tile('Proxies ready', 'pod', ready, model.proxies.length, ratioTone(ready, model.proxies.length), function () {
                openView('proxies');
            }),
        );
    }

    // ----- the gateways -------------------------------------------------------------

    function drawGateways(model) {
        var block = $('gateways-block');
        block.hidden = !model.gateways.length;
        if (block.hidden) return;
        K.clear($('gateways-head')).appendChild(K.heading('Gateways', 'gateway', model.gateways.length));
        var box = K.clear($('gateways'));
        var order = { error: 0, warn: 1, info: 2, ok: 3, muted: 4 };
        model.gateways
            .slice()
            .sort(function (a, b) {
                return order[a.tone] - order[b.tone] || a.name.localeCompare(b.name);
            })
            .forEach(function (g) {
                box.appendChild(P.gatewayCard(g, { open: open, map: trace }));
            });
    }

    // ----- what needs attention, and what has happened -----------------------------

    function drawAttention(model) {
        var box = K.clear($('attention'));
        var shown = model.findings.filter(function (f) {
            return f.tone !== 'info';
        });
        var info = model.findings.length - shown.length;
        box.appendChild(K.heading('Needs attention', 'alert', shown.length));
        if (!shown.length) {
            var ok = el('div', 'all-clear');
            add(ok, K.icon('check'), el('span', '', model.gateways.length ? 'Nothing is standing in the way of traffic.' : 'Nothing to report.'));
            box.appendChild(ok);
        }
        var list = el('ul', 'issues');
        shown.slice(0, 12).forEach(function (f) {
            var li = el('li', '');
            var item = el('button', 'issue ' + f.tone);
            item.type = 'button';
            var body = el('div', '');
            add(body, el('div', 'issue-title', f.title), f.detail ? el('div', 'issue-detail', f.detail) : null);
            add(item, K.icon(K.TONE_ICON[f.tone]), body);
            if (f.ref) {
                item.title = 'Open it';
                item.addEventListener('click', function () {
                    open(f.ref);
                });
            } else item.disabled = true;
            li.appendChild(item);
            list.appendChild(li);
        });
        box.appendChild(list);
        if (shown.length > 12) box.appendChild(el('p', 'faint small', 'And ' + (shown.length - 12) + ' more — the Traffic map shows every one in place.'));
        if (info) box.appendChild(el('p', 'faint small', E.plural(info, 'note') + ' on the map, such as listeners with no routes.'));
    }

    function eventRef(e) {
        var o = e.involvedObject || {};
        var route = E.ROUTES.filter(function (r) {
            return r.kind === o.kind;
        })[0];
        var policy = E.POLICIES.filter(function (p) {
            return p.kind === o.kind;
        })[0];
        var kind = o.kind === 'Gateway' ? E.KINDS.gateways : route ? route.appKind : policy ? policy.appKind : '';
        return kind ? { kind: kind, namespace: o.namespace || '', name: o.name } : null;
    }

    function loadEvents(model) {
        var namespaces = {};
        model.gateways.concat(model.routes, model.policies).forEach(function (o) {
            namespaces[o.namespace] = true;
        });
        model.proxies.concat(model.controller).forEach(function (p) {
            namespaces[p.namespace] = true;
        });
        var list = Object.keys(namespaces).slice(0, 20);
        return Promise.all(
            list.map(function (ns) {
                return sdk.list({ kind: E.KINDS.events, namespace: ns }).catch(function () {
                    return [];
                });
            }),
        ).then(function (lists) {
            var all = [];
            lists.forEach(function (l) {
                all = all.concat(l);
            });
            return all
                .filter(function (e) {
                    var o = e.involvedObject || {};
                    if (EVENT_KINDS.indexOf(o.kind) >= 0) return true;
                    // The proxies' and the controller's own pods.
                    return o.kind === 'Pod' && /^envoy-/.test(o.name || '');
                })
                .map(function (e) {
                    return { e: e, at: e.lastTimestamp || e.eventTime || (e.metadata && e.metadata.creationTimestamp) || '' };
                })
                .sort(function (a, b) {
                    return a.at < b.at ? 1 : -1;
                })
                .slice(0, 10);
        });
    }

    function drawActivity() {
        var box = K.clear($('activity'));
        box.appendChild(K.heading('Recent events', 'clock'));
        var events = state.events;
        if (!events) {
            box.appendChild(el('p', 'faint small', 'Reading…'));
            return;
        }
        if (!events.length) {
            box.appendChild(el('p', 'faint small', 'Nothing lately.'));
            return;
        }
        var list = el('ul', 'events');
        events.forEach(function (x) {
            var e = x.e;
            var o = e.involvedObject || {};
            var li = el('li', 'event');
            var what = el('span', 'what');
            add(what, el('b', '', e.reason || ''), ' ', o.kind + ' ' + o.name, e.message ? ' — ' + e.message : '');
            var when = K.moment(x.at);
            var stamp = el('span', 'when', when.text);
            stamp.title = when.title;
            add(li, K.dot(e.type === 'Warning' ? 'warn' : 'muted'), stamp, what);
            li.title = K.dateTime(x.at, { seconds: true }) + '\n' + (e.message || '') + (e.count > 1 ? ' (' + e.count + ' times)' : '');
            var ref = eventRef(e);
            if (ref) {
                li.style.cursor = 'pointer';
                li.addEventListener('click', function () {
                    open(ref);
                });
            }
            list.appendChild(li);
        });
        box.appendChild(list);
    }

    // ----- traffic, from Prometheus ------------------------------------------------

    function drawTraffic() {
        var box = K.clear($('traffic'));
        var panel = state.charts;
        box.hidden = !panel || !panel.attached || !state.model || !state.model.gateways.length;
        if (box.hidden) return;
        box.appendChild(K.heading('Traffic, last hour', 'bolt'));
        if (!panel.source || !panel.source.available) {
            box.appendChild(
                el(
                    'p',
                    'faint small',
                    'No Prometheus was found in this cluster, so there is no traffic to draw. Set one in the cluster’s settings in the sidebar, and scrape the Envoy proxies, to see requests, errors and latency here.',
                ),
            );
            return;
        }
        var grid = el('div', 'charts');
        panel.charts.forEach(function (c) {
            grid.appendChild(K.chart(c));
        });
        box.appendChild(grid);
        box.appendChild(el('p', 'faint small', 'From ' + panel.source.describe + '.'));
    }

    function drawFoot(model) {
        var foot = K.clear($('foot'));
        foot.hidden = !model.installed;
        if (foot.hidden) return;
        if (model.version) foot.appendChild(el('span', '', 'Envoy Gateway ' + model.version));
        if (model.controller.length) {
            var ready = model.controller.filter(function (p) {
                return p.ready;
            }).length;
            add(foot, K.link('Controller ' + ready + '/' + model.controller.length + ' ready', function () {
                openView('controller');
            }, 'Envoy Gateway’s own pods'));
        }
        model.classes.forEach(function (c) {
            foot.appendChild(
                K.link('GatewayClass ' + c.name, function () {
                    open(c.ref);
                }, 'Open the GatewayClass'),
            );
        });
        (state.ctx.plugin && state.ctx.plugin.links ? state.ctx.plugin.links : []).slice(0, 2).forEach(function (l) {
            foot.appendChild(K.link(l.label, function () {
                sdk.openUrl(l.url);
            }));
        });
    }

    function drawNotInstalled() {
        var hero = K.clear($('hero'));
        hero.className = 'hero muted';
        var mark = el('div', 'hero-mark');
        mark.appendChild(K.icon('gateway'));
        var text = el('div', '');
        add(
            text,
            el('h1', '', 'Envoy Gateway is not in this cluster'),
            el('p', '', 'No GatewayClass names Envoy Gateway as its controller, and its custom resources are not installed. Install it with Helm, then create a GatewayClass and a Gateway.'),
        );
        var actions = el('div', 'hero-actions');
        actions.appendChild(K.button('Installation guide', 'open', function () {
            sdk.openUrl('https://gateway.envoyproxy.io/docs/install/');
        }));
        text.appendChild(actions);
        add(hero, mark, text);
        ['tiles', 'gateways-block', 'columns', 'traffic', 'foot'].forEach(function (id) {
            $(id).hidden = true;
        });
    }

    // ----- the loop ---------------------------------------------------------------------

    function draw() {
        var model = state.model;
        if (!model.installed) {
            drawNotInstalled();
            return;
        }
        drawHero(model);
        drawTiles(model);
        drawGateways(model);
        $('columns').hidden = false;
        drawAttention(model);
        drawActivity();
        drawTraffic();
        drawFoot(model);
    }

    function poll() {
        return E.load(sdk)
            .then(function (raw) {
                var model = E.build(raw);
                clearError();
                var sig = E.signature(model);
                state.model = model;
                if (sig !== state.sig) {
                    state.sig = sig;
                    draw();
                }
            })
            .catch(fail);
    }

    function pollCharts() {
        return sdk
            .charts({ minutes: CHART_MINUTES })
            .then(function (panel) {
                state.charts = panel;
                if (state.model) drawTraffic();
            })
            .catch(function () {
                state.charts = null;
            });
    }

    function pollEvents() {
        if (!state.model || !state.model.installed) return Promise.resolve();
        return loadEvents(state.model).then(function (events) {
            state.events = events;
            drawActivity();
        });
    }

    sdk.ready()
        .then(function (ctx) {
            state.ctx = ctx;
            return poll();
        })
        .then(function () {
            pollEvents();
            pollCharts();
            setInterval(poll, POLL);
            setInterval(pollEvents, EVENTS_EVERY);
            // Times follow the app's date and time settings as they change.
            sdk.on('datetime', drawActivity);
            setInterval(pollCharts, CHARTS_EVERY);
        })
        .catch(fail);
})();
