'use strict';

// Headless harness for web/app.js: stubs just enough DOM/canvas/performance to
// exercise every button handler and assert the page-computed metrics come from
// the drawn samples. Run with: node test/web-smoke.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// --- minimal DOM stub ------------------------------------------------------
class StubElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this._text = '';
    this.width = 1080;
    this.height = 260;
    this.listeners = {};
    this.style = {};
    this.className = '';
    this.innerHTML = '';
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(ev, fn) { this.listeners[ev] = fn; }
  click() { if (this.listeners.click) this.listeners.click(); }
  getContext() {
    return new Proxy({}, {
      get(t, prop) {
        if (prop === 'canvas') return undefined;
        return typeof prop === 'string' ? () => {} : undefined;
      },
      set() { return true; },
    });
  }
  querySelector(sel) {
    if (sel === 'tbody') return new StubElement('tbody');
    return new StubElement('div');
  }
}

const elements = {};
function makeEl(id, tag = 'div') {
  const el = new StubElement(tag);
  elements[id] = el;
  return el;
}
['hdr-rate', 'hdr-frames', 'hdr-dur', 'cur-sections', 'section-list',
 'wire-table', 'render-table', 'chart-title', 'chart', 'm-ms', 'm-abs',
 'm-peak', 'm-note'].forEach((id) => makeEl(id, id === 'chart' ? 'canvas' : 'div'));
makeEl('btn-400', 'button');
makeEl('btn-200', 'button');
makeEl('btn-loop0', 'button');
makeEl('btn-loop10', 'button');

const sandbox = {
  console,
  performance: { now: () => Number(process.hrtime.bigint() / 1000000n) },
  // Intentionally no `module`/`exports` so the UMD wrapper takes the browser
  // branch and attaches to the global as window.AudioPreview.
  document: {
    getElementById: (id) => elements[id] || makeEl(id),
    createElement: (tag) => new StubElement(tag),
  },
  window: {},
};
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// load core (UMD) -> sets window.AudioPreview
const coreSrc = fs.readFileSync(path.join(__dirname, '../engine/core.js'), 'utf8');
vm.runInContext(coreSrc, sandbox);
const AP = sandbox.window.AudioPreview;
if (!AP) throw new Error('core did not register window.AudioPreview');

// load app.js
const appSrc = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
vm.runInContext(appSrc, sandbox);

// The page header must be populated from the core constants.
const assert = (cond, msg) => { if (!cond) { console.error('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); };
assert(elements['hdr-rate'].textContent === String(AP.SAMPLE_RATE), 'header sample rate from core');
assert(elements['hdr-frames'].textContent === String(AP.RENDER_FRAMES), 'header frame count from core');

// Four 400-section clicks: every one must stay inside both budgets and show
// the exact target metrics computed from the drawn samples.
const T400 = { absSum: 322.2978, peak: 0.486098 };
for (let i = 0; i < 4; i++) {
  elements['btn-400'].click();
  const abs = parseFloat(elements['m-abs'].textContent);
  const pk = parseFloat(elements['m-peak'].textContent);
  const dAbs = Math.abs(abs - T400.absSum);
  const dPk = Math.abs(pk - T400.peak);
  assert(dAbs < 0.05, `400 click ${i + 1} absSum ${abs.toFixed(4)} within 0.05 of target`);
  assert(dPk < 0.0002, `400 click ${i + 1} peak ${pk.toFixed(6)} within 2e-4 of target`);
}

// 200-section click
elements['btn-200'].click();
const abs200 = parseFloat(elements['m-abs'].textContent);
const pk200 = parseFloat(elements['m-peak'].textContent);
assert(Math.abs(abs200 - 201.346) < 0.01, `200 absSum ${abs200.toFixed(4)} matches target`);
assert(Math.abs(pk200 - 0.265175) < 0.0002, `200 peak ${pk200.toFixed(6)} matches target`);

// no-delay loop -> all zero
elements['btn-loop0'].click();
assert(parseFloat(elements['m-abs'].textContent) === 0, 'no-delay loop absSum = 0');
assert(parseFloat(elements['m-peak'].textContent) === 0, 'no-delay loop peak = 0');

// delayed loop -> expected metrics
elements['btn-loop10'].click();
const absL = parseFloat(elements['m-abs'].textContent);
const pkL = parseFloat(elements['m-peak'].textContent);
assert(Math.abs(absL - 133.6412) < 0.05, `delayed loop absSum ${absL.toFixed(4)} matches target`);
assert(Math.abs(pkL - 0.205491) < 0.0002, `delayed loop peak ${pkL.toFixed(6)} matches target`);

console.log('\\nweb smoke test complete');
