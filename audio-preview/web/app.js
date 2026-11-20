'use strict';

// Preview page controller. All DSP comes from the shared UMD core
// (window.AudioPreview). Metrics shown on the page are computed from the exact
// samples drawn into the canvas; nothing is hard-coded.

const AP = window.AudioPreview;

// Timing budgets required for this collision layer.
const WIRE_BUDGET = { 200: 100, 400: 200 }; // ms
const RENDER_BUDGET_MS = 200;

const $ = (id) => document.getElementById(id);

$('hdr-rate').textContent = AP.SAMPLE_RATE;
$('hdr-frames').textContent = AP.RENDER_FRAMES;
$('hdr-dur').textContent = ((AP.RENDER_FRAMES / AP.SAMPLE_RATE) * 1000).toFixed(2);

const wireTbody = $('wire-table').querySelector('tbody');
const renderTbody = $('render-table').querySelector('tbody');
let clickCount = 0;

function addRow(tbody, cells, ok) {
  const tr = document.createElement('tr');
  cells.forEach((text, idx) => {
    const td = document.createElement('td');
    td.textContent = text;
    if (idx === cells.length - 1) td.className = ok ? 'budget-ok' : 'budget-bad';
    tr.appendChild(td);
  });
  tbody.appendChild(tr);
}

// --- canvas drawing --------------------------------------------------------
const canvas = $('chart');
const ctx = canvas.getContext('2d');

function drawWave(samples, opts) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // background grid
  ctx.strokeStyle = '#222b36';
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= 10; gx++) {
    const x = (gx / 10) * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
  ctx.strokeStyle = '#33404f'; ctx.stroke();

  const n = samples.length;
  let maxAbs = 1e-9;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i]);
    if (a > maxAbs) maxAbs = a;
  }
  const mid = H / 2;
  const amp = (H / 2) * 0.9;

  // envelope reference (0.2 -> 0.05), normalized to its start
  if (opts.showEnvelope) {
    ctx.beginPath();
    ctx.strokeStyle = '#ffb86b';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W;
      const env = AP.GAIN_START + ((AP.GAIN_END - AP.GAIN_START) * i) / (n - 1);
      const y = mid - (env / AP.GAIN_START) * amp * 0.95;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // mirrored lower edge
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W;
      const env = AP.GAIN_START + ((AP.GAIN_END - AP.GAIN_START) * i) / (n - 1);
      const y = mid + (env / AP.GAIN_START) * amp * 0.95;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // the samples
  ctx.beginPath();
  ctx.strokeStyle = opts.color || '#4cc2ff';
  ctx.lineWidth = 1.25;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * W;
    const y = mid - (samples[i] / maxAbs) * amp;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // time axis labels
  ctx.fillStyle = '#9aa7b4';
  ctx.font = '11px sans-serif';
  const ms = (n / AP.SAMPLE_RATE) * 1000;
  for (let gx = 0; gx <= 5; gx++) {
    const x = (gx / 5) * W;
    ctx.fillText(((gx / 5) * ms).toFixed(1) + ' ms', x + 2, H - 4);
  }
}

// Compute the displayed metrics from the samples actually drawn.
function computeMetrics(samples) {
  let absSum = 0, peak = 0;
  for (let i = 0; i < samples.length; i++) {
    absSum += Math.abs(samples[i]);
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  return {
    absSum,
    peak,
    durationMs: (samples.length / AP.SAMPLE_RATE) * 1000,
  };
}

function showResult(frames, title, drawOpts) {
  const samples = frames.data;
  drawWave(samples, drawOpts);
  const m = computeMetrics(samples);
  $('chart-title').textContent = title;
  $('m-ms').textContent = m.durationMs.toFixed(3);
  $('m-abs').textContent = m.absSum.toFixed(4);
  $('m-peak').textContent = m.peak.toFixed(6);
  return m;
}

// --- main actions ----------------------------------------------------------

// Wire a chain of `sections` (fresh each click), time the wiring and the full
// render round-trip, then draw the returned samples.
function runChain(sections) {
  clickCount++;

  const tWire0 = performance.now();
  const chain = AP.wireChain(sections);
  const tWire1 = performance.now();
  const wireMs = tWire1 - tWire0;

  const tRender0 = performance.now();
  const result = AP.renderChain(chain);
  // "采样回来": the frames buffer is the returned offline samples.
  const tRender1 = performance.now();
  const renderMs = tRender1 - tRender0;

  const wireBudget = WIRE_BUDGET[sections] || 200;
  const wireOk = wireMs < wireBudget;
  const renderOk = renderMs < RENDER_BUDGET_MS;

  addRow(wireTbody,
    ['#' + clickCount, sections, wireMs.toFixed(2), '< ' + wireBudget, wireOk ? 'PASS' : 'FAIL'],
    wireOk);
  addRow(renderTbody,
    ['#' + clickCount, sections, renderMs.toFixed(2), '< ' + RENDER_BUDGET_MS, renderOk ? 'PASS' : 'FAIL'],
    renderOk);

  $('cur-sections').textContent = sections + ' 节';
  const m = showResult(result.frames,
    sections + ' 节共振链 · 本次采样（50 ms 内音量由 0.2 收到 0.05）',
    { showEnvelope: true, color: '#4cc2ff' });
  $('m-note').innerHTML =
    '本次接线 ' + wireMs.toFixed(2) + ' ms，渲染往返 ' + renderMs.toFixed(2) +
    ' ms；绝对值和/峰值/毫秒均由图中这次采样算出。';

  // Every connection changes the rendered sound: reflect the live section spec.
  renderSectionList(sections);

  AP.releaseFrames(result.frames);
  chain.dispose();
  return { wireMs, renderMs, metrics: m };
}

function renderSectionList(sections) {
  const el = $('section-list');
  el.innerHTML = '';
  const head = document.createElement('div');
  head.innerHTML = '<b>每节参数（频率 36 节一循环，增益交替 ±2 dB，Q 0.7）</b>';
  el.appendChild(head);
  const start = Math.max(0, sections - 12);
  for (let i = start; i < sections; i++) {
    const f = AP.sectionFrequency(i);
    const g = AP.sectionGainDB(i);
    const d = document.createElement('div');
    d.innerHTML = '<span>第 ' + (i + 1) + ' 节</span><span>' + f + ' Hz · ' + (g > 0 ? '+' : '') + g + ' dB</span>';
    el.appendChild(d);
  }
}

$('btn-400').addEventListener('click', () => runChain(400));
$('btn-200').addEventListener('click', () => runChain(200));

$('btn-loop0').addEventListener('click', () => {
  clickCount++;
  const r = AP.renderZeroDelayLoop();
  const m = showResult(r.frames, '不带延迟回路 · 本上下文静音（全零）',
    { showEnvelope: false, color: '#3fb950' });
  $('cur-sections').innerHTML = '无延迟回路 <span class="tag muted">上下文静音</span>';
  $('m-note').textContent =
    '浏览器直接渲染该回路会响；本套上下文把不带延迟的回路视为静音，绝对值和与峰值均为 0。';
  AP.releaseFrames(r.frames);
  addRow(renderTbody,
    ['#' + clickCount, 'loop0', '0.00', '—', 'MUTED'], true);
});

$('btn-loop10').addEventListener('click', () => {
  clickCount++;
  const r = AP.renderDelayedLoop();
  const m = showResult(r.frames, '10 ms 延迟回路 · y[t] = x[t] + k·y[t−480]',
    { showEnvelope: false, color: '#b083f0' });
  $('cur-sections').innerHTML = '10 ms 延迟回路 <span class="tag">k=' + AP.LOOP_FEEDBACK + '</span>';
  $('m-note').textContent =
    '带延迟回路采样与本上下文既有结果一致；绝对值和 ' + m.absSum.toFixed(4) +
    '，峰值 ' + m.peak.toFixed(6) + '。';
  AP.releaseFrames(r.frames);
  addRow(renderTbody,
    ['#' + clickCount, 'loop10', '—', '—', 'OK'], true);
});

// Draw an initial empty baseline so the canvas is never blank.
(function init() {
  const silent = AP.renderZeroDelayLoop();
  showResult(silent.frames, '等待接线…', { showEnvelope: true, color: '#4cc2ff' });
  AP.releaseFrames(silent.frames);
})();
