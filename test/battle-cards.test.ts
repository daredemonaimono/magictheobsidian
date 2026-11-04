import assert from "node:assert";
import { cardStatus } from "../src/battle/coverage";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";

resetRegistry();
registerBuiltinNodes();

// デッキのカードを、ノードで書いた形 (AI が目指す形)。ノードの検査・置き場所・構造の検査を通ること (unbuilt でない)、未実装のノードが無いことを確かめる。
// シナリオが無いので、状況は partial (シナリオが無い) になる。プロンプトが約束する書き方を、検証が拒まないことの保証
const md = (card: string, body: string) => `---\nmtg: rule\ncard: "[[${card}]]"\n---\n\n${body}\n`;
const CARDS: Record<string, string> = {
  "Geist of Saint Thalia": md("Geist of Saint Thalia", `## 常在型能力\n\n- keyword name=flying\n\n## 常在型能力\n\n- reduceCost amount=1 who=you notType=creature`),
  "Illvoi Light Jammer": md(
    "Illvoi Light Jammer",
    `## 常在型能力\n\n- keyword name=flash\n\n## 誘発型能力\n\n- when event=enters self=true\n- target as=t zone=battlefield kind=permanent type=creature controller=you\n- attach target=$t\n- grant target=$t keyword=hexproof duration=endOfTurn\n\n## 常在型能力\n\n- affect who=attached\n- staticModify power=1 toughness=2\n\n## 起動型能力\n\n- timing sorcery=true\n- cost mana=3\n- target as=t zone=battlefield kind=permanent type=creature controller=you\n- attach target=$t`,
  ),
  "Wizard's Staff": md(
    "Wizard's Staff",
    `## 常在型能力\n\n- affect who=attached\n- staticGrant keyword=prowess\n- extraTriggers amount=1\n\n## 起動型能力\n\n- timing sorcery=true\n- cost mana=1\n- target as=t zone=battlefield kind=permanent type=wizard controller=you\n- attach target=$t\n\n## 起動型能力\n\n- timing sorcery=true\n- cost mana=3\n- target as=t zone=battlefield kind=permanent type=creature controller=you\n- attach target=$t`,
  ),
  "Witness Protection": md(
    "Witness Protection",
    `## 呪文能力\n\n- target as=t zone=battlefield kind=permanent type=creature\n- attach target=$t\n\n## 常在型能力\n\n- affect who=attached\n- loseAbilities\n- setBaseStats power=1 toughness=1\n- setTypes types="Creature — Citizen"\n- setColors colors="G W"\n- setName name="Legitimate Businessperson"`,
  ),
};
for (const [name, text] of Object.entries(CARDS)) {
  const s = cardStatus(name, text);
  assert.notEqual(s.status, "unbuilt", `${name}: ${s.reasons.join(" / ")}`);
  assert.ok(!s.reasons.some((r) => r.includes("未実装")), `${name}: ${s.reasons.join(" / ")}`);
}
