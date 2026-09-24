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
        var does = el('div', 'panel-block policy ' + p.type.key);
        does.style.border = '0';
        does.style.padding = '0';
        does.style.background = 'none';
        does.appendChild(el('p', 'sub-heading', 'What it does'));
        var list = el('ul', 'does');
        p.summary.forEach(function (line) {
            list.appendChild(el('li', '', line));
        });
        does.appendChild(list);

        var where = el('div', 'panel-block');
        where.appendChild(el('p', 'sub-heading', 'Applies to'));
        var targets = el('div', 'targets');
        if (!p.targets.length) targets.appendChild(el('span', 'faint', 'nothing'));
        p.targets.forEach(function (t) {
            targets.appendChild(P.targetChip(t, X.open));
        });
        where.appendChild(targets);
        where.appendChild(el('p', 'sub-heading', 'Accepted by'));
        if (!p.ancestors.length) where.appendChild(el('p', 'faint small', 'No Gateway has reported on it yet.'));
        p.ancestors.forEach(function (a) {
            var row = el('div', 'panel-row');
            var ok = a.accepted && a.accepted.status === 'True';
            add(row, K.icon('gateway'), el('span', 'small', a.name), K.pill(ok ? 'ok' : a.accepted ? 'error' : 'warn', ok ? 'Accepted' : a.accepted ? E.words(a.accepted.reason) || 'Not accepted' : 'No status'));
            where.appendChild(row);
            if (a.accepted && !ok && a.accepted.message) where.appendChild(el('p', 'says error', a.accepted.message));
            a.notes.forEach(function (n) {
                where.appendChild(el('p', 'says warn', n));
            });
        });
        add(grid, does, where);
        root.appendChild(grid);
    }

    X.start(find, draw, fingerprint);
})();
