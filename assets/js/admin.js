/*
 * Admin behavior: photo viewer, safer delete, settings helpers and the visitor chart.
 * Plain JavaScript. Every admin page works without it.
 */
(function () {
  'use strict';
  var doc = document;
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var NS = 'http://www.w3.org/2000/svg';

  /* ---- "Saved" notices fade away; errors stay until read ---- */
  $$('[data-flash]').forEach(function (f) {
    if (!f.classList.contains('a-flash-ok')) return;
    setTimeout(function () {
      f.style.transition = 'opacity 400ms ease, transform 400ms ease';
      f.style.opacity = '0';
      f.style.transform = 'translateY(-6px)';
      setTimeout(function () { f.remove(); }, 420);
    }, 5000);
  });

  /* ---- filters apply as soon as they change ---- */
  $$('[data-autosubmit]').forEach(function (el) {
    el.addEventListener('change', function () { if (el.form) el.form.submit(); });
  });

  /* ---- show / hide password ---- */
  $$('[data-reveal-password]').forEach(function (btn) {
    var input = doc.getElementById(btn.getAttribute('aria-controls'));
    if (!input) return;
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      var word = $('[data-reveal-word]', btn);
      if (word) word.textContent = show ? 'Hide' : 'Show';
      else {
        var label = $('.visually-hidden', btn);
        if (label) label.textContent = show ? 'Hide password' : 'Show password';
      }
      input.focus();
    });
  });

  /* ---- delete only after ticking the box ---- */
  $$('[data-delete-form]').forEach(function (form) {
    var box = $('[data-delete-confirm]', form);
    var btn = $('[data-delete-button]', form);
    if (!box || !btn) return;
    var sync = function () { btn.disabled = !box.checked; };
    box.addEventListener('change', sync);
    sync();
  });

  /* ---- email settings: SMTP fields only when SMTP is picked ---- */
  $$('[data-transport-form]').forEach(function (form) {
    var smtp = $('[data-smtp]', form);
    var sync = function () {
      var picked = $('[data-transport]:checked', form);
      if (smtp) smtp.hidden = !picked || picked.value !== 'smtp';
    };
    $$('[data-transport]', form).forEach(function (r) { r.addEventListener('change', sync); });
    sync();
  });

  /* ---- office hours: "Closed" greys out that day's times ---- */
  $$('[data-hours] [data-closed-toggle]').forEach(function (box) {
    var row = box.closest('.a-hours-row');
    var sync = function () {
      if (!row) return;
      row.classList.toggle('is-closed', box.checked);
      $$('input[type="time"]', row).forEach(function (t) { t.disabled = box.checked; });
    };
    box.addEventListener('change', sync);
    sync();
  });

  /* ---- photo viewer ---- */
  var gallery = $('[data-gallery]');
  var lb = $('[data-lightbox]');
  if (gallery && lb && typeof lb.showModal === 'function') {
    var items = $$('[data-full]', gallery);
    var img = $('[data-lb-img]', lb);
    var count = $('[data-lb-count]', lb);
    var dl = $('[data-lb-dl]', lb);
    var prev = $('[data-lb-prev]', lb);
    var next = $('[data-lb-next]', lb);
    var at = 0;
    var show = function (i) {
      at = (i + items.length) % items.length;
      var a = items[at];
      img.src = a.getAttribute('data-full');
      img.alt = ($('img', a) || {}).alt || '';
      dl.href = a.getAttribute('data-dl');
      count.textContent = 'Photo ' + (at + 1) + ' of ' + items.length;
      prev.disabled = next.disabled = items.length < 2;
      // warm up the neighbours so swiping feels instant
      [at - 1, at + 1].forEach(function (n) {
        var b = items[(n + items.length) % items.length];
        if (b) { var pre = new Image(); pre.src = b.getAttribute('data-full'); }
      });
    };
    items.forEach(function (a, i) {
      a.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        show(i);
        lb.showModal();
      });
    });
    prev.addEventListener('click', function () { show(at - 1); });
    next.addEventListener('click', function () { show(at + 1); });
    $('[data-lb-close]', lb).addEventListener('click', function () { lb.close(); });
    lb.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(at - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); show(at + 1); }
    });
    lb.addEventListener('click', function (e) { if (e.target === lb || e.target.classList.contains('a-lb-stage')) lb.close(); });
    var x0 = null;
    lb.addEventListener('touchstart', function (e) { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    lb.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1));
      x0 = null;
    });
    lb.addEventListener('close', function () { img.removeAttribute('src'); });
  }

  /* ---- visitor chart ---- */
  $$('[data-chart]').forEach(function (fig) {
    var plot = $('[data-chart-plot]', fig);
    var live = $('[data-chart-live]', fig);
    var raw = $('[data-chart-data]', fig);
    if (!plot || !raw) return;
    var data;
    try { data = JSON.parse(raw.textContent); } catch (e) { return; }
    var series = data.series || [];
    if (!series.length) return;
    var unit = data.unit || 'day';
    var tip = doc.createElement('div');
    tip.className = 'a-tip';
    tip.hidden = true;
    plot.appendChild(tip);
    var active = -1;
    var slots = [];

    function el(name, attrs, parent) {
      var n = doc.createElementNS(NS, name);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      if (parent) parent.appendChild(n);
      return n;
    }
    function niceMax(v) {
      if (v <= 4) return 4;
      var p = Math.pow(10, Math.floor(Math.log10(v)));
      var steps = [1, 2, 2.5, 5, 10];
      for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return steps[i] * p;
      return 10 * p;
    }
    // bar with a 4px rounded top, square at the baseline
    function barPath(x, y, w, h) {
      var r = Math.min(4, w / 2, h);
      return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
        'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
    }

    function draw() {
      var W = Math.max(280, plot.clientWidth);
      var H = 240;
      var pad = { top: 22, right: 4, bottom: 58, left: 30 };
      var innerW = W - pad.left - pad.right;
      var innerH = H - pad.top - pad.bottom;
      var max = niceMax(Math.max.apply(null, series.map(function (s) { return s.visitors; })));
      var band = innerW / series.length;
      var barW = Math.max(2, Math.min(24, band * 0.72));
      var old = $('svg', plot);
      if (old) old.remove();
      var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, 'aria-hidden': 'true', focusable: 'false' });
      plot.insertBefore(svg, tip);

      // recessive grid: 0, half, max
      [0, max / 2, max].forEach(function (v) {
        var y = pad.top + innerH - (v / max) * innerH;
        el('line', { class: v === 0 ? 'baseline' : 'grid', x1: pad.left, x2: W - pad.right, y1: y, y2: y }, svg);
        var t = el('text', { x: pad.left - 6, y: y + 4, 'text-anchor': 'end' }, svg);
        t.textContent = v % 1 ? v.toFixed(1) : String(v);
      });

      // x labels: as many as fit without touching
      var labelEvery = Math.max(1, Math.ceil(46 / band));
      var peakIdx = 0;
      series.forEach(function (s, i) { if (s.visitors > series[peakIdx].visitors) peakIdx = i; });
      var stripY = H - 22;
      var stripLabel = el('text', { x: pad.left - 6, y: stripY + 4, 'text-anchor': 'end', class: 'strip-label' }, svg);
      stripLabel.textContent = 'Req.';

      slots = series.map(function (s, i) {
        var g = el('g', { class: 'slot' }, svg);
        var cx = pad.left + band * i + band / 2;
        var h = s.visitors > 0 ? Math.max(2, (s.visitors / max) * innerH) : 0;
        el('rect', { class: 'hit', x: pad.left + band * i, y: pad.top - 8, width: band, height: H - pad.top + 8 }, g);
        if (h > 0) el('path', { class: 'bar', d: barPath(cx - barW / 2, pad.top + innerH - h, barW, h) }, g);
        if ((i % labelEvery === 0 && i <= series.length - Math.ceil(labelEvery / 2)) || i === series.length - 1 && series.length <= 8) {
          var lx = el('text', { x: cx, y: pad.top + innerH + 16, 'text-anchor': 'middle' }, svg);
          lx.textContent = s.short;
        }
        if (s.requests > 0) {
          el('circle', { class: 'req-dot', cx: cx, cy: stripY, r: Math.min(6, Math.max(4.5, band * 0.3)) }, g);
          if (s.requests > 1 && band >= 14) {
            var rc = el('text', { class: 'req-count', x: cx, y: stripY - 9, 'text-anchor': 'middle' }, g);
            rc.textContent = String(s.requests);
          }
        }
        return { g: g, cx: cx, top: pad.top + innerH - h, s: s };
      });
      // one direct label: the busiest day
      if (series[peakIdx].visitors > 0) {
        var pk = slots[peakIdx];
        var pt = el('text', { class: 'peak', x: Math.min(W - 12, Math.max(pad.left + 12, pk.cx)), y: pk.top - 7, 'text-anchor': 'middle' }, svg);
        pt.textContent = String(series[peakIdx].visitors);
      }
      slots.forEach(function (slot, i) {
        slot.g.addEventListener('pointerenter', function () { activate(i); });
        slot.g.addEventListener('pointerdown', function () { activate(i); });
      });
      if (active >= 0) activate(Math.min(active, slots.length - 1));
    }

    function activate(i) {
      if (active >= 0 && slots[active]) slots[active].g.classList.remove('is-active');
      active = i;
      var slot = slots[i];
      if (!slot) return;
      slot.g.classList.add('is-active');
      var s = slot.s;
      tip.innerHTML = '';
      var title = doc.createElement('div');
      title.className = 'a-tip-title';
      title.textContent = s.label;
      tip.appendChild(title);
      [['visitors', s.visitors, true], ['pages viewed', s.views, false], [s.requests === 1 ? 'request' : 'requests', s.requests, false]].forEach(function (r) {
        var row = doc.createElement('div');
        row.className = 'a-tip-row';
        if (r[2]) { var key = doc.createElement('span'); key.className = 'a-tip-key'; row.appendChild(key); }
        var strong = doc.createElement('strong');
        strong.textContent = String(r[1]);
        row.appendChild(strong);
        row.appendChild(doc.createTextNode(' ' + r[0]));
        tip.appendChild(row);
      });
      tip.hidden = false;
      var w = plot.clientWidth;
      var x = Math.min(Math.max(slot.cx, 76), w - 76);
      tip.style.left = x + 'px';
      tip.style.top = Math.max(slot.top, 40) + 'px';
      if (live) live.textContent = s.label + ': ' + s.visitors + ' visitors, ' + s.views + ' pages viewed, ' + s.requests + ' requests.';
    }
    function clear() {
      if (active >= 0 && slots[active]) slots[active].g.classList.remove('is-active');
      active = -1;
      tip.hidden = true;
    }

    plot.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') clear(); });
    plot.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var n = active < 0 ? (e.key === 'ArrowRight' ? 0 : slots.length - 1) : active + (e.key === 'ArrowRight' ? 1 : -1);
        activate(Math.max(0, Math.min(slots.length - 1, n)));
      } else if (e.key === 'Escape') clear();
    });
    plot.addEventListener('blur', clear);
    doc.addEventListener('pointerdown', function (e) { if (!plot.contains(e.target)) clear(); });

    draw();
    var last = plot.clientWidth;
    if ('ResizeObserver' in window) {
      new ResizeObserver(function () {
        if (Math.abs(plot.clientWidth - last) > 4) { last = plot.clientWidth; draw(); }
      }).observe(plot);
    }
  });

  /* website colors: show the panel for the chosen mode, keep Preview links in step with the choices */
  var colorForm = document.querySelector('[data-color-form]');
  if (colorForm) {
    colorForm.classList.add('js-colors');
    colorForm.querySelectorAll('[data-color-mode]').forEach(function (r) {
      r.addEventListener('change', function () { if (r.checked) colorForm.setAttribute('data-mode', r.value); });
    });
    var customColor = colorForm.querySelector('[data-custom-color]');
    var customRadio = colorForm.querySelector('input[name="color_scheme"][value="custom"]');
    var customPreview = colorForm.querySelector('[data-custom-preview]');
    if (customColor) {
      customColor.addEventListener('input', function () {
        if (customRadio) customRadio.checked = true;
        if (customPreview) customPreview.href = 'index.html?scheme=custom&accent=' + customColor.value.replace('#', '');
      });
    }
    colorForm.querySelectorAll('[data-season]').forEach(function (box) {
      var select = box.querySelector('[data-season-scheme]');
      var color = box.querySelector('[data-season-custom]');
      var preview = box.querySelector('[data-season-preview]');
      function sync() {
        var custom = select.value === 'custom';
        color.hidden = !custom;
        preview.href = 'index.html?scheme=' + encodeURIComponent(select.value) + (custom ? '&accent=' + color.value.replace('#', '') : '');
      }
      select.addEventListener('change', sync);
      color.addEventListener('input', sync);
    });
  }

  /* home screen: the admin can be added as its own app (see /admin/app.webmanifest) */
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
  (function () {
    var box = document.querySelector('[data-admin-install]');
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    if (!box || standalone) return;
    var HIDE = 'jbh-admin-install-hidden';
    try { if (localStorage.getItem(HIDE)) return; } catch (e) { /* storage off: still offer */ }
    var ua = navigator.userAgent || '';
    var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var go = box.querySelector('[data-admin-install-go]');
    var deferred = null;
    if (isIOS) {
      box.querySelector('[data-admin-install-steps]').hidden = false;
      box.hidden = false;
    }
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferred = e;
      go.hidden = false;
      box.hidden = false;
    });
    go.addEventListener('click', function () {
      if (!deferred) return;
      var d = deferred;
      deferred = null;
      d.prompt();
      (d.userChoice || Promise.resolve({})).then(function (c) { if (c && c.outcome === 'accepted') box.hidden = true; });
    });
    box.querySelector('[data-admin-install-hide]').addEventListener('click', function () {
      box.hidden = true;
      try { localStorage.setItem(HIDE, '1'); } catch (e) { /* ignore */ }
    });
    window.addEventListener('appinstalled', function () { box.hidden = true; });
  })();
})();
