// The estimate (spec.prices.estimate + "price" in the client link): the studio price of the quote plus the
// list prices of the picked options, in the bottom bar, on Review and on the manager page. Phone, 390 px.
// node tests/estimate.js "<Build - v3 folder>" "<scratch out folder>"
const { launch, fileUrl, sleep } = require('./cdp.js');
const path = require('path'), fs = require('fs'), vm = require('vm');
const PILOT = process.argv[2], OUT = process.argv[3];
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const J = JSON.stringify;
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

// ---- model ------------------------------------------------------------------------------------
const ctx = { console, URL }; vm.createContext(ctx);
vm.runInContext('var window=globalThis;' + fs.readFileSync(path.join(PILOT, 'spec/presidio-xo.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(PILOT, 'engine/model.js'), 'utf8'), ctx);
const S = ctx.SPEC_DATA, E = ctx.SpecEngine, M = E.createModel(S);
const EST = S.prices.estimate;
ok(EST && EST.label && EST.note && Array.isArray(S.prices.quoteTags) && S.prices.quoteTags.length > 0 && !!S.cover.priceText, 'spec: estimate texts, quoteTags and the cover sentence are set');
ok(/not a final price/i.test(EST.note) && /manager/i.test(EST.note) && EST.note.split(/\s+/).length <= 45, 'the note says it is not a final price and that the manager sends it, in 45 words at most (' + EST.note.split(/\s+/).length + ')');
ok(J(['47900', '$47,900', '47,900.00', ' 47 900 ', '0', '', 'abc', '-5', '47900abc', '1e5', '999999999'].map(E.cleanPrice)) === J([47900, 47900, 47900, 47900, 0, 0, 0, 0, 0, 0, 0]), 'cleanPrice: digits, "$", commas and cents are read; anything else is no price');
{
  const hash = E.linkHash(S, 'EstimateTest0001', { name: 'Ann Lee', address: '1 Test St' }, ['a@wllmd.com'], {}, '$47,900');
  ok(/&price=47900&to=/.test(hash), 'the link carries the price as digits: ' + hash);
  ok(E.readLink(S, hash).price === 47900 && E.readLink(S, hash.replace('price=47900', 'price=<b>')).price === 0 && E.readLink(S, hash.replace('&price=47900', '')).price === 0, 'readLink: price read back; a broken or missing price is 0');
  ok(!/price=/.test(E.linkHash(S, 'EstimateTest0001', { name: 'Ann Lee', address: '1 Test St' }, [], {}, '')), 'no price typed: the link has no "price"');
}
{
  let a = M.defaultAnswers(), p = M.pricing(a, 47900);
  ok(p.base === 47900 && p.baseText === '$47,900' && p.estimate === 47900 && p.estimateText === '$47,900' && p.unpriced.length === 0, 'new form with a base: the estimate is the quote price');
  a = M.toggle(M.toggle(a, 'heater', 'heater'), 'skylightType', 'manual'); p = M.pricing(a, 47900);
  ok(p.total === 5400 && p.estimate === 53300 && p.estimateText === '$53,300', 'heater + manual skylight: 47,900 + 5,400 = ' + p.estimateText);
  a = M.toggle(a, 'connection', 'hardline'); p = M.pricing(a, 47900);
  ok(p.estimate === 53300 && J(p.unpriced.map(u => u.option)) === J(['hardline']) && p.unpriced[0].tag === 'Custom quote', 'hardline (custom quote) does not change the number and is listed as not priced');
  a = M.toggle(a, 'deckConfig', 'custom'); p = M.pricing(a, 47900);
  ok(p.unpriced.some(u => u.option === 'custom'), 'custom deck (priced by size) is listed as not priced');
  const q = M.pricing(a);
  ok(q.base === 0 && q.estimate === 0 && q.estimateText === '' && q.total === p.total, 'without a base: no estimate, the extras total is the same');
  ok(M.pricing(M.toggle(M.defaultAnswers(), 'connection', 'plug-in'), 47900).unpriced.length === 0, 'an included option is not "not priced"');
}

// ---- page ---------------------------------------------------------------------------------------
const HELP = fs.readFileSync(path.join(PILOT, 'tests', 'helpers.js'), 'utf8');
const FORM = fileUrl(path.join(PILOT, 'index.html')), MANAGER = fileUrl(path.join(PILOT, 'manager.html'));
const LINK = '#id=EstimateTest0001&name=Ann%20Lee&address=1%20Test%20St';
const BAR = `(() => { const e = document.getElementById('bar-est'); if (!e) return null; const m = document.getElementById('est-more'), r = e.getBoundingClientRect(), bar = document.querySelector('.bar').getBoundingClientRect();
  const last = [...document.querySelectorAll('main > *')].filter(x => x.getClientRects().length).pop();
  return { k: e.querySelector('.est-k').textContent, v: document.getElementById('est-v').textContent, more: m.hidden ? '' : m.textContent, inBar: r.top >= bar.top && r.bottom <= bar.bottom,
    barTop: Math.round(bar.top), barH: Math.round(bar.height), w: document.documentElement.scrollWidth, live: e.getAttribute('aria-live'),
    fine: (document.querySelector('.fine-print') || {}).textContent || null, fineSize: document.querySelector('.fine-print') ? getComputedStyle(document.querySelector('.fine-print')).fontSize : null,
    clear: last ? Math.round(last.getBoundingClientRect().bottom + scrollY) <= Math.round(document.documentElement.scrollHeight - bar.height) : null }; })()`;
const view = async (b, file) => { const r = await b.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, 'shots', file), Buffer.from(r.result.data, 'base64')); };
const full = async (b, file, sel) => {
  const box = await b.ev(`(() => { const e = document.querySelector(${J(sel)}); const r = e.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY - 8), width: 390, height: Math.min(r.height + 16, 2400) }; })()`);
  const r = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: Object.assign({ scale: 1 }, box) });
  fs.writeFileSync(path.join(OUT, 'shots', file), Buffer.from(r.result.data, 'base64'));
};

(async () => {
  const b = await launch(path.join(OUT, 'profile-estimate'), 9351);
  try {
    // ---- a link with the price ------------------------------------------------------------------
    await b.nav('about:blank'); await b.nav(FORM + LINK + '&price=47900'); await sleep(400); await b.ev(HELP);
    const cover = await b.ev('({price:(document.querySelector(".cover-price")||{}).textContent||null, texts:[...document.querySelectorAll(".cover-text")].map(p=>p.textContent), bar:!!document.getElementById("bar-est"), w:document.documentElement.scrollWidth})');
    ok(cover.price === S.cover.priceText && cover.texts[cover.texts.length - 1] === S.cover.priceText && !cover.bar && cover.w === 390, 'cover with a price: the sentence about the estimate comes after the two paragraphs; no bar on the cover');
    await view(b, '390-cover-with-price.png');
    await b.ev('T.go("finishes")'); await sleep(300);
    let s = await b.ev(BAR);
    ok(s && s.k === EST.label && s.v === '$47,900' && s.more === '' && s.inBar && s.live === 'polite', 'Finishes: the bar shows "Estimate $47,900" above the buttons: ' + J(s));
    ok(s.w === 390 && s.clear, 'the estimate line adds no horizontal scroll and the bar does not cover the end of the page (bar ' + s.barH + ' pt)');
    ok(s.fine === null, 'no small print about the estimate under a step (0.3.9: the note is on Review only)');
    await view(b, '390-finishes-estimate.png');
    await b.ev('T.go("addons")'); await sleep(300);
    await b.ev('T.click("heater","heater")'); await sleep(100);
    s = await b.ev(BAR);
    ok(s.v === '$49,100', 'wall heater picked: the estimate changes at once to ' + s.v);
    await b.ev('T.click("skylightType","solar")'); await sleep(100);
    s = await b.ev(BAR);
    ok(s.v === '$53,850', 'solar skylight picked: ' + s.v);
    await b.ev('T.click("heater","no-heater")'); await sleep(100);
    s = await b.ev(BAR);
    ok(s.v === '$52,650', 'NO heater: its price is taken away: ' + s.v);
    await view(b, '390-addons-estimate.png');
    await b.ev('T.go("electrical")'); await sleep(300);
    await b.ev('T.click("connection","hardline")'); await sleep(100);
    s = await b.ev(BAR);
    ok(s.v === '$52,650' && s.more === EST.unpricedShort && s.w === 390, 'hardline (custom quote): the number stays and the bar adds "' + s.more + '"');
    await view(b, '390-electrical-estimate-unpriced.png');
    await b.ev('T.go("review")'); await sleep(300);
    const rv = await b.ev(`(() => { const rows = [...document.querySelectorAll('main .price-row')].map(r => [r.querySelector('.k').textContent, [...r.querySelectorAll('.v > *')].map(x => x.textContent).join(' | ')]);
      return { title: (document.querySelector('main .price-title') || {}).textContent, rows, note: (document.querySelector('main .est-note') || {}).textContent, fine: !!document.querySelector('main .fine-print'), bar: (document.getElementById('est-v') || {}).textContent, w: document.documentElement.scrollWidth }; })()`);
    ok(rv.title === EST.title && J(rv.rows[0]) === J([EST.baseLabel, '$47,900']), 'Review: "' + rv.title + '" starts with the quote price: ' + J(rv.rows[0]));
    ok(rv.rows.some(r => r[0] === 'Skylight' && /\+\$4,750/.test(r[1])) && rv.rows.some(r => r[0] === 'Connection' && r[1].indexOf(EST.unpricedLabel) >= 0), 'Review lists the priced option and the one the manager will price: ' + J(rv.rows));
    ok(J(rv.rows[rv.rows.length - 1]) === J([EST.label, '$52,650']) && rv.bar === '$52,650', 'Review ends with the estimate, the same number as in the bar');
    ok(rv.note === EST.note && !rv.fine && rv.w === 390, 'Review: the note sits in the price block (once), no horizontal scroll');
    await full(b, '390-review-estimate.png', 'main');
    await b.reload(); await sleep(400); await b.ev(HELP);
    ok((await b.ev('(document.getElementById("est-v")||{}).textContent')) === '$52,650', 'after a reload the estimate is the same (answers saved, price from the link)');

    // ---- the same link without a price: as before ---------------------------------------------------
    await b.nav('about:blank'); await b.nav(FORM + LINK.replace('0001', '0002')); await sleep(400); await b.ev(HELP);
    ok(await b.ev('!document.querySelector(".cover-price")'), 'no price in the link: the cover has no sentence about the estimate');
    await b.ev('T.go("addons")'); await sleep(300);
    await b.ev('T.click("heater","heater")'); await sleep(100);
    ok(await b.ev('!document.getElementById("bar-est") && !document.querySelector(".fine-print") && !document.getElementById("app").classList.contains("has-est")'), 'no price in the link: no estimate in the bar and no small print');
    await b.ev('T.go("review")'); await sleep(300);
    ok(await b.ev('document.querySelector("main .price-title").textContent === "Price of your extras" && document.querySelector("main .price-sum").textContent === "$1,200"'), 'no price in the link: Review shows "Price of your extras" with their total, as before');
    await b.nav('about:blank'); await b.nav(FORM + LINK.replace('0001', '0003') + '&price=%3Cscript%3E'); await sleep(400); await b.ev(HELP);
    await b.ev('T.go("addons")'); await sleep(300);
    ok(await b.ev('!document.getElementById("bar-est")'), 'a broken price in the link is ignored: the form opens without the estimate');

    // ---- manager page ----------------------------------------------------------------------------------
    await b.nav(MANAGER); await sleep(400);
    const fill = (id, v) => b.ev(`(() => { const i = document.getElementById(${J(id)}); i.value = ${J(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await fill('m-name', 'Ann Lee'); await fill('m-address', '1 Test St'); await fill('m-to', 'ilya@wllmd.com');
    ok(await b.ev('!!document.getElementById("m-price") && /optional/.test(document.querySelector("label[for=m-price]").textContent) && document.documentElement.scrollWidth === 390'), 'manager page: an optional field for the studio price, no horizontal scroll');
    await fill('m-price', 'about 47k');
    await b.ev('document.querySelector(".mgr-create").click(); true'); await sleep(200);
    ok(await b.ev('!document.getElementById("err-price").hidden && document.getElementById("link-result").hidden'), 'a price that is not a number: an error under the field and no link');
    await fill('m-price', '$47,900');
    await b.ev('document.querySelector(".mgr-create").click(); true'); await sleep(200);
    const made = await b.ev('document.getElementById("link-out").value');
    ok(/[#&]price=47900(&|$)/.test(made) && E.readLink(S, made.slice(made.indexOf('#'))).price === 47900, 'typed "$47,900": the link carries price=47900');
    await full(b, '390-manager-price.png', 'main');
    await fill('m-price', '');
    await b.ev('document.querySelector(".mgr-create").click(); true'); await sleep(200);
    ok(!/price=/.test(await b.ev('document.getElementById("link-out").value')), 'the price left empty: a link without "price", as before');
    ok(b.exceptions().length === 0, 'no page errors ' + J(b.exceptions()));
  } catch (e) { console.log('FAIL exception ' + e.stack); fails++; }
  b.close();
  process.exit(fails ? 1 : 0);
})();
