// Phase 6 live end-to-end against the published site and the real receiver.
// Sends 5 REAL emails to ilya@wllmd.com and writes 5 files to the receiver log. Run only on purpose.
// node live.js "<Build - Pilot>" "<out>"
const path = require('path'), fs = require('fs');
const BP = process.argv[2], OUT = process.argv[3];
const { launch, sleep } = require(path.join(BP, 'tests', 'cdp.js'));
const HELP = fs.readFileSync(path.join(BP, 'tests', 'helpers.js'), 'utf8');
const SITE = 'https://spec.wllmd.com';
const J = JSON.stringify;
const log = []; let fails = 0;
function ok(c, m) { log.push((c ? 'PASS ' : 'FAIL ') + m); console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
fs.mkdirSync(OUT, { recursive: true });

const MH = `window.MG = { set(p, v) { const i = document.getElementById('m-' + p); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); return true; },
  create() { document.querySelector('.mgr-create').click(); return true; },
  state() { return { errors: [...document.querySelectorAll('.field-error')].filter(e => !e.hidden).map(e => e.textContent),
    shown: !document.getElementById('link-result').hidden, link: document.getElementById('link-out').value }; } }; true;`;
const H1 = '(document.querySelector("main h1")||{}).textContent';

async function waitFor(b, expr, ms) { for (let t = 0; t < (ms || 30000); t += 200) { if (await b.ev(expr)) return true; await sleep(200); } return false; }
async function full(b, file) {
  const w = await b.ev('innerWidth'), hgt = await b.ev('document.documentElement.scrollHeight');
  const r = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(hgt, 6000), scale: 1 } });
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
}
async function step(b, s) { await b.ev(HELP); await b.ev('T.go("' + s + '")'); await sleep(350); await b.ev(HELP); }

// Answer sets. hot=true for plan hotspots.
const SETS = {
  A: async (b) => {
    await step(b, 'permits'); await b.ev('T.click("permits","building");T.click("permits","electrical")');
    await step(b, 'equipment'); await b.ev('T.click("tv","tv-mount");T.click("heater","heater");T.click("heatpump","no-heat-pump")');
    await step(b, 'electrical'); await b.ev('T.click("connection","plug-in");T.click("connection","ethernet")');
    await b.ev('T.layer("breaker");T.click("breaker","back-left",true)');
    await b.ev('T.layer("exterior");T.click("exterior","back-right",true)');
    await step(b, 'skylight'); await b.ev('T.click("skylightType","solar")'); await b.ev('T.click("skylightLoc","center",true)');
    await step(b, 'finishes'); await b.ev('T.click("stain","weathered-brown");T.click("floor","white-oak");T.click("decking","timbertech-ashwood")');
    await step(b, 'deck'); await b.ev('T.click("deckConfig","standard")');
  },
  B: async (b) => {
    await step(b, 'permits'); await b.ev('T.click("permits","none")');
    await step(b, 'equipment'); await b.ev('T.click("tv","no-tv-mount");T.click("heater","no-heater");T.click("heatpump","heat-pump")');
    await step(b, 'electrical'); await b.ev('T.click("connection","hardline")');
    await step(b, 'skylight'); await b.ev('T.click("skylightType","none")');
    await step(b, 'finishes'); await b.ev('T.click("stain","coastal-white");T.click("floor","light-gray");T.click("decking","trex-transcend-spiced-rum")');
    await step(b, 'deck'); await b.ev('T.click("deckConfig","custom")'); await b.ev(HELP);
    await b.ev('(document.getElementById("f-dimA")? T.type("dimA","10 ft") : true)');
    await b.ev('(document.getElementById("f-dimB")? T.type("dimB","6 ft") : true)');
  },
  C: async (b) => { // few answers, many open questions
    await step(b, 'finishes'); await b.ev('T.click("stain","natural-pine")');
  },
};

async function makeLink(b, n) {
  await b.nav(SITE + '/manager.html?t=' + Date.now()); await sleep(800); await b.ev(MH);
  await b.ev(`MG.set('name','Phase6 Test ${n} (fake)'); MG.set('address','${100 + n} Test Ave, Sample City, CA'); MG.set('phone','(555) 010-00${10 + n}'); MG.set('to','ilya@wllmd.com'); MG.create()`);
  await sleep(300);
  const st = await b.ev('MG.state()');
  ok(st.shown && !st.errors.length, `run ${n}: manager page made a link`);
  return st.link;
}

async function sendAndConfirm(b, label, shotName) {
  await step(b, 'review');
  const btn = await b.ev('(document.getElementById("send-btn")||{}).textContent');
  ok(/Send/.test(btn || ''), `${label}: Review shows "${btn}"`);
  if (shotName) await full(b, path.join(OUT, shotName + '-review.png'));
  const t0 = Date.now();
  await b.ev('document.getElementById("send-btn").click();true');
  const sent = await waitFor(b, H1 + ' === "Sent to Wellmade"', 40000);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const facts = sent ? await b.ev('Object.fromEntries([...document.querySelectorAll(".sent-facts dt")].map((d,i)=>[d.textContent, document.querySelectorAll(".sent-facts dd")[i].textContent]))') : {};
  ok(sent && /^\d{8}-\d{6}-[A-Z0-9]+$/.test(facts.Reference || ''), `${label}: "Sent to Wellmade" in ${secs} s, reference ${facts.Reference}`);
  if (!sent) log.push('   panel: ' + await b.ev('(document.getElementById("send-panel")||{}).textContent'));
  if (shotName) await full(b, path.join(OUT, shotName + '-sent.png'));
  return facts.Reference;
}

(async () => {
  fs.rmSync(path.join(OUT, 'profile'), { recursive: true, force: true });
  const b = await launch(path.join(OUT, 'profile'), 9361);
  await b.send('Network.enable');
  const posts = [];
  const results = [];
  try {
    await b.nav(SITE + '/manager.html'); await sleep(800); ok(await b.ev('innerWidth') === 390, 'viewport 390');
    const links = {};
    for (const [n, set] of [[1, 'A'], [2, 'B'], [3, 'C']]) {
      const link = await makeLink(b, n); links[n] = link;
      await b.nav(link); await sleep(1000); await b.ev(HELP);
      const name = await b.ev('(document.getElementById("f-client")||{}).value');
      ok(name === `Phase6 Test ${n} (fake)`, `run ${n}: form opened with client name prefilled (${name})`);
      await SETS[set](b);
      const ref = await sendAndConfirm(b, `run ${n} (set ${set})`, n === 1 ? '390-run1' : null);
      results.push({ run: n, set, link: link.split('#')[1].match(/id=([^&]+)/)[1], ref });
      ok(b.exceptions().length === 0, `run ${n}: no page errors ${J(b.exceptions())}`);
    }
    // ---- resend with a changed answer (run 1 link) ----
    await b.nav(links[1]); await sleep(1000); await b.ev(HELP);
    const h1 = await b.ev(H1);
    log.push('   reopen run 1 link shows: ' + h1);
    if (h1 === 'Sent to Wellmade') { await b.ev('document.querySelector(".bar [data-action=goto]").click();true'); await sleep(400); }
    await step(b, 'finishes');
    ok(J(await b.ev('T.on("stain")')) === J(['weathered-brown']), 'resend: saved answer still there (stain weathered-brown)');
    await b.ev('T.click("stain","midnight-black")');
    await step(b, 'review');
    const panel = await b.ev('document.getElementById("send-panel").textContent');
    ok(/Changed since you sent/.test(panel) && /Send again/.test(await b.ev('document.getElementById("send-btn").textContent')), 'resend: Review says "Changed since you sent", button "Send again"');
    await full(b, path.join(OUT, '390-resend-review.png'));
    const ref4 = await sendAndConfirm(b, 'resend run 1 (stain → midnight-black)', null);
    results.push({ run: 4, set: 'A+stain', link: results[0].link, ref: ref4 });
    // ---- offline at send (run 2 link) ----
    await b.nav(links[2]); await sleep(1000); await b.ev(HELP);
    if (await b.ev(H1) === 'Sent to Wellmade') { await b.ev('document.querySelector(".bar [data-action=goto]").click();true'); await sleep(400); }
    await step(b, 'finishes'); await b.ev('T.click("floor","dark-gray")');
    await step(b, 'review');
    await b.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await b.ev('document.getElementById("send-btn").click();true');
    const err = await waitFor(b, '!!document.getElementById("send-retry")', 30000);
    const errText = await b.ev('(document.getElementById("send-panel")||{}).textContent');
    ok(err && /Check your internet connection/.test(errText) && /still here/.test(errText), 'offline: "Not sent … check your internet connection … answers still here", Retry shown');
    await full(b, path.join(OUT, '390-offline.png'));
    await b.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const t0 = Date.now();
    await b.ev('document.getElementById("send-retry").click();true');
    const sent5 = await waitFor(b, H1 + ' === "Sent to Wellmade"', 40000);
    const ref5 = sent5 ? await b.ev('[...document.querySelectorAll(".sent-facts dt")].map((d,i)=>[d.textContent, document.querySelectorAll(".sent-facts dd")[i].textContent]).find(f=>f[0]==="Reference")[1]') : null;
    ok(sent5, `offline → online → Retry: sent in ${((Date.now() - t0) / 1000).toFixed(1)} s, reference ${ref5}`);
    results.push({ run: 5, set: 'B+floor dark-gray, after offline', link: results[1].link, ref: ref5 });
    ok(b.exceptions().length === 0, 'no page errors at the end ' + J(b.exceptions()));
    const reqs = b.events.filter(e => e.method === 'Network.requestWillBeSent' && e.params.request.method === 'POST').map(e => e.params.request.url.replace(/\/s\/[^/]+\//, '/s/<id>/'));
    log.push('   POSTs seen since last nav: ' + J(reqs));
  } catch (e) { ok(false, 'exception ' + e.stack); }
  finally { b.close(); }
  fs.writeFileSync(path.join(OUT, 'results.json'), J(results, null, 1));
  log.push(fails ? fails + ' FAILED' : 'ALL PASS');
  fs.writeFileSync(path.join(OUT, 'live-log.txt'), log.join('\n'));
  console.log(J(results, null, 1));
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
