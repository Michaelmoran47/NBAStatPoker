// @ts-check
// Runs a whole match: for each round, show the question, open the guess window, wait for every human
// to answer, then close the round and show its result. Solo and multiplayer both drive this same
// function. The only differences are the callbacks they pass in: how to wait for human guesses, and
// how to redraw the screen.

import { beginRound, openGuessing, submitGuess, finishRound, botGuess, endGame } from './trivia.js';
import { sleep } from './utils.js';

// No pause between the result and the next question. The question and the answer box appear together,
// so the result timer hands straight over to the next round.
export const QUESTION_PAUSE_MS = 0;
// How long a round's answer and guesses stay up before the next question. The daily waits for a button.
export const ROUND_RESULT_MS = 7500;

/**
 * @typedef {Object} DriverOptions
 * @property {import('./trivia.js').Question[]} questions Questions for the match, in order. Pick them up front.
 * @property {() => void} render Called after every state change so the driver can redraw.
 * @property {(G: import('./trivia.js').GameState) => Promise<void>} awaitGuesses Resolves once every
 *   human seat has submitted or the guess clock has run out. Each driver owns its own timer.
 * @property {{id:number, spread?:number}[]} [bots] Seats the driver fills in itself (solo CPU opponents).
 * @property {() => boolean} [isAlive] Returns false to stop early, e.g. the room was torn down.
 * @property {() => Promise<void>} [awaitNext] Replaces the result pause: resolves when the player is ready for the next question.
 * @property {() => number} [random]
 * @property {number} [questionPauseMs]
 * @property {number} [roundResultMs]
 */

/**
 * @param {import('./trivia.js').GameState} G
 * @param {DriverOptions} opts
 * @returns {Promise<void>}
 */
export async function playGame(G, opts){
  const random = opts.random ?? Math.random;
  const alive = opts.isAlive ?? (() => true);
  const bots = opts.bots ?? [];
  const questionPause = opts.questionPauseMs ?? QUESTION_PAUSE_MS;
  const resultPause = opts.roundResultMs ?? ROUND_RESULT_MS;

  for(const question of opts.questions){
    if(!alive()) return;
    beginRound(G, question);
    opts.render();

    await sleep(questionPause);
    if(!alive()) return;

    openGuessing(G);
    for(const bot of bots){
      submitGuess(G, bot.id, botGuess(question, random, bot.spread));
    }
    opts.render();

    await opts.awaitGuesses(G);
    if(!alive()) return;

    finishRound(G);
    opts.render();
    if(opts.awaitNext) await opts.awaitNext();
    else await sleep(resultPause);
  }
  endGame(G);
  opts.render();
}
