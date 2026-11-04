import assert from "node:assert";
import { cardStatus, nodeUsers, report } from "../src/battle/coverage";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { defineNode, resetRegistry } from "../src/battle/registry";
import { parseRule } from "../src/battle/ruleMd";
import { SAMPLE_RULES } from "../src/battle/samples";

resetRegistry();
registerBuiltinNodes();

// 打ち消し3種は、ノードが実装済みで、シナリオも通る = ok
for (const [name, md] of Object.entries(SAMPLE_RULES)) {
  const s = cardStatus(name, md);
  assert.equal(s.status, "ok", `${name}: ${s.reasons.join(" / ")}`);
  assert.deepEqual(s.reasons, []);
}

// ルールのノートが無い = unbuilt
assert.equal(cardStatus("Island", undefined).status, "unbuilt");

// 未知のノード・壊れた md = unbuilt。理由に行番号 (Review Focus 3)
const unknown = `---\ncard: "[[Foo]]"\n---\n\n## 呪文能力\n\n- teleport who=me\n`;
const u = cardStatus("Foo", unknown);
assert.equal(u.status, "unbuilt");
assert.ok(u.reasons[0].includes("7 行目") && u.reasons[0].includes("未知のノード: teleport"), u.reasons[0]);
const broken = cardStatus("Foo", `---\ncard: "[[Foo]]"\n---\n## でたらめ\n`);
assert.equal(broken.status, "unbuilt");
assert.ok(broken.reasons[0].includes("4 行目"));

// 壊れた md が1つあっても、ほかのカードは影響を受けない
assert.equal(cardStatus("Negate", SAMPLE_RULES["Negate"]).status, "ok");

// 定義はあるが run が無いノード = partial (未実装)
defineNode({ id: "draw", title: "引く", summary: "未実装", params: { count: { type: "number" } }, outputs: {} });
const p = cardStatus("Divination", `---\ncard: "[[Divination]]"\n---\n\n## 呪文能力\n\n- draw count=3\n`);
assert.equal(p.status, "partial");
assert.ok(p.reasons.includes("未実装: draw"), p.reasons.join());

// ノードは全部実装済みでも、シナリオが無ければ ok にしない (動いた記録だけを根拠にする)
const noScenario = cardStatus("Foo", SAMPLE_RULES["Negate"].replace("Negate", "Foo"));
assert.equal(noScenario.status, "partial");
assert.ok(noScenario.reasons.some((r) => r.includes("シナリオが無い")));

// ノードを使うカード
const rules = Object.values(SAMPLE_RULES).map(parseRule);
assert.deepEqual(nodeUsers(rules, "counter").sort(), ["Essence Scatter", "Negate", "Spell Snare"]);
assert.deepEqual(nodeUsers(rules, "target").length, 3);
assert.deepEqual(nodeUsers(rules, "draw"), []);

// レポート
const text = report([cardStatus("Negate", SAMPLE_RULES["Negate"]), p, u]);
assert.ok(text.includes("| カード | 状況 | 理由 |"));
assert.ok(text.includes("| Negate | ok |"));
assert.ok(text.includes("| Divination | partial | 未実装: draw"));

// 手で直した md の意味が壊れたら ok にしない (最終レビューの指摘): シナリオは vault の md を実行する
const edited = cardStatus("Negate", SAMPLE_RULES["Negate"].replace("notType=creature", "type=creature"));
assert.equal(edited.status, "partial");
assert.ok(edited.reasons[0].includes("シナリオが失敗"), edited.reasons.join());
const swapped = SAMPLE_RULES["Essence Scatter"].replace("Essence Scatter", "Negate"); // 本文は Essence Scatter、card: だけ Negate
assert.equal(cardStatus("Negate", swapped).status, "partial");
const wrongCard = cardStatus("Negate", SAMPLE_RULES["Essence Scatter"]); // card: がファイル名と合わない
assert.equal(wrongCard.status, "unbuilt");
assert.ok(wrongCard.reasons[0].includes("Essence Scatter"));
