window.T = {
  btns(q, hot) { return [...document.querySelectorAll('[data-action=toggle]')].filter(e => e.dataset.qid === q && (!!hot) === e.classList.contains('hot')); },
  click(q, v, hot) { const el = T.btns(q, hot).find(e => e.dataset.value === v); if (!el) throw new Error('no button ' + q + '/' + v); el.click(); return true; },
  pick(q, v) { const el = T.btns(q).find(e => e.dataset.value === v); if (el.getAttribute('aria-pressed') !== 'true') el.click(); return true; },
  st(q) { return T.btns(q).map(e => { const t = e.querySelector('.wm-tag'); return { v: e.dataset.value, on: e.getAttribute('aria-pressed') === 'true', dis: e.disabled, tag: t && !t.hidden ? t.textContent : '' }; }); },
  on(q) { return T.st(q).filter(x => x.on).map(x => x.v + (x.tag ? ':' + x.tag : '')); },
  go(s) { document.querySelector('.step-jump[data-step="' + s + '"]').click(); return true; },
  type(q, val) { const i = document.getElementById('f-' + q); i.value = val; i.dispatchEvent(new Event('input', { bubbles: true })); return true; },
  layer(q) { document.querySelector('.layer-chip[data-qid="' + q + '"]').click(); return true; },
  // Plan hotspots as painted: active layer or passive, marks, marker text actually shown.
  hots(q) {
    return T.btns(q, true).map(e => ({
      v: e.dataset.value, on: e.classList.contains('on'), passive: e.classList.contains('passive'), dis: e.disabled,
      kind: ['included', 'extra', 'pending', 'swap'].find(k => e.classList.contains('k-' + k)) || '',
      marker: getComputedStyle(e.querySelector('.dot')).fontSize === '0px' ? '' : e.textContent,
      visible: getComputedStyle(e).visibility !== 'hidden'
    }));
  },
  marks(q) { return T.hots(q).filter(x => x.on).map(x => x.v + (x.kind ? ':' + x.kind : '')); },
  scrollTo(sel, pad) { const el = document.querySelector(sel); const top = el.getBoundingClientRect().top + scrollY - document.querySelector('.top').getBoundingClientRect().height - (pad || 8); window.scrollTo(0, top); return Math.round(top); },
  // Mean color of the preview canvas inside each layer outline (fully inside pixels only),
  // recomputed here from the spec polygons, plus the same for the untouched photo.
  async pvMeans() {
    const P = SPEC_DATA.preview, c = P.crop, cv = document.getElementById('preview-canvas');
    const w = c[2], h = c[3];
    const mk = document.createElement('canvas'); mk.width = w; mk.height = h; const g = mk.getContext('2d');
    const im = new Image(); im.src = (window.SPEC_ASSETS || {})[P.photo] || P.photo; await im.decode();
    const ph = document.createElement('canvas'); ph.width = w; ph.height = h; const pg = ph.getContext('2d'); pg.drawImage(im, -c[0], -c[1]);
    const photo = pg.getImageData(0, 0, w, h).data, now = cv.getContext('2d').getImageData(0, 0, w, h).data;
    const out = {};
    for (const l of P.layers) {
      g.clearRect(0, 0, w, h); g.fillStyle = '#000';
      const poly = (p, op) => { g.globalCompositeOperation = op; g.beginPath(); p.forEach((pt, i) => g[i ? 'lineTo' : 'moveTo'](pt[0] - c[0], pt[1] - c[1])); g.closePath(); g.fill(); };
      l.add.forEach(p => poly(p, 'source-over')); (l.cut || []).forEach(p => poly(p, 'destination-out')); g.globalCompositeOperation = 'source-over';
      const a = g.getImageData(0, 0, w, h).data; const s1 = [0, 0, 0], s2 = [0, 0, 0]; let n = 0;
      for (let i = 0; i < w * h; i++) if (a[i * 4 + 3] === 255) { n++; for (let k = 0; k < 3; k++) { s1[k] += now[i * 4 + k]; s2[k] += photo[i * 4 + k]; } }
      out[l.id] = { now: s1.map(v => Math.round(v / n)), photo: s2.map(v => Math.round(v / n)), n };
    }
    return out;
  },
  structure() {
    return [...document.querySelectorAll('main .q')].map(q => ({
      id: q.id, hidden: q.hidden || q.closest('[hidden]') !== null,
      label: (q.querySelector('h3, .field-label') || {}).textContent,
      options: [...q.querySelectorAll('.choice > span:first-child, .photo .name')].map(s => s.textContent),
      tags: [...q.querySelectorAll('.photo .wm-tag, .choice .wm-tag')].filter(t => !t.hidden).map(t => t.textContent),
      groups: [...q.querySelectorAll('.note-block h3')].map(s => s.textContent)
    }));
  },
  overflow() { return document.documentElement.scrollWidth; }
};
true;
