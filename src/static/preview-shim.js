/* Preview only. This copy has no server: photos stay on your device and sending a form
   shows a notice instead. Nothing is ever sent to Johnny B Home Construction from here. */
(function () {
  var realFetch = window.fetch;
  window.fetch = function (url, opts) {
    var u = String(url);
    if (u.indexOf('/api/hit') >= 0) return Promise.resolve(new Response(null, { status: 204 }));
    if (u.indexOf('/api/request') >= 0) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve(new Response(JSON.stringify({ ok: false, error: 'preview', message: 'This is a preview of the new website, so nothing was sent. On the live website, this button sends your request to the office.' }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
        }, 600);
      });
    }
    return realFetch.apply(this, arguments);
  };
  try { navigator.sendBeacon = function () { return true; }; } catch (e) { /* ignore */ }
  // photo "uploads" only show the progress ring here; the photos never leave your device
  function FakeXHR() { this.upload = {}; this.status = 0; this.readyState = 0; this.responseText = ''; this.timeout = 0; }
  FakeXHR.prototype.open = function () { this.readyState = 1; };
  FakeXHR.prototype.setRequestHeader = function () {};
  FakeXHR.prototype.abort = function () { this._aborted = true; if (this.onabort) this.onabort(); };
  FakeXHR.prototype.send = function () {
    var x = this, t = 0;
    var tick = setInterval(function () {
      if (x._aborted) { clearInterval(tick); return; }
      t += 1;
      if (x.upload.onprogress) x.upload.onprogress({ lengthComputable: true, loaded: t, total: 10 });
      if (t >= 10) {
        clearInterval(tick);
        var hex = ''; for (var i = 0; i < 24; i++) hex += '0123456789abcdef'[Math.floor(Math.random() * 16)];
        x.status = 200; x.readyState = 4;
        x.responseText = JSON.stringify({ ok: true, token: 'u' + hex });
        if (x.onload) x.onload();
      }
    }, 110);
  };
  window.XMLHttpRequest = FakeXHR;

  // colour scheme previews (the Preview links in the admin demo), done here instead of on a server
  var SCHEMES = {"charcoal":{"css":":root{--accent:#2a2724;--accent-2:#45403b;--accent-rgb:42 39 36;--accent-soft:#d6d0c8;--accent-tint:#ebe7e1;--accent-mark:#8c8378;--dark:#171513;--dark-text:#ddd7cf;--dark-muted:#a8a196;--paper:#faf9f7;--paper-2:#f0eeea;}","theme":"#faf9f7"},"navy":{"css":":root{--accent:#1f3b5c;--accent-2:#162b44;--accent-rgb:31 59 92;--accent-soft:#c8d5e4;--accent-tint:#e2e9f1;--accent-mark:#7d98b5;--dark:#111c29;--dark-text:#d9dfe6;--dark-muted:#9ba8b7;--paper:#f9f9f8;--paper-2:#eef0f2;}","theme":"#f9f9f8"},"bay":{"css":":root{--accent:#1b5a80;--accent-2:#134462;--accent-rgb:27 90 128;--accent-soft:#cfe2ef;--accent-tint:#e0edf5;--accent-mark:#6b9fc0;--dark:#0f2231;--dark-text:#d7e1e8;--dark-muted:#97aab8;--paper:#f9f9f8;--paper-2:#edf1f3;}","theme":"#f9f9f8"},"forest":{"css":":root{--accent:#2d5a40;--accent-2:#21452f;--accent-rgb:45 90 64;--accent-soft:#cde0d2;--accent-tint:#e1ebe3;--accent-mark:#7ba287;--dark:#12221a;--dark-text:#d8e0da;--dark-muted:#9cab9f;--paper:#f9f9f6;--paper-2:#eef0ea;}","theme":"#f9f9f6"},"slate":{"css":":root{--accent:#3a4753;--accent-2:#2a343e;--accent-rgb:58 71 83;--accent-soft:#d2d9df;--accent-tint:#e5e9ec;--accent-mark:#8b98a3;--dark:#151b20;--dark-text:#d9dee2;--dark-muted:#9fa8b0;--paper:#f9f9f8;--paper-2:#eef0f1;}","theme":"#f9f9f8"},"cranberry":{"css":":root{--accent:#8a2846;--accent-2:#6c1f37;--accent-rgb:138 40 70;--accent-soft:#e8d4da;--accent-tint:#f1e5e9;--accent-mark:#bf8999;--dark:#1d1215;--dark-text:#eee3e6;--dark-muted:#a8989c;--paper:#f9f9f8;--paper-2:#f2efef;}","theme":"#f9f9f8"},"walnut":{"css":":root{--accent:#5b3f28;--accent-2:#452f1d;--accent-rgb:91 63 40;--accent-soft:#e8dccb;--accent-tint:#efe4d4;--accent-mark:#b48a5e;--dark:#171513;--dark-text:#ddd5ca;--dark-muted:#a8a094;--paper:#faf8f4;--paper-2:#f2ede5;}","theme":"#faf8f4"}};
  var sm = /[?&]scheme=([a-z0-9-]+)/.exec(location.search);
  if (sm && SCHEMES[sm[1]]) {
    var styles = document.querySelectorAll('style');
    for (var i = 0; i < styles.length; i++) {
      if (styles[i].textContent.indexOf(':root{--') === 0) styles[i].textContent = SCHEMES[sm[1]].css;
    }
    var tc = document.querySelector('meta[name="theme-color"]');
    if (tc && SCHEMES[sm[1]].theme) tc.setAttribute('content', SCHEMES[sm[1]].theme);
  }

  // a short note in place of anything that needs the real server
  function toast(text) {
    var old = document.querySelector('.demo-toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.className = 'demo-toast';
    t.setAttribute('role', 'status');
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('is-on'); }, 10);
    setTimeout(function () { t.classList.remove('is-on'); setTimeout(function () { t.remove(); }, 400); }, 4200);
  }
  document.addEventListener('DOMContentLoaded', function () {
    if (sm && sm[1] === 'custom') toast('Custom colors show on the real website. This preview shows the ready-made schemes.');
  });
  document.addEventListener('click', function (e) {
    var off = e.target.closest && e.target.closest('[data-demo-off]');
    if (off) { e.preventDefault(); toast(off.getAttribute('data-demo-off')); }
  }, true);
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!document.body || !document.body.classList.contains('admin')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (f.hasAttribute('data-demo-login')) { location.href = 'admin.html'; return; }
    if (f.hasAttribute('data-demo-logout')) { location.href = 'index.html'; return; }
    if ((f.getAttribute('method') || 'get').toLowerCase() === 'get') { toast('Search and filters work on the real admin.'); return; }
    toast('Demo only, so nothing was saved. On the real admin this button saves your change.');
  }, true);
  window.__previewToast = toast;
})();
