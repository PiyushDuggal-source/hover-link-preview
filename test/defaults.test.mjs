// Run: node test/defaults.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../defaults.js', import.meta.url), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src + '\nthis.D = HLP_DEFAULTS; this.E = HLP_DEFAULT_EXCLUDED; this.X = HLP_DEFAULT_DESTINATION_DENY;', ctx);

const parse = (t) => t.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
const excluded = parse(ctx.E);
const dest = parse(ctx.X);

for (const [name, list] of [['excluded', excluded], ['destination', dest]]) {
  assert.equal(new Set(list).size, list.length, `duplicate domains in default ${name} list`);
  for (const d of list) assert.match(d, /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/, `bad domain in ${name} list: ${d}`);
}

// must-haves from each category
for (const d of ['instagram.com', 'facebook.com', 'linkedin.com', 'x.com', 'twitter.com', 'tiktok.com',
  'paypal.com', 'mail.google.com', 'outlook.com', 'youtube.com', 'netflix.com', 'docs.google.com', 'notion.so',
  'github.com', 'gitlab.com', 'console.aws.amazon.com', 'portal.azure.com', 'www.amazon.in', 'accounts.google.com']) {
  assert.ok(excluded.includes(d), `default excluded list missing ${d}`);
}
for (const d of ['t.co', 'bit.ly', 'lnkd.in', 'doubleclick.net']) {
  assert.ok(dest.includes(d), `default destination list missing ${d}`);
}

// entries that would be too broad (subdomains are included, and matching is host-only)
for (const d of ['google.com', 'amazon.com', 'amazon.in', 'microsoft.com', 'live.com', 'apple.com', 'aws.amazon.com', 'cloudflare.com', 'vercel.com', 'stackoverflow.com']) {
  assert.ok(!excluded.includes(d), `too-broad domain in excluded list: ${d}`);
}

assert.equal(ctx.D.keepOnScreen, false);
assert.equal(ctx.D.excludedSites, ctx.E);
assert.equal(ctx.D.domains, ctx.X);
console.log(`defaults: ok (${excluded.length} excluded pages, ${dest.length} denied destinations)`);
