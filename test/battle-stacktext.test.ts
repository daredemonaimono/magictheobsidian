import assert from "node:assert";
import { stackEffectText } from "../src/battle/stackText";

const pw = `Legendary Planeswalker — Jace

各対戦相手のドロー・ステップの開始時に、カード１枚を引く。

+1：青の１/１のイリュージョン・クリーチャー・トークン１体を生成する。

-2：各対戦相手につきそれぞれ、アーティファクトやクリーチャーである最大１つを対象とする。それをオーナーの手札に戻す。

-6：カード３枚を引く。その後、Ｘ個を置く。`;
const tl = "Legendary Planeswalker — Jace";
// プレインズウォーカー: 使った能力の段落だけ (+1 / −2 / −6)
assert.equal(stackEffectText(pw, { typeLine: tl, loyalty: 1 }), "+1：青の１/１のイリュージョン・クリーチャー・トークン１体を生成する。");
assert.ok(stackEffectText(pw, { typeLine: tl, loyalty: -2 }).startsWith("-2：各対戦相手"));
assert.ok(stackEffectText(pw, { typeLine: tl, loyalty: -6 }).startsWith("-6：カード３枚"));
// 英語の「−」(U+2212) でも
assert.ok(stackEffectText("Jace\n\n−2: Return it.\n\n+1: Draw.", { loyalty: -2 }).startsWith("−2:"));
// 全角の数字・プラス
assert.ok(stackEffectText("＋１：引く。\n\n-２：戻す。", { loyalty: 1 }).startsWith("＋１"));
assert.ok(stackEffectText("＋１：引く。\n\n-２：戻す。", { loyalty: -2 }).startsWith("-２"));
// 見つからなければ、全文 (型行は除く)
assert.equal(stackEffectText(pw, { typeLine: tl, loyalty: 9 }).startsWith("各対戦相手"), true);
// モード: 見出し + 選んだモードだけ
const modal = "Instant\n\nChoose one or both —\n\n• Counter target spell.\n\n• Tap one or two target creatures.";
assert.equal(stackEffectText(modal, { typeLine: "Instant", modes: [2] }), "Choose one or both —\n• Tap one or two target creatures.");
assert.equal(stackEffectText(modal, { typeLine: "Instant", modes: [1, 2] }), "Choose one or both —\n• Counter target spell.\n• Tap one or two target creatures.");
// 普通の呪文: 全文
assert.equal(stackEffectText("Instant\n\nDraw two cards.", { typeLine: "Instant" }), "Draw two cards.");
console.log("stacktext ok");

// 日本語のテキストは、忠誠度能力が、空行なしで並ぶ。使った能力の行だけを出す
{
  const ja = "Legendary Planeswalker — Oko\n\n+2：食物・トークンを１つ生成する。\n+1：アーティファクト１つかクリーチャー１体を対象とする。それは能力をすべて失う。\n-5：コントロールを交換する。\n続きの行。";
  assert.equal(stackEffectText(ja, { typeLine: "Legendary Planeswalker — Oko", loyalty: 2 }), "+2：食物・トークンを１つ生成する。");
  assert.equal(stackEffectText(ja, { typeLine: "Legendary Planeswalker — Oko", loyalty: 1 }), "+1：アーティファクト１つかクリーチャー１体を対象とする。それは能力をすべて失う。");
  assert.equal(stackEffectText(ja, { typeLine: "Legendary Planeswalker — Oko", loyalty: -5 }), "-5：コントロールを交換する。\n続きの行。", "続きの行は、その能力につく");
}
console.log("stacktext ja ok");
