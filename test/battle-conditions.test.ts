import assert from "node:assert";
import { castSpell, passPriority } from "../src/battle/engine";
import { setIf } from "../src/battle/editor";
import { CastRecord, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { checkCall, checkCondition, resetRegistry } from "../src/battle/registry";
import { parseRule, writeRule } from "../src/battle/ruleMd";
import { Game, GameCard, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const card = (id: string, typeLine = "Instant", owner = "A", mv = 1): GameCard => ({ id, name: id, typeLine, mv, owner });
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const bookOf = (bodies: Record<string, NodeCall[]>): RuleBook => ({ get: (c) => (bodies[c] ? { card: c, abilities: [{ kind: "spell", body: bodies[c] }] } : undefined) });
const ids = (cs: GameCard[]) => cs.map((c) => c.id);

// 条件の書き方の検証: 登録された条件と、その否定 (!) だけ
assert.equal(checkCondition("kicked"), null);
assert.equal(checkCondition("!teamwork"), null);
assert.equal(checkCondition("foo"), "未知の条件: foo");
assert.equal(checkCondition("!"), "未知の条件: !");
assert.equal(checkCall(call("draw", { player: "you", count: 1 }, { if: "kicked" })), null);
assert.equal(checkCall(call("draw", { player: "you", count: 1 }, { if: "foo" })), "未知の条件: foo");

// md: if= は as と同じく、ノードにつく予約の名前。往復できる (否定も)
{
  const md = `---
mtg: rule
card: "[[X]]"
---

## 呪文能力

- draw as=d if=kicked player=you count=1
- discard if=!teamwork player=you count=1
`;
  const r = parseRule(md);
  assert.equal(r.abilities[0].body[0].if, "kicked");
  assert.equal(r.abilities[0].body[1].if, "!teamwork");
  assert.deepEqual(r.abilities[0].body[0].args, { player: "you", count: 1 }, "if は引数に入らない");
  assert.equal(writeRule(r), md.replace("draw as=d if=kicked player=you count=1", "draw as=d if=kicked player=you count=1"));
}

// 画面の操作: 条件を付ける・外す
{
  const r = parseRule(`---\ncard: "[[X]]"\n---\n## 呪文能力\n- draw player=you count=1\n`);
  const withIf = setIf(r, 0, 0, "kicked");
  assert.equal(withIf.abilities[0].body[0].if, "kicked");
  assert.equal("if" in setIf(withIf, 0, 0, undefined).abilities[0].body[0], false);
  assert.equal(r.abilities[0].body[0].if, undefined, "元は変えない");
}

// 実行: キッカー (Into the Roil): 戦場の非土地パーマネントを手札に戻し、キッカーされていたら 1 枚引く
const roil = [call("target", { zone: "battlefield", kind: "permanent", notType: "land" }, { as: "t" }), call("bounce", { target: { ref: "t" } }), call("draw", { player: "you", count: 1 }, { if: "kicked" })];
const castRoil = (cast: CastRecord) => {
  const g: Game = createGame(["A", "B"]);
  g.hands["A"].push(card("roil"));
  g.libraries["A"] = [card("top")];
  g.battlefield.push({ id: "bear", card: card("bear", "Creature — Bear", "B"), controller: "B" });
  const book = bookOf({ roil });
  castSpell(g, "A", "roil", { t: "bear" }, book, cast);
  passPriority(g, "A", book);
  passPriority(g, "B", book);
  return g;
};
{
  const kicked = castRoil({ kicked: true });
  assert.deepEqual(ids(kicked.hands["B"]), ["bear"]);
  assert.deepEqual(ids(kicked.hands["A"]), ["top"], "キッカーされていたら引く");
  const plain = castRoil({});
  assert.deepEqual(ids(plain.hands["B"]), ["bear"], "戻すのは条件なし");
  assert.deepEqual(ids(plain.hands["A"]), [], "キッカーされていなければ引かない");
}

// 実行: チームワーク (We Say Thee Nay!): 払わないかぎり打ち消す。チームワークなら 4、そうでなければ 2 (「代わりに」は、条件と否定のノードを並べて表す)
const nay = [
  call("target", { zone: "stack", kind: "spell" }, { as: "t" }),
  call("counter", { target: { ref: "t" }, unlessPay: 4 }, { if: "teamwork" }),
  call("counter", { target: { ref: "t" }, unlessPay: 2 }, { if: "!teamwork" }),
];
const duel = (mana: number, cast: CastRecord) => {
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("bolt"));
  g.hands["B"].push(card("nay", "Instant", "B"));
  g.mana["A"] = mana;
  const book = bookOf({ bolt: [], nay });
  castSpell(g, "A", "bolt", {}, book);
  passPriority(g, "A", book);
  castSpell(g, "B", "nay", { t: "bolt" }, book, cast);
  passPriority(g, "B", book);
  passPriority(g, "A", book);
  return g;
};
{
  assert.deepEqual(duel(2, {}).stack.map((s) => s.id), ["bolt"], "チームワーク無しは 2 払えば通る");
  assert.deepEqual(duel(1, {}).stack, [], "2 払えなければ打ち消される");
  assert.deepEqual(duel(2, { teamwork: true }).stack, [], "チームワークなら 4 要る (2 では足りない)");
  assert.deepEqual(duel(4, { teamwork: true }).stack.map((s) => s.id), ["bolt"], "4 払えば通る");
}

// 対象を決めるノード (target) には条件を付けられない: 唱えるときの対象の検査が条件を見ないため、条件つきの target は意味が食い違う
assert.ok(checkCall(call("target", { zone: "stack", kind: "spell" }, { if: "kicked" }))?.includes("対象"));
assert.equal(checkCall(call("target", { zone: "stack", kind: "spell" })), null);
