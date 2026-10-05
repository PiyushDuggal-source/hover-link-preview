// Decides whether a response's headers allow it to be embedded in an iframe
// on a given embedding page. Pure functions, no chrome.* APIs (unit-testable in Node).

const DEFAULT_PORTS = { 'http:': '80', 'https:': '443' };

function portOf(u) {
  return u.port || DEFAULT_PORTS[u.protocol] || '';
}

/** Does one CSP host/scheme source expression match the embedding page URL? */
function sourceMatches(src, pageUrl, resourceUrl) {
  if (src === '*') return /^https?:$/.test(pageUrl.protocol);
  if (src === "'self'") return pageUrl.origin === resourceUrl.origin;
  if (src === "'none'") return false;
  if (/^[a-z][a-z0-9+.-]*:$/.test(src)) return pageUrl.protocol === src; // scheme-source e.g. https:

  const m = src.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|\*\.[^/:]+|[^/:*]+)(?::(\*|\d+))?(?:\/.*)?$/);
  if (!m) return false;
  const [, scheme, host, port] = m;

  if (scheme && `${scheme}:` !== pageUrl.protocol) return false;
  if (!scheme && !/^https?:$/.test(pageUrl.protocol)) return false;

  const pageHost = pageUrl.hostname.toLowerCase();
  if (host === '*') {
    // any host
  } else if (host.startsWith('*.')) {
    const base = host.slice(2);
    if (!pageHost.endsWith(`.${base}`)) return false;
  } else if (pageHost !== host) {
    return false;
  }

  if (port && port !== '*' && port !== portOf(pageUrl)) return false;
  if (!port && portOf(pageUrl) !== DEFAULT_PORTS[pageUrl.protocol]) return false;
  return true;
}

/**
 * Parse CSP header text (possibly several policies joined with ", ").
 * Returns an array of frame-ancestors source lists (one per policy that sets it).
 */
export function frameAncestorPolicies(cspText) {
  if (!cspText) return [];
  const result = [];
  for (const policy of cspText.split(',')) {
    for (const directive of policy.split(';')) {
      const tokens = directive.trim().split(/\s+/).filter(Boolean);
      if (tokens.length && tokens[0].toLowerCase() === 'frame-ancestors') {
        result.push(tokens.slice(1).map((t) => t.toLowerCase()));
        break;
      }
    }
  }
  return result;
}

/**
 * https:// equivalent of an http:// URL, or null if there's no sane one
 * (custom port: we can't know which port serves https). Non-http URLs are returned unchanged.
 */
export function upgradeToHttps(url) {
  const u = new URL(url);
  if (u.protocol !== 'http:') return u.href;
  if (u.port && u.port !== '80') return null;
  u.protocol = 'https:';
  u.port = '';
  return u.href;
}

/**
 * @param {{get(name: string): string|null}} headers  response headers
 * @param {string} finalUrl   URL of the response (after redirects)
 * @param {string} pageUrl    URL of the page that will embed the iframe
 * @returns {{frameable: boolean, reason: string}}
 */
export function evaluateFraming(headers, finalUrl, pageUrl) {
  const resource = new URL(finalUrl);
  const page = new URL(pageUrl);

  const policies = frameAncestorPolicies(headers.get('content-security-policy'));
  if (policies.length) {
    // CSP frame-ancestors takes precedence over X-Frame-Options (as in Chrome).
    for (const sources of policies) {
      if (sources.length === 0 || sources.includes("'none'")) {
        return { frameable: false, reason: "CSP frame-ancestors 'none'" };
      }
      if (!sources.some((s) => sourceMatches(s, page, resource))) {
        return { frameable: false, reason: 'CSP frame-ancestors' };
      }
    }
    return { frameable: true, reason: 'csp-allows' };
  }

  const xfo = headers.get('x-frame-options');
  if (xfo) {
    for (const part of xfo.split(',')) {
      const v = part.trim().toLowerCase();
      if (v === 'deny') return { frameable: false, reason: 'X-Frame-Options: DENY' };
      if (v === 'sameorigin' && page.origin !== resource.origin) {
        return { frameable: false, reason: 'X-Frame-Options: SAMEORIGIN' };
      }
    }
  }
  return { frameable: true, reason: 'no-restriction' };
}
