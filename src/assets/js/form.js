/*
 * The appointment and service request forms.
 *
 * The forms work without this file (they post to /contact/send like any form).
 * This file adds: steps, friendly checks before sending, photo shrinking and background
 * uploads with retries, draft saving, offline recovery, and a sending process that never
 * creates duplicates (every request carries an "idem" key the server checks).
 */
(function () {
  'use strict';

  var doc = document;
  var contact = doc.querySelector('[data-contact]');
  if (!contact || !window.fetch || !window.FormData) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var track = window.jbhTrack || function () {};
  var $ = function (sel, ctx) { return (ctx || doc).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); };
  // phone number (empty when the owner chose not to show it) and email, from the contact section
  var PHONE = (contact.getAttribute('data-phone') || '').trim();
  var EMAIL = (contact.getAttribute('data-email') || '').trim();
  var OFFICE_EMAIL = ((($('.aside-email a', contact) || {}).textContent) || 'service@johnnybhome.com').trim();

  var forms = { appointment: $('#form-appointment'), service: $('#form-service') };
  var sentBox = $('[data-sent]');
  var titleEl = $('[data-contact-title]');
  var TITLES = { '': 'Contact Us', appointment: 'Set Up an Appointment', service: 'Request Service' };
  var PATHS = { '': 'contact.html', appointment: 'appointment.html', service: 'service.html' };

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function animateIn(el) {
    if (reduce || !el.animate) return;
    el.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }
  function scrollToEl(el) {
    var top = el.getBoundingClientRect().top + window.scrollY - 90;
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  }
  // move without animation, and only if the element's top is above the screen
  function jumpTo(el) {
    var top = el.getBoundingClientRect().top + window.scrollY - 90;
    if (top < window.scrollY) window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  }

  /* --------------------------------------------------------- choose a form */
  var mode = contact.getAttribute('data-mode') || '';
  function setMode(next, push) {
    if (next === mode && !push) return;
    mode = next;
    contact.setAttribute('data-mode', mode);
    Object.keys(forms).forEach(function (k) {
      var f = forms[k];
      if (!f) return;
      var show = k === mode;
      if (show && f.hidden) { f.hidden = false; animateIn(f); track('event', 'form_view', k); }
      if (!show) f.hidden = true;
    });
    $$('[data-choose]', contact).forEach(function (a) {
      if (a.getAttribute('data-choose') === mode) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (titleEl) titleEl.textContent = TITLES[mode];
    doc.title = doc.title.replace(/^[^|]+\|/, TITLES[mode === '' ? '' : mode].replace('Contact Us', 'Contact') + ' |');
    if (push && history.pushState) history.pushState({ mode: mode }, '', PATHS[mode] + location.search);
  }
  $$('[data-choose]', contact).forEach(function (a) {
    a.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      var m = a.getAttribute('data-choose');
      setMode(m, true);
      var f = forms[m];
      if (f) setTimeout(function () { scrollToEl(f); }, 60);
    });
  });
  window.addEventListener('popstate', function () {
    var m = /service/.test(location.pathname) ? 'service' : /appointment/.test(location.pathname) ? 'appointment' : '';
    setMode(m, false);
  });
  if (mode && forms[mode]) track('event', 'form_view', mode);

  /* ------------------------------------------------------------ the checks */
  var MSG = {
    name: 'Enter your name',
    phone: 'Enter a phone number',
    phoneBad: 'Enter a phone number with the area code, like 920-555-0123',
    email: 'Enter your email address',
    emailBad: 'Enter an email address like name@example.com',
    address: 'Enter the address of the house that needs work',
    services: "Choose at least one. Pick Other if you're not sure",
    description: 'Describe the problem, even in a few words'
  };
  function check(form, name) {
    var el = form.elements[name];
    if (name === 'services') {
      return $$('input[name="services[]"]:checked', form).length ? '' : MSG.services;
    }
    if (!el) return '';
    var v = (el.value || '').trim();
    switch (name) {
      case 'name': return v.length < 2 ? MSG.name : '';
      case 'phone':
        var d = v.replace(/\D/g, '');
        return !d ? MSG.phone : (d.length < 10 || d.length > 15 ? MSG.phoneBad : '');
      case 'email':
        return !v ? MSG.email : (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v) ? '' : MSG.emailBad);
      case 'address': return v.length < 5 ? MSG.address : '';
      case 'description': return v.length < 3 ? MSG.description : '';
    }
    return '';
  }
  function fieldBox(form, name) { return $('[data-field="' + name + '"]', form); }
  function showError(form, name, msg) {
    var box = fieldBox(form, name);
    if (!box) return;
    box.classList.add('has-error');
    var p = $('.field-error', box);
    if (!p) {
      p = doc.createElement('p');
      p.className = 'field-error';
      var anchor = $('input:not([type=hidden]), textarea, select, .chips, .uploader', box);
      box.insertBefore(p, anchor && anchor.parentNode === box ? anchor : box.children[1] || null);
    }
    p.id = p.id || form.id + '-err-' + name;
    p.textContent = msg;
    $$('input, textarea, select', box).forEach(function (i) {
      i.setAttribute('aria-invalid', 'true');
      var ids = (i.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
      if (ids.indexOf(p.id) < 0) ids.unshift(p.id);
      i.setAttribute('aria-describedby', ids.join(' '));
    });
  }
  function clearError(form, name) {
    var box = fieldBox(form, name);
    if (!box || !box.classList.contains('has-error')) return;
    box.classList.remove('has-error');
    var p = $('.field-error', box);
    if (p) {
      $$('input, textarea, select', box).forEach(function (i) {
        i.removeAttribute('aria-invalid');
        var ids = (i.getAttribute('aria-describedby') || '').split(' ').filter(function (x) { return x && x !== p.id; });
        if (ids.length) i.setAttribute('aria-describedby', ids.join(' ')); else i.removeAttribute('aria-describedby');
      });
      p.remove();
    }
  }
  function stepFields(step) {
    var names = [];
    $$('[data-field]', step).forEach(function (b) { names.push(b.getAttribute('data-field')); });
    return names.filter(function (n) { return ['name', 'phone', 'email', 'address', 'services', 'description'].indexOf(n) >= 0; });
  }
  function validateStep(form, step) {
    var first = null;
    stepFields(step).forEach(function (n) {
      var m = check(form, n);
      if (m) { showError(form, n, m); if (!first) first = n; } else clearError(form, n);
    });
    return first;
  }
  function focusField(form, name) {
    var box = fieldBox(form, name);
    if (!box) return;
    var input = $('input:not([type=hidden]), textarea, select', box);
    scrollToEl(box);
    if (input) setTimeout(function () { input.focus({ preventScroll: true }); }, reduce ? 0 : 320);
  }

  /* ---------------------------------------- friendly fixes while typing */
  var DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'live.com', 'msn.com', 'comcast.net', 'charter.net', 'att.net', 'sbcglobal.net', 'new.rr.com', 'tds.net', 'netnet.net', 'me.com'];
  function distance(a, b) {
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) d[i] = [i];
    for (j = 0; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[m][n];
  }
  function emailSuggestion(v) {
    var at = v.lastIndexOf('@');
    if (at < 1) return '';
    var dom = v.slice(at + 1).toLowerCase();
    if (!dom || DOMAINS.indexOf(dom) >= 0) return '';
    var best = '', bestD = 3;
    DOMAINS.forEach(function (d) { var x = distance(dom, d); if (x < bestD) { bestD = x; best = d; } });
    return best && bestD <= 2 ? v.slice(0, at + 1) + best : '';
  }
  function formatPhone(v) {
    var d = v.replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : v;
  }

  /* --------------------------------------------------------------- photos */
  function Uploader(form) {
    var box = $('[data-uploader]', form);
    if (!box) return null;
    var input = $('input[type=file]', box);
    var list = $('[data-thumbs]', box);
    var label = $('[data-upload-label]', box);
    var MAX = 12;
    var items = [];
    var active = 0;
    var waiters = [];
    var worker = null;
    var workerJobs = {};
    var ft = form.elements.ft ? form.elements.ft.value : '';
    box.classList.add('is-enhanced');

    if (window.Worker && window.OffscreenCanvas && window.createImageBitmap) {
      try {
        worker = new Worker('assets/js/photo-worker.js');
        worker.onmessage = function (e) {
          var job = workerJobs[e.data.id];
          if (!job) return;
          delete workerJobs[e.data.id];
          job(e.data);
        };
        worker.onerror = function () { worker = null; };
      } catch (e) { worker = null; }
    }

    function shrinkInWorker(file, max, q) {
      return new Promise(function (resolve, reject) {
        if (!worker) return reject(new Error('no worker'));
        var id = uuid();
        var timer = setTimeout(function () { delete workerJobs[id]; reject(new Error('timeout')); }, 20000);
        workerJobs[id] = function (r) {
          clearTimeout(timer);
          if (r.ok && r.blob && r.blob.size > 0) resolve(r.blob); else reject(new Error(r.error || 'failed'));
        };
        worker.postMessage({ id: id, file: file, max: max, quality: q });
      });
    }
    function shrinkHere(file, max, q) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          try {
            var s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
            var c = doc.createElement('canvas');
            c.width = Math.max(1, Math.round(img.naturalWidth * s));
            c.height = Math.max(1, Math.round(img.naturalHeight * s));
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            c.toBlob(function (b) { b && b.size ? resolve(b) : reject(new Error('empty')); }, 'image/jpeg', q);
          } catch (e) { URL.revokeObjectURL(url); reject(e); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('cannot decode')); };
        img.src = url;
      });
    }
    // Shrink to a sensible size. If this browser can't open the file (e.g. HEIC on a PC), send the original.
    function prepare(item) {
      var f = item.file;
      var max = item.level === 0 ? 2048 : item.level === 1 ? 1600 : 1200;
      var q = item.level === 0 ? 0.82 : item.level === 1 ? 0.74 : 0.66;
      if (f.type === 'image/gif' && f.size < 4e6) return Promise.resolve(f);
      return shrinkInWorker(f, max, q).catch(function () { return shrinkHere(f, max, q); }).then(function (blob) {
        return blob;
      }, function () {
        item.original = true;
        return f;
      });
    }

    function render(item) {
      var li = doc.createElement('li');
      li.className = 'thumb';
      li.setAttribute('data-state', 'preparing');
      li.innerHTML =
        '<span class="thumb-img"></span>' +
        '<svg class="ring" viewBox="0 0 36 36" aria-hidden="true"><circle class="ring-bg" cx="18" cy="18" r="16"/><circle class="ring-fg" cx="18" cy="18" r="16" pathLength="100"/></svg>' +
        '<span class="thumb-done" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.2 4.2L19 7"/></svg></span>' +
        '<span class="thumb-error"><span class="thumb-error-text"></span><button type="button" class="thumb-retry">Try again</button></span>' +
        '<button type="button" class="thumb-remove" aria-label="Remove photo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
        '<span class="visually-hidden" data-status></span>';
      var holder = $('.thumb-img', li);
      var url = URL.createObjectURL(item.file);
      var img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.onload = function () { holder.appendChild(img); li.classList.add('has-img'); };
      img.onerror = function () { holder.textContent = (item.file.name || 'Photo').slice(0, 18); li.classList.add('no-preview'); URL.revokeObjectURL(url); };
      img.src = url;
      item.url = url;
      $('.thumb-remove', li).addEventListener('click', function () { remove(item); });
      $('.thumb-retry', li).addEventListener('click', function () { item.tries = 0; setState(item, 'queued'); pump(); });
      list.appendChild(li);
      if (!reduce && li.animate) li.animate([{ opacity: 0, transform: 'scale(0.92)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
      item.el = li;
    }
    function setState(item, state, text) {
      item.state = state;
      if (!item.el) return;
      item.el.setAttribute('data-state', state);
      var n = items.indexOf(item) + 1;
      var words = { preparing: 'getting ready', queued: 'waiting', uploading: 'uploading', done: 'added', error: 'not added' }[state] || state;
      $('[data-status]', item.el).textContent = 'Photo ' + n + ' ' + words + (text ? ': ' + text : '');
      if (state === 'error') $('.thumb-error-text', item.el).textContent = text || 'Didn\'t upload';
      if (state === 'done' || state === 'error') settle();
      updateLabel();
    }
    function setProgress(item, p) {
      if (!item.el) return;
      item.el.style.setProperty('--p', String(Math.max(0, Math.min(1, p))));
    }
    function updateLabel() {
      var full = items.length >= MAX;
      input.disabled = full;
      box.classList.toggle('is-full', full);
      if (label) label.textContent = full ? 'That\'s the limit of ' + MAX + ' photos' : items.length ? 'Add More Photos' : 'Add Photos';
    }
    function remove(item) {
      if (item.xhr) try { item.xhr.abort(); } catch (e) { /* ignore */ }
      if (item.state === 'uploading') active = Math.max(0, active - 1);
      var i = items.indexOf(item);
      if (i >= 0) items.splice(i, 1);
      if (item.url) URL.revokeObjectURL(item.url);
      var li = item.el;
      if (li) {
        if (!reduce && li.animate) li.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.9)' }], { duration: 200, easing: 'cubic-bezier(0.7, 0, 0.84, 0)' }).onfinish = function () { li.remove(); };
        else li.remove();
      }
      updateLabel();
      settle();
      pump();
    }
    function upload(item, blob) {
      return new Promise(function (resolve, reject) {
        var fd = new FormData();
        var name = (item.file.name || 'photo').replace(/\.[a-z0-9]+$/i, '') + (blob === item.file ? (item.file.name.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0] : '.jpg');
        fd.append('photo', blob, name);
        fd.append('ft', ft);
        var xhr = new XMLHttpRequest();
        item.xhr = xhr;
        xhr.open('POST', '/api/upload');
        xhr.timeout = 120000;
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.upload.onprogress = function (e) { if (e.lengthComputable) setProgress(item, 0.05 + 0.9 * e.loaded / e.total); };
        xhr.onload = function () {
          item.xhr = null;
          var res = null;
          try { res = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
          if (xhr.status === 200 && res && res.ok) return resolve(res);
          var err = new Error((res && res.message) || 'Upload failed');
          err.status = xhr.status;
          err.code = res && res.error;
          reject(err);
        };
        xhr.onerror = function () { item.xhr = null; var e = new Error('Connection problem'); e.status = 0; reject(e); };
        xhr.ontimeout = function () { item.xhr = null; var e = new Error('Took too long'); e.status = 0; reject(e); };
        xhr.onabort = function () { item.xhr = null; var e = new Error('aborted'); e.aborted = true; reject(e); };
        xhr.send(fd);
      });
    }
    function run(item) {
      active++;
      setState(item, 'preparing');
      setProgress(item, 0.02);
      prepare(item).then(function (blob) {
        if (items.indexOf(item) < 0) throw Object.assign(new Error('removed'), { aborted: true });
        setState(item, 'uploading');
        return upload(item, blob);
      }).then(function (res) {
        item.token = res.token;
        setProgress(item, 1);
        setState(item, 'done');
        track('event', 'upload_ok', item.original ? 'original' : 'shrunk');
      }).catch(function (err) {
        if (err.aborted || items.indexOf(item) < 0) return;
        item.tries = (item.tries || 0) + 1;
        if (err.status === 413 && item.level < 2 && !item.original) {
          item.level++;
          setState(item, 'queued');
          return;
        }
        var retryable = err.status === 0 || err.status >= 500 || err.status === 429;
        if (retryable && item.tries < 4) {
          setState(item, 'queued');
          item.waitUntil = Date.now() + [0, 1500, 4000, 8000][item.tries];
          setTimeout(pump, [0, 1500, 4000, 8000][item.tries] + 20);
          return;
        }
        setState(item, 'error', err.status === 415 ? 'Not a photo' : err.status === 413 ? 'Too large' : 'Didn\'t upload');
        track('event', 'upload_error', (err.status || 'net') + ' ' + (err.code || err.message || ''));
      }).then(function () {
        active = Math.max(0, active - 1);
        pump();
      });
    }
    function pump() {
      var now = Date.now();
      items.forEach(function (it) {
        if (active >= 2) return;
        if (it.state === 'queued' && (!it.waitUntil || it.waitUntil <= now)) run(it);
      });
    }
    function settle() {
      if (pending() > 0) return;
      var w = waiters;
      waiters = [];
      w.forEach(function (fn) { fn(); });
    }
    function pending() {
      return items.filter(function (it) { return it.state === 'queued' || it.state === 'preparing' || it.state === 'uploading'; }).length;
    }

    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      var room = MAX - items.length;
      files.slice(0, room).forEach(function (file) {
        var item = { file: file, state: 'queued', level: 0, tries: 0 };
        items.push(item);
        render(item);
        setState(item, 'queued');
      });
      if (files.length > room) {
        showNote(form, 'photos', 'Only ' + MAX + ' photos fit. The first ' + room + ' were added.');
      }
      input.value = '';
      clearError(form, 'photos');
      updateLabel();
      pump();
    });

    return {
      tokens: function () { return items.filter(function (i) { return i.token; }).map(function (i) { return i.token; }); },
      pending: pending,
      failed: function () { return items.filter(function (i) { return i.state === 'error'; }); },
      count: function () { return items.length; },
      dropFailed: function () { this.failed().forEach(remove); },
      retryFailed: function () { items.forEach(function (i) { if (i.state === 'error') { i.tries = 0; setState(i, 'queued'); } }); pump(); },
      settled: function () {
        return new Promise(function (resolve) { if (pending() === 0) resolve(); else waiters.push(resolve); });
      }
    };
  }
  function showNote(form, field, text) {
    var box = fieldBox(form, field);
    if (!box) return;
    var n = $('.field-note', box) || doc.createElement('p');
    n.className = 'field-note';
    n.textContent = text;
    if (!n.parentNode) box.appendChild(n);
  }

  /* ---------------------------------------------------------------- drafts */
  var SKIP = { ft: 1, idem: 1, website: 1, 'photos[]': 1, kind: 1 };
  function draftKey(form) { return 'jbh-draft-' + form.getAttribute('data-form'); }
  function saveDraft(form) {
    if (form._sent) return;
    try {
      var data = { t: Date.now(), f: {} };
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || SKIP[el.name] || el.type === 'file' || el.type === 'button' || el.type === 'submit') return;
        if (el.type === 'radio' || el.type === 'checkbox') {
          if (el.checked) (data.f[el.name] = data.f[el.name] || []).push(el.value);
        } else if (el.value) data.f[el.name] = el.value;
      });
      data.idem = form.elements.idem.value;
      localStorage.setItem(draftKey(form), JSON.stringify(data));
    } catch (e) { /* private mode or full storage: fine */ }
  }
  function loadDraft(form) {
    try {
      var raw = localStorage.getItem(draftKey(form));
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || Date.now() - data.t > 14 * 864e5) { localStorage.removeItem(draftKey(form)); return false; }
      var any = false;
      var planInLink = /[?&]plan=/.test(location.search);
      Object.keys(data.f || {}).forEach(function (name) {
        if (name === 'plan' && planInLink) return;
        var val = data.f[name];
        $$('[name="' + name + '"]', form).forEach(function (el) {
          if (el.type === 'radio' || el.type === 'checkbox') {
            var on = Array.isArray(val) && val.indexOf(el.value) >= 0;
            if (el.checked !== on) { el.checked = on; any = true; }
          } else if (!el.value && typeof val === 'string') { el.value = val; any = true; }
        });
      });
      if (data.idem) form.elements.idem.value = data.idem;
      return any;
    } catch (e) { return false; }
  }
  function clearDraft(form) { try { localStorage.removeItem(draftKey(form)); } catch (e) { /* ignore */ } }

  /* ----------------------------------------------------------- each form */
  function setup(form) {
    var kind = form.getAttribute('data-form');
    var steps = $$('.step', form);
    var progress = $('[data-progress]', form);
    var progressText = $('[data-progress-text]', form);
    var progressBar = $('[data-progress-bar]', form);
    var sendBtn = $('[data-send]', form);
    var sendLabel = sendBtn ? $('.send-label', sendBtn) : null;
    var sendText = sendLabel ? sendLabel.textContent : '';
    var alertBox = $('[data-form-alert]', form);
    var uploader = Uploader(form);
    var current = 0;
    var started = false;
    var sending = false;

    if (!form.elements.idem.value) form.elements.idem.value = uuid();
    form.classList.add('is-stepped');
    if (progress) progress.hidden = false;

    function show(i, focus) {
      current = Math.max(0, Math.min(steps.length - 1, i));
      if (focus) jumpTo(form);
      steps.forEach(function (s, n) {
        var on = n === current;
        s.classList.toggle('is-current', on);
        s.setAttribute('aria-hidden', on ? 'false' : 'true');
        if ('inert' in s) s.inert = !on;
      });
      if (progressText) progressText.textContent = 'Step ' + (current + 1) + ' of ' + steps.length;
      if (progressBar) progressBar.style.transform = 'scaleX(' + ((current + 1) / steps.length) + ')';
      var step = steps[current];
      animateIn(step);
      if (focus) {
        var legend = $('legend', step);
        if (legend) { legend.tabIndex = -1; setTimeout(function () { legend.focus({ preventScroll: true }); }, reduce ? 0 : 300); }
      }
    }
    show(0, false);

    $$('[data-next]', form).forEach(function (b) {
      b.addEventListener('click', function () {
        var bad = validateStep(form, steps[current]);
        if (bad) { focusField(form, bad); track('event', 'form_error', kind + ' step ' + (current + 1) + ' ' + bad); return; }
        show(current + 1, true);
        track('event', 'form_step', kind + ' ' + (current + 1));
        saveDraft(form);
      });
    });
    $$('[data-back]', form).forEach(function (b) {
      b.addEventListener('click', function () { show(current - 1, true); });
    });

    // typing clears the error for that field; first keystroke counts as "started"
    form.addEventListener('input', function (e) {
      if (!started) { started = true; track('event', 'form_start', kind); }
      var box = e.target.closest('[data-field]');
      if (box && box.classList.contains('has-error')) {
        var name = box.getAttribute('data-field');
        if (!check(form, name)) clearError(form, name);
      }
      clearTimeout(form._t);
      form._t = setTimeout(function () { saveDraft(form); }, 400);
    });
    form.addEventListener('change', function (e) {
      var box = e.target.closest('[data-field]');
      if (box) { var name = box.getAttribute('data-field'); if (!check(form, name)) clearError(form, name); }
      saveDraft(form);
    });

    var phone = form.elements.phone;
    if (phone) phone.addEventListener('blur', function () { phone.value = formatPhone(phone.value.trim()); });
    var email = form.elements.email;
    if (email) {
      email.addEventListener('blur', function () {
        email.value = email.value.trim();
        var box = fieldBox(form, 'email');
        var old = $('.suggest', box);
        if (old) old.remove();
        var s = emailSuggestion(email.value);
        if (!s) return;
        var p = doc.createElement('p');
        p.className = 'suggest';
        p.innerHTML = 'Did you mean <button type="button" class="link-button"></button>?';
        $('button', p).textContent = s;
        $('button', p).addEventListener('click', function () { email.value = s; p.remove(); clearError(form, 'email'); saveDraft(form); email.focus(); });
        box.appendChild(p);
      });
    }

    // appointment: at most 3 days
    var days = $('[data-days]', form);
    if (days) {
      var syncDays = function () {
        var boxes = $$('input[type=checkbox]', days);
        var n = boxes.filter(function (b) { return b.checked; }).length;
        boxes.forEach(function (b) { b.disabled = !b.checked && n >= 3; });
        days.classList.toggle('is-full', n >= 3);
      };
      days.addEventListener('change', syncDays);
      syncDays();
    }
    // service: urgent note
    var urgentNote = $('[data-urgent-note]', form);
    if (urgentNote) {
      var syncUrgent = function () {
        var u = form.querySelector('input[name="urgency"]:checked');
        var open = !!u && u.value === 'urgent';
        urgentNote.classList.toggle('is-open', open);
        // while collapsed, its phone link must not be a hidden tab stop
        if ('inert' in urgentNote) urgentNote.inert = !open;
      };
      $$('input[name="urgency"]', form).forEach(function (r) { r.addEventListener('change', syncUrgent); });
      syncUrgent();
    }

    if (loadDraft(form)) {
      var note = doc.createElement('div');
      note.className = 'draft-note';
      note.innerHTML = '<p>We kept what you typed last time' + (kind === 'service' ? '. Photos need to be added again' : '') + '.</p><button type="button" class="link-button">Start over</button>';
      $('button', note).addEventListener('click', function () {
        clearDraft(form);
        form.reset();
        form.elements.idem.value = uuid();
        note.remove();
        show(0, false);
        if (days) days.dispatchEvent(new Event('change'));
        if (urgentNote) urgentNote.classList.remove('is-open');
      });
      form.insertBefore(note, form.firstChild);
      if (days) days.dispatchEvent(new Event('change'));
      if (urgentNote) $$('input[name="urgency"]', form).forEach(function (r) { r.dispatchEvent(new Event('change')); });
    }

    /* ------------------------------------------------------------ sending */
    function setSending(on, text) {
      sending = on;
      if (!sendBtn) return;
      sendBtn.classList.toggle('is-sending', on);
      sendBtn.setAttribute('aria-disabled', on ? 'true' : 'false');
      if (sendLabel) sendLabel.textContent = text || sendText;
    }
    function showAlert(html, actions) {
      if (!alertBox) return;
      alertBox.innerHTML = '';
      var p = doc.createElement('p');
      p.innerHTML = html;
      alertBox.appendChild(p);
      if (actions && actions.length) {
        var row = doc.createElement('div');
        row.className = 'alert-actions';
        actions.forEach(function (a) {
          if (!a) return;
          var el = a.href ? doc.createElement('a') : doc.createElement('button');
          el.className = a.primary ? 'btn btn-small' : 'btn btn-small btn-ghost';
          el.textContent = a.label;
          if (a.href) el.href = a.href; else { el.type = 'button'; el.addEventListener('click', a.onClick); }
          row.appendChild(el);
        });
        alertBox.appendChild(row);
      }
      alertBox.hidden = false;
      animateIn(alertBox);
      scrollToEl(alertBox);
    }
    function hideAlert() { if (alertBox) { alertBox.hidden = true; alertBox.innerHTML = ''; } }

    function payload() {
      var data = { kind: kind };
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || el.type === 'file' || el.type === 'submit' || el.type === 'button') return;
        var name = el.name.replace(/\[\]$/, '');
        if (el.type === 'radio') { if (el.checked) data[name] = el.value; return; }
        if (el.type === 'checkbox') {
          if (el.name.slice(-2) === '[]') { data[name] = data[name] || []; if (el.checked) data[name].push(el.value); }
          else if (el.checked) data[name] = el.value;
          return;
        }
        if (el.name.slice(-2) === '[]') { (data[name] = data[name] || []).push(el.value); return; }
        data[name] = el.value;
      });
      if (data.slots) {
        var part = data.part || 'any';
        data.slots = data.slots.map(function (d) { return { date: d, part: part }; });
      }
      // photos kept from an earlier send (hidden uploads[] fields) plus the ones added here
      if (uploader) data.uploads = (Array.isArray(data.uploads) ? data.uploads : []).concat(uploader.tokens());
      data.page = location.pathname;
      var q = new URLSearchParams(location.search);
      ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) { if (q.get(k)) data[k] = q.get(k); });
      return data;
    }

    function post(data) {
      var ctrl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 25000);
      return fetch('/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data),
        credentials: 'same-origin',
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        clearTimeout(timer);
        return r.json().catch(function () { return { ok: false, error: 'server' }; }).then(function (j) { j.status = r.status; return j; });
      }, function (e) {
        clearTimeout(timer);
        return { ok: false, error: 'network', status: 0 };
      });
    }

    function sendWithRetries(data) {
      var delays = [0, 1500, 4000];
      var attempt = function (n) {
        return wait(delays[n]).then(function () { return post(data); }).then(function (res) {
          var retry = !res.ok && (res.status === 0 || res.status >= 500) && n < delays.length - 1;
          return retry ? attempt(n + 1) : res;
        });
      };
      return attempt(0);
    }

    function mailtoFallback(data) {
      var lines = [];
      var labelled = { name: 'Name', phone: 'Phone', email: 'Email', address: 'Address', services: 'Needs', urgency: 'How soon', description: 'Problem', stage: 'Stage', plan: 'Floor plan', message: 'Message' };
      Object.keys(labelled).forEach(function (k) {
        var v = data[k];
        if (v && (!Array.isArray(v) || v.length)) lines.push(labelled[k] + ': ' + (Array.isArray(v) ? v.join(', ') : v));
      });
      if (data.slots && data.slots.length) lines.push('Good days: ' + data.slots.map(function (s) { return s.date; }).join(', '));
      if (kind === 'service' && uploader && uploader.count()) lines.push('', '(I had photos ready. I can ' + (PHONE ? 'text' : 'email') + ' them to you.)');
      var subject = (kind === 'service' ? 'Service request' : 'Appointment request') + ' from ' + (data.name || 'the website');
      return 'mailto:' + OFFICE_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));
    }

    function goToFirstError(errors) {
      var names = Object.keys(errors);
      if (!names.length) return;
      names.forEach(function (n) { showError(form, n === 'form' ? 'name' : n, errors[n]); });
      var idx = steps.findIndex(function (s) { return names.some(function (n) { return fieldBox(s, n); }); });
      if (idx >= 0 && idx !== current) show(idx, false);
      focusField(form, names.filter(function (n) { return fieldBox(form, n); })[0]);
    }

    function succeed(res, data) {
      clearTimeout(form._t);
      form._sent = true;
      clearDraft(form);
      // a fresh key, so another request from this page is a new request, not a repeat of this one
      form.elements.idem.value = uuid();
      track('event', 'form_submit', kind);
      var first = (data.name || '').trim().split(/\s+/)[0];
      var how = { call: ' by phone', text: ' by text', email: ' by email' }[data.contact_pref] || '';
      $('[data-sent-first]', sentBox).textContent = first ? ', ' + first : '';
      $('[data-sent-ref]', sentBox).textContent = res.ref;
      $('[data-sent-how]', sentBox).textContent = how;
      var urgent = kind === 'service' && data.urgency === 'urgent';
      $('[data-sent-urgent]', sentBox).hidden = !urgent;
      var questions = $('[data-sent-questions]', sentBox);
      if (questions) questions.hidden = urgent;
      var copyHint = form.querySelector('[id$="-email-h"]');
      $('[data-sent-copy]', sentBox).hidden = !copyHint;
      $('[data-sent-email]', sentBox).textContent = data.email || '';
      $('[data-sent-tour]', sentBox).hidden = kind === 'service';
      var chooser = $('.chooser', contact);
      var hideOld = function () {
        form.hidden = true;
        if (chooser) chooser.hidden = true;
        sentBox.hidden = false;
        sentBox.classList.add('is-shown');
        jumpTo(sentBox);
        sentBox.focus({ preventScroll: true });
        animateIn(sentBox);
      };
      if (!reduce && form.animate) {
        form.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: 220, easing: 'cubic-bezier(0.7, 0, 0.84, 0)' }).onfinish = hideOld;
      } else hideOld();
    }

    function submit() {
      if (sending) return;
      hideAlert();
      // check every step, then go to the first problem
      for (var i = 0; i < steps.length; i++) {
        var bad = validateStep(form, steps[i]);
        if (bad) { show(i, false); focusField(form, bad); track('event', 'form_error', kind + ' submit ' + bad); return; }
      }
      setSending(true, 'Sending');
      var ready = Promise.resolve();
      if (uploader && uploader.pending() > 0) {
        setSending(true, 'Finishing Photo Uploads');
        ready = uploader.settled();
      }
      ready.then(function () {
        if (uploader && uploader.failed().length) {
          var n = uploader.failed().length;
          setSending(false);
          showAlert((n === 1 ? '1 photo' : n + ' photos') + ' didn\'t upload. You can send your request without ' + (n === 1 ? 'it' : 'them') + ' and ' + (PHONE ? 'text the photos to ' + PHONE : 'email the photos to ' + EMAIL) + ' later.', [
            { label: 'Send Without ' + (n === 1 ? 'It' : 'Them'), primary: true, onClick: function () { uploader.dropFailed(); hideAlert(); submit(); } },
            { label: 'Try the Photos Again', onClick: function () { uploader.retryFailed(); hideAlert(); } }
          ]);
          return;
        }
        setSending(true, 'Sending');
        var data = payload();
        // answers changed since a send that may have reached us: use a new key so the corrected version is saved
        var sig = JSON.stringify(Object.assign({}, data, { idem: '' }));
        if (form._lastSig && form._lastSig !== sig) {
          form.elements.idem.value = uuid();
          data = payload();
        }
        form._lastSig = sig;
        return sendWithRetries(data).then(function (res) {
          setSending(false);
          if (res.ok) return succeed(res, data);
          if (res.status === 422 && res.errors) {
            track('event', 'form_error', kind + ' server validation');
            goToFirstError(res.errors);
            return;
          }
          if (res.status === 0 && navigator.onLine === false) {
            saveDraft(form);
            showAlert('You\'re offline right now. Your request is saved on this device and will send as soon as you\'re back online.');
            track('event', 'form_error', kind + ' offline');
            window.addEventListener('online', function () { hideAlert(); submit(); }, { once: true });
            return;
          }
          saveDraft(form);
          track('event', 'form_error', kind + ' ' + (res.status || 'network') + ' ' + (res.error || ''));
          var msg = res.message && res.status !== 0 ? res.message : 'We couldn\'t reach our website just now. Your answers are saved on this device.';
          showAlert(msg, [
            { label: 'Try Again', primary: true, onClick: function () { hideAlert(); submit(); } },
            PHONE ? { label: 'Call ' + PHONE, href: 'tel:' + PHONE.replace(/[^\d+]/g, '') } : null,
            { label: 'Email It Instead', href: mailtoFallback(data) }
          ]);
        });
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submit();
    });
    // Enter in a text field on an early step moves forward instead of sending
    form.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || e.target.type === 'submit') return;
      if (current < steps.length - 1) {
        e.preventDefault();
        var next = $('[data-next]', steps[current]);
        if (next) next.click();
      }
    });
  }

  Object.keys(forms).forEach(function (k) { if (forms[k]) setup(forms[k]); });
})();
