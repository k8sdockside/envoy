// The panel on a Gateway: whether Envoy Gateway is serving it, where clients
// reach it, each listener with what is attached and what is wrong, the
// proxies doing the work, and the policies shaping its traffic.
(function () {
    'use strict';

    var X = window.EnvoyPanel;
    var E = window.EnvoyGateway;
    var K = window.EnvoyKit;
    var P = window.EnvoyParts;
    var el = K.el;
    var add = K.add;

    function find(model, object) {
        return model.gateways.filter(function (g) {
            return g.namespace === object.namespace && g.name === object.name;
        })[0] || null;
    }

    function fingerprint(g) {
        return [
            g.tone,
            g.headline,
            g.addresses,
            g.readyProxies,
            g.proxies.length,
            g.listeners.map(function (l) {
                return [l.name, l.tone, l.attached, l.routes.length];
            }),
            g.policies.map(function (p) {
                return [p.key, p.tone];
            }),
            g.routes.map(function (r) {
                return [r.key, r.tone];
            }),
        ];
    }

    function listenerTable(g) {
        var table = el('table', 'table');
        var head = el('tr', '');
        ['', 'Listener', 'Port', 'Host', 'TLS', 'Routes'].forEach(function (h) {
            head.appendChild(el('th', '', h));
        });
        table.appendChild(el('thead', '')).appendChild(head);
        var body = el('tbody', '');
        g.listeners.forEach(function (l) {
            var row = el('tr', '');
            var name = el('td', '');
            name.appendChild(el('span', '', l.name));
            l.problems.forEach(function (c) {
                name.appendChild(el('span', 'why', E.words(c.reason) + (c.message ? ': ' + c.message : '')));
            });
            var tls = l.tlsMode ? l.tlsMode + (l.certificates.length ? ' · ' + l.certificates.join(', ') : '') : '—';
            var routes = el('td', 'num');
            if (l.routes.length) {
                l.routes.forEach(function (r, i) {
                    if (i) routes.appendChild(document.createTextNode(', '));
                    routes.appendChild(K.link(r.name, function () {
                        X.open(r.ref);
                    }, 'Open the route'));
                });
            } else routes.textContent = l.attached === null ? '—' : String(l.attached);
            var dotCell = el('td', '');
            dotCell.appendChild(K.dot(l.tone));
            add(row, dotCell, name, el('td', 'num', l.protocol + ' ' + l.port), el('td', '', l.hostname || 'any'), el('td', 'small', tls), routes);
            body.appendChild(row);
        });
        table.appendChild(body);
        return table;
    }

    function draw(root, g, model) {
        if (!g) {
            root.appendChild(
                el(
                    'p',
                    'faint',
                    model.installed
                        ? 'This Gateway’s class is not one of Envoy Gateway’s, so Envoy Gateway does not serve it.'
                        : 'Envoy Gateway is not in this cluster.',
                ),
            );
            return;
        }
        var top = el('div', 'panel-row');
        add(top, K.pill(g.tone, g.headline));
        if (g.addresses.length) {
            g.addresses.forEach(function (a) {
                top.appendChild(el('span', 'address', a));
            });
        } else top.appendChild(el('span', 'address none', 'no address yet'));
        top.appendChild(P.proxyDots(g));
        root.appendChild(top);

        if (g.accepted && g.accepted.status === 'False') root.appendChild(el('p', 'says error', E.words(g.accepted.reason) + ': ' + g.accepted.message));
        else if (g.programmed && g.programmed.status === 'False') root.appendChild(el('p', 'says error', E.words(g.programmed.reason) + ': ' + g.programmed.message));

        root.appendChild(document.createElement('br'));
        root.appendChild(listenerTable(g));

        var grid = el('div', 'panel-grid');
        grid.style.marginTop = '12px';
        var pol = el('div', 'panel-block');
        pol.appendChild(el('p', 'sub-heading', 'Policies'));
        if (g.policies.length) {
            var chips = el('div', 'node-chips');
            add(chips, P.policyChips(g.policies, X.open));
            pol.appendChild(chips);
        } else pol.appendChild(el('p', 'faint small', 'None attached to the Gateway itself; routes may have their own.'));
        var proxies = el('div', 'panel-block');
        proxies.appendChild(el('p', 'sub-heading', 'Proxy pods'));
        if (!g.proxies.length) proxies.appendChild(el('p', 'faint small', 'None found for this Gateway.'));
        g.proxies.slice(0, 6).forEach(function (p) {
            var row = el('div', 'panel-row');
            add(
                row,
                K.dot(p.ready ? 'ok' : 'error'),
                K.link(p.name, function () {
                    X.open(p.ref);
                }, 'Open the pod'),
                p.restarts ? el('span', 'faint small', E.plural(p.restarts, 'restart')) : null,
                K.link('logs', function () {
                    X.sdk.logs(p.ref).catch(X.fail);
                }, 'Open its logs', 'small'),
            );
            proxies.appendChild(row);
        });
        add(grid, pol, proxies);
        root.appendChild(grid);
    }

    X.start(find, draw, fingerprint);
})();
