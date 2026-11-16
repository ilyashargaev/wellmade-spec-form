/* Spec form engine: the manager's link page. Generic: the fields come from spec.link.fields.
   Builds a personal client link: the form page (named by data-form on #manager, resolved
   relative to this page, so it works on any host and from a folder) plus "#id=<random id>&...".
   Stores nothing and sends nothing: the client details travel only inside the link. */
(function () {
  "use strict";
  var root = document.getElementById("manager");
  var SPEC = globalThis.SPEC_DATA;
  var E = globalThis.SpecEngine;
  if (!SPEC || !E) {
    root.textContent = "This page could not load its spec file. Run the check script, then reload.";
    return;
  }
  var FIELDS = E.linkFields(SPEC);
  var ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"; // 64: no bias
  var ID_LENGTH = 16; // 96 random bits

  function h(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, String(v));
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  function newLinkId() {
    var bytes = new Uint8Array(ID_LENGTH);
    crypto.getRandomValues(bytes);
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += ID_CHARS[bytes[i] & 63];
    return out;
  }

  function formUrl() {
    var u = new URL(root.getAttribute("data-form") || "index.html", location.href);
    u.search = "";
    u.hash = "";
    return u.href;
  }

  // ---- page -------------------------------------------------------------------
  document.title = "Client link" + (SPEC.formName ? " · " + SPEC.formName : "");
  var top = h("header", { class: "top" }, [h("div", { class: "brand" }, [
    SPEC.brand && SPEC.brand.logo ? h("img", { src: SPEC.brand.logo, alt: SPEC.brand.logoAlt || "" }) : h("span"),
    h("p", { class: "eyebrow", text: "Manager" })
  ])]);
  var main = h("main", { id: "main" });
  main.appendChild(h("h1", { class: "wm-h2", text: "Create a client link" }));
  main.appendChild(h("p", { class: "model", text: SPEC.model }));
  main.appendChild(h("p", { class: "lead", text: "Type the client's details and press Create link. Copy the link and send it to the client. When they open it, the form already has these details." }));

  if (!FIELDS.length) {
    main.appendChild(h("p", { class: "banner", text: "This spec has no link fields (\"link\" in the spec file), so no link can be made." }));
    root.appendChild(top);
    root.appendChild(main);
    return;
  }

  var form = h("form", { class: "mgr-form", novalidate: "novalidate" });
  var inputs = {};
  var M = E.createModel(SPEC);
  FIELDS.forEach(function (f) {
    var id = "m-" + f.param;
    var q = M.question(f.question) || {};
    var input = h("input", {
      class: "wm-input", id: id, name: f.param, type: q.inputmode === "tel" ? "tel" : "text", inputmode: q.inputmode,
      autocomplete: "off", required: f.required ? "required" : null, "aria-describedby": "err-" + f.param
    });
    var err = h("p", { class: "field-error", id: "err-" + f.param, text: "" });
    err.hidden = true;
    inputs[f.param] = { input: input, err: err, field: f };
    form.appendChild(h("div", { class: "mgr-field" }, [
      h("label", { class: "wm-h3 field-label", for: id }, [f.label, f.required ? null : h("span", { class: "optional", text: " (optional)" })]),
      h("div", { class: "field" }, [input]),
      err
    ]));
  });
  form.appendChild(h("button", { type: "submit", class: "wm-btn wm-btn--primary mgr-create", text: "Create link" }));
  main.appendChild(form);

  var out = h("textarea", { class: "wm-input link-out", id: "link-out", readonly: "readonly", rows: "4", "aria-label": "Client link" });
  var resultTitle = h("h2", { class: "wm-h3", id: "link-title" });
  var status = h("p", { class: "hint copy-status", id: "copy-status", role: "status", "aria-live": "polite" });
  var result = h("section", { class: "mgr-result", id: "link-result", "aria-labelledby": "link-title" }, [
    resultTitle,
    h("div", { class: "field" }, [out]),
    h("div", { class: "mgr-actions" }, [
      h("button", { type: "button", class: "wm-btn wm-btn--primary", id: "copy-link", text: "Copy" })
    ]),
    status,
    h("p", { class: "hint", text: "Anyone with this link sees these details, so send it only to this client. Each press of Create link makes a new link; the client's answers belong to one link, so if they need to come back, send them the same link again." })
  ]);
  result.hidden = true;
  main.appendChild(result);
  main.appendChild(h("p", { class: "hint mgr-privacy", text: "Nothing on this page is saved or sent. The details travel only inside the link, after the #, which browsers do not send to the web host." }));
  root.appendChild(top);
  root.appendChild(main);

  // ---- behavior ---------------------------------------------------------------
  function showError(param, text) {
    var x = inputs[param];
    x.err.textContent = text;
    x.err.hidden = !text;
    if (text) x.input.setAttribute("aria-invalid", "true");
    else x.input.removeAttribute("aria-invalid");
  }

  function hideResult() {
    if (result.hidden) return;
    result.hidden = true;
    out.value = "";
    status.textContent = "";
  }

  form.addEventListener("input", function (e) {
    var param = e.target && e.target.name;
    if (param && inputs[param]) showError(param, "");
    hideResult(); // a changed detail must never leave an old link on screen
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var values = {};
    var firstBad = null;
    FIELDS.forEach(function (f) {
      var v = inputs[f.param].input.value.trim();
      values[f.param] = v;
      if (f.required && !v) {
        showError(f.param, f.label + " is required.");
        if (!firstBad) firstBad = inputs[f.param].input;
      } else showError(f.param, "");
    });
    if (firstBad) { hideResult(); firstBad.focus(); return; }
    out.value = formUrl() + E.linkHash(SPEC, newLinkId(), values);
    var nameField = FIELDS[0];
    resultTitle.textContent = "Link for " + (values[nameField.param] || "the client");
    status.textContent = "";
    result.hidden = false;
    result.scrollIntoView({ block: "nearest" });
  });

  function copied(ok) {
    status.textContent = ok ? "Copied. Paste it into a text or email to the client."
      : "The link is selected. Copy it with Ctrl+C (on a phone: long-press, then Copy).";
  }

  function selectLink() {
    out.focus();
    out.select();
    out.setSelectionRange(0, out.value.length);
  }

  function fallbackCopy() {
    selectLink();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
    copied(ok);
  }

  document.getElementById("copy-link").addEventListener("click", function () {
    if (!out.value) return;
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(out.value).then(function () { copied(true); }, fallbackCopy);
    } else fallbackCopy();
  });
  out.addEventListener("focus", selectLink);
})();
