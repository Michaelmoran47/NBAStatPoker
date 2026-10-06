// @ts-check
// Entry point for the solo page. The game's HTML is built by ui.js with event listeners, so
// nothing needs to be exposed on window.
import { renderStart } from './ui.js';
import { mountChrome } from '../social/chrome.js';

mountChrome({active: null, title: 'Solo', back: '/'});
renderStart();
