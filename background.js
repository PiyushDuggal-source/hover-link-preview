// Service worker: pre-checks whether a target URL permits being framed,
// so the content script can show a fallback card instead of a broken iframe.
import { evaluateFraming, upgradeToHttps } from './lib/frame-check.js';

const TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 60_000;
const cache = new Map(); // key -> {at, result}

function isHttp(url) {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
}

async function fetchHeaders(url, method) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      credentials: 'include',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    // We only need headers; drop the body.
    ctrl.abort();
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function check(url, pageUrl) {
  const key = `${pageUrl}\n${url}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  // Browsers block http:// iframes on https:// pages (mixed content), so try the https:// version.
  const mixed = new URL(pageUrl).protocol === 'https:' && new URL(url).protocol === 'http:';
  const frameUrl = mixed ? upgradeToHttps(url) : url;
  if (!frameUrl) {
    return remember(key, { frameable: false, reason: 'http link on a secure page; no https version could be tried (custom port)' });
  }

  let res = null;
  try {
    res = await fetchHeaders(frameUrl, 'HEAD');
    if (!res.ok) res = null; // some servers reject HEAD; retry with GET
  } catch {
    res = null;
  }
  if (!res) {
    try {
      res = await fetchHeaders(frameUrl, 'GET');
    } catch {
      res = null;
    }
  }

  if (mixed) {
    const finalUrl = res?.url || '';
    if (!res || !finalUrl.startsWith('https:')) {
      return remember(key, { frameable: false, reason: 'This site has no https version, and browsers block http pages inside secure pages' });
    }
  }

  // Unknown (network error, etc.) -> let the iframe try.
  const result = res
    ? { ...evaluateFraming(res.headers, res.url || frameUrl, pageUrl), frameUrl }
    : { frameable: true, reason: 'unknown', frameUrl };

  return remember(key, result);
}

function remember(key, result) {
  cache.set(key, { at: Date.now(), result });
  return result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'checkFrameable') return false;
  if (!isHttp(msg.url) || !isHttp(msg.pageUrl)) {
    sendResponse({ frameable: false, reason: 'unsupported-url' });
    return false;
  }
  check(msg.url, msg.pageUrl).then(sendResponse, () => sendResponse({ frameable: true, reason: 'error' }));
  return true; // async response
});
