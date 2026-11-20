'use strict';

// Test block-quantum rendering (128 frames per block, like AudioContext) to
// see whether processing in blocks with per-block gain changes the metrics.
const AP = require('../engine/core.js');
const SR = AP.SAMPLE_RATE, N = AP.RENDER_FRAMES;

function renderBlocked(sections, blockSize, gainPerBlock) {
  const coef = new Float64Array(sections * 5);
  const c = new Float64Array(5);
  for (let i = 0; i < sections; i++) {
    AP.peakingCoefficients(AP.sectionFrequency(i), 0.7, AP.sectionGainDB(i), c);
    coef.set(c, i * 5);
  }
  const state = new Float64Array(sections * 4);
  const out = new Float64Array(N);
  let phase = AP.SAW_PHASE0;
  const dphi = 2 * Math.PI * AP.OSC_FREQ / SR;
  let absSum = 0, peak = 0;
  for (let blockStart = 0; blockStart < N; blockStart += blockSize) {
    const end = Math.min(N, blockStart + blockSize);
    // gain value held per block (quantized)
    const blockIndex = Math.floor(blockStart / blockSize);
    for (let t = blockStart; t < end; t++) {
      const gt = gainPerBlock ? blockIndex * blockSize : t;
      const gain = 0.2 + (-0.15 * gt) / (N - 1);
      out[t] = AP.sawLut(phase) * AP.SAW_CONTEXT_SCALE * gain;
      phase += dphi;
    }
    for (let i = 0; i < sections; i++) {
      const cb = i * 5, sb = i * 4;
      const b0 = coef[cb], b1 = coef[cb + 1], b2 = coef[cb + 2], a1 = coef[cb + 3], a2 = coef[cb + 4];
      let x1 = state[sb], x2 = state[sb + 1], y1 = state[sb + 2], y2 = state[sb + 3];
      for (let t = blockStart; t < end; t++) {
        const x = out[t];
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        out[t] = y;
      }
      state[sb] = x1; state[sb + 1] = x2; state[sb + 2] = y1; state[sb + 3] = y2;
    }
  }
  for (let t = 0; t < N; t++) { absSum += Math.abs(out[t]); const a = Math.abs(out[t]); if (a > peak) peak = a; }
  return { absSum, peak };
}

for (const bs of [128, 256]) {
  for (const gp of [false, true]) {
    const r = renderBlocked(400, bs, gp);
    console.log(`block=${bs} gainPerBlock=${gp} 400 abs=${r.absSum.toFixed(4)} (d=${(r.absSum - 322.2978).toFixed(4)}) peak=${r.peak.toFixed(6)}`);
  }
}
// baseline
const c = AP.wireChain(400); const rr = AP.renderChain(c);
console.log('sample-by-sample 400 abs=', rr.absSum.toFixed(4), 'peak=', rr.peak.toFixed(6));
AP.releaseFrames(rr.frames); c.dispose();
