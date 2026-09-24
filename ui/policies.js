// Every Envoy Gateway policy in the cluster, by what it is for: what it is
// attached to, whether Envoy Gateway accepted it, and what it actually does,
// in words rather than as a spec to read.
(function () {
    'use strict';

    var sdk = window.k8sdockside;
    var E = window.EnvoyGateway;
    var K = window.EnvoyKit;
    var P = window.EnvoyParts;
    var el = K.el;
    var add = K.add;

    var POLL = 10000;
    var state = { model: null, sig: '', type: '', query: '', problems: false };

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

    function wanted(p) {
        if (state.type && p.type.key !== state.type) return false;
        if (state.problems && p.tone === 'ok') return false;
        if (!state.query) return true;
        var q = state.query;
        var hay = [p.name, p.namespace, p.type.label]
            .concat(p.summary)
            .concat(
                p.targets.map(function (t) {
                    return t.kind + ' ' + t.name;
                }),
            )
            .join(' ')
            .toLowerCase();
        return hay.indexOf(q) >= 0;
    }

    function drawFilters(model) {
        var nav = K.clear($('filters'));
        function filter(key, label, n, iconName) {
            var b = el('button', 'filter' + (state.type === key ? ' on' : ''));
            b.type = 'button';
            add(b, iconName ? K.icon(iconName) : null, el('span', '', label), el('span', 'n', String(n)));
            b.addEventListener('click', function () {
                state.type = state.type === key ? '' : key;
                draw();
            });
            return b;
        }
        nav.appendChild(filter('', 'All', model.policies.length));
        E.POLICIES.forEach(function (pk) {
            var n = model.policies.filter(function (p) {
                return p.type.key === pk.key;
            }).length;
            nav.appendChild(filter(pk.key, pk.label, n, pk.icon));
        });
    }

    function draw() {
        var model = state.model;
        var bad = model.policies.filter(function (p) {
            return p.tone !== 'ok';
        }).length;
        $('where').textContent = model.installed
            ? E.plural(model.policies.length, 'policy', 'policies') + (bad ? ' · ' + bad + ' need a look' : ' · every one accepted')
            : 'Envoy Gateway is not in this cluster';
        drawFilters(model);

        var groups = K.clear($('groups'));
        if (!model.policies.length) {
            groups.appendChild(
                K.empty(
                    'No policies yet',
                    'Policies add what the Gateway API leaves out — rate limits, retries, timeouts, authentication, CORS. Attach one to a Gateway for every route on it, or to a single route.',
                    'shield',
                ),
            );
            return;
        }
        var shown = 0;
        E.POLICIES.forEach(function (pk) {
            var list = model.policies.filter(function (p) {
                return p.type.key === pk.key && wanted(p);
            });
            if (!list.length) return;
            shown += list.length;
            var section = el('section', 'policy-group');
            var head = el('div', 'policy-group-head');
            var h = el('h2', '');
            add(h, K.icon(pk.icon), el('span', '', pk.label), el('span', 'faint', String(list.length)));
            add(head, h, el('span', 'about', pk.about));
            section.appendChild(head);
            var grid = el('div', 'policies');
            var order = { error: 0, warn: 1, info: 2, ok: 3 };
            list.sort(function (a, b) {
                return order[a.tone] - order[b.tone] || a.name.localeCompare(b.name);
            }).forEach(function (p) {
                grid.appendChild(P.policyCard(p, open));
            });
            section.appendChild(grid);
            groups.appendChild(section);
        });
        if (!shown) groups.appendChild(el('p', 'faint', 'No policy matches.'));
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

    $('mark').appendChild(K.icon('shield'));
    $('query').addEventListener('input', function (e) {
        state.query = e.target.value.trim().toLowerCase();
        if (state.model) draw();
    });
    $('problems').addEventListener('change', function (e) {
        state.problems = e.target.checked;
        if (state.model) draw();
    });

    sdk.ready()
        .then(poll)
        .then(function () {
            setInterval(poll, POLL);
        })
        .catch(fail);
})();
