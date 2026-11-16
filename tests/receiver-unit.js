// Unit tests of receiver/Code.gs in Node, with stubbed Google services (tests/gas-stubs.js).
// node tests/receiver-unit.js "<Build - Pilot folder>"
const { load } = require('./gas-stubs.js');
const PILOT = process.argv[2] || require('path').join(__dirname, '..');
const log = []; let fails = 0;
function ok(c, m) { log.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
const J = JSON.stringify;

function payload(extra) {
  return Object.assign({
    specId: 'presidio-xo', specVersion: '1.2.0', linkId: 'Xzg-sV0FNqTeQRL7', model: 'Presidio, door on the left (XO)',
    sentAt: '2026-11-15T23:04:05.000Z', recipients: ['ilya@wllmd.com'],
    client: [
      { param: 'name', label: 'Client name', question: 'client', value: "Jane O'Brien <script>alert(1)</script>" },
      { param: 'address', label: 'Address', question: 'address', value: '12 Main St #4 & Co, San Leandro' },
      { param: 'phone', label: 'Phone', question: 'phone', value: '' }
    ],
    summary: [
      { section: 'Electrical', answers: [
        { id: 'exterior', question: 'Exterior outlets', answer: 'E1 — Extra charge; E4 — Included', inactive: false,
          options: [{ id: 'e1', label: 'E1', tag: 'Extra charge' }, { id: 'e4', label: 'E4', tag: 'Included' }] },
        { id: 'skylightLoc', question: 'Skylight location', answer: '', inactive: true, options: [] },
        { id: 'stain', question: 'Stain', answer: '', inactive: false, options: [] }
      ] },
      { section: 'Notes', answers: [{ id: 'comments', question: 'Comments', answer: 'Line 1\n<b>bold?</b>', inactive: false },
        { id: 'extra', question: 'Additions', answer: '', inactive: false, optional: true }] }
    ],
    openQuestions: [{ section: 'Finishes', question: 'Stain', id: 'stain' }],
    answers: { exterior: ['e1'], stain: null, comments: 'Line 1\n<b>bold?</b>' }
  }, extra || {});
}

const g = load({ pilot: PILOT });

// ---- recipients -----------------------------------------------------------------
let r = g.resolveRecipients_(['Ilya@WLLMD.com', 'ilya@wllmd.com', ' kirill@wllmd.com '], ['wllmd.com'], 10, ['ilya@wllmd.com']);
ok(J(r.to) === J(['ilya@wllmd.com', 'kirill@wllmd.com']) && !r.dropped.length && !r.usedDefault, 'recipients: lowercase, trimmed, no repeats: ' + J(r.to));
r = g.resolveRecipients_(['bob@gmail.com', 'ilya@wllmd', 'x@sub.wllmd.com', 'ilya@wllmd.com.evil.io', 'a@wllmd.com'], ['wllmd.com'], 10, ['ilya@wllmd.com']);
ok(J(r.to) === J(['a@wllmd.com']), 'recipients: only exact allowed domain kept: ' + J(r.to));
ok(J(r.dropped.map(d => d.reason)) === J(['domain not allowed', 'not a valid address', 'domain not allowed', 'domain not allowed']), 'recipients: each dropped address with a reason: ' + J(r.dropped));
r = g.resolveRecipients_(['evil@gmail.com'], ['wllmd.com'], 10, ['ilya@wllmd.com']);
ok(J(r.to) === J(['ilya@wllmd.com']) && r.usedDefault && r.dropped.length === 1, 'recipients: none allowed -> DEFAULT_TO, dropped reported');
r = g.resolveRecipients_([], ['wllmd.com'], 10, ['ilya@wllmd.com']);
ok(J(r.to) === J(['ilya@wllmd.com']) && r.usedDefault && !r.dropped.length, 'recipients: empty -> DEFAULT_TO');
r = g.resolveRecipients_('a@wllmd.com,b@wllmd.com', ['wllmd.com'], 10, []);
ok(J(r.to) === J(['a@wllmd.com', 'b@wllmd.com']), 'recipients: a comma string is accepted too');
r = g.resolveRecipients_([{ x: 1 }, 42, null, 'c@wllmd.com'], ['wllmd.com'], 10, []);
ok(J(r.to) === J(['c@wllmd.com']), 'recipients: non-strings ignored');
const many = Array.from({ length: 13 }, (_, i) => 'u' + i + '@wllmd.com');
r = g.resolveRecipients_(many, ['wllmd.com'], 10, []);
ok(r.to.length === 10 && r.dropped.length === 3 && /more than 10/.test(r.dropped[0].reason), 'recipients: at most 10, the rest dropped');
r = g.resolveRecipients_(['a@wllmd.com, evil@x.com; b@wllmd.com'], ['wllmd.com', 'example.org'], 10, []);
ok(J(r.to) === J(['a@wllmd.com', 'b@wllmd.com']) && r.dropped[0].address === 'evil@x.com', 'recipients: one item holding several addresses is split');
ok(g.resolveRecipients_(['"a b"@wllmd.com', 'a@b@wllmd.com', 'a @wllmd.com', 'a@-wllmd.com'], ['wllmd.com'], 10, []).to.join() === '', 'recipients: malformed addresses never pass');

// ---- escaping, subject, bodies ---------------------------------------------------------
ok(g.escapeHtml_(`<a href="x">'&'</a>`) === '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;', 'escapeHtml_: & < > " \'');
const p = payload();
const subj = g.buildSubject_(p);
ok(subj === "Spec form: Jane O'Brien <script>alert(1)</script> — 12 Main St #4 & Co, San Leandro · Presidio, door on the left (XO) · v1.2.0", 'subject: client, address, model from payload, version: ' + subj);
ok(g.buildSubject_(payload({ client: [] })).startsWith('Spec form: No name — no address'), 'subject without client details');
ok(!/[\r\n]/.test(g.buildSubject_(payload({ model: 'A\nB', client: [{ param: 'name', value: 'X\r\nBcc: e@x.com' }] }))), 'subject: no line breaks');
const now = new Date('2026-11-15T23:04:09Z');
const meta = { submissionId: '20261115-230409-ABC123', receivedAt: now, linkId: p.linkId, logUrl: 'https://drive.example/file/x?a=1&b=2',
  recipients: { to: ['ilya@wllmd.com'], dropped: [{ address: 'evil@gmail.com', reason: 'domain not allowed' }], usedDefault: false }, allowedDomains: ['wllmd.com'] };
const text = g.buildText_(p, meta);
ok(text.includes('Client name: Jane O\'Brien <script>alert(1)</script>') && text.includes('Address: 12 Main St #4 & Co, San Leandro') && !text.includes('Phone:'),
  'text body: client fields, empty phone left out');
ok(text.includes('Link id: Xzg-sV0FNqTeQRL7') && text.includes('Sent: Sun, Nov 15, 2026 at 3:04 PM PST') && text.includes('Received: Sun, Nov 15, 2026 at 3:04 PM PST'),
  'text body: link id; times in America/Los_Angeles');
ok(text.includes('Spec: presidio-xo v1.2.0') && text.includes('Reference: 20261115-230409-ABC123'), 'text body: spec version and reference');
ok(text.includes('Unanswered (1)') && text.includes('  - Finishes — Stain'), 'text body: unanswered list');
ok(text.includes('ELECTRICAL') && text.includes('  Exterior outlets: E1 — Extra charge; E4 — Included') && text.includes('  Skylight location: Not used') && text.includes('  Stain: Not answered'),
  'text body: answers by section with tags; unused and open marked');
ok(text.includes('  Comments: Line 1\n      <b>bold?</b>'), 'text body: multi-line comment indented');
ok(text.includes('  Additions: None'), 'text body: an empty optional question reads "None", as on Review');
ok(text.includes('Not sent to these addresses from the link (only @wllmd.com addresses are used): evil@gmail.com (domain not allowed).') && text.includes('Raw submission kept in the log: https://drive.example/file/x?a=1&b=2'),
  'text body footer: dropped address named, log link');
const html = g.buildHtml_(p, meta);
ok(!/<script>|<b>bold/.test(html) && html.includes('Jane O&#39;Brien &lt;script&gt;alert(1)&lt;/script&gt;') && html.includes('Line 1<br>&lt;b&gt;bold?&lt;/b&gt;'), 'html body: all client text escaped; line breaks kept');
ok(html.includes('<a href="https://drive.example/file/x?a=1&amp;b=2">'), 'html body: log link escaped');
const evil = payload({ summary: [{ section: '<img src=x onerror=alert(1)>', answers: [{ question: '<i>q</i>', options: [{ label: '<u>o</u>', tag: '<s>t</s>' }] }] }], model: '<b>m</b>' });
const eh = g.buildHtml_(evil, meta);
ok(!/<img|<i>|<u>|<s>|<b>m/.test(eh), 'html body: section, question, option, tag and model text escaped too');
const junk = payload({ summary: 'x', openQuestions: [null, 5, { question: 'Q' }], client: 'nope' });
ok(typeof g.buildText_(junk, meta) === 'string' && typeof g.buildHtml_(junk, meta) === 'string', 'odd payload shapes do not throw');

// ---- parse ---------------------------------------------------------------------------
ok(g.parseSubmission_('', 300000).error === 'empty', 'parse: empty');
ok(g.parseSubmission_('{', 300000).error === 'bad_json', 'parse: bad JSON');
ok(g.parseSubmission_('[1]', 300000).error === 'bad_json', 'parse: array');
ok(g.parseSubmission_('{"answers":{}}', 300000).error === 'missing_specId', 'parse: no specId');
ok(g.parseSubmission_('{"specId":"x"}', 300000).error === 'missing_answers', 'parse: no answers');
ok(g.parseSubmission_(J({ specId: 'x', answers: {}, pad: 'é'.repeat(160000) }), 300000).error === 'too_large', 'parse: > 300 KB counted in UTF-8 bytes');
ok(g.parseSubmission_(J(p), 300000).ok, 'parse: a good payload');
ok(/^\d{8}T\d{6}Z_Xzg-sV0FNqTeQRL7_ABC123\.json$/.test(g.logFileName_(now, 'Xzg-sV0FNqTeQRL7', 'ABC123')) && g.logFileName_(now, null, 'ABC123') === '20261115T230409Z_no-link_ABC123.json',
  'log file name: <UTC timestamp>_<link id or no-link>_<random>.json');

// ---- whole path with stubs -------------------------------------------------------------
const h = load({ pilot: PILOT });
const out = h.doPost({ postData: { contents: J(p) } });
ok(out.mime === 'application/json' && JSON.parse(out.content).ok === false && JSON.parse(out.content).error === 'not_set_up', 'before setup(): JSON error not_set_up, nothing sent');
const setupLines = h.setup();
ok(h.props.get('ALLOWED_DOMAINS') === 'wllmd.com' && h.props.get('DEFAULT_TO') === 'ilya@wllmd.com' && h.props.get('LOG_FOLDER_ID') && h.folders.get(h.props.get('LOG_FOLDER_ID')).name === 'Wellmade spec form — submissions',
  'setup(): default properties and the log folder: ' + J(setupLines.filter(l => /folder/.test(l))));
h.props.set('DEFAULT_TO', 'kirill@wllmd.com');
h.setup();
ok(h.props.get('DEFAULT_TO') === 'kirill@wllmd.com' && h.folders.size === 1, 'setup() again keeps changed properties and the same folder');
h.props.set('DEFAULT_TO', 'ilya@wllmd.com');

const raw = J(payload({ recipients: ['kirill@wllmd.com', 'evil@gmail.com'] }));
let res = JSON.parse(h.doPost({ postData: { contents: raw } }).content);
ok(res.ok === true && /^\d{8}-\d{6}-[0-9A-F]{6}$/.test(res.submissionId), 'doPost: ok with a submission id ' + res.submissionId);
ok(h.logs.length === 1 && JSON.parse(h.logs[0].content).rawBody === raw && JSON.parse(h.logs[0].content).submissionId === res.submissionId && JSON.parse(h.logs[0].content).receivedAt,
  'log: one file, raw body byte for byte, submission id, receivedAt');
const m = h.mails[0];
ok(h.mails.length === 1 && m.to === 'kirill@wllmd.com' && m.noReply === true && m.name === 'Wellmade spec form', 'mail: only the allowed recipient, noReply, sender name');
ok(m.attachments.length === 1 && m.attachments[0].type === 'application/json' && JSON.parse(m.attachments[0].data).specId === 'presidio-xo', 'mail: full JSON attached');
ok(m.htmlBody.includes('evil@gmail.com (domain not allowed)') && m.body.includes(h.logs[0].getUrl()), 'mail footer: dropped address and log link');

res = JSON.parse(h.doPost({ postData: { contents: J(payload({ recipients: [], linkId: 'bad id!' })) } }).content);
ok(res.ok && h.mails[1].to === 'ilya@wllmd.com' && /_no-link_/.test(h.logs[1].name) && h.mails[1].body.includes('default address'), 'no recipients + invalid link id -> DEFAULT_TO, logged as no-link');
ok(JSON.parse(h.doPost({}).content).error === 'empty' && JSON.parse(h.doPost({ postData: { contents: '<html>' } }).content).error === 'bad_json', 'doPost without a body / with junk: JSON errors');

// rate limits
const rl = load({ pilot: PILOT }); rl.setup();
const lp = J(payload());
const results = [];
for (let i = 0; i < 61; i++) results.push(JSON.parse(rl.doPost({ postData: { contents: lp } }).content));
ok(results.slice(0, 60).every(x => x.ok) && results[60].error === 'rate_limited' && rl.mails.length === 60 && rl.logs.length === 60, '61st send from one link within the hour: rate_limited, not logged, not mailed');
ok(JSON.parse(rl.doPost({ postData: { contents: J(payload({ linkId: 'OtherLink0000001' })) } }).content).ok, 'another link is not blocked by it');
rl.props.set('MAX_PER_DAY', '62');
ok(JSON.parse(rl.doPost({ postData: { contents: J(payload({ linkId: 'ThirdLink0000001' })) } }).content).ok
  && JSON.parse(rl.doPost({ postData: { contents: J(payload({ linkId: 'FourthLink000001' })) } }).content).error === 'rate_limited', 'daily cap over all links (property MAX_PER_DAY)');

// failures after logging
const f = load({ pilot: PILOT }); f.setup(); f.failMail = true;
res = JSON.parse(f.doPost({ postData: { contents: J(payload()) } }).content);
ok(res.ok === false && res.error === 'mail_failed' && f.logs.length === 1, 'mail failure: ok:false mail_failed, the log file is already written');
const q = load({ pilot: PILOT, quota: 0 }); q.setup();
ok(JSON.parse(q.doPost({ postData: { contents: J(payload()) } }).content).error === 'mail_quota', 'no mail quota left: ok:false mail_quota');

// testSend
const t = load({ pilot: PILOT }); t.setup();
const ts = t.testSend();
ok(ts.ok && t.mails.length === 1 && t.mails[0].to === 'ilya@wllmd.com' && t.mails[0].htmlBody.includes('not-allowed@example.com (domain not allowed)') && t.mails[0].htmlBody.includes('&lt;b&gt;not bold&lt;/b&gt;'),
  'testSend(): through the same path, to DEFAULT_TO only, filter and escaping visible');
ok(g.errors.length === 0, 'no console errors in the pure tests');

log.push(fails ? fails + ' FAILED' : 'ALL PASS');
console.log(log.join('\n'));
process.exit(fails ? 1 : 0);
