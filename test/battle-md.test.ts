import assert from "node:assert";
import { RuleParseError, parseRule, writeRule } from "../src/battle/ruleMd";

const negate = `---
mtg: rule
card: "[[Negate]]"
---

## 呪文能力

- target as=t zone=stack kind=spell notType=creature
- counter target=$t
`;

// 読み込み
const r = parseRule(negate);
assert.equal(r.card, "Negate");
assert.equal(r.abilities.length, 1);
assert.equal(r.abilities[0].kind, "spell");
assert.equal(r.abilities[0].body[0].node, "target");
assert.equal(r.abilities[0].body[0].as, "t");
assert.equal(r.abilities[0].body[0].args.notType, "creature");
assert.deepEqual(r.abilities[0].body[1].args.target, { ref: "t" });

// 往復: 正規化済みの入力は、そのまま書き戻せる
assert.equal(writeRule(r), negate);

// 値の種類: 数値・真偽・引用。全角スペースと行頭の空白は許す
const odd = parseRule(`---\ncard: [[X]]\n---\n\n## 起動型能力\n\n  -　cost　mv=2　flag=true　name="a b"\n`);
assert.equal(odd.abilities[0].kind, "activated");
assert.deepEqual(odd.abilities[0].body[0].args, { mv: 2, flag: true, name: "a b" });
assert.deepEqual(parseRule(writeRule(odd)), odd, "引用つきの値も往復できる");

// 見出しの重複 = 能力が2つ
const two = parseRule(`---\ncard: "[[Y]]"\n---\n## 起動型能力\n- a x=1\n## 起動型能力\n- b x=2\n## 誘発型能力\n- c\n## 常在型能力\n- d\n`);
assert.deepEqual(two.abilities.map((a) => a.kind), ["activated", "activated", "triggered", "static"]);

// 異常系は RuleParseError で、行番号つき
const bad = (md: string, line: number) => {
  try {
    parseRule(md);
  } catch (e) {
    assert.ok(e instanceof RuleParseError, "RuleParseError であること");
    assert.equal((e as RuleParseError).line, line, `行番号 ${(e as RuleParseError).message}`);
    return;
  }
  assert.fail("エラーになるはず");
};
bad("## 呪文能力\n- a\n", 1); // card: が無い (1行目で気づく)
bad(`---\ncard: "[[A]]"\n---\n## でたらめ\n`, 4); // 未知の見出し
bad(`---\ncard: "[[A]]"\n---\n- a x=1\n`, 4); // 見出しの前の箇条書き
bad(`---\ncard: "[[A]]"\n---\n## 呪文能力\n- a x=\n`, 5); // 値が空

// ## 未対応: 表せない部分を、文章のまま持つ。往復できる
const withNote = `---
mtg: rule
card: "[[Negate]]"
---

## 呪文能力

- counter target=$t

## 未対応

- 対象の呪文のコントローラーが{2}を払うなら打ち消さない
`;
const noted = parseRule(withNote);
assert.deepEqual(noted.unsupported, ["対象の呪文のコントローラーが{2}を払うなら打ち消さない"]);
assert.equal(noted.abilities.length, 1, "未対応の箇条書きはノードとして読まない");
assert.equal(writeRule(noted), withNote);
assert.equal(parseRule(negate).unsupported, undefined, "未対応が無ければ undefined");
