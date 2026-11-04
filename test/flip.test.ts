import assert from "node:assert";
import { backFaceText, backImageOf, backUrl, isMultiFace } from "../src/flip";
import { ScryfallCard, toMarkdown } from "../src/scryfall";

// 名前に // があるカードだけ、裏返せる
assert.equal(isMultiFace("Emeritus of Ideation // Ancestral Recall"), true);
assert.equal(isMultiFace("Lightning Bolt"), false);
assert.equal(isMultiFace(undefined), false);

// 裏面の画像: front を back にする (クエリ文字列はそのまま)
assert.equal(backUrl("https://cards.scryfall.io/normal/front/7/5/abc.jpg?1783903694"), "https://cards.scryfall.io/normal/back/7/5/abc.jpg?1783903694");

const note = (ja: string) => `---
name: "A // B"
---

![](x)

### Emeritus
Creature

Flying

---

### Ancestral Recall
Instant

Target player draws three cards.

${ja}[Scryfall](u)
`;
// 設定言語の節に裏面があれば、それを使う
const both = note("## Text (ja)\n\n### 観念\nCreature\n\n飛行\n\n---\n\n### 先祖の幻視\nInstant\n\n対象のプレイヤーは３枚引く。\n\n");
assert.ok(backFaceText(both)?.includes("対象のプレイヤーは３枚引く"));
// 設定言語の節に裏面が無ければ、英語の裏面
const frontOnly = note("## Text (ja)\n\n### 観念\nCreature\n\n飛行\n\n");
assert.ok(backFaceText(frontOnly)?.includes("Target player draws three cards."));
// 言語の節が無くても英語の裏面
assert.ok(backFaceText(note(""))?.startsWith("### Ancestral Recall"));
// 1面だけのカードは裏面なし
assert.equal(backFaceText("---\nname: x\n---\n\nInstant\n\nDraw.\n\n[Scryfall](u)\n"), undefined);

// 取得: 裏面の画像があるカード (変身・表裏) は、ノートに表の画像の次に裏面の画像 (![back](…)) と layout を書く。準備・冒険は、画像が1枚なので書かない
const base = { id: "6904ea20-e504-47da-95a0-08739fdde260", oracle_id: "o", cmc: 1, color_identity: ["U"], set: "isd", collector_number: "51", rarity: "common", scryfall_uri: "u", type_line: "Creature // Creature" } as const;
const dfc = { ...base, name: "Delver of Secrets // Insectile Aberration", layout: "transform", card_faces: [{ name: "Delver of Secrets", mana_cost: "{U}", type_line: "Creature", image_uris: { normal: "https://cards.scryfall.io/normal/front/6/9/6904ea20-e504-47da-95a0-08739fdde260.jpg?1" } }, { name: "Insectile Aberration", mana_cost: "", type_line: "Creature", image_uris: { normal: "https://cards.scryfall.io/normal/back/6/9/6904ea20-e504-47da-95a0-08739fdde260.jpg?1" } }] } as unknown as ScryfallCard;
const md = toMarkdown(dfc, { lang: "en", printings: [] });
assert.ok(md.includes("layout: transform"));
assert.equal(backImageOf(md), "https://cards.scryfall.io/normal/back/6/9/6904ea20-e504-47da-95a0-08739fdde260.jpg?1");
const prep = { ...dfc, name: "Emeritus // Recall", layout: "prepare", image_uris: { normal: "https://cards.scryfall.io/normal/front/7/5/x.jpg" }, card_faces: [{ name: "Emeritus", mana_cost: "", type_line: "Creature" }, { name: "Recall", mana_cost: "", type_line: "Instant" }] } as unknown as ScryfallCard;
const md2 = toMarkdown(prep, { lang: "en", printings: [] });
assert.ok(md2.includes("layout: prepare"));
assert.equal(backImageOf(md2), undefined, "裏面の画像が無いカードには書かない");
assert.ok(md2.includes("![](https://cards.scryfall.io/normal/front/7/5/x.jpg)"), "表の画像は今までどおり");
