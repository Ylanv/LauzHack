"""Build the app-ready AXA axolotl from the untouched Blockbench export.

  in : src/mascot/assets/source/axolotl-cube.gltf   (original, never modified)
  out: src/mascot/assets/axolotl-axa.gltf            (loaded by the app, texture embedded)
       src/mascot/assets/axolotl-axa-atlas.png       (the same texture, for reviewing at a glance)

Geometry, UVs and the node hierarchy are kept as they are. Only the 32x32 texture changes:
  - pink/purple palette -> AXA colours from src/mascot/palette.json
  - the eyes and mouth painted on the front face are removed (the app draws them on a face overlay so they can move
    and change expression); everything else, including the side eye pixels, keeps its original pixel layout
  - edge faces of the zero-thickness gill/tail planes point at a transparent texel, and every face's UVs are inset by
    0.02 texel so nearest sampling never bleeds a neighbouring atlas pixel along an edge
  - the unused Blockbench clip (squash + tail swing) is dropped: the app animates the model procedurally

Run from webapp/:  python scripts/build_axolotl.py
"""
import base64
import io
import json
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / "src" / "mascot"
SRC = ROOT / "assets" / "source" / "axolotl-cube.gltf"
OUT = ROOT / "assets" / "axolotl-axa.gltf"
ATLAS = ROOT / "assets" / "axolotl-axa-atlas.png"
PAL = {k: v for k, v in json.loads((ROOT / "palette.json").read_text()).items() if not k.startswith("_")}


def rgba(hex_: str):
    h = hex_.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


# original colour -> palette key
RECOLOR = {
    (255, 198, 250, 255): "body",       # main pink
    (246, 171, 227, 255): "bodySpot",   # darker pink spots on head and back
    (248, 211, 255, 255): "belly",      # lavender lower band, belly, chin
    (249, 229, 255, 255): "white",      # tail highlight
    (255, 131, 243, 255): "gill",       # bright gill fronds, tail tip
    (235, 87, 190, 255): "gillMid",
    (228, 74, 158, 255): "gillDark",
    (255, 133, 133, 255): "mouthInside",
    (0, 0, 0, 255): "pupil",            # side eye pixels
}
# texture regions (x0, y0, x1, y1 inclusive, in pixels of the embedded image)
FRONT_FACE = (0, 0, 7, 7)               # -Z face: u 0-8, v 0-8
TAIL = (22, 10, 27, 11)                 # tail fin, the only textured side of the tail plane


def build():
    g = json.loads(SRC.read_text())
    img = Image.open(io.BytesIO(base64.b64decode(g["images"][0]["uri"].split(",", 1)[1]))).convert("RGBA")
    w, h = img.size
    src = img.copy()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for y in range(h):
        for x in range(w):
            c = src.getpixel((x, y))
            if c[3] == 0:
                continue
            key = RECOLOR.get(c)
            if key is None:
                raise SystemExit(f"unmapped colour {c} at {x},{y}")
            in_face = FRONT_FACE[0] <= x <= FRONT_FACE[2] and FRONT_FACE[1] <= y <= FRONT_FACE[3]
            if in_face and key in ("pupil", "mouthInside"):
                # erase painted eyes and mouth: take the band colour of that row (blue above the chin, light chin)
                key = "belly" if y >= 6 else "body"
            in_tail = TAIL[0] <= x <= TAIL[2] and TAIL[1] <= y <= TAIL[3]
            if in_tail and key in ("gillDark", "gillMid"):
                key = "body"            # tail continues the blue body, only its tip stays red
            out.putpixel((x, y), rgba(PAL[key]))
    # side eyes: one pixel column on each side face, white over a dark pupil so they read on the blue band
    for x in (7, 8):
        out.putpixel((x, 12), rgba(PAL["eyeWhite"]))
        out.putpixel((x, 13), rgba(PAL["pupil"]))

    buf = io.BytesIO()
    out.save(buf, "PNG", optimize=True)
    out.save(ATLAS, "PNG", optimize=True)
    g["images"][0]["uri"] = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    g["textures"][0]["name"] = "axolotl_axa.png"

    # the gill and tail planes are boxes of zero thickness: their edge faces have degenerate UVs that sample a body
    # pixel and show up as thin lines; point them at a transparent texel instead (alpha MASK discards them)
    buf_data = bytearray(base64.b64decode(g["buffers"][0]["uri"].split(",", 1)[1]))
    clear = (31.5 / w, 31.5 / h)
    assert out.getpixel((31, 31))[3] == 0
    for m in g["meshes"]:
        acc = g["accessors"][m["primitives"][0]["attributes"]["TEXCOORD_0"]]
        bv = g["bufferViews"][acc["bufferView"]]
        stride, off = bv.get("byteStride", 8), bv["byteOffset"] + acc.get("byteOffset", 0)
        uv = [struct.unpack_from("<2f", buf_data, off + i * stride) for i in range(acc["count"])]
        for q in range(0, acc["count"], 4):          # 4 vertices per face
            us, vs = {round(u * w, 3) for u, _ in uv[q:q + 4]}, {round(v * h, 3) for _, v in uv[q:q + 4]}
            if len(us) == 1 or len(vs) == 1:
                for i in range(q, q + 4):
                    struct.pack_into("<2f", buf_data, off + i * stride, *clear)
                continue
            # inset each face by a fraction of a texel: nearest sampling exactly on a border can pick the neighbouring
            # atlas pixel and draw a dotted line along the edge
            cu, cv = sum(u for u, _ in uv[q:q + 4]) / 4, sum(v for _, v in uv[q:q + 4]) / 4
            for i in range(q, q + 4):
                u, v = uv[i]
                u += (0.02 / w) * (1 if cu > u else -1)
                v += (0.02 / h) * (1 if cv > v else -1)
                struct.pack_into("<2f", buf_data, off + i * stride, u, v)
    g["buffers"][0]["uri"] = "data:application/octet-stream;base64," + base64.b64encode(bytes(buf_data)).decode()

    # drop the Blockbench animation and the accessors/buffer views only it used (they are the last ones)
    used = {i for m in g["meshes"] for p in m["primitives"] for i in [*p["attributes"].values(), p["indices"]]}
    g.pop("animations", None)
    keep_acc = max(used) + 1
    assert all(a < keep_acc for a in used)
    g["accessors"] = g["accessors"][:keep_acc]
    keep_bv = max(a["bufferView"] for a in g["accessors"]) + 1
    g["bufferViews"] = g["bufferViews"][:keep_bv]
    end = max(v["byteOffset"] + v["byteLength"] for v in g["bufferViews"])
    data = base64.b64decode(g["buffers"][0]["uri"].split(",", 1)[1])[:end]
    g["buffers"][0] = {"byteLength": end, "uri": "data:application/octet-stream;base64," + base64.b64encode(data).decode()}
    g["asset"]["generator"] = "Blockbench 5.1.1 glTF exporter + webapp/scripts/build_axolotl.py (AXA palette)"
    OUT.write_text(json.dumps(g, separators=(",", ":")))
    print(f"{OUT.relative_to(ROOT.parent.parent)}: {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    build()
