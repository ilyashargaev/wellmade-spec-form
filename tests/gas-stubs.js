// Loads receiver/Code.gs in Node with in-memory stand-ins for the Google services it uses
// (Utilities, ContentService, PropertiesService, CacheService, LockService, DriveApp, MailApp).
// Used by tests/receiver-unit.js and by the mock receiver in tests/send.js. Not a Google emulator:
// it only records what the script asked for, so the script's own logic can be checked.
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

function formatDate(d, tz, fmt) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', weekday: 'short', timeZoneName: 'short'
  }).formatToParts(d).forEach(p => { parts[p.type] = p.value; });
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const H = parseInt(parts.hour, 10);
  return fmt.replace(/'[^']*'|yyyy|MMM|MM|dd|d|HH|h|mm|ss|EEE|a|z/g, t => {
    switch (t) {
      case 'yyyy': return parts.year; case 'MM': return parts.month; case 'MMM': return MON[parseInt(parts.month, 10) - 1];
      case 'dd': return parts.day; case 'd': return String(parseInt(parts.day, 10));
      case 'HH': return parts.hour; case 'h': return String(H % 12 || 12); case 'mm': return parts.minute; case 'ss': return parts.second;
      case 'EEE': return parts.weekday; case 'a': return H < 12 ? 'AM' : 'PM'; case 'z': return parts.timeZoneName;
      default: return t.slice(1, -1);
    }
  });
}

function load(opts) {
  opts = opts || {};
  const props = new Map(Object.entries(opts.props || {}));
  const cache = new Map();
  const folders = new Map();
  const mails = [];
  const logs = [];
  let n = 0;
  const g = {
    mails, logs, folders, props, cache,
    quota: opts.quota == null ? 100 : opts.quota,
    failMail: false,
    console: { log: () => {}, error: (...a) => { g.errors.push(a.join(' ')); } },
    errors: [],
    Utilities: {
      formatDate,
      getUuid: () => crypto.randomUUID(),
      newBlob: (data, type, name) => ({ data, type, name, getDataAsString: () => data, getName: () => name, getContentType: () => type })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: s => ({ content: s, mime: 'text/plain', setMimeType(m) { this.mime = m; return this; }, getContent() { return this.content; } })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        getProperties: () => Object.fromEntries(props)
      })
    },
    CacheService: { getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => { cache.set(k, String(v)); } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    DriveApp: {
      createFolder: name => {
        const id = 'folder' + (++n);
        const f = {
          id, name, files: [],
          getId: () => id, getName: () => name, getUrl: () => 'https://drive.example/folders/' + id,
          createFile: (fname, content, mime) => {
            const file = { name: fname, content, mime, getUrl: () => 'https://drive.example/file/' + encodeURIComponent(fname), getName: () => fname };
            f.files.push(file); logs.push(file); return file;
          }
        };
        folders.set(id, f); return f;
      },
      getFolderById: id => { if (!folders.has(id)) throw new Error('no folder ' + id); return folders.get(id); }
    },
    MailApp: {
      getRemainingDailyQuota: () => g.quota,
      sendEmail: m => { if (g.failMail) throw new Error('mail service down'); g.quota -= String(m.to).split(',').length; mails.push(m); }
    }
  };
  vm.createContext(g);
  const code = fs.readFileSync(path.join(opts.pilot || path.join(__dirname, '..'), 'receiver', 'Code.gs'), 'utf8');
  vm.runInContext(code, g, { filename: 'Code.gs' });
  return g;
}

module.exports = { load, formatDate };
