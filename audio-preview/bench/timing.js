'use strict';

const { wireChain, renderChain, releaseFrames } = require('../engine/context.js');

function bench(label, fn, runs, budgetMs) {
  const times = [];
  let result;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    result = fn(i);
    const t1 = performance.now();
    times.push(t1 - t0);
  }
  const max = Math.max(...times);
  const min = Math.min(...times);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const ok = max < budgetMs;
  console.log(`${label}: runs=[${times.map((t) => t.toFixed(2)).join(', ')}] ms  min=${min.toFixed(2)} avg=${avg.toFixed(2)} max=${max.toFixed(2)} budget=${budgetMs} -> ${ok ? 'PASS' : 'FAIL'}`);
  return { times, result, ok };
}

// Warm up
const warm = wireChain(400);
const wr = renderChain(warm);
releaseFrames(wr.frames);
warm.dispose();

console.log('--- wiring (接线) ---');
bench('wire 200', () => { const c = wireChain(200); c.dispose(); return null; }, 5, 100);
bench('wire 400', () => { const c = wireChain(400); c.dispose(); return null; }, 5, 200);

console.log('--- render (渲染) ---');
const c200 = wireChain(200);
const c400 = wireChain(400);
bench('render 200', () => { const r = renderChain(c200); releaseFrames(r.frames); return null; }, 5, 200);
const r400 = bench('render 400', () => { const r = renderChain(c400); releaseFrames(r.frames); return null; }, 5, 200);
c200.dispose();
c400.dispose();
