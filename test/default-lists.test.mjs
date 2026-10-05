// Run: node test/default-lists.test.mjs
// Loads defaults.js + content.js in a Node vm with a fake DOM and checks, for real hostnames,
// whether a hover would start the timer (i.e. extension active) with the DEFAULT settings.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const defaultsSrc = read('defaults.js');
const contentSrc = read('content.js');

/** Would hovering `href` on a page at `pageHost` start the hover timer? */
function hoverStartsTimer(pageHost, href) {
  const timers = [];
  const handlers = {};
  class HTMLAnchorElement {}
  class Node {}
  const sandbox = {
    console, URL, URLSearchParams, Math, Number, String, Array, Object, Promise, JSON, Set, Map,
    HTMLAnchorElement, Node,
    setTimeout: (fn, ms) => (timers.push(ms), timers.length),
    clearTimeout() {},
    requestAnimationFrame() {},
    chrome: {
      storage: { sync: { get: (d, cb) => cb({ ...d }) }, onChanged: { addListener() {} } },
      runtime: { sendMessage() {}, lastError: null },
    },
    location: { hostname: pageHost, href: `https://${pageHost}/`, protocol: 'https:' },
    document: {
      addEventListener: (type, fn) => { handlers[type] = fn; },
      documentElement: { clientWidth: 1000, clientHeight: 700, append() {} },
    },
    addEventListener() {},
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(defaultsSrc, sandbox);
  vm.runInContext(contentSrc, sandbox);

  const link = Object.create(HTMLAnchorElement.prototype);
  Object.assign(link, {
    href,
    isConnected: true,
    getAttribute: (n) => (n === 'href' ? href : null),
    hasAttribute: () => false,
    contains: () => false,
  });
  handlers.mouseover({ composedPath: () => [link], clientX: 10, clientY: 10 });
  return timers.includes(5000);
}

let n = 0;
const page = (host, expectActive) => {
  assert.equal(hoverStartsTimer(host, 'https://example.org/x'), expectActive, `page ${host}: expected ${expectActive ? 'active' : 'excluded'}`);
  n++;
};
const dest = (href, expectActive) => {
  assert.equal(hoverStartsTimer('news.example.com', href), expectActive, `destination ${href}: expected ${expectActive ? 'preview' : 'denied'}`);
  n++;
};

// excluded pages (subdomains included)
for (const h of ['instagram.com', 'www.instagram.com', 'm.facebook.com', 'www.linkedin.com', 'x.com', 'web.telegram.org',
  'mail.google.com', 'docs.google.com', 'www.youtube.com', 'github.com', 'gist.github.com', 'console.aws.amazon.com',
  'www.amazon.in', 'acme.atlassian.net', 'accounts.google.com', 'www.paypal.com', 'app.slack.com', 'open.spotify.com']) page(h, false);

// pages where it must stay active
for (const h of ['www.google.com', 'aws.amazon.com', 'docs.aws.amazon.com', 'www.wikipedia.org', 'stackoverflow.com',
  'notinstagram.com', 'example.com', 'docs.pytorch.org', 'vercel.com', 'news.ycombinator.com', 'amazon.com']) page(h, true);

// destination deny-list defaults
for (const u of ['https://bit.ly/abc', 'https://t.co/xyz', 'https://lnkd.in/q', 'https://ad.doubleclick.net/x']) dest(u, false);
for (const u of ['https://example.org/a', 'https://github.com/fchollet/keras', 'https://bitly.com/x', 'https://not-t.co/x']) dest(u, true);

console.log(`default-lists: ${n} checks passed`);
