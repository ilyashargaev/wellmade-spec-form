/* Spec form engine: renderer. Generic: draws any spec loaded into window.SPEC_DATA.
   Classic script. No network except the font in CSS, and one POST to SITE_CONFIG.submitUrl
   when the client presses "Send to <brand>" (nothing else ever leaves the browser). */
(function () {
  "use strict";
  var app = document.getElementById("app");
  var printSheet = document.getElementById("print-sheet");
  var SPEC = globalThis.SPEC_DATA;
  if (!SPEC || !globalThis.SpecEngine) {
    app.textContent = "The form could not load its spec file. Run the check script, then reload.";
    return;
  }
  var M = globalThis.SpecEngine.createModel(SPEC);
  var STEPS = M.steps;
  // A personal client link carries "#id=<link id>&<field>=<text>..." (fields declared in spec.link).
  // Answers are saved per link id, so two clients opened on one device never mix.
  // No fragment = the plain form with its own saved answers, as before.
  var LINK = globalThis.SpecEngine.readLink(SPEC, location.hash);
  var linkNote = LINK && LINK.error ? LINK.error : "";
  if (LINK && LINK.error) LINK = null;
  var KEY = "spec-form:" + SPEC.specId + (LINK ? ":link:" + LINK.id : "");
  var storageNote = "";
  var state = { step: STEPS[0].id, answers: M.defaultAnswers(), sent: null, view: "form" };
  // Delivery settings (site-config.js), not spec content. Empty submitUrl = no Send button.
  var SITE = globalThis.SITE_CONFIG || {};
  var SEND_URL = typeof SITE.submitUrl === "string" && /^https?:\/\//i.test(SITE.submitUrl.trim()) ? SITE.submitUrl.trim() : "";
  var SEND_TIMEOUT = typeof SITE.sendTimeoutMs === "number" && SITE.sendTimeoutMs > 0 ? SITE.sendTimeoutMs : 25000;
  var send = { status: "idle", error: "" }; // idle | sending | error (in memory only)
  // Who the answers go to, in button and message texts: the spec's brand name (brand.logoAlt).
  var ORG = (SPEC.brand && SPEC.brand.logoAlt) || "the builder";
  var planLayer = {};   // plan id -> id of the plan question whose layer is active

  if (SPEC.pageTitle) document.title = SPEC.pageTitle;

  function h(tag, props, kids) {
    var n = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, String(v));
    });
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  function stepIndex(id) {
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) return i;
    return 0;
  }

  function currentStep() { return STEPS[stepIndex(state.step)] || STEPS[0]; }

  // ---- storage --------------------------------------------------------------
  // Answers a link starts with: the defaults plus the client details the link carries.
  function freshAnswers() {
    var a = M.defaultAnswers();
    return LINK ? M.applyLink(a, LINK.values) : a;
  }

  // Link values fill the form only the first time this link is opened on this device (nothing
  // saved yet for its id). After that the saved answers win, so the client's own edits of the
  // name or address are never overwritten by the link.
  function load() {
    var restored = false;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (!data || typeof data !== "object" || data.specId !== SPEC.specId ||
            (data.linkId || null) !== (LINK ? LINK.id : null)) throw new Error("unusable");
        state.answers = M.sanitize(data.answers);
        if (data.step && STEPS.some(function (s) { return s.id === data.step; })) state.step = data.step;
        var sd = data.sent;
        if (sd && typeof sd.at === "string" && typeof sd.submissionId === "string" && typeof sd.fingerprint === "string") {
          state.sent = { at: sd.at, submissionId: sd.submissionId, fingerprint: sd.fingerprint };
        }
        restored = true;
      }
    } catch (err) {
      storageNote = "Saved answers on this device could not be read. The form starts empty.";
      state.step = STEPS[0].id;
    }
    if (!restored) {
      state.answers = freshAnswers();
      if (LINK && !storageNote) persist(); // marks this link as opened, so later opens keep the client's edits
    }
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        specId: SPEC.specId, specVersion: SPEC.specVersion, linkId: LINK ? LINK.id : null,
        step: state.step, answers: state.answers, sent: state.sent
      }));
      if (storageNote) { storageNote = ""; paintBanner(); }
    } catch (err) {
      storageNote = "Answers are not being kept on this device. Download the JSON before you leave.";
      paintBanner();
    }
  }

  function paintBanner() {
    var b = document.getElementById("banner");
    if (!b) return;
    var text = [linkNote, storageNote].filter(Boolean).join(" ");
    b.hidden = !text;
    b.textContent = text;
  }

  // ---- layout offsets (header height measured at run time) -------------------
  function measure() {
    var top = app.querySelector(".top");
    var pv = document.getElementById("finish-preview");
    var root = document.documentElement.style;
    if (top) root.setProperty("--header-h", Math.ceil(top.getBoundingClientRect().height) + "px");
    root.setProperty("--preview-h", pv ? Math.ceil(pv.getBoundingClientRect().height) + "px" : "0px");
  }
  window.addEventListener("resize", measure);
  if (typeof ResizeObserver !== "undefined") {
    var ro = new ResizeObserver(measure);
    ro.observe(app);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

  // ---- option buttons -------------------------------------------------------
  function choiceButton(q, opt) {
    var st = M.optionState(q.id, opt.id, state.answers);
    var kids = [h("span", { text: opt.label })];
    if (st.dynamicTag || st.tag) {
      var tag = h("span", { class: "wm-tag", text: st.tag });
      if (!st.tag) tag.hidden = true;
      kids.push(tag);
    }
    return h("button", {
      type: "button",
      class: "choice",
      "aria-pressed": st.on ? "true" : "false",
      disabled: st.disabled,
      "data-action": "toggle",
      "data-qid": q.id,
      "data-value": opt.id
    }, kids);
  }

  function photoButton(q, opt, drawing) {
    var st = M.optionState(q.id, opt.id, state.answers);
    return h("button", {
      type: "button",
      class: drawing ? "photo drawing" : "photo",
      "aria-pressed": st.on ? "true" : "false",
      disabled: st.disabled,
      "data-action": "toggle",
      "data-qid": q.id,
      "data-value": opt.id
    }, [
      h("span", { class: "badge", "aria-hidden": "true", text: "✓" }),
      h("img", { src: opt.image, alt: "", "aria-hidden": "true" }),
      h("span", { class: "name", text: opt.label }),
      st.tag ? h("span", { class: "wm-tag", text: st.tag }) : null
    ]);
  }

  function countText(q) { return "Selected: " + M.effective(q, state.answers).length + "."; }

  function questionBlock(q) {
    var block = h("section", { class: "q", id: "q-" + q.id });
    if (M.isText(q)) block.appendChild(h("label", { class: "wm-h3 field-label", for: "f-" + q.id, text: q.label }));
    else block.appendChild(h("h3", { class: "wm-h3", text: q.label }));
    if (q.note) block.appendChild(h("p", { class: "note", text: q.note }));
    if (q.hint) block.appendChild(h("p", { class: "hint", text: q.hint }));
    if (q.showCount) block.appendChild(h("p", { class: "hint", id: "count-" + q.id, text: countText(q) }));

    if (q.kind === "text") {
      var input = h("input", {
        class: "wm-input", id: "f-" + q.id, type: q.inputmode === "tel" ? "tel" : "text", "data-qid": q.id,
        autocomplete: q.autocomplete, inputmode: q.inputmode
      });
      input.value = state.answers[q.id] || "";
      var field = h("div", { class: "field" });
      if (q.suffix) field.appendChild(h("span", { class: "suffix" }, [input, h("em", { text: q.suffix })]));
      else field.appendChild(input);
      block.appendChild(field);
    } else if (q.kind === "lines") {
      var area = h("textarea", { class: "wm-input", id: "f-" + q.id, "data-qid": q.id });
      area.value = state.answers[q.id] || "";
      block.appendChild(h("div", { class: "field" }, [area]));
    } else if ((q.kind === "single" || q.kind === "multi") && (q.layout === "photos" || q.layout === "drawings")) {
      var grid = h("div", { class: q.layout === "drawings" ? "photos drawings" : "photos" });
      var groups = {};
      (q.groups || []).forEach(function (g) { groups[g.id] = g; });
      var shown = {};
      (q.options || []).forEach(function (opt) {
        var g = opt.group && groups[opt.group];
        if (g && !shown[g.id]) {
          shown[g.id] = true;
          grid.appendChild(h("div", { class: "span2 note-block" }, [
            h("h3", { class: "wm-h3", text: g.title || "" }),
            g.text ? h("p", { text: g.text }) : null
          ]));
        }
        if (opt.image) grid.appendChild(photoButton(q, opt, q.layout === "drawings"));
        else grid.appendChild(h("div", { class: "span2" }, [choiceButton(q, opt)]));
      });
      block.appendChild(grid);
    } else if (q.options) {
      var col = h("div", { class: "choices" });
      q.options.forEach(function (opt) { col.appendChild(choiceButton(q, opt)); });
      block.appendChild(col);
    }
    return block;
  }

  // ---- plan viewer -----------------------------------------------------------
  // The whole plan is scaled to the width of the screen; the page scrolls normally over it.
  // Every plan question of a step on the same plan is one layer; chips switch the layer.
  // Only the active layer has tap targets (44 px) with markers; other layers show their picks
  // as small dots. The active question's block (note, hint, buttons by name) sits under the plan.
  var TAG_KINDS = ["included", "extra", "pending", "swap"];

  function activeLayer(planId, group) {
    var cur = planLayer[planId];
    if (!group.some(function (q) { return q.id === cur; })) cur = planLayer[planId] = group[0].id;
    return cur;
  }

  function planGroup(planId) {
    var step = currentStep();
    return (step.items || []).filter(function (it) { return it.plan && it.plan.id === planId; });
  }

  function mountPlan(planId, group, ruleNotes) {
    var plan = SPEC.plans[planId];
    activeLayer(planId, group);
    var box = h("section", { class: "planbox", id: "plan-" + planId });
    if (group.length > 1) {
      var chips = h("div", { class: "layer-chips", role: "group", "aria-label": "What you are placing on the plan" });
      group.forEach(function (q) {
        chips.appendChild(h("button", {
          type: "button", class: "layer-chip", "data-action": "layer", "data-plan": planId, "data-qid": q.id
        }, [h("span", { text: q.plan.legend || q.label }), h("span", { class: "count" })]));
      });
      box.appendChild(chips);
    }
    var img = h("img", { src: plan.image, alt: plan.alt, draggable: "false" });
    var inner = h("div", { class: "plan-inner" }, [img]);
    group.forEach(function (q) {
      (q.options || []).forEach(function (opt) {
        var btn = h("button", {
          type: "button",
          class: "hot " + (q.plan.shape || "circle"),
          "data-action": "toggle", "data-plan": planId, "data-qid": q.id, "data-value": opt.id
        }, [h("span", { class: "dot", "aria-hidden": "true", text: opt.marker || "" })]);
        btn.style.left = opt.x + "%";
        btn.style.top = opt.y + "%";
        inner.appendChild(btn);
      });
    });
    box.appendChild(h("div", { class: "plan-stage" }, [inner]));
    box.appendChild(h("div", { class: "legend", id: "legend-" + planId, "aria-hidden": "true" }));
    group.forEach(function (q) {
      var block = questionBlock(q);
      block.classList.add("layer");
      (ruleNotes[q.id] || []).forEach(function (note) { block.insertBefore(note, block.children[1] || null); });
      box.appendChild(block);
    });
    return box;
  }

  function legendItem(cls, text) {
    return h("span", {}, [h("i", { class: "hot-sample " + cls }, [h("span", { class: "dot" })]), document.createTextNode(text)]);
  }

  function paintPlan(planId) {
    var box = document.getElementById("plan-" + planId);
    if (!box) return;
    var group = planGroup(planId);
    var active = activeLayer(planId, group);
    var activeQ = M.question(active);
    var otherPicks = false;
    var hots = box.querySelectorAll(".hot");
    for (var i = 0; i < hots.length; i++) {
      var el = hots[i];
      var qid = el.getAttribute("data-qid");
      var q = M.question(qid);
      var opt = M.option(q, el.getAttribute("data-value"));
      var st = M.optionState(qid, opt.id, state.answers);
      var isActive = qid === active;
      el.classList.toggle("passive", !isActive);
      el.classList.toggle("on", st.on);
      el.classList.toggle("locked", st.locked);
      TAG_KINDS.forEach(function (k) { el.classList.toggle("k-" + k, st.on && st.kind === k); });
      el.setAttribute("aria-pressed", st.on ? "true" : "false");
      el.disabled = !isActive || st.disabled;
      if (isActive) {
        el.removeAttribute("aria-hidden");
        el.removeAttribute("tabindex");
        el.setAttribute("aria-label", q.label + ": " + opt.label + (st.tag ? " (" + st.tag + ")" : ""));
      } else {
        el.setAttribute("aria-hidden", "true");
        el.setAttribute("tabindex", "-1");
        if (st.on) otherPicks = true;
      }
    }
    var chips = box.querySelectorAll(".layer-chip");
    for (var c = 0; c < chips.length; c++) {
      var cq = M.question(chips[c].getAttribute("data-qid"));
      var n = M.effective(cq, state.answers).length;
      chips[c].setAttribute("aria-pressed", cq.id === active ? "true" : "false");
      chips[c].querySelector(".count").textContent = n ? String(n) : "";
      chips[c].setAttribute("aria-label", (cq.plan.legend || cq.label) + (n ? ", " + n + " picked" : ", none picked"));
    }
    group.forEach(function (q) {
      var block = document.getElementById("q-" + q.id);
      if (block) block.classList.toggle("layer-off", q.id !== active);
    });
    box.querySelector(".plan-stage").classList.toggle("is-disabled", M.isInactive(active, state.answers));
    var legend = document.getElementById("legend-" + planId);
    legend.textContent = "";
    var tags = M.tagLegend(active);
    if (tags.length) tags.forEach(function (t) { legend.appendChild(legendItem("on k-" + t.kind, t.text)); });
    else legend.appendChild(legendItem("on", "Selected"));
    legend.appendChild(legendItem("", "Not selected"));
    if (otherPicks) legend.appendChild(legendItem("passive on", "Picked in another layer"));
    if (activeQ && activeQ.kind === "plan-single") legend.appendChild(h("span", { class: "legend-note", text: "One only" }));
  }

  function paintPlans() {
    var boxes = app.querySelectorAll(".planbox");
    for (var i = 0; i < boxes.length; i++) paintPlan(boxes[i].id.slice(5));
  }

  function setLayer(planId, qid, focusChip) {
    planLayer[planId] = qid;
    paintPlan(planId);
    if (focusChip) {
      var chip = app.querySelector('.layer-chip[data-plan="' + planId + '"][data-qid="' + qid + '"]');
      if (chip) chip.focus();
    }
  }

  // ---- finish preview (photo recolored in the browser) -----------------------
  // spec.preview: one photo, a crop, and layers. Each layer outlines a part of the photo
  // ("add" polygons minus "cut" polygons) and takes the "color" of the option picked in its
  // question. Each pixel keeps its brightness (light, shadow, grain) and takes the new color.
  var PV = SPEC.preview && SPEC.preview.photo ? SPEC.preview : null;
  var pv = { img: null, src: null, masks: null, failed: false, waiting: [], cacheKey: "", cache: null };

  function pvCrop() {
    return PV.crop || [0, 0, pv.img ? pv.img.naturalWidth : 1, pv.img ? pv.img.naturalHeight : 1];
  }

  function pvMask(g, layer, c) {
    var w = c[2], hgt = c[3];
    g.clearRect(0, 0, w, hgt);
    g.fillStyle = "#000";
    function poly(points, op) {
      g.globalCompositeOperation = op;
      g.beginPath();
      points.forEach(function (pt, i) { g[i ? "lineTo" : "moveTo"](pt[0] - c[0], pt[1] - c[1]); });
      g.closePath();
      g.fill();
    }
    (layer.add || []).forEach(function (p) { poly(p, "source-over"); });
    (layer.cut || []).forEach(function (p) { poly(p, "destination-out"); });
    g.globalCompositeOperation = "source-over";
    var a = g.getImageData(0, 0, w, hgt).data;
    var m = new Float32Array(w * hgt);
    var s = pv.src.data;
    var sum = 0, n = 0;
    for (var i = 0; i < m.length; i++) {
      m[i] = a[i * 4 + 3] / 255;
      if (m[i] > 0.5) { sum += 0.299 * s[i * 4] + 0.587 * s[i * 4 + 1] + 0.114 * s[i * 4 + 2]; n++; }
    }
    return { m: m, meanL: sum / Math.max(n, 1) };
  }

  function pvLoad(cb) {
    if (!PV) return;
    if (pv.src || pv.failed) { cb(); return; }
    pv.waiting.push(cb);
    if (pv.waiting.length > 1) return;
    var im = new Image();
    function done() { var w = pv.waiting; pv.waiting = []; w.forEach(function (f) { f(); }); }
    im.onload = function () {
      pv.img = im;
      var c = pvCrop();
      var cv = document.createElement("canvas");
      cv.width = c[2]; cv.height = c[3];
      var g = cv.getContext("2d", { willReadFrequently: true });
      g.drawImage(im, -c[0], -c[1]);
      try {
        pv.src = g.getImageData(0, 0, c[2], c[3]);
        pv.masks = {};
        PV.layers.forEach(function (l) { pv.masks[l.id] = pvMask(g, l, c); });
      } catch (err) {
        pv.src = null;
        pv.failed = true; // pixels not readable (e.g. a photo file opened from a folder): show it unrecolored
      }
      done();
    };
    im.onerror = function () { pv.failed = true; done(); };
    var assets = globalThis.SPEC_ASSETS || {};
    im.src = assets[PV.photo] || PV.photo;
  }

  function hexRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  // Draw the current answers onto a canvas sized to the crop. Returns false if nothing could be drawn.
  function pvDraw(canvas) {
    if (!PV || !canvas) return false;
    var c = pvCrop();
    if (canvas.width !== c[2]) canvas.width = c[2];
    if (canvas.height !== c[3]) canvas.height = c[3];
    var g = canvas.getContext("2d");
    if (!pv.src) {
      if (!pv.img) return false;
      g.drawImage(pv.img, -c[0], -c[1]);
      return true;
    }
    var layers = M.previewState(state.answers).layers;
    var key = layers.map(function (l) { return l.color || "-"; }).join("|");
    if (pv.cacheKey !== key) {
      var s = pv.src.data;
      var out = new ImageData(new Uint8ClampedArray(s), pv.src.width, pv.src.height);
      var o = out.data;
      layers.forEach(function (l) {
        if (!l.color) return;
        var rgb = hexRgb(l.color);
        var mask = pv.masks[l.id];
        for (var i = 0; i < mask.m.length; i++) {
          var a = mask.m[i];
          if (!a) continue;
          var j = i * 4;
          var k = (0.299 * s[j] + 0.587 * s[j + 1] + 0.114 * s[j + 2]) / mask.meanL;
          for (var ch = 0; ch < 3; ch++) o[j + ch] = s[j + ch] * (1 - a) + Math.min(255, rgb[ch] * k) * a;
        }
      });
      pv.cacheKey = key;
      pv.cache = out;
    }
    g.putImageData(pv.cache, 0, 0);
    return true;
  }

  function previewBlock(isStatic) {
    if (!PV) return null;
    var c = PV.crop || [0, 0, 4, 3];
    return h("section", { class: "finish-preview" + (isStatic ? " static" : ""), id: "finish-preview" }, [
      h("canvas", { id: "preview-canvas", width: c[2], height: c[3], role: "img", "aria-label": PV.alt || "Finish preview" }),
      h("div", { class: "pv-cap" }, [
        h("div", { id: "preview-picked", "aria-live": "polite" }),
        PV.caption ? h("p", { class: "pv-note", text: PV.caption }) : null
      ])
    ]);
  }

  function paintPreview() {
    var root = document.getElementById("finish-preview");
    if (!root) return;
    var stateNow = M.previewState(state.answers);
    var picked = document.getElementById("preview-picked");
    picked.textContent = "";
    if (!stateNow.picked && PV.empty) picked.appendChild(h("p", { class: "pv-line", text: PV.empty }));
    else stateNow.layers.forEach(function (l) {
      picked.appendChild(h("p", { class: "pv-line" }, [
        h("span", { class: "pv-name", text: l.name + ": " }),
        h("b", { text: l.label || "not picked" })
      ]));
    });
    pvLoad(function () { pvDraw(document.getElementById("preview-canvas")); });
  }

  // ---- repaint after an answer changes (no full re-render) ------------------
  function refresh() {
    var nodes = app.querySelectorAll("[data-action='toggle']");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.classList.contains("hot")) continue;
      var st = M.optionState(el.getAttribute("data-qid"), el.getAttribute("data-value"), state.answers);
      if (!st) continue;
      el.setAttribute("aria-pressed", st.on ? "true" : "false");
      el.disabled = st.disabled;
      var tag = el.querySelector(".wm-tag");
      if (tag && st.dynamicTag) {
        tag.textContent = st.tag;
        tag.hidden = !st.tag;
      }
    }
    M.questions.forEach(function (q) {
      if (q.showCount) {
        var c = document.getElementById("count-" + q.id);
        if (c) c.textContent = countText(q);
      }
      if (M.isText(q)) {
        var input = document.getElementById("f-" + q.id);
        if (input && input.value !== (state.answers[q.id] || "")) input.value = state.answers[q.id] || "";
      }
    });
    M.disableRules.forEach(function (rule) {
      var on = rule.targets.some(function (t) { return M.isInactive(t, state.answers); });
      var note = document.getElementById("rule-note-" + rule._index);
      if (note) note.hidden = !on;
      if (rule.hide) {
        rule.targets.forEach(function (t) {
          var block = document.getElementById("q-" + t);
          if (block) block.hidden = on;
        });
      }
    });
    paintPlans();
    paintPreview();
  }

  function toggle(qid, value) {
    var q = M.question(qid);
    if (!q) return;
    state.answers = M.toggle(state.answers, qid, value);
    persist();
    refresh();
  }

  function resetForm() {
    if (!window.confirm("Clear all answers on this device and start a new form?")) return;
    try { localStorage.removeItem(KEY); } catch (err) { /* storage blocked: answers are only in memory */ }
    state.answers = freshAnswers(); // a client link brings its name and address back
    state.step = STEPS[0].id;
    state.sent = null;
    send = { status: "idle", error: "" };
    planLayer = {};
    persist();
    render();
    window.scrollTo(0, 0);
  }

  // ---- review ---------------------------------------------------------------
  function emptyText(row) {
    if (row.inactive) return "Not used";
    return row.optional ? "None" : "Not answered";
  }

  function rowValue(row) {
    var value = h("div", { class: "v" });
    if (row.inactive || row.empty) value.appendChild(h("span", { class: "empty", text: emptyText(row) }));
    else value.appendChild(document.createTextNode(row.answer));
    if (row.images && row.images.length) {
      var thumbs = h("div", { class: "thumbs" });
      row.images.forEach(function (im) { thumbs.appendChild(h("img", { src: im.src, alt: "", "aria-hidden": "true" })); });
      value.appendChild(thumbs);
    }
    return value;
  }

  function renderReview(step) {
    var sum = M.summary(state.answers);
    var box = h("div", { class: "summary" });
    box.appendChild(h("p", { class: "model", text: SPEC.model }));
    if (SPEC.modelNote) box.appendChild(h("p", { class: "hint", text: SPEC.modelNote }));
    if (step.showPreview) box.appendChild(previewBlock(true));
    if (SEND_URL) box.appendChild(h("section", { class: "send-panel", id: "send-panel", role: "status", "aria-live": "polite", tabindex: "-1" }));
    else box.appendChild(h("p", { class: "hint send-off", id: "send-off", text: "Sending to " + ORG + " is not set up yet. Download or print your answers instead." }));
    box.appendChild(h("h3", { class: "wm-h3", text: sum.open.length ? (sum.open.length + " still open") : "Nothing left open" }));
    if (!sum.open.length) box.appendChild(h("p", { class: "hint", text: "Every question has an answer." }));
    sum.open.forEach(function (item) {
      box.appendChild(h("button", {
        type: "button", class: "jump", "data-action": "goto", "data-step": item.step, "data-qid": item.id
      }, [h("span", { text: item.section + " — " + item.label }), h("span", { text: "Edit" })]));
    });
    sum.sections.forEach(function (section) {
      box.appendChild(h("h3", { class: "wm-h3", text: section.title }));
      section.rows.forEach(function (row) {
        var value = rowValue(row);
        value.appendChild(h("button", {
          type: "button", class: "jump", "data-action": "goto", "data-step": section.id, "data-qid": row.id, text: "Edit"
        }));
        box.appendChild(h("div", { class: "row" }, [h("div", { class: "k", text: row.label }), value]));
      });
    });
    if (SEND_URL) {
      box.appendChild(h("div", { class: "keep-copy" }, [
        h("h3", { class: "wm-h3", text: "Keep a copy" }),
        h("div", { class: "keep-copy-btns" }, [
          h("button", { type: "button", class: "wm-btn wm-btn--secondary", "data-action": "print", text: "Print" }),
          h("button", { type: "button", class: "wm-btn wm-btn--secondary", "data-action": "download", text: "Download JSON" })
        ])
      ]));
    }
    box.appendChild(h("div", { class: "reset" }, [
      h("button", { type: "button", class: "wm-btn wm-btn--secondary reset-btn", "data-action": "reset", text: "Start a new form" }),
      h("p", { class: "hint", text: "Clears every answer on this device. Download the JSON first if you need it." })
    ]));
    return box;
  }

  // ---- step page ------------------------------------------------------------
  function renderItems(step, main) {
    var items = step.items || [];
    var mountedPlans = {};
    var notedRules = {};
    function ruleNotesFor(item) {
      var out = [];
      M.disableRules.forEach(function (rule) {
        if (!rule.note || notedRules[rule._index] || rule.targets.indexOf(item.id) < 0) return;
        notedRules[rule._index] = true;
        var note = h("p", { class: "note rule-note", id: "rule-note-" + rule._index, text: rule.note });
        note.hidden = !M.isInactive(item.id, state.answers);
        out.push(note);
      });
      return out;
    }
    items.forEach(function (item) {
      if (item.kind === "note") {
        main.appendChild(h("section", { class: "note-block" }, [
          item.title ? h("h2", { class: "wm-h3", text: item.title }) : null,
          h("p", { text: item.text })
        ]));
        return;
      }
      if (item.kind === "figure") {
        main.appendChild(h("figure", { class: "figure" + (item.layout ? " " + item.layout : "") }, [
          h("img", { src: item.image, alt: item.alt || "" }),
          h("figcaption", { text: item.caption || "" })
        ]));
        return;
      }
      if (item.plan) {
        if (mountedPlans[item.plan.id]) return;
        mountedPlans[item.plan.id] = true;
        var group = items.filter(function (it) { return it.plan && it.plan.id === item.plan.id; });
        var notes = {};
        group.forEach(function (q) { notes[q.id] = ruleNotesFor(q); });
        main.appendChild(mountPlan(item.plan.id, group, notes));
        return;
      }
      ruleNotesFor(item).forEach(function (note) { main.appendChild(note); });
      var block = questionBlock(item);
      if (M.isInactive(item.id, state.answers) && M.disableRules.some(function (r) {
        return r.hide && r.targets.indexOf(item.id) >= 0;
      })) block.hidden = true;
      main.appendChild(block);
    });
  }

  function render() {
    var step = currentStep();
    var idx = stepIndex(step.id);
    app.textContent = "";
    var top = h("header", { class: "top" });
    top.appendChild(h("div", { class: "brand" }, [
      SPEC.brand && SPEC.brand.logo ? h("img", { src: SPEC.brand.logo, alt: SPEC.brand.logoAlt || "" }) : h("span"),
      h("p", { class: "eyebrow", text: "Step " + (idx + 1) + " of " + STEPS.length })
    ]));
    var prog = h("div", { class: "progress", "aria-hidden": "true" }, [h("span")]);
    prog.firstChild.style.width = ((idx + 1) / STEPS.length * 100) + "%";
    top.appendChild(prog);
    var jumps = h("nav", { class: "steps", "aria-label": "Sections" });
    STEPS.forEach(function (s) {
      jumps.appendChild(h("button", {
        type: "button", class: "step-jump", "data-action": "goto", "data-step": s.id,
        "aria-current": s.id === step.id ? "step" : false, text: s.short || s.title
      }));
    });
    top.appendChild(jumps);
    app.appendChild(top);
    var banner = h("p", { class: "banner", id: "banner", role: "status" });
    banner.hidden = true;
    app.appendChild(banner);
    paintBanner();

    var main = h("main", { id: "main" });
    if (step.showPreview && step.kind !== "review") main.className = "has-preview";
    if (state.view !== "sent") {
      main.appendChild(h("h1", { class: "wm-h2", id: "step-title", text: step.title }));
      if (step.showModel) main.appendChild(h("p", { class: "model", text: SPEC.model }));
      if (step.intro) main.appendChild(h("p", { class: "lead", text: step.intro }));
      if (step.pageRef) main.appendChild(h("p", { class: "page-ref", text: step.pageRef }));
      if (step.hint) main.appendChild(h("p", { class: "hint", text: step.hint }));
    }

    if (state.view === "sent") renderSent(main);
    else if (step.kind === "review") main.appendChild(renderReview(step));
    else {
      if (step.showPreview) main.appendChild(previewBlock(false));
      renderItems(step, main);
    }
    if (SPEC.brand && SPEC.brand.footer) main.appendChild(h("p", { class: "page-ref", text: SPEC.brand.footer }));
    app.appendChild(main);

    var bar = h("div", { class: "bar" });
    var inner = h("div", { class: "bar-in" });
    var back = h("button", { type: "button", class: "wm-btn wm-btn--secondary", "data-action": "back", text: "Back" });
    if (idx === 0) back.disabled = true;
    if (state.view === "sent") {
      inner.appendChild(h("button", { type: "button", class: "wm-btn wm-btn--secondary", "data-action": "download", text: "Download JSON" }));
      inner.appendChild(h("button", { type: "button", class: "wm-btn wm-btn--primary", "data-action": "goto", "data-step": step.id, text: "Back to my answers" }));
    } else if (step.kind === "review" && SEND_URL) {
      inner.appendChild(back);
      inner.appendChild(h("button", { type: "button", class: "wm-btn wm-btn--primary send-btn", id: "send-btn", "data-action": "send", text: "Send to " + ORG }));
    } else if (step.kind === "review") {
      inner.appendChild(back);
      inner.appendChild(h("button", { type: "button", class: "wm-btn wm-btn--secondary", "data-action": "print", text: "Print" }));
      inner.appendChild(h("button", { type: "button", class: "wm-btn wm-btn--primary", "data-action": "download", text: "Download JSON" }));
    } else {
      inner.appendChild(back);
      inner.appendChild(h("button", { type: "button", class: "wm-btn wm-btn--primary", "data-action": "next", text: "Next" }));
    }
    bar.appendChild(inner);
    app.appendChild(bar);
    paintPlans();
    paintPreview();
    paintSend();
    measure();
    // Move focus to the heading so a screen reader announces the new step. Styles show a ring
    // only for keyboard focus (:focus-visible), not for this programmatic move after a tap.
    var title = document.getElementById("step-title");
    if (title) { title.setAttribute("tabindex", "-1"); title.focus({ preventScroll: true }); }
  }

  function gotoStep(id, qid) {
    if (!STEPS.some(function (s) { return s.id === id; })) return;
    var focusId = qid;
    if (qid && M.isInactive(qid, state.answers)) focusId = M.controllerOf(qid, state.answers) || qid;
    var fq = focusId && M.question(focusId);
    if (fq && fq.plan) planLayer[fq.plan.id] = fq.id;
    state.step = id;
    state.view = "form";
    persist();
    render();
    window.scrollTo(0, 0);
    if (focusId) {
      var el = document.getElementById("q-" + focusId);
      if (el && !el.hidden) {
        el.scrollIntoView({ block: "start" });
        var focusable = el.querySelector("button:not([disabled]), input, textarea");
        if (focusable) focusable.focus();
      }
    }
  }

  // ---- outputs --------------------------------------------------------------
  function fileName() {
    var d = SPEC.download || {};
    var prefix = d.prefixFrom ? state.answers[d.prefixFrom] : "";
    var clean = String(prefix || "").trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return (clean ? clean + "-" : "") + (d.fileName || SPEC.specId) + ".json";
  }

  function buildExport() {
    var sum = M.summary(state.answers);
    var ex = M.exportAnswers(state.answers);
    return {
      specId: SPEC.specId,
      specVersion: SPEC.specVersion,
      linkId: LINK ? LINK.id : null,
      form: SPEC.formName || SPEC.title,
      model: SPEC.model,
      exportedAt: new Date().toISOString(),
      sources: SPEC.sources || [],
      summary: sum.sections.map(function (s) {
        return {
          section: s.title,
          answers: s.rows.map(function (r) {
            var row = { id: r.id, question: r.label, answer: r.inactive || r.empty ? "" : r.answer, inactive: !!r.inactive, optional: !!r.optional };
            var q = M.question(r.id);
            if (q && q.options) {
              // Picked options with their tag (fixed, like "Additional cost", or rule-made, like "Included").
              row.options = r.inactive ? [] : M.effective(q, state.answers).map(function (oid) {
                var o = M.option(q, oid), st = M.optionState(q.id, oid, state.answers);
                return { id: oid, label: o ? o.label : oid, tag: (st && st.tag) || "" };
              });
            }
            return row;
          })
        };
      }),
      openQuestions: sum.open.map(function (o) { return { section: o.section, question: o.label, id: o.id }; }),
      answers: ex.answers,
      tags: ex.tags,
      preview: M.previewState(state.answers).layers.map(function (l) {
        return { layer: l.id, question: l.question, option: l.option, color: l.color };
      })
    };
  }
  globalThis.__specFormExport = buildExport; // for tests and a later submit step

  function downloadJSON() {
    var blob = new Blob([JSON.stringify(buildExport(), null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = h("a", { href: url, download: fileName() });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function buildPrint() {
    var sum = M.summary(state.answers);
    printSheet.textContent = "";
    if (SPEC.brand && SPEC.brand.logo) printSheet.appendChild(h("img", { class: "logo", src: SPEC.brand.logo, alt: SPEC.brand.logoAlt || "" }));
    printSheet.appendChild(h("h1", { text: SPEC.title }));
    printSheet.appendChild(h("p", { class: "meta", text: SPEC.model + (SPEC.modelNote ? " · " + SPEC.modelNote : "") }));
    printSheet.appendChild(h("p", { class: "meta", text: "Printed " + new Date().toLocaleString() +
      (SPEC.brand && SPEC.brand.footer ? " · " + SPEC.brand.footer : "") + " · Spec " + SPEC.specId + " v" + SPEC.specVersion + (LINK ? " · Link " + LINK.id : "") }));
    printSheet.appendChild(h("p", { class: "meta", text: SEND_URL
      ? "Printed copy. Answers reach " + ORG + " only when “Send to " + ORG + "” is pressed in the form."
      : "This summary stays on this device. It is not submitted anywhere." }));
    if (PV) {
      var lines = M.previewState(state.answers).layers.map(function (l) { return l.name + ": " + (l.label || "not picked"); });
      printSheet.appendChild(h("h2", { text: "Finish preview" }));
      printSheet.appendChild(h("p", { class: "meta", text: lines.join(" · ") + (PV.caption ? " · " + PV.caption : "") }));
      var pc = document.createElement("canvas");
      if ((pv.src || pv.img) && pvDraw(pc)) {
        try { printSheet.appendChild(h("img", { class: "preview-print", src: pc.toDataURL("image/jpeg", 0.85), alt: "" })); }
        catch (err) { /* canvas not exportable: text only */ }
      }
    }
    if (sum.open.length) {
      printSheet.appendChild(h("h2", { text: "Still open" }));
      sum.open.forEach(function (o) { printSheet.appendChild(h("p", { text: o.section + " — " + o.label })); });
    } else {
      printSheet.appendChild(h("p", { text: "Nothing left open." }));
    }
    sum.sections.forEach(function (section) {
      printSheet.appendChild(h("h2", { text: section.title }));
      section.rows.forEach(function (row) {
        var value = h("div", { class: "v" });
        value.appendChild(document.createTextNode(row.inactive || row.empty ? emptyText(row) : row.answer));
        if (!row.inactive && row.images && row.images.length) {
          var thumbs = h("div", { class: "thumbs" });
          row.images.forEach(function (im) { thumbs.appendChild(h("img", { src: im.src, alt: "" })); });
          value.appendChild(thumbs);
        }
        printSheet.appendChild(h("div", { class: "row" }, [h("div", { class: "k", text: row.label }), value]));
      });
    });
  }

  // ---- send to <brand> -------------------------------------------------------
  // One POST of the export (plus recipients, client details and sentAt) to SITE_CONFIG.submitUrl.
  // text/plain keeps it a "simple" request (no CORS preflight); Apps Script answers through a
  // redirect, which fetch follows. Answers stay saved on the device whatever happens.
  function fingerprint() { return JSON.stringify(M.exportAnswers(state.answers).answers); }

  function buildPayload() {
    var p = buildExport();
    p.sentAt = new Date().toISOString();
    p.recipients = LINK ? LINK.recipients.slice() : [];
    p.client = globalThis.SpecEngine.linkFields(SPEC).map(function (f) {
      return { param: f.param, label: f.label, question: f.question, value: String(state.answers[f.question] || "").trim() };
    });
    return p;
  }

  function whenText(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    try { return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
    catch (err) { return d.toLocaleString(); }
  }

  function sendError(kind, detail) {
    if (kind === "offline") return "Could not reach " + ORG + ". Check your internet connection, then press Retry.";
    if (kind === "timeout") return ORG + " did not answer in time. Press Retry; if it happens again, try a little later.";
    if (kind === "rate_limited") return "Too many sends from this link for now. Please try again in an hour.";
    if (kind === "http") return ORG + "’s server had a problem (HTTP " + detail + "). Press Retry.";
    if (kind === "refused") return ORG + "’s server did not accept the answers (" + detail + "). Press Retry; if it happens again, download the JSON and email it.";
    return ORG + "’s server gave an unexpected reply. Press Retry.";
  }

  function postWithTimeout(body) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer;
    var timeout = new Promise(function (resolve, reject) {
      timer = setTimeout(function () { if (ctrl) ctrl.abort(); reject({ kind: "timeout" }); }, SEND_TIMEOUT);
    });
    var req = fetch(SEND_URL, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: body,
      redirect: "follow", credentials: "omit", cache: "no-store", signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw { kind: "http", detail: res.status };
      return res.text();
    }, function (err) {
      throw { kind: err && err.name === "AbortError" ? "timeout" : "offline" };
    }).then(function (text) {
      var data;
      try { data = JSON.parse(text); } catch (err) { throw { kind: "bad" }; }
      if (data && data.ok === true && typeof data.submissionId === "string" && data.submissionId) return data;
      if (data && data.ok === false && data.error === "rate_limited") throw { kind: "rate_limited" };
      if (data && data.ok === false) throw { kind: "refused", detail: String(data.error || "error").slice(0, 60) };
      throw { kind: "bad" };
    });
    return Promise.race([req, timeout]).then(function (v) { clearTimeout(timer); return v; },
      function (e) { clearTimeout(timer); throw e; });
  }

  function sendNow() {
    if (!SEND_URL || send.status === "sending") return;
    var payload = buildPayload();
    var print = fingerprint();
    send = { status: "sending", error: "" };
    paintSend(true);
    postWithTimeout(JSON.stringify(payload)).then(function (data) {
      send = { status: "idle", error: "" };
      state.sent = { at: payload.sentAt, submissionId: data.submissionId, fingerprint: print };
      persist();
      state.view = "sent";
      render();
      window.scrollTo(0, 0);
    }, function (e) {
      e = e || {};
      send = { status: "error", error: sendError(e.kind, e.detail) };
      paintSend(true);
    });
  }

  // The status block on Review and the Send button in the bar.
  function paintSend(scroll) {
    var panel = document.getElementById("send-panel");
    var btn = document.getElementById("send-btn");
    var changed = state.sent && state.sent.fingerprint !== fingerprint();
    if (btn) {
      btn.disabled = send.status === "sending";
      btn.textContent = send.status === "sending" ? "Sending…" : (state.sent ? "Send again" : "Send to " + ORG);
      btn.setAttribute("aria-busy", send.status === "sending" ? "true" : "false");
    }
    if (!panel) return;
    panel.textContent = "";
    panel.className = "send-panel";
    if (send.status === "sending") {
      panel.classList.add("is-sending");
      panel.appendChild(h("p", { class: "send-title" }, [h("span", { class: "spinner", "aria-hidden": "true" }), "Sending…"]));
      panel.appendChild(h("p", { text: "This can take up to 20 seconds. Please keep this page open." }));
    } else if (send.status === "error") {
      panel.classList.add("is-error");
      panel.appendChild(h("p", { class: "send-title", text: "Not sent" }));
      panel.appendChild(h("p", { id: "send-error", text: send.error }));
      panel.appendChild(h("p", { text: "Your answers are still here on this device." }));
      panel.appendChild(h("button", { type: "button", class: "wm-btn wm-btn--primary", "data-action": "send", id: "send-retry", text: "Retry" }));
    } else if (state.sent && changed) {
      panel.classList.add("is-changed");
      panel.appendChild(h("p", { class: "send-title", text: "Changed since you sent — send again" }));
      panel.appendChild(h("p", { text: "You sent your answers on " + whenText(state.sent.at) + ", then changed them. Press Send again so " + ORG + " has the latest; the latest one counts." }));
    } else if (state.sent) {
      panel.classList.add("is-sent");
      panel.appendChild(h("p", { class: "send-title", text: "Sent to " + ORG }));
      panel.appendChild(h("p", { text: "On " + whenText(state.sent.at) + ". Reference " + state.sent.submissionId + ". If you change an answer, send again; the latest one counts." }));
    } else {
      var open = M.summary(state.answers).open.length;
      panel.appendChild(h("p", { class: "send-title", text: "Ready to send?" }));
      panel.appendChild(h("p", { text: "When you are happy with your answers, press Send to " + ORG + " below." +
        (open ? " " + open + (open === 1 ? " question is" : " questions are") + " still open; you can send now and send again later." : "") }));
    }
    if (scroll) {
      panel.scrollIntoView({ block: "nearest" });
      if (send.status === "error") panel.focus({ preventScroll: true });
    }
  }

  // Confirmation after a successful send.
  function renderSent(main) {
    var s = state.sent;
    var sum = M.summary(state.answers);
    main.appendChild(h("div", { class: "sent-mark", "aria-hidden": "true", text: "✓" }));
    main.appendChild(h("h1", { class: "wm-h2", id: "step-title", text: "Sent to " + ORG }));
    main.appendChild(h("p", { class: "lead", text: "Thank you. " + ORG + " has your choices." }));
    var dl = h("dl", { class: "sent-facts" });
    function fact(k, v) { if (v) { dl.appendChild(h("dt", { text: k })); dl.appendChild(h("dd", { text: v })); } }
    fact("Sent", whenText(s.at));
    fact("Reference", s.submissionId);
    globalThis.SpecEngine.linkFields(SPEC).forEach(function (f) { fact(f.label, String(state.answers[f.question] || "").trim()); });
    fact("Model", SPEC.model);
    fact("Answers", sum.open.length ? sum.open.length + (sum.open.length === 1 ? " question" : " questions") + " still open" : "Every question answered");
    main.appendChild(dl);
    main.appendChild(h("p", { class: "note", id: "sent-again", text: LINK
      ? "You can reopen this same link, change answers and send again — the latest one counts."
      : "You can come back to this page, change answers and send again — the latest one counts." }));
    main.appendChild(h("p", { class: "hint", text: "Your answers stay saved on this device. Download JSON keeps a copy for you." }));
  }

  // ---- events ---------------------------------------------------------------
  app.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-action]") : null;
    if (!btn || !app.contains(btn)) return;
    var action = btn.getAttribute("data-action");
    if (action === "toggle") toggle(btn.getAttribute("data-qid"), btn.getAttribute("data-value"));
    else if (action === "layer") setLayer(btn.getAttribute("data-plan"), btn.getAttribute("data-qid"), false);
    else if (action === "reset") resetForm();
    else if (action === "goto") gotoStep(btn.getAttribute("data-step"), btn.getAttribute("data-qid"));
    else if (action === "back") gotoStep(STEPS[Math.max(0, stepIndex(state.step) - 1)].id);
    else if (action === "next") gotoStep(STEPS[Math.min(STEPS.length - 1, stepIndex(state.step) + 1)].id);
    else if (action === "print") { buildPrint(); window.print(); }
    else if (action === "download") downloadJSON();
    else if (action === "send") sendNow();
  });

  app.addEventListener("input", function (e) {
    var t = e.target;
    if (!t || !t.getAttribute || !t.getAttribute("data-qid")) return;
    if (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") return;
    state.answers = M.setText(state.answers, t.getAttribute("data-qid"), t.value);
    persist();
  });

  window.addEventListener("beforeprint", buildPrint);
  // Another link pasted into the same tab changes only the fragment: reload so it gets its own answers.
  window.addEventListener("hashchange", function () { location.reload(); });

  load();
  render();
})();
