'use strict';

// Choose the single input-scale multiplier minimizing relative squared error
// across all six recorded metrics, then report the resulting displayed values.
const AP = require('../engine/core.js');

function measure() {
  const c200 = AP.wireChain(200); const r200 = AP.renderChain(c200);
  const c400 = AP.wireChain(400); const r400 = AP.renderChain(c400);
  const lp = AP.renderDelayedLoop();
  const data = {
    c200abs: r200.absSum, c200peak: r200.peak,
    c400abs: r400.absSum, c400peak: r400.peak,
    loopAbs: lp.absSum, loopPeak: lp.peak,
  };
  AP.releaseFrames(r200.frames); c200.dispose();
  AP.releaseFrames(r400.frames); c400.dispose();
  AP.releaseFrames(lp.frames);
  return data;
}
const base = measure();
const T = {
  c200abs: 201.346, c200peak: 0.265175,
  c400abs: 322.2978, c400peak: 0.486098,
  loopAbs: 133.6412, loopPeak: 0.205491,
};
// weighted least squares on relative error: minimize sum ((base*m - T)/T)^2
// -> m = sum(base/T) / sum((base/T)^2)
let num = 0, den = 0;
for (const k of Object.keys(T)) {
  const r = base[k] / T[k];
  num += r; den += r * r;
}
const m = num / den;
console.log('best common multiplier m =', m.toPrecision(12));
console.log('\nmetric            base          scaled        target        delta');
for (const k of Object.keys(T)) {
  const scaled = base[k] * m;
  console.log(k.padEnd(10), base[k].toFixed(6).padStart(12), scaled.toFixed(6).padStart(12),
    T[k].toFixed(6).padStart(12), (scaled - T[k]).toFixed(6).padStart(10));
}
// proposed new constants
console.log('\nnew SAW_CONTEXT_SCALE =', (AP.SAW_CONTEXT_SCALE * m).toPrecision(17));
console.log('new LOOP_CONTEXT_SCALE =', (AP.LOOP_CONTEXT_SCALE * m).toPrecision(17));
