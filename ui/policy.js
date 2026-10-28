// The panel on a policy: what it does in words, what it is attached to, and
// whether Envoy Gateway took it -- for each Gateway it lands on.
(function () {
    'use strict';

    var X = window.EnvoyPanel;
    var E = window.EnvoyGateway;
    var K = window.EnvoyKit;
    var P = window.EnvoyParts;
    var el = K.el;
    var add = K.add;

    function find(model, object) {
        return model.policies.filter(function (p) {
            return p.type.appKind === object.kind && p.namespace === object.namespace && p.name === object.name;
        })[0] || null;
    }

    function fingerprint(p) {
        return [
            p.tone,
            p.says,
            p.summary,
            p.targets.map(function (t) {
                return [t.kind, t.name, !!t.target];
            }),
            p.ancestors.map(function (a) {
                return [a.name, a.accepted && a.accepted.status, a.notes];
            }),
        ];
    }

    function draw(root, p) {
        if (!p) {
            root.appendChild(el('p', 'faint', 'Reading…'));
            return;
        }
        var grid = el('div', 'panel-grid');
        var does = X.section({ id: 'does', title: 'What it does', what: 'what it does' }, 'panel-block policy ' + p.type.key);
        does.body.style.border = '0';
        does.body.style.padding = '0';
        does.body.style.background = 'none';
        var list = el('ul', 'does');
        p.summary.forEach(function (line) {
            list.appendChild(el('li', '', line));
        });
        does.body.appendChild(list);

        var where = el('div', 'panel-block');
        var applies = X.section({ id: 'targets', title: 'Applies to', count: p.targets.length, what: 'what it applies to' });
        var targets = el('div', 'targets');
        if (!p.targets.length) targets.appendChild(el('span', 'faint', 'nothing'));
        p.targets.forEach(function (t) {
            targets.appendChild(P.targetChip(t, X.open));
        });
        applies.body.appendChild(targets);
        var accepted = X.section({ id: 'accepted', title: 'Accepted by', count: p.ancestors.length, what: 'the Gateways' }, 'panel-block');
        if (!p.ancestors.length) accepted.body.appendChild(el('p', 'faint small', 'No Gateway has reported on it yet.'));
        p.ancestors.forEach(function (a) {
            var row = el('div', 'panel-row');
            var ok = a.accepted && a.accepted.status === 'True';
            add(row, K.icon('gateway'), el('span', 'small', a.name), K.pill(ok ? 'ok' : a.accepted ? 'error' : 'warn', ok ? 'Accepted' : a.accepted ? E.words(a.accepted.reason) || 'Not accepted' : 'No status'));
            accepted.body.appendChild(row);
            if (a.accepted && !ok && a.accepted.message) accepted.body.appendChild(el('p', 'says error', a.accepted.message));
            a.notes.forEach(function (n) {
                accepted.body.appendChild(el('p', 'says warn', n));
            });
        });
        add(where, applies.root, accepted.root);
        add(grid, does.root, where);
        root.appendChild(grid);
    }

    X.start(find, draw, fingerprint);
})();
