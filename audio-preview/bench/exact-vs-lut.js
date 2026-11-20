'use strict';

const AP = require('../engine/core.js');
const SR = AP.SAMPLE_RATE, N = AP.RENDER_FRAMES, NY = SR / 2;
const F0 = AP.OSC_FREQ;
const PARTS = [];
for (let n = 1; n * F0 < NY; n++) PARTS.push({ n, c: 2 / (n * Math.PI) });
function exactSaw(phase) {
  let v = 0;
  for (const p of PARTS) v += p.c * Math.sin(p.n * phase);
  return v;
}
function peaking(freq, q, gainDB) {
  const w0 = 2 * Math.PI * freq / SR, cw = Math.cos(w0), sw = Math.sin(w0);
  const A = Math.pow(10, gainDB / 40), alpha = sw / (2 * q);
  const b0 = 1 + alpha * A, b1 = -2 * cw, b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A, a1 = -2 * cw, a2 = 1 - alpha / A;
  const inv = 1 / a0;
  return [b0 * inv, b1 * inv, b2 * inv, a1 * inv, a2 * inv];
}
function render(sections, sawFn, scale) {
  const coef = [];
  for (let i = 0; i < sections; i++) coef.push(peaking(180 + 70 * (i % 36), 0.7, (i % 2 ? -2 : 2)));
  const state = new Float64Array(sections * 4);
  let absSum = 0, peak = 0, phase = AP.SAW_PHASE0;
  const dphi = 2 * Math.PI * F0 / SR;
  for (let t = 0; t < N; t++) {
    const gain = 0.2 + (-0.15 * t) / (N - 1);
    let x = sawFn(phase) * scale * gain;
    for (let i = 0; i < sections; i++) {
      const c = coef[i], sb = i * 4;
      const y = c[0] * x + c[1] * state[sb] + c[2] * state[sb + 1] - c[3] * state[sb + 2] - c[4] * state[sb + 3];
      state[sb + 1] = state[sb]; state[sb] = x; state[sb + 3] = state[sb + 2]; state[sb + 2] = y;
      x = y;
    }
    absSum += Math.abs(x); const a = Math.abs(x); if (a > peak) peak = a;
    phase += dphi;
  }
  return { absSum, peak };
}
function scaleFor200(sawFn) {
  let lo = 0.5, hi = 1.2;
  for (let it = 0; it < 50; it++) { const m = (lo + hi) / 2; if (render(200, sawFn, m).absSum < 201.346) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

const sExact = scaleFor200(exactSaw);
const r400exact = render(400, exactSaw, sExact);
const sLut = scaleFor200(AP.sawLut);
const r400lut = render(400, AP.sawLut, sLut);
console.log('exact Fourier: scale=', sExact.toPrecision(10), '400 abs=', r400exact.absSum.toFixed(4), 'd=', (r400exact.absSum - 322.2978).toFixed(4), 'peak=', r400exact.peak.toFixed(6));
console.log('LUT:           scale=', sLut.toPrecision(10), '400 abs=', r400lut.absSum.toFixed(4), 'd=', (r400lut.absSum - 322.2978).toFixed(4), 'peak=', r400lut.peak.toFixed(6));
