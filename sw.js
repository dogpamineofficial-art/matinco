/* Bump VERSION in sw.js and offline.js together when publishing changed assets. */
'use strict';
const VERSION = '2026-10-29.1';
const PREFIX = 'malmun-app-';
const SHELL_CACHE = PREFIX + VERSION + '-shell';
const AUDIO_CACHE = PREFIX + 'audio-v1';
const BASE = new URL(self.registration.scope);
const SHELL_FILES = [
  './', 'index.html', 'refined.css', 'experience.js', 'particles.js',
  'offline.js', 'speech-pack.js', 'assets/kyoto-evening.png',
  'manifest.webmanifest', 'icons/app.svg', 'icons/app-192.png', 'icons/app-512.png', 'assets/fonts/font.css', 'assets/fonts/gowun-batang-subset.ttf'
];
const shellURLs = SHELL_FILES.map(path => new URL(path, BASE).href);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function timedFetch(request, timeout = 12000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(request, { signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function cacheShellFile(cache, url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await timedFetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
      if (!response.ok || response.type === 'opaque') throw new Error('HTTP ' + response.status);
      const type = response.headers.get('content-type') || '';
      if (/\.(?:js|css|png|svg|webmanifest|ttf)$/.test(new URL(url).pathname) && type.includes('text/html')) {
        throw new Error('Asset returned an HTML fallback');
      }
      await cache.put(url, response);
      return true;
    } catch (_) {
      if (attempt < 2) await delay(300 * (attempt + 1));
    }
  }
  return Boolean(await cache.match(url));
}

async function prepareShell() {
  const cache = await caches.open(SHELL_CACHE);
  const missing = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < shellURLs.length) {
      const url = shellURLs[cursor++];
      if (!await cacheShellFile(cache, url)) missing.push(url);
    }
  }));
  return { type: 'SHELL_STATUS', version: VERSION, ready: missing.length === 0, missing };
}

async function shellStatus() {
  const cache = await caches.open(SHELL_CACHE);
  const missing = [];
  for (const url of shellURLs) if (!await cache.match(url)) missing.push(url);
  return { type: 'SHELL_STATUS', version: VERSION, ready: missing.length === 0, missing };
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const state = await prepareShell();
    // An incomplete update must not displace an older working offline version.
    if (!state.ready) throw new Error('Offline shell incomplete: ' + state.missing.length + ' files');
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Only this application's obsolete caches may be removed.
    const keep = new Set([SHELL_CACHE, AUDIO_CACHE]);
    await Promise.all((await caches.keys()).filter(name => name.startsWith(PREFIX) && !keep.has(name)).map(name => caches.delete(name)));
    await self.clients.claim();
    const state = await shellStatus();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.postMessage(state);
  })());
});

self.addEventListener('message', event => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') { event.waitUntil(self.skipWaiting()); return; }
  if (type !== 'SHELL_STATUS' && type !== 'PRECACHE_SHELL') return;
  event.waitUntil((async () => {
    let state;
    try { state = await (type === 'PRECACHE_SHELL' ? prepareShell() : shellStatus()); }
    catch (error) { state = { type: 'SHELL_STATUS', version: VERSION, ready: false, missing: [], error: String(error.message || error) }; }
    if (event.ports && event.ports[0]) event.ports[0].postMessage(state);
    else if (event.source) event.source.postMessage(state);
  })());
});

async function networkFirst(request, cacheName, event, navigation) {
  const cache = await caches.open(cacheName);
  try {
    const response = await timedFetch(request, navigation ? 6000 : 12000);
    if (response.status >= 500) throw new Error('Server unavailable');
    if (response.ok && response.type !== 'opaque') {
      event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
    }
    return response;
  } catch (_) {
    const cached = await cache.match(request) || (navigation && await cache.match(new URL('index.html', BASE).href));
    return cached || new Response(navigation ? '인터넷에 연결한 뒤 말문일본어를 한 번 열어 주세요.' : 'Offline asset unavailable', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function rangeResponse(response, range) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (!match || (!match[1] && !match[2])) return response;
  const data = await response.arrayBuffer(), size = data.byteLength;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end || end < 0) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  const headers = new Headers(response.headers);
  headers.delete('Content-Encoding');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(data.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers });
}

async function cacheFirst(request, cacheName, event, audio) {
  const cache = await caches.open(cacheName);
  // Cache keys do not include Range; stored audio is always the complete file.
  const cached = await cache.match(request.url);
  if (cached) return audio && request.headers.has('Range') ? rangeResponse(cached, request.headers.get('Range')) : cached;
  try {
    const response = await fetch(request);
    const type = response.headers.get('content-type') || '';
    if (response.status === 200 && response.type !== 'opaque' && !type.includes('text/html')) {
      event.waitUntil(cache.put(request.url, response.clone()).catch(() => {}));
    }
    return response;
  } catch (_) {
    return new Response('Offline asset unavailable', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, event, true));
  } else if (url.href === new URL('audio/manifest.json', BASE).href) {
    event.respondWith(networkFirst(request, AUDIO_CACHE, event, false));
  } else if (url.pathname.startsWith(new URL('audio/', BASE).pathname) && /\.mp3$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request, AUDIO_CACHE, event, true));
  } else if (/\.(?:js|css|png|jpe?g|webp|gif|svg|ico|webmanifest|woff2?|ttf|otf)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE, event, false));
  }
  // Cross-origin fonts and resources, APIs, and non-GET requests are untouched.
});
