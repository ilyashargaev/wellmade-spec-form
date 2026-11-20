// End-to-end checks in headless Chrome from file:// (node tests/e2e.js "<Shed spec form folder>" "<scratch out folder>").
// Viewport is set over CDP (390x844 mobile, then 1280x900); window.innerWidth is asserted.
// Deliverable screenshots go to Build - Pilot/screenshots/, the rest to the out folder.
const { launch, fileUrl, sleep } = require('./cdp.js');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = process.argv[2]; const OUT = process.argv[3];
const PILOT = path.join(ROOT, 'Build - v3');
const SHOTS = path.join(PILOT, 'screenshots');
const STEPS = ['finishes', 'addons', 'electrical', 'permits', 'review']; // spec 2.5.0 order: no Project step, client details on Review
const HELP = fs.readFileSync(path.join(__dirname, 'helpers.js'), 'utf8');
const SPEC = JSON.parse(fs.readFileSync(path.join(PILOT, 'spec', 'presidio-xo.json'), 'utf8'));
const log = []; let fails = 0;
function ok(c, m) { log.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
const J = JSON.stringify;
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
fs.mkdirSync(SHOTS, { recursive: true });

async function run390() {
  const b = await launch(path.join(OUT, 'profile'), 9333);
  try {
    const url = fileUrl(path.join(PILOT, 'index.html'));
    // ---- cover (2.5.0) ----------------------------------------------------------
    const COVER = `(()=>{const m=document.querySelector("main"); return {cover:document.getElementById("app").classList.contains("on-cover"),
      starts:document.querySelectorAll("[data-action=start]").length, startCls:(document.querySelector("[data-action=start]")||{}).className||"",
      startText:(document.querySelector("[data-action=start]")||{}).textContent, jumps:document.querySelectorAll(".step-jump").length, bar:document.querySelectorAll(".bar").length,
      hello:(document.querySelector(".cover-hello")||{textContent:null}).textContent,
      helloAfterTitle:(()=>{const e=document.querySelector(".cover-hello"), t=document.getElementById("step-title"); return !!(e&&t&&t.nextElementSibling===e);})(),
      helloStyle:(()=>{const e=document.querySelector(".cover-hello"); if(!e) return null; const s=getComputedStyle(e), p=getComputedStyle(document.querySelector(".cover-text")); return s.textTransform==="none"&&s.color===p.color&&s.fontSize===p.fontSize;})(),
      title:(document.getElementById("step-title")||{}).textContent,
      texts:[...document.querySelectorAll(".cover-text")].map(p=>p.textContent), logo:!!document.querySelector(".top .brand img"),
      photo:(document.querySelector(".cover-photo img")||{}).getAttribute?document.querySelector(".cover-photo img").getAttribute("src"):null,
      buttons:m?m.querySelectorAll("button").length:0, w:document.documentElement.scrollWidth};})()`;
    // with a link name: "Hello <name>," as the first line of the text, right under the title
    await b.nav(url + '#id=E2eCoverTest0001&name=Ann%20Lee&address=1%20Test%20St'); await b.ev('localStorage.clear();true'); await b.reload(); await b.ev(HELP);
    let cv = await b.ev(COVER);
    ok(cv.cover && cv.hello === 'Hello Ann Lee,', 'cover from a link greets the client: ' + cv.hello);
    ok(cv.helloAfterTitle && cv.helloStyle === true, 'the greeting is plain text right under the title, same look as the paragraphs (not a label in capitals)');
    ok(b.exceptions().length === 0, 'cover from a link: no page errors ' + J(b.exceptions()));
    // the plain form, fresh: cover without a greeting
    await b.nav(url); await b.ev('localStorage.clear();true'); await b.reload(); await b.ev(HELP);
    ok(await b.ev('innerWidth') === 390, 'viewport is 390 px wide');
    cv = await b.ev(COVER);
    ok(cv.cover && cv.starts === 1 && /cover-start/.test(cv.startCls) && cv.startText === SPEC.cover.button && cv.buttons === 1, 'fresh form opens on the cover with ONE button (' + cv.startText + '): ' + J(cv));
    ok(cv.jumps === 0 && cv.bar === 0, 'cover: no step buttons, no bottom bar');
    ok(cv.hello === null, 'cover without a client name: no "Hello," line');
    ok(cv.title === SPEC.cover.title && J(cv.texts) === J(SPEC.cover.text) && cv.logo && cv.photo === SPEC.cover.image, 'cover: logo, photo, title and the two paragraphs from spec.cover');
    ok(cv.w <= 390, 'cover: no horizontal scroll at 390 (scrollWidth ' + cv.w + ')');
    await b.shot(path.join(OUT, '390-cover.png'));
    await b.ev('document.querySelector("[data-action=start]").click();true'); await sleep(300); await b.ev(HELP);
    const st0 = await b.ev('({t:document.getElementById("step-title").textContent, cover:document.getElementById("app").classList.contains("on-cover"), jumps:document.querySelectorAll(".step-jump").length, bar:!!document.querySelector(".bar"), eyebrow:document.querySelector(".eyebrow").textContent, saved:JSON.parse(localStorage.getItem("spec-form-v2:presidio-xo")).started})');
    ok(st0.t === 'Finishes' && !st0.cover && st0.jumps === 5 && st0.bar && st0.eyebrow === 'Step 1 of 5', 'Start goes to Finishes, step 1 of 5, 5 step buttons and the bar: ' + J(st0));
    ok(st0.saved === true, 'Start is saved on the device (started: true)');
    await b.reload(); await b.ev(HELP);
    ok(!(await b.ev('T.onCover()')) && await b.ev('document.getElementById("step-title").textContent') === 'Finishes', 'reload after Start: cover skipped, back on Finishes');
    for (const s of STEPS) {
      await b.ev('T.go("' + s + '")'); await sleep(300); await b.ev(HELP);
      const n = (await b.ev('T.structure()')).length;
      const w = await b.ev('T.overflow()');
      const eb = await b.ev('document.querySelector(".eyebrow").textContent');
      ok(w <= 390 && eb === 'Step ' + (STEPS.indexOf(s) + 1) + ' of 5', s + ' renders, ' + eb + ', scrollWidth=' + w + ', question blocks=' + n);
      await b.shot(path.join(OUT, 'pilot-' + s + '.png'));
    }
    ok(await b.ev('document.title') === 'Presidio spec sheet · Wellmade', 'title from spec');
    ok(!(await b.ev('[...document.querySelectorAll("*")].some(e=>getComputedStyle(e).touchAction==="none")')), 'no element blocks touch scrolling (touch-action:none)');

    // focus on step change: heading focused, no heavy box for a tap
    await b.ev('T.go("permits")'); await sleep(200); await b.ev(HELP);
    const f = await b.ev('(()=>{const a=document.activeElement; return {id:a.id, vis:a.matches(":focus-visible"), outline:getComputedStyle(a).outlineStyle};})()');
    ok(f.id === 'step-title' && !f.vis && f.outline === 'none', 'step heading focused after a tap, no focus box: ' + J(f));
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
    const fk = await b.ev('(()=>{const t=document.getElementById("step-title"); t.blur(); t.focus(); return {vis:t.matches(":focus-visible"), outline:getComputedStyle(t).outlineStyle};})()');
    ok(fk.outline === 'none', 'heading never shows a focus ring, even after a key press (Chrome showed one after every reload; changed 2026-11-17): ' + J(fk));

    await b.ev('T.click("permits","building");T.click("permits","electrical")');
    ok(J(await b.ev('T.on("permits")')) === '["building","electrical"]', 'Building + Electrical together');
    await b.ev('T.click("permits","none")');
    ok(J(await b.ev('T.on("permits")')) === '["none"]', 'NO permit clears Building/Electrical');
    await b.ev('T.click("permits","building")');
    ok(J(await b.ev('T.on("permits")')) === '["building"]', 'Building clears NO permit');

    // ---- electrical plan -----------------------------------------------------
    await b.ev('T.go("electrical")'); await sleep(300); await b.ev(HELP);
    await b.ev('T.click("connection","plug-in");T.click("connection","ethernet");T.click("connection","hardline")');
    let v = await b.ev('T.on("connection")');
    ok(J(v) === '["hardline:Custom quote","ethernet:+$1,350"]', 'plug-in/hardline exclusive, Ethernet kept; both show their tags: ' + J(v));
    const chips = await b.ev('[...document.querySelectorAll(".layer-chip")].map(c=>c.children[0].className+":"+c.children[0].textContent+" "+c.children[1].textContent+"|"+c.getAttribute("aria-pressed"))');
    ok(J(chips) === J(['num:1 Breaker box|true', 'num:2 Exterior outlets|false', 'num:3 Interior outlets|false']), 'one chip per plan question, numbered 1-3, first active: ' + J(chips));
    const geo = await b.ev('(()=>{const img=document.querySelector("#plan-electrical .plan-inner img").getBoundingClientRect(); const act=[...document.querySelectorAll("#plan-electrical .hot:not(.passive)")].map(e=>e.getBoundingClientRect()); let min=1e9; for(let i=0;i<act.length;i++)for(let j=i+1;j<act.length;j++){const a=act[i],c=act[j];min=Math.min(min,Math.hypot(a.x-c.x,a.y-c.y));} return {imgW:Math.round(img.width), imgL:Math.round(img.left), imgR:Math.round(img.right), n:act.length, minW:Math.min(...act.map(r=>r.width)), minH:Math.min(...act.map(r=>r.height)), minGap:Math.round(min)};})()');
    ok(geo.imgL >= 0 && geo.imgR <= 390 && geo.imgW >= 300, 'whole plan fits the screen width: ' + J(geo));
    ok(geo.n === 4 && geo.minW >= 44 && geo.minH >= 44 && geo.minGap >= 44, 'breaker layer: 4 tap targets >= 44 px, no overlap');
    let hb = await b.ev('T.hots("breaker")');
    ok(hb.every(x => !x.passive && !x.dis) && hb.map(x => x.marker).join() === '1,2,3,4', 'breaker hotspots active with markers 1..4: ' + hb.map(x => x.marker).join(','));
    ok(J(await b.ev('T.st("breaker").map(x=>x.v)')) === J(['back-left', 'back-right', 'right-upper', 'right-lower']) &&
      J(await b.ev('T.btns("breaker").map(e=>e.textContent)')) === J(['1 — Back-left, outside', '2 — Back-right, outside', '3 — Right side, upper, outside', '4 — Right side, lower, outside']), 'breaker list labels 1..4');
    ok((await b.ev('T.hots("exterior").map(x=>x.v)')).length === 4 && J(await b.ev('[...document.querySelectorAll("#plan-electrical .hot[data-qid=exterior] .dot")].map(d=>d.textContent)')) === '["1","2","3","4"]', 'exterior outlets are 1..4');
    let he = await b.ev('T.hots("exterior").concat(T.hots("interior"))');
    ok(he.every(x => x.passive && x.dis && !x.marker), 'other layers passive, disabled, no numbers on the plan');
    // 2.5.0: markers of the non-active layers are not drawn at all (were small dots of their picks); the picks are kept.
    ok(await b.ev('[...document.querySelectorAll("#plan-electrical .hot.passive")].every(e=>getComputedStyle(e).display==="none")'), 'other layers: markers not drawn (display none)');
    ok(J(await b.ev('T.marks("interior")')) === '["back-left:included","back-right:included","right-lower:included"]', 'other layer keeps its picks (3 base interior outlets marked on)');
    ok(await b.ev('document.getElementById("legend-electrical").hidden'), 'legend hidden on the breaker layer (no tag kinds there)');
    await b.ev('T.scrollTo("#plan-electrical")'); await sleep(200);
    await b.shot(path.join(SHOTS, '390-electrical-1-breaker.png'));

    await b.ev('T.layer("exterior")'); await sleep(150);
    ok(await b.ev('!document.getElementById("q-exterior").classList.contains("layer-off") && document.getElementById("q-breaker").classList.contains("layer-off")'), 'chip switches the question block under the plan');
    const LEG = '(()=>{const l=document.getElementById("legend-electrical"); return {hidden:l.hidden, items:[...l.children].map(e=>e.textContent)};})()';
    ok((await b.ev(LEG)).hidden, 'exterior layer, nothing picked: legend hidden');
    await b.ev('T.click("exterior","back-left",true)');
    ok(J(await b.ev('T.on("exterior")')) === '["back-left:Depends on breaker box"]', 'exterior picked on the plan before a breaker: Depends on breaker box');
    ok(J(await b.ev('T.marks("exterior")')) === '["back-left:pending"]', 'plan mark: pending');
    ok(J(await b.ev(LEG)) === J({ hidden: false, items: ['Depends on breaker box'] }), 'legend: only the pending kind is on the plan');
    await b.ev('T.layer("breaker")'); await b.ev('T.click("breaker","right-lower",true)');
    ok(J(await b.ev('T.on("breaker")')) === '["right-lower"]', 'breaker set from the plan hotspot');
    await b.ev('T.layer("exterior")');
    v = await b.ev('T.on("exterior")');
    ok(J(v) === '["back-left:+$500","right-lower:Included"]', 'included exterior outlet follows the breaker: ' + J(v));
    ok(J(await b.ev('T.marks("exterior")')) === '["back-left:extra","right-lower:included"]', 'plan marks: included + extra');
    ok(J(await b.ev(LEG)) === J({ hidden: false, items: ['Included', '+$500 each'] }), 'legend: Included + the price of an extra outlet, nothing else');
    await b.ev('T.click("exterior","right-lower",true)');
    ok(J(await b.ev('T.on("exterior")')) === '["back-left:+$500","right-lower:Included"]', 'included outlet cannot be removed (plan tap)');
    ok(await b.ev('document.querySelector(".layer-chip[data-qid=exterior] .count").textContent') === '2', 'chip count still kept up to date (2 exterior outlets)');
    ok(await b.ev('getComputedStyle(document.querySelector(".layer-chip[data-qid=exterior] .count")).display') === 'none', 'chip count badge hidden by CSS (2.5.0)');
    await b.ev('T.scrollTo("#plan-electrical")'); await sleep(200);
    await b.shot(path.join(SHOTS, '390-electrical-2-exterior.png'));
    await b.ev('T.layer("breaker")'); await b.ev('T.click("breaker","back-left")');
    ok(J(await b.ev('T.on("breaker")')) === '["back-left"]', 'exactly one breaker (second replaces first)');
    v = await b.ev('T.on("exterior")');
    ok(J(v) === '["back-left:Included"]', 'breaker pick moves the included exterior outlet: ' + J(v));

    const gaps = {};
    for (const q of ['breaker', 'exterior', 'interior']) {
      await b.ev('T.layer("' + q + '")');
      gaps[q] = await b.ev('(()=>{const r=[...document.querySelectorAll("#plan-electrical .hot:not(.passive)")].map(e=>e.getBoundingClientRect()); let m=1e9; for(let i=0;i<r.length;i++)for(let j=i+1;j<r.length;j++)m=Math.min(m,Math.hypot(r[i].x-r[j].x,r[i].y-r[j].y)); return Math.round(m);})()');
    }
    ok(Object.values(gaps).every(g => g >= 34), 'tap targets per layer: nearest centers ' + J(gaps) + ' px apart (round 44 px areas; visible 30 px marks never overlap)');
    await b.ev('T.layer("interior")'); await sleep(150);
    v = await b.ev('T.on("interior")');
    ok(J(v) === '["back-left:Included","back-right:Included","right-lower:Included"]', 'interior base outlets pre-selected and tagged: ' + J(v));
    ok(J(await b.ev('T.marks("interior")')) === '["back-left:included","back-right:included","right-lower:included"]', 'plan marks: 3 included');
    await b.ev('T.click("interior","left-upper",true)');
    ok((await b.ev('T.on("interior")')).includes('left-upper:+$400') && (await b.ev('T.marks("interior")')).includes('left-upper:extra'), '4th interior outlet tagged with its price, plan mark extra');
    ok(await b.ev('!document.getElementById("count-interior")'), 'no interior count line (showCount removed in 2.5.0)');
    ok(J(await b.ev(LEG)) === J({ hidden: false, items: ['Included', '+$400 each'] }), 'legend: Included + the price of an extra outlet only');
    await b.ev('T.scrollTo("#plan-electrical")'); await sleep(200);
    await b.shot(path.join(SHOTS, '390-electrical-3-interior.png'));
    await b.ev('T.click("interior","back-right")');
    ok((await b.ev('T.on("interior")')).includes('left-upper:Confirm in Comments'), 'swapped interior = Confirm in Comments');
    const legend = await b.ev(LEG);
    ok(J(legend) === J({ hidden: false, items: ['Included', 'Confirm in Comments'] }), 'legend lists only the kinds on the plan now: ' + J(legend));
    ok(!/Selected|Not selected|another layer|One only/.test(legend.items.join('|')), 'legend: no Selected / Not selected / Picked in another layer / One only');

    // ---- skylight -------------------------------------------------------------
    await b.ev('T.go("addons")'); await sleep(300); await b.ev(HELP);
    // 2.5.0 add-on cards: each question sits in its card; the card title is the visible heading.
    const cards = await b.ev(`(()=>{const m=document.querySelector("main"); return {cards:[...m.querySelectorAll("section.addon-card")].map(c=>[c.id,c.querySelector("h2").textContent,[...c.querySelectorAll(".q")].map(q=>q.id)]),
      srOnly:["heatpump","heater","skylightType"].map(q=>{const h=document.querySelector("#q-"+q+" h3"); return h&&h.classList.contains("sr-only")&&h.textContent;}),
      figures:m.querySelectorAll("figure.figure, .note-card").length};})()`);
    ok(J(cards.cards) === J([['card-heatPumpCard', 'Heat pump AC unit', ['q-heatpump']], ['card-heaterCard', 'Wall mounted heater', ['q-heater']], ['card-skylightCard', 'Skylight', ['q-skylightType', 'q-skylightLoc']]]), 'add-on cards hold their questions: ' + J(cards.cards));
    ok(J(cards.srOnly) === J(['Heat pump AC unit', 'Wall mounted heater', 'Skylight']), 'question labels inside the cards are sr-only; skylight label is "Skylight": ' + J(cards.srOnly));
    ok(cards.figures === 0, 'no figure or note items on Add-ons any more');
    ok(await b.ev('!!document.querySelector("#card-skylightCard #plan-roof")'), 'skylight plan sits in the skylight card');
    ok(await b.ev('!!(document.getElementById("q-skylightType").compareDocumentPosition(document.getElementById("plan-roof")) & Node.DOCUMENT_POSITION_FOLLOWING)'), 'skylight type is asked before the location');
    ok(await b.ev('document.querySelectorAll("#plan-roof .layer-chip").length') === 0, 'one-layer plan: no chips');
    // loc = the location block is not shown (itself or the plan box around it has "hidden"; on first paint only the box carries it) and takes no space.
    const SKY = '({loc:document.getElementById("q-skylightLoc").closest("[hidden]")!==null && document.getElementById("q-skylightLoc").getClientRects().length===0, plan:document.getElementById("plan-roof").hidden, head:document.getElementById("qh-skylightLoc").closest("[hidden]")!==null, saved:JSON.parse(localStorage.getItem("spec-form-v2:presidio-xo")).answers.skylightLoc})';
    const sky0 = await b.ev(SKY);
    ok(J(sky0) === J({ loc: true, plan: true, head: true, saved: null }), 'no skylight type yet: location and the roof plan hidden: ' + J(sky0));
    ok(await b.ev('!document.querySelector("[id^=rule-note-4]") && !/NO skylight, so no location/.test(document.querySelector("main").textContent)'), 'no "NO skylight" rule note any more');
    await b.ev('T.click("skylightType","manual")');
    ok(J(await b.ev(SKY)) === J({ loc: false, plan: false, head: false, saved: null }), 'manual skylight: location and roof plan shown');
    ok(await b.ev('document.querySelector("#qh-skylightLoc h3").textContent') === 'Where should the skylight go?' && await b.ev('!document.querySelector("#q-skylightLoc h3")'), 'roof plan heading above the plan, list block has no h3');
    // No abbreviations (Ilya 2026-11-19): the spots are "Option 1..3" in the list; on the plan a phone shows the number alone
    // (three spots sit about 62 pt apart), a wide screen shows "Option 1".
    const skyM = await b.ev('({list:T.btns("skylightLoc").map(e=>e.textContent), dots:T.hots("skylightLoc").map(x=>x.marker), word:[...document.querySelectorAll("#plan-roof .hot .mk-word")].map(e=>getComputedStyle(e).display), w:[...document.querySelectorAll("#plan-roof .hot .dot")].map(e=>Math.round(e.getBoundingClientRect().width))})');
    ok(J(skyM.list) === J(['Option 1', 'Option 2', 'Option 3']) && J(skyM.dots) === J(['Option 1', 'Option 2', 'Option 3']), 'skylight spots are Option 1..3 in the list and on the plan, no S1..S3: ' + J(skyM.list));
    ok(skyM.word.every(d => d === 'none') && skyM.w.every(x => x === 30), 'at 390 pt the plan marker is the number alone in a 30 pt circle: ' + J(skyM.w));
    ok(await b.ev('!/\\b[SBEI][1-5]\\b/.test(SPEC_DATA.steps.map(s=>JSON.stringify((s.items||[]).map(i=>[i.hint,(i.options||[]).map(o=>[o.label,o.marker])]))).join(" "))'), 'spec: no letter-number codes (S1, B2, E3, I4) in labels, markers or hints');
    await b.ev('T.click("skylightLoc","center",true)');
    ok(J(await b.ev('T.on("skylightLoc")')) === '["center"]', 'skylight location picked on the plan');
    await b.ev('T.scrollTo("#q-skylightType")'); await sleep(200);
    await b.shot(path.join(SHOTS, '390-skylight.png'));
    await b.ev('T.click("skylightType","none")');
    const sky = await b.ev('T.st("skylightLoc")');
    ok(sky.every(x => x.dis && !x.on), 'NO skylight clears and disables the location list');
    ok(J(await b.ev(SKY)) === J({ loc: true, plan: true, head: true, saved: null }), 'NO skylight: location and roof plan hidden again, answer cleared');
    ok(await b.ev('T.hots("skylightLoc").every(x=>x.dis) && document.querySelector("#plan-roof .plan-stage").classList.contains("is-disabled")'), 'NO skylight disables the plan hotspots');
    await b.ev('T.scrollTo("#q-skylightType")'); await sleep(200);
    await b.shot(path.join(SHOTS, '390-skylight-none.png'));
    await b.ev('T.click("skylightType","solar")');
    ok(J(await b.ev(SKY)) === J({ loc: false, plan: false, head: false, saved: null }) && await b.ev('T.st("skylightLoc").every(x=>!x.dis && !x.on)'), 'solar skylight: location shown again, enabled, still empty');
    await b.ev('T.click("skylightType","manual")');
    ok(await b.ev('T.st("skylightLoc").every(x=>!x.dis)'), 'other skylight type keeps the location enabled');
    ok(await b.ev('T.overflow()') <= 390, 'add-ons with the roof plan shown: no horizontal scroll');

    // ---- finishes: recolor ----------------------------------------------------
    await b.ev('T.go("finishes")'); await sleep(300); await b.ev(HELP);
    ok(/Pick a stain/.test(await b.ev('document.getElementById("preview-picked").textContent')), 'empty preview text before any pick');
    const stain = SPEC.steps.find(s => s.id === 'finishes').items.find(i => i.id === 'stain').options;
    const deck = SPEC.steps.find(s => s.id === 'finishes').items.find(i => i.id === 'decking').options;
    const cells = []; let worst = 0; let combos = 0, combosOk = 0;
    for (const so of stain) {
      for (const d of deck) {
        await b.ev('T.pick("stain","' + so.id + '");T.pick("decking","' + d.id + '")');
        const m = await b.ev('T.pvMeans()');
        const exp = (o, layer) => o.color ? hex(o.color) : m[layer].photo;
        const df = (a, e) => Math.max(...a.map((x, i) => Math.abs(x - e[i])));
        const e1 = df(m.facade.now, exp(so, 'facade')), e2 = df(m.deck.now, exp(d, 'deck'));
        worst = Math.max(worst, e1, e2); combos++;
        if (e1 <= 12 && e2 <= 12) combosOk++;
        else log.push('  off: ' + so.id + ' x ' + d.id + ' facade ' + J(m.facade.now) + ' vs ' + J(exp(so, 'facade')) + ', deck ' + J(m.deck.now) + ' vs ' + J(exp(d, 'deck')));
        cells.push(await b.ev('document.getElementById("preview-canvas").toDataURL("image/jpeg",.85)'));
      }
    }
    ok(combosOk === combos, 'recolor correct for every stain x decking (' + combosOk + '/' + combos + '; mean color inside each outline within ' + worst + ' of the option color, Natural Pine and Custom = photo)');
    // contact sheet: rows = stains, columns = deckings
    const sheet = await b.ev('(async()=>{const cells=' + J(cells) + ', rows=' + J(stain.map(s => s.label)) + ', cols=' + J(deck.map(d => d.label)) + '; const W=260,H=Math.round(W*507/960),L=130,TOP=40; const c=document.createElement("canvas"); c.width=L+cols.length*(W+6); c.height=TOP+rows.length*(H+6); const g=c.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,c.width,c.height); g.fillStyle="#000"; g.font="13px sans-serif"; cols.forEach((t,i)=>g.fillText(t.replace("Trex ","").slice(0,34),L+i*(W+6)+4,TOP-12)); for(let i=0;i<cells.length;i++){const im=new Image(); im.src=cells[i]; await im.decode(); const r=Math.floor(i/cols.length), k=i%cols.length; g.drawImage(im,L+k*(W+6),TOP+r*(H+6),W,H); if(k===0) g.fillText(rows[r],4,TOP+r*(H+6)+H/2);} return c.toDataURL("image/png");})()');
    fs.writeFileSync(path.join(SHOTS, 'preview-contact-sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'));

    await b.ev('T.pick("stain","weathered-brown");T.pick("decking","trex-select-saddle")'); await sleep(200);
    const groups = await b.ev('T.structure().find(q=>q.id==="q-decking").groups');
    ok(J(groups) === '["Trex Select series","Trex Transcend series","TimberTech decking"]', 'decking series headings from groups');
    const docH = await b.ev('document.documentElement.scrollHeight');
    await b.ev('window.scrollTo(0, ' + Math.round(docH / 2) + ');true'); await sleep(400);
    const pin = await b.ev('(()=>{const t=document.querySelector(".top").getBoundingClientRect(); const p=document.getElementById("finish-preview").getBoundingClientRect(); const c=document.getElementById("preview-canvas").getBoundingClientRect(); return {hdr:t.bottom, top:p.top, h:Math.round(p.height), canvasW:Math.round(c.width), picked:document.getElementById("preview-picked").textContent, note:document.querySelector("#finish-preview .pv-note").textContent};})()');
    ok(Math.abs(pin.hdr - pin.top) <= 1, 'pinned preview sits right under the header when scrolled half-way (header bottom ' + pin.hdr + ', preview top ' + pin.top + ')');
    ok(pin.h >= 100 && pin.h <= 160 && pin.canvasW >= 250 && pin.canvasW <= 340, 'pinned preview is bigger than in v1 (Kirill), still under a fifth of the screen: ' + pin.h + ' px tall, photo ' + pin.canvasW + ' px wide');
    ok(/Stain: Weathered Brown/.test(pin.picked) && /Decking: Trex Select – Saddle/.test(pin.picked) && pin.note === 'Approx. colors', 'picked names next to the photo: ' + pin.picked);
    await b.shot(path.join(SHOTS, '390-finishes-scrolled.png'));

    // ---- deck -----------------------------------------------------------------
    await b.ev('T.go("finishes")'); await sleep(300); await b.ev(HELP);
    const vis = () => b.ev('[document.getElementById("q-dimA").hidden, document.getElementById("q-dimB").hidden, document.getElementById("rule-note-5").hidden]');
    ok(J(await vis()) === '[true,true,false]', 'A/B hidden with no deck, note shown');
    await b.ev('T.click("deckConfig","custom")');
    ok(J(await vis()) === '[false,false,true]', 'custom deck shows A/B');
    await b.ev('T.type("dimA","14")');
    await b.ev('T.click("deckConfig","standard")');
    ok(J(await vis()) === '[true,true,false]', 'standard deck hides A/B');
    ok(await b.ev('JSON.parse(localStorage.getItem("spec-form-v2:presidio-xo")).answers.dimA') === '', 'non-custom deck cleared A');
    await b.ev('T.click("deckConfig","custom")');
    ok(await b.ev('document.getElementById("f-dimA").value') === '', 'A stays empty after switching back to custom');
    await b.ev('T.type("dimA","14")');

    // ---- reload ---------------------------------------------------------------
    await b.reload(); await b.ev(HELP);
    ok(!(await b.ev('T.onCover()')), 'reload: no cover for a returning client');
    ok(await b.ev('document.querySelector(".step-jump[aria-current=step]").dataset.step') === 'finishes', 'reload keeps the step (v2: the deck is on Finishes)');
    ok(await b.ev('document.getElementById("f-dimA").value') === '14', 'reload keeps A');
    await b.ev('T.go("electrical")'); await sleep(300); await b.ev(HELP);
    ok(J(await b.ev('T.on("exterior")')) === '["back-left:Included"]', 'reload keeps breaker and exterior');
    ok(J(await b.ev('T.on("connection")')) === '["hardline:Custom quote","ethernet:+$1,350"]', 'reload keeps connection');
    ok((await b.ev('T.on("interior")')).length === 3, 'reload keeps interior');
    await b.ev('T.go("finishes")'); await sleep(300); await b.ev(HELP);
    ok(/Weathered Brown/.test(await b.ev('document.getElementById("preview-picked").textContent')), 'reload keeps finishes and preview');

    // ---- review ---------------------------------------------------------------
    // permits left empty on purpose (it has emptyText): open for the export, not for the client
    await b.ev('T.go("permits")'); await sleep(200); await b.ev(HELP); await b.ev('T.click("permits","building")');
    ok(J(await b.ev('T.on("permits")')) === '[]', 'permits emptied again');
    await b.ev('T.go("review")'); await sleep(400); await b.ev(HELP);
    const OPEN = '[...document.querySelectorAll("#open-list .jump")].map(e=>e.textContent)';
    const openList = await b.ev(OPEN);
    ok(openList.length > 0 && !openList.some(t => /Comments|Additions|customizations/.test(t)), 'review: empty optional fields not in the open list (' + openList.length + ' open: ' + openList.join(' | ') + ')');
    ok(!openList.some(t => /Permitting/.test(t)) && /^\d+ still open$/.test(await b.ev('document.querySelector("#open-list h3").textContent')) && +(await b.ev('document.querySelector("#open-list h3").textContent')).split(' ')[0] === openList.length, 'review open list: empty permits left out, count = listed items');
    ok(await b.ev('[...document.querySelectorAll(".summary .row")].find(r=>r.querySelector(".k").textContent==="Permitting").querySelector(".v .empty").textContent') === 'Left empty: your manager will contact you', 'review row for empty permits: "Left empty: your manager will contact you"');
    let exP = await b.ev('__specFormExport()');
    ok(exP.openQuestions.some(o => o.id === 'permits' && o.question === 'Permitting'), 'export openQuestions still lists the empty permits');
    ok(exP.summary[0].section === 'Your details' && J(exP.summary[0].answers.map(a => a.id)) === J(['address', 'client', 'phone']), 'export summary: "Your details" first');
    // client details: editable on Review under "Your details"
    const det = await b.ev('(()=>{const d=document.querySelector(".summary .details"); const h=d.previousElementSibling; return {h:h&&h.tagName+":"+h.textContent, ids:[...d.querySelectorAll("input")].map(i=>i.id), labels:[...d.querySelectorAll("label")].map(l=>l.textContent), firstSection:[...document.querySelectorAll(".summary > h3.wm-h3")].map(e=>e.textContent)[0]};})()');
    ok(J(det.ids) === J(['f-address', 'f-client', 'f-phone']) && det.h === 'H3:Your details' && det.firstSection === 'Your details', 'Review: "Your details" heading, then address, client, phone inputs: ' + J(det));
    ok(openList.some(t => /Your details — Client/.test(t)), 'review open list names the empty client name');
    await b.ev('T.type("client","Ann E2E");T.type("address","5 Review Rd");T.type("phone","510 555 0199")'); await sleep(100);
    const openAfter = await b.ev(OPEN);
    ok(openAfter.length === openList.length - 3 && !openAfter.some(t => /Your details/.test(t)), 'open list repaints while typing the details (' + openList.length + ' -> ' + openAfter.length + ')');
    exP = await b.ev('__specFormExport()');
    ok(exP.answers.client === 'Ann E2E' && exP.answers.address === '5 Review Rd' && exP.answers.phone === '510 555 0199' && exP.summary[0].answers.find(a => a.id === 'client').answer === 'Ann E2E', 'details typed on Review reach the export (answers.client, summary)');
    ok(await b.ev('JSON.parse(localStorage.getItem("spec-form-v2:presidio-xo")).answers.client') === 'Ann E2E', 'details typed on Review are saved');
    const rv = await b.ev('(async()=>{const m=await T.pvMeans(); const p=document.getElementById("finish-preview"); return {static:p.classList.contains("static"), first:document.querySelector(".summary").children[1]===p, note:p.querySelector(".pv-note").textContent, w:Math.round(p.getBoundingClientRect().width), facade:m.facade.now};})()');
    ok(rv.static && rv.first && rv.note === 'Approx. colors' && rv.w >= 340, 'review: same picture at the top (right after the model line; no model note in 2.5.0), full width, "Approx. colors": ' + J(rv));
    ok(Math.max(...rv.facade.map((x, i) => Math.abs(x - hex('#876f5b')[i]))) <= 12, 'review picture is recolored (Weathered Brown facade)');
    await b.shot(path.join(SHOTS, '390-review.png'));
    const ex = await b.ev('__specFormExport()');
    ok(ex.specId === 'presidio-xo' && ex.specVersion === SPEC.specVersion && ex.linkId === null, 'export carries specId + specVersion ' + SPEC.specVersion + ', linkId null without a link');
    ok(J(ex.answers.exterior) === '["back-left"]' && ex.tags.exterior['back-left'] === 'Included', 'export writes the included exterior outlet');
    ok(J(ex.preview) === J([{ layer: 'facade', question: 'stain', option: 'weathered-brown', color: '#876f5b' }, { layer: 'deck', question: 'decking', option: 'trex-select-saddle', color: '#85593c' }]), 'export lists preview colors');
    fs.writeFileSync(path.join(OUT, 'export.json'), JSON.stringify(ex, null, 2));

    await b.ev('T.go("addons")'); await sleep(200); await b.ev(HELP); await b.ev('T.click("skylightType","none")');
    await b.ev('T.go("review")'); await sleep(300);
    await b.ev('document.querySelector(".row .jump[data-qid=skylightLoc]").click();true'); await sleep(300);
    ok(await b.ev('document.activeElement && document.activeElement.dataset.qid') === 'skylightType', 'Edit on unused location focuses the skylight type');
    await b.ev('T.go("review")'); await sleep(300);
    await b.ev('document.querySelector(".row .jump[data-qid=interior]").click();true'); await sleep(300); await b.ev(HELP);
    ok(await b.ev('document.querySelector(".layer-chip[data-qid=interior]").getAttribute("aria-pressed")') === 'true' && await b.ev('document.activeElement.dataset.qid') === 'interior', 'Edit on interior outlets opens that plan layer');

    // stale saved option: remove saddle from the spec, reload with saddle saved
    ok(await b.ev('JSON.parse(localStorage.getItem("spec-form-v2:presidio-xo")).answers.decking') === 'trex-select-saddle', 'saddle decking saved before spec edit');
    const jsonPath = path.join(PILOT, 'spec', 'presidio-xo.json'); const jsPath = path.join(PILOT, 'spec', 'presidio-xo.js');
    const orig = fs.readFileSync(jsonPath), origJs = fs.readFileSync(jsPath);
    fs.writeFileSync(path.join(OUT, 'presidio-xo.backup.json'), orig);
    try {
      const spec = JSON.parse(orig.toString('utf8'));
      const dq = spec.steps.find(s => s.id === 'finishes').items.find(i => i.id === 'decking');
      dq.options = dq.options.filter(o => o.id !== 'trex-select-saddle');
      fs.writeFileSync(jsonPath, JSON.stringify(spec, null, 2));
      log.push('  check after removing saddle: ' + cp.execFileSync('python', ['-I', path.join(PILOT, 'check_spec.py')]).toString().trim().replace(/\r?\n/g, ' / ').slice(0, 200));
      b.events.length = 0;
      await b.ev('T.go("finishes")'); await sleep(200);
      await b.reload(); await b.ev(HELP); await sleep(300);
      ok(b.exceptions().length === 0, 'reload with removed decking: no exceptions ' + J(b.exceptions()));
      const st = await b.ev('T.st("decking")');
      ok(st.length === 6 && !st.some(x => x.on), 'removed decking dropped from answers, 6 options left');
      const pk = await b.ev('document.getElementById("preview-picked").textContent');
      ok(/Weathered Brown/.test(pk) && /Decking: not picked/.test(pk), 'preview keeps the stain, decking not picked: ' + pk);
      await b.ev('T.click("decking","timbertech-ashwood")');
      ok(J(await b.ev('T.on("decking")')) === '["timbertech-ashwood:Additional cost"]', 'another decking can be chosen after');
    } finally {
      fs.writeFileSync(jsonPath, orig);
      log.push('  restored spec: ' + cp.execFileSync('python', ['-I', path.join(PILOT, 'check_spec.py')]).toString().trim().replace(/\r?\n/g, ' / '));
      ok(fs.readFileSync(jsPath).equals(origJs), 'spec .json and generated .js restored byte-identical');
    }

    // reset with confirmation
    await b.ev('T.go("review")'); await sleep(300);
    await b.ev('window.confirm=()=>false; document.querySelector("[data-action=reset]").click(); true'); await sleep(200);
    ok(await b.ev('JSON.parse(localStorage.getItem("spec-form-v2:presidio-xo")).answers.stain') === 'weathered-brown', 'Start a new form: Cancel keeps the answers');
    await b.ev('window.confirm=()=>true; document.querySelector("[data-action=reset]").click(); true'); await sleep(300);
    const after = await b.ev('(()=>{const s=JSON.parse(localStorage.getItem("spec-form-v2:presidio-xo")); return {step:s.step, started:s.started, stain:s.answers.stain, client:s.answers.client, interior:s.answers.interior, dimA:s.answers.dimA, cover:T.onCover(), jumps:document.querySelectorAll(".step-jump").length, bar:!!document.querySelector(".bar")};})()');
    ok(after.step === 'finishes' && after.started === false && after.stain === null && after.client === '' && J(after.interior) === '["back-left","back-right","right-lower"]' && after.dimA === '', 'Start a new form: OK clears answers, back to step 1, base outlets again: ' + J(after));
    ok(after.cover && after.jumps === 0 && !after.bar, 'Start a new form returns to the cover (no step buttons, no bar)');
    await b.reload(); await b.ev(HELP);
    ok(await b.ev('T.onCover()'), 'after a reset the cover shows again on reload');
    await b.ev('T.start()'); await sleep(200);
    ok(await b.ev('document.getElementById("step-title").textContent') === 'Finishes', 'Start after a reset: Finishes');
    ok(b.exceptions().length === 0, 'no page exceptions in the 390 run ' + J(b.exceptions()));
  } catch (e) { log.push('FAIL exception ' + e.stack); fails++; }
  finally { b.close(); }
}

async function run1280() {
  const b = await launch(path.join(OUT, 'profile-wide'), 9337, { width: 1280, height: 900, mobile: false });
  try {
    await b.nav(fileUrl(path.join(PILOT, 'index.html'))); await b.ev('localStorage.clear();true'); await b.reload(); await b.ev(HELP);
    ok(await b.ev('innerWidth') === 1280, 'viewport is 1280 px wide');
    await b.ev('T.go("electrical")'); await sleep(300); await b.ev(HELP);
    await b.ev('T.click("breaker","back-right",true);T.layer("exterior");T.click("exterior","right-upper",true)'); await sleep(100);
    ok(await b.ev('T.overflow()') <= 1280, 'electrical at 1280: no overflow');
    await b.ev('T.scrollTo("#plan-electrical")'); await sleep(200);
    await b.shot(path.join(SHOTS, '1280-electrical.png'));
    await b.ev('T.go("finishes")'); await sleep(300); await b.ev(HELP);
    await b.ev('T.pick("stain","midnight-black");T.pick("decking","timbertech-ashwood")'); await sleep(200);
    const docH = await b.ev('document.documentElement.scrollHeight');
    await b.ev('window.scrollTo(0, ' + Math.round(docH / 2) + ');true'); await sleep(400);
    const pin = await b.ev('(()=>{const t=document.querySelector(".top").getBoundingClientRect(); const p=document.getElementById("finish-preview").getBoundingClientRect(); return {hdr:t.bottom, top:p.top, h:Math.round(p.height)};})()');
    ok(Math.abs(pin.hdr - pin.top) <= 1, 'pinned preview at 1280 too (header bottom ' + pin.hdr + ', preview top ' + pin.top + ', ' + pin.h + ' px tall)');
    await b.shot(path.join(SHOTS, '1280-finishes-scrolled.png'));
    await b.ev('T.go("review")'); await sleep(400);
    await b.shot(path.join(SHOTS, '1280-review.png'));
    ok(b.exceptions().length === 0, 'no page exceptions in the 1280 run ' + J(b.exceptions()));
  } catch (e) { log.push('FAIL exception ' + e.stack); fails++; }
  finally { b.close(); }
}

(async () => {
  await run390();
  await run1280();
  log.push(fails ? fails + ' FAILED' : 'ALL PASS');
  console.log(log.join('\n')); fs.writeFileSync(path.join(OUT, 'e2e-log.txt'), log.join('\n'));
  process.exit(fails ? 1 : 0);
})();
