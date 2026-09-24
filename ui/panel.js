// What the three detail-view panels share: finding the section's object in
// the model, and redrawing only when what the model says about it changes.
(function () {
    'use strict';

    var sdk = window.k8sdockside;
    var E = window.EnvoyGateway;
    var K = window.EnvoyKit;

    var POLL = 10000;

    function fail(err) {
        var box = document.getElementById('error');
        box.textContent = (err && err.message) || String(err);
        box.hidden = false;
    }

    /**
     * Starts a panel: reads the model now and on a timer, finds the object the
     * section is drawn for with find(model, object), and calls draw(root,
     * found, model) whenever what was found changes. found is null when the
     * model has no such object -- a Gateway of another controller's class.
     */
    function start(find, draw, fingerprint) {
        var last = null;
        sdk.ready()
            .then(function (ctx) {
                var object = ctx.object;
                function poll() {
                    return E.load(sdk)
                        .then(function (raw) {
                            var model = E.build(raw);
                            document.getElementById('error').hidden = true;
                            var found = find(model, object);
                            var sig = JSON.stringify([found ? fingerprint(found) : null, model.installed]);
                            if (sig === last) return;
                            last = sig;
                            draw(K.clear(document.getElementById('root')), found, model, object);
                        })
                        .catch(fail);
                }
                return poll().then(function () {
                    setInterval(poll, POLL);
                });
            })
            .catch(fail);
    }

    function open(ref) {
        sdk.open(ref).catch(fail);
    }

    window.EnvoyPanel = { start: start, open: open, fail: fail, sdk: sdk, E: E };
})();
