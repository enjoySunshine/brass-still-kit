'use strict';

// Investigate whether a different but spec-consistent chain convention closes
// the 400 absSum residual while keeping 200 exact. We fix 200 absSum via the
// context scale and inspect the resulting 400 metrics.
const AP = require('../engine/core.js');
const SR = AP.SAMPLE_RATE, N = AP.RENDER_FRAMES;

function peaking(freq, q, gainDB, mode) {
  const w0 = 2 * Math.PI * freq / SR;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw / (2 * q);
  let A, b0, b1, b2, a0, a1, a2;
  if (mode === 'wa') A = Math.pow(10, gainDB / 40);
  else if (mode === 'rbj') A = Math.pow(10, gainDB / 20);
  b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
  a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
  const inv = 1 / a0;
  return [b0 * inv, b1 * inv, b2 * inv, a1 * inv, a2 * inv];
}

function render(sections, mode, q, scale) {
  const coef = [];
  for (let i = 0; i < sections; i++) {
    const f = 180 + 70 * (i % 36);
    const g = (i % 2 === 0) ? 2 : -2;
    coef.push(peaking(f, q, g, mode));
  }
  const state = new Float64Array(sections * 4);
  let absSum = 0, peak = 0, phase = AP.SAW_PHASE0;
  const dphi = 2 * Math.PI * AP.OSC_FREQ / SR;
  for (let t = 0; t < N; t++) {
    const gain = 0.2 + (-0.15 * t) / (N - 1);
    let x = AP.sawLut(phase) * scale * gain;
    for (let i = 0; i < sections; i++) {
      const c = coef[i], sb = i * 4;
      const y = c[0] * x + c[1] * state[sb] + c[2] * state[sb + 1]
              - c[3] * state[sb + 2] - c[4] * state[sb + 3];
      state[sb + 1] = state[sb]; state[sb] = x;
      state[sb + 3] = state[sb + 2]; state[sb + 2] = y;
      x = y;
    }
    absSum += Math.abs(x);
    const a = Math.abs(x); if (a > peak) peak = a;
    phase += dphi;
  }
  return { absSum, peak };
}

function scaleFor200(mode, q) {
  let lo = 0.5, hi = 1.2;
  for (let it = 0; it < 50; it++) {
    const mid = (lo + hi) / 2;
    if (render(200, mode, q, mid).absSum < 201.346) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

for (const mode of ['wa', 'rbj']) {
  for (const q of [0.7]) {
    const s = scaleFor200(mode, q);
    const r400 = render(400, mode, q, s);
    console.log(`mode=${mode} q=${q} scale=${s.toPrecision(10)} 400 abs=${r400.absSum.toFixed(4)} (d=${(r400.absSum - 322.2978).toFixed(4)}) peak=${r400.peak.toFixed(6)} (d=${(r400.peak - 0.486098).toFixed(6)})`);
  }
}
// baseline current engine
const c = AP.wireChain(400); const rr = AP.renderChain(c);
console.log('engine 400 abs=', rr.absSum.toFixed(4), 'peak=', rr.peak.toFixed(6));
AP.releaseFrames(rr.frames); c.dispose();
