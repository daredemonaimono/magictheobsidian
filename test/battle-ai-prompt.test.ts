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

// 条件 if=: 登録された条件の一覧と、書き方・「代わりに」の表し方を載せる
{
  resetRegistry();
  registerBuiltinNodes();
  const sys = buildPrompt("Into the Roil", "x").system;
  for (const w of ["if=", "kicked", "teamwork", "if=!", "代わりに"]) assert.ok(sys.includes(w), `system に ${w}`);
}

// コスト: 起動型能力の cost と、呪文の追加コスト (additionalCost) の書き方を載せる
{
  resetRegistry();
  registerBuiltinNodes();
  const sys = buildPrompt("Island", "x").system;
  for (const w of ["additionalCost", "addMana", "## 起動型能力", "cost mana=", "tapCreatures"]) assert.ok(sys.includes(w), `system に ${w}`);
}

// 第2弾: モード・数の条件・複数の対象・リスト (look / choose / move / select) の書き方を載せる
{
  resetRegistry();
  registerBuiltinNodes();
  const sys = buildPrompt("Confusticate and Bebother", "x").system;
  for (const w of ["modes", "if=mode1", "graveyard:lesson:3+", "最大", "select", "look", "choose", "move", "except", "attacking"]) assert.ok(sys.includes(w), `system に ${w}`);
}

// 第3弾: 誘発型能力 (when)・self・カウンター・キーワードの宣言の書き方を載せる
{
  resetRegistry();
  registerBuiltinNodes();
  const sys = buildPrompt("Brineborn Cutthroat", "x").system;
  for (const w of ["## 誘発型能力", "when event=", "self", "addCounter", "keyword name=", "enters", "leaves", "## 常在型能力"]) assert.ok(sys.includes(w), `system に ${w}`);
}

// 第4弾: 継続効果 (affect と効果のノード)・装備とオーラ (attach / timing)・コスト軽減の書き方を載せる
{
  resetRegistry();
  registerBuiltinNodes();
  const sys = buildPrompt("Illvoi Light Jammer", "x").system;
  for (const w of ["affect who=attached", "staticModify", "staticGrant", "loseAbilities", "setBaseStats", "attach", "timing sorcery=true", "reduceCost", "extraTriggers", "Aura"]) assert.ok(sys.includes(w), `system に ${w}`);
  assert.ok(!sys.includes("誘発型能力は、誘発したときに対象を選べない"), "誘発時の対象は、いまは自動で選ばれる");
}

// 用語集: 既定の定義 (パーマネントの範囲・能力の見分け方) が載る。自分の用語集を渡すと、既定のかわりにそれが載る
{
  resetRegistry();
  registerBuiltinNodes();
  const sys = buildPrompt("Geist of Saint Thalia", "x").system;
  for (const w of ["Glossary", "permanent", "counters", "emblems", "Whenever", "Equip", "## 誘発型能力"]) assert.ok(sys.includes(w), `system に ${w}`); // 用語集は英語。能力の見出しは md の書式なので日本語のまま
  const mine = buildPrompt("X", "x", undefined, "独自の定義XYZ").system;
  assert.ok(mine.includes("独自の定義XYZ"));
  assert.ok(!mine.includes("A permanent is a card"), "自分の用語集があれば、既定は載せない");
  assert.ok(buildPrompt("X", "x", undefined, "   ").system.includes("A permanent is a card"), "空白だけなら既定");
}
