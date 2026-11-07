import assert from "node:assert";
import { cardValue, heuristicDecider } from "../src/battle/aiDefaults";
import { makeDecider } from "../src/battle/input";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, StackItem, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// AI・CPU の、エンジン途中の判断 (捨てる・選ぶ・対象・順番・伝説のルール) の既定: ノードの役割から、機械的にそれらしく選ぶ (API は呼ばない)
const call = (node: string, args: NodeCall["args"] = {}, extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const m: Record<string, Ability[]> = {
  Bolt: [{ kind: "spell", body: [call("target", { zone: "any", kind: "any" }, { as: "t" }), call("damage", { target: { ref: "t" }, amount: 3 })] }],
  Sign: [{ kind: "spell", body: [call("draw", { player: "you", count: 2 })] }],
  Imp: [{ kind: "static", body: [call("dredge", { amount: 5 })] }],
  Bazaar: [{ kind: "activated", body: [call("cost", { tap: true }), call("draw", { player: "you", count: 2 }), call("discard", { player: "you", count: 3 })] }],
};
const rules: RuleBook = { get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) };
const card = (id: string, name: string, typeLine: string, owner: string, extra: Partial<GameCard> = {}): GameCard => ({ id, name, typeLine, mv: 1, owner, ...extra });
const perm = (id: string, controller: string, power: number, toughness: number, extra: Partial<Perm> = {}): Perm => ({ id, card: card(id, id, "Creature — Bear", controller, { power, toughness, mv: power }), controller, enteredTurn: 0, ...extra });
const land = (id: string, controller: string): Perm => ({ id, card: card(id, "Island", "Basic Land — Island", controller, { mv: 0 }), controller, enteredTurn: 0 });
const h = (g: Game, me = "you") => heuristicDecider(me, rules);
const base = () => {
  const g = createGame(["you", "ai"]);
  for (let i = 0; i < 5; i++) g.battlefield.push(land(`L${i}`, "ai")); // 土地は十分
  return g;
};
const ids = (cs: GameCard[] | undefined) => (cs ?? []).map((c) => c.id).sort();

// ---- 捨てる: 墓地で働くカード (Dredge)・土地が十分なときの土地から。除去・ドロー・大きいクリーチャーは、残す
{
  const g = base();
  g.hands["ai"] = [card("Island1", "Island", "Basic Land — Island", "ai", { mv: 0 }), card("Bolt1", "Bolt", "Instant", "ai"), card("Imp1", "Imp", "Creature — Imp", "ai", { mv: 3 }), card("Sign1", "Sign", "Sorcery", "ai", { mv: 3 })];
  assert.deepEqual(ids(h(g).discard!(g, "ai", 2)), ["Imp1", "Island1"], "Dredge 持ちと、余った土地を捨てる");
  assert.ok(cardValue(g, "ai", g.hands["ai"][1], rules) > cardValue(g, "ai", g.hands["ai"][2], rules), "除去 > Dredge 持ち");
  // 土地が足りないときは、土地を残す
  const few = createGame(["you", "ai"]);
  few.hands["ai"] = [card("Island1", "Island", "Basic Land — Island", "ai", { mv: 0 }), card("Imp1", "Imp", "Creature — Imp", "ai", { mv: 3 }), card("Bear1", "Bear", "Creature — Bear", "ai", { mv: 2 })];
  assert.ok(!ids(h(few).discard!(few, "ai", 1)).includes("Island1"), "土地が少ないときは、土地を残す");
  assert.equal(h(g, "ai").discard!(g, "ai", 1), undefined, "自分 (人) の判断には、口を出さない");
}
// ---- 対象: 除去・ダメージは、相手の強いものを。強化は、自分の強いものを。ドロー・ライフは自分、捨てさせる・ライフを失わせるは相手
{
  const g = base();
  g.battlefield.push(perm("mineBig", "ai", 4, 4), perm("mineSmall", "ai", 1, 1), perm("foeBig", "you", 5, 5), perm("foeSmall", "you", 1, 1));
  const item = (body: NodeCall[]): StackItem => ({ id: "s", card: card("Src", "Src", "Creature", "ai"), controller: "ai", targets: {}, cast: {}, body, ability: true });
  const pick = (body: NodeCall[], legal: string[]) => h(g).target!(g, item(body), body[0], legal)?.[0];
  const t = call("target", { zone: "battlefield", kind: "permanent" }, { as: "t" });
  const all = ["mineBig", "mineSmall", "foeBig", "foeSmall"];
  assert.equal(pick([t, call("destroy", { target: { ref: "t" } })], all), "foeBig", "破壊: 相手の強いもの");
  assert.equal(pick([t, call("addCounter", { target: { ref: "t" }, kind: "+1/+1", count: 1 })], all), "mineBig", "カウンター: 自分の強いもの");
  assert.equal(pick([t, call("modify", { target: { ref: "t" }, power: -3, toughness: -3, duration: "endOfTurn" })], all), "foeBig", "−X/−X: 相手の強いもの");
  assert.equal(pick([t, call("modify", { target: { ref: "t" }, power: 2, toughness: 2, duration: "endOfTurn" })], all), "mineBig", "+X/+X: 自分の強いもの");
  const pl = call("target", { zone: "player", kind: "player" }, { as: "p" });
  assert.equal(pick([pl, call("draw", { player: "target", target: { ref: "p" }, count: 2 })], ["you", "ai"]), "ai", "引く: 自分");
  assert.equal(pick([pl, call("discard", { player: "target", target: { ref: "p" }, count: 1 })], ["you", "ai"]), "you", "捨てさせる: 相手");
  assert.equal(pick([pl, call("loseLife", { player: "target", target: { ref: "p" }, amount: 2 })], ["you", "ai"]), "you");
  assert.equal(pick([t], all), undefined, "使い道が分からなければ、既定のまま");
  // 墓地のカード (Golgari Thug: ライブラリーの上に置く): 自分の墓地の、いちばん価値の高いクリーチャー
  g.graveyards["ai"] = [card("gBear", "Bear", "Creature — Bear", "ai", { mv: 2, power: 2 }), card("gTroll", "Troll", "Creature — Troll", "ai", { mv: 6, power: 6 })];
  const gy = call("target", { zone: "graveyard", kind: "card", type: "creature" }, { as: "g" });
  assert.equal(pick([gy, call("move", { cards: { ref: "g" }, to: "top" })], ["gBear", "gTroll"]), "gTroll");
  // スタックの呪文 (打ち消し): 相手の、いちばん上
  g.stack.push({ id: "mine", card: card("M", "M", "Instant", "ai"), controller: "ai", targets: {}, cast: {} }, { id: "foe1", card: card("F1", "F1", "Instant", "you"), controller: "you", targets: {}, cast: {} }, { id: "foe2", card: card("F2", "F2", "Instant", "you"), controller: "you", targets: {}, cast: {} });
  const sp = call("target", { zone: "stack", kind: "spell" }, { as: "s" });
  assert.equal(pick([sp, call("counter", { target: { ref: "s" } })], ["mine", "foe1", "foe2"]), "foe2", "打ち消し: 相手の、いちばん上の呪文");
}
// ---- 選ぶ: 探す (search) は、いちばん価値の高いもの (土地が足りなければ土地)。相手の手札から選ぶ (Grief) は、相手のいちばん良いカード
{
  const g = base();
  const opts = [card("Island1", "Island", "Basic Land — Island", "ai", { mv: 0 }), card("Bolt1", "Bolt", "Instant", "ai")];
  assert.deepEqual(ids(h(g).choose!(g, "ai", opts, 1, true, "search")), ["Bolt1"], "土地が十分なら、呪文を探す");
  const few = createGame(["you", "ai"]);
  assert.deepEqual(ids(h(few).choose!(few, "ai", opts, 1, true, "search")), ["Island1"], "土地が足りなければ、土地を探す");
  const foeHand = [card("fLand", "Island", "Land", "you", { mv: 0 }), card("fBolt", "Bolt", "Instant", "you"), card("fImp", "Imp", "Creature", "you", { mv: 3 })];
  assert.deepEqual(ids(h(g).choose!(g, "ai", foeHand, 1, false, "choose")), ["fBolt"], "相手の手札から: いちばん良いカード");
  assert.equal(h(g).choose!(g, "ai", opts, 1, false, "choose"), undefined, "自分のカードから選ぶ (使い道が分からない) ときは、既定のまま");
}
// ---- 順番 (ライブラリーの上): 良いカードを、上に
{
  const g = base();
  const cs = [card("Island1", "Island", "Basic Land — Island", "ai", { mv: 0 }), card("Bolt1", "Bolt", "Instant", "ai"), card("Imp1", "Imp", "Creature", "ai", { mv: 3 })];
  const out = h(g).order!(g, "ai", cs, "top")!.map((c) => c.id);
  assert.equal(out[0], "Bolt1");
  assert.equal(h(g).order!(g, "ai", cs, "bottom"), undefined);
}
// ---- 伝説のルール: カウンター・修整の多いほうを残す。同じなら、先に出ていたもの
{
  const g = base();
  const a = perm("old", "ai", 2, 2);
  const b = perm("new", "ai", 2, 2, { counters: { "+1/+1": 2 } });
  assert.equal(h(g).legend!(g, "ai", [a, b])?.id, "new");
  assert.equal(h(g).legend!(g, "ai", [a, perm("same", "ai", 2, 2)])?.id, "old");
}
// ---- 人 (me) には、いままでどおり質問。AI・CPU には、機械的な既定 (質問は出ない)
{
  const g = base();
  g.hands["ai"] = [card("Island1", "Island", "Basic Land — Island", "ai", { mv: 0 }), card("Imp1", "Imp", "Creature", "ai", { mv: 3 }), card("Bolt1", "Bolt", "Instant", "ai")];
  const d = makeDecider("you", [], "ai", rules);
  assert.deepEqual(ids(d.discard!(g, "ai", 1)), ["Imp1"].length ? ids(d.discard!(g, "ai", 1)) : [], "AI の捨てる判断は、質問なしで返る");
  assert.equal(d.discard!(g, "ai", 1)?.length, 1);
  g.hands["you"] = [card("a", "A", "Land", "you"), card("b", "B", "Land", "you")];
  assert.throws(() => d.discard!(g, "you", 1), /入力待ち/, "人には、質問");
}
console.log("battle-aidefaults ok");
