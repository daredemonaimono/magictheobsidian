import assert from "node:assert";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { buildPrompt } from "../src/battle/prompt";
import { defineNode, resetRegistry } from "../src/battle/registry";
import { SAMPLE_RULES } from "../src/battle/samples";

// ノードが1つも無くても落ちない
resetRegistry();
assert.doesNotThrow(() => buildPrompt("X", "text"));

resetRegistry();
registerBuiltinNodes();
const p = buildPrompt("Negate", "Counter target noncreature spell.");

// 使えるノードの一覧: id・引数名・選択肢
for (const w of ["target", "counter", "notType", "mv", "zone", "stack"]) assert.ok(p.system.includes(w), `system に ${w}`);
// 書式の規則と、表せない部分の書き場所と、例
assert.ok(p.system.includes("## 呪文能力"));
assert.ok(p.system.includes("## 未対応"));
assert.ok(p.system.includes(SAMPLE_RULES["Negate"]), "例としてサンプルの Negate");
// カード
assert.ok(p.user.includes("Negate") && p.user.includes("Counter target noncreature spell."));

// 一覧は、レジストリから作る: 新しく定義したノードが出る
defineNode({ id: "foresee", title: "見通す", summary: "ライブラリーの上を見る (テスト用の未実装ノード)", params: { count: { type: "number", required: true } }, outputs: {} });
assert.ok(buildPrompt("Negate", "x").system.includes("foresee"));

// 裁定後のテキスト: 付いていれば user に載せ、これを正とする。無ければ載せない
{
  resetRegistry();
  registerBuiltinNodes();
  const without = buildPrompt("Negate", "Counter target noncreature spell.");
  assert.ok(!without.user.includes("裁定後"));
  const withRuling = buildPrompt("Negate", "Counter target noncreature spell.", "Counter target spell unless its controller pays {1}.");
  assert.ok(withRuling.user.includes("裁定後のテキスト") && withRuling.user.includes("unless its controller pays {1}"));
  assert.ok(withRuling.user.includes("Counter target noncreature spell."), "現在のテキストも並べる");
  assert.ok(withRuling.system.includes("裁定後のテキスト"), "system に、付いていたらそれを正とする規則");
  assert.ok(!buildPrompt("Negate", "x", "   ").user.includes("裁定後"), "空白だけなら無いのと同じ");
}
