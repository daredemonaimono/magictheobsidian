import assert from "node:assert";
import { CardStatus, cardStatus } from "../src/battle/coverage";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { SAMPLE_RULES } from "../src/battle/samples";
import { filterRows, initialChecked, overwriteCount, setShown, toRows } from "../src/battle/select";

resetRegistry();
registerBuiltinNodes();

const cards = ["Negate", "Island", "Spell Snare", "Essence Scatter"];
const statuses = new Map<string, CardStatus>([
  ["Negate", cardStatus("Negate", SAMPLE_RULES["Negate"])], // ok
  ["Island", cardStatus("Island", undefined)], // ルールのノートが無い
  ["Spell Snare", cardStatus("Spell Snare", `---\ncard: "[[Spell Snare]]"\n---\n## でたらめ\n`)], // ノートはあるが壊れている
]); // Essence Scatter は、そもそも statuses に無い

const rows = toRows(cards, statuses);
assert.deepEqual(rows.map((r) => r.card), ["Essence Scatter", "Island", "Negate", "Spell Snare"], "名前順");
const by = Object.fromEntries(rows.map((r) => [r.card, r]));
assert.deepEqual([by["Negate"].hasRule, by["Negate"].status], [true, "ok"]);
assert.deepEqual([by["Island"].hasRule, by["Island"].status], [false, "none"]);
assert.deepEqual([by["Essence Scatter"].hasRule, by["Essence Scatter"].status], [false, "none"]);
assert.deepEqual([by["Spell Snare"].hasRule, by["Spell Snare"].status], [true, "unbuilt"], "壊れたノートは、ルールがあるカード");

// 初期のチェックは、ルールのノートが無いカードだけ
assert.deepEqual([...initialChecked(rows)].sort(), ["Essence Scatter", "Island"]);
assert.equal(initialChecked(toRows(["Negate"], new Map([["Negate", statuses.get("Negate")!]]))).size, 0, "全部にルールがあれば空");

// 絞り込み: 名前の部分一致 (大文字小文字を区別しない)。空は全部
assert.deepEqual(filterRows(rows, "neg").map((r) => r.card), ["Negate"]);
assert.equal(filterRows(rows, "").length, 4);
assert.equal(filterRows(rows, "zzz").length, 0);

// 「表示中をチェック / 外す」は、絞り込みで見えている行だけを変える。見えていないチェックは保持する (最終レビューの指摘)
const start = initialChecked(rows); // Essence Scatter, Island
assert.deepEqual([...setShown(start, rows, "neg", true)].sort(), ["Essence Scatter", "Island", "Negate"], "見えている Negate だけが増える");
assert.deepEqual([...setShown(start, rows, "isl", false)].sort(), ["Essence Scatter"], "見えている Island だけが外れる");
assert.deepEqual([...setShown(start, rows, "", true)].sort(), ["Essence Scatter", "Island", "Negate", "Spell Snare"], "絞り込みが空なら全部");
assert.deepEqual([...start].sort(), ["Essence Scatter", "Island"], "元の集合は変えない");

// 上書きになる枚数 (ルールがあるカードがチェックされている数)
assert.equal(overwriteCount(rows, new Set(["Negate", "Island"])), 1);
assert.equal(overwriteCount(rows, initialChecked(rows)), 0);

// 未設定の md (## 未対応 だけ) は、ルールのノートが無いカードと同じ扱い: 初期にチェックが入り、上書きとは数えない
const unset = new Map<string, CardStatus>([["Ancestral Recall", cardStatus("Ancestral Recall", `---\ncard: "[[Ancestral Recall]]"\n---\n\n## 未対応\n\n- Target player draws three cards.\n`)]]);
const unsetRows = toRows(["Ancestral Recall"], unset);
assert.deepEqual([unsetRows[0].hasRule, unsetRows[0].status], [false, "none"]);
assert.deepEqual([...initialChecked(unsetRows)], ["Ancestral Recall"]);
assert.equal(overwriteCount(unsetRows, initialChecked(unsetRows)), 0);

// 実行できるかの判定: 裁定後のテキストは、1枚だけ選んだときに送れる (複数枚に同じ裁定を送ると、別のカードに誤って効くため)
import { runCheck } from "../src/battle/select";
assert.equal(runCheck(0, ""), "カードを選んでください");
assert.equal(runCheck(3, ""), null, "裁定が空なら何枚でも");
assert.equal(runCheck(3, "   "), null, "空白だけなら無いのと同じ");
assert.equal(runCheck(1, "Counter target spell."), null);
assert.ok(runCheck(2, "Counter target spell.")?.includes("1枚だけ"), "裁定があって2枚は不可");
assert.ok(runCheck(0, "x")?.includes("カードを選んで"), "0枚が先");
