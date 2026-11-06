import assert from "node:assert";
import { RuleError, activateAbility, castSpell, passPriority } from "../src/battle/engine";
import { characteristics } from "../src/battle/continuous";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";
import { advanceStep } from "../src/battle/engine/turn";

resetRegistry();
registerBuiltinNodes();

// DR-5: 出るときにカウンターが置かれる (entersWith)・カウンターの数・スタックの呪文のマナ総量・カウンターを取り除くコスト・再生 (regenerate)

const card = (id: string, typeLine = "Instant", owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const spell = (...body: NodeCall[]): Ability => ({ kind: "spell", body });
const drain = (g: Game, book: RuleBook) => {
  for (let i = 0; g.stack.length && i < 40; i++) passPriority(g, g.priority!, book);
};
const setup = () => {
  const g = createGame(["A", "B"]);
  g.active = "A";
  g.step = "main1";
  g.priority = "A";
  return g;
};
const get = (g: Game, id: string) => g.battlefield.find((p) => p.id === id);

// ---- Chalice of the Void: X 個の charge カウンターつきで出る。マナ総量がそのカウンターの数に等しい呪文が唱えられたら、打ち消す
const CHALICE: Ability[] = [
  { kind: "static", body: [call("entersWith", { kind: "charge", x: true })] },
  { kind: "triggered", body: [call("when", { event: "cast" }), call("self", {}, { as: "s" }), call("counterCount", { target: { ref: "s" }, kind: "charge" }, { as: "n" }), call("eventPerm", {}, { as: "sp" }), call("statOf", { target: { ref: "sp" }, stat: "mv" }, { as: "mv" }), call("compare", { a: { ref: "mv" }, b: { ref: "n" }, op: "eq" }, { as: "ok" }), call("counter", { target: { ref: "sp" } }, { if: "$ok" })] },
];
const FREE: Ability[] = [spell(call("gainLife", { player: "you", amount: 1 }))];
{
  const book = rulesOf({ Chalice: CHALICE, One: FREE, Two: FREE });
  const g = setup();
  g.hands["A"].push(card("Chalice", "Artifact", "A", { manaCost: "{X}{X}", mv: 0 }));
  castSpell(g, "A", "Chalice", {}, book, { x: 1 });
  drain(g, book);
  assert.equal(get(g, "Chalice")?.counters?.charge, 1, "X=1 で、charge カウンター 1 個");
  g.active = "B";
  g.priority = "B";
  g.hands["B"].push(card("One", "Instant", "B", { mv: 1 }), card("Two", "Instant", "B", { mv: 2 }));
  castSpell(g, "B", "One", {}, book);
  drain(g, book);
  assert.equal(g.life["B"], 20, "マナ総量 1 の呪文は、打ち消される");
  assert.ok(g.graveyards["B"].some((c) => c.id === "One"), "打ち消された呪文は、墓地へ");
  g.priority = "B";
  castSpell(g, "B", "Two", {}, book);
  drain(g, book);
  assert.equal(g.life["B"], 21, "マナ総量 2 は、通る");
}

// ---- Golgari Grave-Troll: 自分の墓地のクリーチャー・カード 1 枚につき +1/+1 カウンターつきで出る。{1}・カウンターを 1 個取り除く: 再生
const TROLL: Ability[] = [
  { kind: "static", body: [call("entersWith", { kind: "+1/+1", zone: "graveyard", type: "creature" })] },
  { kind: "activated", body: [call("cost", { mana: 1, removeCounter: "+1/+1" }), call("self", {}, { as: "s" }), call("regenerate", { target: { ref: "s" } })] },
];
const KILL: Ability[] = [spell(call("target", { zone: "battlefield", kind: "permanent" }, { as: "t" }), call("destroy", { target: { ref: "t" } }))];
const trollGame = (counters: number) => {
  const book = rulesOf({ Troll: TROLL, Kill: KILL, Zap: [spell(call("target", { zone: "battlefield", kind: "permanent" }, { as: "t" }), call("damage", { target: { ref: "t" }, amount: 9 }))] });
  const g = setup();
  g.graveyards["A"].push(card("D1", "Creature — Bear"), card("D2", "Creature — Bear"), card("Bolt", "Instant"));
  g.hands["A"].push(card("Troll", "Creature — Troll Skeleton", "A", { power: 1, toughness: 1 }), card("Kill", "Instant"), card("Zap", "Instant"));
  castSpell(g, "A", "Troll", {}, book);
  drain(g, book);
  g.mana["A"] = 5; // {1} を払うためのマナ
  const t = get(g, "Troll")!;
  t.counters = { "+1/+1": counters };
  return { g, book, t };
};
{
  const book = rulesOf({ Troll: TROLL });
  const g = setup();
  g.graveyards["A"].push(card("D1", "Creature — Bear"), card("D2", "Creature — Bear"), card("Bolt", "Instant"));
  g.hands["A"].push(card("Troll", "Creature — Troll Skeleton", "A", { power: 1, toughness: 1 }));
  castSpell(g, "A", "Troll", {}, book);
  drain(g, book);
  const t = get(g, "Troll")!;
  assert.equal(t.counters?.["+1/+1"], 2, "墓地のクリーチャー・カード 2 枚 → +1/+1 カウンター 2 個 (Bolt は数えない)");
  const now = characteristics(g, t, book);
  assert.deepEqual([now.power, now.toughness], [3, 3], "1/1 + カウンター 2 個 = 3/3");
}
{
  // 再生: 破壊されるかわりに、タップして残る。カウンターは 1 個減る
  const { g, book } = trollGame(2);
  activateAbility(g, "A", "Troll", 0, {}, book);
  drain(g, book);
  assert.equal(get(g, "Troll")!.counters?.["+1/+1"], 1, "コスト: カウンターを 1 個取り除く");
  g.priority = "A";
  castSpell(g, "A", "Kill", { t: "Troll" }, book);
  drain(g, book);
  const t = get(g, "Troll");
  assert.ok(t, "再生の盾で、破壊されない");
  assert.equal(t!.tapped, true, "再生すると、タップする");
  g.priority = "A";
  g.hands["A"].push(card("Kill2", "Instant"));
  const book2 = rulesOf({ Troll: TROLL, Kill: KILL, Kill2: KILL });
  castSpell(g, "A", "Kill2", { t: "Troll" }, book2);
  drain(g, book2);
  assert.ok(!get(g, "Troll"), "盾は 1 回だけ。2 回目は、破壊される");
}
{
  // 致死ダメージ (状況起因処理) も、再生で防ぐ。ダメージは取り除かれる
  const { g, book } = trollGame(2);
  activateAbility(g, "A", "Troll", 0, {}, book);
  drain(g, book);
  g.priority = "A";
  castSpell(g, "A", "Zap", { t: "Troll" }, book);
  drain(g, book);
  const t = get(g, "Troll");
  assert.ok(t && t.tapped && !t.damage, "致死ダメージでは死なず、ダメージが取り除かれる");
}
{
  // 盾は、ターン終了時に消える。カウンターが無ければ起動できない
  const { g, book } = trollGame(2);
  activateAbility(g, "A", "Troll", 0, {}, book);
  drain(g, book);
  g.step = "end";
  advanceStep(g, book);
  assert.equal(get(g, "Troll")!.regen ?? 0, 0, "ターン終了時に、盾は消える");
  const none = trollGame(0);
  assert.throws(() => activateAbility(none.g, "A", "Troll", 0, {}, none.book), RuleError, "取り除くカウンターが無い");
}
console.log("battle-dr5 ok");
