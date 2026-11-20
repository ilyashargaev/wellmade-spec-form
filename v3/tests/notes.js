// Options without a list price (spec 0.3.8): the sentence "your manager will send you the price", the "?" by
// the tag that shows it in a bubble, and the "!" notes for the builder's team (only in links with notes=1).
// Phone, 390 px.   node tests/notes.js "<Build - v3 folder>" "<scratch out folder>"
const { launch, fileUrl, sleep } = require('./cdp.js');
const path = require('path'), fs = require('fs'), vm = require('vm');
const PILOT = process.argv[2], OUT = process.argv[3];
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const J = JSON.stringify;
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

// ---- spec and model ---------------------------------------------------------------------------
const ctx = { console, URL }; vm.createContext(ctx);
vm.runInContext('var window=globalThis;' + fs.readFileSync(path.join(PILOT, 'spec/presidio-xo.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(PILOT, 'engine/model.js'), 'utf8'), ctx);
const S = ctx.SPEC_DATA, E = ctx.SpecEngine;
const HELPTEXT = S.prices.quoteHelp, QT = S.prices.quoteTags, CUSTOMHELP = S.prices.quoteHelpByTag['Custom quote'];
ok(/manager will discuss/i.test(CUSTOMHELP) && /possible/.test(CUSTOMHELP) && /cost/.test(CUSTOMHELP), 'spec: a Custom quote has its own sentence: the manager discusses whether it is possible and what it may cost');
ok(typeof HELPTEXT === 'string' && /manager/i.test(HELPTEXT) && /price/i.test(HELPTEXT) && HELPTEXT.split(/\s+/).length <= 16, 'spec: prices.quoteHelp says the manager sends the price, in 16 words at most');
// Every option with a no-number tag sits under a text (group text or question hint) that carries the sentence.
{
  const missing = [];
  S.steps.forEach(st => (st.items || []).forEach(q => (q.options || []).forEach(o => {
    if (QT.indexOf(o.tag) < 0) return;
    const g = o.group && (q.groups || []).find(x => x.id === o.group);
    // the text near the option: the series text and the line under its tiles, the question hint, and the hint of a field that opens when the option is picked
    const opens = (S.rules || []).filter(r => r.type === 'disables' && r.hide && r.when.question === q.id && [].concat(r.when.isNot || []).indexOf(o.id) >= 0)
      .map(r => (st.items.find(i => i.id === r.targets[0]) || {}).hint || '');
    const text = [g && g.text, g && g.after, q.hint].concat(opens).filter(Boolean).join(' ');
    const need = o.tag === 'Custom quote' ? /manager will (contact you to )?discuss/i : /manager will send you the price/i;
    if (!need.test(text)) missing.push(q.id + '/' + o.id);
  })));
  ok(missing.length === 0, 'every option tagged ' + J(QT) + ' has its sentence near it (series, question hint or the field it opens): missing ' + J(missing));
}
const NOTE = (S.teamNotes || {}).deckPrice;
ok(NOTE && /Clients do not see this/.test(NOTE.title) && NOTE.sign === 'Ilya' && NOTE.text.length >= 1, 'spec: the team note has a title that says clients do not see it, and a signature');
const HASH = E.linkHash(S, 'NotesTest0000001', { name: 'Ann Lee', address: '1 Test St' }, ['a@wllmd.com'], {}, '');
ok(!/notes=/.test(HASH), 'a link made by the manager page never carries "notes"');
ok(E.readLink(S, HASH).notes === false && E.readLink(S, HASH + '&notes=1').notes === true && E.readLink(S, HASH + '&notes=yes').notes === false, 'readLink: notes is on only for notes=1');

const HELP = fs.readFileSync(path.join(PILOT, 'tests', 'helpers.js'), 'utf8');
const FORM = fileUrl(path.join(PILOT, 'index.html')); // linkHash() already starts with '#'
const view = async (b, file) => { const r = await b.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, 'shots', file), Buffer.from(r.result.data, 'base64')); };
const TAGS = `[...document.querySelectorAll('.tag-q')].map(e => ({ q: e.closest('[data-qid]').dataset.qid, v: e.closest('[data-value]').dataset.value, tag: e.querySelector('.wm-tag').textContent, mark: e.querySelector('.tag-q-mark').textContent }))`;
const TIP = `(() => { const t = document.getElementById('tag-tip'); if (!t) return null; const r = t.getBoundingClientRect(), bar = document.querySelector('.bar').getBoundingClientRect();
  return { text: t.textContent, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), barTop: Math.round(bar.top), vw: document.documentElement.clientWidth, w: document.documentElement.scrollWidth }; })()`;
const pressed = (q, v) => `T.btns(${J(q)}).find(e => e.dataset.value === ${J(v)}).getAttribute('aria-pressed')`;

(async () => {
  const b = await launch(path.join(OUT, 'profile-notes'), 9361);
  try {
    // ---- a client's link (no notes) ---------------------------------------------------------------
    await b.nav('about:blank'); await b.nav(FORM + HASH); await sleep(400); await b.ev(HELP);
    await b.ev('T.go("finishes")'); await sleep(300);
    ok(await b.ev('__specFormExport().linkId') === 'NotesTest0000001', 'the form opened as a personal link');
    let tags = await b.ev(TAGS);
    ok(J(tags.map(t => t.q + '/' + t.v).sort()) === J(['deckConfig/custom', 'decking/custom', 'decking/timbertech-ashwood', 'decking/timbertech-dark-roast', 'decking/trex-transcend-havana-gold', 'decking/trex-transcend-spiced-rum']) && tags.every(t => t.mark === '?'),
      'Finishes: a "?" by each of the six tags without a number: ' + J(tags.map(t => t.v + ':' + t.tag)));
    ok(await b.ev('[...document.querySelectorAll(".wm-tag")].filter(t => /^\\+?\\$/.test(t.textContent) || t.textContent === "Included").every(t => !t.closest(".tag-q"))'), 'tags with a price or "Included" get no "?"');
    const texts = await b.ev('[...document.querySelectorAll(".group-text")].map(e => e.textContent)');
    ok(texts.length === 3 && texts.every(t => !/Additional cost|manager/.test(t)), 'series texts describe the boards only (no "Additional cost", no manager sentence): ' + J(texts));
    const afters = await b.ev('[...document.querySelectorAll("#q-decking .group-after")].map(e => ({ t: e.textContent, prev: e.previousElementSibling.dataset.value }))');
    ok(J(afters) === J([{ t: HELPTEXT, prev: 'trex-transcend-spiced-rum' }, { t: HELPTEXT, prev: 'timbertech-dark-roast' }]), 'one line under the tiles of each paid series says the manager sends the price');
    ok(await b.ev('document.querySelector("#q-stain .hint").textContent') === 'All five stains are included in the price.' && await b.ev('document.querySelector("#q-floor .hint").textContent') === 'All three floors are included in the price.'
      && await b.ev('document.querySelectorAll("#q-stain .wm-tag, #q-floor .wm-tag").length') === 0, 'stains and floors: one line says all are included, no tags on the tiles');
    // Custom decking: a button with a text field that opens under it
    ok(await b.ev('document.getElementById("q-deckingCustom").hidden') && !(await b.ev('!!document.querySelector("#q-decking > .hint")')), 'the custom decking field is hidden until Custom decking is picked; no hint about Comments');
    await b.ev('T.scrollTo("#q-decking [data-value=custom]", 200)'); await sleep(150);
    await b.ev('document.querySelector("#q-decking [data-value=custom] .tag-q-mark").click(); true'); await sleep(150);
    ok((await b.ev(TIP) || {}).text === CUSTOMHELP && await b.ev(pressed('decking', 'custom')) === 'false', 'Custom quote: the bubble says the manager will discuss it; the option is not picked');
    await b.ev('T.click("decking", "custom")'); await sleep(150);
    const cf = await b.ev('(() => { const q = document.getElementById("q-deckingCustom"), f = document.getElementById("f-deckingCustom"); return { hidden: q.hidden, ph: f.placeholder, tag: f.tagName, label: q.querySelector("label").className, hint: q.querySelector(".hint").textContent, below: q.getBoundingClientRect().top > document.querySelector("#q-decking [data-value=custom]").getBoundingClientRect().bottom }; })()');
    ok(!cf.hidden && cf.below && cf.tag === 'TEXTAREA' && cf.ph === 'Describe the decking you want here.' && /sr-only/.test(cf.label) && /manager will contact you to discuss/.test(cf.hint), 'Custom decking picked: a text field opens under it with grey sample text: ' + J(cf));
    await view(b, '390-custom-decking-field.png');
    await b.ev('T.type("deckingCustom", "Cedar boards")');
    ok(await b.ev('__specFormExport().answers.deckingCustom') === 'Cedar boards', 'the custom decking text is in the answers');
    await b.ev('T.click("decking", "trex-select-saddle")'); await sleep(150);
    ok(await b.ev('document.getElementById("q-deckingCustom").hidden') && await b.ev('__specFormExport().answers.deckingCustom') === '', 'another decking picked: the field closes and its text is not sent');
    ok(/priced by size\. Your manager will send you the price/i.test(await b.ev('document.querySelector("#q-deckConfig .hint").textContent')), 'Deck configuration: the hint says a custom deck is priced by the manager');
    ok(await b.ev('document.querySelectorAll(".team-btn, .team-note").length') === 0, 'a client link shows no "!" and no team note');

    // tap the "?" of Spiced Rum: the bubble opens, the option is NOT picked
    await b.ev('T.scrollTo("[data-value=trex-transcend-spiced-rum]", 60)'); await sleep(200);
    await b.ev('document.querySelector("[data-value=trex-transcend-spiced-rum] .tag-q-mark").click(); true'); await sleep(150);
    let tip = await b.ev(TIP);
    ok(tip && tip.text === HELPTEXT, 'tap on "?": the bubble shows the sentence');
    ok(tip && tip.left >= 12 && tip.right <= tip.vw - 12 && tip.w === 390 && tip.top >= 0 && tip.bottom <= tip.barTop, 'the bubble is inside the screen and above the bottom bar: ' + J(tip));
    ok(await b.ev(pressed('decking', 'trex-transcend-spiced-rum')) === 'false', 'tap on "?" does not pick the option');
    await view(b, '390-tag-help-bubble.png');
    await b.ev('document.querySelector("[data-value=trex-transcend-spiced-rum] .tag-q .wm-tag").click(); true'); await sleep(100);
    ok(await b.ev(TIP) === null, 'second tap on the tag closes the bubble');
    await b.ev('document.querySelector("[data-value=timbertech-ashwood] .tag-q").click(); true'); await sleep(100);
    await b.ev('document.querySelector("[data-value=trex-transcend-spiced-rum] img").click(); true'); await sleep(150);
    ok(await b.ev(TIP) === null && await b.ev(pressed('decking', 'trex-transcend-spiced-rum')) === 'true', 'tap on the picture closes the bubble and picks the option as before');
    // the last tile on the page: the bubble must not go under the bottom bar
    await b.ev('(() => { const e = document.querySelector("#q-deckConfig [data-value=custom] .tag-q"); const bar = document.querySelector(".bar").getBoundingClientRect(); window.scrollBy(0, e.getBoundingClientRect().bottom - bar.top + 6); return true; })()'); await sleep(200);
    await b.ev('document.querySelector("#q-deckConfig [data-value=custom] .tag-q-mark").click(); true'); await sleep(150);
    tip = await b.ev(TIP);
    ok(tip && tip.bottom <= tip.barTop && tip.top >= 0, 'a tag right above the bottom bar: the bubble opens upward: ' + J(tip));
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(100);
    ok(await b.ev(TIP) === null, 'Escape closes the bubble');

    await b.ev('T.go("electrical")'); await sleep(300);
    tags = await b.ev(TAGS);
    ok(J(tags.map(t => t.q + '/' + t.v + ':' + t.tag)) === J(['connection/hardline:Custom quote']), 'Electrical: "?" by Custom quote on the hardline connection only');
    ok(/your manager will discuss with you whether it is possible and what it may cost/i.test(await b.ev('document.querySelector("#q-connection .hint").textContent')), 'Electrical: the hint says the manager will discuss the hardline connection');
    ok(await b.ev('document.getElementById("more-breaker").hidden'), 'breaker box: the "?" panel is closed at first');
    await b.ev('document.querySelector("#qh-breaker .more-btn").click(); true'); await sleep(100);
    ok(/closest to where the power will come from/.test(await b.ev('document.getElementById("more-breaker").hidden ? "" : document.getElementById("more-breaker").textContent')), 'breaker box: the "?" by the question opens the advice on choosing the spot');
    await b.ev('document.querySelector("#qh-breaker .more-btn").click(); true');
    await b.ev('document.querySelector("[data-value=hardline] .tag-q").click(); true'); await sleep(150);
    tip = await b.ev(TIP);
    ok(tip && tip.text === CUSTOMHELP && tip.right <= tip.vw - 12 && tip.left >= 12 && await b.ev(pressed('connection', 'hardline')) === 'false', 'hardline: the bubble has the Custom quote sentence and fits at the right edge, the option is not picked');
    await b.ev('T.go("permits")'); await sleep(300);
    ok(await b.ev('document.querySelectorAll("main .more-btn").length') === 0 && /You probably already know/.test(await b.ev('document.querySelector("main .lead").textContent')), 'Permits: no "?" (0.3.9), the text above the question stays');
    await b.ev('T.go("review")'); await sleep(300);
    ok(await b.ev(TIP) === null, 'leaving the step closes the bubble');

    // ---- a team link (notes=1) --------------------------------------------------------------------
    await b.nav('about:blank'); await b.nav(FORM + HASH.replace('0001', '0002') + '&notes=1'); await sleep(400); await b.ev(HELP);
    await b.ev('T.go("finishes")'); await sleep(300);
    const team = await b.ev('[...document.querySelectorAll(".team-btn")].map(e => ({ id: e.dataset.qid, label: e.getAttribute("aria-label"), mark: e.textContent, open: e.getAttribute("aria-expanded"), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) }))');
    ok(J(team.map(t => t.id)) === J(['team-decking-trex-transcend', 'team-decking-timbertech', 'team-deckConfig']) && team.every(t => t.mark === '!' && t.open === 'false' && t.w >= 44 && t.h >= 44 && /Wellmade team/.test(t.label)),
      'team link: a "!" (44 px tap area) by the two paid series and by Deck configuration: ' + J(team.map(t => t.id)));
    ok(await b.ev('[...document.querySelectorAll(".team-note")].every(p => p.hidden)'), 'team notes are closed until the "!" is tapped');
    await b.ev('T.scrollTo(".team-btn", 60)'); await sleep(200);
    await view(b, '390-team-mark-closed.png');
    await b.ev('document.querySelector(".team-btn").click(); true'); await sleep(150);
    const note = await b.ev('(() => { const p = document.getElementById("more-team-decking-trex-transcend"); return { hidden: p.hidden, title: p.querySelector(".team-title").textContent, sign: p.querySelector(".team-sign").textContent, ps: p.querySelectorAll("p").length, w: document.documentElement.scrollWidth, bg: getComputedStyle(p).backgroundColor }; })()');
    ok(!note.hidden && note.title === NOTE.title && note.sign === 'Ilya' && note.ps === NOTE.text.length + 2 && note.w === 390, 'tap on "!": the note opens with its title, text and signature, no sideways scroll');
    ok(note.bg !== 'rgb(255, 255, 255)', 'the team note is tinted, so it does not look like the client "?" panel: ' + note.bg);
    await view(b, '390-team-note-open.png');
    await b.ev('T.pick("stain", "midnight-black")'); await sleep(150);
    ok(await b.ev('!document.getElementById("more-team-decking-trex-transcend").hidden'), 'the open note stays open after an answer');
    await b.ev('document.querySelector(".team-btn").click(); true'); await sleep(100);
    ok(await b.ev('document.getElementById("more-team-decking-trex-transcend").hidden'), 'second tap closes the note');
    await b.ev('T.go("electrical")'); await sleep(300);
    ok(await b.ev('document.querySelectorAll(".team-btn").length') === 0, 'Electrical: no "!" (the note is about the deck price)');
    ok(b.exceptions().length === 0, 'no page errors ' + J(b.exceptions()));
  } catch (e) { console.log('FAIL exception ' + e.stack); fails++; }
  b.close();
  process.exit(fails ? 1 : 0);
})();
