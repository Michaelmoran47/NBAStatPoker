// @ts-check
// Small stateless helpers shared by the client and the match driver.

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
