'use strict';

// Re-export shim: the single implementation lives in core.js (UMD, shared with
// the browser preview page).
const core = require('./core.js');
module.exports = core;
