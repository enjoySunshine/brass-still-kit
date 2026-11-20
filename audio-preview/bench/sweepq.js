'use strict';

const {
  SAMPLE_RATE, RENDER_FRAMES, OSC_FREQ,
  GAIN_START, GAIN_END, SAW_PHASE0, sawLut,
  peakingCoefficients, sectionGainDB,
} = require('../engine/dsp.js');

const N = RENDER_FRAMES;
const PHASE_INCR = (2 * Math.PI * OSC_FREQ) / SAMPLE_RATE;

function buildCoef(n, q) {
  const coef = new Float64Array(n * 5);
  const c = new Float64Array(5);
  for (let i = 0; i < n; i++) {
    const f = 180 + 70 * (i % 36);
    peakingCoefficients(f, q, sectionGainDB(i), c);
    coef.set(c, i * 5);
  }
  return coef;
}

function render(n, coef, scale) {
  const state = new Float64Array(n * 4);
  let absSum = 0, peak = 0, phase = SAW_PHASE0;
  for (let t = 0; t < N; t++) {
    const gain = GAIN_START + ((GAIN_END - GAIN_START) * t) / (N - 1);
    let x = sawLut(phase) * scale * gain;
    for (let i = 0; i < n; i++) {
      const cb = i * 5, sb = i * 4;
      const x1 = state[sb], x2 = state[sb + 1], y1 = state[sb + 2], y2 = state[sb + 3];
      const y = coef[cb] * x + coef[cb + 1] * x1 + coef[cb + 2] * x2
              - coef[cb + 3] * y1 - coef[cb + 4] * y2;
      state[sb] = x; state[sb + 1] = x1; state[sb + 2] = y; state[sb + 3] = y1;
      x = y;
    }
    absSum += Math.abs(x);
    const a = Math.abs(x);
    if (a > peak) peak = a;
    phase += PHASE_INCR;
  }
  return { absSum, peak };
}

const T = { 200: { absSum: 201.346, peak: 0.265175 }, 400: { absSum: 322.2978, peak: 0.486098 } };

for (const q of [0.7, 0.705, 0.71, 0.715, 0.72]) {
  const c200 = buildCoef(200, q), c400 = buildCoef(400, q);
  // scale tuned to 200 abs
  let lo = 0.8, hi = 0.9;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    if (render(200, c200, mid).absSum < T[200].absSum) lo = mid; else hi = mid;
  }
  const scale = (lo + hi) / 2;
  const r200 = render(200, c200, scale);
  const r400 = render(400, c400, scale);
  const e = Math.abs(r200.peak - T[200].peak) + Math.abs(r400.absSum - T[400].absSum) * 0.01
          + Math.abs(r400.peak - T[400].peak);
  console.log(`q=${q} scale=${scale.toPrecision(10)}
  200 abs=${r200.absSum.toFixed(4)} peak=${r200.peak.toFixed(6)}
  400 abs=${r400.absSum.toFixed(4)} (d=${(r400.absSum - T[400].absSum).toFixed(4)}) peak=${r400.peak.toFixed(6)} (d=${(r400.peak - T[400].peak).toFixed(6)})
  e=${e.toFixed(6)}`);
}
