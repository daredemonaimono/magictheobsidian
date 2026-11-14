#!/usr/bin/env python3
"""
カードのプレビュー用フォントを、styles.css に埋め込む (BRAT は styles.css しか配らないため)。
使うフォントは、すべて SIL Open Font License 1.1 (再配布してよい)。入れるのは、必要な文字だけ (サブセット) の woff2 を、base64 にしたもの。
各フォントは、@font-face で、まず local() (パソコンに、その名前のフォントが、あればそれ)、なければ、埋め込んだ版を使う。
ファイルの名前は、"mtg-<名前>" (OFL の「予約名」の決まりを、避けるため)。

  使い方 (fonttools と brotli が要る):
    python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli
    /tmp/fontenv/bin/python scripts/build-fonts.py [--extra-dir <日本語のカードのノートがあるフォルダ>]

  styles.css の /* BEGIN:fonts */ と /* END:fonts */ の間を、書き換える。OFL の全文は、licenses/fonts/ に置く。
"""
import base64, io, pathlib, re, sys, urllib.parse, urllib.request
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

BASE = "https://github.com/google/fonts/raw/main/ofl/"
ROOT = pathlib.Path(__file__).resolve().parent.parent

# (css の名前, 元の置き場, ファイル, 可変フォントの太さ (無ければ None), css の太さ, 使えるパソコンのフォント名, 文字の範囲, 著作権)
FONTS = [
    ("mtg-MedievalSharp", "medievalsharp", "MedievalSharp.ttf", None, 400, ["MedievalSharp"], "latin", "Copyright (c) Wojciech Kalinowski"),
    ("mtg-EBGaramond", "ebgaramond", "EBGaramond[wght].ttf", 400, 400, ["EB Garamond", "EB Garamond Regular", "EBGaramond-Regular", "EBGaramond12-Regular"], "latin", "Copyright (c) The EB Garamond Project Authors"),
    ("mtg-Marcellus", "marcellus", "Marcellus-Regular.ttf", None, 400, ["Marcellus", "Marcellus-Regular"], "latin", "Copyright (c) Astigmatic (Brian J. Bonislawsky)"),
    ("mtg-CrimsonText", "crimsontext", "CrimsonText-Regular.ttf", None, 400, ["Crimson Text", "Crimson Text Regular", "CrimsonText-Regular"], "latin", "Copyright (c) Sebastian Kosch"),
    ("mtg-Cinzel", "cinzel", "Cinzel[wght].ttf", 700, 700, ["Cinzel Bold", "Cinzel-Bold", "Cinzel"], "latin", "Copyright (c) The Cinzel Project Authors"),
    ("mtg-ShipporiMincho", "shipporimincho", "ShipporiMincho-Regular.ttf", None, 400, ["Shippori Mincho", "Shippori Mincho Regular", "ShipporiMincho-Regular", "しっぽり明朝"], "ja", "Copyright (c) The Shippori Mincho Project Authors"),
    ("mtg-ShipporiMincho", "shipporimincho", "ShipporiMincho-Bold.ttf", None, 700, ["Shippori Mincho Bold", "ShipporiMincho-Bold", "しっぽり明朝 Bold"], "ja", "Copyright (c) The Shippori Mincho Project Authors"),
    ("mtg-NotoSansJP", "notosansjp", "NotoSansJP[wght].ttf", 400, 400, ["Noto Sans JP", "Noto Sans JP Regular", "NotoSansJP-Regular", "Source Han Sans JP", "Source Han Sans JP Regular", "SourceHanSansJP-Regular", "源ノ角ゴシック JP"], "ja", "Copyright (c) Google LLC (Noto Sans JP)"),
    ("mtg-NotoSansJP", "notosansjp", "NotoSansJP[wght].ttf", 700, 700, ["Noto Sans JP Bold", "NotoSansJP-Bold", "Source Han Sans JP Bold", "SourceHanSansJP-Bold", "源ノ角ゴシック JP Bold"], "ja", "Copyright (c) Google LLC (Noto Sans JP)"),
]
LICENSES = ["medievalsharp", "ebgaramond", "marcellus", "crimsontext", "cinzel", "shipporimincho", "notosansjp"]

def latin() -> set:
    r = list(range(0x20, 0x250)) + list(range(0x2010, 0x2028)) + list(range(0x2030, 0x203B)) + [0x2212, 0x2122, 0x00D7, 0x00B7, 0x2022, 0x2026, 0x2044]
    return set(r)

def japanese(extra_dir) -> set:
    cs = set(range(0x20, 0x7F)) | set(range(0xFF61, 0xFFA0)) | latin()
    # JIS X 0208: 記号・かな・全角英数・ギリシャ・キリル・罫線 (第 1〜4 区: 0x81〜0x84) と、第 1 水準の漢字 (0x88〜0x9872)
    for lead in list(range(0x81, 0x85)) + list(range(0x88, 0x99)):
        for trail in range(0x40, 0xFD):
            if trail == 0x7F or (lead == 0x98 and trail > 0x72):
                continue
            try:
                cs.add(ord(bytes([lead, trail]).decode("shift_jis")))
            except UnicodeDecodeError:
                pass
    # 第 2 水準でも、カードの文に出る漢字 (櫃・贄など) は、足す: 指定のフォルダの、ノートの日本語
    if extra_dir:
        for f in pathlib.Path(extra_dir).glob("*.md"):
            cs |= {ord(c) for c in f.read_text(encoding="utf-8") if ord(c) >= 0x3000}
    return cs

def fetch(group: str, name: str) -> bytes:
    url = BASE + group + "/" + urllib.parse.quote(name, safe="")
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "mtg-build-fonts"}), timeout=120) as r:
        return r.read()

def build(group, name, wght, unicodes) -> bytes:
    font = TTFont(io.BytesIO(fetch(group, name)))
    if wght is not None and "fvar" in font:
        font = instancer.instantiateVariableFont(font, {"wght": wght}, inplace=False)
    o = subset.Options()
    o.flavor = "woff2"
    o.hinting = False
    o.layout_features = ["kern", "liga", "clig", "ccmp", "locl", "mark", "mkmk", "vert", "vrt2", "palt"]
    o.notdef_outline = True
    s = subset.Subsetter(o)
    s.populate(unicodes=sorted(unicodes))
    s.subset(font)
    out = io.BytesIO()
    font.flavor = "woff2"
    font.save(out)
    return out.getvalue()

def main():
    extra = sys.argv[sys.argv.index("--extra-dir") + 1] if "--extra-dir" in sys.argv else None
    ja = japanese(extra)
    la = latin()
    blocks, total = [], 0
    for fam, group, name, wght, weight, local, kind, copyright_ in FONTS:
        data = build(group, name, wght, ja if kind == "ja" else la)
        total += len(data)
        srcs = ", ".join([f'local("{n}")' for n in local] + [f'url(data:font/woff2;base64,{base64.b64encode(data).decode()}) format("woff2")'])
        blocks.append(f"/* {name} {weight} — {copyright_}. SIL Open Font License 1.1 (https://openfontlicense.org)。必要な文字だけのサブセット。ライセンス全文: licenses/fonts/ */\n@font-face {{ font-family: \"{fam}\"; font-style: normal; font-weight: {weight}; font-display: swap; src: {srcs}; }}")
        print(f"{fam} {weight}: {len(data) // 1024} KB")
    css = ROOT / "styles.css"
    text = css.read_text(encoding="utf-8")
    region = "/* BEGIN:fonts */\n" + "\n".join(blocks) + "\n/* END:fonts */"
    new = re.sub(r"/\* BEGIN:fonts \*/[\s\S]*?/\* END:fonts \*/", lambda m: region, text) if "/* BEGIN:fonts */" in text else text.rstrip("\n") + "\n\n" + region + "\n"
    css.write_text(new, encoding="utf-8")
    lic = ROOT / "licenses" / "fonts"
    lic.mkdir(parents=True, exist_ok=True)
    for g in LICENSES:
        (lic / f"{g}-OFL.txt").write_bytes(fetch(g, "OFL.txt"))
    print(f"合計 {total // 1024} KB (woff2)。styles.css: {len(new) // 1024} KB")

if __name__ == "__main__":
    main()
