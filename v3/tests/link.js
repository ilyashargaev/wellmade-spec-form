// Phase 3: manager's link page and the form opened from a link, in headless Chrome from file://.
// node tests/link.js "<Build - Pilot folder>" "<scratch out folder>"
// Viewport set over CDP to 390x844 mobile (innerWidth asserted), then 1280x900 for one shot.
const { launch, fileUrl, sleep } = require('./cdp.js');
const fs = require('fs'), path = require('path');
const PILOT = process.argv[2], OUT = process.argv[3];
const SHOTS = path.join(PILOT, 'screenshots');
const HELP = fs.readFileSync(path.join(__dirname, 'helpers.js'), 'utf8');
const SPEC = JSON.parse(fs.readFileSync(path.join(PILOT, 'spec', 'presidio-xo.json'), 'utf8'));
const log = []; let fails = 0;
function ok(c, m) { log.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
const J = JSON.stringify;
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(path.join(OUT, 'dl-link'), { recursive: true });

const MANAGER = fileUrl(path.join(PILOT, 'manager.html'));
const FORM = fileUrl(path.join(PILOT, 'index.html'));

// Manager page helpers (run in the page).
const MH = `window.MG = {
  set(p, v) { const i = document.getElementById('m-' + p); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); return true; },
  create() { document.querySelector('.mgr-create').click(); return true; },
  state() { return {
    errors: [...document.querySelectorAll('.field-error')].filter(e => !e.hidden).map(e => e.id + ':' + e.textContent),
    invalid: [...document.querySelectorAll('[aria-invalid=true]')].map(e => e.id),
    shown: !document.getElementById('link-result').hidden,
    link: document.getElementById('link-out').value,
    title: document.getElementById('link-title').textContent,
    status: document.getElementById('copy-status').textContent,
    focus: document.activeElement && document.activeElement.id
  }; }
}; true;`;

async function makeLink(b, name, address, phone, to) {
  await b.ev(`MG.set('name', ${J(name)}); MG.set('address', ${J(address)}); MG.set('phone', ${J(phone || '')}); MG.set('to', ${J(to || 'ilya@wllmd.com')}); MG.create()`);
  await sleep(150);
  return (await b.ev('MG.state()')).link;
}

const pageErrors = [];
async function openForm(b, url) {
  pageErrors.push(...b.exceptions());
  await b.nav('about:blank'); await b.nav(url); await b.ev(HELP);
}

// Whole page, not just the viewport (the link and Copy sit below the fold on a phone).
async function fullShot(b, file) {
  const hgt = await b.ev('document.documentElement.scrollHeight');
  const w = await b.ev('innerWidth');
  const r = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: hgt, scale: 1 } });
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
}

const fieldValues = b => b.ev('({client: document.getElementById("f-client").value, address: document.getElementById("f-address").value, phone: document.getElementById("f-phone").value})');

(async () => {
  const b = await launch(path.join(OUT, 'profile-link'), 9341);
  try {
    await b.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.join(OUT, 'dl-link') });

    // ---- plain form answers before any link (must stay separate) --------------
    await b.nav(FORM); await b.ev('localStorage.clear();true'); await b.reload(); await b.ev(HELP);
    ok(await b.ev('innerWidth') === 390, 'viewport is 390 px wide');
    await b.ev('T.type("client","Plain Test")'); await b.ev('T.go("permits")'); await sleep(200); await b.ev(HELP); await b.ev('T.click("permits","none")');

    // ---- manager page -----------------------------------------------------------
    await b.nav(MANAGER); await b.ev(MH);
    ok(await b.ev('document.documentElement.scrollWidth') <= 390, 'manager page: no horizontal overflow at 390');
    const labels = await b.ev('[...document.querySelectorAll(".mgr-field label")].map(l=>l.textContent)');
    ok(J(labels) === J(['Client name', 'Address', 'Phone (optional)', 'Studio price in the quote, $ (optional)', 'Manager name (optional)', 'Manager email (optional)', 'Link to book a call (optional)', 'Send results to']), 'manager fields come from spec.link, then the manager contact, then Send results to: ' + J(labels));
    ok(await b.ev('document.getElementById("m-phone").type') === 'tel', 'phone input is type tel (from the question inputmode)');
    ok(await b.ev('document.getElementById("link-result").hidden'), 'no link shown before Create');
    await fullShot(b, path.join(SHOTS, '390-manager-empty.png'));

    await b.ev('MG.create()'); await sleep(150);
    let st = await b.ev('MG.state()');
    ok(J(st.errors) === J(['err-name:Client name is required.', 'err-address:Address is required.', 'err-to:Send results to is required.']) && !st.shown && st.focus === 'm-name',
      'validation: name, address and recipients required, phone not; focus on the first: ' + J(st.errors));
    await b.ev('MG.set("name","Jane O\'Brien")'); await b.ev('MG.set("to","ilya@wllmd.com")'); await b.ev('MG.create()'); await sleep(100);
    st = await b.ev('MG.state()');
    ok(J(st.errors) === J(['err-address:Address is required.']) && !st.shown, 'typing clears that field\'s error; address still required');
    await fullShot(b, path.join(SHOTS, '390-manager-errors.png'));

    const link1 = await makeLink(b, "Jane O'Brien", '12 Main St #4, San Leandro, CA 94577', '(510) 555-0100');
    st = await b.ev('MG.state()');
    const expectBase = await b.ev('new URL("index.html", location.href).href');
    ok(st.shown && link1.startsWith(expectBase + '#id='), 'link = form page next to the manager page + "#id=...": ' + link1.slice(0, 60) + '...');
    const h1 = new URLSearchParams(link1.split('#')[1]);
    const id1 = h1.get('id');
    ok(/^[A-Za-z0-9_-]{16}$/.test(id1), 'random link id, 16 url-safe chars: ' + id1);
    ok(h1.get('name') === "Jane O'Brien" && h1.get('address') === '12 Main St #4, San Leandro, CA 94577' && h1.get('phone') === '(510) 555-0100',
      'fragment carries name, address, phone (decoded with URLSearchParams)');
    ok(!/[ '()#,]/.test(link1.split('#')[1]), 'fragment has no raw space, quote, bracket, # or comma');
    ok(st.title === "Link for Jane O'Brien", 'result title: ' + st.title);
    await b.ev('window.scrollTo(0,0);true');
    await fullShot(b, path.join(SHOTS, '390-manager-link.png'));
    await b.ev('document.getElementById("copy-link").click();true'); await sleep(300);
    st = await b.ev('MG.state()');
    const sel = await b.ev('(()=>{const t=document.getElementById("link-out"); return t.selectionEnd - t.selectionStart;})()');
    ok(/^Copied\./.test(st.status) || (/selected/.test(st.status) && sel === link1.length), 'Copy: clipboard or selected fallback: ' + st.status);
    await fullShot(b, path.join(OUT, '390-manager-link-copied.png'));
    ok(await b.ev('document.documentElement.scrollWidth') <= 390, 'manager page with a long link: no horizontal overflow');

    const again = await makeLink(b, "Jane O'Brien", '12 Main St #4, San Leandro, CA 94577', '(510) 555-0100');
    ok(new URLSearchParams(again.split('#')[1]).get('id') !== id1, 'each Create makes a new id');
    await b.ev('MG.set("address","13 Main St")');
    ok(!(await b.ev('MG.state()')).shown, 'editing a field hides the old link');
    const link2 = await makeLink(b, 'Bob Lee', '7 Oak Ave, Hayward', '');
    const id2 = new URLSearchParams(link2.split('#')[1]).get('id');
    ok(!new URLSearchParams(link2.split('#')[1]).has('phone'), 'empty phone left out of the link');
    ok(await b.ev('Object.keys(localStorage).every(k => k === "spec-form-v2:presidio-xo")') && await b.ev('sessionStorage.length') === 0,
      'manager page stores nothing (only the plain form\'s own key exists on this origin)');
    const res = await b.ev('performance.getEntriesByType("resource").map(r=>r.name).filter(n=>!n.startsWith("file:"))');
    ok(res.every(n => /website-files\.com/.test(n)), 'manager page sends nothing; only non-file request is the design-layer font: ' + J(res));
    ok(b.exceptions().length === 0, 'manager page: no exceptions ' + J(b.exceptions()));

    // ---- form opened from link 1 ------------------------------------------------
    await openForm(b, link1);
    // 2.5.0: a link opens on the cover, greeting the client by the name the link carries.
    ok(await b.ev('T.onCover() && document.getElementById("app").classList.contains("on-cover")'), 'form from link 1 opens on the cover');
    ok(await b.ev('(document.querySelector(".cover-hello")||{}).textContent') === "Hello Jane O'Brien,", 'cover greets the client from the link: Hello Jane O\'Brien,');
    ok(await b.ev('document.getElementById("banner").hidden'), 'no banner for a good link');
    ok(await b.ev(`localStorage.getItem("spec-form-v2:presidio-xo:link:${id1}") !== null`), 'answers saved under the link id key');
    ok(await b.ev('document.documentElement.scrollWidth') <= 390, 'form from link (cover): no overflow');
    await b.shot(path.join(SHOTS, '390-form-from-link.png'));
    // The client details are checked on Review now (no Project step).
    await b.ev('T.go("review")'); await sleep(200); await b.ev(HELP);
    ok(J(await fieldValues(b)) === J({ client: "Jane O'Brien", address: '12 Main St #4, San Leandro, CA 94577', phone: '(510) 555-0100' }), 'form from link 1: client, address, phone filled (on Review)');
    ok(await b.ev('document.documentElement.scrollWidth') <= 390, 'form from link (Review): no overflow');
    await b.ev('T.type("client","Jane O\'Brien-Smith")');
    await b.ev('T.go("permits")'); await sleep(200); await b.ev(HELP); await b.ev('T.click("permits","building")');
    await b.ev('T.go("finishes")'); await sleep(200); await b.ev(HELP); await b.ev('T.click("stain","midnight-black")');

    // re-open link 1: answers and the client's own edit kept
    await openForm(b, link1);
    ok(!(await b.ev('T.onCover()')), 're-open link 1: the cover is skipped (started)');
    ok(await b.ev('document.querySelector(".step-jump[aria-current=step]").dataset.step') === 'finishes', 're-open link 1: same step');
    ok(J(await b.ev('T.on("stain")')) === '["midnight-black"]', 're-open link 1: stain kept');
    await b.ev('T.go("review")'); await sleep(200); await b.ev(HELP);
    ok((await fieldValues(b)).client === "Jane O'Brien-Smith", 're-open link 1: client\'s edited name is NOT overwritten by the link');
    await b.ev('T.go("permits")'); await sleep(200); await b.ev(HELP);
    ok(J(await b.ev('T.on("permits")')) === '["building"]', 're-open link 1: permit kept');

    // ---- link 2 on the same device: separate answers ------------------------------
    await openForm(b, link2);
    ok(await b.ev('T.onCover() && (document.querySelector(".cover-hello")||{}).textContent === "Hello Bob Lee,"'), 'link 2 (new on this device): cover, Hello Bob Lee,');
    await b.ev('T.go("review")'); await sleep(200); await b.ev(HELP);
    ok(J(await fieldValues(b)) === J({ client: 'Bob Lee', address: '7 Oak Ave, Hayward', phone: '' }), 'form from link 2: Bob Lee filled, phone empty');
    await b.ev('T.go("permits")'); await sleep(200); await b.ev(HELP);
    ok(J(await b.ev('T.on("permits")')) === '[]', 'link 2 starts without link 1\'s answers');
    await b.ev('T.click("permits","electrical")');
    await openForm(b, link1);
    await b.ev('T.go("permits")'); await sleep(200); await b.ev(HELP);
    ok(J(await b.ev('T.on("permits")')) === '["building"]', 'link 1 unaffected by link 2');
    await openForm(b, link2);
    await b.ev('T.go("permits")'); await sleep(200); await b.ev(HELP);
    ok(J(await b.ev('T.on("permits")')) === '["electrical"]', 'link 2 keeps its own answer');

    // another link pasted into the same tab (fragment-only change) reloads with that link's answers
    await openForm(b, link1);
    await b.ev(`location.hash = ${J('#' + link2.split('#')[1])}; true`); await sleep(1500); await b.ev(HELP);
    await b.ev('T.go("review")'); await sleep(200); await b.ev(HELP);
    ok((await fieldValues(b)).client === 'Bob Lee', 'pasting link 2 over link 1 in the same tab switches to link 2');

    // plain form (no fragment) unaffected
    await openForm(b, FORM);
    await b.ev('T.go("review")'); await sleep(200); await b.ev(HELP);
    ok((await fieldValues(b)).client === 'Plain Test', 'form without a fragment keeps its own answers');
    await b.ev('T.go("permits")'); await sleep(200); await b.ev(HELP);
    ok(J(await b.ev('T.on("permits")')) === '["none"]', 'plain form answers untouched by the links');

    // broken link
    await openForm(b, FORM + '#id=x&name=Eve');
    ok(!(await b.ev('document.getElementById("banner").hidden')) && /not complete/.test(await b.ev('document.getElementById("banner").textContent')), 'broken link: banner says the link is not complete');
    await b.ev('T.go("review")'); await sleep(200); await b.ev(HELP);
    ok((await fieldValues(b)).client === 'Plain Test', 'broken link: no prefill, opens the plain form');

    // export, download, print carry the link id
    await openForm(b, link1);
    const ex = await b.ev('__specFormExport()');
    ok(ex.linkId === id1 && ex.specVersion === SPEC.specVersion && ex.answers.client === "Jane O'Brien-Smith", 'export: linkId ' + ex.linkId + ', specVersion ' + ex.specVersion);
    await b.ev('T.go("review")'); await sleep(300);
    await b.ev('document.querySelector("[data-action=download]").click();true'); await sleep(1500);
    const dl = fs.readdirSync(path.join(OUT, 'dl-link')).filter(f => f.endsWith('.json'));
    const dj = dl.length ? JSON.parse(fs.readFileSync(path.join(OUT, 'dl-link', dl[dl.length - 1]), 'utf8')) : {};
    ok(dj.linkId === id1 && dj.specVersion === SPEC.specVersion, 'downloaded JSON ' + dl[dl.length - 1] + ' has linkId and specVersion');
    await b.ev('window.dispatchEvent(new Event("beforeprint"));true');
    ok((await b.ev('[...document.querySelectorAll("#print-sheet .meta")].map(e=>e.textContent).join(" ")')).includes('Link ' + id1), 'print sheet names the link id');

    // Start a new form on a link: answers cleared, the link's client details come back
    await b.ev('window.confirm=()=>true; document.querySelector("[data-action=reset]").click(); true'); await sleep(300); await b.ev(HELP);
    const rs = await b.ev(`(()=>{const s=JSON.parse(localStorage.getItem("spec-form-v2:presidio-xo:link:${id1}")); return {client:s.answers.client, permits:s.answers.permits, stain:s.answers.stain, linkId:s.linkId};})()`);
    ok(rs.client === "Jane O'Brien" && J(rs.permits) === '[]' && rs.stain === null && rs.linkId === id1, 'Start a new form on a link: answers cleared, link details back: ' + J(rs));
    ok(await b.ev('T.onCover() && (document.querySelector(".cover-hello")||{}).textContent === "Hello Jane O\'Brien,"'), 'Start a new form on a link: back to the cover, greeting with the link name');
    pageErrors.push(...b.exceptions());
    ok(pageErrors.length === 0, 'form: no exceptions on any open ' + J(pageErrors));
  } catch (e) { log.push('FAIL exception ' + e.stack); fails++; }
  finally { b.close(); }

  // ---- laptop width ---------------------------------------------------------------
  const w = await launch(path.join(OUT, 'profile-link-wide'), 9342, { width: 1280, height: 900, mobile: false });
  try {
    await w.nav(MANAGER); await w.ev(MH);
    ok(await w.ev('innerWidth') === 1280, 'viewport is 1280 px wide');
    await makeLink(w, 'Jane Test', '12 Main St, San Leandro, CA', '');
    await w.ev('window.scrollTo(0,0);true');
    await fullShot(w, path.join(SHOTS, '1280-manager-link.png'));
    ok(w.exceptions().length === 0, 'manager at 1280: no exceptions');
  } catch (e) { log.push('FAIL exception ' + e.stack); fails++; }
  finally { w.close(); }

  log.push(fails ? fails + ' FAILED' : 'ALL PASS');
  console.log(log.join('\n')); fs.writeFileSync(path.join(OUT, 'link-log.txt'), log.join('\n'));
  process.exit(fails ? 1 : 0);
})();
