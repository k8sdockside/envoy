// The drawing kit the pages share: elements, icons, status pills, the numbers
// and units the charts write, and a small line chart.
//
// Everything that came from the cluster is written with textContent, never
// innerHTML: the frame is sandboxed, but a page that let a route's name run as
// markup would be handing that name the bridge.
(function () {
    'use strict';

    var SVG = 'http://www.w3.org/2000/svg';

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function add(parent) {
        for (var i = 1; i < arguments.length; i++) {
            var child = arguments[i];
            if (child === null || child === undefined || child === false) continue;
            if (Array.isArray(child)) {
                child.forEach(function (c) {
                    add(parent, c);
                });
                continue;
            }
            parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        }
        return parent;
    }

    function svg(tag, attrs) {
        var node = document.createElementNS(SVG, tag);
        Object.keys(attrs || {}).forEach(function (k) {
            node.setAttribute(k, attrs[k]);
        });
        return node;
    }

    function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
        return node;
    }

    // Single-stroke icons on a 24-unit grid, in the app's own style.
    var ICONS = {
        gateway: ['M3 21V9l9-6 9 6v12', 'M8 21v-7h8v7', 'M3 21h18'],
        listener: ['M5 12h3', 'M16 12h3', 'M12 5v3', 'M12 16v3', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
        route: ['M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M8 17h5a3 3 0 0 0 3-3v-3', 'M16 7h-5a3 3 0 0 0-3 3v5'],
        backend: ['M4 5h16v5H4z', 'M4 14h16v5H4z', 'M8 7.5h.01', 'M8 16.5h.01'],
        shield: ['M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z', 'M9 12l2 2 4-4'],
        gauge: ['M4 15a8 8 0 1 1 16 0', 'M12 15l4-4', 'M12 15h.01'],
        client: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'],
        puzzle: ['M10 4h4v3a1.5 1.5 0 0 0 3 0V4h3v6h-3a1.5 1.5 0 0 0 0 3h3v7h-6v-3a1.5 1.5 0 0 0-3 0v3H4v-7h3a1.5 1.5 0 0 0 0-3H4V4h6z'],
        patch: ['M14 4l6 6-10 10H4v-6z', 'M12 6l6 6'],
        check: ['M5 12.5l4.5 4.5L19 7.5'],
        alert: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17h.01'],
        info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
        lock: ['M6 11h12v9H6z', 'M9 11V8a3 3 0 0 1 6 0v3'],
        pod: ['M20 8 12 4 4 8v8l8 4 8-4V8z', 'M4 8l8 4 8-4', 'M12 12v8'],
        open: ['M14 5h5v5', 'M19 5l-8 8', 'M18 14v5H5V6h5'],
        map: ['M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z', 'M9 4v14', 'M15 6v14'],
        search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
        globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
        clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
        bolt: ['M13 3L5 14h6l-1 7 8-11h-6z'],
        close: ['M6 6l12 12', 'M18 6L6 18'],
        arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
        logs: ['M5 6h14', 'M5 10h14', 'M5 14h9', 'M5 18h6'],
    };

    function icon(name, className) {
        var node = svg('svg', { viewBox: '0 0 24 24', class: 'ico' + (className ? ' ' + className : ''), 'aria-hidden': 'true' });
        (ICONS[name] || ICONS.info).forEach(function (d) {
            node.appendChild(svg('path', { d: d }));
        });
        return node;
    }

    var TONE_ICON = { ok: 'check', warn: 'alert', error: 'alert', info: 'info', muted: 'info' };

    /** A status pill: a coloured dot and a few words. */
    function pill(tone, text, title) {
        var node = el('span', 'pill ' + (tone || 'muted'));
        add(node, el('span', 'dot'), el('span', '', text));
        if (title) node.title = title;
        return node;
    }

    function dot(tone, title) {
        var node = el('span', 'dot ' + (tone || 'muted'));
        if (title) node.title = title;
        return node;
    }

    /** A button that reads as a link, for opening an object. */
    function link(text, onClick, title, className) {
        var node = el('button', 'link' + (className ? ' ' + className : ''), text);
        node.type = 'button';
        if (title) node.title = title;
        node.addEventListener('click', function (e) {
            e.stopPropagation();
            onClick();
        });
        return node;
    }

    function button(text, iconName, onClick, className) {
        var node = el('button', className || '');
        node.type = 'button';
        add(node, iconName ? icon(iconName) : null, text ? el('span', '', text) : null);
        node.addEventListener('click', onClick);
        return node;
    }

    function chip(text, className, title) {
        var node = el('span', 'chip' + (className ? ' ' + className : ''), text);
        if (title) node.title = title;
        return node;
    }

    /** A heading for a block of the page, with an icon and an optional count. */
    function heading(text, iconName, count) {
        var node = el('h2', 'heading');
        add(node, iconName ? icon(iconName) : null, el('span', '', text));
        if (count !== undefined && count !== null) node.appendChild(el('span', 'count', String(count)));
        return node;
    }

    function empty(title, text, iconName) {
        var node = el('div', 'empty');
        add(node, icon(iconName || 'gateway', 'big'), el('h3', '', title), text ? el('p', 'faint', text) : null);
        return node;
    }

    // Dates and times are written the way the user chose in the app's
    // settings, through the bridge's format helpers, so this plugin's times
    // read like the app's. An app older than 0.1.10 has none, and these fall
    // back to the locale's own.
    function fmt() {
        return (window.k8sdockside && window.k8sdockside.format) || null;
    }

    /** A date and time, as the user likes them written. */
    function dateTime(timestamp, opts) {
        if (!timestamp) return '';
        var f = fmt();
        if (f) return f.dateTime(timestamp, opts);
        return new Date(timestamp).toLocaleString();
    }

    /** A date, as the user likes them written. */
    function date(timestamp) {
        if (!timestamp) return '';
        var f = fmt();
        if (f) return f.date(timestamp);
        return new Date(timestamp).toLocaleDateString();
    }

    /**
     * A moment as the app's tables show one -- how long ago, or the moment
     * itself when the user chose that -- with the other form as the title.
     */
    function moment(timestamp) {
        if (!timestamp) return { text: '', title: '' };
        var f = fmt();
        if (f && f.moment) return f.moment(timestamp);
        return { text: age(timestamp), title: new Date(timestamp).toLocaleString() };
    }

    function age(timestamp) {
        if (!timestamp) return '';
        var f = fmt();
        if (f) return f.age(timestamp);
        var s = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000));
        if (s < 60) return s + 's';
        var m = Math.round(s / 60);
        if (m < 60) return m + 'm';
        var h = Math.round(m / 60);
        if (h < 48) return h + 'h';
        return Math.round(h / 24) + 'd';
    }

    // ----- numbers ---------------------------------------------------------------

    function trim(n) {
        if (Math.abs(n) >= 100) return n.toFixed(0);
        if (Math.abs(n) >= 10) return n.toFixed(1).replace(/\.0$/, '');
        return n.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
    }

    /** A value as the chart's unit says to write it. */
    function format(v, unit) {
        if (v === null || v === undefined || isNaN(v)) return '—';
        switch (unit) {
            case 'percent':
                return trim(v * 100) + '%';
            case 'seconds':
                if (v < 1) return trim(v * 1000) + ' ms';
                return trim(v) + ' s';
            case 'ops/s':
                if (v >= 1000) return trim(v / 1000) + 'k/s';
                return trim(v) + '/s';
            case 'bytes':
            case 'bytes/s': {
                var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
                var i = 0;
                while (Math.abs(v) >= 1024 && i < units.length - 1) {
                    v /= 1024;
                    i++;
                }
                return trim(v) + ' ' + units[i] + (unit === 'bytes/s' ? '/s' : '');
            }
            default:
                if (Math.abs(v) >= 1e6) return trim(v / 1e6) + 'M';
                if (Math.abs(v) >= 1e3) return trim(v / 1e3) + 'k';
                return trim(v);
        }
    }

    var FALLBACK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

    function color(i) {
        var n = Math.min(i, 7);
        return 'var(--chart-' + (n + 1) + ', ' + FALLBACK[n] + ')';
    }

    // Response classes wear the colours of what they mean, whatever order the
    // series arrive in.
    var CLASS_COLORS = { '2': 'var(--ok, #5fd39b)', '3': 'var(--chart-1, #3987e5)', '4': 'var(--warn, #efb567)', '5': 'var(--error, #f4787f)' };
    var CLASS_NAMES = { '1': '1xx', '2': '2xx success', '3': '3xx redirect', '4': '4xx client error', '5': '5xx server error' };

    /**
     * One chart from the bridge's charts(), drawn as lines on a small SVG,
     * with the latest value of each series written out in the legend.
     */
    function chart(c, opts) {
        opts = opts || {};
        var box = el('figure', 'chart');
        var head = el('figcaption', 'chart-head');
        var title = el('span', 'chart-title', c.label);
        if (c.description) title.title = c.description;
        head.appendChild(title);
        box.appendChild(head);

        var series = (c.series || []).filter(function (s) {
            return s.points && s.points.length;
        });
        if (c.error || !series.length) {
            box.classList.add('quiet');
            box.appendChild(el('p', 'chart-empty faint', c.error ? 'Could not be read: ' + c.error : 'No data yet'));
            return box;
        }

        var classes = opts.byClass || /response_code_class/.test(c.id || '') || series.every(function (s) {
            return /^[1-5]$/.test(s.name);
        });
        var W = 320;
        var H = 96;
        var tMin = Infinity;
        var tMax = -Infinity;
        var vMax = 0;
        series.forEach(function (s) {
            s.points.forEach(function (p) {
                if (p.t < tMin) tMin = p.t;
                if (p.t > tMax) tMax = p.t;
                if (p.v > vMax) vMax = p.v;
            });
        });
        if (tMax === tMin) tMax = tMin + 1;
        if (vMax === 0) vMax = 1;

        var plot = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', class: 'chart-plot', role: 'img' });
        plot.setAttribute('aria-label', c.label);
        [0.25, 0.5, 0.75].forEach(function (f) {
            plot.appendChild(svg('line', { x1: 0, x2: W, y1: H * f, y2: H * f, class: 'chart-grid' }));
        });

        var legend = el('div', 'chart-legend');
        series.slice(0, 8).forEach(function (s, i) {
            var stroke = classes && CLASS_COLORS[s.name] ? CLASS_COLORS[s.name] : color(i);
            var d = s.points
                .map(function (p, j) {
                    var x = ((p.t - tMin) / (tMax - tMin)) * W;
                    var y = H - (p.v / vMax) * (H - 4) - 2;
                    return (j ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
                })
                .join(' ');
            plot.appendChild(svg('path', { d: d, class: 'chart-line', style: 'stroke:' + stroke }));

            var last = s.points[s.points.length - 1].v;
            var item = el('span', 'chart-key');
            var swatch = el('span', 'swatch');
            swatch.style.background = stroke;
            var name = classes && CLASS_NAMES[s.name] ? CLASS_NAMES[s.name] : s.name || c.label;
            add(item, swatch, el('span', 'chart-name', name), el('span', 'chart-value', format(last, c.unit)));
            item.title = name + ': ' + format(last, c.unit) + ' now';
            legend.appendChild(item);
        });

        var frame = el('div', 'chart-frame');
        frame.appendChild(plot);
        frame.appendChild(el('span', 'chart-max faint', format(vMax, c.unit)));
        box.appendChild(frame);
        box.appendChild(legend);
        return box;
    }

    window.EnvoyKit = {
        el: el,
        add: add,
        svg: svg,
        clear: clear,
        icon: icon,
        TONE_ICON: TONE_ICON,
        pill: pill,
        dot: dot,
        link: link,
        button: button,
        chip: chip,
        heading: heading,
        empty: empty,
        age: age,
        date: date,
        dateTime: dateTime,
        moment: moment,
        format: format,
        color: color,
        chart: chart,
    };
})();
