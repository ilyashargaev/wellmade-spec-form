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
  var KEY = "spec-form-v2:" + SPEC.specId + (LINK ? ":link:" + LINK.id : "");
  var storageNote = "";
  var state = { step: STEPS[0].id, answers: M.defaultAnswers(), sent: null, view: "form", started: false };
  // Delivery settings (site-config.js), not spec content. Empty submitUrl = no Send button.
  var SITE = globalThis.SITE_CONFIG || {};
  var SEND_URL = typeof SITE.submitUrl === "string" && /^https?:\/\//i.test(SITE.submitUrl.trim()) ? SITE.submitUrl.trim() : "";
  var SEND_TIMEOUT = typeof SITE.sendTimeoutMs === "number" && SITE.sendTimeoutMs > 0 ? SITE.sendTimeoutMs : 25000;
  var send = { status: "idle", error: "" }; // idle | sending | error (in memory only)
  // Who the answers go to, in button and message texts: the spec's brand name (brand.logoAlt).
  var ORG = (SPEC.brand && SPEC.brand.logoAlt) || "the builder";
  var planLayer = {};   // plan id -> id of the plan question whose layer is active
  var seenLayer = {};   // plan id -> {question id: true} for layers shown at least once (this visit only)

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
        state.answers = M.sanitize(data.answers, !data.movableOutletLocations);
        if (data.step && STEPS.some(function (s) { return s.id === data.step; })) state.step = data.step;
        state.started = data.started === true; // a returning client skips the cover
        var sd = data.sent;
        if (sd && typeof sd.at === "string" && typeof sd.submissionId === "string" && typeof sd.fingerprint === "string") {
          state.sent = { at: sd.at, submissionId: sd.submissionId, fingerprint: sd.fingerprint, delivery: sd.delivery || "" };
        }
        restored = true;
      }
    } catch (err) {
      storageNote = "Saved answers on this device could not be read. The form starts empty.";
      state.step = STEPS[0].id;
      state.started = false;
    }
    if (!restored) {
      state.answers = freshAnswers();
      if (LINK && !storageNote) persist(); // marks this link as opened, so later opens keep the client's edits
    }
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        specId: SPEC.specId, specVersion: SPEC.specVersion, movableOutletLocations: true, linkId: LINK ? LINK.id : null,
        step: state.step, started: state.started, answers: state.answers, sent: state.sent
      }));
      if (storageNote) { storageNote = ""; paintBanner(); }
    } catch (err) {
      storageNote = SEND_URL
        ? "Answers are not being kept on this device. Finish and send the form before you close this page."
        : "Answers are not being kept on this device. Download the JSON before you leave.";
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
    // The logo and progress line scroll away; only the step buttons stay pinned.
    // --top-hide = how far the header slides up; --header-h = what stays visible.
    var nav = top ? top.querySelector(".steps") : null;
    var hide = nav ? nav.offsetTop : 0;
    root.setProperty("--top-hide", hide + "px");
    if (top) root.setProperty("--header-h", (Math.ceil(top.getBoundingClientRect().height) - hide) + "px");
    root.setProperty("--preview-h", pv ? Math.ceil(pv.getBoundingClientRect().height) + "px" : "0px");
  }
  window.addEventListener("resize", measure);
  if (typeof ResizeObserver !== "undefined") {
    var ro = new ResizeObserver(measure);
    ro.observe(app);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

  // ---- option buttons -------------------------------------------------------
  var moreOpen = {}; // open "?" and "!" panels, by id (this visit only)
  function choiceButton(q, opt) {
    var st = M.optionState(q.id, opt.id, state.answers);
    var kids = [h("span", { text: opt.label })];
    if (st.dynamicTag || st.tag) {
      var tag = h("span", { class: "wm-tag", text: st.tag });
      if (!st.tag) tag.hidden = true;
      kids.push(quoteTag(st, tag));
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
      st.tag ? quoteTag(st, h("span", { class: "wm-tag", text: st.tag })) : null
    ]);
  }

  // A tag that means "costs extra, no list price" (prices.quoteTags) gets a small "?" next to it.
  // A tap on the tag or the "?" shows prices.quoteHelp in a bubble and does not pick the option.
  // prices.quoteHelpByTag gives a tag its own sentence ("Custom quote": the manager discusses it first).
  // The same sentence is written near the options, so nobody depends on the bubble.
  var QUOTE_TAGS = (SPEC.prices && SPEC.prices.quoteTags) || [];
  var QUOTE_HELP = (SPEC.prices && SPEC.prices.quoteHelp) || "";
  var QUOTE_HELP_BY = (SPEC.prices && SPEC.prices.quoteHelpByTag) || {};
  function quoteHelpFor(tag) { return QUOTE_HELP_BY[tag] || QUOTE_HELP; }
  function quoteTag(st, tag) {
    if (st.dynamicTag || QUOTE_TAGS.indexOf(st.tag) < 0 || !quoteHelpFor(st.tag)) return tag;
    return h("span", { class: "tag-q", "data-tag": st.tag }, [tag, h("span", { class: "tag-q-mark", "aria-hidden": "true", text: "?" })]);
  }
  var tipFor = null;
  function closeTip() {
    var t = document.getElementById("tag-tip");
    if (t) t.parentNode.removeChild(t);
    tipFor = null;
  }
  function toggleTip(anchor) {
    if (tipFor === anchor) { closeTip(); return; }
    closeTip();
    var tip = h("div", { class: "tag-tip", id: "tag-tip", role: "status", text: quoteHelpFor(anchor.getAttribute("data-tag")) });
    document.body.appendChild(tip);
    var r = anchor.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var w = Math.min(280, vw - 24);
    tip.style.width = w + "px";
    tip.style.left = (Math.max(12, Math.min(r.left, vw - w - 12)) + window.scrollX) + "px";
    var bar = app.querySelector(".bar");
    var limit = bar ? bar.getBoundingClientRect().top : window.innerHeight;
    var below = r.bottom + 8 + tip.offsetHeight <= limit;
    tip.style.top = ((below ? r.bottom + 8 : r.top - 8 - tip.offsetHeight) + window.scrollY) + "px";
    tipFor = anchor;
  }
  window.addEventListener("resize", closeTip);

  // Notes from the developer to the builder's team (spec "teamNotes"): a soft "!" by a heading that
  // opens the note under it. Shown only when the link carries notes=1; a client's link never does.
  var TEAM_NOTES = LINK && LINK.notes && SPEC.teamNotes ? SPEC.teamNotes : null;
  function teamNote(owner) { return TEAM_NOTES && owner && owner.teamNote ? TEAM_NOTES[owner.teamNote] || null : null; }
  function teamParts(key, note) {
    var id = "team-" + key, open = !!moreOpen[id];
    var btn = h("button", {
      type: "button", class: "more-btn team-btn", "data-action": "more", "data-qid": id,
      "aria-expanded": open ? "true" : "false", "aria-controls": "more-" + id,
      "aria-label": note.label || "Note for the team"
    }, [h("span", { "aria-hidden": "true", text: "!" })]);
    var kids = [];
    if (note.title) kids.push(h("p", { class: "team-title", text: note.title }));
    (note.text || []).forEach(function (t) { kids.push(h("p", { text: t })); });
    if (note.sign) kids.push(h("p", { class: "team-sign", text: note.sign }));
    var panel = h("div", { class: "more-panel team-note", id: "more-" + id }, kids);
    panel.hidden = !open;
    return { btn: btn, panel: panel };
  }

  function countText(q) { return "Selected: " + M.effective(q, state.answers).length + "."; }

  // The note, hint and count of a question (under its heading).
  function questionNotes(q, into) {
    if (q.note) into.appendChild(h("p", { class: "note", text: q.note }));
    if (q.hint) into.appendChild(h("p", { class: "hint", text: q.hint }));
    if (q.showCount) into.appendChild(h("p", { class: "hint", id: "count-" + q.id, text: countText(q) }));
  }

  // The "?" by a question heading (question "more"): a fuller explanation that opens under the
  // heading. It adds to what the form already says; nothing the client must read is put here.
  // Open panels are remembered while the page is open (not saved): a repaint keeps them open.
  function moreHead(q, heading, into) {
    var open = !!moreOpen[q.id];
    var btn = h("button", {
      type: "button", class: "more-btn", "data-action": "more", "data-qid": q.id,
      "aria-expanded": open ? "true" : "false", "aria-controls": "more-" + q.id,
      "aria-label": q.more.label || "More about this choice"
    }, [h("span", { "aria-hidden": "true", text: "?" })]);
    var panel = h("div", { class: "more-panel", id: "more-" + q.id },
      (q.more.text || []).map(function (t) { return h("p", { text: t }); }));
    panel.hidden = !open;
    into.appendChild(h("div", { class: "q-head" }, [heading, btn]));
    into.appendChild(panel);
  }
  function toggleMore(btn) {
    var id = btn.getAttribute("data-qid"), panel = document.getElementById("more-" + id);
    if (!panel) return;
    moreOpen[id] = !moreOpen[id];
    btn.setAttribute("aria-expanded", moreOpen[id] ? "true" : "false");
    panel.hidden = !moreOpen[id];
  }

  // bare = only the answer controls: a plan question shows its heading above the plan (mountPlan).
  function questionBlock(q, bare) {
    var block = h("section", { class: "q" + (q.lead && !bare ? " has-lead" : ""), id: "q-" + q.id });
    if (!bare) {
      if (q.lead) block.appendChild(h("p", { class: "q-lead", text: q.lead }));
      if (M.isText(q)) block.appendChild(h("label", { class: "wm-h3 field-label" + (q.hideLabel ? " sr-only" : ""), for: "f-" + q.id, text: q.label }));
      else {
        var heading = h("h3", { class: "wm-h3" + (q.hideLabel ? " sr-only" : ""), text: q.ask || q.label });
        var qNote = q.hideLabel ? null : teamNote(q);
        if (q.more && !q.hideLabel) moreHead(q, heading, block);
        else if (qNote) block.appendChild(h("div", { class: "q-head" }, [heading]));
        else block.appendChild(heading);
        if (qNote) {
          var qp = teamParts(q.id, qNote);
          block.querySelector(".q-head").appendChild(qp.btn);
          block.appendChild(qp.panel);
        }
      }
      questionNotes(q, block);
    }

    if (q.kind === "text") {
      var input = h("input", {
        class: "wm-input", id: "f-" + q.id, type: q.inputmode === "tel" ? "tel" : "text", "data-qid": q.id,
        autocomplete: q.autocomplete, inputmode: q.inputmode, placeholder: q.placeholder
      });
      input.value = state.answers[q.id] || "";
      var field = h("div", { class: "field" });
      if (q.suffix) field.appendChild(h("span", { class: "suffix" }, [input, h("em", { text: q.suffix })]));
      else field.appendChild(input);
      block.appendChild(field);
      if (q.id === "dimA" || q.id === "dimB") {
        input.setAttribute("aria-describedby", "error-" + q.id);
        block.appendChild(h("p", { id: "error-" + q.id, class: "hint dimension-error", role: "status", hidden: true }));
      }
    } else if (q.kind === "lines") {
      var area = h("textarea", { class: "wm-input", id: "f-" + q.id, "data-qid": q.id, placeholder: q.placeholder });
      area.value = state.answers[q.id] || "";
      block.appendChild(h("div", { class: "field" }, [area]));
    } else if ((q.kind === "single" || q.kind === "multi") && (q.layout === "photos" || q.layout === "drawings")) {
      var grid = h("div", { class: q.layout === "drawings" ? "photos drawings" : "photos" });
      var groups = {};
      (q.groups || []).forEach(function (g) { groups[g.id] = g; });
      var shown = {};
      var opts = q.options || [];
      opts.forEach(function (opt, oi) {
        var g = opt.group && groups[opt.group];
        if (g && !shown[g.id]) {
          shown[g.id] = true;
          var gTitle = h("h3", { class: "wm-h3", text: g.title || "" });
          var gNote = teamNote(g), gp = gNote ? teamParts(q.id + "-" + g.id, gNote) : null;
          grid.appendChild(h("div", { class: "span2 note-block" }, [
            gp ? h("div", { class: "q-head" }, [gTitle, gp.btn]) : gTitle,
            gp ? gp.panel : null,
            g.text ? h("p", { class: "group-text", text: g.text }) : null
          ]));
        }
        if (opt.image) grid.appendChild(photoButton(q, opt, q.layout === "drawings"));
        else grid.appendChild(h("div", { class: "span2" }, [choiceButton(q, opt)]));
        // group "after": one line under the last tile of the group (what applies to all of them).
        if (g && g.after && (!opts[oi + 1] || opts[oi + 1].group !== g.id)) grid.appendChild(h("p", { class: "span2 group-after", text: g.after }));
      });
      block.appendChild(grid);
    } else if (q.options) {
      var col = h("div", { class: "choices", role: bare ? "group" : null, "aria-label": bare ? q.label : null });
      q.options.forEach(function (opt) { col.appendChild(choiceButton(q, opt)); });
      block.appendChild(col);
    }
    if (q.id === "deckConfig" && SPEC.prices && SPEC.prices.cornerDeck) {
      block.appendChild(h("p", { class: "note", id: "deck-estimate", "aria-live": "polite" }));
    }
    return block;
  }

  // ---- plan viewer -----------------------------------------------------------
  // The whole plan is scaled to the width of the screen; the page scrolls normally over it.
  // Every plan question of a step on the same plan is one layer; chips switch the layer.
  // Only the active layer has tap targets (44 px) with markers; other layers show their picks
  // as small dots. The active question's block (note, hint, buttons by name) sits under the plan.
  var TAG_KINDS = ["included", "extra", "add"];

  function activeLayer(planId, group) {
    var cur = planLayer[planId];
    if (!group.some(function (q) { return q.id === cur; })) cur = planLayer[planId] = group[0].id;
    if (!SEEN_IO) markSeen(planId, cur); // no IntersectionObserver: count the active layer as seen
    return cur;
  }

  // A layer counts as seen when it was the active one while the plan was on screen,
  // or when the client switched to it (chip or Next).
  function markSeen(planId, qid) { (seenLayer[planId] = seenLayer[planId] || {})[qid] = true; }
  var SEEN_IO = typeof IntersectionObserver === "function" ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var box = e.target.closest(".planbox");
      if (!box) return;
      var pid = box.id.slice(5);
      var cur = planLayer[pid];
      if (cur && !(seenLayer[pid] || {})[cur]) { markSeen(pid, cur); paintPlan(pid); }
    });
  }, { threshold: 0.5 }) : null;

  // Next walks through every layer the client has not opened yet, so nobody skips the outlets
  // because they did not see that the chips switch layers. Chips still switch freely.
  function nextUnseenLayer() {
    var boxes = app.querySelectorAll(".planbox");
    for (var i = 0; i < boxes.length; i++) {
      var pid = boxes[i].id.slice(5);
      var group = planGroup(pid);
      if (group.length < 2) continue;
      for (var j = 0; j < group.length; j++) {
        var q = group[j];
        if (!(seenLayer[pid] || {})[q.id] && !M.isInactive(q.id, state.answers)) return { plan: pid, q: q };
      }
    }
    return null;
  }

  function paintNext() {
    var nb = app.querySelector('.bar [data-action="next"]');
    if (!nb) return;
    var t = nextUnseenLayer();
    nb.textContent = t ? "Next: " + (t.q.plan.legend || t.q.label) : "Next";
    nb.classList.toggle("next-layer", !!t);
  }

  function layerHint(n) {
    var words = ["", "One", "Two", "Three", "Four", "Five", "Six"];
    return (words[n] || String(n)) + " things go on this plan. Tap a name to switch between them; Next also takes you through each one.";
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
      group.forEach(function (q, i) {
        chips.appendChild(h("button", {
          type: "button", class: "layer-chip", "data-action": "layer", "data-plan": planId, "data-qid": q.id
        }, [h("span", { class: "num", "aria-hidden": "true", text: String(i + 1) }),
            h("span", { text: q.plan.legend || q.label }), h("span", { class: "count" })]));
      });
      box.appendChild(h("p", { class: "plan-how layer-hint", text: plan.howTo || layerHint(group.length) }));
      box.appendChild(chips);
    } else if (plan.howTo) box.appendChild(h("p", { class: "plan-how", text: plan.howTo }));
    // What is asked, and how to answer on the plan, comes before the plan itself.
    group.forEach(function (q, i) {
      var head = h("div", { class: "plan-head", id: "qh-" + q.id });
      if (group.length > 1) head.appendChild(h("p", { class: "plan-step", text: (i + 1) + " of " + group.length }));
      var heading = h("h3", { class: "wm-h3", text: q.ask || q.label });
      if (q.more) moreHead(q, heading, head);
      else head.appendChild(heading);
      (ruleNotes[q.id] || []).forEach(function (note) { head.appendChild(note); });
      questionNotes(q, head);
      box.appendChild(head);
    });
    var img = h("img", { src: plan.image, alt: plan.alt, draggable: "false" });
    var inner = h("div", { class: "plan-inner" }, [img]);
    group.forEach(function (q) {
      (q.options || []).forEach(function (opt) {
        // plan.markerWord ("Option"): the marker reads "Option 1" where the spots are far enough apart
        // (styles.css shows the word on wide screens); on a phone the number alone stays.
        var word = q.plan.markerWord;
        var dot = h("span", { class: "dot", "aria-hidden": "true" }, word
          ? [h("span", { class: "mk-word", text: word + " " }), document.createTextNode(opt.marker || "")]
          : [document.createTextNode(opt.marker || "")]);
        var btn = h("button", {
          type: "button",
          class: "hot " + (q.plan.shape || "circle") + (word ? " worded" : ""),
          "data-action": "toggle", "data-plan": planId, "data-qid": q.id, "data-value": opt.id
        }, [dot, h("span", { class: "hot-price", "aria-hidden": "true" })]);
        btn.style.left = opt.x + "%";
        btn.style.top = opt.y + "%";
        inner.appendChild(btn);
      });
    });
    // Over the plan of a layer that waits for another answer ("Select the breaker box first").
    var blockBtn = h("button", { type: "button", class: "plan-block", id: "block-" + planId });
    blockBtn.hidden = true;
    var stage = h("div", { class: "plan-stage" }, [inner, blockBtn]);
    box.appendChild(stage);
    if (SEEN_IO && group.length > 1) SEEN_IO.observe(stage);
    box.appendChild(h("div", { class: "legend", id: "legend-" + planId }));
    group.forEach(function (q) {
      var block = questionBlock(q, true);
      block.classList.add("layer");
      block.insertBefore(h("p", { class: "hint list-hint", text: "Or pick from the list:" }), block.firstChild);
      box.appendChild(block);
    });
    return box;
  }

  function legendItem(cls, text) {
    return h("span", {}, [h("i", { class: "hot-sample " + cls, "aria-hidden": "true" }, [h("span", { class: "dot" })]), document.createTextNode(text)]);
  }

  function paintPlan(planId) {
    var box = document.getElementById("plan-" + planId);
    if (!box) return;
    var group = planGroup(planId);
    var active = activeLayer(planId, group);
    var activeQ = M.question(active);
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
      // The price of a spot that can be added is written by the spot, before and after the tap.
      var price = el.querySelector(".hot-price");
      if (price) price.textContent = isActive && (st.kind === "add" || st.kind === "extra") ? st.tag : "";
      if (isActive) {
        el.removeAttribute("aria-hidden");
        el.removeAttribute("tabindex");
        el.setAttribute("aria-label", q.label + ": " + opt.label + (st.tag ? " (" + st.tag + ")" : ""));
      } else {
        el.setAttribute("aria-hidden", "true");
        el.setAttribute("tabindex", "-1");
      }
    }
    var chips = box.querySelectorAll(".layer-chip");
    for (var c = 0; c < chips.length; c++) {
      var cq = M.question(chips[c].getAttribute("data-qid"));
      var n = M.effective(cq, state.answers).length;
      var seen = !!(seenLayer[planId] || {})[cq.id];
      chips[c].setAttribute("aria-pressed", cq.id === active ? "true" : "false");
      chips[c].classList.toggle("seen", seen);
      chips[c].querySelector(".count").textContent = n ? String(n) : "";
      chips[c].setAttribute("aria-label", (cq.plan.legend || cq.label) + (n ? ", " + n + " picked" : ", none picked") + (seen ? "" : ", not opened yet"));
    }
    group.forEach(function (q) {
      var block = document.getElementById("q-" + q.id);
      if (block) block.classList.toggle("layer-off", q.id !== active);
      var head = document.getElementById("qh-" + q.id);
      if (head) head.classList.toggle("layer-off", q.id !== active);
    });
    // A plan whose every question is switched off by a "hide" rule is not shown at all.
    box.hidden = group.every(function (q) { return hiddenByRule(q.id); });
    var stage = box.querySelector(".plan-stage");
    stage.classList.toggle("is-disabled", M.isInactive(active, state.answers));
    // A layer that waits for another answer: the plan is dimmed and says what to pick first;
    // a tap on that text opens the layer of that answer.
    var notes = M.planNotes(active);
    var blocked = M.isBlocked(active, state.answers);
    stage.classList.toggle("is-blocked", blocked);
    var blockBtn = document.getElementById("block-" + planId);
    blockBtn.hidden = !blocked || !notes || !notes.blocked;
    if (!blockBtn.hidden) {
      blockBtn.textContent = notes.blocked;
      if (group.some(function (q) { return q.id === notes.source; })) {
        blockBtn.setAttribute("data-action", "layer");
        blockBtn.setAttribute("data-plan", planId);
        blockBtn.setAttribute("data-qid", notes.source);
      } else blockBtn.removeAttribute("data-action");
    }
    // Under the plan: the shape of each thing placed on it, and which marks are the included ones.
    var legend = document.getElementById("legend-" + planId);
    legend.textContent = "";
    if (group.length > 1) {
      var shapes = h("div", { class: "legend-row" });
      group.forEach(function (q) { shapes.appendChild(legendItem(q.plan.shape || "circle", q.plan.legend || q.label)); });
      legend.appendChild(shapes);
    }
    var hasIncluded = activeQ && (activeQ.options || []).some(function (o) {
      var os = M.optionState(active, o.id, state.answers);
      return os && os.on && os.kind === "included";
    });
    if (notes && notes.included && hasIncluded) {
      legend.appendChild(h("div", { class: "legend-row legend-included" }, [
        legendItem((activeQ.plan.shape || "circle") + " on k-included", notes.included)]));
    }
    legend.hidden = !legend.firstChild;
    paintNext();
  }

  function hiddenByRule(qid) {
    return M.isInactive(qid, state.answers) && M.disableRules.some(function (r) {
      return r.hide && r.targets.indexOf(qid) >= 0;
    });
  }

  function paintPlans() {
    var boxes = app.querySelectorAll(".planbox");
    for (var i = 0; i < boxes.length; i++) paintPlan(boxes[i].id.slice(5));
  }

  function setLayer(planId, qid, focusChip) {
    planLayer[planId] = qid;
    markSeen(planId, qid);
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
      h("button", { type: "button", class: "pv-open", "data-action": "zoom", "aria-label": "Show the finish preview bigger" }, [
        h("canvas", { id: "preview-canvas", width: c[2], height: c[3], role: "img", "aria-label": PV.alt || "Finish preview" })
      ]),
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
    paintEstimate();
    paintDeckEstimate();
  }

  // ---- estimate ------------------------------------------------------------------
  // The personal link may carry the studio price of the client's quote ("price"). Then the bottom
  // bar shows an estimate: that price plus the list prices of the picked options, updated on every
  // tap. Without a price in the link nothing of this shows: only the extras are priced, on Review.
  var EST = (SPEC.prices && SPEC.prices.estimate) || null;
  var BASE = LINK && LINK.price && EST ? LINK.price : 0;
  function pricingNow() { return M.pricing(state.answers, BASE); }

  function paintDeckEstimate() {
    var line = document.getElementById("deck-estimate");
    if (!line) return;
    var a = state.answers;
    var deck = M.deckEstimate(a);
    var container = document.getElementById(a.deckConfig === "custom" ? "q-dimB" : "q-deckConfig");
    if (container && container !== line.parentNode) container.appendChild(line);
    ["dimA", "dimB"].forEach(function (id) {
      var input = document.getElementById("f-" + id);
      var warning = document.getElementById("error-" + id);
      if (!input || !warning) return;
      var max = deck && deck.invalid[id];
      input.setAttribute("aria-invalid", max ? "true" : "false");
      warning.hidden = !max;
      warning.textContent = max ? "Enter a number greater than 0 and up to " + max + " ft, with up to two decimal places. For a larger deck, describe it in Comments for a manager quote." : "";
    });
    line.hidden = !deck;
    if (!deck) return;
    if (a.deckConfig === "step") {
      line.textContent = deck.rate || a.decking === "custom" ? "Your manager will confirm the board upgrade price for the step." : "The standard step is included.";
    } else if (deck.area === null) {
      var d = SPEC.prices.cornerDeck;
      line.textContent = "Enter both dimensions in feet (A up to " + d.frontMax + ", B up to " + d.sideMax + "). For other sizes or shapes, use Comments for a custom quote.";
    } else {
      var cost = deck.base + (deck.upgrade || 0);
      line.textContent = (deck.standard ? "Standard corner deck: " : "Custom corner deck: ") + deck.area + " sq ft · $" + cost.toLocaleString("en-US") +
        (a.decking === "custom" ? " before custom boards." : deck.rate ? " including your board upgrade." : " with standard boards.");
    }
  }

  function estimateBar() {
    return h("div", { class: "bar-est", id: "bar-est", role: "status", "aria-live": "polite" }, [
      h("div", { class: "est-text" }, [
        h("span", { class: "est-k", text: EST.label || "Estimate" }),
        h("span", { class: "est-more", id: "est-more", text: EST.unpricedShort || "" })
      ]),
      h("b", { class: "est-v", id: "est-v" })
    ]);
  }

  function paintEstimate() {
    var v = document.getElementById("est-v");
    if (!v) return;
    var pr = pricingNow();
    var key = v.parentNode.querySelector(".est-k");
    key.textContent = pr.pendingDeck ? "Known subtotal" : EST.label || "Estimate";
    v.textContent = pr.pendingDeck ? pr.knownSubtotalText : pr.estimateText;
    var more = document.getElementById("est-more");
    if (more) {
      more.textContent = pr.estimateStatus || EST.unpricedShort || "";
      more.hidden = !pr.pendingDeck && (!pr.unpriced.length || !EST.unpricedShort);
    }
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
    state.started = false; // back to the cover
    state.sent = null;
    send = { status: "idle", error: "" };
    planLayer = {};
    seenLayer = {};
    persist();
    render();
    window.scrollTo(0, 0);
  }

  // ---- review ---------------------------------------------------------------
  function emptyText(row) {
    if (row.inactive) return "Not used";
    if (row.emptyText) return row.emptyText;
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
    box.appendChild(h("div", { id: "open-list" }));
    sum.sections.forEach(function (section) {
      box.appendChild(h("h3", { class: "wm-h3", text: section.title }));
      if (section.id === step.id) {
        // The client details: checked and corrected right here, not on a page of their own.
        var details = h("div", { class: "details" });
        if (step.detailsHint) details.appendChild(h("p", { class: "hint", text: step.detailsHint }));
        (step.items || []).forEach(function (q) { details.appendChild(questionBlock(q)); });
        box.appendChild(details);
        return;
      }
      section.rows.forEach(function (row) {
        var value = rowValue(row);
        value.appendChild(h("button", {
          type: "button", class: "jump", "data-action": "goto", "data-step": section.id, "data-qid": row.id, text: "Edit"
        }));
        box.appendChild(h("div", { class: "row" }, [h("div", { class: "k", text: row.label }), value]));
      });
    });
    priceRows(box);
    if (SEND_URL) box.appendChild(saveCopyButton());
    box.appendChild(h("div", { class: "reset" }, [
      h("button", { type: "button", class: "wm-btn wm-btn--secondary reset-btn", "data-action": "reset", text: "Start a new form" }),
      h("p", { class: "hint", text: SEND_URL ? "Clears every answer on this device." : "Clears every answer on this device. Download the JSON first if you need it." })
    ]));
    return box;
  }

  // Open questions the client is reminded about: not the ones that may stay empty on purpose.
  function clientOpen(sum) { return sum.open.filter(function (o) { return !o.soft; }); }

  // Priced extras and their total (spec.prices), for Review and the printed sheet.
  function priceRows(into) {
    var pr = pricingNow();
    if (!pr.enabled) return;
    if (pr.base) { estimateRows(into, pr); return; }
    into.appendChild(h("h3", { class: "wm-h3 price-title", text: "Price of your extras" }));
    if (!pr.items.length && !pr.unpriced.length) into.appendChild(h("p", { class: "hint", text: "Nothing with an extra price is picked." }));
    pr.items.forEach(function (it) {
      into.appendChild(h("div", { class: "row price-row" }, [
        h("div", { class: "k", text: it.label }),
        h("div", { class: "v" }, [h("span", { text: it.optionLabel }), h("b", { class: "price", text: it.text })])
      ]));
    });
    pr.unpriced.forEach(function (it) {
      into.appendChild(h("div", { class: "row price-row price-unpriced" }, [
        h("div", { class: "k", text: it.label }),
        h("div", { class: "v", text: it.optionLabel + " — " + it.tag })
      ]));
    });
    if (pr.pendingDeck) into.appendChild(h("p", { class: "note", text: pr.estimateStatus }));
    if (pr.items.length || pr.pendingDeck) into.appendChild(h("div", { class: "row price-row price-total" }, [
      h("div", { class: "k", text: pr.pendingDeck ? "Known subtotal for extras" : "Total for extras" }),
      h("div", { class: "v" }, [h("b", { class: "price price-sum", text: pr.totalText })])
    ]));
    if (pr.note) into.appendChild(h("p", { class: "hint price-note", text: pr.note }));
  }

  // With the studio price from the link: the quote price, each priced option, the options the manager
  // still has to price, the estimate, and the note that says what the estimate is and is not.
  function estimateRows(into, pr) {
    function row(cls, k, vText, priceText) {
      into.appendChild(h("div", { class: "row price-row" + cls }, [
        h("div", { class: "k", text: k }),
        h("div", { class: "v" }, [vText ? h("span", { text: vText }) : null, h("b", { class: "price", text: priceText })])
      ]));
    }
    into.appendChild(h("h3", { class: "wm-h3 price-title", text: pr.estimateStatus || EST.title || EST.label || "Estimate" }));
    row(" price-base", EST.baseLabel || "Studio", "", pr.baseText);
    pr.items.forEach(function (it) { row("", it.label, it.optionLabel, it.text); });
    pr.unpriced.forEach(function (it) { row(" price-unpriced", it.label, it.optionLabel, EST.unpricedLabel || it.tag); });
    into.appendChild(h("div", { class: "row price-row price-total" }, [
      h("div", { class: "k", text: pr.pendingDeck ? "Known subtotal" : EST.label || "Estimate" }),
      h("div", { class: "v" }, [h("b", { class: "price price-sum", text: pr.pendingDeck ? pr.knownSubtotalText : pr.estimateText })])
    ]));
    if (EST.note) into.appendChild(h("p", { class: "hint price-note est-note", text: EST.note }));
  }

  // What is still open, on Review. Repainted while the client types in the details there.
  function paintOpen() {
    var box = document.getElementById("open-list");
    if (!box) return;
    var open = clientOpen(M.summary(state.answers));
    box.textContent = "";
    box.appendChild(h("h3", { class: "wm-h3", text: open.length ? (open.length + " still open") : "Nothing left open" }));
    if (!open.length) box.appendChild(h("p", { class: "hint", text: "Every question has an answer." }));
    open.forEach(function (item) {
      box.appendChild(h("button", {
        type: "button", class: "jump", "data-action": "goto", "data-step": item.step, "data-qid": item.id
      }, [h("span", { text: item.section + " — " + item.label }), h("span", { text: "Edit" })]));
    });
  }

  // ---- step page ------------------------------------------------------------
  function figureEl(item, extra) {
    return h("figure", { class: "figure" + (item.layout ? " " + item.layout : "") + (extra || "") }, [
      h("img", { src: item.image, alt: item.alt || "" }),
      h("figcaption", { text: item.caption || "" })
    ]);
  }

  function renderItems(step, main, skip) {
    var items = (step.items || []).filter(function (it) { return it !== skip; });
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
    var cards = {};
    function home(item) { return (item.card && cards[item.card]) || main; }
    items.forEach(function (item) {
      if (item.kind === "card") {
        var card = h("section", { class: "addon-card", id: "card-" + item.id }, [
          h("div", { class: "addon-head" }, [
            item.image ? h("img", { src: item.image, alt: item.alt || "" }) : null,
            h("div", {}, [
              h("h2", { class: "wm-h3", text: item.title }),
              item.text ? h("p", { class: "addon-text", text: item.text }) : null
            ])
          ])
        ]);
        cards[item.id] = card;
        main.appendChild(card);
        return;
      }
      if (item.kind === "note") {
        main.appendChild(h("section", { class: "note-block wm-card note-card" }, [ // design code: info card
          item.title ? h("h2", { class: "wm-h3", text: item.title }) : null,
          h("p", { text: item.text })
        ]));
        return;
      }
      if (item.kind === "figure") {
        main.appendChild(figureEl(item));
        return;
      }
      if (item.plan) {
        if (mountedPlans[item.plan.id]) return;
        mountedPlans[item.plan.id] = true;
        var group = items.filter(function (it) { return it.plan && it.plan.id === item.plan.id; });
        var notes = {};
        group.forEach(function (q) { notes[q.id] = ruleNotesFor(q); });
        home(item).appendChild(mountPlan(item.plan.id, group, notes));
        return;
      }
      ruleNotesFor(item).forEach(function (note) { home(item).appendChild(note); });
      var block = questionBlock(item);
      if (hiddenByRule(item.id)) block.hidden = true;
      home(item).appendChild(block);
    });
  }

  // "{client}" in a cover text = the answer of that question; a text with an empty answer is left out.
  function fillText(text) {
    var ok = true;
    var out = String(text || "").replace(/\{([A-Za-z][A-Za-z0-9-]*)\}/g, function (_m, id) {
      var v = String(state.answers[id] || "").trim();
      if (!v) ok = false;
      return v;
    });
    return ok ? out : "";
  }

  // "Contact your manager" on the cover (spec.cover.contact). The manager's name, email and
  // booking link come from the personal link; without them the company email and phone of the
  // spec are shown. Email first, then "Book a call" when the link has one, else the phone.
  function coverContact(cc) {
    if (!cc) return null;
    var m = (LINK && LINK.manager) || {};
    var email = m.email || cc.email || "";
    var text = m.name && cc.textNamed ? String(cc.textNamed).replace(/\{manager\}/g, m.name) : cc.text;
    if (!text) return null;
    var ways = [];
    if (email) ways.push(h("a", { class: "cover-way", href: "mailto:" + email, text: email }));
    if (m.book) ways.push(h("a", { class: "cover-way cover-book", href: m.book, target: "_blank", rel: "noopener noreferrer", text: cc.bookLabel || "Book a call" }));
    else if (cc.phone) ways.push(h("a", { class: "cover-way", href: "tel:" + String(cc.phone).replace(/[^0-9+]/g, ""), text: cc.phone }));
    return h("section", { class: "cover-contact", "aria-label": "Contact your manager" }, [
      h("p", { class: "cover-contact-text", text: text }),
      ways.length ? h("p", { class: "cover-ways" }, ways) : null
    ]);
  }

  // The cover (spec.cover): the first screen of a new form. No step buttons, one button to begin.
  function renderCover() {
    var c = SPEC.cover;
    if (SEEN_IO) SEEN_IO.disconnect();
    app.textContent = "";
    app.classList.add("on-cover");
    app.appendChild(h("header", { class: "top" }, [h("div", { class: "brand" }, [
      SPEC.brand && SPEC.brand.logo ? h("img", { src: SPEC.brand.logo, alt: SPEC.brand.logoAlt || "" }) : h("span")
    ])]));
    var banner = h("p", { class: "banner", id: "banner", role: "status" });
    banner.hidden = true;
    app.appendChild(banner);
    paintBanner();
    var main = h("main", { id: "main", class: "cover" });
    if (c.image) main.appendChild(h("figure", { class: "cover-photo" }, [
      h("img", { src: c.image, alt: c.alt || "" }),
      c.caption ? h("figcaption", { text: c.caption }) : null
    ]));
    main.appendChild(h("h1", { class: "wm-h2", id: "step-title", text: c.title }));
    // The greeting is the first line of the text, like the opening of a letter (not a label above the title).
    var hello = fillText(c.hello);
    if (hello) main.appendChild(h("p", { class: "cover-hello", text: hello }));
    (c.text || []).forEach(function (t) { main.appendChild(h("p", { class: "cover-text", text: t })); });
    if (BASE && c.priceText) main.appendChild(h("p", { class: "cover-text cover-price", text: c.priceText }));
    var contact = coverContact(c.contact);
    if (contact) main.appendChild(contact);
    if (c.invite) main.appendChild(h("p", { class: "cover-invite", text: c.invite }));
    main.appendChild(h("button", { type: "button", class: "wm-btn wm-btn--primary cover-start", "data-action": "start", text: c.button || "Start" }));
    app.appendChild(main);
    measure();
    var title = document.getElementById("step-title");
    if (title) { title.setAttribute("tabindex", "-1"); title.focus({ preventScroll: true }); }
  }

  function render() {
    closeTip();
    if (SPEC.cover && !state.started && state.view !== "sent") { renderCover(); return; }
    app.classList.remove("on-cover");
    var step = currentStep();
    var idx = stepIndex(step.id);
    if (SEEN_IO) SEEN_IO.disconnect(); // plans of the previous render are gone
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
    // v3: step.heroLayout pulls the step's first figure into the header.
    // "imageFirst" = photo above the title; "titleFirst" = title, photo, then the text.
    // "?layout=a" / "?layout=b" in the address overrides it (to compare the two).
    var heroLayout = step.heroLayout || "";
    var lm = /(?:^|&)layout=([ab])(?:&|$)/.exec(location.search.slice(1));
    if (heroLayout && lm) heroLayout = lm[1] === "b" ? "titleFirst" : "imageFirst";
    var heroItem = heroLayout && step.items && step.items[0] && step.items[0].kind === "figure" ? step.items[0] : null;
    if (state.view !== "sent") {
      if (heroItem && heroLayout === "imageFirst") main.appendChild(figureEl(heroItem, " hero-top"));
      main.appendChild(h("h1", { class: "wm-h2", id: "step-title", text: step.title }));
      if (heroItem && heroLayout === "titleFirst") main.appendChild(figureEl(heroItem, " hero-mid"));
      if (step.showModel) main.appendChild(h("p", { class: "model", text: SPEC.model }));
      if (step.intro) main.appendChild(h("p", { class: "lead", text: step.intro }));
      if (step.pageRef) main.appendChild(h("p", { class: "page-ref", text: step.pageRef }));
      if (step.hint) main.appendChild(h("p", { class: "hint", text: step.hint }));
    }

    if (state.view === "sent") renderSent(main);
    else if (step.kind === "review") main.appendChild(renderReview(step));
    else {
      if (step.showPreview) main.appendChild(previewBlock(false));
      renderItems(step, main, heroItem);
    }
    // What the estimate is and is not is written once, in the price block on Review (0.3.9:
    // no fine print under the other steps).
    var withEst = BASE > 0 && state.view !== "sent";
    app.classList.toggle("has-est", withEst);
    app.appendChild(main);

    var bar = h("div", { class: "bar" });
    if (withEst) bar.appendChild(estimateBar());
    var inner = h("div", { class: "bar-in" });
    var back = h("button", { type: "button", class: "wm-btn wm-btn--secondary", "data-action": "back", text: "Back" });
    if (idx === 0) back.disabled = true;
    if (state.view === "sent") {
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
    paintOpen();
    paintSend();
    paintEstimate();
    paintDeckEstimate();
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
    state.started = true;
    persist();
    render();
    window.scrollTo(0, 0);
    if (focusId) {
      var el = document.getElementById("q-" + focusId);
      if (el && !el.hidden) {
        // A plan question: show its heading and the plan, which sit above its list of buttons.
        (document.getElementById("qh-" + focusId) || el).scrollIntoView({ block: "start" });
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
      pricing: (function (pr) {
        return pr.enabled ? { unit: pr.unit, note: pr.base && EST ? EST.note : pr.note, total: pr.total,
          base: pr.base, estimate: pr.estimate, pendingDeck: pr.pendingDeck, estimateStatus: pr.estimateStatus, knownSubtotal: pr.knownSubtotal, unpriced: pr.unpriced,
          items: pr.items.map(function (it) { return { question: it.question, option: it.option, label: it.label, optionLabel: it.optionLabel, price: it.price }; }) } : null;
      })(pricingNow()),
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

  function saveCopyButton() {
    return h("button", { type: "button", class: "wm-btn wm-btn--secondary", "data-action": "print", text: "Print or save a PDF" });
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
    var openNow = clientOpen(sum);
    if (openNow.length) {
      printSheet.appendChild(h("h2", { text: "Still open" }));
      openNow.forEach(function (o) { printSheet.appendChild(h("p", { text: o.section + " — " + o.label })); });
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
    priceRows(printSheet);
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
    if (kind === "refused") return ORG + "’s server did not accept the answers (" + detail + "). Press Retry; if it happens again, contact your manager.";
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
      if (data && data.ok === false && typeof data.submissionId === "string" &&
          ["mail_failed", "mail_quota", "pdf_failed", "no_recipient"].indexOf(data.error) >= 0) {
        return { submissionId: data.submissionId, delivery: "archived" };
      }
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
      state.sent = { at: payload.sentAt, submissionId: data.submissionId, fingerprint: print, delivery: data.delivery || "" };
      persist();
      if (fingerprint() === print) state.view = "sent";
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
      panel.appendChild(h("p", { class: "send-title", text: state.sent.delivery === "archived" ? "Saved by " + ORG : "Sent to " + ORG }));
      panel.appendChild(h("p", { text: (state.sent.delivery === "archived" ? "The manager email could not be sent. Give your manager this reference to find your saved choices. " : "") + "On " + whenText(state.sent.at) + ". Reference " + state.sent.submissionId + ". If you change an answer, send again; the latest one counts." }));
    } else {
      var open = clientOpen(M.summary(state.answers)).length;
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
    main.appendChild(h("h1", { class: "wm-h2", id: "step-title", text: s.delivery === "archived" ? "Saved by " + ORG : "Sent to " + ORG }));
    main.appendChild(h("p", { class: "lead", text: s.delivery === "archived" ? ORG + " saved your choices, but the email could not be sent. Give your manager the reference below." : "Thank you. " + ORG + " has your choices." }));
    var dl = h("dl", { class: "sent-facts" });
    function fact(k, v) { if (v) { dl.appendChild(h("dt", { text: k })); dl.appendChild(h("dd", { text: v })); } }
    fact("Sent", whenText(s.at));
    fact("Reference", s.submissionId);
    globalThis.SpecEngine.linkFields(SPEC).forEach(function (f) { fact(f.label, String(state.answers[f.question] || "").trim()); });
    fact("Model", SPEC.model);
    var left = clientOpen(sum).length;
    fact("Answers", left ? left + (left === 1 ? " question" : " questions") + " still open" : "Every question answered");
    main.appendChild(dl);
    main.appendChild(saveCopyButton());
    main.appendChild(h("p", { class: "note", id: "sent-again", text: LINK
      ? "You can reopen this same link, change answers and send again — the latest one counts."
      : "You can come back to this page, change answers and send again — the latest one counts." }));
    main.appendChild(h("p", { class: "hint", text: "Your answers stay saved on this device." }));
  }

  // ---- events ---------------------------------------------------------------
  app.addEventListener("click", function (e) {
    var tq = e.target.closest ? e.target.closest(".tag-q") : null;
    if (tq) { toggleTip(tq); return; } // the "?" by a tag explains the tag; it does not pick the option
    closeTip();
    var btn = e.target.closest ? e.target.closest("[data-action]") : null;
    if (!btn || !app.contains(btn)) return;
    var action = btn.getAttribute("data-action");
    if (action === "toggle") toggle(btn.getAttribute("data-qid"), btn.getAttribute("data-value"));
    else if (action === "layer") setLayer(btn.getAttribute("data-plan"), btn.getAttribute("data-qid"), false);
    else if (action === "reset") resetForm();
    else if (action === "start") { state.started = true; persist(); render(); window.scrollTo(0, 0); }
    else if (action === "goto") gotoStep(btn.getAttribute("data-step"), btn.getAttribute("data-qid"));
    else if (action === "back") gotoStep(STEPS[Math.max(0, stepIndex(state.step) - 1)].id);
    else if (action === "next") {
      var unseen = nextUnseenLayer();
      if (unseen) {
        setLayer(unseen.plan, unseen.q.id, true);
        var pb = document.getElementById("plan-" + unseen.plan);
        var pinned = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 0; // step buttons only
        if (pb) window.scrollTo(0, pb.getBoundingClientRect().top + window.scrollY - pinned - 8);
      } else gotoStep(STEPS[Math.min(STEPS.length - 1, stepIndex(state.step) + 1)].id);
    }
    else if (action === "print") { buildPrint(); window.print(); }
    else if (action === "download") downloadJSON();
    else if (action === "send") sendNow();
    else if (action === "zoom") openZoom();
    else if (action === "more") toggleMore(btn);
  });

  // ---- enlarged finish preview (tap the preview) ------------------------------
  var zoomBack = null;
  function openZoom() {
    var c = document.getElementById("preview-canvas");
    if (!c || document.getElementById("pv-zoom")) return;
    var src;
    try { src = c.toDataURL("image/jpeg", 0.9); } catch (err) { return; }
    var picked = document.getElementById("preview-picked");
    var cap = picked ? picked.cloneNode(true) : null;
    if (cap) cap.removeAttribute("id");
    var close = h("button", { type: "button", class: "wm-btn wm-btn--secondary pv-zoom-close", text: "Close" });
    var ov = h("div", { class: "pv-zoom", id: "pv-zoom", role: "dialog", "aria-modal": "true", "aria-label": "Finish preview, enlarged" }, [
      h("img", { src: src, alt: PV.alt || "" }),
      h("div", { class: "pv-zoom-cap" }, [cap, PV.caption ? h("p", { class: "pv-note", text: PV.caption }) : null]),
      close
    ]);
    ov.addEventListener("click", function (e) { if (e.target === ov || e.target === close || e.target.tagName === "IMG") closeZoom(); });
    zoomBack = document.activeElement;
    document.body.appendChild(ov);
    document.body.classList.add("zoom-open");
    close.focus();
  }
  function closeZoom() {
    var ov = document.getElementById("pv-zoom");
    if (!ov) return;
    ov.remove();
    document.body.classList.remove("zoom-open");
    if (zoomBack && zoomBack.focus) zoomBack.focus({ preventScroll: true });
    zoomBack = null;
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeZoom(); closeTip(); } });

  app.addEventListener("input", function (e) {
    var t = e.target;
    if (!t || !t.getAttribute || !t.getAttribute("data-qid")) return;
    if (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") return;
    state.answers = M.setText(state.answers, t.getAttribute("data-qid"), t.value);
    persist();
    if (t.getAttribute("data-qid") === "dimA" || t.getAttribute("data-qid") === "dimB") {
      paintDeckEstimate();
      paintEstimate();
    }
    if (document.getElementById("open-list")) { paintOpen(); paintSend(); } // details typed on Review
  });

  window.addEventListener("beforeprint", buildPrint);
  // Another link pasted into the same tab changes only the fragment: reload so it gets its own answers.
  window.addEventListener("hashchange", function () { location.reload(); });

  // On the web, the bare address (no personal link) or a broken link shows a short "how to get your
  // link" screen instead of an empty form. The plain form still opens from file:// (local work, tests)
  // and with "?preview" in the address (staff demos).
  var PLAIN_OK = location.protocol === "file:" || /(?:^|&)preview(?:=|&|$)/.test(location.search.slice(1));
  if (!LINK && !PLAIN_OK) { renderNoLink(); return; }

  load();
  render();

  function renderNoLink() {
    app.textContent = "";
    app.classList.add("nolink");
    app.appendChild(h("header", { class: "top" }, [h("div", { class: "brand" }, [
      SPEC.brand && SPEC.brand.logo ? h("img", { src: SPEC.brand.logo, alt: SPEC.brand.logoAlt || "" }) : h("span")
    ])]));
    var main = h("main", { id: "main" });
    main.appendChild(h("h1", { class: "wm-h2", text: "Finishes and options for your " + ORG + " studio" }));
    main.appendChild(h("p", { class: "lead", text: "This is where " + ORG + " clients choose the finishes and options for their studio. Each client gets a personal link to their own form." }));
    if (linkNote) main.appendChild(h("p", { class: "nolink-warn", role: "status", text: "This link is not complete: part of it was probably cut off when it was copied." }));
    main.appendChild(h("h2", { class: "wm-h3 nolink-h", text: "How to start" }));
    main.appendChild(h("p", { class: "nolink-p", text: "Open the personal link your " + ORG + " manager sent you. Your form opens with your details already filled in." }));
    main.appendChild(h("p", { class: "nolink-p", text: "No link yet, or it does not open? Ask your " + ORG + " manager to send it again." }));
    if (SPEC.brand && SPEC.brand.footer) main.appendChild(h("p", { class: "page-ref nolink-foot", text: SPEC.brand.footer }));
    app.appendChild(main);
  }
})();
