/* Spec form engine: answer model and rules. Generic: knows nothing about any one shed model.
   Reads a spec object (see spec/*.json and BUILD-NOTES.md). Classic script, no modules.
   Works in the browser and in Node (for tests). */
(function (global) {
  "use strict";

  var TEXT_KINDS = { text: true, lines: true };
  var SINGLE_KINDS = { single: true, "plan-single": true };
  var MULTI_KINDS = { multi: true, "plan-multi": true };

  function isQuestionKind(kind) {
    return !!(TEXT_KINDS[kind] || SINGLE_KINDS[kind] || MULTI_KINDS[kind]);
  }

  function createModel(spec) {
    var steps = spec.steps || [];
    var questions = [];
    var byId = {};
    var stepOf = {};

    steps.forEach(function (step) {
      (step.items || []).forEach(function (item) {
        stepOf[item.id] = step.id;
        if (!isQuestionKind(item.kind)) return;
        questions.push(item);
        byId[item.id] = item;
      });
    });

    // ---- rule indexes -------------------------------------------------------
    var alone = {};          // qid -> [optionId] that must stand alone
    var exclusive = {};      // qid -> [[optionId...]] groups, at most one of each group
    var includedBy = {};     // qid -> rule (target question gets one locked, included option)
    var baseIncluded = {};   // qid -> rule (listed options come with the base model)
    var disableRules = [];   // rules of type "disables"
    var disabledBy = {};     // qid -> [rule]

    (spec.rules || []).forEach(function (rule, index) {
      rule._index = index;
      if (rule.type === "alone") (alone[rule.question] = alone[rule.question] || []).push(rule.option);
      else if (rule.type === "exclusive") (exclusive[rule.question] = exclusive[rule.question] || []).push(rule.options);
      else if (rule.type === "includedBy") includedBy[rule.question] = rule;
      else if (rule.type === "baseIncluded") baseIncluded[rule.question] = rule;
      else if (rule.type === "disables") {
        disableRules.push(rule);
        (rule.targets || []).forEach(function (t) { (disabledBy[t] = disabledBy[t] || []).push(rule); });
      }
    });

    // ---- prices ---------------------------------------------------------------
    // spec.prices = {unit, symbol, note}. An option may carry "price"; an "includedBy" / "baseIncluded" rule may
    // carry "extraPrice" (the price of each option beyond the included ones). A price is shown as the tag.
    // With a symbol the price reads "$6,900"; without one, "40 <unit>".
    var PRICES = spec.prices || null;
    function money(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
    function priceText(n) {
      if (PRICES && PRICES.symbol) return PRICES.symbol + money(n);
      return n + (PRICES && PRICES.unit ? " " + PRICES.unit : "");
    }
    function priceTag(n) { return "+" + priceText(n); }
    function hasPrice(obj, key) { return !!obj && typeof obj[key] === "number"; }
    function extraText(rule) { return hasPrice(rule, "extraPrice") ? priceTag(rule.extraPrice) : rule.extraTag; }

    // ---- helpers ------------------------------------------------------------
    function q(id) { return byId[id] || null; }
    function isMulti(qq) { return !!(qq && MULTI_KINDS[qq.kind]); }
    function isSingle(qq) { return !!(qq && SINGLE_KINDS[qq.kind]); }
    function isText(qq) { return !!(qq && TEXT_KINDS[qq.kind]); }

    function option(qq, id) {
      var opts = (qq && qq.options) || [];
      for (var i = 0; i < opts.length; i++) if (opts[i].id === id) return opts[i];
      return null;
    }

    function blank(qq) {
      if (isText(qq)) return "";
      if (isMulti(qq)) return [];
      return null;
    }

    function copy(a) {
      var b = {};
      Object.keys(a || {}).forEach(function (k) { b[k] = Array.isArray(a[k]) ? a[k].slice() : a[k]; });
      return b;
    }

    function valuesOf(qq, a) {
      var v = a[qq.id];
      if (isMulti(qq)) return Array.isArray(v) ? v : [];
      return v == null || v === "" ? [] : [v];
    }

    function holds(when, a) {
      var src = q(when.question);
      if (!src) return false;
      var vals = valuesOf(src, a);
      if (Object.prototype.hasOwnProperty.call(when, "is")) {
        var yes = [].concat(when.is);
        return vals.some(function (v) { return yes.indexOf(v) >= 0; });
      }
      if (Object.prototype.hasOwnProperty.call(when, "isNot")) {
        var no = [].concat(when.isNot);
        return !vals.some(function (v) { return no.indexOf(v) >= 0; });
      }
      return false;
    }

    function activeDisableRule(qid, a) {
      var rules = disabledBy[qid] || [];
      for (var i = 0; i < rules.length; i++) if (holds(rules[i].when, a)) return rules[i];
      return null;
    }

    function isInactive(qid, a) { return !!activeDisableRule(qid, a); }

    // Question whose answer controls this one (for "Edit" jumps to an unused question).
    function controllerOf(qid, a) {
      var r = activeDisableRule(qid, a);
      return r ? r.when.question : null;
    }

    // Clear answers of questions that a rule makes unused. Repeats for chained rules.
    function normalize(a) {
      for (var pass = 0; pass < 5; pass++) {
        var changed = false;
        questions.forEach(function (qq) {
          if (!isInactive(qq.id, a)) return;
          var b = blank(qq);
          var cur = a[qq.id];
          var same = Array.isArray(b) ? (Array.isArray(cur) && !cur.length) : cur === b;
          if (!same) { a[qq.id] = b; changed = true; }
        });
        if (!changed) break;
      }
      return a;
    }

    // Add one option to a many-of answer, applying "alone" and "exclusive" rules.
    function addToMulti(qq, list, value) {
      var lone = alone[qq.id] || [];
      if (lone.indexOf(value) >= 0) list = [];
      else list = list.filter(function (v) { return lone.indexOf(v) < 0; });
      (exclusive[qq.id] || []).forEach(function (group) {
        if (group.indexOf(value) < 0) return;
        list = list.filter(function (v) { return v === value || group.indexOf(v) < 0; });
      });
      if (list.indexOf(value) < 0) list.push(value);
      return list;
    }

    // The option a source answer includes automatically ("includedBy"), or null.
    function includedOption(qq, a) {
      var rule = includedBy[qq.id];
      if (!rule) return null;
      var srcQ = q(rule.source);
      var s = srcQ ? valuesOf(srcQ, a)[0] : null;
      if (s == null) return null;
      var id = rule.map ? rule.map[s] : s;
      return id && option(qq, id) ? id : null;
    }

    function isLocked(qq, value, a) {
      return includedOption(qq, a) === value && valuesOf(qq, a).indexOf(value) < 0;
    }

    // Options that count as chosen, in option order (includes an automatically included one).
    function effective(qq, a) {
      var chosen = valuesOf(qq, a).slice();
      var inc = includedOption(qq, a);
      if (inc && chosen.indexOf(inc) < 0) chosen.push(inc);
      return (qq.options || []).map(function (o) { return o.id; })
        .filter(function (id) { return chosen.indexOf(id) >= 0; });
    }

    // Tags that depend on answers: { optionId: {text, kind} }, kind = "included" | "extra" | "pending" | "swap".
    function tagInfo(qq, a) {
      var tags = {};
      function put(id, text, kind) { if (text) tags[id] = { text: text, kind: kind }; }
      var ib = includedBy[qq.id];
      if (ib) {
        var inc = includedOption(qq, a);
        var explicit = valuesOf(qq, a);
        if (!inc) {
          explicit.forEach(function (v) { put(v, ib.pendingTag, "pending"); });
          return tags;
        }
        effective(qq, a).forEach(function (v) {
          if (v === inc) put(v, ib.includedTag, "included");
          else put(v, extraText(ib), "extra");
        });
        return tags;
      }
      var base = baseIncluded[qq.id];
      if (base) {
        var chosen = valuesOf(qq, a);
        var limit = typeof base.extraAfter === "number" ? base.extraAfter : base.options.length;
        chosen.forEach(function (v) {
          if (!option(qq, v)) return;
          if (base.options.indexOf(v) >= 0) put(v, base.includedTag, "included");
          else if (chosen.length > limit) put(v, extraText(base), "extra");
          else put(v, base.swapTag, "swap");
        });
      }
      return tags;
    }

    // Same as tagInfo, text only: { optionId: "Included" | ... }.
    function dynamicTags(qq, a) {
      var info = tagInfo(qq, a);
      var out = {};
      Object.keys(info).forEach(function (k) { out[k] = info[k].text; });
      return out;
    }

    // The tags a question can show, for a legend: [{kind, text}] in a fixed order.
    function tagLegend(qid) {
      var r = includedBy[qid] || baseIncluded[qid];
      if (!r) return [];
      var extra = hasPrice(r, "extraPrice") ? priceTag(r.extraPrice) + " each" : r.extraTag;
      var list = [["included", r.includedTag], ["extra", extra], ["pending", r.pendingTag], ["swap", r.swapTag]];
      return list.filter(function (x) { return x[1]; }).map(function (x) { return { kind: x[0], text: x[1] }; });
    }

    function hasDynamicTags(qq) { return !!(includedBy[qq.id] || baseIncluded[qq.id]); }

    // Everything the UI needs to paint one option button.
    function optionState(qid, value, a) {
      var qq = q(qid);
      var opt = option(qq, value);
      if (!qq || !opt) return null;
      var dyn = hasDynamicTags(qq);
      var info = dyn ? (tagInfo(qq, a)[value] || null) : null;
      return {
        on: effective(qq, a).indexOf(value) >= 0,
        tag: dyn ? (info ? info.text : "") : (opt.tag || (hasPrice(opt, "price") ? priceTag(opt.price) : "")),
        kind: info ? info.kind : "",
        dynamicTag: dyn,
        locked: isLocked(qq, value, a),
        disabled: isInactive(qid, a)
      };
    }

    // ---- answers ------------------------------------------------------------
    function defaultAnswers() {
      var a = {};
      questions.forEach(function (qq) { a[qq.id] = blank(qq); });
      Object.keys(baseIncluded).forEach(function (qid) {
        if (byId[qid]) a[qid] = baseIncluded[qid].options.filter(function (id) { return option(byId[qid], id); });
      });
      return normalize(a);
    }

    // Keep only answers that are valid for this spec. Never throws.
    function sanitize(raw) {
      var a = defaultAnswers();
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return a;
      questions.forEach(function (qq) {
        if (!Object.prototype.hasOwnProperty.call(raw, qq.id)) return;
        var v = raw[qq.id];
        if (isText(qq)) {
          if (typeof v === "string") a[qq.id] = v;
        } else if (isSingle(qq)) {
          a[qq.id] = typeof v === "string" && option(qq, v) ? v : null;
        } else if (isMulti(qq)) {
          if (!Array.isArray(v)) return;
          var list = [];
          v.forEach(function (val) {
            if (typeof val === "string" && option(qq, val)) list = addToMulti(qq, list, val);
          });
          a[qq.id] = list;
        }
      });
      return normalize(a);
    }

    function toggle(answers, qid, value) {
      var qq = q(qid);
      var a = copy(answers || defaultAnswers());
      if (!qq || !option(qq, value) || isInactive(qid, a)) return a;
      if (isSingle(qq)) {
        a[qid] = a[qid] === value ? null : value;
      } else if (isMulti(qq)) {
        var list = valuesOf(qq, a).slice();
        var at = list.indexOf(value);
        if (at >= 0) list.splice(at, 1);
        else {
          if (isLocked(qq, value, a)) return a;
          list = addToMulti(qq, list, value);
        }
        a[qid] = list;
      }
      return normalize(a);
    }

    function setText(answers, qid, value) {
      var qq = q(qid);
      var a = copy(answers || defaultAnswers());
      if (!isText(qq) || isInactive(qid, a)) return a;
      a[qid] = String(value == null ? "" : value);
      return a;
    }

    function isEmpty(qq, a) {
      if (isInactive(qq.id, a)) return true;
      if (isText(qq)) return !String(a[qq.id] || "").trim();
      return !effective(qq, a).length;
    }

    function answerText(qq, a) {
      if (isInactive(qq.id, a)) return "";
      if (isText(qq)) {
        var text = String(a[qq.id] || "");
        if (qq.suffix && text.trim()) return text.trim() + " " + qq.suffix;
        return text;
      }
      var tags = hasDynamicTags(qq) ? dynamicTags(qq, a) : {};
      var withTags = hasDynamicTags(qq);
      return effective(qq, a).map(function (id) {
        var o = option(qq, id);
        var label = o ? o.label : id;
        return tags[id] ? label + " — " + tags[id] : label;
      }).join(withTags ? "; " : ", ");
    }

    function summary(answers) {
      var a = answers || defaultAnswers();
      // The review step may carry text questions (the client details checked on Review):
      // they come first, as their own section. Other steps follow in their order.
      var detailSteps = steps.filter(function (s) { return s.kind === "review" && (s.items || []).length; });
      var sections = detailSteps.concat(steps.filter(function (s) { return s.kind !== "review"; })).map(function (step) {
        var rows = (step.items || []).filter(function (it) { return byId[it.id]; }).map(function (qq) {
          var inactive = isInactive(qq.id, a);
          var images = [];
          if (!inactive && qq.options) {
            effective(qq, a).forEach(function (id) {
              var o = option(qq, id);
              if (o && o.image) images.push({ src: o.image, alt: "" });
            });
          }
          return {
            id: qq.id,
            label: qq.label,
            answer: answerText(qq, a),
            empty: isEmpty(qq, a),
            inactive: inactive,
            optional: !!qq.optional,
            emptyText: qq.emptyText || "",
            images: images
          };
        });
        return { id: step.id, title: step.kind === "review" ? (step.detailsTitle || "Your details") : step.title, rows: rows };
      });
      var open = [];
      sections.forEach(function (s) {
        s.rows.forEach(function (r) {
          if (r.empty && !r.inactive && !r.optional) // soft = may stay empty on purpose (the question has "emptyText"): sent as unanswered, but the client is not nagged.
          open.push({ step: s.id, id: r.id, label: r.label, section: s.title, soft: !!r.emptyText });
        });
      });
      return { sections: sections, open: open };
    }

    // What the picked answers add to the price: [{question, label, option, optionLabel, price}] and the total.
    // "base" = the studio price of the client's quote (from the personal link), 0 or missing = none.
    // With a base the result also carries the estimate (base + total). "unpriced" = picked options
    // that cost extra but have no list price (their tag is one of prices.quoteTags, or an "extra"
    // of a rule without a price): the manager prices them, so the estimate must say it is not complete.
    function pricing(answers, base) {
      var a = answers || defaultAnswers();
      var items = [], unpriced = [];
      var quoteTags = (PRICES && PRICES.quoteTags) || [];
      questions.forEach(function (qq) {
        if (!qq.options || isInactive(qq.id, a)) return;
        var rule = includedBy[qq.id] || baseIncluded[qq.id];
        var info = rule ? tagInfo(qq, a) : {};
        effective(qq, a).forEach(function (id) {
          var o = option(qq, id);
          var p = null;
          var extra = !!(info[id] && info[id].kind === "extra");
          if (hasPrice(o, "price")) p = o.price;
          else if (hasPrice(rule, "extraPrice") && extra) p = rule.extraPrice;
          if (p != null) items.push({ question: qq.id, label: qq.label, option: id, optionLabel: o ? o.label : id, price: p, text: priceTag(p) });
          else if ((o && o.tag && quoteTags.indexOf(o.tag) >= 0) || extra)
            unpriced.push({ question: qq.id, label: qq.label, option: id, optionLabel: o ? o.label : id, tag: (o && o.tag) || (rule && rule.extraTag) || "" });
        });
      });
      var total = items.reduce(function (sum, x) { return sum + x.price; }, 0);
      var b = typeof base === "number" && base > 0 ? base : 0;
      return {
        enabled: !!PRICES, unit: PRICES ? PRICES.unit || "" : "", note: PRICES ? PRICES.note || "" : "",
        items: items, total: total, totalText: priceText(total), unpriced: unpriced,
        base: b, baseText: b ? priceText(b) : "", estimate: b ? b + total : 0, estimateText: b ? priceText(b + total) : ""
      };
    }

    // Answers as exported: unused questions blank, automatic inclusions written out.
    function exportAnswers(answers) {
      var a = normalize(copy(answers || defaultAnswers()));
      var out = {};
      var tags = {};
      questions.forEach(function (qq) {
        if (isMulti(qq)) out[qq.id] = effective(qq, a);
        else out[qq.id] = a[qq.id] == null ? blank(qq) : a[qq.id];
        if (hasDynamicTags(qq)) tags[qq.id] = dynamicTags(qq, a);
      });
      return { answers: out, tags: tags };
    }

    // ---- finish preview -----------------------------------------------------
    // spec.preview.layers: each layer recolors one outlined part of the photo with the "color"
    // of the option picked in its one-of question. No color (or null) = the photo as it is.
    var previewSpec = spec.preview || null;

    function previewLayers() { return (previewSpec && previewSpec.layers) || []; }

    function previewState(answers) {
      var a = answers || {};
      var layers = previewLayers().map(function (l) {
        var qq = q(l.question);
        var val = qq ? valuesOf(qq, a)[0] : null;
        var opt = val ? option(qq, val) : null;
        return {
          id: l.id, name: l.name || "", question: l.question,
          option: opt ? opt.id : null, label: opt ? opt.label : "",
          color: opt && typeof opt.color === "string" ? opt.color : null
        };
      });
      return { layers: layers, picked: layers.some(function (l) { return !!l.option; }) };
    }

    function isPreviewQuestion(qid) {
      return previewLayers().some(function (l) { return l.question === qid; });
    }

    // ---- client link ----------------------------------------------------------
    // Put the text values read from a link ({questionId: text}) into the answers.
    function applyLink(answers, values) {
      var a = copy(answers || defaultAnswers());
      Object.keys(values || {}).forEach(function (qid) {
        var qq = q(qid);
        if (isText(qq) && !isInactive(qid, a) && typeof values[qid] === "string") a[qid] = values[qid];
      });
      return normalize(a);
    }

    return {
      spec: spec,
      steps: steps,
      questions: questions,
      question: q,
      option: option,
      stepOf: function (id) { return stepOf[id] || null; },
      isMulti: isMulti,
      isSingle: isSingle,
      isText: isText,
      disableRules: disableRules,
      defaultAnswers: defaultAnswers,
      sanitize: sanitize,
      toggle: toggle,
      setText: setText,
      isInactive: isInactive,
      controllerOf: controllerOf,
      effective: effective,
      dynamicTags: dynamicTags,
      tagInfo: tagInfo,
      tagLegend: tagLegend,
      hasDynamicTags: hasDynamicTags,
      optionState: optionState,
      isEmpty: isEmpty,
      answerText: answerText,
      summary: summary,
      pricing: pricing,
      exportAnswers: exportAnswers,
      previewLayers: previewLayers,
      previewState: previewState,
      isPreviewQuestion: isPreviewQuestion,
      applyLink: applyLink
    };
  }

  // ---- client link (the part of the URL after "#") ----------------------------
  // spec.link.fields = [{param, question, label, required}]. A link carries "id" (a random
  // link id) plus one param per field, e.g. "#id=Xb3k9QpLm2Ts7vWa&name=Jane%20Doe&address=...".
  // Browsers do not send the part after "#" to the host. Nothing here stores or sends anything.
  var LINK_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
  var LINK_VALUE_MAX = 300;

  function linkFields(spec) { return (spec && spec.link && spec.link.fields) || []; }

  function cleanLinkValue(v) {
    return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, LINK_VALUE_MAX);
  }

  function decodePart(s) {
    try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch (err) { return null; }
  }

  // Also escape ! ' ( ) * so chat and mail apps that turn text into links do not cut the link
  // at a closing bracket or quote.
  function encodePart(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) { return "%" + c.charCodeAt(0).toString(16).toUpperCase(); });
  }

  // "#id=...&name=...&to=..." from a link id, {param: text} and an optional list of result
  // recipients (emails). Empty values are left out.
  function linkHash(spec, id, byParam, recipients, manager, price) {
    var parts = ["id=" + encodePart(id)];
    linkFields(spec).forEach(function (f) {
      var v = cleanLinkValue(byParam && byParam[f.param]);
      if (v) parts.push(encodePart(f.param) + "=" + encodePart(v));
    });
    var m = cleanManager(manager);
    Object.keys(LINK_MANAGER_PARAMS).forEach(function (k) {
      if (m[k]) parts.push(LINK_MANAGER_PARAMS[k] + "=" + encodePart(m[k]));
    });
    var pr = cleanPrice(price);
    if (pr) parts.push(LINK_PRICE_PARAM + "=" + pr);
    var to = (recipients || []).filter(Boolean).join(",");
    if (to) parts.push(LINK_TO_PARAM + "=" + encodePart(to));
    return "#" + parts.join("&");
  }

  // ---- the studio price of the client's quote ("price" in the link) -------------
  // A whole number of prices.unit. The manager may type "47900", "$47,900" or "47,900.00";
  // the link carries digits only. Anything else reads as 0 = no price, and the form then
  // shows only the prices of the extras. Anyone can edit a link, so it is checked again when read.
  var LINK_PRICE_PARAM = "price";
  // "notes=1": a link for the builder's own team; the form then shows the team notes (spec "teamNotes").
  // Links made on the manager page never carry it, so a client does not see them.
  var LINK_NOTES_PARAM = "notes";
  function cleanPrice(v) {
    var s = cleanLinkValue(v).replace(/[$,\s]/g, "").replace(/\.\d{1,2}$/, "");
    if (!/^\d{1,8}$/.test(s)) return 0;
    var n = parseInt(s, 10);
    return n > 0 ? n : 0;
  }

  // ---- the client's manager (shown on the cover: "contact your manager") --------
  // The link may carry the manager's name, email and a link to book a call. Anyone can edit a
  // link, so each is checked again when read: the email must look like one, the booking link
  // must be a plain https address. Anything else is dropped, never shown or opened.
  var LINK_MANAGER_PARAMS = { name: "mgr", email: "mgremail", book: "book" };

  function bookUrl(text) {
    var s = cleanLinkValue(text);
    if (!/^https:\/\/[^\s"'<>\\]+$/i.test(s)) return "";
    if (typeof URL === "undefined") return s;
    try { var u = new URL(s); return u.protocol === "https:" && u.hostname.indexOf(".") > 0 && !u.username && !u.password ? u.href : ""; }
    catch (err) { return ""; }
  }

  function cleanManager(m) {
    m = m || {};
    var email = cleanLinkValue(m.email).toLowerCase();
    return {
      name: cleanLinkValue(m.name).slice(0, 80),
      email: EMAIL_RE.test(email) && email.length <= 254 ? email : "",
      book: bookUrl(m.book)
    };
  }

  // ---- result recipients ("Send results to") -----------------------------------
  // The link may carry "to=<email>,<email>": where the receiver emails this client's results.
  // The page checks them for the manager's convenience; the receiver enforces its own rules,
  // because anyone can edit a link.
  var LINK_TO_PARAM = "to";
  var RECIPIENTS_MAX = 10;
  var EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

  // Split typed or linked text into addresses: commas, semicolons or spaces; trimmed, lowercase, no repeats.
  function parseRecipients(text) {
    var out = [];
    String(text == null ? "" : text).split(/[\s,;]+/).forEach(function (x) {
      x = x.trim().toLowerCase();
      if (x && x.length <= 254 && out.indexOf(x) < 0) out.push(x);
    });
    return out;
  }

  // Sort addresses into good ones and bad ones: [{address, reason: "format" | "domain"}].
  function checkRecipients(list, allowedDomains) {
    var allowed = (allowedDomains || []).map(function (d) { return String(d).toLowerCase(); });
    var good = [], bad = [];
    (list || []).forEach(function (a) {
      if (!EMAIL_RE.test(a) || a.length > 254) bad.push({ address: a, reason: "format" });
      else if (allowed.indexOf(a.slice(a.lastIndexOf("@") + 1)) < 0) bad.push({ address: a, reason: "domain" });
      else good.push(a);
    });
    return { good: good, bad: bad };
  }

  // Read a fragment: null when there is none; {error: "..."} when it is not a usable link;
  // else {id, values: {questionId: text}} (only the fields the spec declares).
  function readLink(spec, hash) {
    var s = String(hash || "").replace(/^#/, "");
    if (!s) return null;
    var p = Object.create(null);
    s.split("&").forEach(function (pair) {
      if (!pair) return;
      var at = pair.indexOf("=");
      var k = decodePart(at < 0 ? pair : pair.slice(0, at));
      var v = decodePart(at < 0 ? "" : pair.slice(at + 1));
      if (k != null && v != null && !(k in p)) p[k] = v;
    });
    if (!LINK_ID_RE.test(p.id || "")) return { error: "This link is not complete. The form opened without the client details." };
    var values = {};
    linkFields(spec).forEach(function (f) {
      var v = f.param in p ? cleanLinkValue(p[f.param]) : "";
      if (v) values[f.question] = v;
    });
    // Recipients are passed on as the link has them (cleaned, capped); the receiver decides.
    var recipients = LINK_TO_PARAM in p ? parseRecipients(String(p[LINK_TO_PARAM]).slice(0, 3000)).slice(0, RECIPIENTS_MAX * 2) : [];
    var manager = cleanManager({ name: p[LINK_MANAGER_PARAMS.name], email: p[LINK_MANAGER_PARAMS.email], book: p[LINK_MANAGER_PARAMS.book] });
    return { id: p.id, values: values, recipients: recipients, manager: manager, price: cleanPrice(p[LINK_PRICE_PARAM]), notes: p[LINK_NOTES_PARAM] === "1" };
  }

  global.SpecEngine = {
    createModel: createModel, isQuestionKind: isQuestionKind,
    linkFields: linkFields, linkHash: linkHash, readLink: readLink, LINK_ID_RE: LINK_ID_RE,
    LINK_TO_PARAM: LINK_TO_PARAM, RECIPIENTS_MAX: RECIPIENTS_MAX,
    parseRecipients: parseRecipients, checkRecipients: checkRecipients,
    LINK_MANAGER_PARAMS: LINK_MANAGER_PARAMS, cleanManager: cleanManager, bookUrl: bookUrl,
    LINK_PRICE_PARAM: LINK_PRICE_PARAM, cleanPrice: cleanPrice, LINK_NOTES_PARAM: LINK_NOTES_PARAM
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
