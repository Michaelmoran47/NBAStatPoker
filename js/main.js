// @ts-check
// Entry point. The HTML template strings in ui.js use inline onclick="..." handlers
// (simplest thing that works for a server-rendered-string UI), so the functions they
// call need to exist as globals — bridge them here rather than scattering `window.x =`
// assignments through ui.js.

import { renderStart, startGame, humanAction, doRaise, nextHand } from './ui.js';

Object.assign(window, { renderStart, startGame, humanAction, doRaise, nextHand });

renderStart();
