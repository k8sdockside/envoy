// The pieces more than one page draws: a Gateway's card, the policy chips on
// anything a policy is attached to, a route's rules as match -> backends, and
// a policy's card. Drawn the same way wherever they appear, so a Gateway looks
// like itself on the overview, on the map and in its own detail view.
(function () {
    'use strict';

    var E = window.EnvoyGateway;
    var K = window.EnvoyKit;
    var el = K.el;
    var add = K.add;

    function plural(n, one, many) {
        return E.plural(n, one, many);
    }

    /** The chips for the policies attached to something, each opening its policy. */
    function policyChips(policies, open) {
        return policies.map(function (p) {
            var chip = el('button', 'chip pchip ' + p.type.key + (p.tone === 'error' ? ' bad' : ''));
            chip.type = 'button';
            add(chip, K.icon(p.type.icon), el('span', '', p.name));
            chip.title = p.type.label + ' policy — ' + p.summary.join('; ') + (p.tone !== 'ok' ? ' (' + p.says + ')' : '');
            chip.addEventListener('click', function (e) {
                e.stopPropagation();
                open(p.ref);
            });
            return chip;
        });
    }

    function proxyDots(g) {
        var box = el('span', 'proxies');
        if (!g.proxies.length) {
            box.appendChild(el('span', 'faint', 'No proxy pods found'));
            return box;
        }
        g.proxies.slice(0, 12).forEach(function (p) {
            box.appendChild(K.dot(p.ready ? 'ok' : 'error', p.name + (p.ready ? ' — ready' : ' — not ready')));
        });
        box.appendChild(el('span', '', g.readyProxies + '/' + g.proxies.length + ' proxies ready'));
        return box;
    }

    function listenerRow(l) {
        var row = el('div', 'listener');
        var problem = l.problems[0];
        row.title = problem ? E.words(problem.reason) + (problem.message ? ': ' + problem.message : '') : l.name;
        add(
            row,
            K.dot(l.tone),
            el('span', 'proto', l.protocol + ' ' + l.port),
            el('span', 'host', l.hostname || (l.tlsMode === 'Passthrough' ? 'TLS passthrough' : 'any host')),
            el('span', 'routes-n', l.attached === null ? '' : plural(l.attached, 'route')),
        );
        return row;
    }

    /** A Gateway as a card: its state, addresses, listeners, proxies and policies. */
    function gatewayCard(g, handlers) {
        var card = el('article', 'gw-card ' + g.tone);
        var top = el('div', 'gw-top');
        var names = el('div', '');
        add(names, K.link(g.name, function () {
            handlers.open(g.ref);
        }, 'Open the Gateway', 'gw-name'), el('div', 'gw-sub', g.namespace + ' · class ' + g.className));
        add(top, K.icon('gateway'), names, K.pill(g.tone, g.headline));
        card.appendChild(top);

        var addresses = el('div', 'addresses');
        if (g.addresses.length) {
            g.addresses.forEach(function (a) {
                var chip = el('span', 'address', a);
                chip.title = 'Where clients reach this Gateway';
                addresses.appendChild(chip);
            });
        } else {
            addresses.appendChild(el('span', 'address none', 'no address yet'));
        }
        card.appendChild(addresses);

        var listeners = el('div', 'listeners');
        g.listeners.forEach(function (l) {
            listeners.appendChild(listenerRow(l));
        });
        card.appendChild(listeners);

        var foot = el('div', 'gw-foot');
        foot.appendChild(proxyDots(g));
        add(foot, policyChips(g.policies, handlers.open));
        if (handlers.map) {
            var toMap = K.button('Trace', 'map', function () {
                handlers.map(g);
            }, 'quiet');
            toMap.title = 'Follow this Gateway’s traffic on the map';
            toMap.style.marginLeft = 'auto';
            foot.appendChild(toMap);
        }
        card.appendChild(foot);
        return card;
    }

    /** A route's rules: what each matches, what it does, and where it sends it. */
    function rulesView(route, open) {
        var box = el('div', 'rules');
        if (!route.rules.length) {
            box.appendChild(el('p', 'faint', 'No rules: the route matches nothing.'));
            return box;
        }
        route.rules.forEach(function (rule) {
            var row = el('div', 'rule');
            var matches = el('div', 'rule-matches');
            rule.matches.forEach(function (m) {
                matches.appendChild(el('code', 'rule-match', m));
            });
            rule.filters.forEach(function (f) {
                var line = el('div', 'rule-filter');
                add(line, K.icon('bolt'), el('span', '', f));
                matches.appendChild(line);
            });
            if (rule.timeout) {
                var t = el('div', 'rule-filter');
                add(t, K.icon('clock'), el('span', '', 'Times out after ' + rule.timeout));
                matches.appendChild(t);
            }

            var arrow = el('div', 'rule-arrow');
            arrow.appendChild(K.icon('arrow'));

            var backends = el('div', 'rule-backends');
            if (!rule.backends.length) {
                backends.appendChild(el('span', 'faint small', rule.filters.length ? 'Answered by the filter' : 'No backend'));
            }
            rule.backends.forEach(function (b) {
                var rb = el('div', 'rb');
                var line = el('div', 'rb-line');
                var name = b.backend.kind === 'Service' ? b.backend.name : b.backend.kind + ' ' + b.backend.name;
                add(
                    line,
                    K.dot(b.backend.tone),
                    b.backend.ref
                        ? K.link(name + (b.port ? ':' + b.port : ''), function () {
                              open(b.backend.ref);
                          }, 'Open ' + b.backend.name)
                        : el('span', '', name),
                    rule.backends.length > 1 ? el('span', 'share', Math.round(b.share * 100) + '%') : null,
                );
                rb.appendChild(line);
                if (rule.backends.length > 1) {
                    var bar = el('div', 'rb-bar');
                    var fill = el('span', '');
                    fill.style.width = Math.round(b.share * 100) + '%';
                    bar.appendChild(fill);
                    rb.appendChild(bar);
                }
                if (b.backend.says) rb.appendChild(el('span', 'rb-says ' + b.backend.tone, b.backend.says));
                backends.appendChild(rb);
            });
            add(row, matches, arrow, backends);
            box.appendChild(row);
        });
        return box;
    }

    var TARGET_ICONS = { Gateway: 'gateway', HTTPRoute: 'route', GRPCRoute: 'route', TLSRoute: 'route', TCPRoute: 'route', UDPRoute: 'route' };

    function targetChip(t, open) {
        var label = t.kind + ' ' + t.name + (t.sectionName ? ' · ' + t.sectionName : '');
        if (!t.target) {
            var missing = el('span', 'target missing');
            add(missing, K.icon('alert'), el('span', '', label));
            missing.title = 'Not found, or not served by Envoy Gateway';
            return missing;
        }
        var chip = el('button', 'target');
        chip.type = 'button';
        add(chip, K.icon(TARGET_ICONS[t.kind] || 'route'), el('span', '', label));
        chip.title = 'Open ' + t.kind + ' ' + t.name + (t.selected ? ' (picked by label)' : '');
        chip.addEventListener('click', function () {
            open(t.target.object.ref);
        });
        return chip;
    }

    /** A policy as a card: what it is, what it is attached to, and what it does. */
    function policyCard(p, open) {
        var card = el('article', 'policy ' + p.type.key);
        var top = el('div', 'policy-top');
        var names = el('div', '');
        add(names, K.link(p.name, function () {
            open(p.ref);
        }, 'Open the policy'), el('div', 'policy-ns', p.namespace + ' · ' + p.type.label));
        add(top, K.icon(p.type.icon), names, K.pill(p.tone, p.says, p.message));
        card.appendChild(top);

        var does = el('ul', 'does');
        p.summary.forEach(function (line) {
            does.appendChild(el('li', '', line));
        });
        card.appendChild(does);

        var targets = el('div', 'targets');
        targets.appendChild(el('span', 'faint', 'Applies to'));
        if (!p.targets.length) targets.appendChild(el('span', 'faint', 'nothing'));
        p.targets.forEach(function (t) {
            targets.appendChild(targetChip(t, open));
        });
        card.appendChild(targets);

        p.ancestors.forEach(function (a) {
            a.notes.forEach(function (n) {
                card.appendChild(el('p', 'says warn', a.name + ': ' + n));
            });
        });
        if (p.message && p.tone === 'error') card.appendChild(el('p', 'says error', p.message));
        return card;
    }

    window.EnvoyParts = {
        policyChips: policyChips,
        proxyDots: proxyDots,
        listenerRow: listenerRow,
        gatewayCard: gatewayCard,
        rulesView: rulesView,
        targetChip: targetChip,
        policyCard: policyCard,
    };
})();
