// Content script: hover a link for N seconds -> in-page popup preview.
(() => {
  'use strict';
  if (window.top !== window) return;
  if (window.__hoverPreviewLoaded) return;
  window.__hoverPreviewLoaded = true;

  const DEFAULTS = HLP_DEFAULTS; // from defaults.js
  const SIZES = { small: [360, 270], medium: [480, 360], large: [640, 480], xl: [800, 600] };
  const GRACE_MS = 300; // time allowed to travel between link and popup
  const MARGIN = 12; // min px from viewport edge
  const CURSOR_GAP = 16; // px between the cursor and the popup's near edge
  const MAX_STICKY = 6; // oldest sticky popup is dropped beyond this
  const Z_BASE = 2147483000;
  const CHECK_TIMEOUT_MS = 8000;

  let settings = normalize(DEFAULTS);
  let hoverLink = null;
  let hoverX = 0;
  let hoverY = 0;
  let hoverTimer = null;
  let closeTimer = null;
  let checkToken = 0;
  let popups = []; // [{ host, link, href, w, h, sticky, dragging }] oldest -> frontmost
  let zTop = 0;

  // ---------- settings ----------

  function parseDomainList(text) {
    return String(text || '')
      .split('\n')
      .map((l) => l.replace(/#.*/, '').trim().toLowerCase())
      .map((l) => l.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#:].*$/, '').replace(/^\*?\./, ''))
      .filter(Boolean);
  }

  function normalize(raw) {
    const s = { ...DEFAULTS, ...raw };
    const delay = Number(s.delaySec);
    s.delaySec = Number.isFinite(delay) ? Math.min(30, Math.max(1, delay)) : DEFAULTS.delaySec;
    if (!SIZES[s.size]) s.size = DEFAULTS.size;
    s.keepOnScreen = s.keepOnScreen === true;
    if (s.listMode !== 'allow') s.listMode = 'deny';
    s.domainList = parseDomainList(s.domains);
    s.excludedList = parseDomainList(s.excludedSites);
    return s;
  }

  function loadSettings() {
    try {
      chrome.storage.sync.get(DEFAULTS, (s) => {
        settings = normalize(s || DEFAULTS);
        if (!settings.enabled || pageExcluded()) cancelAll();
      });
    } catch {
      /* extension context invalidated */
    }
  }

  loadSettings();
  try {
    chrome.storage.onChanged.addListener(loadSettings);
  } catch {
    /* ignore */
  }

  // ---------- link filtering ----------

  function domainMatches(host, domain) {
    return host === domain || host.endsWith(`.${domain}`);
  }

  // Is the page we're browsing on the excluded-websites list? (extension does nothing there)
  function pageExcluded() {
    const host = location.hostname.toLowerCase();
    return settings.excludedList.some((d) => domainMatches(host, d));
  }

  function stripHash(u) {
    const c = new URL(u.href);
    c.hash = '';
    return c.href;
  }

  function parseEligibleUrl(link) {
    if (!settings.enabled || pageExcluded()) return null;
    let url;
    try {
      url = new URL(link.href);
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (link.hasAttribute('download')) return null;

    const rawHref = link.getAttribute('href') || '';
    if (rawHref.trim().startsWith('#')) return null;
    if (url.hash && stripHash(url) === stripHash(location)) return null;

    const host = url.hostname.toLowerCase();
    const listed = settings.domainList.some((d) => domainMatches(host, d));
    if (settings.listMode === 'deny' && listed) return null;
    if (settings.listMode === 'allow' && !listed) return null;
    return url;
  }

  function findLink(e) {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    for (const n of path) {
      if (n instanceof HTMLAnchorElement) return n;
    }
    return null;
  }

  // ---------- hover tracking ----------

  function clearHoverTimer() {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  }

  function clearCloseTimer() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimer = setTimeout(() => {
      closeTimer = null;
      const t = transient();
      if (t && !t.dragging) closePopup(t);
    }, GRACE_MS);
  }

  // The popup that auto-closes on hover-out (only exists when "keep on screen" is off).
  function transient() {
    return popups.find((p) => !p.sticky);
  }

  function cancelAll() {
    clearHoverTimer();
    clearCloseTimer();
    checkToken++;
    closeAll();
  }

  function onOver(e) {
    const link = findLink(e);
    if (!link) return;
    hoverX = e.clientX;
    hoverY = e.clientY;
    if (link === hoverLink) {
      const t = transient();
      if (t && t.link === link) clearCloseTimer();
      return;
    }
    enterLink(link);
  }

  function onOut(e) {
    const link = findLink(e);
    if (!link || link !== hoverLink) return;
    const rel = e.relatedTarget;
    if (rel instanceof Node && link.contains(rel)) return; // moved within the same link
    leaveLink();
  }

  function enterLink(link) {
    hoverLink = link;
    clearHoverTimer();
    checkToken++;

    const t = transient();
    if (t && t.link === link) {
      clearCloseTimer();
      return;
    }
    if (t) scheduleClose(); // previous hover popup closes after grace

    if (!parseEligibleUrl(link)) return;
    hoverTimer = setTimeout(() => openFor(link), settings.delaySec * 1000);
  }

  function leaveLink() {
    const link = hoverLink;
    hoverLink = null;
    clearHoverTimer();
    checkToken++; // abort any in-flight frame check
    const t = transient();
    if (t && t.link === link) scheduleClose();
  }

  // ---------- opening ----------

  function getFrameInfo(url) {
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({ frameable: true, reason: 'timeout' }), CHECK_TIMEOUT_MS)
    );
    const ask = new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'checkFrameable', url: url.href, pageUrl: location.href },
          (res) => {
            if (chrome.runtime.lastError || !res) resolve({ frameable: true, reason: 'no-response' });
            else resolve(res);
          }
        );
      } catch {
        resolve({ frameable: true, reason: 'no-background' });
      }
    });
    return Promise.race([ask, timeout]);
  }

  async function openFor(link) {
    hoverTimer = null;
    if (hoverLink !== link || !link.isConnected) return;
    const url = parseEligibleUrl(link); // re-evaluate with latest settings
    if (!url) return;

    const token = ++checkToken;
    const info = await getFrameInfo(url);
    if (token !== checkToken || hoverLink !== link || !link.isConnected) return;
    if (settings.keepOnScreen) {
      const existing = popups.find((p) => p.href === url.href);
      if (existing) return bringToFront(existing); // don't open duplicates
    }
    showPopup(link, url, info);
  }

  // ---------- popup UI ----------

  const CSS = `
    :host { all: initial; position: fixed; z-index: 2147483647; display: block; }
    .box { box-sizing: border-box; width: 100%; height: 100%; display: flex; flex-direction: column;
      background: #fff; color: #1f2328; border: 1px solid #c9ced6; border-radius: 10px; overflow: hidden;
      box-shadow: 0 10px 30px rgba(0,0,0,.28); font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; }
    .bar { flex: 0 0 34px; display: flex; align-items: center; gap: 6px; padding: 0 6px 0 10px;
      background: #f3f4f6; border-bottom: 1px solid #e1e4e8; cursor: grab; user-select: none; touch-action: none; }
    .bar.dragging { cursor: grabbing; }
    .url { pointer-events: none; }
    .url { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #57606a; font-size: 12px; }
    button { all: unset; box-sizing: border-box; cursor: pointer; padding: 4px 8px; border-radius: 6px;
      font: 12px system-ui, sans-serif; color: #1f2328; }
    button:hover { background: #e1e4e8; }
    button.primary { background: #0969da; color: #fff; padding: 6px 12px; font-size: 13px; }
    button.primary:hover { background: #0757b8; }
    .body { position: relative; flex: 1; min-height: 0; background: #fff; }
    .loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #8c959f; }
    iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #fff; }
    .card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 10px; padding: 20px; text-align: center; }
    .card img { width: 32px; height: 32px; }
    .card .u { max-width: 100%; word-break: break-all; font-weight: 600; }
    .card .note { color: #cf222e; font-weight: 600; }
    .card .why { color: #8c959f; font-size: 12px; }
  `;

  function el(tag, props = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else n.setAttribute(k, v);
    }
    for (const c of children) n.append(c);
    return n;
  }

  function buildFallback(url, reason) {
    const icon = el('img', { alt: '', src: new URL('/favicon.ico', url.origin).href });
    icon.addEventListener('error', () => icon.remove());
    const open = el('button', { class: 'primary', type: 'button', text: 'Open in new tab' });
    open.addEventListener('click', () => openInTab(url));
    return el('div', { class: 'card' }, [
      icon,
      el('div', { class: 'u', text: url.href }),
      el('div', { class: 'note', text: 'Blocked by site' }),
      el('div', { class: 'why', text: reason || '' }),
      open,
    ]);
  }

  function openInTab(url) {
    window.open(url.href, '_blank', 'noopener,noreferrer');
  }

  function showPopup(link, url, info) {
    const sticky = settings.keepOnScreen;
    if (!sticky) {
      closeAll(); // hover mode: exactly one popup at a time
    } else {
      while (popups.length >= MAX_STICKY) closePopup(popups[0]);
    }

    const [w0, h0] = SIZES[settings.size];
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = Math.min(w0, vw - MARGIN * 2);
    const h = Math.min(h0, vh - MARGIN * 2);

    const host = document.createElement('div');
    host.setAttribute('data-hover-preview', '');
    const root = host.attachShadow({ mode: 'open' });
    root.append(el('style', { text: CSS }));

    const p = { host, link, href: url.href, w, h, sticky, dragging: false };

    const openBtn = el('button', { type: 'button', title: 'Open in new tab', text: '↗ Open' });
    openBtn.addEventListener('click', () => openInTab(url));
    const closeBtn = el('button', { type: 'button', title: 'Close', text: '✕' });
    closeBtn.addEventListener('click', () => closePopup(p));
    const bar = el('div', { class: 'bar', title: 'Drag to move' }, [
      el('div', { class: 'url', text: url.href }),
      openBtn,
      closeBtn,
    ]);
    enableDrag(p, bar);

    const body = el('div', { class: 'body' });
    if (info.frameable) {
      body.append(el('div', { class: 'loading', text: 'Loading…' }));
      body.append(
        el('iframe', {
          src: info.frameUrl || url.href, // https:// upgrade for http links on https pages
          sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox',
          referrerpolicy: 'strict-origin-when-cross-origin',
          title: 'Link preview',
        })
      );
    } else {
      body.append(buildFallback(url, info.reason));
    }
    root.append(el('div', { class: 'box' }, [bar, body]));

    // Hover-mode only: keep alive while the mouse is over the popup.
    host.addEventListener('mouseenter', () => !p.sticky && clearCloseTimer());
    host.addEventListener('mouseleave', () => !p.sticky && !p.dragging && scheduleClose());
    host.addEventListener('pointerdown', () => bringToFront(p), true);

    placeBesideCursor(p);
    popups.push(p);
    bringToFront(p);
    document.documentElement.append(host);
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

  // Initial position: beside the cursor (right of it, or left if there's no room),
  // vertically centered on the cursor. Always clamped inside the viewport.
  function placeBesideCursor(p) {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left = hoverX + CURSOR_GAP;
    if (left + p.w + MARGIN > vw) left = hoverX - CURSOR_GAP - p.w; // flip to the left side
    left = clamp(left, MARGIN, Math.max(MARGIN, vw - p.w - MARGIN));
    const top = clamp(hoverY - p.h / 2, MARGIN, Math.max(MARGIN, vh - p.h - MARGIN));
    setBox(p, left, top);
  }

  function setBox(p, left, top) {
    p.host.style.left = `${Math.round(left)}px`;
    p.host.style.top = `${Math.round(top)}px`;
    p.host.style.width = `${p.w}px`;
    p.host.style.height = `${p.h}px`;
  }

  function bringToFront(p) {
    zTop = Math.min(zTop + 1, 640);
    p.host.style.zIndex = String(Z_BASE + zTop);
    const i = popups.indexOf(p);
    if (i !== -1 && i !== popups.length - 1) {
      popups.splice(i, 1);
      popups.push(p); // array order == stacking order (Esc closes the last one)
    }
  }

  function enableDrag(p, bar) {
    let dx = 0;
    let dy = 0;
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const r = p.host.getBoundingClientRect();
      dx = e.clientX - r.left;
      dy = e.clientY - r.top;
      p.dragging = true;
      bar.classList.add('dragging');
      bar.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    bar.addEventListener('pointermove', (e) => {
      if (!p.dragging) return;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      setBox(p, clamp(e.clientX - dx, 0, vw - p.w), clamp(e.clientY - dy, 0, vh - p.h));
    });
    const end = (e) => {
      if (!p.dragging) return;
      p.dragging = false;
      bar.classList.remove('dragging');
      if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId);
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  }

  function closePopup(p) {
    if (!p) return;
    const i = popups.indexOf(p);
    if (i !== -1) popups.splice(i, 1);
    p.host.remove();
    if (!popups.length) zTop = 0;
  }

  function closeAll() {
    clearCloseTimer();
    while (popups.length) closePopup(popups[0]);
  }

  // ---------- wiring ----------

  document.addEventListener(
    'mousemove',
    (e) => {
      hoverX = e.clientX;
      hoverY = e.clientY;
    },
    { capture: true, passive: true }
  );
  document.addEventListener('mouseover', onOver, true);
  document.addEventListener('mouseout', onOut, true);
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && popups.length) closePopup(popups[popups.length - 1]);
    },
    true
  );
  window.addEventListener('resize', () => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    for (const p of popups) {
      const r = p.host.getBoundingClientRect();
      setBox(p, clamp(r.left, 0, Math.max(0, vw - p.w)), clamp(r.top, 0, Math.max(0, vh - p.h)));
    }
  });
  window.addEventListener('pagehide', cancelAll);
})();
