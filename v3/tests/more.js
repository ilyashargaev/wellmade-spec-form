// The "?" by a question heading (question "more"): a fuller explanation that opens under the heading.
// node tests/more.js "<Build - v3 folder>" "<scratch out folder>"
const { launch, fileUrl, sleep } = require('./cdp.js');
const path = require('path'), fs = require('fs'), vm = require('vm');
const PILOT = process.argv[2], OUT = process.argv[3];
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const J = JSON.stringify;
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

const ctx = { console, URL }; vm.createContext(ctx);
vm.runInContext('var window=globalThis;' + fs.readFileSync(path.join(PILOT, 'spec/presidio-xo.js'), 'utf8'), ctx);
const S = ctx.SPEC_DATA;
const WITH = [];
S.steps.forEach(st => (st.items || []).forEach(q => { if (q.more) WITH.push({ step: st.id, q }); }));
ok(WITH.length > 0, 'spec: questions with a "?": ' + WITH.map(w => w.q.id).join(', '));
ok(WITH.every(w => Array.isArray(w.q.more.text) && w.q.more.text.length && w.q.more.text.every(t => t.trim()) && !w.q.hideLabel), 'spec: every "more" has paragraphs and a visible heading');
const WORDS = WITH.map(w => w.q.id + ' ' + w.q.more.text.join(' ').split(/\s+/).length);
ok(WITH.every(w => w.q.more.text.join(' ').split(/\s+/).length <= 90), 'spec: every explanation is short (90 words at most): ' + WORDS.join(', '));

const HELP = fs.readFileSync(path.join(PILOT, 'tests', 'helpers.js'), 'utf8');
const STATE = id => `(() => { const b = document.querySelector('.more-btn[data-qid="${id}"]'), p = document.getElementById('more-${id}');
  if (!b || !p) return null; const r = b.getBoundingClientRect(), h = b.parentElement.querySelector('h3').getBoundingClientRect();
  return { open: b.getAttribute('aria-expanded'), hidden: p.hidden, shown: getComputedStyle(p).display !== 'none', label: b.getAttribute('aria-label'), controls: b.getAttribute('aria-controls'),
    text: [...p.querySelectorAll('p')].map(e => e.textContent), tap: Math.min(r.width, r.height), right: Math.round(r.right), sameRow: r.top < h.bottom && r.bottom > h.top,
    after: p.previousElementSibling === b.parentElement, w: document.documentElement.scrollWidth }; })()`;
const shot = async (b, file, sel) => {
  const box = await b.ev(`(() => { const e = document.querySelector(${J(sel)}); e.scrollIntoView(); const r = e.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY - 8), width: 390, height: Math.min(r.height + 16, 1800) }; })()`);
  const r = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: Object.assign({ scale: 1 }, box) });
  fs.writeFileSync(path.join(OUT, 'shots', file), Buffer.from(r.result.data, 'base64'));
};

(async () => {
  const b = await launch(path.join(OUT, 'profile-more'), 9346);
  try {
    await b.nav(fileUrl(path.join(PILOT, 'index.html'))); await sleep(500);
    await b.ev(HELP);
    await b.ev('T.type("client","More Test")');
    for (const w of WITH) {
      const id = w.q.id;
      await b.ev(`T.go(${J(w.step)})`); await sleep(300);
      let s = await b.ev(STATE(id));
      ok(s && s.open === 'false' && s.hidden && !s.shown, id + ': the "?" is there and the explanation starts closed');
      ok(s && s.tap >= 44 && s.sameRow && s.right <= 390 && s.w === 390, id + ': the "?" sits in the heading row, 44 px to tap, no horizontal scroll (' + (s && s.tap) + ')');
      ok(s && s.label && s.controls === 'more-' + id && s.after, id + ': the button names what it opens and the panel follows the heading: ' + (s && s.label));
      await shot(b, '390-more-' + id + '-closed.png', '#q-' + id);
      await b.ev(`document.querySelector('.more-btn[data-qid="${id}"]').click(); true`); await sleep(150);
      s = await b.ev(STATE(id));
      ok(s.open === 'true' && !s.hidden && s.shown && J(s.text) === J(w.q.more.text), id + ': a tap opens it with the text of the spec');
      ok(s.w === 390, id + ': open, still no horizontal scroll at 390 px');
      await shot(b, '390-more-' + id + '-open.png', '#q-' + id);
      const first = w.q.options && w.q.options[0];
      if (first) {
        await b.ev(`T.pick(${J(id)}, ${J(first.id)})`); await sleep(200);
        s = await b.ev(STATE(id));
        ok(s && s.open === 'true' && s.shown, id + ': picking an answer keeps the explanation open');
      }
      await b.ev(`document.querySelector('.more-btn[data-qid="${id}"]').click(); true`); await sleep(150);
      s = await b.ev(STATE(id));
      ok(s.open === 'false' && s.hidden && !s.shown, id + ': a second tap closes it');
    }
    // a question without "more" has no "?"
    await b.ev('T.go("finishes")'); await sleep(300);
    const n = await b.ev(`({ btns: [...document.querySelectorAll('main .more-btn')].map(e => e.getAttribute('data-qid')) })`);
    const want = WITH.filter(w => w.step === 'finishes').map(w => w.q.id);
    ok(J(n.btns) === J(want), 'Finishes: a "?" only where the spec has "more": ' + J(n.btns));
    // Review lists the answers only: no "?" there
    await b.ev('T.go("review")'); await sleep(300);
    ok(await b.ev('document.querySelectorAll("main .more-btn, main .more-panel").length') === 0, 'Review has no "?"');
    console.log('exceptions:', J(b.exceptions()));
    ok(b.exceptions().length === 0, 'no page exceptions');
  } finally { await b.close(); }
  console.log(fails ? 'FAILS: ' + fails : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
