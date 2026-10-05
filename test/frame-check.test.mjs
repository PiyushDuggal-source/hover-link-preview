// Run: node test/frame-check.test.mjs
import assert from 'node:assert/strict';
import { evaluateFraming, upgradeToHttps } from '../lib/frame-check.js';

const H = (o) => ({ get: (n) => o[n.toLowerCase()] ?? null });
const page = 'https://news.example.org/story';
let n = 0;
const t = (name, headers, final, expected, pageUrl = page) => {
  const r = evaluateFraming(H(headers), final, pageUrl);
  assert.equal(r.frameable, expected, `${name}: got ${JSON.stringify(r)}`);
  n++;
};

t('no headers', {}, 'https://a.com/', true);
t('XFO DENY', { 'x-frame-options': 'DENY' }, 'https://a.com/', false);
t('XFO deny lowercase', { 'x-frame-options': 'deny' }, 'https://a.com/', false);
t('XFO SAMEORIGIN cross', { 'x-frame-options': 'SAMEORIGIN' }, 'https://a.com/', false);
t('XFO SAMEORIGIN same', { 'x-frame-options': 'SAMEORIGIN' }, 'https://news.example.org/x', true);
t('CSP none', { 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" }, 'https://a.com/', false);
t('CSP self cross', { 'content-security-policy': "frame-ancestors 'self'" }, 'https://a.com/', false);
t('CSP self same', { 'content-security-policy': "frame-ancestors 'self'" }, 'https://news.example.org/', true);
t('CSP star', { 'content-security-policy': 'frame-ancestors *' }, 'https://a.com/', true);
t('CSP host match', { 'content-security-policy': 'frame-ancestors https://news.example.org' }, 'https://a.com/', true);
t('CSP host wildcard', { 'content-security-policy': 'frame-ancestors https://*.example.org' }, 'https://a.com/', true);
t('CSP wildcard not apex', { 'content-security-policy': 'frame-ancestors *.news.example.org' }, 'https://a.com/', false);
t('CSP host mismatch', { 'content-security-policy': 'frame-ancestors https://other.com' }, 'https://a.com/', false);
t('CSP scheme src', { 'content-security-policy': 'frame-ancestors https:' }, 'https://a.com/', true);
t('CSP scheme mismatch', { 'content-security-policy': 'frame-ancestors http://news.example.org' }, 'https://a.com/', false);
t('CSP w/o frame-ancestors + XFO deny', { 'content-security-policy': "default-src 'self'", 'x-frame-options': 'DENY' }, 'https://a.com/', false);
t('CSP allows beats XFO', { 'content-security-policy': 'frame-ancestors *', 'x-frame-options': 'DENY' }, 'https://a.com/', true);
t('CSP unrelated only', { 'content-security-policy': "script-src 'self'" }, 'https://a.com/', true);
t('two policies, second blocks', { 'content-security-policy': "frame-ancestors *, frame-ancestors 'none'" }, 'https://a.com/', false);
t('port mismatch', { 'content-security-policy': 'frame-ancestors https://news.example.org:8443' }, 'https://a.com/', false);
t('port star', { 'content-security-policy': 'frame-ancestors https://news.example.org:*' }, 'https://a.com/', true);

const up = (input, expected) => { assert.equal(upgradeToHttps(input), expected, `upgrade ${input}`); n++; };
up('http://example.com/a?b=1#c', 'https://example.com/a?b=1#c');
up('http://example.com:80/x', 'https://example.com/x');
up('http://example.com:8080/x', null);
up('https://example.com/x', 'https://example.com/x');

console.log(`frame-check: ${n} tests passed`);
