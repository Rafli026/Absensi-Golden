/* Hide demo credentials card unless the server explicitly reports demo_mode.
   Fail-open on network/API errors so development is never blocked. */
fetch('/api/public/config', { headers: { Accept: 'application/json' } })
  .then(function (r) {
    if (!r.ok) throw new Error('config unavailable');
    return r.json();
  })
  .then(function (cfg) {
    if (cfg && cfg.demo_mode) return;
    var el = document.getElementById('demo-card');
    if (el) el.remove();
  })
  .catch(function () { /* keep card if config unavailable */ });
