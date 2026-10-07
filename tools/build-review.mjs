// Builds tools/question-review.html from js/questions.js, so you can mark each question Keep or Drop.
// Run from the repo root: node tools/build-review.mjs. Then open tools/question-review.html in a browser.
// This folder isn't served by the game server, so the review page never goes public.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { QUESTIONS, CATEGORIES } = await import(pathToFileURL(path.join(here, '..', 'js', 'questions.js')).href);

const data = JSON.stringify(QUESTIONS.map(q => ({
  id: q.id,
  category: q.category,
  text: q.text,
  answer: q.answer,
  label: q.label ?? ''
})));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Question review</title>
<style>
  body{ margin:0; font-family:system-ui, sans-serif; background:#0f1237; color:#fff; }
  main{ max-width:760px; margin:0 auto; padding:20px 16px 60px; }
  h1{ font-size:1.3em; margin:0 0 4px; }
  .sub{ color:#a2a7e5; font-size:.9em; margin:0 0 14px; }
  .bar{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:16px; }
  button{ font:inherit; padding:8px 14px; border-radius:8px; border:0; cursor:pointer; background:#262d8c; color:#fff; }
  button.keep{ background:#65c853; color:#0f1237; }
  button.drop{ background:#ff4d4d; color:#fff; }
  button.on{ outline:3px solid #fffa0b; }
  .card{ background:#1e2470; border-radius:10px; padding:12px 14px; margin-bottom:10px; }
  .cat{ color:#7acaf6; font-size:.78em; text-transform:uppercase; letter-spacing:.05em; }
  .text{ margin:4px 0 8px; }
  .meta{ color:#a2a7e5; font-size:.82em; margin-bottom:8px; }
  .card.dropped{ opacity:.55; }
  textarea{ width:100%; box-sizing:border-box; min-height:120px; background:#0f1237; color:#fff; border:1px solid #a2a7e5; border-radius:8px; padding:8px; font:inherit; }
  .count{ color:#fffa0b; font-weight:700; }
</style>
</head>
<body>
<main>
  <h1>Question review</h1>
  <p class="sub">Mark each question Keep or Drop. Your choices save in this browser, so you can come back later. When you're done, press "Copy drop list" and paste it into the chat.</p>
  <div class="bar">
    <span class="count" id="count"></span>
    <button id="copy">Copy drop list</button>
    <button id="reset">Clear all marks</button>
  </div>
  <div id="list"></div>
</main>
<script>
  const QUESTIONS = ${data};
  const KEY = 'quantrivia-question-review';
  let marks = {};
  try { marks = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { marks = {}; }

  function save(){
    try { localStorage.setItem(KEY, JSON.stringify(marks)); } catch (e) { /* private window: marks last only this page */ }
    updateCount();
  }

  function updateCount(){
    const drops = Object.values(marks).filter(v => v === 'drop').length;
    const keeps = Object.values(marks).filter(v => v === 'keep').length;
    document.getElementById('count').textContent = keeps + ' kept, ' + drops + ' dropped, ' + (QUESTIONS.length - keeps - drops) + ' unmarked';
  }

  function render(){
    const list = document.getElementById('list');
    list.textContent = '';
    for(const q of QUESTIONS){
      const card = document.createElement('div');
      card.className = 'card' + (marks[q.id] === 'drop' ? ' dropped' : '');
      const cat = document.createElement('div');
      cat.className = 'cat';
      cat.textContent = q.category + ' · ' + q.id;
      const text = document.createElement('div');
      text.className = 'text';
      text.textContent = q.text;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = 'Answer: ' + q.answer.toLocaleString() + (q.label ? ' ' + q.label : '');
      const row = document.createElement('div');
      row.className = 'bar';
      row.style.marginBottom = '0';
      for(const [value, label, cls] of [['keep', 'Keep', 'keep'], ['drop', 'Drop', 'drop']]){
        const b = document.createElement('button');
        b.textContent = label;
        b.className = cls + (marks[q.id] === value ? ' on' : '');
        b.addEventListener('click', () => {
          marks[q.id] = marks[q.id] === value ? undefined : value;
          if(marks[q.id] === undefined) delete marks[q.id];
          save();
          render();
        });
        row.appendChild(b);
      }
      card.append(cat, text, meta, row);
      list.appendChild(card);
    }
    updateCount();
  }

  document.getElementById('copy').addEventListener('click', async () => {
    const drops = QUESTIONS.filter(q => marks[q.id] === 'drop').map(q => q.id);
    const text = drops.length ? 'Drop: ' + drops.join(', ') : 'Drop: none';
    try {
      await navigator.clipboard.writeText(text);
      alert('Copied: ' + text);
    } catch (e) {
      prompt('Copy this list:', text);
    }
  });

  document.getElementById('reset').addEventListener('click', () => {
    if(!confirm('Clear all Keep and Drop marks?')) return;
    marks = {};
    save();
    render();
  });

  render();
</script>
</body>
</html>
`;

writeFileSync(path.join(here, 'question-review.html'), html);
console.log('Wrote tools/question-review.html with ' + QUESTIONS.length + ' questions in ' + CATEGORIES.length + ' categories.');
