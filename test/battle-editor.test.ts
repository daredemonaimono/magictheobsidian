import assert from "node:assert";
import { addAbility, addNode, blankRule, connect, moveNode, problems, removeAbility, removeNode, setArg, setAs, setUnsupported } from "../src/battle/editor";
import { CardRule } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { parseRule, writeRule } from "../src/battle/ruleMd";
import { SAMPLE_RULES } from "../src/battle/samples";

resetRegistry();
registerBuiltinNodes();
const negate = (): CardRule => parseRule(SAMPLE_RULES["Negate"]);
const msgs = (r: CardRule) => problems(r).map((p) => p.message);

// 画面の操作だけで Negate を組める (md と一致する)
{
  let r = blankRule("Negate");
  assert.deepEqual(r.abilities.map((a) => a.kind), ["spell"], "空のルールは、呪文能力が1つ");
  r = addNode(r, 0, "target");
  assert.deepEqual(r.abilities[0].body[0].args, { zone: "stack", kind: "spell" }, "必須の選択肢は先頭が入る");
  r = setArg(r, 0, 0, "notType", "creature");
  r = addNode(r, 0, "counter");
  assert.deepEqual(msgs(r), ["必須の引数がない: target"], "つなぐまでは赤い");
  r = connect(r, 0, 0, 1, "target");
  assert.equal(r.abilities[0].body[0].as, "t", "出力のあるノードに、as が自動で付く");
  assert.deepEqual(r.abilities[0].body[1].args.target, { ref: "t" });
  assert.deepEqual(problems(r), []);
  assert.equal(writeRule(r), SAMPLE_RULES["Negate"]);
}

// 追加の位置・知らないノード・数値/真偽の既定値
{
  const r = addNode(addNode(blankRule("X"), 0, "counter"), 0, "target", 0);
  assert.deepEqual(r.abilities[0].body.map((c) => c.node), ["target", "counter"], "位置を指定して挿入");
  assert.throws(() => addNode(blankRule("X"), 0, "nope"));
  const d = addNode(blankRule("X"), 0, "draw");
  assert.deepEqual(d.abilities[0].body[0].args, { player: "you", count: 1 }, "必須の数値は 1");
}

// 元のルールは変えない
{
  const r = negate();
  const before = JSON.stringify(r);
  removeNode(r, 0, 0);
  moveNode(r, 0, 0, 1);
  setArg(r, 0, 0, "mv", 2);
  assert.equal(JSON.stringify(r), before);
}

// 削除: 消えたノードを指していた参照は外れる
{
  const r = removeNode(negate(), 0, 0);
  assert.equal(r.abilities[0].body.length, 1);
  assert.equal(r.abilities[0].body[0].args.target, undefined);
  assert.deepEqual(msgs(r), ["必須の引数がない: target"]);
}

// 並べ替え: 参照元が後ろに来たら赤くなる。戻せば直る
{
  const swapped = moveNode(negate(), 0, 0, 1);
  assert.deepEqual(swapped.abilities[0].body.map((c) => c.node), ["counter", "target"]);
  assert.ok(msgs(swapped).some((m) => m.includes("$t") && m.includes("見つからない")));
  assert.deepEqual(problems(moveNode(swapped, 0, 0, 1)), []);
}

// 接続: 出力の無いノードからはつなげない。as は重複しない。as の付け替えは参照も直る
{
  const r = negate();
  assert.throws(() => connect(r, 0, 1, 0, "target"), /出力が無い/);
  let two = addNode(addNode(blankRule("X"), 0, "target"), 0, "target");
  two = addNode(two, 0, "counter");
  two = connect(two, 0, 0, 2, "target");
  two = connect(two, 0, 1, 2, "target");
  assert.deepEqual(two.abilities[0].body.map((c) => c.as), ["t", "t2", undefined], "2つ目は t2");
  const renamed = setAs(negate(), 0, 0, "victim");
  assert.deepEqual(renamed.abilities[0].body[1].args.target, { ref: "victim" });
  assert.deepEqual(problems(renamed), []);
  const dup = setAs(addNode(negate(), 0, "target"), 0, 2, "t");
  assert.ok(msgs(dup).some((m) => m.includes("重複")));
}

// 引数: undefined で消える。引用符を含む文字列は検証で止める (md に安全に書けないため)
{
  const r = setArg(negate(), 0, 0, "notType", undefined);
  assert.equal("notType" in r.abilities[0].body[0].args, false);
  const q = setArg(negate(), 0, 0, "notType", 'a"b');
  assert.ok(msgs(q).some((m) => m.includes("引用符")));
}

// 能力の追加・削除、未対応のメモ
{
  let r = addAbility(negate(), "triggered");
  assert.deepEqual(r.abilities.map((a) => a.kind), ["spell", "triggered"]);
  r = removeAbility(r, 1);
  assert.equal(r.abilities.length, 1);
  const u = setUnsupported(negate(), ["例の条件", "  ", ""]);
  assert.deepEqual(u.unsupported, ["例の条件"], "空行は捨てる");
  assert.equal(setUnsupported(u, []).unsupported, undefined, "空なら項目ごと無くす");
}

// 問題の位置: どの能力のどのノードか
{
  const r = setArg(negate(), 0, 1, "unlessPay", "x");
  const p = problems(r);
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].ability, p[0].node], [0, 1]);
}

// md に書けない as の名前 (空白・引用符など) と、小数は、保存前に止める (最終レビューの指摘: 保存できて、読み直すと壊れていた)
{
  for (const bad of ["my target", 'a"b', "a=b", "$x", "1abc", "全角"]) {
    assert.ok(msgs(setAs(negate(), 0, 0, bad)).some((m) => m.includes("as は")), `as=${bad}`);
  }
  for (const ok of ["t", "victim", "t2", "my-target", "_x"]) assert.deepEqual(problems(setAs(negate(), 0, 0, ok)), [], `as=${ok}`);
  let r = addNode(blankRule("X"), 0, "draw");
  r = setArg(r, 0, 0, "count", 1.5);
  assert.ok(msgs(r).some((m) => m.includes("整数")));
  assert.deepEqual(problems(setArg(r, 0, 0, "count", 2)), []);
}
