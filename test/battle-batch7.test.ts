import assert from "node:assert";
import { RuleError, castSpell, passPriority, playLand } from "../src/battle/engine";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { checkCall, resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const card = (id: string, typeLine = "Instant", owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const spell = (...body: NodeCall[]): Ability[] => [{ kind: "spell", body }];
const creature = (id: string, owner: string, power = 2, toughness = 2, extra: Partial<Perm> = {}): Perm => ({ id, card: card(id, "Creature — Bear", owner, { power, toughness }), controller: owner, ...extra });
const walker = (id: string, owner: string, loyalty: number): Perm => ({ id, card: card(id, "Legendary Planeswalker — Jace", owner, { loyalty }), controller: owner, counters: { loyalty } });
const drain = (g: Game, book: RuleBook) => {
  for (let i = 0; g.stack.length && i < 60; i++) passPriority(g, g.priority!, book);
  assert.equal(g.stack.length, 0, "スタックが空にならない");
};
const cast = (g: Game, book: RuleBook, name: string, targets: Record<string, string> = {}) => {
  g.hands["A"].push(card(name));
  castSpell(g, "A", name, targets, book);
  drain(g, book);
};

// ---- 検査
for (const n of [call("gainLife", { player: "you", amount: 3 }), call("loseLife", { player: "opponents", amount: 2 }), call("damage", { target: { ref: "t" }, amount: 3 }), call("target", { zone: "any", kind: "any" })]) assert.equal(checkCall(n), null, n.node);
assert.ok(checkCall(call("damage", { target: { ref: "t" }, amount: -1 })), "ダメージは 0 以上");

// ---- 初期ライフ 20
{
  const g = createGame(["A", "B"]);
  assert.deepEqual(g.life, { A: 20, B: 20 });
  assert.equal(g.over, undefined);
}

// ---- life の増減
{
  const g = createGame(["A", "B"]);
  const book = rulesOf({ heal: spell(call("gainLife", { player: "you", amount: 3 })), drainer: spell(call("loseLife", { player: "opponents", amount: 4 })) });
  cast(g, book, "heal");
  cast(g, book, "drainer");
  assert.deepEqual(g.life, { A: 23, B: 16 });
}

// ---- damage: プレイヤー・クリーチャー・プレインズウォーカー (target zone=any)
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(creature("bear", "B", 2, 3), walker("jace", "B", 4));
  const bolt = rulesOf({ bolt: spell(call("target", { zone: "any", kind: "any" }, { as: "t" }), call("damage", { target: { ref: "t" }, amount: 3 })) });
  cast(g, bolt, "bolt", { t: "B" });
  assert.equal(g.life["B"], 17, "プレイヤーへのダメージ");
  cast(g, bolt, "bolt", { t: "jace" });
  assert.equal(g.battlefield.find((p) => p.id === "jace")!.counters!.loyalty, 1, "プレインズウォーカーは、忠誠度が減る");
  assert.equal(g.life["B"], 17);
}
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(creature("bear", "B", 2, 3), creature("mine", "A", 1, 1));
  const book = rulesOf({ bolt: spell(call("target", { zone: "any", kind: "any" }, { as: "t" }), call("damage", { target: { ref: "t" }, amount: 2 })) });
  cast(g, book, "bolt", { t: "bear" });
  const bear = g.battlefield.find((p) => p.id === "bear")!;
  assert.equal(bear.damage, 2, "ダメージが載る");
  assert.ok(g.battlefield.includes(bear), "タフネス未満なら死なない");
  cast(g, book, "bolt", { t: "bear" });
  assert.ok(!g.battlefield.some((p) => p.id === "bear"), "致死ダメージで墓地へ");
  assert.ok(g.graveyards["B"].some((c) => c.id === "bear"));
  assert.equal(g.life["B"], 20, "クリーチャーへのダメージは、ライフに関係しない");
}
{
  // ターン終了時に、ダメージは消える
  const g = createGame(["A", "B"]);
  g.battlefield.push(creature("bear", "B", 2, 3, { damage: 2 }));
  g.step = "end";
  g.priority = "A";
  passPriority(g, "A", rulesOf({}));
  passPriority(g, "B", rulesOf({}));
  assert.equal(g.battlefield.find((p) => p.id === "bear")!.damage ?? 0, 0, "ターン終了で、ダメージが取り除かれる");
}

// ---- ゲームの終わり: ライフ 0 以下
{
  const g = createGame(["A", "B"]);
  g.life["B"] = 3;
  const book = rulesOf({ bolt: spell(call("target", { zone: "player", kind: "player" }, { as: "t" }), call("damage", { target: { ref: "t" }, amount: 3 })) });
  cast(g, book, "bolt", { t: "B" });
  assert.deepEqual(g.over, { winner: "A" });
  assert.throws(() => castSpell(g, "A", "x", {}, book), RuleError, "終わったゲームでは、唱えられない");
  assert.throws(() => passPriority(g, g.priority ?? "A", book), RuleError);
  assert.throws(() => playLand(g, "A", "x", book), RuleError);
}
// 両方が同時に 0 以下 → 引き分け (勝者なし)
{
  const g = createGame(["A", "B"]);
  g.life = { A: 1, B: 1 };
  const book = rulesOf({ both: spell(call("loseLife", { player: "you", amount: 1 }), call("loseLife", { player: "opponents", amount: 1 })) });
  cast(g, book, "both");
  assert.deepEqual(g.over, {}, "引き分け");
}
// ---- ライブラリーが空で引こうとした人は、次の状況起因処理で負ける
{
  const g = createGame(["A", "B"]);
  g.libraries["B"] = [];
  const book = rulesOf({ forceDraw: spell(call("draw", { player: "opponents", count: 1 })) });
  cast(g, book, "forceDraw");
  assert.deepEqual(g.over, { winner: "A" });
}
{
  // 引けたなら負けない (最後の1枚を引いても、まだ負けない)
  const g = createGame(["A", "B"]);
  g.libraries["B"] = [card("l1")];
  const book = rulesOf({ forceDraw: spell(call("draw", { player: "opponents", count: 1 })) });
  cast(g, book, "forceDraw");
  assert.equal(g.over, undefined);
}
// ---- 誘発型能力の any target: 戦場のクリーチャーも選べる (選ぶ先は、プレイヤーだけではない)
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(creature("bear", "B", 2, 2));
  const pinger: Ability[] = [{ kind: "triggered", body: [call("when", { event: "enters", self: true }), call("target", { zone: "any", kind: "any" }, { as: "t" }), call("damage", { target: { ref: "t" }, amount: 2 })] }];
  const book = rulesOf({ pinger: pinger.concat([]), body: spell() });
  g.decide = { target: (_g, _i, _c, legal) => (legal.includes("bear") ? ["bear"] : []) };
  g.hands["A"].push({ ...card("pinger", "Creature — Wizard", "A", { power: 1, toughness: 1 }) });
  castSpell(g, "A", "pinger", {}, book);
  drain(g, book);
  assert.ok(!g.battlefield.some((p) => p.id === "bear"), "誘発の any target で、クリーチャーを選んで倒せる");
}

// ---- 破壊不能は、致死ダメージで死なない (タフネス 0 以下では死ぬ)
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(creature("tough", "B", 2, 2, { mods: [{ power: 0, toughness: 0, keyword: "indestructible", until: "forever" }] }));
  const book = rulesOf({ bolt: spell(call("target", { zone: "any", kind: "any" }, { as: "t" }), call("damage", { target: { ref: "t" }, amount: 5 })) });
  cast(g, book, "bolt", { t: "tough" });
  assert.ok(g.battlefield.some((p) => p.id === "tough"), "破壊不能は、ダメージで死なない");
}
console.log("batch7 ok");
