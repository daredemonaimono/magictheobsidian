import assert from "node:assert";
import { backFaceText, backUrl, isMultiFace } from "../src/flip";

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
