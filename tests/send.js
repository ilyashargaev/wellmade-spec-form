// Phase 4: manager recipients -> link -> form -> Send to Wellmade, against a local mock receiver.
// node tests/send.js "<Build - Pilot folder>" "<scratch out folder>"
//
// Two local servers, two origins (so the send is cross-origin, as on the real site):
//   site  http://127.0.0.1:8471  serves Build - Pilot; /site-config.js is replaced by the test's settings.
//   mock  http://127.0.0.1:8472  behaves like an Apps Script web app: POST /exec -> 302 to /echo?id=...,
//         GET /echo -> the JSON answer with Access-Control-Allow-Origin: *. In "ok" mode it runs the real
//         receiver/Code.gs (Google services stubbed by tests/gas-stubs.js), so the email and log it would
//         make are checked too.
// Headless Chrome over CDP, viewport 390 x 844 mobile (innerWidth asserted).
const http = require('http'), fs = require('fs'), path = require('path');
const { launch, sleep } = require('./cdp.js');
const { load } = require('./gas-stubs.js');
const PILOT = process.argv[2], OUT = process.argv[3];
const SHOTS = path.join(PILOT, 'screenshots');
const HELP = fs.readFileSync(path.join(__dirname, 'helpers.js'), 'utf8');
const SPEC = JSON.parse(fs.readFileSync(path.join(PILOT, 'spec', 'presidio-xo.json'), 'utf8'));
const SITE_PORT = 8471, MOCK_PORT = 8472;
const SITE = 'http://127.0.0.1:' + SITE_PORT, MOCK = 'http://127.0.0.1:' + MOCK_PORT;
const log = []; let fails = 0;
function ok(c, m) { log.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
const J = JSON.stringify;
fs.mkdirSync(OUT, { recursive: true });

// ---- site server ------------------------------------------------------------------
let siteConfig = null; // null = serve the real site-config.js; 'missing' = 404; else an object
const siteHits = [];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const site = http.createServer((req, res) => {
  const u = new URL(req.url, SITE);
  siteHits.push(req.method + ' ' + u.pathname);
  if (u.pathname === '/site-config.js' && siteConfig !== null) {
    if (siteConfig === 'missing') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
    return res.end('window.SITE_CONFIG = ' + J(siteConfig) + ';');
  }
  const file = path.join(PILOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
  if (!file.startsWith(PILOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

// ---- mock receiver -------------------------------------------------------------------
const gas = load({ pilot: PILOT }); gas.setup();
const mock = { mode: 'ok', delay: 0, posts: [], preflights: 0, answers: new Map(), n: 0 };
const sockets = new Set();
function mockHandler(req, res) {
  const u = new URL(req.url, MOCK);
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'OPTIONS') { mock.preflights++; res.writeHead(204, cors); return res.end(); }
  if (req.method === 'GET' && u.pathname === '/echo') {
    const a = mock.answers.get(u.searchParams.get('id'));
    if (!a) { res.writeHead(404, cors); return res.end(); }
    res.writeHead(200, Object.assign({ 'Content-Type': a.type }, cors));
    return res.end(a.body);
  }
  if (req.method === 'POST' && u.pathname === '/exec') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      mock.posts.push({ type: req.headers['content-type'], origin: req.headers.origin, body });
      if (mock.delay) await sleep(mock.delay);
      let a;
      if (mock.mode === 'ok') a = { type: 'application/json', body: gas.doPost({ postData: { contents: body } }).getContent() };
      else if (mock.mode === 'fail') a = { type: 'application/json', body: J({ ok: false, error: 'mail_failed' }) };
      else if (mock.mode === 'rate') a = { type: 'application/json', body: J({ ok: false, error: 'rate_limited' }) };
      else a = { type: 'text/html', body: '<html><body>Script function not found: doPost</body></html>' };
      const id = 'r' + (++mock.n);
      mock.answers.set(id, a);
      res.writeHead(302, Object.assign({ Location: MOCK + '/echo?id=' + id }, cors));
      res.end();
    });
    return;
  }
  res.writeHead(404, cors); res.end();
}
let mockServer;
function startMock() {
  return new Promise(r => {
    mockServer = http.createServer(mockHandler);
    mockServer.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    mockServer.listen(MOCK_PORT, '127.0.0.1', r);
  });
}
function stopMock() { return new Promise(r => { sockets.forEach(s => s.destroy()); mockServer.close(() => r()); }); }

// ---- page helpers ----------------------------------------------------------------------
const MH = `window.MG = {
  set(p, v) { const i = document.getElementById('m-' + p); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); return true; },
  create() { document.querySelector('.mgr-create').click(); return true; },
  state() { return {
    errors: [...document.querySelectorAll('.field-error')].filter(e => !e.hidden).map(e => e.id + ':' + e.textContent),
    shown: !document.getElementById('link-result').hidden, link: document.getElementById('link-out').value,
    focus: document.activeElement && document.activeElement.id } }
}; true;`;
const SENDSTATE = `(() => { const p = document.getElementById('send-panel'), b = document.getElementById('send-btn');
  return { panel: p ? p.className : null, title: p && p.querySelector('.send-title') ? p.querySelector('.send-title').textContent : '',
    text: p ? p.textContent : '', btn: b ? b.textContent : null, btnDisabled: b ? b.disabled : null,
    h1: (document.querySelector('main h1') || {}).textContent, retry: !!document.getElementById('send-retry') }; })()`;

async function fullShot(b, file) {
  const hgt = await b.ev('document.documentElement.scrollHeight');
  const r = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: await b.ev('innerWidth'), height: hgt, scale: 1 } });
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
}
async function waitFor(b, expr, ms) {
  for (let t = 0; t < (ms || 15000); t += 100) { if (await b.ev(expr)) return true; await sleep(100); }
  return false;
}
const pageErrors = [];
async function open(b, url) { pageErrors.push(...b.exceptions()); await b.nav('about:blank'); await b.nav(url); await b.ev(HELP); }
async function toReview(b) { await b.ev('T.go("review")'); await sleep(300); await b.ev(HELP); }

(async () => {
  await new Promise(r => site.listen(SITE_PORT, '127.0.0.1', r));
  await startMock();
  siteConfig = { submitUrl: MOCK + '/exec', allowedDomains: ['wllmd.com'] };
  const b = await launch(path.join(OUT, 'profile-send'), 9351);
  try {
    // ---- manager page: recipients ------------------------------------------------------
    await b.nav(SITE + '/manager.html'); await b.ev('localStorage.clear();true'); await b.ev(MH);
    ok(await b.ev('innerWidth') === 390, 'viewport is 390 px wide');
    const help = await b.ev('document.getElementById("help-to").textContent');
    ok(/emailed to these addresses/.test(help) && /@wllmd\.com/.test(help), 'recipients field helper text: ' + help);
    ok(await b.ev('document.getElementById("m-to").getAttribute("inputmode")') === 'email', 'recipients input uses the email keyboard');
    const fill = async (to) => { await b.ev(`MG.set('name', "Jane O'Brien & <Co>"); MG.set('address', '12 Main St #4, San Leandro, CA'); MG.set('phone', '(510) 555-0100'); MG.set('to', ${J(to)}); MG.create()`); await sleep(150); return b.ev('MG.state()'); };
    let st = await fill('');
    ok(J(st.errors) === J(['err-to:Send results to is required.']) && !st.shown && st.focus === 'm-to', 'empty recipients: required error, focus there');
    st = await fill('ilya@wllmd.com, bob@gmail.com');
    ok(J(st.errors) === J(['err-to:“bob@gmail.com” is not allowed: only @wllmd.com addresses.']) && !st.shown, 'invalid domain named: ' + J(st.errors));
    await fullShot(b, path.join(SHOTS, '390-manager-recipients-error.png'));
    st = await fill('ilya@wllmd');
    ok(J(st.errors) === J(['err-to:“ilya@wllmd” is not a valid email address.']) && !st.shown, 'malformed address named: ' + J(st.errors));
    st = await fill('x@gmail.com, y@yahoo.com');
    ok(/x@gmail\.com.*\(and 1 more\)/.test(st.errors[0] || ''), 'several bad: first named, rest counted: ' + st.errors[0]);
    st = await fill('Ilya@WLLMD.com, kirill@wllmd.com');
    ok(st.shown && !st.errors.length, 'two good addresses (mixed case): link made');
    const link1 = st.link;
    const frag = new URLSearchParams(link1.split('#')[1]);
    ok(frag.get('to') === 'ilya@wllmd.com,kirill@wllmd.com' && !/[@,]/.test(link1.split('#')[1]), 'link carries to=ilya@wllmd.com,kirill@wllmd.com (lowercase, encoded)');
    await b.ev('MG.set("to","ilya@wllmd.com; kirill@wllmd.com")');
    ok(!(await b.ev('MG.state()')).shown, 'editing recipients hides the old link');
    await b.ev('MG.create()'); await sleep(150);
    await b.ev('window.scrollTo(0,0);true');
    await fullShot(b, path.join(SHOTS, '390-manager-recipients.png'));
    ok(await b.ev('document.documentElement.scrollWidth') <= 390, 'manager page: no horizontal overflow');
    ok(mock.posts.length === 0, 'manager page sends nothing to the receiver');
    const id1 = frag.get('id');

    // ---- form from the link: Review with Send ---------------------------------------------
    await open(b, link1);
    await b.ev('T.go("permits")'); await sleep(200); await b.ev(HELP); await b.ev('T.click("permits","building")');
    await b.ev('T.go("finishes")'); await sleep(200); await b.ev(HELP); await b.ev('T.click("stain","midnight-black");T.click("decking","trex-transcend-spiced-rum")');
    await toReview(b);
    let s = await b.ev(SENDSTATE);
    ok(s.btn === 'Send to Wellmade' && !s.btnDisabled && /Ready to send/.test(s.title), 'Review: Send to Wellmade in the bar, "Ready to send?" panel');
    ok(await b.ev('document.querySelectorAll(".keep-copy [data-action=print], .keep-copy [data-action=download]").length') === 2, 'Review: Print and Download JSON kept (Keep a copy)');
    ok(await b.ev('document.documentElement.scrollWidth') <= 390, 'Review: no horizontal overflow');
    await b.shot(path.join(SHOTS, '390-review-send.png'));
    ok(mock.posts.length === 0 && mock.preflights === 0, 'nothing sent before the button (receiver saw 0 requests)');

    // ---- send 1 (slow, to see the Sending state) --------------------------------------------
    mock.mode = 'ok'; mock.delay = 2500;
    await b.ev('document.getElementById("send-btn").click();true'); await sleep(400);
    s = await b.ev(SENDSTATE);
    ok(s.btn === 'Sending…' && s.btnDisabled && /is-sending/.test(s.panel) && /up to 20 seconds/.test(s.text), 'Sending state: button disabled "Sending…", panel says so');
    await b.ev('document.getElementById("send-btn").click();true'); // a second tap while sending is ignored
    await b.shot(path.join(SHOTS, '390-sending.png'));
    ok(await waitFor(b, 'document.querySelector("main h1") && document.querySelector("main h1").textContent === "Sent to Wellmade"'), 'confirmation screen shown');
    mock.delay = 0;
    ok(mock.posts.length === 1 && mock.preflights === 0, 'one POST, no CORS preflight (double tap ignored)');
    ok(/^text\/plain;\s*charset=utf-8$/i.test(mock.posts[0].type), 'sent as text/plain;charset=utf-8: ' + mock.posts[0].type);
    const pay = JSON.parse(mock.posts[0].body);
    const ref1 = JSON.parse(gas.mails.length ? mock.answers.get('r1').body : '{}').submissionId;
    ok(pay.specId === SPEC.specId && pay.specVersion === SPEC.specVersion && pay.linkId === id1, 'payload: specId, specVersion, linkId');
    ok(J(pay.recipients) === J(['ilya@wllmd.com', 'kirill@wllmd.com']) && !isNaN(Date.parse(pay.sentAt)) && /Z$/.test(pay.sentAt), 'payload: recipients from the link, sentAt ISO');
    ok(J(pay.client.map(c => [c.param, c.value])) === J([['name', "Jane O'Brien & <Co>"], ['address', '12 Main St #4, San Leandro, CA'], ['phone', '(510) 555-0100']]), 'payload: client fields');
    ok(pay.answers.stain === 'midnight-black' && J(pay.answers.permits) === J(['building']), 'payload: raw answers');
    const deck = pay.summary.flatMap(x => x.answers).find(r => r.id === 'decking');
    const ext = pay.summary.flatMap(x => x.answers).find(r => r.id === 'interior');
    ok(deck && deck.options[0].label === 'Trex Transcend – Spiced Rum' && deck.options[0].tag === 'Additional cost', 'payload summary: option label with its fixed tag: ' + J(deck && deck.options));
    ok(ext && ext.options.length === 3 && ext.options.every(o => o.tag === 'Included'), 'payload summary: rule tags (base interior outlets Included)');
    ok(Array.isArray(pay.openQuestions) && pay.openQuestions.length > 0 && pay.openQuestions[0].question, 'payload: unanswered list (' + pay.openQuestions.length + ')');
    ok(J(Object.keys(pay).sort()) === J(Object.keys(await b.ev('__specFormExport()')).concat(['client', 'recipients', 'sentAt']).sort()), 'payload = the export + client, recipients, sentAt (one serializer)');
    const facts = await b.ev('[...document.querySelectorAll(".sent-facts dt")].map((d,i)=>[d.textContent, document.querySelectorAll(".sent-facts dd")[i].textContent])');
    ok(facts.find(f => f[0] === 'Reference')[1] === ref1 && facts.find(f => f[0] === 'Client name')[1] === "Jane O'Brien & <Co>", 'confirmation: reference ' + ref1 + ' and client details');
    ok(/reopen this same link, change answers and send again/.test(await b.ev('document.getElementById("sent-again").textContent')), 'confirmation: "reopen this same link ... the latest one counts"');
    ok(await b.ev('document.documentElement.scrollWidth') <= 390, 'confirmation: no horizontal overflow');
    await fullShot(b, path.join(SHOTS, '390-sent.png'));
    // what the receiver did with it
    const mail1 = gas.mails[gas.mails.length - 1];
    ok(mail1.to === 'ilya@wllmd.com,kirill@wllmd.com' && mail1.noReply === true, 'receiver: emailed both link recipients, noReply');
    ok(mail1.subject === "Spec form: Jane O'Brien & <Co> — 12 Main St #4, San Leandro, CA · " + SPEC.model + ' · v' + SPEC.specVersion, 'receiver subject: ' + mail1.subject);
    ok(mail1.htmlBody.includes('Jane O&#39;Brien &amp; &lt;Co&gt;') && !mail1.htmlBody.includes('<Co>'), 'receiver HTML: client text escaped');
    ok(mail1.body.includes('Trex Transcend – Spiced Rum — Additional cost') && mail1.body.includes('Link id: ' + id1), 'receiver text: answers with tags, link id');
    ok(/\n  Additions: None\n/.test(mail1.body) && /\n  Connection: Not answered\n/.test(mail1.body), 'receiver text: empty optional = "None", empty required = "Not answered" (as on Review)');
    const log1 = gas.logs[gas.logs.length - 1];
    ok(JSON.parse(log1.content).rawBody === mock.posts[0].body && log1.name.includes('_' + id1 + '_'), 'receiver log: raw body kept byte for byte, file ' + log1.name);
    fs.writeFileSync(path.join(OUT, 'mail-1.txt'), mail1.subject + '\n\n' + mail1.body);
    fs.writeFileSync(path.join(OUT, 'mail-1.html'), mail1.htmlBody);
    const saved = await b.ev(`JSON.parse(localStorage.getItem("spec-form:presidio-xo:link:${id1}")).sent`);
    ok(saved && saved.submissionId === ref1 && saved.at === pay.sentAt, 'sent time and reference remembered on the device');

    // ---- back, change, send again ------------------------------------------------------------
    await b.ev('document.querySelector(".bar [data-step=review]").click();true'); await sleep(300);
    s = await b.ev(SENDSTATE);
    ok(/is-sent/.test(s.panel) && s.text.includes(ref1) && s.btn === 'Send again', 'Review after sending: "Sent to Wellmade", reference, button "Send again"');
    await open(b, link1); // reopen the same link later
    await toReview(b);
    s = await b.ev(SENDSTATE);
    ok(/is-sent/.test(s.panel) && s.text.includes(ref1), 'reopened link: still shows it was sent, with the reference');
    await b.ev('T.go("finishes")'); await sleep(200); await b.ev(HELP); await b.ev('T.click("decking","trex-select-pebble-grey")');
    await toReview(b);
    s = await b.ev(SENDSTATE);
    ok(/is-changed/.test(s.panel) && s.title === 'Changed since you sent — send again', 'changed after sending: "Changed since you sent — send again"');
    await b.shot(path.join(OUT, '390-review-changed.png'));
    await b.ev('document.getElementById("send-btn").click();true');
    ok(await waitFor(b, 'document.querySelector("main h1").textContent === "Sent to Wellmade"'), 'second send: confirmation');
    const ref2 = (await b.ev('[...document.querySelectorAll(".sent-facts dd")][1].textContent'));
    ok(mock.posts.length === 2 && ref2 !== ref1 && JSON.parse(mock.posts[1].body).answers.decking === 'trex-select-pebble-grey', 'second send: new reference ' + ref2 + ', new answer in the payload');
    ok(gas.mails.length === 2 && gas.logs.length === 2, 'receiver: 2 emails, 2 log files');

    // ---- receiver says ok:false -> error + retry -----------------------------------------------
    await b.ev('document.querySelector(".bar [data-step=review]").click();true'); await sleep(300);
    await b.ev('T.go("finishes")'); await sleep(200); await b.ev(HELP); await b.ev('T.click("stain","stone-gray")');
    await toReview(b);
    mock.mode = 'fail';
    await b.ev('document.getElementById("send-btn").click();true');
    ok(await waitFor(b, '!!document.getElementById("send-retry")'), 'ok:false: error panel with Retry');
    s = await b.ev(SENDSTATE);
    ok(/is-error/.test(s.panel) && /did not accept the answers \(mail_failed\)/.test(s.text) && /still here on this device/.test(s.text) && !s.btnDisabled, 'ok:false message: ' + s.text.slice(0, 120));
    ok(await b.ev('document.activeElement && document.activeElement.id') === 'send-panel', 'error panel takes focus (screen readers)');
    ok(await b.ev(`JSON.parse(localStorage.getItem("spec-form:presidio-xo:link:${id1}")).answers.stain`) === 'stone-gray', 'answers untouched after a failed send');
    await b.ev('window.scrollTo(0,0);true'); await b.ev('document.getElementById("send-panel").scrollIntoView({block:"center"});true');
    await b.shot(path.join(SHOTS, '390-send-error.png'));
    mock.mode = 'ok';
    await b.ev('document.getElementById("send-retry").click();true');
    ok(await waitFor(b, 'document.querySelector("main h1").textContent === "Sent to Wellmade"'), 'Retry after the receiver recovers: sent');
    ok(JSON.parse(mock.posts[mock.posts.length - 1].body).answers.stain === 'stone-gray', 'retry carries the current answers');

    // rate limited and a non-JSON reply
    await b.ev('document.querySelector(".bar [data-step=review]").click();true'); await sleep(300);
    mock.mode = 'rate';
    await b.ev('document.getElementById("send-btn").click();true');
    ok(await waitFor(b, '!!document.getElementById("send-retry")') && /Too many sends/.test((await b.ev(SENDSTATE)).text), 'rate_limited: "Too many sends from this link for now"');
    mock.mode = 'html';
    await b.ev('document.getElementById("send-retry").click();true'); await sleep(200);
    ok(await waitFor(b, '/unexpected reply/.test((document.getElementById("send-error")||{}).textContent||"")'), 'HTML instead of JSON: "unexpected reply"');

    // ---- receiver down ------------------------------------------------------------------------
    mock.mode = 'ok';
    await stopMock();
    const before = mock.posts.length;
    await b.ev('document.getElementById("send-retry").click();true');
    ok(await waitFor(b, '/Could not reach Wellmade/.test((document.getElementById("send-error")||{}).textContent||"")'), 'receiver down: "Could not reach Wellmade" + Retry');
    await b.reload(); await b.ev(HELP);
    s = await b.ev(SENDSTATE);
    ok(await b.ev('T.on("stain").join()') === '' && (await b.ev(`JSON.parse(localStorage.getItem("spec-form:presidio-xo:link:${id1}")).answers.stain`)) === 'stone-gray', 'after reload: answers kept on the device');
    ok(/is-sent/.test(s.panel) || /is-changed/.test(s.panel), 'after reload: last successful send still remembered (' + s.panel + ')');
    await startMock();
    ok(mock.posts.length === before, 'nothing reached the receiver while it was down');

    // ---- timeout ------------------------------------------------------------------------------
    siteConfig = { submitUrl: MOCK + '/exec', allowedDomains: ['wllmd.com'], sendTimeoutMs: 1500 };
    await b.reload(); await b.ev(HELP);
    mock.delay = 4000;
    await b.ev('T.go("finishes")'); await sleep(200); await b.ev(HELP); await b.ev('T.click("stain","midnight-black")');
    await toReview(b);
    await b.ev('document.getElementById("send-btn").click();true');
    ok(await waitFor(b, '/did not answer in time/.test((document.getElementById("send-error")||{}).textContent||"")', 6000), 'timeout (1.5 s in this test, 25 s by default): "did not answer in time"');
    mock.delay = 0; await sleep(3000);
    ok(!(await b.ev('document.querySelector("main h1").textContent === "Sent to Wellmade"')), 'a late answer after the timeout does not flip the page');

    // ---- tampered link and the plain form --------------------------------------------------------
    siteConfig = { submitUrl: MOCK + '/exec', allowedDomains: ['wllmd.com'] };
    const tampered = SITE + '/index.html#id=TamperedLink0001&name=Eve&address=1%20Elm&to=' + encodeURIComponent('evil@gmail.com,kirill@wllmd.com');
    await open(b, tampered); await toReview(b);
    await b.ev('document.getElementById("send-btn").click();true');
    await waitFor(b, 'document.querySelector("main h1").textContent === "Sent to Wellmade"');
    let mail = gas.mails[gas.mails.length - 1];
    ok(J(JSON.parse(mock.posts[mock.posts.length - 1].body).recipients) === J(['evil@gmail.com', 'kirill@wllmd.com']) && mail.to === 'kirill@wllmd.com' && mail.body.includes('evil@gmail.com (domain not allowed)'),
      'edited link with a foreign address: the form passes it on, the receiver drops it and names it in the footer');
    // bare address and a broken link on the web: the 'how to get your link' screen, no form
    await open(b, SITE + '/');
    ok(await b.ev('!document.getElementById("send-btn") && !document.querySelector(".step-jump") && /How to start/.test(document.querySelector("main").textContent) && !document.querySelector(".nolink-warn")'), 'bare address: "how to get your link" screen, no form');
    await open(b, SITE + '/index.html#id=bad');
    ok(await b.ev('!document.querySelector(".step-jump") && /not complete/.test((document.querySelector(".nolink-warn")||{}).textContent||"")'), 'broken link: same screen plus "This link is not complete"');
    await open(b, SITE + '/index.html?preview'); await toReview(b);
    await b.ev('document.getElementById("send-btn").click();true');
    await waitFor(b, 'document.querySelector("main h1").textContent === "Sent to Wellmade"');
    mail = gas.mails[gas.mails.length - 1];
    const plain = JSON.parse(mock.posts[mock.posts.length - 1].body);
    ok(plain.linkId === null && J(plain.recipients) === '[]' && mail.to === 'ilya@wllmd.com', 'plain form (no link): no recipients -> receiver default address');
    ok(/come back to this page/.test(await b.ev('document.getElementById("sent-again").textContent')), 'plain form confirmation wording');

    // ---- sending not set up ---------------------------------------------------------------------
    // Since 2026-11-16 the shipped site-config.js holds the live receiver URL, so "not set up" is served as a config object.
    const real = fs.readFileSync(path.join(PILOT, 'site-config.js'), 'utf8');
    ok(/submitUrl:\s*"https:\/\/script\.google\.com\/macros\/s\/[^"]+\/exec"/.test(real), 'shipped site-config.js points at an Apps Script /exec URL');
    siteConfig = { submitUrl: '', allowedDomains: ['wllmd.com'] };
    const postsBefore = mock.posts.length;
    await open(b, link1); await toReview(b);
    ok(await b.ev('!document.getElementById("send-btn") && !document.getElementById("send-panel")'), 'empty submitUrl: no Send button');
    ok(await b.ev('document.querySelectorAll(".bar [data-action=print], .bar [data-action=download]").length') === 2, 'empty submitUrl: Print and Download JSON in the bar as before');
    ok(/not set up yet/.test(await b.ev('document.getElementById("send-off").textContent')), 'empty submitUrl: one quiet line on Review');
    await b.shot(path.join(OUT, '390-review-not-set-up.png'));
    siteConfig = 'missing';
    await open(b, link1); await toReview(b);
    ok(await b.ev('!document.getElementById("send-btn") && !!document.getElementById("send-off")') && b.exceptions().length === 0, 'site-config.js missing: form still works, no Send, no errors');
    await b.nav(SITE + '/manager.html'); await b.ev(MH);
    await b.ev(`MG.set('name','A'); MG.set('address','B'); MG.set('to','ilya@wllmd.com'); MG.create()`); await sleep(150);
    ok(/site-config\.js/.test((await b.ev('MG.state()')).errors.join()), 'site-config.js missing: manager page says so instead of making a link');
    ok(mock.posts.length === postsBefore, 'no request to the receiver without a button press');
    ok(!siteHits.some(h => /^POST/.test(h)), 'the site host never receives a POST');
    pageErrors.push(...b.exceptions());
    ok(pageErrors.length === 0, 'no page exceptions ' + J(pageErrors));
    ok(gas.errors.length === 0, 'receiver code logged no errors ' + J(gas.errors));
  } catch (e) { log.push('FAIL exception ' + e.stack); fails++; }
  finally { b.close(); site.close(); try { await stopMock(); } catch (e) { /* already stopped */ } }

  log.push(fails ? fails + ' FAILED' : 'ALL PASS');
  console.log(log.join('\n')); fs.writeFileSync(path.join(OUT, 'send-log.txt'), log.join('\n'));
  process.exit(fails ? 1 : 0);
})();
