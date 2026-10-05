// Drives headless Chrome over CDP to exercise content.js via test/harness.html
// Usage: node test/e2e.mjs   (needs Chrome on --remote-debugging-port=9333 and `python3 -m http.server 8765` in the repo root)
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VW = 1100, VH = 700;
const tabs = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(tabs.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) pending.get(d.id)(d);
};
const cdp = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, (d) => (d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const ev = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
const move = (x, y) => cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
const mouse = (type, x, y) => cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
const rectOf = (i) => ev(`(()=>{const r=document.getElementById('${i}').getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}})()`);
const center = async (i) => { const r = await rectOf(i); return [r.x + r.w / 2, r.y + r.h / 2]; };
// All popups, in DOM order
const popups = () =>
  ev(`[...document.querySelectorAll('[data-hover-preview]')].map(h=>{const r=h.getBoundingClientRect();const s=h.shadowRoot;return {x:r.left,y:r.top,w:r.width,h:r.height,z:+h.style.zIndex,url:s.querySelector('.url').textContent,iframe:!!s.querySelector('iframe'),card:s.querySelector('.card')?.innerText||null}})`);
const shot = async (name) => fs.writeFileSync(`${process.env.TMPDIR}/${name}.png`, Buffer.from((await cdp('Page.captureScreenshot')).data, 'base64'));

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`);
  cond ? pass++ : fail++;
};
const load = async (qs) => {
  await cdp('Page.navigate', { url: 'http://127.0.0.1:8765/test/harness.html' + qs });
  await sleep(1200);
  await move(900, 600);
};

await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });

// ================= Mode A: keepOnScreen = OFF (hover mode) =================
console.log('--- hover mode (keep on screen OFF) ---');
await load('?keep=0');
let [x, y] = await center('ok');
let linkR = await rectOf('ok');
await move(x, y); await sleep(500); await move(900, 600); await sleep(1300);
check('cancel when leaving before delay', (await popups()).length === 0);

await move(x, y); await sleep(1500);
let ps = await popups(); let p = ps[0];
check('opens after delay with iframe', ps.length === 1 && p.iframe, JSON.stringify(ps));
check('opens to the RIGHT of the cursor (16px gap)', p && Math.abs(p.x - (x + 16)) <= 1, JSON.stringify({ p, x }));
check('vertical position clamped to top margin (cursor near top)', p && Math.abs(p.y - 12) <= 1, JSON.stringify({ p, y }));
check('medium size 480x360', p && p.w === 480 && p.h === 360);

await move(900, 650); await sleep(120);
check('still open during grace period', (await popups()).length === 1);
await sleep(500);
check('closed after grace period', (await popups()).length === 0);

await move(x, y); await sleep(1500); p = (await popups())[0];
await move(x, y + 15); await move(p.x + p.w / 2, p.y + p.h / 2); await sleep(800);
check('stays open when mouse moves into popup', (await popups()).length === 1);
await move(900, 650); await sleep(600);
check('closes after leaving popup', (await popups()).length === 0);

await ev('window.__msgs.length=0');
for (const k of ['mail', 'anchor', 'dl', 'denied', 'js']) {
  const [a, b] = await center(k);
  await move(a, b); await sleep(1400);
  check(`no popup for ineligible link: ${k}`, (await popups()).length === 0);
  await move(900, 650); await sleep(400);
}
check('no frame checks for ineligible links', (await ev('window.__msgs.length')) === 0);

let [a, b] = await center('blocked');
await move(a, b); await sleep(1500); p = (await popups())[0];
check('blocked site shows fallback card', p && !p.iframe && /Blocked by site/.test(p.card || '') && /Open in new tab/.test(p.card || ''), JSON.stringify(p));
await move(900, 650); await sleep(600);

await ev('window.scrollTo(0, document.body.scrollHeight)'); await sleep(300);
[a, b] = await center('low');
await move(a, b); await sleep(1500); p = (await popups())[0];
check('popup centered vertically on cursor', p && Math.abs(p.y + p.h / 2 - b) <= 1, JSON.stringify({ p, b }));
check('popup clamped inside viewport', p && p.y >= 0 && p.y + p.h <= VH && p.x + p.w <= VW, JSON.stringify(p));
await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(200);
await ev('window.scrollTo(0, 0)'); await sleep(200);
{
  const [rx, ry] = await center('right');
  await move(rx, ry); await sleep(1500);
  const q = (await popups())[0];
  check('flips to LEFT of cursor when no room on right', q && Math.abs(q.x + q.w - (rx - 16)) <= 1, JSON.stringify({ q, rx }));
  check('flipped popup centered on cursor', q && Math.abs(q.y + q.h / 2 - ry) <= 1, JSON.stringify({ q, ry }));
}
await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(200);
check('Escape closes popup', (await popups()).length === 0);

// ================= Mode B: keepOnScreen = ON (sticky) =================
console.log('--- sticky mode (keep on screen ON) ---');
await load('?keep=1');
[x, y] = await center('ok');
await move(x, y); await sleep(1500);
ps = await popups(); p = ps[0];
check('sticky: opens beside cursor', ps.length === 1 && Math.abs(p.x - (x + 16)) <= 1, JSON.stringify(ps));
await shot('shot-sticky-1');

await move(x, y + 40); await move(900, 650); await sleep(900);
check('sticky: stays after mouse leaves link', (await popups()).length === 1);

// drag by header
const hx = p.x + 60, hy = p.y + 17;
await mouse('mousePressed', hx, hy); await mouse('mouseMoved', hx + 150, hy + 80); await mouse('mouseMoved', hx + 300, hy + 150); await mouse('mouseReleased', hx + 300, hy + 150);
await sleep(200);
let moved = (await popups())[0];
check('drag moves popup by header', Math.abs(moved.x - (p.x + 300)) <= 2 && Math.abs(moved.y - (p.y + 150)) <= 2, JSON.stringify({ p, moved }));
await move(900, 650); await sleep(700);
check('sticky: still open after drag + leaving', (await popups()).length === 1);

// drag clamps inside viewport
const mx = moved.x + 60, my = moved.y + 17;
await mouse('mousePressed', mx, my); await mouse('mouseMoved', 5000, 5000); await mouse('mouseReleased', 5000, 5000);
await sleep(200);
let clamped = (await popups())[0];
check('drag is clamped to viewport', clamped.x + clamped.w <= VW + 1 && clamped.y + clamped.h <= VH + 1, JSON.stringify(clamped));
// drag back so next popup doesn't collide
await mouse('mousePressed', clamped.x + 60, clamped.y + 17); await mouse('mouseMoved', 500, 40); await mouse('mouseReleased', 500, 40);
await sleep(200);

// second popup (different link)
[a, b] = await center('blocked');
await move(a, b); await sleep(1500);
ps = await popups();
check('sticky: second link opens a SECOND popup', ps.length === 2, JSON.stringify(ps));
check('second popup is frontmost', ps.length === 2 && ps[1].z > ps[0].z);
await shot('shot-sticky-2');

// same link again -> no duplicate
await move(900, 650); await sleep(300); await move(a, b); await sleep(1500);
check('sticky: re-hovering same link does not duplicate', (await popups()).length === 2);

// Esc closes only the frontmost
await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(200);
ps = await popups();
check('Escape closes only the frontmost popup', ps.length === 1 && ps[0].iframe, JSON.stringify(ps));

// close button closes
const closeXY = await ev(`(()=>{const h=document.querySelector('[data-hover-preview]');const b=[...h.shadowRoot.querySelectorAll('button')].find(b=>b.textContent==='✕').getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2]})()`);
await mouse('mousePressed', closeXY[0], closeXY[1]); await mouse('mouseReleased', closeXY[0], closeXY[1]);
await sleep(200);
check('close button closes popup', (await popups()).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
ws.close();
process.exit(fail ? 1 : 0);
