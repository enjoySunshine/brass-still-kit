'use strict';

const { wireChain, renderChain, renderZeroDelayLoop, renderDelayedLoop, releaseFrames } = require('../engine/context.js');

const T = {
  200: { absSum: 201.346, peak: 0.265175 },
  400: { absSum: 322.2978, peak: 0.486098 },
  loop10: { absSum: 133.6412, peak: 0.205491 },
};

for (const n of [200, 400]) {
  const chain = wireChain(n);
  const r = renderChain(chain);
  console.log(`chain ${n}: absSum=${r.absSum.toFixed(4)} (target ${T[n].absSum})  peak=${r.peak.toFixed(6)} (target ${T[n].peak})`);
  releaseFrames(r.frames);
  chain.dispose();
}

const l0 = renderZeroDelayLoop();
console.log(`loop no-delay: absSum=${l0.absSum.toFixed(4)} peak=${l0.peak.toFixed(6)} muted=${l0.muted}`);
releaseFrames(l0.frames);

const l10 = renderDelayedLoop();
console.log(`loop 10ms: absSum=${l10.absSum.toFixed(4)} (target ${T.loop10.absSum}) peak=${l10.peak.toFixed(6)} (target ${T.loop10.peak})`);
releaseFrames(l10.frames);

// determinism: four repeated runs must be identical
const c400 = wireChain(400);
const first = renderChain(c400);
const sig = Array.from(first.frames.data.slice(0, 8)).join(',');
releaseFrames(first.frames);
for (let run = 0; run < 3; run++) {
  const r = renderChain(c400);
  const s = Array.from(r.frames.data.slice(0, 8)).join(',');
  console.log(`repeat run ${run}: identical=${s === sig} absSum=${r.absSum.toFixed(4)} peak=${r.peak.toFixed(6)}`);
  releaseFrames(r.frames);
}
c400.dispose();
