"""Check a spec file and build the copy the page loads.

Usage (from this folder, Python 3, nothing to install):
    python check_spec.py                  # checks every spec/*.json
    python check_spec.py spec/presidio-xo.json

For each spec/<name>.json it checks structure, ids, image files and rules.
If there are no errors it writes spec/<name>.js (window.SPEC_DATA = ...),
which index.html loads; the .js is generated, never edit it by hand.
The .js also carries the finish-preview photo as embedded data
(window.SPEC_ASSETS), because a page opened from a folder (file://) may show
a photo file but may not recolor its pixels. The photo stays a file in images/.
If there are errors it prints them with their place, does not touch the .js,
and exits with code 1.
"""
import base64
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IMAGE_DIR = "images"
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg")
ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9-]*$")
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}

QUESTION_KINDS = {"text", "lines", "single", "multi", "plan-single", "plan-multi"}
OPTION_KINDS = {"single", "multi", "plan-single", "plan-multi"}
MULTI_KINDS = {"multi", "plan-multi"}
ITEM_KINDS = QUESTION_KINDS | {"figure", "note"}
SHAPES = {"circle", "square", "diamond"}
LAYOUTS = {"photos", "drawings"}
FIGURE_LAYOUTS = {"product", "product wide"}

TOP_KEYS = {"specId", "specVersion", "formName", "title", "pageTitle", "model", "modelNote",
            "sources", "brand", "download", "link", "plans", "preview", "steps", "rules"}
LINK_PARAM_RE = re.compile(r"^[a-z][a-z0-9]*$")
LINK_RESERVED = {"id", "to"}  # the link id travels as "id", the result recipients as "to"
STEP_KEYS = {"id", "kind", "title", "short", "pageRef", "intro", "hint", "showModel", "showPreview", "heroLayout", "items"}
COMMON_Q = {"id", "kind", "label", "hint", "note", "optional"}
ITEM_KEYS = {
    "text": COMMON_Q | {"autocomplete", "inputmode", "suffix"},
    "lines": COMMON_Q,
    "single": COMMON_Q | {"options", "layout", "groups"},
    "multi": COMMON_Q | {"options", "layout", "groups"},
    "plan-single": COMMON_Q | {"options", "plan", "showCount"},
    "plan-multi": COMMON_Q | {"options", "plan", "showCount"},
    "figure": {"id", "kind", "image", "alt", "caption", "layout"},
    "note": {"id", "kind", "title", "text"},
}
OPTION_KEYS = {"id", "label", "tag", "image", "group", "color"}
PLAN_OPTION_KEYS = {"id", "label", "tag", "marker", "x", "y"}
RULE_KEYS = {
    "alone": {"type", "question", "option", "why"},
    "exclusive": {"type", "question", "options", "why"},
    "includedBy": {"type", "question", "source", "map", "includedTag", "extraTag", "pendingTag", "why"},
    "baseIncluded": {"type", "question", "options", "includedTag", "extraTag", "swapTag", "extraAfter", "why"},
    "disables": {"type", "when", "targets", "hide", "note", "why"},
}


def image_size(full):
    """(width, height) of a PNG, JPEG or GIF file, read from its header; None if unknown."""
    try:
        with open(full, "rb") as fh:
            head = fh.read(26)
            if head[:8] == b"\x89PNG\r\n\x1a\n":
                return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")
            if head[:6] in (b"GIF87a", b"GIF89a"):
                return int.from_bytes(head[6:8], "little"), int.from_bytes(head[8:10], "little")
            if head[:2] != b"\xff\xd8":
                return None
            fh.seek(2)
            while True:
                b = fh.read(1)
                while b and b != b"\xff":
                    b = fh.read(1)
                while b == b"\xff":
                    b = fh.read(1)
                if not b:
                    return None
                marker = b[0]
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                    continue
                seg = int.from_bytes(fh.read(2), "big")
                if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                    data = fh.read(5)
                    return int.from_bytes(data[3:5], "big"), int.from_bytes(data[1:3], "big")
                fh.seek(seg - 2, 1)
    except OSError:
        return None


class Checker:
    def __init__(self, path):
        self.path = path
        self.errors = []
        self.warnings = []
        self.images = set()
        self.assets = []          # images embedded into the .js (preview photo)
        self.colored = {}         # question id -> where, for questions whose options carry "color"

    def err(self, where, msg):
        self.errors.append("%s: %s" % (where, msg))

    def warn(self, where, msg):
        self.warnings.append("%s: %s" % (where, msg))

    # -- small helpers ---------------------------------------------------------
    def keys(self, obj, allowed, where):
        for k in obj:
            if k not in allowed:
                self.err(where, 'unknown field "%s" (allowed: %s)' % (k, ", ".join(sorted(allowed))))

    def need_str(self, obj, key, where, required=True):
        v = obj.get(key)
        if v is None:
            if required:
                self.err(where, 'missing "%s"' % key)
            return None
        if not isinstance(v, str) or not v.strip():
            self.err(where, '"%s" must be non-empty text' % key)
            return None
        return v

    def need_bool(self, obj, key, where):
        if key in obj and not isinstance(obj[key], bool):
            self.err(where, '"%s" must be true or false' % key)

    def need_id(self, obj, where):
        v = obj.get("id")
        if not isinstance(v, str) or not ID_RE.match(v):
            self.err(where, 'id %r must start with a letter and use only letters, digits and "-"' % (v,))
            return None
        return v

    def image(self, value, where, field="image"):
        if not isinstance(value, str) or not value:
            self.err(where, '"%s" must be a relative file path like "%s/name.jpg"' % (field, IMAGE_DIR))
            return
        if "\\" in value or value.startswith("/") or ".." in value.split("/") or ":" in value:
            self.err(where, '"%s" %r must be a relative path with "/" inside the %s folder' % (field, value, IMAGE_DIR))
            return
        if not value.startswith(IMAGE_DIR + "/"):
            self.err(where, '"%s" %r must be inside the %s/ folder' % (field, value, IMAGE_DIR))
            return
        if not value.lower().endswith(IMAGE_EXT):
            self.err(where, '"%s" %r is not an image type (%s)' % (field, value, " ".join(IMAGE_EXT)))
        full = os.path.join(HERE, *value.split("/"))
        if not os.path.isfile(full):
            self.err(where, 'image file not found: %s' % value)
            return
        # Exact case matters on a web host even though Windows ignores it.
        folder, name = os.path.split(full)
        if name not in os.listdir(folder):
            self.err(where, 'image file name case differs from the disk: %s' % value)
        self.images.add(value)
        return full

    # -- the checks ------------------------------------------------------------
    def run(self, spec):
        if not isinstance(spec, dict):
            self.err("top", "the file must hold one JSON object { ... }")
            return
        self.keys(spec, TOP_KEYS, "top")
        sid = spec.get("specId")
        if not isinstance(sid, str) or not ID_RE.match(sid):
            self.err("top", '"specId" must be an id like "presidio-xo"')
        ver = spec.get("specVersion")
        if not isinstance(ver, str) or not VERSION_RE.match(ver):
            self.err("top", '"specVersion" must look like "1.0.0"')
        for k in ("title", "model"):
            self.need_str(spec, k, "top")
        for k in ("formName", "pageTitle", "modelNote"):
            self.need_str(spec, k, "top", required=False)
        if "sources" in spec and not (isinstance(spec["sources"], list) and all(isinstance(s, str) for s in spec["sources"])):
            self.err("top", '"sources" must be a list of text')

        brand = spec.get("brand", {})
        if not isinstance(brand, dict):
            self.err("brand", "must be an object")
            brand = {}
        self.keys(brand, {"logo", "logoAlt", "footer"}, "brand")
        if "logo" in brand:
            self.image(brand["logo"], "brand", "logo")

        plans = spec.get("plans", {})
        if not isinstance(plans, dict):
            self.err("plans", "must be an object of named plans")
            plans = {}
        for pid, plan in plans.items():
            where = 'plans "%s"' % pid
            if not ID_RE.match(pid):
                self.err(where, "plan name must start with a letter and use letters, digits and -")
            if not isinstance(plan, dict):
                self.err(where, "must be an object")
                continue
            self.keys(plan, {"image", "alt", "width"}, where)
            self.image(plan.get("image"), where)
            self.need_str(plan, "alt", where)
            w = plan.get("width")
            if not isinstance(w, (int, float)) or isinstance(w, bool) or w < 200 or w > 4000:
                self.err(where, '"width" must be a number of pixels between 200 and 4000')

        steps = spec.get("steps")
        if not isinstance(steps, list) or not steps:
            self.err("steps", "must be a non-empty list")
            steps = []
        questions = {}
        step_ids = set()
        item_ids = {}
        used_plans = set()
        review_steps = 0
        for si, step in enumerate(steps):
            swhere = "steps[%d]" % si
            if not isinstance(step, dict):
                self.err(swhere, "must be an object")
                continue
            sid_ = self.need_id(step, swhere)
            if sid_:
                swhere = 'steps[%d] "%s"' % (si, sid_)
                if sid_ in step_ids:
                    self.err(swhere, 'duplicate step id "%s"' % sid_)
                step_ids.add(sid_)
            self.keys(step, STEP_KEYS, swhere)
            self.need_str(step, "title", swhere)
            if "heroLayout" in step and step["heroLayout"] not in ("imageFirst", "titleFirst"):
                self.err(swhere, 'heroLayout must be "imageFirst" or "titleFirst"')
            for b in ("showModel", "showPreview"):
                self.need_bool(step, b, swhere)
            if step.get("kind") not in (None, "review"):
                self.err(swhere, '"kind" can only be "review" (or left out)')
            if step.get("kind") == "review":
                review_steps += 1
                if "items" in step:
                    self.err(swhere, "a review step has no items")
                continue
            items = step.get("items")
            if not isinstance(items, list) or not items:
                self.err(swhere, '"items" must be a non-empty list')
                continue
            for ii, item in enumerate(items):
                where = "%s > items[%d]" % (swhere, ii)
                if not isinstance(item, dict):
                    self.err(where, "must be an object")
                    continue
                iid = self.need_id(item, where)
                if iid:
                    where = '%s > items[%d] "%s"' % (swhere, ii, iid)
                    if iid in item_ids:
                        self.err(where, 'duplicate item id "%s" (also at %s)' % (iid, item_ids[iid]))
                    else:
                        item_ids[iid] = where
                kind = item.get("kind")
                if kind not in ITEM_KINDS:
                    self.err(where, '"kind" %r must be one of: %s' % (kind, ", ".join(sorted(ITEM_KINDS))))
                    continue
                self.keys(item, ITEM_KEYS[kind], where)
                if kind == "figure":
                    self.image(item.get("image"), where)
                    self.need_str(item, "alt", where)
                    if "layout" in item and item["layout"] not in FIGURE_LAYOUTS:
                        self.err(where, '"layout" must be one of: %s' % ", ".join(sorted(FIGURE_LAYOUTS)))
                    continue
                if kind == "note":
                    self.need_str(item, "text", where)
                    continue
                self.need_str(item, "label", where)
                self.need_bool(item, "optional", where)
                self.need_bool(item, "showCount", where)
                if iid:
                    questions[iid] = item
                if kind in OPTION_KINDS:
                    self.check_options(item, kind, where, plans, used_plans)
        if review_steps > 1:
            self.err("steps", "only one review step is allowed")
        if steps and review_steps and (steps[-1].get("kind") != "review"):
            self.warn("steps", "the review step is usually the last step")
        for pid in plans:
            if pid not in used_plans:
                self.warn('plans "%s"' % pid, "no question uses this plan")

        self.check_preview(spec.get("preview"), questions)
        self.check_download(spec.get("download"), questions)
        self.check_link(spec.get("link"), questions)
        self.check_rules(spec.get("rules", []), questions)

    def check_options(self, item, kind, where, plans, used_plans):
        is_plan = kind.startswith("plan-")
        if is_plan:
            p = item.get("plan")
            if not isinstance(p, dict):
                self.err(where, '"plan" must be an object like {"id": "...", "shape": "circle"}')
            else:
                self.keys(p, {"id", "shape", "legend"}, where + " > plan")
                if p.get("id") not in plans:
                    self.err(where + " > plan", 'plan "%s" is not defined in "plans"' % p.get("id"))
                else:
                    used_plans.add(p.get("id"))
                if p.get("shape", "circle") not in SHAPES:
                    self.err(where + " > plan", '"shape" must be one of: %s' % ", ".join(sorted(SHAPES)))
        if "layout" in item and item["layout"] not in LAYOUTS:
            self.err(where, '"layout" must be one of: %s' % ", ".join(sorted(LAYOUTS)))
        groups = {}
        for gi, g in enumerate(item.get("groups", []) if isinstance(item.get("groups", []), list) else []):
            gw = "%s > groups[%d]" % (where, gi)
            if not isinstance(g, dict):
                self.err(gw, "must be an object")
                continue
            self.keys(g, {"id", "title", "text"}, gw)
            gid = self.need_id(g, gw)
            self.need_str(g, "title", gw)
            if gid in groups:
                self.err(gw, 'duplicate group id "%s"' % gid)
            if gid:
                groups[gid] = 0
        if "groups" in item and not isinstance(item["groups"], list):
            self.err(where, '"groups" must be a list')
        opts = item.get("options")
        if not isinstance(opts, list) or not opts:
            self.err(where, '"options" must be a non-empty list')
            return
        seen = set()
        for oi, o in enumerate(opts):
            ow = "%s > options[%d]" % (where, oi)
            if not isinstance(o, dict):
                self.err(ow, "must be an object")
                continue
            oid = self.need_id(o, ow)
            if oid:
                ow = '%s > options[%d] "%s"' % (where, oi, oid)
                if oid in seen:
                    self.err(ow, 'duplicate option id "%s" in this question' % oid)
                seen.add(oid)
            self.keys(o, PLAN_OPTION_KEYS if is_plan else OPTION_KEYS, ow)
            self.need_str(o, "label", ow)
            self.need_str(o, "tag", ow, required=False)
            if is_plan:
                for axis in ("x", "y"):
                    v = o.get(axis)
                    if not isinstance(v, (int, float)) or isinstance(v, bool) or not 0 <= v <= 100:
                        self.err(ow, '"%s" must be a number from 0 to 100 (percent of the plan)' % axis)
                if "marker" in o and not isinstance(o["marker"], str):
                    self.err(ow, '"marker" must be short text like "1"')
            else:
                if "image" in o:
                    self.image(o["image"], ow)
                elif item.get("layout") == "drawings":
                    self.err(ow, 'a "drawings" layout needs an "image" on every option')
                if "color" in o:
                    c = o["color"]
                    if c is not None and not (isinstance(c, str) and HEX_RE.match(c)):
                        self.err(ow, '"color" %r must be a hex color like "#8a725d", or null to keep the photo as it is' % (c,))
                    self.colored.setdefault(item.get("id"), where)
                if "group" in o:
                    if o["group"] not in groups:
                        self.err(ow, 'group "%s" is not defined in this question\'s "groups"' % o["group"])
                    else:
                        groups[o["group"]] += 1
        for gid, n in groups.items():
            if n == 0:
                self.warn(where, 'group "%s" has no options, its heading will not show' % gid)

    def opt_ids(self, q):
        return [o.get("id") for o in q.get("options", []) if isinstance(o, dict)]

    def check_preview(self, pv, questions):
        layer_questions = set()
        if pv is not None:
            self._check_preview(pv, questions, layer_questions)
        for qid, where in self.colored.items():
            if qid not in layer_questions:
                self.warn(where, 'options have "color" but no preview layer uses question "%s"' % qid)

    def _check_preview(self, pv, questions, layer_questions):
        where = "preview"
        if not isinstance(pv, dict):
            self.err(where, "must be an object")
            return
        self.keys(pv, {"photo", "crop", "alt", "caption", "empty", "layers"}, where)
        for k in ("alt", "caption", "empty"):
            self.need_str(pv, k, where, required=False)
        size = None
        if "photo" not in pv:
            self.err(where, 'missing "photo" (the picture the preview recolors, e.g. "images/preview.jpg")')
        else:
            full = self.image(pv["photo"], where, "photo")
            if full:
                ext = os.path.splitext(full)[1].lower()
                if ext not in MIME:
                    self.err(where, '"photo" must be a .jpg, .png, .webp or .gif file')
                size = image_size(full)
                if size is None:
                    self.err(where, '"photo" %s: cannot read the picture size (use a normal .jpg or .png)' % pv["photo"])
                elif ext in MIME:
                    self.assets.append(pv["photo"])
        W, H = size if size else (None, None)
        crop = pv.get("crop")
        if crop is not None:
            ok = (isinstance(crop, list) and len(crop) == 4 and
                  all(isinstance(v, int) and not isinstance(v, bool) for v in crop))
            if not ok:
                self.err(where, '"crop" must be [x, y, width, height] in whole pixels of the photo')
            elif crop[0] < 0 or crop[1] < 0 or crop[2] <= 0 or crop[3] <= 0:
                self.err(where, '"crop" %s: x and y must be 0 or more, width and height more than 0' % crop)
            elif size and (crop[0] + crop[2] > W or crop[1] + crop[3] > H):
                self.err(where, '"crop" %s goes outside the photo (%d x %d pixels)' % (crop, W, H))
        layers = pv.get("layers")
        if not isinstance(layers, list) or not layers:
            self.err(where, '"layers" must be a non-empty list (one per recolored part, e.g. facade, deck)')
            return
        seen = set()
        for li, layer in enumerate(layers):
            lw = "%s > layers[%d]" % (where, li)
            if not isinstance(layer, dict):
                self.err(lw, "must be an object")
                continue
            lid = self.need_id(layer, lw)
            if lid:
                lw = '%s > layers[%d] "%s"' % (where, li, lid)
                if lid in seen:
                    self.err(lw, 'duplicate layer id "%s"' % lid)
                seen.add(lid)
            self.keys(layer, {"id", "name", "question", "add", "cut"}, lw)
            self.need_str(layer, "name", lw)
            qid = layer.get("question")
            q = questions.get(qid)
            if q is None or q.get("kind") != "single":
                self.err(lw, '"question" "%s" must be an existing one-of question (kind "single")' % qid)
            elif qid in layer_questions:
                self.err(lw, 'question "%s" is used by two layers' % qid)
            else:
                layer_questions.add(qid)
                for o in q.get("options", []):
                    if isinstance(o, dict) and "color" not in o:
                        self.warn(lw, 'option "%s" of "%s" has no "color"; the preview keeps the photo for it '
                                      '(write "color": null to say that on purpose)' % (o.get("id"), qid))
            for part in ("add", "cut"):
                polys = layer.get(part)
                if polys is None:
                    if part == "add":
                        self.err(lw, 'missing "add" (the outlines to recolor)')
                    continue
                if not isinstance(polys, list) or (part == "add" and not polys):
                    self.err(lw, '"%s" must be a list of outlines, each [[x, y], [x, y], [x, y], ...]' % part)
                    continue
                for pi, poly in enumerate(polys):
                    pw = "%s > %s[%d]" % (lw, part, pi)
                    if not isinstance(poly, list) or len(poly) < 3:
                        self.err(pw, "an outline needs at least 3 points [x, y]")
                        continue
                    for pti, pt in enumerate(poly):
                        if not (isinstance(pt, list) and len(pt) == 2 and
                                all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in pt)):
                            self.err(pw, "point %d %r must be [x, y] numbers (pixels of the photo)" % (pti + 1, pt))
                        elif size and not (0 <= pt[0] <= W and 0 <= pt[1] <= H):
                            self.err(pw, "point %d %r is outside the photo (%d x %d pixels)" % (pti + 1, pt, W, H))

    def check_download(self, d, questions):
        if d is None:
            return
        if not isinstance(d, dict):
            self.err("download", "must be an object")
            return
        self.keys(d, {"fileName", "prefixFrom"}, "download")
        fn = d.get("fileName")
        if fn is not None and (not isinstance(fn, str) or not ID_RE.match(fn)):
            self.err("download", '"fileName" must be letters, digits and "-" (no extension)')
        pf = d.get("prefixFrom")
        if pf is not None and (pf not in questions or questions[pf].get("kind") != "text"):
            self.err("download", '"prefixFrom" must name a text question, "%s" is not one' % pf)

    def check_link(self, link, questions):
        """The client-link fields: which text questions a manager's link fills (manager.html)."""
        if link is None:
            return
        if not isinstance(link, dict):
            self.err("link", 'must be an object like {"fields": [...]}')
            return
        self.keys(link, {"fields"}, "link")
        fields = link.get("fields")
        if not isinstance(fields, list) or not fields:
            self.err("link", '"fields" must be a non-empty list like [{"param": "name", "question": "client", '
                             '"label": "Client name", "required": true}]')
            return
        params, qids = {}, {}
        for fi, f in enumerate(fields):
            fw = "link > fields[%d]" % fi
            if not isinstance(f, dict):
                self.err(fw, "must be an object")
                continue
            p = f.get("param")
            if isinstance(p, str):
                fw = '%s "%s"' % (fw, p)
            self.keys(f, {"param", "question", "label", "required"}, fw)
            if not isinstance(p, str) or not LINK_PARAM_RE.match(p):
                self.err(fw, '"param" %r must be a short lowercase name of letters and digits, like "name"' % (p,))
            elif p in LINK_RESERVED:
                self.err(fw, '"param" "%s" is reserved (the link uses "id" for the link id and "to" for the result recipients)' % p)
            elif p in params:
                self.err(fw, 'duplicate "param" "%s" (also at link > fields[%d])' % (p, params[p]))
            else:
                params[p] = fi
            qid = f.get("question")
            q = questions.get(qid)
            if q is None:
                self.err(fw, '"question" points to a missing question "%s"' % qid)
            elif q.get("kind") != "text":
                self.err(fw, '"question": "%s" is %s; a link can fill only a text question (kind "text")' % (qid, q.get("kind")))
            elif qid in qids:
                self.err(fw, 'question "%s" is already filled by link > fields[%d]' % (qid, qids[qid]))
            else:
                qids[qid] = fi
            self.need_str(f, "label", fw)
            self.need_bool(f, "required", fw)

    def check_rules(self, rules, questions):
        if not isinstance(rules, list):
            self.err("rules", "must be a list")
            return
        targets_seen = {}
        for ri, r in enumerate(rules):
            rw = "rules[%d]" % ri
            if not isinstance(r, dict):
                self.err(rw, "must be an object")
                continue
            t = r.get("type")
            if t not in RULE_KEYS:
                self.err(rw, '"type" %r must be one of: %s' % (t, ", ".join(sorted(RULE_KEYS))))
                continue
            rw = '%s (%s)' % (rw, t)
            self.keys(r, RULE_KEYS[t], rw)

            def question(key, kinds=None):
                qid = r.get(key)
                q = questions.get(qid)
                if q is None:
                    self.err(rw, '"%s" points to a missing question "%s"' % (key, qid))
                    return None
                if kinds and q.get("kind") not in kinds:
                    self.err(rw, '"%s": question "%s" is %s, needs %s' % (key, qid, q.get("kind"), " or ".join(sorted(kinds))))
                    return None
                return q

            def options_of(q, ids, field):
                if not isinstance(ids, list) or not ids:
                    self.err(rw, '"%s" must be a non-empty list of option ids' % field)
                    return
                have = self.opt_ids(q)
                for oid in ids:
                    if oid not in have:
                        self.err(rw, '"%s": question "%s" has no option "%s"' % (field, q.get("id"), oid))

            if t == "alone":
                q = question("question", MULTI_KINDS)
                if q:
                    options_of(q, [r.get("option")], "option")
            elif t == "exclusive":
                q = question("question", MULTI_KINDS)
                if q:
                    options_of(q, r.get("options"), "options")
                    if isinstance(r.get("options"), list) and len(r["options"]) < 2:
                        self.err(rw, '"options" needs at least two options')
            elif t == "includedBy":
                q = question("question", MULTI_KINDS)
                src = question("source", {"single", "plan-single"})
                for k in ("includedTag", "extraTag", "pendingTag"):
                    self.need_str(r, k, rw, required=False)
                if q and src:
                    m = r.get("map")
                    if m is None:
                        for oid in self.opt_ids(src):
                            if oid not in self.opt_ids(q):
                                self.err(rw, 'no "map": option "%s" of "%s" must also exist in "%s"' % (oid, src["id"], q["id"]))
                    elif not isinstance(m, dict):
                        self.err(rw, '"map" must be an object {sourceOption: targetOption}')
                    else:
                        for k, v in m.items():
                            if k not in self.opt_ids(src):
                                self.err(rw, '"map": question "%s" has no option "%s"' % (src["id"], k))
                            if v not in self.opt_ids(q):
                                self.err(rw, '"map": question "%s" has no option "%s"' % (q["id"], v))
                        for oid in self.opt_ids(src):
                            if oid not in m:
                                self.warn(rw, '"map" has no entry for "%s"; nothing is included for it' % oid)
            elif t == "baseIncluded":
                q = question("question", MULTI_KINDS)
                if q:
                    options_of(q, r.get("options"), "options")
                for k in ("includedTag", "extraTag", "swapTag"):
                    self.need_str(r, k, rw, required=False)
                ea = r.get("extraAfter")
                if ea is not None and (not isinstance(ea, int) or isinstance(ea, bool) or ea < 0):
                    self.err(rw, '"extraAfter" must be a whole number')
            elif t == "disables":
                when = r.get("when")
                wq = None
                if not isinstance(when, dict):
                    self.err(rw, '"when" must be like {"question": "...", "is": "optionId"}')
                else:
                    self.keys(when, {"question", "is", "isNot"}, rw + " > when")
                    wq = questions.get(when.get("question"))
                    if wq is None or wq.get("kind") not in OPTION_KINDS:
                        self.err(rw, '"when": "question" must be an existing choice question, "%s" is not' % when.get("question"))
                        wq = None
                    has = [k for k in ("is", "isNot") if k in when]
                    if len(has) != 1:
                        self.err(rw, '"when" needs exactly one of "is" or "isNot"')
                    elif wq:
                        vals = when[has[0]]
                        vals = vals if isinstance(vals, list) else [vals]
                        for v in vals:
                            if v not in self.opt_ids(wq):
                                self.err(rw, '"when": question "%s" has no option "%s"' % (wq["id"], v))
                self.need_bool(r, "hide", rw)
                self.need_str(r, "note", rw, required=False)
                tg = r.get("targets")
                if not isinstance(tg, list) or not tg:
                    self.err(rw, '"targets" must be a non-empty list of question ids')
                else:
                    for tq in tg:
                        if tq not in questions:
                            self.err(rw, '"targets": no question "%s"' % tq)
                        elif wq is not None and tq == wq.get("id"):
                            self.err(rw, '"targets": a question cannot disable itself ("%s")' % tq)
                        targets_seen.setdefault(tq, []).append(ri)

    def unused_images(self):
        root = os.path.join(HERE, IMAGE_DIR)
        out = []
        for dirpath, _dirs, files in os.walk(root):
            for f in files:
                if f.lower().endswith(IMAGE_EXT):
                    rel = os.path.relpath(os.path.join(dirpath, f), HERE).replace(os.sep, "/")
                    if rel not in self.images:
                        out.append(rel)
        return sorted(out)


def rel(path):
    try:
        return os.path.relpath(path, HERE)
    except ValueError:  # another drive
        return path


def load_json(path):
    dupes = []

    def no_dupes(pairs):
        seen = {}
        for k, v in pairs:
            if k in seen:
                dupes.append(k)
            seen[k] = v
        return seen

    with open(path, "r", encoding="utf-8-sig") as fh:
        text = fh.read()
    try:
        data = json.loads(text, object_pairs_hook=no_dupes)
    except json.JSONDecodeError as e:
        return None, ["JSON syntax: %s (line %d, column %d)" % (e.msg, e.lineno, e.colno)], text
    return data, ['the same field "%s" is written twice inside one { }' % k for k in dupes], text


def data_uri(rel_path):
    full = os.path.join(HERE, *rel_path.split("/"))
    with open(full, "rb") as fh:
        raw = fh.read()
    return "data:%s;base64,%s" % (MIME[os.path.splitext(full)[1].lower()], base64.b64encode(raw).decode("ascii"))


def write_js(json_path, data, text, assets=()):
    js_path = os.path.splitext(json_path)[0] + ".js"
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    body = json.dumps(data, ensure_ascii=True, indent=1)
    embedded = {a: data_uri(a) for a in assets}
    out = ("/* GENERATED by check_spec.py from %s (sha256 %s). Do not edit; edit the .json and run the check. */\n"
           "window.SPEC_DATA = %s;\n"
           "/* Embedded copies of image files (the finish-preview photo), so the page can recolor it when opened from a folder. */\n"
           "window.SPEC_ASSETS = %s;\n") % (os.path.basename(json_path), digest, body,
                                           json.dumps(embedded, indent=0))
    old = None
    if os.path.isfile(js_path):
        with open(js_path, "r", encoding="utf-8") as fh:
            old = fh.read()
    if old != out:
        with open(js_path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(out)
        return js_path, True
    return js_path, False


def main(argv):
    try:
        sys.stdout.reconfigure(errors="backslashreplace")  # Windows console is often cp1252
    except (AttributeError, ValueError):
        pass
    paths = argv[1:]
    if not paths:
        spec_dir = os.path.join(HERE, "spec")
        paths = sorted(os.path.join(spec_dir, f) for f in os.listdir(spec_dir) if f.endswith(".json"))
    if not paths:
        print("No spec/*.json files found.")
        return 1
    failed = False
    for path in paths:
        path = os.path.abspath(path)
        name = rel(path)
        print("Checking %s" % name)
        data, problems, text = load_json(path)
        c = Checker(path)
        for p in problems:
            c.err("file", p)
        if data is not None:
            c.run(data)
        for w in c.warnings:
            print("  warning  %s" % w)
        if c.errors:
            failed = True
            for e in c.errors:
                print("  ERROR    %s" % e)
            print("  %d error(s). The page copy (.js) was NOT updated." % len(c.errors))
            continue
        js, changed = write_js(path, data, text, c.assets)
        unused = c.unused_images()
        if unused and len(paths) == 1:
            print("  note     images not used by this spec: %s" % ", ".join(unused))
        print("  OK  %s v%s; %s %s (%d KB, embeds %s)" % (
            data["specId"], data["specVersion"], rel(js), "written" if changed else "already up to date",
            os.path.getsize(js) // 1024, ", ".join(c.assets) or "no images"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
