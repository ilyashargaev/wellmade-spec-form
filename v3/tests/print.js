// Print sheet and Download JSON from Review, headless Chrome from file:// (390 px).
// node tests/print.js "<Build - v3 folder>" "<scratch out folder>"
const { launch, fileUrl, sleep } = require('./cdp.js');
const path = require('path'), fs = require('fs');
const PILOT = process.argv[2], OUT = process.argv[3];
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const J = JSON.stringify;
const S_VERSION = JSON.parse(fs.readFileSync(path.join(PILOT, 'spec/presidio-xo.json'), 'utf8')).specVersion;
(async () => {
  const b = await launch(path.join(OUT, 'profile2'), 9334);
  try {
    await b.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.join(OUT, 'dl') });
    await b.nav(fileUrl(path.join(PILOT, 'index.html')));
    await b.ev(fs.readFileSync(path.join(__dirname, 'helpers.js'), 'utf8'));
    await b.ev('T.type("client","Jane Test")'); await b.ev('T.go("finishes")'); await sleep(300); await b.ev('T.click("stain","midnight-black");T.click("decking","trex-select-saddle")'); await sleep(200);
    await b.ev('T.go("review")'); await sleep(300);
    await b.ev('window.dispatchEvent(new Event("beforeprint"));true');
    const p = await b.ev('({h1: document.querySelector("#print-sheet h1").textContent, rows: document.querySelectorAll("#print-sheet .row").length, previewImage: !!document.querySelector("#print-sheet img.preview-print"), meta: [...document.querySelectorAll("#print-sheet .meta")].map(e=>e.textContent)})');
    console.log('print sheet:', J(p));
    ok(p.h1 === 'Presidio spec sheet' && p.previewImage && p.meta[0] === 'Presidio, door on the left (XO)', 'print sheet: title, recolored preview image, model line without a model note');
    // 2.5.0: "Your details" is the first section; the permits question may stay empty and is not in "Still open".
    const ps = await b.ev(`(()=>{const kids=[...document.querySelectorAll("#print-sheet > *")]; const h2=kids.filter(e=>e.tagName==="H2").map(e=>e.textContent);
      const at=kids.findIndex(e=>e.tagName==="H2"&&e.textContent==="Still open"); const open=[]; if(at>=0) for(let i=at+1;i<kids.length&&kids[i].tagName==="P";i++) open.push(kids[i].textContent);
      const row=k=>{const r=[...document.querySelectorAll("#print-sheet .row")].find(r=>r.querySelector(".k").textContent===k); return r&&r.querySelector(".v").textContent;};
      return {h2, open, client:row("Client"), permits:row("Permitting")};})()`);
    console.log('print sections:', J(ps.h2), 'still open:', J(ps.open));
    ok(J(ps.h2.slice(0, 3)) === J(['Finish preview', 'Still open', 'Your details']) && J(ps.h2.slice(3)) === J(['Finishes', 'Add-ons', 'Electrical', 'Permits']), 'print sections: preview, Still open, Your details first, then the steps: ' + J(ps.h2));
    ok(ps.client === 'Jane Test', 'print: client name typed on Review shows under Your details');
    ok(ps.open.length > 0 && !ps.open.some(t => /Permitting/.test(t)) && ps.open.some(t => /Connection/.test(t)), 'print "Still open": empty permits left out (soft), real open questions kept');
    ok(ps.permits === 'Left empty: your manager will contact you', 'print: empty permits row reads "Left empty: your manager will contact you"');
    const pdf = await b.send('Page.printToPDF', {});
    fs.writeFileSync(path.join(OUT, 'print.pdf'), Buffer.from(pdf.result.data, 'base64'));
    await b.ev('document.querySelector("[data-action=download]").click();true'); await sleep(1500);
    const dl = fs.existsSync(path.join(OUT, 'dl')) ? fs.readdirSync(path.join(OUT, 'dl')) : [];
    console.log('downloads:', dl);
    ok(J(dl) === J(['Jane-Test-presidio-xo-spec.json']), 'download file name from the client name');
    if (dl[0]) {
      const j = JSON.parse(fs.readFileSync(path.join(OUT, 'dl', dl[0]), 'utf8'));
      console.log('downloaded specId/version:', j.specId, j.specVersion, 'client:', j.answers.client);
      ok(j.specId === 'presidio-xo' && j.specVersion === S_VERSION && j.answers.client === 'Jane Test', 'downloaded JSON: specId, specVersion, client');
      ok(j.openQuestions.some(o => o.id === 'permits'), 'downloaded JSON: empty permits still listed in openQuestions');
    }
    console.log('exceptions:', J(b.exceptions()));
    ok(b.exceptions().length === 0, 'no page exceptions');
  } catch (e) { console.log('FAIL exception ' + e.stack); fails++; }
  finally { b.close(); }
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
