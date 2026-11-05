import assert from "node:assert";
import { editableMemo, extractMemo, setMemo } from "../src/battle/memo";

const deck = `---\nmtg: deck\n---\n\n## Main\n4 [[Island]]\n\n## Side\n\n## メモ\n\n土地が2枚以下ならマリガン。\nAetherize は、攻撃されたときに使う。\n\n## 動き方\n\n- 勝ち筋: 飛行で殴る\n- 序盤:\n- 注意点:\n`;
// 読む: 「メモ」の欄だけ。「動き方」の欄は、読まない
assert.equal(extractMemo(deck), "土地が2枚以下ならマリガン。\nAetherize は、攻撃されたときに使う。");
assert.equal(extractMemo("## Main\n4 [[Island]]\n"), "", "メモが無ければ、空");
assert.equal(extractMemo("## 動き方\n\n- 勝ち筋: 飛行で殴る\n"), "", "「動き方」の欄は、読まない");
assert.equal(extractMemo("## メモ\n\n- 勝ち筋:\n- 序盤: 土地を置く\n"), "- 序盤: 土地を置く", "中身が空の項目は、読まない");
// 編集の画面には、メモの本文だけ
assert.equal(editableMemo(deck), "土地が2枚以下ならマリガン。\nAetherize は、攻撃されたときに使う。");
// 書き込み: メモの本文だけが替わる (ほかは、そのまま)
const out = setMemo(deck, "新しいメモ\n2行目");
assert.equal(extractMemo(out), "新しいメモ\n2行目");
assert.ok(out.includes("## Main\n4 [[Island]]") && out.includes("## 動き方") && out.startsWith("---\nmtg: deck"));
// 見出しが無ければ、最後に作る。空なら、作らない
assert.equal(setMemo("## Main\n4 [[Island]]\n", "メモ"), "## Main\n4 [[Island]]\n\n## メモ\n\nメモ\n");
assert.equal(setMemo("## Main\n4 [[Island]]\n", "  "), "## Main\n4 [[Island]]\n");
// 空にすると、見出しは残して、中身を消す
assert.equal(editableMemo(setMemo(deck, "")), "");
console.log("memo ok");
