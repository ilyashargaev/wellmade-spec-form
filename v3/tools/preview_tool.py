"""Helper for the finish preview data in a spec. Needs Pillow (pip install pillow).
Not needed to run or edit the form; use it when a color or an outline changes.

    python -I tools/preview_tool.py colors  spec/presidio-xo.json
        Prints the mean color (hex) of every option image in the questions the preview
        recolors, next to the "color" the spec has now. Paste a new hex into the spec by hand.

    python -I tools/preview_tool.py overlay spec/presidio-xo.json out.png
        Draws the preview outlines on the preview photo (pink = first layer, blue = second, ...;
        cut-outs stay unpainted; the white frame is the crop) so you can check them by eye.

    python -I tools/preview_tool.py sheet   spec/presidio-xo.json out.png
        Recolors the photo like the page does and saves a contact sheet: every option of every
        preview layer, the other layers left as the photo.
"""
import json
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PALETTE = [(255, 0, 160), (0, 160, 255), (255, 200, 0), (0, 200, 120)]


def load(spec_path):
    with open(spec_path, "r", encoding="utf-8-sig") as fh:
        spec = json.load(fh)
    questions = {}
    for step in spec.get("steps", []):
        for item in step.get("items", []) or []:
            questions[item.get("id")] = item
    return spec, questions


def mean_hex(path):
    im = Image.open(path).convert("RGB").resize((40, 40))
    px = list(im.get_flattened_data() if hasattr(im, "get_flattened_data") else im.getdata())
    return "#%02x%02x%02x" % tuple(round(sum(p[i] for p in px) / len(px)) for i in range(3))


def mask(size, layer):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    for p in layer.get("add", []):
        d.polygon([tuple(pt) for pt in p], fill=255)
    for p in layer.get("cut", []):
        d.polygon([tuple(pt) for pt in p], fill=0)
    return m


def recolor(photo, layers_colors):
    """Same math as engine/app.js: keep each pixel's brightness relative to the layer's mean, take the color."""
    src = photo.convert("RGB")
    out = src.copy()
    sp = src.load()
    op = out.load()
    w, h = src.size
    for m, hexcol in layers_colors:
        if not hexcol:
            continue
        rgb = [int(hexcol[i:i + 2], 16) for i in (1, 3, 5)]
        mp = m.load()
        tot = n = 0
        for y in range(h):
            for x in range(w):
                if mp[x, y] > 127:
                    r, g, b = sp[x, y]
                    tot += .299 * r + .587 * g + .114 * b
                    n += 1
        mean = tot / max(n, 1)
        for y in range(h):
            for x in range(w):
                if mp[x, y] > 127:
                    r, g, b = sp[x, y]
                    k = (.299 * r + .587 * g + .114 * b) / mean
                    op[x, y] = tuple(min(255, round(c * k)) for c in rgb)
    return out


def main(argv):
    if len(argv) < 3 or argv[1] not in ("colors", "overlay", "sheet"):
        print(__doc__)
        return 2
    cmd, spec_path = argv[1], argv[2]
    spec, questions = load(spec_path)
    pv = spec.get("preview") or {}
    layers = pv.get("layers", [])
    if cmd == "colors":
        for layer in layers:
            q = questions.get(layer.get("question"), {})
            print("%s (question %s)" % (layer.get("name"), q.get("id")))
            for o in q.get("options", []):
                img = o.get("image")
                mean = mean_hex(os.path.join(HERE, *img.split("/"))) if img else "-"
                print("  %-32s mean %-8s spec %s" % (o.get("id"), mean, o.get("color", "(none)")))
        return 0
    photo = Image.open(os.path.join(HERE, *pv["photo"].split("/"))).convert("RGB")
    x, y, w, h = pv.get("crop") or [0, 0, photo.size[0], photo.size[1]]
    if cmd == "overlay":
        ov = photo.copy()
        for i, layer in enumerate(layers):
            col = PALETTE[i % len(PALETTE)]
            ov.paste(Image.new("RGB", photo.size, col), (0, 0), mask(photo.size, layer).point(lambda v: int(v * .5)))
        ImageDraw.Draw(ov).rectangle([x, y, x + w - 1, y + h - 1], outline=(255, 255, 255), width=3)
        ov.save(argv[3])
        print("saved", argv[3])
        return 0
    # sheet
    small = photo.crop((x, y, x + w, y + h))
    scale = 360.0 / w
    small = small.resize((360, round(h * scale)))
    masks = []
    for layer in layers:
        m = mask(photo.size, layer).crop((x, y, x + w, y + h)).resize(small.size)
        masks.append(m)
    cells = []
    for li, layer in enumerate(layers):
        q = questions.get(layer.get("question"), {})
        for o in q.get("options", []):
            cols = [(masks[j], o.get("color") if j == li else None) for j in range(len(layers))]
            cells.append(("%s: %s" % (layer.get("name"), o.get("label").replace("–", "-").replace("—", "-")), recolor(small, cols)))
    per_row = 3
    cw, ch = small.size[0], small.size[1] + 22
    rows = (len(cells) + per_row - 1) // per_row
    sheet = Image.new("RGB", (cw * per_row + 8 * (per_row - 1), ch * rows), "white")
    d = ImageDraw.Draw(sheet)
    for i, (label, im) in enumerate(cells):
        cx, cy = (i % per_row) * (cw + 8), (i // per_row) * ch
        sheet.paste(im, (cx, cy))
        d.text((cx + 2, cy + small.size[1] + 4), label, fill=(0, 0, 0))
    sheet.save(argv[3])
    print("saved", argv[3], len(cells), "cells")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
