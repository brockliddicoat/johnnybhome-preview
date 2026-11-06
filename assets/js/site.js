/*
 * Johnny B Home Construction - site behavior. Plain JavaScript, no libraries.
 * Every feature checks that its elements exist, and the site works without this file.
 */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  root.classList.add('js-ready');
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (sel, ctx) { return (ctx || doc).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); };

  /* -------------------------------------------------------------- analytics */
  // No cookies and nothing stored on the visitor's device: the server counts visitors
  // with an anonymous hash that changes every day (see app/lib/analytics.php).
  var params = new URLSearchParams(location.search);
  function track(kind, name, label, extra) {
    if (root.hasAttribute('data-no-track')) return;
    var data = {
      k: kind, n: name || '', l: (label || '').toString().slice(0, 150),
      p: location.pathname, t: doc.title.slice(0, 120)
    };
    if (kind === 'view') {
      data.r = doc.referrer;
      data.w = window.screen ? screen.width : 0;
      try { data.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { data.tz = ''; }
      data.lg = (navigator.language || '').slice(0, 12);
      data.us = params.get('utm_source') || '';
      data.um = params.get('utm_medium') || '';
      data.uc = params.get('utm_campaign') || '';
    }
    if (extra) for (var k in extra) data[k] = extra[k];
    var body = JSON.stringify(data);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/hit', new Blob([body], { type: 'text/plain' }))) return;
    } catch (e) { /* fall through */ }
    try { fetch('/api/hit', { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }); } catch (e) { /* ignore */ }
  }
  window.jbhTrack = track; // used by form.js

  function sendView() { track('view'); }
  if (doc.prerendering) doc.addEventListener('prerenderingchange', sendView, { once: true });
  else sendView();

  doc.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a, button') : null;
    if (!a) return;
    var name = a.getAttribute('data-track');
    var href = a.getAttribute('href') || '';
    if (!name) {
      if (href.indexOf('tel:') === 0) name = 'tel_click';
      else if (href.indexOf('sms:') === 0) name = 'sms_click';
      else if (href.indexOf('mailto:') === 0) name = 'email_click';
    }
    if (name) track('event', name, a.getAttribute('data-label') || a.textContent.trim().slice(0, 80));
  }, true);

  // tell the office when something breaks on a visitor's phone (shown in Admin > Health)
  var errorsSent = 0;
  window.addEventListener('error', function (e) {
    if (errorsSent++ > 4 || !e.message) return;
    track('error', 'js_error', e.message + ' @ ' + (e.filename || '').split('/').pop() + ':' + (e.lineno || 0));
  });
  window.addEventListener('unhandledrejection', function (e) {
    if (errorsSent++ > 4) return;
    var r = e.reason;
    track('error', 'js_error', 'Promise: ' + (r && r.message ? r.message : String(r)).slice(0, 140));
  });

  // how fast the main content appeared for real visitors (Largest Contentful Paint)
  try {
    var lcp = 0;
    new PerformanceObserver(function (list) {
      var entries = list.getEntries();
      if (entries.length) lcp = entries[entries.length - 1].startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    doc.addEventListener('visibilitychange', function onHide() {
      if (doc.visibilityState === 'hidden' && lcp > 0) {
        track('event', 'web_vitals', 'lcp', { ms: Math.round(lcp) });
        doc.removeEventListener('visibilitychange', onHide);
      }
    });
  } catch (e) { /* older browsers */ }

  /* ----------------------------------------------------------------- header */
  var header = $('[data-header]');
  var lastY = window.scrollY;
  var ticking = false;
  function onScroll() {
    var y = window.scrollY;
    if (header) {
      header.classList.toggle('is-scrolled', y > 4);
      var menuOpen = !!$('dialog[open]');
      var focusInside = header.contains(doc.activeElement) && doc.activeElement !== doc.body;
      if (!menuOpen && !focusInside && y > 240 && y > lastY + 4) header.classList.add('is-hidden');
      else if (y < lastY - 4 || y <= 240) header.classList.remove('is-hidden');
    }
    lastY = y;
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  if (header) header.addEventListener('focusin', function () { header.classList.remove('is-hidden'); });

  /* ------------------------------------------------------------------- menu */
  var menu = $('[data-menu]');
  var menuBtn = $('[data-menu-open]');
  if (menu && menuBtn && typeof menu.showModal === 'function') {
    menuBtn.addEventListener('click', function () {
      menu.showModal();
      menuBtn.setAttribute('aria-expanded', 'true');
    });
    var closeMenu = function () { menu.close(); };
    $$('[data-menu-close]', menu).forEach(function (b) { b.addEventListener('click', closeMenu); });
    $$('a', menu).forEach(function (a) { a.addEventListener('click', function () { setTimeout(closeMenu, 10); }); });
    menu.addEventListener('close', function () { menuBtn.setAttribute('aria-expanded', 'false'); });
    menu.addEventListener('click', function (e) { if (e.target === menu) closeMenu(); });
  } else if (menuBtn) {
    // very old browsers: the menu button just goes to the contact page
    menuBtn.addEventListener('click', function () { location.href = 'contact.html'; });
  }

  /* --------------------------------------------------------- photo loading */
  function markLoaded(ph, instant) {
    if (instant) ph.classList.add('is-instant');
    ph.classList.add('is-loaded');
  }
  $$('.ph').forEach(function (ph) {
    var img = $('img', ph);
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) { markLoaded(ph, true); return; }
    img.addEventListener('load', function () {
      if (img.decode) img.decode().then(function () { markLoaded(ph); }, function () { markLoaded(ph); });
      else markLoaded(ph);
    }, { once: true });
    img.addEventListener('error', function () { img.style.visibility = 'hidden'; markLoaded(ph, true); }, { once: true });
  });

  /* ---------------------------------------------------------------- reveals */
  var revealEls = $$('[data-reveal]');
  if (revealEls.length) {
    if (!('IntersectionObserver' in window) || reduceMotion) {
      revealEls.forEach(function (el) { el.classList.add('is-in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
      revealEls.forEach(function (el) { io.observe(el); });
      // safety net: never leave anything hidden
      setTimeout(function () {
        revealEls.forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('is-in');
        });
      }, 2500);
    }
  }

  /* ---------------------------------------------------- sticky call/book bar */
  var bar = $('[data-cta-bar]');
  var barState = { past: false, blocked: false };
  function updateCtaBar() {
    if (!bar) return;
    var show = barState.past && !barState.blocked;
    bar.classList.toggle('is-visible', show);
    bar.setAttribute('aria-hidden', show ? 'false' : 'true');
    $$('a', bar).forEach(function (a) { a.tabIndex = show ? 0 : -1; });
  }
  if (bar && 'IntersectionObserver' in window) {
    var first = $('main > section, main > header, main > div');
    if (first) {
      new IntersectionObserver(function (en) {
        barState.past = !en[0].isIntersecting && en[0].boundingClientRect.top < 0;
        updateCtaBar();
      }).observe(first);
    }
    var blockers = $$('.site-footer, [data-no-cta-bar], form');
    var visibleBlockers = new Set();
    var bo = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) visibleBlockers.add(en.target); else visibleBlockers.delete(en.target); });
      barState.blocked = visibleBlockers.size > 0;
      updateCtaBar();
    });
    blockers.forEach(function (el) { bo.observe(el); });
  }

  /* -------------------------------------------------------- horizontal rail */
  $$('[data-rail]').forEach(function (rail) {
    var prev = $('[data-rail-prev]', rail.parentNode);
    var next = $('[data-rail-next]', rail.parentNode);
    function step(dir) {
      var card = $('li', rail);
      var w = card ? card.getBoundingClientRect().width + 16 : rail.clientWidth * 0.8;
      rail.scrollBy({ left: dir * w, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
    if (prev) prev.addEventListener('click', function () { step(-1); });
    if (next) next.addEventListener('click', function () { step(1); });
    function sync() {
      if (prev) prev.disabled = rail.scrollLeft < 8;
      if (next) next.disabled = rail.scrollLeft + rail.clientWidth > rail.scrollWidth - 8;
    }
    rail.addEventListener('scroll', function () { requestAnimationFrame(sync); }, { passive: true });
    sync();
  });

  /* ---------------------------------------- 3D tours and maps (tap to load) */
  $$('[data-embed]').forEach(function (box) {
    var btn = $('[data-embed-load]', box);
    if (!btn) return;
    btn.addEventListener('click', function () {
      var src = box.getAttribute('data-embed');
      var frame = doc.createElement('iframe');
      frame.src = src;
      frame.title = box.getAttribute('data-embed-title') || 'Embedded content';
      frame.allow = 'fullscreen; xr-spatial-tracking; accelerometer; gyroscope';
      frame.setAttribute('allowfullscreen', '');
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.className = 'embed-frame';
      box.classList.add('is-loading');
      frame.addEventListener('load', function () { box.classList.remove('is-loading'); box.classList.add('is-live'); });
      box.appendChild(frame);
      track('event', box.getAttribute('data-embed-event') || 'tour_open', box.getAttribute('data-embed-title') || '');
      frame.focus({ preventScroll: true });
    });
  });

  /* --------------------------------------------------- vendor filter chips */
  var filterBar = $('[data-filter]');
  if (filterBar) {
    var cards = $$('[data-type]');
    var count = $('[data-filter-count]');
    var chips = $$('button', filterBar);
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        var type = chip.getAttribute('data-value');
        chips.forEach(function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
        // FLIP: remember where cards are, filter, then animate them to their new spots
        var before = new Map();
        cards.forEach(function (c) { if (!c.hidden) before.set(c, c.getBoundingClientRect()); });
        var shown = 0;
        cards.forEach(function (c) {
          var match = type === 'all' || c.getAttribute('data-type') === type;
          c.hidden = !match;
          if (match) shown++;
        });
        if (count) count.textContent = shown === 1 ? '1 vendor' : shown + ' vendors';
        if (reduceMotion || !cards[0].animate) return;
        cards.forEach(function (c, i) {
          if (c.hidden) return;
          var b = before.get(c);
          var a = c.getBoundingClientRect();
          if (b) {
            var dx = b.left - a.left, dy = b.top - a.top;
            if (Math.abs(dx) > 240 || Math.abs(dy) > 240) {
              c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
            } else if (dx || dy) {
              c.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
            }
          } else {
            c.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: Math.min(i, 8) * 30, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' });
          }
        });
      });
    });
  }

  /* ------------------------------------------------- offline page and app */
  // A tiny service worker (/sw.js): pages still come from the website; with no connection
  // it shows a saved page with our phone number. Needed for "Add to home screen" on Android.
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* fine without */ }); });
  }

  /* ------------------------------------------------- add to the home screen */
  // Android/Chrome hands us an install prompt (one tap). On iPhone we can only show the two taps.
  // Offered on its own once: on a phone, on the second page someone looks at, never on the forms.
  // "Not now" keeps it away for 60 days. The footer link and the thank-you screen offer it too.
  (function () {
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    if (standalone) {
      try {
        if (!sessionStorage.getItem('jbh-app-open')) { sessionStorage.setItem('jbh-app-open', '1'); track('event', 'app_open', 'home screen'); }
      } catch (e) { /* ignore */ }
      return;
    }
    var tpl = doc.getElementById('install-template');
    var ua = navigator.userAgent || '';
    var inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|LinkedInApp|Pinterest|\bGSA\//.test(ua);
    if (!tpl || inApp) return;
    var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var LATER = 'jbh-install-later';
    var deferred = null;
    var card = null;

    function supported() { return !!deferred || isIOS; }
    function laterRecently() {
      try { return Date.now() - Number(localStorage.getItem(LATER) || 0) < 60 * 864e5; } catch (e) { return false; }
    }
    function reveal() { $$('[data-install-link], [data-install-inline]').forEach(function (el) { el.hidden = !supported(); }); }
    function close(remember) {
      if (!card) return;
      if (remember) {
        try { localStorage.setItem(LATER, String(Date.now())); } catch (e) { /* ignore */ }
        track('event', 'install_dismiss', '');
      }
      var c = card;
      card = null;
      c.classList.remove('is-open');
      root.classList.remove('install-open');
      setTimeout(function () { c.remove(); }, reduceMotion ? 0 : 420);
    }
    // Android: the browser's own install dialog
    function prompt(source) {
      if (!deferred) return false;
      track('event', 'install_click', source);
      var d = deferred;
      deferred = null;
      d.prompt();
      (d.userChoice || Promise.resolve({})).then(function (choice) {
        if (choice && choice.outcome === 'accepted') close(false);
        reveal();
      });
      return true;
    }
    function open(source) {
      if (card || !supported()) return;
      card = tpl.content.firstElementChild.cloneNode(true);
      var go = $('[data-install-go]', card);
      if (!deferred) {
        // iPhone: show the steps; the button just closes the note
        $('[data-install-steps]', card).hidden = false;
        go.textContent = 'Got It';
        go.addEventListener('click', function () { track('event', 'install_click', source + ' ios'); close(true); });
      } else {
        go.addEventListener('click', function () { prompt(source); close(false); });
      }
      $$('[data-install-later]', card).forEach(function (b) { b.addEventListener('click', function () { close(true); }); });
      card.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(true); });
      doc.body.appendChild(card);
      root.classList.add('install-open');
      requestAnimationFrame(function () { requestAnimationFrame(function () { if (card) card.classList.add('is-open'); }); });
      track('event', 'install_prompt', source);
    }
    function maybeOffer() {
      if (!touch || !supported() || laterRecently() || doc.querySelector('[data-contact]')) return;
      try {
        if (sessionStorage.getItem('jbh-install-offered') || Number(sessionStorage.getItem('jbh-views') || 0) < 2) return;
        sessionStorage.setItem('jbh-install-offered', '1');
      } catch (e) { return; }
      setTimeout(function () { open('second page'); }, 2500);
    }

    try { sessionStorage.setItem('jbh-views', String(Number(sessionStorage.getItem('jbh-views') || 0) + 1)); } catch (e) { /* ignore */ }
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferred = e;
      reveal();
      maybeOffer();
    });
    window.addEventListener('appinstalled', function () {
      deferred = null;
      track('event', 'app_installed', '');
      close(false);
      $$('[data-install-link], [data-install-inline]').forEach(function (el) { el.hidden = true; });
    });
    doc.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-install-open]');
      if (!t) return;
      e.preventDefault();
      var source = t.getAttribute('data-install-open') || 'link';
      if (!prompt(source)) open(source);
    });
    reveal();
    if (isIOS) maybeOffer();
  })();

  /* -------------------------------------------- page transitions (Chrome/Safari) */
  // If someone taps or types while the next page animates in, finish the animation immediately.
  // A transition that is skipped or can't run (the next page doesn't animate) rejects its promises.
  // That is expected, so it shouldn't show up as an error.
  ['pageswap', 'pagereveal'].forEach(function (type) {
    window.addEventListener(type, function (e) {
      var vt = e.viewTransition;
      if (!vt) return;
      [vt.ready, vt.updateCallbackDone, vt.finished].forEach(function (pr) { if (pr && pr.catch) pr.catch(function () {}); });
    });
  });
  window.addEventListener('pagereveal', function (e) {
    if (!e.viewTransition) return;
    var skip = function () { try { e.viewTransition.skipTransition(); } catch (err) { /* already done */ } };
    window.addEventListener('pointerdown', skip, { once: true });
    window.addEventListener('keydown', skip, { once: true });
  });
})();
