/*
 * Johnny B Home Construction: service worker.
 *
 * It does one small job and nothing else: every page still comes straight from the
 * website, so nobody ever sees an old page. Only when the phone has no connection
 * does it show a saved "You're offline" page with the phone number and email.
 * Photos, styles, scripts and form sends are left entirely to the browser.
 *
 * To switch it off for everyone, replace this whole file with:
 *   self.addEventListener('install', () => self.skipWaiting());
 *   self.addEventListener('activate', () => self.registration.unregister());
 */
'use strict';

const CACHE = 'jbhc-offline-1';
const OFFLINE = 'offline.html';
let lastRefresh = 0;

function saveOfflinePage() {
  return caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE, { cache: 'reload' })));
}

// keep the saved copy current (phone number, hours, colours), at most once an hour
function refreshOfflinePage() {
  if (Date.now() - lastRefresh < 3600 * 1000) return Promise.resolve();
  lastRefresh = Date.now();
  return saveOfflinePage().catch(() => {});
}

self.addEventListener('install', (event) => {
  event.waitUntil(saveOfflinePage().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('jbhc-') && k !== CACHE).map((k) => caches.delete(k)));
    // lets the page request start while the worker wakes up, so pages are not slowed down
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.mode !== 'navigate' || request.method !== 'GET') return;
  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse;
      const response = preloaded || await fetch(request);
      event.waitUntil(refreshOfflinePage());
      return response;
    } catch (error) {
      const saved = await caches.match(OFFLINE);
      return saved || Response.error();
    }
  })());
});
