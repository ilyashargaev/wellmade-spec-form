// End-to-end checks in headless Chrome from file:// (node tests/e2e.js "<Shed spec form folder>" "<scratch out folder>").
// Viewport is set over CDP (390x844 mobile, then 1280x900); window.innerWidth is asserted.
// Deliverable screenshots go to Build - Pilot/screenshots/, the rest to the out folder.
const { launch, fileUrl, sleep } = require('./cdp.js');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = process.argv[2]; const OUT = process.argv[3];
const PILOT = path.join(ROOT, 'Build - Pilot');
const SHOTS = path.join(PILOT, 'screenshots');
const STEPS = ['project', 'permits', 'equipment', 'electrical', 'skylight', 'finishes', 'deck', 'review'];
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
    await b.nav(url); await b.ev('localStorage.clear();true'); await b.reload(); await b.ev(HELP);
    ok(await b.ev('innerWidth') === 390, 'viewport is 390 px wide');
    for (const s of STEPS) {
      await b.ev('T.go("' + s + '")'); await sleep(300); await b.ev(HELP);
      const n = (await b.ev('T.structure()')).length;
      const w = await b.ev('T.overflow()');
      ok(w <= 390, s + ' renders, scrollWidth=' + w + ', question blocks=' + n);
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
    ok(J(v) === '["hardline","ethernet"]', 'plug-in/hardline exclusive, Ethernet kept: ' + J(v));
    const chips = await b.ev('[...document.querySelectorAll(".layer-chip")].map(c=>c.firstChild.textContent+"|"+c.getAttribute("aria-pressed"))');
    ok(J(chips) === J(['Breaker box|true', 'Exterior outlets|false', 'Interior outlets|false']), 'one chip per plan question, first active: ' + J(chips));
    const geo = await b.ev('(()=>{const img=document.querySelector("#plan-electrical .plan-inner img").getBoundingClientRect(); const act=[...document.querySelectorAll("#plan-electrical .hot:not(.passive)")].map(e=>e.getBoundingClientRect()); let min=1e9; for(let i=0;i<act.length;i++)for(let j=i+1;j<act.length;j++){const a=act[i],c=act[j];min=Math.min(min,Math.hypot(a.x-c.x,a.y-c.y));} return {imgW:Math.round(img.width), imgL:Math.round(img.left), imgR:Math.round(img.right), n:act.length, minW:Math.min(...act.map(r=>r.width)), minH:Math.min(...act.map(r=>r.height)), minGap:Math.round(min)};})()');
    ok(geo.imgL >= 0 && geo.imgR <= 390 && geo.imgW >= 300, 'whole plan fits the screen width: ' + J(geo));
    ok(geo.n === 4 && geo.minW >= 44 && geo.minH >= 44 && geo.minGap >= 44, 'breaker layer: 4 tap targets >= 44 px, no overlap');
    let hb = await b.ev('T.hots("breaker")');
    ok(hb.every(x => !x.passive && !x.dis && x.marker.startsWith('E')), 'breaker hotspots active with markers ' + hb.map(x => x.marker).join(','));
    let he = await b.ev('T.hots("exterior").concat(T.hots("interior"))');
    ok(he.every(x => x.passive && x.dis && !x.marker), 'other layers passive, disabled, no numbers on the plan');
    ok(J(await b.ev('T.hots("interior").filter(x=>x.visible).map(x=>x.v)')) === '["back-left","back-right","right-lower"]', 'other layer shows only its picks (3 base interior outlets) as small dots');
    await b.ev('T.scrollTo("#plan-electrical")'); await sleep(200);
    await b.shot(path.join(SHOTS, '390-electrical-1-breaker.png'));

    await b.ev('T.layer("exterior")'); await sleep(150);
    ok(await b.ev('!document.getElementById("q-exterior").classList.contains("layer-off") && document.getElementById("q-breaker").classList.contains("layer-off")'), 'chip switches the question block under the plan');
    await b.ev('T.click("exterior","back-left",true)');
    ok(J(await b.ev('T.on("exterior")')) === '["back-left:Pending breaker"]', 'exterior picked on the plan before a breaker: Pending breaker');
    ok(J(await b.ev('T.marks("exterior")')) === '["back-left:pending"]', 'plan mark: pending');
    await b.ev('T.layer("breaker")'); await b.ev('T.click("breaker","right-lower",true)');
    ok(J(await b.ev('T.on("breaker")')) === '["right-lower"]', 'breaker set from the plan hotspot');
    await b.ev('T.layer("exterior")');
    v = await b.ev('T.on("exterior")');
    ok(J(v) === '["back-left:Extra charge","right-lower:Included"]', 'included exterior outlet follows the breaker: ' + J(v));
    ok(J(await b.ev('T.marks("exterior")')) === '["back-left:extra","right-lower:included"]', 'plan marks: included + extra');
    await b.ev('T.click("exterior","right-lower",true)');
    ok(J(await b.ev('T.on("exterior")')) === '["back-left:Extra charge","right-lower:Included"]', 'included outlet cannot be removed (plan tap)');
    ok(await b.ev('document.querySelector(".layer-chip[data-qid=exterior] .count").textContent') === '2', 'chip count shows 2 exterior outlets');
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
    ok((await b.ev('T.on("interior")')).includes('left-upper:Additional charge') && (await b.ev('T.marks("interior")')).includes('left-upper:extra'), '4th interior outlet tagged Additional charge, plan mark extra');
    ok(await b.ev('document.getElementById("count-interior").textContent') === 'Selected: 4.', 'interior count shown');
    await b.ev('T.scrollTo("#plan-electrical")'); await sleep(200);
    await b.shot(path.join(SHOTS, '390-electrical-3-interior.png'));
    await b.ev('T.click("interior","back-right")');
    ok((await b.ev('T.on("interior")')).includes('left-upper:Confirm in Comments'), 'swapped interior = Confirm in Comments');
    const legend = await b.ev('document.getElementById("legend-electrical").textContent');
    ok(/Included/.test(legend) && /Additional charge/.test(legend) && /Confirm in Comments/.test(legend), 'legend explains the marks: ' + legend);

    // ---- skylight -------------------------------------------------------------
    await b.ev('T.go("skylight")'); await sleep(300); await b.ev(HELP);
    ok(await b.ev('!!(document.getElementById("q-skylightType").compareDocumentPosition(document.getElementById("plan-roof")) & Node.DOCUMENT_POSITION_FOLLOWING)'), 'skylight type is asked before the location');
    ok(await b.ev('document.querySelectorAll("#plan-roof .layer-chip").length') === 0, 'one-layer plan: no chips');
    await b.ev('T.click("skylightType","manual");T.click("skylightLoc","center",true)');
    ok(J(await b.ev('T.on("skylightLoc")')) === '["center"]', 'skylight location picked on the plan');
    await b.ev('T.scrollTo("#q-skylightType")'); await sleep(200);
    await b.shot(path.join(SHOTS, '390-skylight.png'));
    await b.ev('T.click("skylightType","none")');
    const sky = await b.ev('T.st("skylightLoc")');
    ok(sky.every(x => x.dis && !x.on), 'NO skylight clears and disables the location list');
    ok(await b.ev('T.hots("skylightLoc").every(x=>x.dis) && document.querySelector("#plan-roof .plan-stage").classList.contains("is-disabled")'), 'NO skylight disables the plan');
    ok(await b.ev('!document.getElementById("rule-note-4").hidden'), 'NO skylight note shown');
    await b.ev('T.scrollTo("#q-skylightType")'); await sleep(200);
    await b.shot(path.join(SHOTS, '390-skylight-none.png'));
    await b.ev('T.click("skylightType","manual")');
    ok(await b.ev('T.st("skylightLoc").every(x=>!x.dis) && document.getElementById("rule-note-4").hidden'), 'other skylight type re-enables location');

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
    ok(pin.h >= 100 && pin.h <= 130 && pin.canvasW < 260, 'pinned preview is small: ' + pin.h + ' px tall, photo ' + pin.canvasW + ' px wide');
    ok(/Stain: Weathered Brown/.test(pin.picked) && /Decking: Trex Select – Saddle/.test(pin.picked) && pin.note === 'Approx. colors', 'picked names next to the photo: ' + pin.picked);
    await b.shot(path.join(SHOTS, '390-finishes-scrolled.png'));

    // ---- deck -----------------------------------------------------------------
    await b.ev('T.go("deck")'); await sleep(300); await b.ev(HELP);
    const vis = () => b.ev('[document.getElementById("q-dimA").hidden, document.getElementById("q-dimB").hidden, document.getElementById("rule-note-5").hidden]');
    ok(J(await vis()) === '[true,true,false]', 'A/B hidden with no deck, note shown');
    await b.ev('T.click("deckConfig","custom")');
    ok(J(await vis()) === '[false,false,true]', 'custom deck shows A/B');
    await b.ev('T.type("dimA","14")');
    await b.ev('T.click("deckConfig","standard")');
    ok(J(await vis()) === '[true,true,false]', 'standard deck hides A/B');
    ok(await b.ev('JSON.parse(localStorage.getItem("spec-form:presidio-xo")).answers.dimA') === '', 'non-custom deck cleared A');
    await b.ev('T.click("deckConfig","custom")');
    ok(await b.ev('document.getElementById("f-dimA").value') === '', 'A stays empty after switching back to custom');
    await b.ev('T.type("dimA","14")');

    // ---- reload ---------------------------------------------------------------
    await b.reload(); await b.ev(HELP);
    ok(await b.ev('document.querySelector(".step-jump[aria-current=step]").dataset.step') === 'deck', 'reload keeps the step');
    ok(await b.ev('document.getElementById("f-dimA").value') === '14', 'reload keeps A');
    await b.ev('T.go("electrical")'); await sleep(300); await b.ev(HELP);
    ok(J(await b.ev('T.on("exterior")')) === '["back-left:Included"]', 'reload keeps breaker and exterior');
    ok(J(await b.ev('T.on("connection")')) === '["hardline","ethernet"]', 'reload keeps connection');
    ok((await b.ev('T.on("interior")')).length === 3, 'reload keeps interior');
    await b.ev('T.go("finishes")'); await sleep(300); await b.ev(HELP);
    ok(/Weathered Brown/.test(await b.ev('document.getElementById("preview-picked").textContent')), 'reload keeps finishes and preview');

    // ---- review ---------------------------------------------------------------
    await b.ev('T.go("review")'); await sleep(400); await b.ev(HELP);
    const openList = await b.ev('[...document.querySelectorAll(".summary > .jump")].map(e=>e.textContent)');
    ok(!openList.some(t => /Comments|Additions|customizations/.test(t)), 'review: empty optional fields not in the open list (' + openList.length + ' open: ' + openList.join(' | ') + ')');
    const rv = await b.ev('(async()=>{const m=await T.pvMeans(); const p=document.getElementById("finish-preview"); return {static:p.classList.contains("static"), first:document.querySelector(".summary").children[2]===p, note:p.querySelector(".pv-note").textContent, w:Math.round(p.getBoundingClientRect().width), facade:m.facade.now};})()');
    ok(rv.static && rv.first && rv.note === 'Approx. colors' && rv.w >= 340, 'review: same picture at the top, full width, "Approx. colors": ' + J(rv));
    ok(Math.max(...rv.facade.map((x, i) => Math.abs(x - hex('#876f5b')[i]))) <= 12, 'review picture is recolored (Weathered Brown facade)');
    await b.shot(path.join(SHOTS, '390-review.png'));
    const ex = await b.ev('__specFormExport()');
    ok(ex.specId === 'presidio-xo' && ex.specVersion === SPEC.specVersion && ex.linkId === null, 'export carries specId + specVersion ' + SPEC.specVersion + ', linkId null without a link');
    ok(J(ex.answers.exterior) === '["back-left"]' && ex.tags.exterior['back-left'] === 'Included', 'export writes the included exterior outlet');
    ok(J(ex.preview) === J([{ layer: 'facade', question: 'stain', option: 'weathered-brown', color: '#876f5b' }, { layer: 'deck', question: 'decking', option: 'trex-select-saddle', color: '#85593c' }]), 'export lists preview colors');
    fs.writeFileSync(path.join(OUT, 'export.json'), JSON.stringify(ex, null, 2));

    await b.ev('T.go("skylight")'); await sleep(200); await b.ev(HELP); await b.ev('T.click("skylightType","none")');
    await b.ev('T.go("review")'); await sleep(300);
    await b.ev('document.querySelector(".row .jump[data-qid=skylightLoc]").click();true'); await sleep(300);
    ok(await b.ev('document.activeElement && document.activeElement.dataset.qid') === 'skylightType', 'Edit on unused location focuses the skylight type');
    await b.ev('T.go("review")'); await sleep(300);
    await b.ev('document.querySelector(".row .jump[data-qid=interior]").click();true'); await sleep(300); await b.ev(HELP);
    ok(await b.ev('document.querySelector(".layer-chip[data-qid=interior]").getAttribute("aria-pressed")') === 'true' && await b.ev('document.activeElement.dataset.qid') === 'interior', 'Edit on interior outlets opens that plan layer');

    // stale saved option: remove saddle from the spec, reload with saddle saved
    ok(await b.ev('JSON.parse(localStorage.getItem("spec-form:presidio-xo")).answers.decking') === 'trex-select-saddle', 'saddle decking saved before spec edit');
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
    ok(await b.ev('JSON.parse(localStorage.getItem("spec-form:presidio-xo")).answers.stain') === 'weathered-brown', 'Start a new form: Cancel keeps the answers');
    await b.ev('window.confirm=()=>true; document.querySelector("[data-action=reset]").click(); true'); await sleep(300);
    const after = await b.ev('(()=>{const s=JSON.parse(localStorage.getItem("spec-form:presidio-xo")); return {step:s.step, stain:s.answers.stain, interior:s.answers.interior, dimA:s.answers.dimA, cur:document.querySelector(".step-jump[aria-current=step]").dataset.step};})()');
    ok(after.step === 'project' && after.cur === 'project' && after.stain === null && J(after.interior) === '["back-left","back-right","right-lower"]' && after.dimA === '', 'Start a new form: OK clears answers, back to step 1, base outlets again: ' + J(after));
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
