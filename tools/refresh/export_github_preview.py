"""Static, phone-viewable preview of the new website (no PHP needed).

Usage:
  python3 -I export_github_preview.py <site_url> <site_dir> <out_dir> [--artifact] [--admin=<demo_url>]

  <site_url>   the site running locally, e.g. http://127.0.0.1:8080
  --admin=URL  a throwaway demo copy of the site filled with sample data (tools/demo_seed.php);
               its admin pages are saved as a clickable demo. Sign-in uses $DEMO_ADMIN_PASSWORD.
  --artifact   for hosts that block other websites inside a page and can't run a service worker:
               the map and 3D tours show where they work instead, and nothing installs.

Without --artifact the copy is meant for GitHub Pages: relative links only (works in a sub-folder),
its own manifest and service worker, so "Add to Home Screen" can be tried for real.

Every page carries a Preview banner and noindex, has no business data for search engines, and
its forms send nothing (preview-shim.js answers in place of the server).
"""
import http.cookiejar
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request

BASE, SITE, OUT = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
FLAGS = sys.argv[4:]
ARTIFACT = '--artifact' in FLAGS
ADMIN = next((f.split('=', 1)[1].rstrip('/') for f in FLAGS if f.startswith('--admin=')), '')
PAGES = {
    'index.html': '/', 'floor-plans.html': '/floor-plans', 'team.html': '/team',
    'preferred-vendors.html': '/preferred-vendors', 'contact.html': '/contact',
    'appointment.html': '/appointment', 'service.html': '/service',
    'privacy.html': '/privacy', 'cookies.html': '/cookies', '404.html': '/this-page-does-not-exist',
    'offline.html': '/offline',
}
ROUTE_TO_FILE = {v: k for k, v in PAGES.items() if k != '404.html'}
MAXW = 1280

if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)
needed = set()
UA = {'User-Agent': 'Mozilla/5.0 (preview export)'}


def fetch(url, opener=None, raw=False):
    req = urllib.request.Request(url, headers=UA)
    try:
        body = (opener.open(req) if opener else urllib.request.urlopen(req)).read()
    except urllib.error.HTTPError as e:
        body = e.read()
    return body if raw else body.decode('utf-8')


# ------------------------------------------------------------------ link rewriting
def admin_file(path, query=''):
    """/admin/requests?status=new -> admin-requests--status-new.html"""
    if path in ('/admin', '/admin/'):
        name = 'admin'
    elif re.fullmatch(r'/admin/requests/\d+', path):
        name = 'admin-request-' + path.rsplit('/', 1)[1]
    else:
        name = 'admin-' + path[len('/admin/'):].strip('/').replace('/', '-')
    q = urllib.parse.parse_qsl(query)
    q = [(k, v) for k, v in q if k not in ('page',) or v != '1']
    if q:
        name += '--' + '-'.join(re.sub(r'[^a-z0-9]+', '', (k + '-' + v).lower()) for k, v in q)
    return name + '.html'


admin_queue = []      # admin addresses still to save
admin_seen = set()
photos = set()        # (token, thumb)


def fix_link(m):
    attr, url = m.group(1), m.group(2)
    url_h = url.replace('&amp;', '&')
    if url_h.startswith('/assets/') or url_h.startswith('/favicon') or url_h.startswith('/apple-touch'):
        needed.add(url_h.split('?')[0])
        return f'{attr}="{url_h.split("?")[0][1:]}"'
    if url_h == '/site.webmanifest':
        return f'{attr}="site.webmanifest"'
    if url_h == '/admin/app.webmanifest':
        return f'{attr}="admin.webmanifest"'
    path, _, frag = url_h.partition('#')
    path, _, query = path.partition('?')
    hashpart = ('#' + frag) if frag else ''
    if path.startswith('/admin'):
        if not ADMIN:
            return f'{attr}="index.html"'
        m2 = re.fullmatch(r'/admin/photo/(u[a-z0-9]+)', path)
        if m2:
            thumb = 's=thumb' in query
            photos.add((m2.group(1), thumb))
            return f'{attr}="admin-photos/{m2.group(1)}{"-thumb" if thumb else ""}.jpg"'
        if path in ('/admin/login', '/admin/setup', '/admin/logout'):
            return f'{attr}="admin-login.html"'
        if path == '/admin/export.csv':
            return f'{attr}="#" data-demo-off="The spreadsheet download works on the real admin."'
        key = path + ('?' + query if query else '')
        if key not in admin_seen:
            admin_seen.add(key)
            admin_queue.append(key)
        return f'{attr}="{admin_file(path, query)}{hashpart}"'
    if path in ROUTE_TO_FILE:
        q = '&'.join(p for p in query.split('&') if p and not p.startswith('site=')) if query else ''
        return f'{attr}="{ROUTE_TO_FILE[path]}{("?" + q) if q else ""}{hashpart}"'
    if url_h.startswith('/'):
        return f'{attr}="index.html"'
    return m.group(0)


def fix_srcset(m):
    attr, value = m.group(1), m.group(2)
    keep = []
    for part in [p.strip() for p in value.split(',') if p.strip()]:
        bits = part.split()
        url, w = bits[0], (bits[1] if len(bits) > 1 else '')
        width = int(w[:-1]) if w.endswith('w') and w[:-1].isdigit() else 0
        if width and width > MAXW:
            continue
        needed.add(url)
        keep.append(url.lstrip('/') + (' ' + w if w else ''))
    return f'{attr}="{", ".join(keep)}"'


maps_url = ''


def retire_lancaster_showcase(html):
    """Keep the removed showcase out of future exports, including share metadata."""
    hero = re.search(r'<figure class="hero-media">.*?</figure>', html, flags=re.S)
    if hero and 'Lancaster Court' in hero.group(0):
        photos = re.findall(r'<span class="ph"[^>]*><picture>.*?</picture></span>', html, flags=re.S)
        photo = next((p for p in photos if 'tour-crescent-' in p), None)
        if photo is None:
            raise ValueError('Cannot replace the retired showcase: The Crescent photo is missing')
        photo = photo.replace('class="ph"', 'class="ph hero-photo"', 1)
        photo = re.sub(r';aspect-ratio:[^";]+', '', photo)
        photo = re.sub(r' sizes="[^"]*"', ' sizes="(min-width: 900px) 58vw, 100vw"', photo)
        photo = photo.replace(' loading="lazy"', '').replace(' decoding="async"', ' decoding="sync"')
        photo = re.sub(r' style="view-transition-name:[^"]*"', '', photo)
        photo = photo.replace('<img ', '<img fetchpriority="high" ', 1)
        replacement = ('<figure class="hero-media">\n      ' + photo
                       + '\n      <figcaption class="photo-tag"><strong>The Crescent</strong> Custom Home</figcaption>\n    </figure>')
        html = html[:hero.start()] + replacement + html[hero.end():]
    html = re.sub(r'<meta property="og:image"[^>]*og-bedroom-[^>]*>\s*'
                  r'(?:<meta property="og:image:(?:width|height)"[^>]*>\s*)*', '', html)
    return html


def common(html, admin=False):
    global maps_url
    html = retire_lancaster_showcase(html)
    # Keep Brock's contact details and response wording in every preview export.
    for old, new in (
        ('825 S Huron Rd', '825 S Huron Road, Suite G'),
        ('825 South Huron Road', '825 S Huron Road, Suite G'),
        ('825 S. Huron Road, Suite G', '825 S Huron Road, Suite G'),
        ('1290 Willow Creek Dr', '1290 Willow Creek Drive'),
        ('845 Ridge Rd', '845 Ridge Road'),
        ('3317 Bay Ridge Ct', '3317 Bay Ridge Court'),
        ('2021 Autumn Leaf Ln', '2021 Autumn Leaf Lane'),
        ('Green Bay, WI 54311', 'Green Bay, Wisconsin 54311'),
        ('(920) 619-6170', '+1 (920) 498-3299'),
        ('+19206196170', '+19204983299'),
        ('within 24 working hours', 'as soon as possible'),
        ('We will get back to you as soon as possible', 'We’ll get back to you as soon as possible'),
        ('we will get back to you as soon as possible!', 'we’ll get back to you as soon as possible.'),
        ('We get back to you as soon as possible.', 'We’ll get back to you as soon as possible.'),
    ):
        html = html.replace(old, new)
    html = re.sub(r'<source type="image/avif"[^>]*>', '', html)
    html = re.sub(r'<link rel="preload" as="image"[^>]*>', '', html)
    html = re.sub(r'(srcset)="([^"]*)"', fix_srcset, html)
    html = re.sub(r'(imagesrcset)="([^"]*)"', fix_srcset, html)
    html = html.replace('action="/admin/logout"', 'action="index.html" data-demo-logout')
    m = re.search(r'href="(https://maps\.google\.com/\?cid=\d+)"', html)
    if m:
        maps_url = m.group(1)
    html = re.sub(r'\b(href|src|action)="([^"]*)"', fix_link, html)
    # the shim must run before any page script
    i = html.find('<script')
    if i < 0:
        i = html.index('</head>')
    html = html[:i] + '<script src="preview-shim.js"></script>\n<link rel="stylesheet" href="assets/css/preview.css">\n' + html[i:]
    html = re.sub(r'(Writable: )/[^<]*?/data\b', r'\1data', html)
    html = re.sub(r'<meta name="robots"[^>]*>', '', html)
    html = html.replace('<head>', '<head>\n<meta name="robots" content="noindex, nofollow">', 1)
    html = re.sub(r'<script type="application/ld\+json">.*?</script>', '', html, flags=re.S)
    html = re.sub(r'<title>(.*?)</title>', lambda t: '<title>Preview · ' + t.group(1) + '</title>', html, count=1, flags=re.S)
    if ARTIFACT:
        html = re.sub(r'<link rel="manifest"[^>]*>\s*', '', html)
        # this host blocks other websites inside the page, so Google's live map can't load here. In its place:
        # an unaltered capture of the same Google embed (Google's own attribution included), and a tap opens Google Maps.
        # Captured at 3x and saved lossless (tools/capture_map.py) so it stays sharp on phone screens.
        def shot(m):
            alt = 'Google map: Johnny B Home Construction Inc., 825 S Huron Road, Suite G, Green Bay'
            square = '<img src="assets/map/google-square.webp" width="1200" height="1200" alt="' + alt + '" loading="lazy" decoding="async">'
            if admin or 'data-map-square' in m.group(0):
                pic = square
            else:
                pic = ('<picture><source media="(min-width: 37.5em)" srcset="assets/map/google-wide.webp" width="1800" height="1350">'
                       + square + '</picture>')
            return f'<a class="map-shot" href="{maps_url}" target="_blank" rel="noopener">{pic}<span class="visually-hidden"> (opens Google Maps)</span></a>'
        html = re.sub(r'<iframe (?:data-map-square )?src="https://www\.google\.com/maps/embed[^"]*"[^>]*></iframe>', shot, html)
    return html


def banner(text):
    return lambda m: m.group(1) + '\n<div class="preview-banner" role="note">' + text + '</div>'


PUBLIC_BANNER = ('<strong>Preview</strong> of the new johnnybhome.com. Its forms don\'t send anything. '
                 '<span class="pb-more">Staff Sign-In (menu and footer) opens a demo of the admin.</span> '
                 '<a href="https://johnnybhome.com">Go to johnnybhome.com</a>')
ADMIN_BANNER = ('<strong>Admin demo</strong> with made-up sample requests and visitor numbers. '
                'Nothing you change here is saved. <a href="index.html">Back to the website preview</a>')

# ------------------------------------------------------------------ public pages
for name, path in PAGES.items():
    html = fetch(BASE + path)
    if ARTIFACT and name in ('contact.html', 'appointment.html', 'service.html'):
        # the contact pages' map sits in the narrow column, always square
        html = html.replace('<iframe src="https://www.google.com/maps/embed', '<iframe data-map-square src="https://www.google.com/maps/embed')
    if ADMIN:
        html = html.replace('href="/admin"', 'href="admin-login.html"')
    html = common(html)
    if not ADMIN:
        html = re.sub(r'\s*<p><a class="staff-button"[^>]*>.*?</a></p>', '', html, flags=re.S)
        html = re.sub(r'\s*<div class="wrap menu-staff"[^>]*>.*?</div>', '', html, flags=re.S)
    if ARTIFACT:
        html = html.replace('<p class="install-text">',
                            '<p class="install-preview"><strong>Preview:</strong> inside the Claude app this note can\'t add anything. '
                            'Open the GitHub preview (or the real website) in Safari to try it.</p>\n      <p class="install-text">', 1)
    html = re.sub(r'(<body[^>]*>)', banner(PUBLIC_BANNER), html, count=1)
    open(os.path.join(OUT, name), 'w').write(html)
    print('page', name, len(html))

# ------------------------------------------------------------------ admin demo
if ADMIN:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    # the sign-in page as staff see it, saved before signing in
    login_html = fetch(ADMIN + '/admin/login', opener)
    token = re.search(r'name="csrf" value="([^"]+)"', login_html) or re.search(r'name="_csrf" value="([^"]+)"', login_html)
    field = 'csrf' if 'name="csrf"' in login_html else '_csrf'
    pw = os.environ.get('DEMO_ADMIN_PASSWORD', '')
    if not token or not pw:
        sys.exit('could not sign in to the demo admin (csrf token or DEMO_ADMIN_PASSWORD missing)')
    data = urllib.parse.urlencode({field: token.group(1), 'password': pw, 'next': '', 'username': 'admin'}).encode()
    opener.open(urllib.request.Request(ADMIN + '/admin/login', data=data, headers=UA))
    if not any(c.name == 'jbh_admin' for c in jar):
        sys.exit('demo admin sign-in failed')

    note = ('<div class="demo-note" role="note"><strong>Demo:</strong> any password opens the sample admin here. '
            'The real admin only opens with your password.</div>')
    html = common(login_html, admin=True)
    html = html.replace('<form method="post" action="admin-login.html"', '<form method="post" action="admin-login.html" data-demo-login', 1)
    html = re.sub(r'(<p class="a-lede">.*?</p>)', lambda m: m.group(1) + '\n  ' + note, html, count=1, flags=re.S)
    html = re.sub(r'(<body[^>]*>)', banner(ADMIN_BANNER), html, count=1)
    open(os.path.join(OUT, 'admin-login.html'), 'w').write(html)

    admin_seen.add('/admin')
    admin_queue.append('/admin')
    saved = 0
    while admin_queue and saved < 120:
        # single requests last: opening one marks it read, and the lists should still show what's new
        later = [k for k in admin_queue if re.fullmatch(r'/admin/requests/\d+', k)]
        key = next((k for k in admin_queue if k not in later), admin_queue[0])
        admin_queue.remove(key)
        path, _, query = key.partition('?')
        if path.startswith('/admin/settings') and 'check_domain' not in query and query:
            continue
        page = fetch(ADMIN + key, opener)
        html = common(page, admin=True)
        html = re.sub(r'(<body[^>]*>)', banner(ADMIN_BANNER), html, count=1)
        out = admin_file(path, query)
        open(os.path.join(OUT, out), 'w').write(html)
        saved += 1
    print('admin pages', saved)
    os.makedirs(os.path.join(OUT, 'admin-photos'), exist_ok=True)
    for tok, thumb in sorted(photos):
        body = fetch(ADMIN + '/admin/photo/' + tok + ('?s=thumb' if thumb else ''), opener, raw=True)
        open(os.path.join(OUT, 'admin-photos', tok + ('-thumb' if thumb else '') + '.jpg'), 'wb').write(body)
    print('admin photos', len(photos))
    needed |= {'/assets/css/admin.css', '/assets/js/admin.js'}

# ------------------------------------------------------------------ files the pages need
if ARTIFACT:
    os.makedirs(os.path.join(OUT, 'assets/map'), exist_ok=True)
    for f in ('google-square.webp', 'google-wide.webp'):
        shutil.copyfile(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mapshots', f), os.path.join(OUT, 'assets/map', f))
needed |= {'/assets/fonts/montserrat.woff2', '/assets/js/photo-worker.js', '/assets/js/form.js', '/assets/js/site.js',
           '/assets/css/site.css', '/assets/brand/icon-192.png', '/assets/brand/icon-512.png',
           '/assets/brand/icon-maskable-512.png', '/apple-touch-icon.png'}
for url in sorted(needed):
    src = os.path.join(SITE, 'public', url.lstrip('/'))
    if not os.path.isfile(src):
        print('  missing', url)
        continue
    dst = os.path.join(OUT, url.lstrip('/'))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src, dst)

for css_name in ('site.css', 'admin.css'):
    css_path = os.path.join(OUT, 'assets/css', css_name)
    if os.path.isfile(css_path):
        css = open(css_path).read().replace('url("/assets/fonts/', 'url("../fonts/')
        open(css_path, 'w').write(css)


def patch(rel, pairs):
    p = os.path.join(OUT, rel)
    if not os.path.isfile(p):
        return
    s = open(p).read()
    for a, b in pairs:
        if a not in s:
            print('  ! patch not applied in', rel, ':', a[:60])
        s = s.replace(a, b)
    open(p, 'w').write(s)


patch('assets/js/form.js', [
    ("new Worker('/assets/js/photo-worker.js')", "new Worker('assets/js/photo-worker.js')"),
    ("var PATHS = { '': '/contact', appointment: '/appointment', service: '/service' };",
     "var PATHS = { '': 'contact.html', appointment: 'appointment.html', service: 'service.html' };"),
    ("var m = location.pathname === '/service' ? 'service' : location.pathname === '/appointment' ? 'appointment' : '';",
     "var m = /service/.test(location.pathname) ? 'service' : /appointment/.test(location.pathname) ? 'appointment' : '';"),
])
patch('assets/js/site.js', [
    ("location.href = '/contact';", "location.href = 'contact.html';"),
    ("navigator.serviceWorker.register('/sw.js')", "navigator.serviceWorker.register('sw.js')"),
])
patch('assets/js/admin.js', [
    ("customPreview.href = '/?scheme=custom&accent='", "customPreview.href = 'index.html?scheme=custom&accent='"),
    ("preview.href = '/?scheme='", "preview.href = 'index.html?scheme='"),
    ("navigator.serviceWorker.register('/sw.js')", "navigator.serviceWorker.register('sw.js')"),
])

# ------------------------------------------------------------------ home-screen app (GitHub copy only)
if not ARTIFACT:
    def manifest(src_path, start, extra_short=None):
        man = json.loads(fetch((ADMIN or BASE) + src_path) if src_path.startswith('/admin') else fetch(BASE + src_path))
        man['id'] = './' + start
        man['start_url'] = './' + start
        man['scope'] = './'
        for icon in man.get('icons', []):
            icon['src'] = icon['src'].lstrip('/')
            needed.add('/' + icon['src'])
        for sc in man.get('shortcuts', []):
            path = sc['url'].split('?')[0]
            sc['url'] = ROUTE_TO_FILE.get(path) or (admin_file(path) if path.startswith('/admin') else 'index.html')
            for icon in sc.get('icons', []):
                icon['src'] = icon['src'].lstrip('/')
        return man

    site_man = manifest('/site.webmanifest', 'index.html')
    site_man['name'] = site_man.get('name', 'Johnny B Home Construction') + ' (preview)'
    json.dump(site_man, open(os.path.join(OUT, 'site.webmanifest'), 'w'), indent=1)
    if ADMIN:
        admin_man = manifest('/admin/app.webmanifest', 'admin.html')
        admin_man['name'] = admin_man.get('name', 'JBHC Website Admin') + ' (demo)'
        json.dump(admin_man, open(os.path.join(OUT, 'admin.webmanifest'), 'w'), indent=1)
    sw = open(os.path.join(SITE, 'public/sw.js')).read().replace("const OFFLINE = '/offline';", "const OFFLINE = 'offline.html';")
    sw = sw.replace("const CACHE = 'jbhc-offline-1';", "const CACHE = 'jbhc-offline-2';")
    if "const OFFLINE = 'offline.html';" not in sw:
        sys.exit('sw.js: offline page path not found')
    open(os.path.join(OUT, 'sw.js'), 'w').write(sw)
    for url in sorted(needed):
        src = os.path.join(SITE, 'public', url.lstrip('/'))
        dst = os.path.join(OUT, url.lstrip('/'))
        if os.path.isfile(src) and not os.path.isfile(dst):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)

# ------------------------------------------------------------------ colour previews (?scheme=navy) without a server
schemes = {}
keys = json.loads(subprocess.run(['php', '-r', 'echo json_encode(array_keys(require $argv[1]));', '--',
                                  os.path.join(SITE, 'app/content/colors.php')], capture_output=True, text=True, check=True).stdout)
for key in keys:
    page = fetch(BASE + '/?scheme=' + key)
    css = re.search(r'<style>(:root\{[^<]*\})</style>', page)
    theme = re.search(r'<meta name="theme-color" content="([^"]+)"', page)
    if css:
        schemes[key] = {'css': css.group(1), 'theme': theme.group(1) if theme else ''}

shim = r"""/* Preview only. This copy has no server: photos stay on your device and sending a form
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
  var SCHEMES = __SCHEMES__;
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
""".replace('__SCHEMES__', json.dumps(schemes, separators=(',', ':')))
if ARTIFACT:
    shim += r"""
try { if (navigator.serviceWorker) navigator.serviceWorker.register = function () { return Promise.reject(new Error('preview')); }; } catch (e) { /* ignore */ }
// this host doesn't allow other websites inside the page, so the 3D tours say where they work
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-embed-load]');
  if (!b) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  var label = b.querySelector('span') || b;
  label.textContent = 'Opens on the live website';
}, true);
"""
open(os.path.join(OUT, 'preview-shim.js'), 'w').write(shim)
open(os.path.join(OUT, 'assets/css/preview.css'), 'w').write("""/* preview only */
.preview-banner { position: relative; z-index: 50; padding: 0.6rem 1rem; background: #f6d860; color: #171513; font: 500 0.875rem/1.45 Montserrat, Arial, sans-serif; text-align: center; }
.preview-banner a { color: #171513; font-weight: 700; }
.form-alert .alert-actions { display: none; }
.demo-note { padding: 0.85rem 1rem; border-radius: 0.9rem; background: #fdf3c4; color: #171513; font: 500 0.9375rem/1.5 Montserrat, Arial, sans-serif; }
.demo-toast { position: fixed; left: 50%; bottom: calc(1.25rem + env(safe-area-inset-bottom)); z-index: 100; width: min(92vw, 26rem); padding: 0.9rem 1.1rem; transform: translate(-50%, 1rem); border-radius: 1rem; background: #171513; color: #fff; font: 600 0.9375rem/1.45 Montserrat, Arial, sans-serif; box-shadow: 0 18px 40px -18px rgb(0 0 0 / 0.6); opacity: 0; transition: opacity 250ms, transform 300ms; }
.demo-toast.is-on { opacity: 1; transform: translate(-50%, 0); }
.admin .demo-toast { bottom: calc(5.5rem + env(safe-area-inset-bottom)); }
.install-preview { padding: 0.6rem 0.75rem; border-radius: 0.75rem; background: #fdf3c4; color: #171513; font-size: 0.875rem; line-height: 1.45; }
.map-shot { position: absolute; inset: 0; z-index: 2; display: block; }
.map-shot picture, .map-shot img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center; }
@media (max-width: 30em) { .pb-more { display: block; } }
""")
open(os.path.join(OUT, '.nojekyll'), 'w').write('')
open(os.path.join(OUT, 'README.md'), 'w').write("""# Preview of the new johnnybhome.com

A static copy of the new Johnny B Home Construction website, for review only.
It is **not** the live website: it is kept out of search engines, and its forms don't send
anything (photos stay on your device). The real site is https://johnnybhome.com.

- Staff Sign-In (menu and footer) opens a demo of the admin with made-up sample data.
  Nothing changed there is saved.
- Open it on a phone in Safari or Chrome to try Add to Home Screen.
""")
count = sum(len(f) for _, _, f in os.walk(OUT))
size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
print(f'{count} files, {size / 1e6:.1f} MB')
