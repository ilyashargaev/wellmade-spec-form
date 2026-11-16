const { launch, fileUrl, sleep } = require('./cdp.js');
const path = require('path'), fs = require('fs');
const PILOT = process.argv[2], OUT = process.argv[3];
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
    console.log('print sheet:', JSON.stringify(p));
    const pdf = await b.send('Page.printToPDF', {});
    fs.writeFileSync(path.join(OUT, 'print.pdf'), Buffer.from(pdf.result.data, 'base64'));
    await b.ev('document.querySelector("[data-action=download]").click();true'); await sleep(1500);
    const dl = fs.existsSync(path.join(OUT, 'dl')) ? fs.readdirSync(path.join(OUT, 'dl')) : [];
    console.log('downloads:', dl);
    if (dl[0]) { const j = JSON.parse(fs.readFileSync(path.join(OUT, 'dl', dl[0]), 'utf8')); console.log('downloaded specId/version:', j.specId, j.specVersion, 'client:', j.answers.client); }
    console.log('exceptions:', JSON.stringify(b.exceptions()));
  } finally { b.close(); }
})();
