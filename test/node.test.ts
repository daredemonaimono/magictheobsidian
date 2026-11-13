import assert from "node:assert/strict";
import { setLang } from "../src/i18n";
import { KINDS } from "../src/node/kinds";
import { NodeData, parseMd, toMd } from "../src/node/md";
import { validate } from "../src/node/validate";

// 能力の種類は、この 5 つ (この順)
assert.deepEqual(KINDS.map((k) => k.label.ja), ["常在型", "誘発型", "起動型", "呪文能力", "キーワード能力"]);
assert.deepEqual(KINDS.map((k) => k.label.en), ["Static", "Triggered", "Activated", "Spell", "Keyword"]);

// 威迫: キーワード能力。ブロックの条件を課す (誘発ではない)
const menace: NodeData = { name: "Menace", kind: "keyword", timing: "always", steps: [{ node: false, id: "block-requirement", args: { "min-blockers": "2" } }] };
// 獰猛 (パワー4以上): 誘発型。攻撃したとき、条件つきで +2/+2 (ターン終了時まで)
const ferocious: NodeData = {
  name: "Ferocious",
  kind: "triggered",
  timing: "attacks",
  condition: { id: "controls-power-at-least", args: { n: "4" } },
  steps: [{ node: false, id: "modify-pt", args: { target: "self", power: "2", toughness: "2", duration: "until-eot" } }],
};
const none = () => undefined;

for (const lang of ["ja", "en"] as const) {
  setLang(lang);
  // 書いて読むと、元に戻る (どちらの言語でも)
  for (const n of [menace, ferocious]) assert.deepEqual(parseMd(toMd(n)), n, lang);
  assert.deepEqual(validate(menace, none), []);
  assert.deepEqual(validate(ferocious, none), []);
}

// 書き出しは、設定の言語 (フロントマター・見出し・動作・引数・値)
setLang("ja");
const ja = toMd(ferocious);
assert.ok(ja.includes("lang: ja\n種類: 誘発型\nタイミング: 攻撃したとき\n"), ja);
assert.ok(ja.includes("条件: パワーがN以上のクリーチャーをコントロールしている: N=4"), ja);
assert.ok(ja.includes("## 手順\n- 修整を与える: 対象=このクリーチャー, パワー=2, タフネス=2, 期間=ターン終了時まで"), ja);
setLang("en");
const en = toMd(ferocious);
assert.ok(en.includes("lang: en\nkind: Triggered\ntiming: When it attacks\n"), en);
assert.ok(en.includes("Condition: You control a creature with power N or greater: N=4"), en);
assert.ok(en.includes("## Steps\n- Modify power/toughness: Target=this creature, Power=2, Toughness=2, Duration=until end of turn"), en);
assert.ok(toMd(menace).includes("- Set a blocking requirement: Minimum blockers=2"));

// 言語を切り替えても、別の言語で書かれたノートを読める
assert.deepEqual(parseMd(ja), ferocious);
setLang("ja");
assert.deepEqual(parseMd(en), ferocious);

// 検証: ルールに反するもの (日本語の文)
const bad = (n: Partial<NodeData>, get: (x: string) => NodeData | undefined = none) => validate({ ...ferocious, ...n }, get).join(" / ");
assert.match(bad({ kind: "x" }), /種類 "x"/);
assert.match(bad({ timing: "always" }), /タイミング "always" は、誘発型にない/);
assert.match(validate({ ...menace, kind: "triggered", timing: "attacks" }, none).join(), /常在型 \/ キーワード能力でだけ/, "威迫の動作は、誘発では使えない");
assert.match(bad({ steps: [] }), /手順が空/);
assert.match(bad({ steps: [{ node: false, id: "deal-damage", args: { target: "self", amount: "x" } }] }), /量 は整数/);
assert.match(bad({ steps: [{ node: false, id: "deal-damage", args: { target: "self" } }] }), /量 が無い/);
assert.match(bad({ name: "a/b" }), /使えない文字/);
setLang("en");
assert.match(bad({ timing: "always" }), /Timing "always" does not exist for Triggered/, "英語の文");

// 参照: 無いノード・循環
setLang("ja");
const useIt: NodeData = { ...ferocious, name: "親", steps: [{ node: true, id: "Ferocious" }] };
assert.match(validate(useIt, none).join(), /\[\[Ferocious\]\] が無い/);
assert.deepEqual(validate(useIt, (n) => (n === "Ferocious" ? ferocious : undefined)), []);
const a: NodeData = { ...ferocious, name: "A", steps: [{ node: true, id: "B" }] };
const b: NodeData = { ...ferocious, name: "B", steps: [{ node: true, id: "A" }] };
assert.match(validate(a, (n) => (n === "B" ? b : n === "A" ? a : undefined)).join(), /循環: A → B → A/);

console.log("node ok");
