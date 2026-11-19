// "Contact your manager" on the cover (spec.cover.contact) and the manager's name, email and booking link in the personal link.
// node tests/contact.js "<Build - v3 folder>" "<scratch out folder>"
const { launch, fileUrl, sleep } = require('./cdp.js');
const path = require('path'), vm = require('vm'), fs = require('fs');
const PILOT = process.argv[2], OUT = process.argv[3];
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const J = JSON.stringify;
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

// ---- model ----------------------------------------------------------------------------------
const ctx = { console, URL }; vm.createContext(ctx);
vm.runInContext('var window=globalThis;' + fs.readFileSync(path.join(PILOT, 'spec/presidio-xo.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(PILOT, 'engine/model.js'), 'utf8'), ctx);
const S = ctx.SPEC_DATA, E = ctx.SpecEngine, C = S.cover.contact;
ok(C && C.text && C.textNamed.includes('{manager}') && C.email && C.phone && S.cover.invite, 'spec: cover.contact (text, named text, company email and phone) and cover.invite are set');
const good = { name: 'Ian Benson', email: 'Ian@wllmd.com', book: 'https://calendar.app.google/abc123' };
const hash = E.linkHash(S, 'TestLink12345678', { name: 'John Smith', address: '1 Main St' }, ['ilya@wllmd.com'], good);
ok(/&mgr=Ian%20Benson&mgremail=ian%40wllmd\.com&book=https%3A%2F%2Fcalendar\.app\.google%2Fabc123&to=/.test(hash), 'linkHash carries mgr, mgremail (lowercase) and book: ' + hash);
let L = E.readLink(S, hash);
ok(L.manager.name === 'Ian Benson' && L.manager.email === 'ian@wllmd.com' && L.manager.book === 'https://calendar.app.google/abc123' && L.values.client === 'John Smith', 'readLink gives the manager back: ' + J(L.manager));
L = E.readLink(S, '#id=TestLink12345678&name=A&mgr=Ian&mgremail=not-an-email&book=' + encodeURIComponent('javascript:alert(1)'));
ok(L.manager.name === 'Ian' && L.manager.email === '' && L.manager.book === '', 'edited link: a bad email and a javascript: address are dropped');
ok(['http://x.com/a', 'https://x', 'https://user:pw@x.com/', 'https://x.com/a b', 'data:text/html,hi', '//x.com'].every(u => E.bookUrl(u) === ''), 'bookUrl refuses http, no-dot hosts, credentials, spaces, data: and scheme-less addresses');
ok(E.readLink(S, '#id=TestLink12345678&name=A').manager.name === '' && E.linkHash(S, 'TestLink12345678', { name: 'A' }, []).indexOf('mgr') < 0, 'no manager in the link: empty manager, nothing added to the link');

// ---- pages ----------------------------------------------------------------------------------
const MANAGER = fileUrl(path.join(PILOT, 'manager.html')), FORM = fileUrl(path.join(PILOT, 'index.html'));
const SET = `window.MG = { set(p, v) { const i = document.getElementById('m-' + p); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); return true; } }; true;`;
const COVER = `(() => { const c = document.querySelector('.cover-contact'); return {
  on: document.getElementById('app').classList.contains('on-cover'),
  text: c ? c.querySelector('.cover-contact-text').textContent : null,
  ways: c ? [...c.querySelectorAll('a')].map(a => a.textContent + ' -> ' + a.getAttribute('href') + (a.target ? ' [' + a.target + ' ' + a.rel + ']' : '')) : [],
  invite: (document.querySelector('.cover-invite') || {}).textContent, button: (document.querySelector('.cover-start') || {}).textContent,
  order: [...document.querySelectorAll('main > *')].map(e => e.className.split(' ').pop()),
  w: document.documentElement.scrollWidth, tap: c ? Math.min(...[...c.querySelectorAll('a')].map(a => a.getBoundingClientRect().height)) : 0 }; })()`;
const shot = async (b, file) => {
  const hgt = await b.ev('document.documentElement.scrollHeight');
  const r = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height: hgt, scale: 1 } });
  fs.writeFileSync(path.join(OUT, 'shots', file), Buffer.from(r.result.data, 'base64'));
};

(async () => {
  const b = await launch(path.join(OUT, 'profile-contact'), 9342);
  try {
    // manager page: a bad booking link and a bad email are refused, good ones go into the link
    await b.nav(MANAGER); await b.ev(SET);
    await b.ev(`MG.set('name','John Smith'); MG.set('address','1 Governor Newsom St, Sacramento, CA'); MG.set('to','ilya@wllmd.com'); MG.set('mgr-name','Ian Benson'); MG.set('mgr-email','ian at wllmd'); MG.set('mgr-book','calendar.google.com/x'); document.querySelector('.mgr-create').click(); true`);
    await sleep(150);
    let errs = await b.ev(`[...document.querySelectorAll('.field-error')].filter(e => !e.hidden).map(e => e.id)`);
    ok(J(errs) === J(['err-mgr-email', 'err-mgr-book']) && await b.ev('document.getElementById("link-result").hidden'), 'manager page: bad manager email and booking link without https:// give errors, no link: ' + J(errs));
    await b.ev(`MG.set('mgr-email','ian@wllmd.com'); MG.set('mgr-book','https://calendar.app.google/abc123'); document.querySelector('.mgr-create').click(); true`);
    await sleep(150);
    const link = await b.ev('document.getElementById("link-out").value');
    ok(/mgr=Ian%20Benson/.test(link) && /mgremail=ian%40wllmd\.com/.test(link) && /book=https%3A%2F%2F/.test(link), 'manager page: the link carries the manager name, email and booking link');
    ok(await b.ev('document.documentElement.scrollWidth') <= 390, 'manager page: no horizontal overflow at 390 with the new fields');
    await shot(b, '390-manager-contact.png');

    // the cover of that link
    await b.nav('about:blank'); await b.nav(link); await sleep(300);
    let c = await b.ev(COVER);
    console.log('cover with a manager:', J(c));
    ok(c.on && c.text === C.textNamed.replace('{manager}', 'Ian Benson'), 'cover names the manager: ' + c.text);
    ok(J(c.ways) === J(['ian@wllmd.com -> mailto:ian@wllmd.com', (C.bookLabel || 'Book a call') + ' -> https://calendar.app.google/abc123 [_blank noopener noreferrer]']), 'cover: the manager email, then Book a call (opens in a new tab): ' + J(c.ways));
    ok(c.invite === S.cover.invite && c.button === S.cover.button, 'cover: the invitation line sits with the button: ' + c.invite + ' / ' + c.button);
    ok(c.order.indexOf('cover-contact') > c.order.indexOf('cover-text') && c.order.indexOf('cover-invite') === c.order.indexOf('cover-contact') + 1 && c.order[c.order.length - 1] === 'cover-start', 'cover order: texts, contact, invitation, button: ' + J(c.order));
    ok(c.w === 390 && c.tap >= 44, 'cover: no horizontal scroll at 390 px, contact links at least 44 px tall (' + c.tap + ')');
    await shot(b, '390-cover-manager.png');

    // a link without a manager, and the plain preview: company email and phone
    await b.nav('about:blank'); await b.nav(FORM + '#id=NoManager1234567&name=John%20Smith&address=1%20Main%20St'); await sleep(300);
    c = await b.ev(COVER);
    ok(c.text === C.text && J(c.ways) === J([C.email + ' -> mailto:' + C.email, C.phone + ' -> tel:' + C.phone.replace(/[^0-9+]/g, '')]), 'cover without a manager in the link: company email and phone: ' + J(c.ways));
    ok(c.w === 390, 'cover without a manager: no horizontal scroll at 390 px');
    await shot(b, '390-cover-company.png');

    // an edited link cannot plant a script address
    await b.nav('about:blank'); await b.nav(FORM + '#id=EditedLink123456&name=John%20Smith&mgr=Ian&mgremail=ian%40wllmd.com&book=' + encodeURIComponent('javascript:alert(1)')); await sleep(300);
    c = await b.ev(COVER);
    ok(c.ways.length === 2 && c.ways[1].indexOf('tel:') > 0 && !c.ways.some(w => /javascript/i.test(w)), 'edited link with a javascript: booking address: no such link on the page, the phone is shown instead: ' + J(c.ways));

    await b.ev('document.querySelector(".cover-start").click();true'); await sleep(300);
    ok(!(await b.ev('document.getElementById("app").classList.contains("on-cover")')), '"' + S.cover.button + '" still opens the first step');
    console.log('exceptions:', J(b.exceptions()));
    ok(b.exceptions().length === 0, 'no page exceptions');
  } finally { await b.close(); }
  console.log(fails ? 'FAILS: ' + fails : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
