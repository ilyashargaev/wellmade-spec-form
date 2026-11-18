// Live site: every step + manager page at 390 (mobile) and 1280 (laptop). Checks overflow and page errors.
const path = require('path'), fs = require('fs');
const BP = process.argv[2], OUT = process.argv[3];
const { launch, sleep } = require(path.join(BP, 'tests', 'cdp.js'));
const HELP = fs.readFileSync(path.join(BP, 'tests', 'helpers.js'), 'utf8');
const SITE = 'https://spec.wllmd.com';
const STEPS = ['project', 'permits', 'equipment', 'electrical', 'skylight', 'finishes', 'deck', 'review'];
(async () => {
  let bad = 0;
  for (const [w, h, mobile, port] of [[390, 844, true, 9371], [1280, 800, false, 9372]]) {
    fs.rmSync(path.join(OUT, 'p' + w), { recursive: true, force: true });
    const b = await launch(path.join(OUT, 'p' + w), port, { width: w, height: h, mobile });
    const shot = async (name) => {
      const ht = await b.ev('document.documentElement.scrollHeight');
      const r = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(ht, 5000), scale: mobile ? 0.5 : 0.6 } });
      fs.writeFileSync(path.join(OUT, w + '-' + name + '.png'), Buffer.from(r.result.data, 'base64'));
      const sw = await b.ev('document.documentElement.scrollWidth'), iw = await b.ev('innerWidth');
      const ex = b.exceptions();
      const line = `${w} ${name}: innerWidth ${iw}, scrollWidth ${sw}, height ${ht}, errors ${ex.length}`;
      if (sw > iw || ex.length || iw !== w) { bad++; console.log('BAD ' + line + ' ' + JSON.stringify(ex)); } else console.log('ok  ' + line);
    };
    await b.nav(SITE + '/manager.html?t=' + Date.now()); await sleep(800); await shot('manager');
    await b.nav(SITE + '/index.html?preview&t=' + Date.now()); await sleep(1000); await b.ev(HELP);
    for (const s of STEPS) { await b.ev('T.go("' + s + '")'); await sleep(500); await b.ev('window.scrollTo(0,0);true'); await shot(s); }
    b.close();
  }
  console.log(bad ? bad + ' BAD' : 'ALL OK');
})().catch(e => { console.error(e); process.exit(1); });
