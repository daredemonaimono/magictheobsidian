import assert from "node:assert/strict";
import { NodeData, parseMd, toMd } from "../src/node/md";
import { validate } from "../src/node/validate";

// 威迫: 常在型能力。ブロックの条件を課す (誘発ではない)
const menace: NodeData = { name: "威迫", kind: "常在型能力", timing: "常に", steps: [{ node: false, id: "ブロックの条件を課す", args: { 最少のブロッカー数: "2" } }] };
// 獰猛 (パワー4以上): 攻撃したとき、条件つきで +2/+2 (ターン終了時まで)
const ferocious: NodeData = {
  name: "獰猛",
  kind: "誘発型能力",
  timing: "攻撃したとき",
  condition: { id: "パワーがN以上のクリーチャーをコントロールしている", args: { N: "4" } },
  steps: [{ node: false, id: "修整を与える", args: { 対象: "このクリーチャー", パワー: "2", タフネス: "2", 期間: "ターン終了時まで" } }],
};
const none = () => undefined;

// 書いて読むと、元に戻る
for (const n of [menace, ferocious]) assert.deepEqual(parseMd(toMd(n)), n);
assert.ok(toMd(ferocious).includes("- 修整を与える 対象=このクリーチャー パワー=2 タフネス=2 期間=ターン終了時まで"));
assert.deepEqual(validate(menace, none), []);
assert.deepEqual(validate(ferocious, none), []);

// 空白を含む値は、引用符で囲んで、元に戻る
const spaced: NodeData = { ...ferocious, steps: [{ node: false, id: "修整を与える", args: { 対象: "このクリーチャー", パワー: "1", タフネス: "1", 期間: "このノードが適用される間" } }] };
assert.deepEqual(parseMd(toMd(spaced)), spaced);

// 検証: ルールに反するもの
const bad = (n: Partial<NodeData>, get: (x: string) => NodeData | undefined = none) => validate({ ...ferocious, ...n }, get).join(" / ");
assert.match(bad({ kind: "魔法" }), /種類/);
assert.match(bad({ timing: "常に" }), /タイミング "常に" は、誘発型能力にない/);
assert.match(validate({ ...menace, kind: "誘発型能力", timing: "攻撃したとき" }, none).join(), /常在型能力でだけ/, "威迫の動作は、誘発では使えない");
assert.match(bad({ steps: [] }), /手順が空/);
assert.match(bad({ steps: [{ node: false, id: "ダメージを与える", args: { 対象: "このクリーチャー", 量: "x" } }] }), /量 は整数/);
assert.match(bad({ steps: [{ node: false, id: "ダメージを与える", args: { 対象: "このクリーチャー" } }] }), /量 が無い/);
assert.match(bad({ name: "a/b" }), /使えない文字/);

// 参照: 無いノード・循環
const useIt: NodeData = { ...ferocious, name: "親", steps: [{ node: true, id: "獰猛" }] };
assert.match(validate(useIt, none).join(), /\[\[獰猛\]\] が無い/);
assert.deepEqual(validate(useIt, (n) => (n === "獰猛" ? ferocious : undefined)), []);
const a: NodeData = { ...ferocious, name: "A", steps: [{ node: true, id: "B" }] };
const b: NodeData = { ...ferocious, name: "B", steps: [{ node: true, id: "A" }] };
assert.match(validate(a, (n) => (n === "B" ? b : n === "A" ? a : undefined)).join(), /循環: A → B → A/);

console.log("node ok");
