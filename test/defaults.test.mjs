// Run: node test/defaults.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../defaults.js', import.meta.url), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src + '\nthis.D = HLP_DEFAULTS; this.E = HLP_DEFAULT_EXCLUDED;', ctx);

const domains = ctx.E.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
for (const d of ['instagram.com', 'facebook.com', 'linkedin.com', 'x.com', 'twitter.com', 'tiktok.com']) {
  assert.ok(domains.includes(d), `default excluded list missing ${d}`);
}
assert.equal(new Set(domains).size, domains.length, 'duplicate domains in default list');
assert.equal(ctx.D.keepOnScreen, false);
assert.equal(ctx.D.excludedSites, ctx.E);
console.log(`defaults: ok (${domains.length} excluded domains)`);
