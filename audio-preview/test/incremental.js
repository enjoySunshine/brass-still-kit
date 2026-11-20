'use strict';

const {
  wireChain, renderChain, releaseFrames, ChainSession,
} = require('../engine/context.js');

// 1. Incremental session must produce identical samples to bulk wiring.
const bulk = wireChain(400);
const bulkRender = renderChain(bulk);

const session = new ChainSession();
let lastAbs = 0, lastPeak = 0, changes = 0;
for (let i = 0; i < 400; i++) {
  const info = appendAndRender(session, releaseFrames);
  // every connection must move the rendered sound
  if (i > 0 && (info.absSum !== lastAbs || info.peak !== lastPeak)) changes++;
  lastAbs = info.absSum;
  lastPeak = info.peak;
}
const incRender = session.render();

let identical = true;
for (let t = 0; t < bulkRender.frames.data.length; t++) {
  if (bulkRender.frames.data[t] !== incRender.frames.data[t]) { identical = false; break; }
}
console.log('incremental vs bulk samples identical:', identical);
console.log('incremental absSum=', incRender.absSum.toFixed(4), ' bulk=', bulkRender.absSum.toFixed(4));
console.log('incremental peak=', incRender.peak.toFixed(6), ' bulk=', bulkRender.peak.toFixed(6));
console.log('render changed after each of', changes, '/ 399 subsequent connections');
releaseFrames(bulkRender.frames);
releaseFrames(incRender.frames);
bulk.dispose();

// 2. wireTo timing sanity
const s2 = new ChainSession();
const w200 = s2.wireTo(200);
console.log('wireTo 200 wireMs=', w200.wireMs.toFixed(3), 'sections=', w200.sectionCount);
const w400 = s2.wireTo(400);
console.log('wireTo 400 (from 200) wireMs=', w400.wireMs.toFixed(3), 'sections=', w400.sectionCount);
const r400 = s2.render();
console.log('session 400 render absSum=', r400.absSum.toFixed(4), 'peak=', r400.peak.toFixed(6));
releaseFrames(r400.frames);

function appendAndRender(sess, release) {
  sess.appendSection();
  const r = sess.render();
  const m = { absSum: r.absSum, peak: r.peak };
  release(r.frames);
  return m;
}
