# How to change the spec

For an AI agent (or a person) who edits the options of the Wellmade client spec form. You need no knowledge of the code: every question, option, picture and rule lives in one data file. Version 1.1, 2026-11-15, for spec format 1.2. Tested 2026-11-15: a fresh agent given only this guide added a stain and removed the TimberTech line; the check passed and the form showed both changes; 1.1 closes the gaps it reported.

## 1. What is where

All paths are relative to this folder (the one that holds this guide).

| Path | What it is | Edit it? |
|---|---|---|
| `spec/presidio-xo.json` | **The spec**: steps, questions, options, labels, tags, image names, rules, spec version. | **Yes — the only file you edit.** |
| `images/` | Every picture the spec names (swatches, product photos, plans, the preview photo, the logo). | Add or replace files. |
| `check_spec.py` | Checks the spec and writes `spec/presidio-xo.js`. | No. Run it. |
| `spec/presidio-xo.js` | Generated copy of the spec that the page loads. | **Never by hand.** The check writes it. |
| `index.html` | The client form. `manager.html` — the page that makes a personal client link. | No. Open them to preview. |
| `engine/`, `styles.css`, `wellmade-tokens.css`, `tests/`, `tools/` | Code, design, developer tests. | No. |

You need: a plain-text editor that saves UTF-8, and Python 3 (nothing to install). Change only the lines you need; keep the rest of the file (indentation, line endings) as it is.

## 2. The one workflow

1. Edit `spec/presidio-xo.json`.
2. Raise `specVersion` at the top (section 9).
3. Run the check from this folder:
   ```
   python -I check_spec.py
   ```
   - `OK  presidio-xo v1.2.1; spec\presidio-xo.js written` — done.
   - `ERROR ...` lines — fix each one; the message names the place, e.g. `steps[5] "finishes" > items[0] "stain" > options[5] "cedar-red": image file not found: images/stain-6.jpg`. While there are errors the `.js` is **not** updated and the page keeps showing the previous spec.
   - `warning ...` and `note ...` lines do not block; read them (e.g. an image no option uses any more).
4. Preview (section 8).

The file is JSON: double quotes only, a comma between items, **no comma after the last item** in a list or `{ }`, no comments. The check reports JSON mistakes with line and column.

## 3. How the spec is built

```
{ "specId": "presidio-xo", "specVersion": "1.2.0", ...,
  "steps": [                                  // pages of the form, in order
    { "id": "finishes", "title": "Finishes", "short": "Finishes", "items": [   // "short" = name on the step chip
        { "id": "stain", "kind": "single", "layout": "photos", "label": "Exterior stain", "hint": "...",
          "options": [
            { "id": "weathered-brown", "label": "Weathered Brown", "image": "images/stain-2.jpg", "color": "#876f5b" },
            ...
          ] },
        { "id": "stainComments", "kind": "lines", "label": "Comments", "optional": true },
        ...
    ] },
    { "id": "review", "kind": "review", "title": "Review", ... }   // always last, no items
  ],
  "rules": [ ... ]                            // section 6
}
```

- **Question kinds**: `single` (choose one; tap again clears), `multi` (choose several), `text` (one line), `lines` (comments box), `plan-single` / `plan-multi` (points on a plan picture). Not questions: `figure` (a picture with a caption), `note` (a block of text).
- **Option fields**: `id`, `label` (what the client reads), optional `tag` (a fixed badge such as `"Included"` or `"Additional cost"`), `image` (makes it a photo tile; needs `"layout": "photos"` on the question), `group` (series heading, see `groups` on the decking question), `color` (finish preview, section 7).
- **Ids**: letters, digits and `-`, starting with a letter (`cedar-red`, `trex-select-saddle`). Option ids must be unique inside their question; step and question ids unique in the whole file.
- `"optional": true` on a question: an empty answer is not listed as "still open" on Review.

## 4. What must NOT change

Every saved answer, download and (later) submission refers to **ids**, not labels. So:

- **Never change the `id` of an existing step, question or option.** To change what the client reads, change `label` (and `hint`, `tag`) only.
- **Never reuse a removed id** for a different thing: old submissions would then seem to mean the new thing. Pick a new id.
- Do not change `specId`.
- Do not edit `spec/presidio-xo.js`, `engine/`, `index.html`, `manager.html`, or the styles.

Removing an option or question is fine: a client who had picked it just sees it unanswered.

## 5. Common changes

### Add an option (example: a new stain)

1. Copy the swatch picture into `images/` and **rename the copy** to the next free number of its series: the stains are `stain-1.jpg` … `stain-5.jpg`, so a new one is `images/stain-6.jpg` (lowercase, no spaces; `.jpg` or `.png`; about the size and shape of the other swatches — tiles are shown 3:4, cropped to fill).
2. In the `"stain"` question, add a line to `"options"` where it should appear; if nobody said where, put it last. If it is now last, add a comma after the option that was last before it and none after the new one:
   ```json
   { "id": "cedar-red", "label": "Cedar Red", "image": "images/stain-6.jpg", "color": "#8a4b38" },
   ```
3. `color` is the color the finish preview paints the facade with. Use the average color of the swatch: if Pillow is installed, `python -I tools/preview_tool.py colors spec/presidio-xo.json` prints it (`mean #......`) for every swatch; otherwise pick a hex close to the swatch by eye. `"color": null` means "show the photo as it is".
4. Raise the version, run the check, preview.

A plain button option (no picture) is just `{ "id": "...", "label": "..." }`. An option in a series also gets `"group": "<group id>"` and usually the same `tag` as its neighbours.

### Rename an option or question

Change `label` only (keep `id`). Same for `hint`, `title`, `tag`, `caption`.

### Remove an option (example: one decking)

1. Delete its `{ ... }` line from `"options"` (and the comma that separated it).
2. Run the check. If a rule still names the removed option, the check says so (e.g. `rules[2] (includedBy): "map": question "exterior" has no option "..."`): remove that id from the rule too.
3. If the check notes the option's picture is no longer used, you may leave it in `images/` or delete the file.
4. If a series heading (`groups`) now has no options, the check warns; delete that group or leave it (it simply does not show).

### Remove a whole product line (example: all TimberTech decking)

A product line is a series: one entry in the question's `"groups"` (e.g. `{ "id": "timbertech", "title": "TimberTech decking", ... }`) plus every option with `"group": "timbertech"`. Delete all those options, then delete the group entry, then run the check (it warns if a group is left with no options).

### Add a question

Add an item to a step's `"items"` list, at the place it should appear:
```json
{ "id": "gutterColor", "kind": "single", "label": "Gutter color", "hint": "Choose one. Tap again to clear.",
  "options": [ { "id": "black", "label": "Black" }, { "id": "white", "label": "White" } ] },
{ "id": "gutterComments", "kind": "lines", "label": "Comments", "optional": true },
```
The question id must be new in the whole file.

### Remove a question

Delete its item. Then run the check: it lists every rule, preview layer, client-link field or download setting that still points to it; remove or change those too.

### Add, rename or remove a whole step

A step is one `{ "id": ..., "title": ..., "short": ..., "items": [...] }` object in `"steps"`. Add a new one before the review step (`"kind": "review"`, which stays last). Rename with `title` / `short`. Removing a step removes all its questions (see "Remove a question").

### Add or replace a picture

- **Replace**: overwrite the file in `images/` with the same name, run the check (it must run if you replaced the preview photo, which it embeds), reload the page. Nothing else changes.
- **New picture**: add the file to `images/` and name it in the spec as `"images/<file name>"`. The check fails if the file is missing or if the letter case differs from the file on disk (`Stain-6.JPG` vs `stain-6.jpg` breaks on a web host even though Windows does not care).
- Plan pictures (`plans`) and the preview photo (`preview.photo`) carry positions in pixels or percent; replacing them with a different size or framing moves the points. Avoid that unless you also update `x`/`y` (plans, percent of the picture) or the preview outlines.

## 6. Rules (in `"rules"`)

Each rule names questions and options by id; `why` is free text for people. The check verifies every id.

| Type | Meaning | Tiny example |
|---|---|---|
| `alone` | In a many-of question, this option cannot be combined: picking it clears the others, picking another clears it. | `{ "type": "alone", "question": "permits", "option": "none" }` |
| `exclusive` | At most one of these options at a time; other options are not affected. | `{ "type": "exclusive", "question": "connection", "options": ["plug-in", "hardline"] }` |
| `includedBy` | The answer of a one-of `source` question automatically includes one option of a many-of question (`map`: source option → included option). That one is tagged `includedTag` and locked; other picks get `extraTag`; picks made before the source is answered get `pendingTag`. | `{ "type": "includedBy", "question": "exterior", "source": "breaker", "map": { "back-left": "back-left" }, "includedTag": "Included", "extraTag": "Extra charge", "pendingTag": "Pending breaker" }` |
| `baseIncluded` | These options come with the base model: pre-selected and tagged `includedTag`. Picks beyond that number get `extraTag`; a moved one (others un-picked) gets `swapTag`. | `{ "type": "baseIncluded", "question": "interior", "options": ["back-left", "back-right"], "includedTag": "Included", "extraTag": "Additional charge", "swapTag": "Confirm in Comments" }` |
| `disables` | While `when` holds, the `targets` questions are not used: answers cleared, buttons disabled (or hidden with `"hide": true`), Review shows "Not used". `when` uses `is` or `isNot` with one option id or a list. Optional `note` is shown while it applies. | `{ "type": "disables", "when": { "question": "skylightType", "is": "none" }, "targets": ["skylightLoc"], "note": "NO skylight, so no location is used." }` |

"Exactly one" needs no rule: use `kind` `single` or `plan-single`.

### Client-link fields (`"link"`)

The manager's page (`manager.html`) makes a personal link per client. `link.fields` says which form fields the link fills:
```json
"link": { "fields": [
  { "param": "name",    "question": "client",  "label": "Client name", "required": true },
  { "param": "address", "question": "address", "label": "Address",     "required": true },
  { "param": "phone",   "question": "phone",   "label": "Phone",       "required": false }
] }
```
`question` must be a `text` question; `param` is the short name inside the link (lowercase letters and digits; `id` is reserved). `label` and `required` are for the manager's page; the first field names the link ("Link for Jane Doe"). Do not rename a `param` once links have been sent: old links would stop filling that field.

## 7. Finish preview (colors)

The form shows one photo with the facade and the deck repainted in the picked stain and decking. In the spec: `preview.layers` link a picture area to a one-of question (`"question": "stain"`, `"question": "decking"`), and each option of those questions has `"color": "#rrggbb"` (or `null` = photo as is). A new option of those questions needs a `color` (section 5); without it the check warns and the preview keeps the photo. Do not edit the `add`/`cut` outlines or `crop` unless you change the photo.

## 8. Preview locally

1. After the check passes, double-click `index.html` (it opens in the browser straight from the folder; no server needed). If it was open, reload it.
2. Go to the changed step and click the new or changed options. The form keeps answers in this browser; to see a clean form use "Start a new form" at the end of Review or a private window.
3. Open `manager.html` to see the link page; a link it makes opens this folder's `index.html` with the client's name and address filled.

## 9. Spec version

`specVersion` at the top (`"1.2.0"` = major.minor.patch) goes into every download and submission, so the manager knows which options the client saw. Raise it **once per batch of changes** you hand over, even before it is published (several edits in one sitting = one raise, by the biggest kind below):

- patch (`1.2.0` → `1.2.1`): wording, tags, pictures replaced, colors;
- minor (`1.2.0` → `1.3.0`): options, questions or steps added or removed; rules or link fields changed;
- major (`2.0.0`): only when the engine changes the spec format (a developer does that).

## 10. Publish (to be filled after hosting is chosen)

Hosting is not chosen yet. Until then: a change is "done" when the check passes and the local preview looks right. Whoever publishes later must upload the whole folder (at least `index.html`, `manager.html`, `spec/`, `images/`, `engine/`, the two `.css` files) **after** running the check, so the generated `spec/presidio-xo.js` matches the JSON.

## 11. Checklist

- [ ] Only `spec/presidio-xo.json` and `images/` changed.
- [ ] No existing id changed; no removed id reused.
- [ ] `specVersion` raised.
- [ ] `python -I check_spec.py` prints `OK` and no `ERROR`.
- [ ] Opened `index.html`, clicked the changed questions, Review lists them correctly.

Note: `tests/` are developer tests written for today's options; after a content change some of them may fail. They are not part of this workflow.
