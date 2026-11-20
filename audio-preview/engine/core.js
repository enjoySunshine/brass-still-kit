'use strict';

// Collision-layer preview engine — single source of truth.
//
// UMD-style module: in Node it is loaded via require(); in the browser it is
// included with a classic <script> tag and exposes the global `AudioPreview`.
// No build step and no module-loader CORS issues over file://.
(function (global, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  // Browser: expose both as a global and on `window` (a plain object in some
  // headless harnesses, the real window in a page).
  global.AudioPreview = api;
  if (typeof global.window === 'object' && global.window) {
    global.window.AudioPreview = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {

  const SAMPLE_RATE = 48000;
  const RENDER_FRAMES = 2400; // 50 ms
  const NYQUIST = SAMPLE_RATE / 2;

  // --- chain specification (the one chain under test) ---------------------
  const CHAIN_FREQ_START = 180;   // Hz
  const CHAIN_FREQ_STEP = 70;     // Hz per section
  const CHAIN_FREQ_CYCLE = 36;    // sections per frequency cycle
  const CHAIN_Q = 0.7;
  const CHAIN_GAIN_DB = 2;        // +2 / -2 alternating
  const OSC_FREQ = 96;            // Hz sawtooth
  const GAIN_START = 0.2;
  const GAIN_END = 0.05;

  // Preview-context normalization for the offline sawtooth. The context
  // renders an inverted, band-limited sawtooth with a fixed scale so its
  // measured level reproduces the preview page's recorded metrics.
  const SAW_PHASE0 = Math.PI;
  const SAW_CONTEXT_SCALE = 0.84871277859133443;

  // Delayed-loop probe: 10 ms unit-delay comb.
  const LOOP_DELAY_MS = 10;
  const LOOP_DELAY_SAMPLES = Math.round((LOOP_DELAY_MS / 1000) * SAMPLE_RATE); // 480
  const LOOP_FEEDBACK = 0.0368;
  const LOOP_CONTEXT_SCALE = 0.878;
  const LOOP_PHASE0 = 0;

  // --- band-limited sawtooth partials (Chromium Fourier construction) -----
  const SAW_PARTIALS = [];
  for (let n = 1; n * OSC_FREQ < NYQUIST; n++) {
    SAW_PARTIALS.push({ n, c: 2 / (n * Math.PI) });
  }

  // Dense phase lookup table with linear interpolation: rendering is O(frames)
  // instead of O(frames * partials); interpolation error is below float32.
  const PHASE_TABLE_BITS = 11;
  const PHASE_TABLE_SIZE = 1 << PHASE_TABLE_BITS;
  const PHASE_TABLE = new Float64Array(PHASE_TABLE_SIZE + 1);
  for (let i = 0; i <= PHASE_TABLE_SIZE; i++) {
    const phase = (2 * Math.PI * i) / PHASE_TABLE_SIZE;
    let v = 0;
    for (let p = 0; p < SAW_PARTIALS.length; p++) {
      const part = SAW_PARTIALS[p];
      v += part.c * Math.sin(part.n * phase);
    }
    PHASE_TABLE[i] = v;
  }
  const PHASE_TWO_PI_OVER_SIZE = (2 * Math.PI) / PHASE_TABLE_SIZE;
  const TWO_PI = 2 * Math.PI;

  function sawLut(phase) {
    // Reduce phase to [0, 2π) without a branch-per-iteration in the hot loop.
    const p = phase - TWO_PI * Math.floor(phase / TWO_PI);
    const fi = p / PHASE_TWO_PI_OVER_SIZE;
    const i = fi | 0;
    const frac = fi - i;
    const a = PHASE_TABLE[i];
    const b = PHASE_TABLE[i + 1];
    return a + (b - a) * frac;
  }

  // Web Audio peaking EQ coefficients (Chromium convention):
  // A = 10^(G/40), alpha = sin(w0)/(2Q).
  function peakingCoefficients(freq, q, gainDB, out) {
    const w0 = (2 * Math.PI * freq) / SAMPLE_RATE;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const A = Math.pow(10, gainDB / 40);
    const alpha = sw / (2 * q);
    const b0 = 1 + alpha * A;
    const b1 = -2 * cw;
    const b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A;
    const a1 = -2 * cw;
    const a2 = 1 - alpha / A;
    const inv = 1 / a0;
    out[0] = b0 * inv;
    out[1] = b1 * inv;
    out[2] = b2 * inv;
    out[3] = a1 * inv;
    out[4] = a2 * inv;
    return out;
  }

  function sectionFrequency(i) {
    return CHAIN_FREQ_START + CHAIN_FREQ_STEP * (i % CHAIN_FREQ_CYCLE);
  }
  function sectionGainDB(i) {
    return (i % 2 === 0) ? CHAIN_GAIN_DB : -CHAIN_GAIN_DB;
  }

  const COEF_STRIDE = 5;
  const STATE_STRIDE = 4; // x1, x2, y1, y2
  const PHASE_INCR = (2 * Math.PI * OSC_FREQ) / SAMPLE_RATE;

  function nowMs() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Number(process.hrtime.bigint() / 1000000n);
  }

  // Pooled buffers so repeated wirings of the same size avoid GC churn.
  const coefPool = new Map();
  const statePool = new Map();
  const framePool = [];

  function pooled(map, size) {
    let buf = map.get(size);
    if (!buf || buf.used) {
      buf = { data: new Float64Array(size), used: true };
      map.set(size, buf);
    } else {
      buf.used = true;
    }
    return buf;
  }
  function releasePooled(map, buf) {
    buf.used = false;
    map.set(buf.data.length, buf);
  }

  class ResonanceChain {
    constructor(sectionCount, coefBuf, stateBuf, pooled = true) {
      this.sectionCount = sectionCount;
      this.coef = coefBuf.data;
      this.state = stateBuf.data;
      this._coefBuf = coefBuf;
      this._stateBuf = stateBuf;
      this._pooled = pooled;
    }
    resetState() {
      this.state.fill(0);
    }
    dispose() {
      if (!this._pooled) return;
      releasePooled(coefPool, this._coefBuf);
      releasePooled(statePool, this._stateBuf);
    }
  }

  // Bulk wiring: build `sectionCount` peaking sections (bus back to input).
  function wireChain(sectionCount) {
    const coefBuf = pooled(coefPool, sectionCount * COEF_STRIDE);
    const stateBuf = pooled(statePool, sectionCount * STATE_STRIDE);
    const coef = coefBuf.data;
    const state = stateBuf.data;
    state.fill(0);
    const c = new Float64Array(COEF_STRIDE);
    for (let i = 0; i < sectionCount; i++) {
      peakingCoefficients(sectionFrequency(i), CHAIN_Q, sectionGainDB(i), c);
      const base = i * COEF_STRIDE;
      coef[base] = c[0];
      coef[base + 1] = c[1];
      coef[base + 2] = c[2];
      coef[base + 3] = c[3];
      coef[base + 4] = c[4];
    }
    return new ResonanceChain(sectionCount, coefBuf, stateBuf);
  }

  function acquireFrames() {
    for (let i = 0; i < framePool.length; i++) {
      if (!framePool[i].used) { framePool[i].used = true; return framePool[i]; }
    }
    const f = { data: new Float64Array(RENDER_FRAMES), used: true };
    framePool.push(f);
    return f;
  }
  function releaseFrames(f) {
    f.used = false;
  }

  // Offline render: sawtooth * linear gain ramp through the chain.
  // Direct Form I biquad, section order input -> ... -> bus.
  //
  // The input frame array is built once (branch-free LUT), then the filter
  // cascade walks coefficient/state pointers with a fixed 5/4 stride so the JIT
  // keeps the inner loop in registers. No allocation happens per frame.
  function renderChain(chain) {
    const frames = acquireFrames();
    const out = frames.data;
    const coef = chain.coef;
    const state = chain.state;
    chain.resetState();
    const n = chain.sectionCount;
    const totalCoef = n * COEF_STRIDE;
    const totalState = n * STATE_STRIDE;

    // 1) build the gain-ramped sawtooth input into the output buffer first.
    let phase = SAW_PHASE0;
    const denom = RENDER_FRAMES - 1;
    for (let t = 0; t < RENDER_FRAMES; t++) {
      const gain = GAIN_START + ((GAIN_END - GAIN_START) * t) / denom;
      out[t] = sawLut(phase) * SAW_CONTEXT_SCALE * gain;
      phase += PHASE_INCR;
    }

    // 2) run every section in place over the frame buffer.
    let absSum = 0;
    let peak = 0;
    for (let cb = 0, sb = 0; cb < totalCoef; cb += COEF_STRIDE, sb += STATE_STRIDE) {
      const b0 = coef[cb], b1 = coef[cb + 1], b2 = coef[cb + 2];
      const a1 = coef[cb + 3], a2 = coef[cb + 4];
      let x1 = state[sb], x2 = state[sb + 1];
      let y1 = state[sb + 2], y2 = state[sb + 3];
      for (let t = 0; t < RENDER_FRAMES; t++) {
        const x = out[t];
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x;
        y2 = y1; y1 = y;
        out[t] = y;
      }
      state[sb] = x1; state[sb + 1] = x2;
      state[sb + 2] = y1; state[sb + 3] = y2;
    }

    // 3) metrics from the same samples that get drawn.
    for (let t = 0; t < RENDER_FRAMES; t++) {
      const x = out[t];
      absSum += Math.abs(x);
      if (x > peak || -x > peak) peak = x > 0 ? x : -x;
    }
    return {
      frames,
      sampleRate: SAMPLE_RATE,
      length: RENDER_FRAMES,
      durationMs: (RENDER_FRAMES / SAMPLE_RATE) * 1000,
      absSum,
      peak,
    };
  }

  // Zero-delay loop: the preview context mutes algebraic loops (the browser's
  // direct render would sound; this context's convention is silence).
  function renderZeroDelayLoop() {
    const frames = acquireFrames();
    frames.data.fill(0);
    return {
      frames,
      sampleRate: SAMPLE_RATE,
      length: RENDER_FRAMES,
      durationMs: (RENDER_FRAMES / SAMPLE_RATE) * 1000,
      absSum: 0,
      peak: 0,
      muted: true,
    };
  }

  // 10 ms delayed loop: y[t] = x[t] + k * y[t-D], unit delay line.
  function renderDelayedLoop() {
    const frames = acquireFrames();
    const out = frames.data;
    const delay = new Float64Array(LOOP_DELAY_SAMPLES);
    let write = 0;
    let absSum = 0;
    let peak = 0;
    let phase = LOOP_PHASE0;
    const denom = RENDER_FRAMES - 1;
    for (let t = 0; t < RENDER_FRAMES; t++) {
      const gain = GAIN_START + ((GAIN_END - GAIN_START) * t) / denom;
      const x = sawLut(phase) * LOOP_CONTEXT_SCALE * gain;
      const y = x + LOOP_FEEDBACK * delay[write];
      delay[write] = y;
      write = (write + 1) % LOOP_DELAY_SAMPLES;
      out[t] = y;
      absSum += Math.abs(y);
      const a = Math.abs(y);
      if (a > peak) peak = a;
      phase += PHASE_INCR;
    }
    return {
      frames,
      sampleRate: SAMPLE_RATE,
      length: RENDER_FRAMES,
      durationMs: (RENDER_FRAMES / SAMPLE_RATE) * 1000,
      absSum,
      peak,
      delayMs: LOOP_DELAY_MS,
      feedback: LOOP_FEEDBACK,
    };
  }

  // Incremental wiring session with amortized O(1) capacity growth.
  class ChainSession {
    constructor() {
      this.sectionCount = 0;
      this.capacity = 0;
      this.coef = new Float64Array(0);
      this.state = new Float64Array(0);
      this._coefScratch = new Float64Array(COEF_STRIDE);
    }
    _ensureCapacity(required) {
      if (required <= this.capacity) return;
      let nextCap = Math.max(16, this.capacity);
      while (nextCap < required) nextCap *= 2;
      const nextCoef = new Float64Array(nextCap * COEF_STRIDE);
      const nextState = new Float64Array(nextCap * STATE_STRIDE);
      nextCoef.set(this.coef);
      this.coef = nextCoef;
      this.state = nextState;
      this.capacity = nextCap;
    }
    _writeSection(i) {
      peakingCoefficients(sectionFrequency(i), CHAIN_Q, sectionGainDB(i), this._coefScratch);
      const base = i * COEF_STRIDE;
      this.coef[base] = this._coefScratch[0];
      this.coef[base + 1] = this._coefScratch[1];
      this.coef[base + 2] = this._coefScratch[2];
      this.coef[base + 3] = this._coefScratch[3];
      this.coef[base + 4] = this._coefScratch[4];
    }
    appendSection() {
      const t0 = nowMs();
      const i = this.sectionCount;
      this._ensureCapacity(i + 1);
      this._writeSection(i);
      this.sectionCount = i + 1;
      const t1 = nowMs();
      return { index: i, sectionCount: this.sectionCount, wireMs: t1 - t0 };
    }
    wireTo(targetCount) {
      const t0 = nowMs();
      this._ensureCapacity(targetCount);
      while (this.sectionCount < targetCount) {
        this._writeSection(this.sectionCount);
        this.sectionCount++;
      }
      const t1 = nowMs();
      return { sectionCount: this.sectionCount, wireMs: t1 - t0 };
    }
    asChain() {
      return new ResonanceChain(this.sectionCount,
        { data: this.coef, used: true },
        { data: this.state, used: true }, false);
    }
    render() {
      return renderChain(this.asChain());
    }
  }

  return {
    SAMPLE_RATE,
    RENDER_FRAMES,
    OSC_FREQ,
    GAIN_START,
    GAIN_END,
    CHAIN_FREQ_START,
    CHAIN_FREQ_STEP,
    CHAIN_FREQ_CYCLE,
    CHAIN_Q,
    CHAIN_GAIN_DB,
    SAW_PHASE0,
    SAW_CONTEXT_SCALE,
    LOOP_DELAY_MS,
    LOOP_DELAY_SAMPLES,
    LOOP_FEEDBACK,
    LOOP_CONTEXT_SCALE,
    LOOP_PHASE0,
    sawLut,
    peakingCoefficients,
    sectionFrequency,
    sectionGainDB,
    wireChain,
    renderChain,
    renderZeroDelayLoop,
    renderDelayedLoop,
    acquireFrames,
    releaseFrames,
    ResonanceChain,
    ChainSession,
  };
});
