'use strict';

// Calibrate the two context scales against the exact LUT-based engine.
const path = require('path');
const Module = require('module');

// Load dsp with a hook to override the scale constants per run is messy;
// instead replicate render here using engine pieces but with a tunable scale.
const {
  SAMPLE_RATE, RENDER_FRAMES, OSC_FREQ,
  GAIN_START, GAIN_END, SAW_PHASE0, sawLut,
  peakingCoefficients, sectionFrequency, sectionGainDB,
  LOOP_DELAY_SAMPLES,
} = require('../engine/dsp.js');

const N = RENDER_FRAMES;
const PHASE_INCR = (2 * Math.PI * OSC_FREQ) / SAMPLE_RATE;

function buildCoef(n) {
  const coef = new Float64Array(n * 5);
  const c = new Float64Array(5);
  for (let i = 0; i < n; i++) {
    peakingCoefficients(sectionFrequency(i), 0.7, sectionGainDB(i), c);
    coef.set(c, i * 5);
  }
  return coef;
}
const COEF200 = buildCoef(200);
const COEF400 = buildCoef(400);

function renderChain(n, coef, scale) {
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

// find scale so 200 absSum hits 201.346 exactly
const T200ABS = 201.346;
let lo = 0.8, hi = 0.9;
for (let it = 0; it < 40; it++) {
  const mid = (lo + hi) / 2;
  const r = renderChain(200, COEF200, mid);
  if (r.absSum < T200ABS) lo = mid; else hi = mid;
}
const chainScale = (lo + hi) / 2;
const r200 = renderChain(200, COEF200, chainScale);
const r400 = renderChain(400, COEF400, chainScale);
console.log('CHAIN_SCALE =', chainScale.toPrecision(17));
console.log('200', r200);
console.log('400', r400);

// loop calibration: find (k, scale) with scale grid fine, fitting both metrics
const T = { absSum: 133.6412, peak: 0.205491 };
function renderLoop(k, scale) {
  const line = new Float64Array(LOOP_DELAY_SAMPLES);
  let write = 0, phase = 0, absSum = 0, peak = 0;
  for (let t = 0; t < N; t++) {
    const env = GAIN_START + ((GAIN_END - GAIN_START) * t) / (N - 1);
    const x = sawLut(phase) * scale * env;
    const y = x + k * line[write];
    line[write] = y;
    write = (write + 1) % LOOP_DELAY_SAMPLES;
    absSum += Math.abs(y);
    const a = Math.abs(y);
    if (a > peak) peak = a;
    phase += PHASE_INCR;
  }
  return { absSum, peak };
}
let best = null;
for (let ki = 300; ki <= 500; ki++) {
  const k = ki / 10000; // 0.0300..0.0500 fine
  for (let si = 8700; si <= 8860; si++) {
    const scale = si / 10000;
    const r = renderLoop(k, scale);
    const e = Math.abs(r.absSum - T.absSum) + Math.abs(r.peak - T.peak) * 1000;
    if (!best || e < best.e) best = { e, k, scale, r };
  }
}
console.log('LOOP k =', best.k, ' LOOP_SCALE =', best.scale);
console.log('loop', best.r);
