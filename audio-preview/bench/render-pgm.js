'use strict';

// Render the same waveform the page draws to a binary PGM (grayscale), so we
// can confirm the 50 ms gain-decay shape visually without a browser.
const fs = require('fs');
const AP = require('../engine/core.js');

const chain = AP.wireChain(400);
const result = AP.renderChain(chain);
const samples = result.frames.data;
const W = 1080, H = 260;

// grayscale pixel buffer initialized to dark background
const img = Buffer.alloc(W * H, 14);
function setPx(x, y, v) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  img[y * W + x] = v;
}
function line(x0, y0, x1, y1, v) {
  let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPx(x0, y0, v);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// grid
for (let gx = 0; gx <= 10; gx++) line(Math.round((gx / 10) * W), 0, Math.round((gx / 10) * W), H - 1, 40);
line(0, H / 2, W - 1, H / 2, 60);

let maxAbs = 1e-9;
for (const s of samples) maxAbs = Math.max(maxAbs, Math.abs(s));
const mid = H / 2, amp = (H / 2) * 0.9;
const pts = [];
for (let i = 0; i < samples.length; i++) {
  const x = Math.round((i / (samples.length - 1)) * W);
  const y = Math.round(mid - (samples[i] / maxAbs) * amp);
  pts.push([x, y]);
}
for (let i = 1; i < pts.length; i++) line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], 220);

// envelope edges (orange-ish bright)
for (let i = 0; i < samples.length; i++) {
  const x = Math.round((i / (samples.length - 1)) * W);
  const env = AP.GAIN_START + ((AP.GAIN_END - AP.GAIN_START) * i) / (samples.length - 1);
  const ye = Math.round(mid - (env / AP.GAIN_START) * amp * 0.95);
  setPx(x, ye, 170);
  setPx(x, H - 1 - ye < H ? H - 1 - ye : ye, 170);
}

// P5 PGM
const header = Buffer.from(`P5\n${W} ${H}\n255\n`);
fs.writeFileSync(path('wave400.pgm'), Buffer.concat([header, img]));
console.log('wrote wave400.pgm; absSum=', result.absSum.toFixed(4), 'peak=', result.peak.toFixed(6));
AP.releaseFrames(result.frames);
chain.dispose();

function path(f) { return require('path').join(__dirname, f); }
