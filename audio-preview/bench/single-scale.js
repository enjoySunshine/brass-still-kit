'use strict';

// Can one input scale put BOTH chain absSums and BOTH loop metrics within
// rounding of their targets? (All four are linear in the input amplitude.)
const AP = require('../engine/core.js');

function chainMetrics(sections, scaleMul) {
  // temporarily render with a scaled engine by post-scaling: metrics scale
  // linearly with input amplitude for an LTI cascade + linear envelope.
  const c = AP.wireChain(sections);
  const r = AP.renderChain(c);
  AP.releaseFrames(r.frames); c.dispose();
  return { absSum: r.absSum * scaleMul, peak: r.peak * scaleMul };
}
function loopMetrics(scaleMul) {
  const r = AP.renderDelayedLoop();
  AP.releaseFrames(r.frames);
  return { absSum: r.absSum * scaleMul, peak: r.peak * scaleMul };
}

// baseline engine metrics (scaleMul=1)
const base = {
  c200: chainMetrics(200, 1),
  c400: chainMetrics(400, 1),
  loop: loopMetrics(1),
};
const T = {
  c200abs: 201.346, c400abs: 322.2978,
  c200peak: 0.265175, c400peak: 0.486098,
  loopAbs: 133.6412, loopPeak: 0.205491,
};
// implied multipliers per metric
const m = {
  c200abs: T.c200abs / base.c200.absSum,
  c400abs: T.c400abs / base.c400.absSum,
  c200peak: T.c200peak / base.c200.peak,
  c400peak: T.c400peak / base.c400.peak,
  loopAbs: T.loopAbs / base.loop.absSum,
  loopPeak: T.loopPeak / base.loop.peak,
};
console.log('implied input multipliers per metric:');
for (const [k, v] of Object.entries(m)) console.log(' ', k, v.toFixed(6));
const vals = Object.values(m);
console.log('min', Math.min(...vals).toFixed(6), 'max', Math.max(...vals).toFixed(6),
  'spread%', ((Math.max(...vals) - Math.min(...vals)) * 100).toFixed(4));
