// The panel on an HTTP or gRPC route: which Gateways accepted it and which
// did not, and why; each rule as what it matches and where it sends it; and
// the policies attached.
(function () {
    'use strict';

    var X = window.EnvoyPanel;
    var E = window.EnvoyGateway;
    var K = window.EnvoyKit;
    var P = window.EnvoyParts;
    var el = K.el;
    var add = K.add;

    function find(model, object) {
        var kind = E.ROUTES.filter(function (r) {
            return r.appKind === object.kind;
        })[0];
        return model.routes.filter(function (r) {
            return (!kind || r.type.kind === kind.kind) && r.namespace === object.namespace && r.name === object.name;
        })[0] || null;
    }

    function fingerprint(r) {
        return [
            r.tone,
            r.hostnames,
            r.parents.map(function (p) {
                return [p.name, p.tone, p.says];
            }),
            r.rules.map(function (x) {
                return [x.matches, x.filters, x.backends.map(function (b) { return [b.backend.key, b.backend.tone, b.backend.says, b.weight]; })];
            }),
            r.policies.map(function (p) {
                return [p.key, p.tone];
            }),
        ];
    }

    function draw(root, r, model) {
        if (!r) {
            root.appendChild(
                el('p', 'faint', model.installed ? 'This route is not attached to a Gateway Envoy Gateway serves.' : 'Envoy Gateway is not in this cluster.'),
            );
            return;
        }
        var parents = el('div', 'parents');
        r.parents.forEach(function (p) {
            var row = el('div', 'parent');
            add(
                row,
                K.icon('gateway'),
                p.gateway
                    ? K.link(p.namespace + '/' + p.name + (p.sectionName ? ' · ' + p.sectionName : ''), function () {
                          X.open(p.gateway.ref);
                      }, 'Open the Gateway')
                    : el('span', '', p.namespace + '/' + p.name),
                K.pill(p.tone, p.says),
            );
            if (p.gateway && p.gateway.addresses.length) row.appendChild(el('span', 'address', p.gateway.addresses[0]));
            parents.appendChild(row);
            if (p.message) parents.appendChild(el('p', 'says ' + (p.tone === 'error' ? 'error' : 'warn'), p.message));
        });
        root.appendChild(parents);

        var hosts = X.section({ id: 'hosts', title: 'Hosts', count: r.hostnames.length || undefined, what: 'the hosts' });
        hosts.root.style.marginTop = '10px';
        var names = el('div', 'panel-row');
        if (r.hostnames.length) {
            r.hostnames.forEach(function (h) {
                names.appendChild(K.chip(h, 'mono'));
            });
        } else names.appendChild(el('span', 'small', 'every host the listener accepts'));
        hosts.body.appendChild(names);
        root.appendChild(hosts.root);

        root.appendChild(P.rulesView(r, X.open));

        if (r.policies.length) {
            var pol = X.section({ id: 'policies', title: 'Policies', count: r.policies.length, what: 'the policies' }, 'panel-row');
            pol.root.style.marginTop = '10px';
            add(pol.body, P.policyChips(r.policies, X.open));
            root.appendChild(pol.root);
        }
    }

    X.start(find, draw, fingerprint);
})();
