// Prices of extras (spec.prices, option "price", rule "extraPrice"): the model, then the page at 390 px.
// node tests/prices.js "<Build - v3 folder>" "<scratch out folder>"
const { launch, fileUrl, sleep } = require('./cdp.js');
const path = require('path'), vm = require('vm'), fs = require('fs');
const PILOT = process.argv[2], OUT = process.argv[3];
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const J = JSON.stringify;

// ---- model ----------------------------------------------------------------------------------
const ctx = { console }; vm.createContext(ctx);
vm.runInContext('var window=globalThis;' + fs.readFileSync(path.join(PILOT, 'spec/presidio-xo.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(PILOT, 'engine/model.js'), 'utf8'), ctx);
const S = ctx.SPEC_DATA, M = ctx.SpecEngine.createModel(S);
const U = S.prices.unit, SYM = S.prices.symbol || '';
const money = n => SYM ? SYM + n.toLocaleString('en-US') : n + ' ' + U, tag = n => '+' + money(n);
const opt = (q, id) => S.steps.flatMap(s => s.items || []).find(i => i.id === q).options.find(o => o.id === id);
const rule = (type, q) => S.rules.find(r => r.type === type && r.question === q);
const DECK = opt('deckConfig', 'standard').price, MAN = opt('skylightType', 'manual').price, SOL = opt('skylightType', 'solar').price;
const EXT = rule('includedBy', 'exterior').extraPrice, INT = rule('baseIncluded', 'interior').extraPrice;
console.log('unit:', U, 'deck', DECK, 'manual', MAN, 'solar', SOL, 'exterior extra', EXT, 'interior extra', INT);
ok(typeof U === 'string' && U && [DECK, MAN, SOL, EXT, INT].every(n => typeof n === 'number'), 'spec carries the unit and all five prices');

let a = M.defaultAnswers(), p = M.pricing(a);
ok(p.enabled && p.unit === U && p.items.length === 0 && p.total === 0, 'new form: prices on, nothing priced, total 0');
ok(!!p.note, 'the note under the prices is set');
// 0.3.3: real list prices in dollars (Ian's example quote of 2026-11-19)
ok(SYM === '$' && tag(6900) === '+$6,900' && money(11650) === '$11,650', 'dollars with a thousands comma: ' + tag(6900) + ', ' + money(11650));
ok(J([DECK, MAN, SOL, EXT, INT]) === J([6900, 4200, 4750, 500, 400]), 'list prices: corner deck, manual and solar skylight, extra exterior and interior outlet');
ok(M.optionState('heatpump', 'heat-pump', a).tag === '+$5,600' && M.optionState('heatpump', 'no-heat-pump', a).tag === '', 'heat pump shows its price, NO heat pump has no tag');
ok(M.optionState('heater', 'heater', a).tag === '+$1,200' && M.optionState('heater', 'no-heater', a).tag === '', 'wall heater shows its price, NO heater has no tag');
ok(M.optionState('connection', 'plug-in', a).tag === 'Included' && M.optionState('connection', 'hardline', a).tag === 'Custom quote' && M.optionState('connection', 'ethernet', a).tag === '+$1,350' && M.optionState('connection', 'third-party', a).tag === '', 'connection tags: plug-in included, hardline custom quote, Ethernet priced');
{
  let x = M.toggle(M.toggle(M.toggle(a, 'heatpump', 'heat-pump'), 'heater', 'heater'), 'connection', 'hardline');
  ok(M.pricing(x).total === 5600 + 1200, 'heat pump + heater: 6,800; hardline (custom quote) is not in the total');
  x = M.toggle(x, 'connection', 'ethernet');
  ok(M.pricing(x).total === 5600 + 1200 + 1350 && M.pricing(x).totalText === '$8,150', 'Ethernet adds 1,350: ' + M.pricing(x).totalText);
  x = M.toggle(M.toggle(x, 'heatpump', 'no-heat-pump'), 'heater', 'no-heater');
  ok(M.pricing(x).total === 1350, 'NO heat pump and NO heater take their prices away');
}
ok(M.optionState('deckConfig', 'standard', a).tag === tag(DECK), 'standard deck shows its price as the tag: ' + M.optionState('deckConfig', 'standard', a).tag);
ok(M.optionState('deckConfig', 'custom', a).tag === 'Priced by size' && M.optionState('deckConfig', 'step', a).tag === '', 'custom deck: "Priced by size"; step deck: no tag');
ok(M.optionState('skylightType', 'manual', a).tag === tag(MAN) && M.optionState('skylightType', 'solar', a).tag === tag(SOL) && M.optionState('skylightType', 'none', a).tag === '', 'skylight tags: manual and solar priced, NO skylight without a tag');
ok(M.tagLegend('exterior').find(x => x.kind === 'extra').text === tag(EXT) + ' each' && M.tagLegend('interior').find(x => x.kind === 'extra').text === tag(INT) + ' each', 'plan legend says the price of each extra outlet');

a = M.toggle(a, 'deckConfig', 'step'); ok(M.pricing(a).items.length === 0, 'step deck: not priced');
a = M.toggle(a, 'deckConfig', 'custom'); ok(M.pricing(a).items.length === 0, 'custom deck: not in the total (priced by size)');
a = M.toggle(a, 'deckConfig', 'standard'); p = M.pricing(a);
ok(p.items.length === 1 && p.items[0].question === 'deckConfig' && p.items[0].price === DECK && p.total === DECK, 'standard deck: one item, total = its price');
a = M.toggle(a, 'skylightType', 'manual'); ok(M.pricing(a).total === DECK + MAN, 'manual skylight adds its price');
a = M.toggle(a, 'skylightType', 'solar'); ok(M.pricing(a).total === DECK + SOL, 'solar replaces manual in the total');
a = M.toggle(a, 'skylightType', 'none'); ok(M.pricing(a).total === DECK, 'NO skylight: nothing added');
a = M.toggle(a, 'skylightType', 'solar');

// exterior outlets: nothing is priced until the breaker box says which one is included
a = M.toggle(a, 'exterior', 'back-left');
ok(M.pricing(a).total === DECK + SOL && M.dynamicTags(M.question('exterior'), a)['back-left'] === 'Depends on breaker box', 'exterior outlet before the breaker box: pending, not priced');
a = M.toggle(a, 'breaker', 'right-lower'); p = M.pricing(a);
let t = M.dynamicTags(M.question('exterior'), a);
ok(t['right-lower'] === 'Included' && t['back-left'] === tag(EXT), 'exterior tags: included one free, the other shows its price: ' + J(t));
ok(p.items.filter(x => x.question === 'exterior').length === 1 && p.items.find(x => x.question === 'exterior').option === 'back-left' && p.total === DECK + SOL + EXT, 'exterior: only the extra outlet is priced');
a = M.toggle(a, 'exterior', 'back-right');
ok(M.pricing(a).total === DECK + SOL + 2 * EXT, 'two extra exterior outlets: twice the price');
a = M.toggle(a, 'exterior', 'back-right');

// interior outlets: three are included; a fourth is priced; a moved one is not
ok(!M.pricing(a).items.some(x => x.question === 'interior'), 'three base interior outlets: not priced');
a = M.toggle(a, 'interior', 'left-upper'); p = M.pricing(a);
ok(M.dynamicTags(M.question('interior'), a)['left-upper'] === tag(INT) && p.items.filter(x => x.question === 'interior').length === 1, 'fourth interior outlet shows its price and is the only priced one');
ok(p.total === DECK + SOL + EXT + INT && p.totalText === money(DECK + SOL + EXT + INT),'total: deck + solar + one exterior + one interior = ' + p.totalText);
let sw = M.toggle(a, 'interior', 'back-left');
ok(M.dynamicTags(M.question('interior'), sw)['left-upper'] === 'Confirm in Comments' && !M.pricing(sw).items.some(x => x.question === 'interior'), 'moved interior outlet (still three): "Confirm in Comments", not priced');
const TOTAL = DECK + SOL + EXT + INT;

// ---- page -----------------------------------------------------------------------------------
(async () => {
  const b = await launch(path.join(OUT, 'profile-prices'), 9340);
  try {
    await b.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.join(OUT, 'dl-prices') });
    await b.nav(fileUrl(path.join(PILOT, 'index.html')));
    await b.ev(fs.readFileSync(path.join(__dirname, 'helpers.js'), 'utf8'));
    await b.ev('T.type("client","Price Test")');
    await b.ev('T.go("review")'); await sleep(300);
    const empty = await b.ev('({title: (document.querySelector(".price-title")||{}).textContent, rows: document.querySelectorAll("main .price-row").length, note: (document.querySelector("main .price-note")||{}).textContent, hint: [...document.querySelectorAll("main .hint")].some(e=>/Nothing with an extra price/.test(e.textContent))})');
    ok(empty.title === 'Price of your extras' && empty.rows === 0 && empty.hint && !!empty.note, 'Review with nothing priced: title, "nothing picked" line, placeholder note: ' + J(empty));

    await b.ev('T.go("finishes")'); await sleep(300);
    await b.ev('T.pick("deckConfig","standard")'); await sleep(150);
    const deckTags = await b.ev('T.st("deckConfig").map(x=>x.v+":"+x.tag)');
    ok(deckTags.some(x => x.toLowerCase() === ('standard:' + tag(DECK)).toLowerCase()) && deckTags.some(x => /^custom:Priced by size$/i.test(x)), 'deck buttons show the tags: ' + J(deckTags));
    await b.ev('T.go("addons")'); await sleep(300);
    await b.ev('T.pick("skylightType","solar")'); await sleep(150);
    const skyTags = await b.ev('T.st("skylightType").map(x=>x.v+":"+x.tag)');
    ok(skyTags.some(x => x.toLowerCase() === ('solar:' + tag(SOL)).toLowerCase()) && skyTags.some(x => x.toLowerCase() === ('manual:' + tag(MAN)).toLowerCase()), 'skylight buttons show the prices: ' + J(skyTags));
    await b.ev('T.go("electrical")'); await sleep(300);
    await b.ev('T.pick("breaker","right-lower")'); await sleep(150);
    await b.ev('T.pick("exterior","back-left")'); await sleep(150);
    await b.ev('T.pick("interior","left-upper")'); await sleep(150);
    await b.ev('T.layer("exterior")'); await sleep(200);   // the legend explains the marks of the layer that is open
    const legend = await b.ev('[...document.querySelectorAll(".legend")].map(e=>e.hidden?"":e.textContent).join(" | ")');
    ok(legend.toLowerCase().includes((tag(EXT) + ' each').toLowerCase()), 'plan legend on the page names the price of an extra outlet: ' + legend.slice(0, 160));
    ok(await b.ev('T.overflow()') === 390, 'Electrical: no horizontal scroll at 390 px');

    await b.ev('T.go("review")'); await sleep(300);
    const rev = await b.ev('({rows: [...document.querySelectorAll("main .price-row:not(.price-total)")].map(r=>r.querySelector(".k").textContent+" / "+r.querySelector(".v").textContent), sum: (document.querySelector("main .price-sum")||{}).textContent, w: T.overflow()})');
    console.log('review prices:', J(rev));
    ok(rev.rows.length === 4 && rev.sum === money(TOTAL), 'Review: four priced rows and the total ' + money(TOTAL));
    ok(rev.w === 390, 'Review: no horizontal scroll at 390 px');

    await b.ev('window.dispatchEvent(new Event("beforeprint"));true');
    const pr = await b.ev('({rows: document.querySelectorAll("#print-sheet .price-row:not(.price-total)").length, sum: (document.querySelector("#print-sheet .price-sum")||{}).textContent, note: !!document.querySelector("#print-sheet .price-note")})');
    ok(pr.rows === 4 && pr.sum === money(TOTAL) && pr.note, 'print sheet: the same four rows, total and note: ' + J(pr));

    await b.ev('document.querySelector("[data-action=download]").click();true'); await sleep(1500);
    const dir = path.join(OUT, 'dl-prices'), dl = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    ok(dl.length === 1, 'one downloaded file: ' + J(dl));
    if (dl[0]) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, dl[0]), 'utf8'));
      console.log('export pricing:', J(j.pricing));
      ok(j.pricing && j.pricing.unit === U && j.pricing.total === TOTAL && j.pricing.items.length === 4, 'export carries pricing: unit, total, four items');
      ok(J(j.pricing.items.map(x => x.question + '/' + x.option).sort()) === J(['deckConfig/standard', 'exterior/back-left', 'interior/left-upper', 'skylightType/solar']), 'export items are the four priced picks');
      ok(j.tags && j.tags.exterior && j.tags.exterior['back-left'] === tag(EXT), 'export tags: the extra exterior outlet carries its price (this is what the manager email prints)');
    }
    console.log('exceptions:', J(b.exceptions()));
    ok(b.exceptions().length === 0, 'no page exceptions');
  } catch (e) { console.log('FAIL exception ' + e.stack); fails++; }
  finally { b.close(); }
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
