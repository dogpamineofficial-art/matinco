/* Optional offline features. Keep VERSION in sync with sw.js. */
(() => {
  'use strict';
  const VERSION = '2026-10-29.2';
  const AUDIO_CACHE = 'malmun-app-audio-v1';
  const BASE = new URL('./', document.currentScript && document.currentScript.src || document.baseURI);
  const MANIFEST = new URL('audio/manifest.json', BASE).href;
  const supported = Boolean(window.isSecureContext && 'serviceWorker' in navigator && 'caches' in window);
  const state = window.offlineState = {
    version: VERSION, supported, online: navigator.onLine, serviceWorker: supported ? 'pending' : 'unsupported',
    shellReady: false, shellMissing: [], updateAvailable: false,
    audio: { status: 'idle', total: 0, completed: 0, failed: 0 }
  };
  let registration = null, registering = null, audioJob = null, progressListener = null;
  const snapshot = () => ({ ...state, shellMissing: [...state.shellMissing], audio: { ...state.audio } });
  function publish() { window.dispatchEvent(new CustomEvent('malmun:offline', { detail: snapshot() })); }
  function notify(message) { if (typeof toast === 'function') toast(message); }
  function progress(values) {
    Object.assign(state.audio, values); publish();
    if (typeof progressListener === 'function') {
      try { progressListener({ ...state.audio }); } catch (_) { /* UI callbacks must not cancel a download. */ }
    }
  }
  function acceptShell(data) {
    if (!data || data.type !== 'SHELL_STATUS') return;
    state.shellReady = Boolean(data.ready);
    state.shellMissing = Array.isArray(data.missing) ? data.missing : [];
    state.serviceWorker = data.error ? 'error' : 'ready';
    if (data.version && data.version !== VERSION) state.updateAvailable = true;
    publish();
  }
  function askWorker(type) {
    const worker = navigator.serviceWorker.controller || registration && registration.active;
    if (!worker) return Promise.resolve(null);
    return new Promise(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 12000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); acceptShell(event.data); resolve(event.data); };
      try { worker.postMessage({ type }, [channel.port2]); }
      catch (_) { clearTimeout(timer); channel.port1.close(); resolve(null); }
    });
  }

  function clipURLs(manifest) {
    if (!manifest || !manifest.clips || typeof manifest.clips !== 'object' || Array.isArray(manifest.clips)) {
      throw new Error('음성 목록을 읽지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
    }
    const audioPath = new URL('audio/', BASE).pathname;
    const urls = Object.values(manifest.clips).map(path => {
      if (typeof path !== 'string') throw new Error('음성 목록의 파일 경로가 올바르지 않아요.');
      const url = new URL(path, BASE);
      if (url.origin !== BASE.origin || !url.pathname.startsWith(audioPath) || !/\.mp3$/i.test(url.pathname)) {
        throw new Error('음성 목록에 지원하지 않는 파일이 있어요.');
      }
      return url.href;
    });
    if (!urls.length) throw new Error('저장할 음성 파일이 아직 없어요.');
    return [...new Set(urls)];
  }

  async function inspectAudio() {
    try {
      const cache = await caches.open(AUDIO_CACHE), stored = await cache.match(MANIFEST);
      if (!stored) return;
      const urls = clipURLs(await stored.json()), keys = new Set((await cache.keys()).map(request => request.url));
      const completed = urls.filter(url => keys.has(url)).length;
      progress({ status: completed === urls.length ? 'ready' : completed ? 'partial' : 'idle', total: urls.length, completed, failed: 0 });
    } catch (_) { /* Missing, evicted, or older caches simply need downloading again. */ }
  }

  async function fetchAudioFile(cache, url) {
    if (await cache.match(url)) return true;
    if (!navigator.onLine) return false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(url, { cache: 'reload', credentials: 'same-origin', signal: controller.signal });
        if (response.status !== 200 || response.type === 'opaque' || (response.headers.get('content-type') || '').includes('text/html')) {
          throw new Error('Invalid audio response');
        }
        if (!Number(response.headers.get('content-length')) && !(await response.clone().arrayBuffer()).byteLength) throw new Error('Empty audio');
        await cache.put(url, response);
        return true;
      } catch (_) {
        if (attempt === 0 && navigator.onLine) await new Promise(resolve => setTimeout(resolve, 400));
      } finally { clearTimeout(timer); }
    }
    return false;
  }

  window.prepareOfflineAudio = function(onProgress) {
    progressListener = typeof onProgress === 'function' ? onProgress : null;
    if (audioJob) {
      if (progressListener) progressListener({ ...state.audio });
      return audioJob;
    }
    audioJob = (async () => {
      if (!supported) {
        progress({ status: 'unsupported', total: 0, completed: 0, failed: 0 });
        throw new Error('음성 저장은 HTTPS 또는 localhost에서 지원하는 브라우저로 열어 주세요.');
      }
      progress({ status: 'preparing', total: 0, completed: 0, failed: 0 });
      let manifest;
      try {
        const cache = await caches.open(AUDIO_CACHE);
        let response;
        try {
          const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
          try { response = await fetch(MANIFEST, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal }); }
          finally { clearTimeout(timer); }
          if (!response.ok) throw new Error('Manifest fetch failed');
          manifest = await response.clone().json(); clipURLs(manifest);
          await cache.put(MANIFEST, response);
        } catch (_) {
          response = await cache.match(MANIFEST);
          if (!response) throw new Error('음성 목록을 받지 못했어요. 인터넷에 연결한 뒤 다시 시도해 주세요.');
          manifest = await response.json();
        }
        const urls = clipURLs(manifest);
        progress({ status: 'downloading', total: urls.length, completed: 0, failed: 0 });
        let cursor = 0, completed = 0, failed = 0;
        await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
          while (cursor < urls.length) {
            const url = urls[cursor++];
            if (await fetchAudioFile(cache, url)) completed++; else failed++;
            progress({ completed, failed });
          }
        }));
        progress({ status: failed ? 'partial' : 'ready', completed, failed });
        notify(failed ? '일부 음성을 받지 못했어요. 다시 누르면 나머지만 저장합니다.' : '기본 음성을 저장했어요. 인터넷 없이 다시 들을 수 있어요.');
        return { ...state.audio };
      } catch (error) {
        progress({ status: 'error' });
        throw error;
      }
    })().finally(() => { audioJob = null; progressListener = null; });
    return audioJob;
  };

  async function register() {
    if (!supported) return null;
    if (registering) return registering;
    registering = (async () => {
      try {
        registration = await navigator.serviceWorker.register(new URL('sw.js', BASE).href, { scope: BASE.pathname, updateViaCache: 'none' });
        state.serviceWorker = 'registered'; publish();
        if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        const watched = new WeakSet();
        const watchInstall = () => {
          const installing = registration.installing;
          if (!installing || watched.has(installing)) return;
          watched.add(installing);
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed') {
              state.updateAvailable = Boolean(navigator.serviceWorker.controller); publish();
              if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            } else if (installing.state === 'redundant' && !registration.active) {
              state.serviceWorker = 'error'; publish();
            }
          });
        };
        registration.addEventListener('updatefound', watchInstall);
        watchInstall();
        if (registration.active) await askWorker('SHELL_STATUS');
        return registration;
      } catch (_) { state.serviceWorker = 'error'; publish(); return null; }
      finally { registering = null; }
    })();
    return registering;
  }

  if (supported) {
    navigator.serviceWorker.addEventListener('message', event => acceptShell(event.data));
    navigator.serviceWorker.addEventListener('controllerchange', () => { askWorker('SHELL_STATUS'); });
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    inspectAudio();
  }
  window.addEventListener('online', async () => {
    state.online = true; publish(); notify('인터넷에 다시 연결됐어요.');
    const current = registration || await register();
    if (current) current.update().catch(() => {});
    if (!state.shellReady) askWorker('PRECACHE_SHELL');
  });
  window.addEventListener('offline', () => {
    state.online = false; publish();
    notify(state.shellReady ? '오프라인이에요. 저장된 학습과 음성은 계속 사용할 수 있어요.' : '오프라인이에요. 연결되면 학습 자료를 저장할게요.');
  });
  publish();
})();
