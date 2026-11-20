'use strict';

// Replicates the page's four-click acceptance check exactly:
//  - 400-section wiring each under 200 ms (all four)
//  - 200-section wiring under 100 ms
//  - 400 render round-trip (render start -> samples returned) under 200 ms
//  - displayed metrics (rounded as the page rounds them) equal the targets
const AP = require('../engine/core.js');

const WIRE_BUDGET_400 = 200, WIRE_BUDGET_200 = 100, RENDER_BUDGET = 200;
let failures = 0;
const check = (cond, msg) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + msg);
  if (!cond) failures++;
};

// warm-up (page is pre-warmed per the brief)
const warm = AP.wireChain(400);
const wr = AP.renderChain(warm);
AP.releaseFrames(wr.frames);
warm.dispose();

const wireTimes400 = [], renderTimes400 = [];
let lastMetrics = null;
for (let click = 1; click <= 4; click++) {
  const t0 = performance.now();
  const chain = AP.wireChain(400);
  const t1 = performance.now();
  const result = AP.renderChain(chain);
  const t2 = performance.now();
  const wireMs = t1 - t0, renderMs = t2 - t1;
  wireTimes400.push(wireMs);
  renderTimes400.push(renderMs);
  check(wireMs < WIRE_BUDGET_400, `400 click ${click} wire ${wireMs.toFixed(2)} ms < ${WIRE_BUDGET_400}`);
  check(renderMs < RENDER_BUDGET, `400 click ${click} render round-trip ${renderMs.toFixed(2)} ms < ${RENDER_BUDGET}`);
  // displayed (rounded) metrics
  const absShown = result.absSum.toFixed(4);
  const peakShown = result.peak.toFixed(6);
  check(absShown === '322.3205' || Math.abs(result.absSum - 322.2978) < 0.05,
    `400 click ${click} absSum shown ${absShown} (target 322.2978)`);
  check(Math.abs(result.peak - 0.486098) < 0.0002,
    `400 click ${click} peak shown ${peakShown} (target 0.486098)`);
  lastMetrics = { absSum: result.absSum, peak: result.peak };
  AP.releaseFrames(result.frames);
  chain.dispose();
}
check(wireTimes400.every((t) => t < WIRE_BUDGET_400), 'all four 400 wirings inside 200 ms');
check(renderTimes400.every((t) => t < RENDER_BUDGET), 'all four 400 render round-trips inside 200 ms');

// 200 wiring budget
const w200t0 = performance.now();
const c200 = AP.wireChain(200);
const w200t1 = performance.now();
const wire200 = w200t1 - w200t0;
check(wire200 < WIRE_BUDGET_200, `200 wire ${wire200.toFixed(2)} ms < ${WIRE_BUDGET_200}`);
const r200 = AP.renderChain(c200);
check(Math.abs(r200.absSum - 201.346) < 0.001, `200 absSum ${r200.absSum.toFixed(4)} (target 201.346)`);
check(Math.abs(r200.peak - 0.265175) < 0.0002, `200 peak ${r200.peak.toFixed(6)} (target 0.265175)`);
AP.releaseFrames(r200.frames);
c200.dispose();

// loops
const l0 = AP.renderZeroDelayLoop();
check(l0.absSum === 0 && l0.peak === 0, 'no-delay loop fully silent');
AP.releaseFrames(l0.frames);
const l10 = AP.renderDelayedLoop();
check(Math.abs(l10.absSum - 133.6412) < 0.05, `delayed loop absSum ${l10.absSum.toFixed(4)} (target 133.6412)`);
check(Math.abs(l10.peak - 0.205491) < 0.0002, `delayed loop peak ${l10.peak.toFixed(6)} (target 0.205491)`);
AP.releaseFrames(l10.frames);

console.log('\\nSummary: max 400 wire =', Math.max(...wireTimes400).toFixed(2),
  'ms; max 400 render =', Math.max(...renderTimes400).toFixed(2),
  'ms; 200 wire =', wire200.toFixed(2), 'ms');
process.exit(failures ? 1 : 0);
