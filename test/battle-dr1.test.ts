import assert from "node:assert";
import { castSpell, passPriority } from "../src/battle/engine";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, RuleBook, createGame, discardCards } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// DR-1: ゾーン移動のイベント (moved)・墓地にあるカード自身の誘発 (zone=graveyard)・mill・move で戦場へ・墓地のカードを対象・追放

const card = (id: string, typeLine: string, owner = "A"): GameCard => ({ id, name: id, typeLine, mv: 1, owner });
const call = (node: string, args: NodeCall["args"], as?: string, ifc?: string): NodeCall => ({ node, args, ...(as ? { as } : {}), ...(ifc ? { if: ifc } : {}) });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const trig = (when: NodeCall["args"], ...body: NodeCall[]): Ability => ({ kind: "triggered", body: [call("when", when), ...body] });
const spell = (...body: NodeCall[]): Ability => ({ kind: "spell", body });
const drain = (g: Game, book: RuleBook) => {
  for (let i = 0; g.stack.length && i < 30; i++) passPriority(g, g.priority!, book);
};
const setup = () => {
  const g = createGame(["A", "B"]);
  g.step = "main1";
  g.priority = "A";
  return g;
};
const lib = (g: Game, p: string, ...ids: string[]) => (g.libraries[p] = ids.map((id) => card(id, "Creature", p)));
const names = (cs: GameCard[]) => cs.map((c) => c.id);

// Narcomoeba: ライブラリーから墓地に置かれたら、戦場に出る (墓地から自分の誘発)。mill で上から N 枚
const NARCO: Ability[] = [trig({ event: "moved", from: "library", to: "graveyard", zone: "graveyard", self: true }, call("self", {}, "s"), call("move", { cards: { ref: "s" }, to: "battlefield" }))];
const MILL2: Ability[] = [spell(call("mill", { player: "you", count: 2 }))];
{
  const book = rulesOf({ Narcomoeba: NARCO, Mill: MILL2 });
  const g = setup();
  lib(g, "A", "x1", "Narcomoeba", "x3");
  g.hands["A"].push(card("Mill", "Sorcery"));
  castSpell(g, "A", "Mill", {}, book);
  drain(g, book);
  assert.deepEqual(names(g.graveyards["A"]), ["x1", "Mill"], "x1 は墓地、呪文も墓地");
  assert.ok(g.battlefield.some((p) => p.id === "Narcomoeba"), "Narcomoeba は、墓地に置かれて、戦場に出た");
  assert.ok(!g.graveyards["A"].some((c) => c.id === "Narcomoeba"), "墓地に残らない");
  assert.deepEqual(names(g.libraries["A"]), ["x3"], "上から 2 枚だけ");
}
// 手札から捨てられたときは、誘発しない (from=library だけ)
{
  const book = rulesOf({ Narcomoeba: NARCO });
  const g = setup();
  g.hands["A"].push(card("Narcomoeba", "Creature"));
  discardCards(g, "A", 1);
  drain(g, book);
  assert.deepEqual(names(g.graveyards["A"]), ["Narcomoeba"]);
  assert.equal(g.battlefield.length, 0);
}
// 相手のカードが相手のライブラリーから墓地に置かれても、自分の Narcomoeba は動かない (self)
{
  const book = rulesOf({ Narcomoeba: NARCO, Mill: [spell(call("mill", { player: "opponents", count: 1 }))] });
  const g = setup();
  lib(g, "B", "Narcomoeba");
  g.hands["A"].push(card("Mill", "Sorcery"));
  castSpell(g, "A", "Mill", {}, book);
  drain(g, book);
  assert.ok(g.battlefield.some((p) => p.id === "Narcomoeba" && p.controller === "B"), "持ち主のコントロールで出る");
}

// 墓地から出られない (Grafdigger's Cage: cantEnter from=graveyard|library) は、move to=battlefield にも効く
{
  const book = rulesOf({ Narcomoeba: NARCO, Mill: MILL2, Cage: [{ kind: "static", body: [call("cantEnter", { from: "graveyard|library", type: "creature" })] }] });
  const g = setup();
  g.battlefield.push({ id: "Cage", card: card("Cage", "Artifact"), controller: "B", enteredTurn: 0 });
  lib(g, "A", "Narcomoeba", "x2");
  g.hands["A"].push(card("Mill", "Sorcery"));
  castSpell(g, "A", "Mill", {}, book);
  drain(g, book);
  assert.ok(!g.battlefield.some((p) => p.id === "Narcomoeba"), "Cage があれば、出られない");
  assert.ok(g.graveyards["A"].some((c) => c.id === "Narcomoeba"));
}

// Creeping Chill: ライブラリーから墓地に置かれたら、追放して (してもよい)、そうしたなら、3 点ダメージと 3 点ライフ
{
  const CHILL: Ability[] = [
    trig({ event: "moved", from: "library", to: "graveyard", zone: "graveyard", self: true }, call("self", {}, "s"), call("exile", { target: { ref: "s" } }, "n"), call("damage", { player: "opponents", amount: 3 }, undefined, "$n"), call("gainLife", { player: "you", amount: 3 }, undefined, "$n")),
  ];
  const book = rulesOf({ "Creeping Chill": CHILL, Mill: [spell(call("mill", { player: "you", count: 1 }))] });
  const g = setup();
  lib(g, "A", "Creeping Chill");
  g.hands["A"].push(card("Mill", "Sorcery"));
  castSpell(g, "A", "Mill", {}, book);
  drain(g, book);
  assert.ok(g.exile["A"].some((c) => c.id === "Creeping Chill"), "墓地から追放された");
  assert.ok(!g.graveyards["A"].some((c) => c.id === "Creeping Chill"));
  assert.equal(g.life["B"], 17);
  assert.equal(g.life["A"], 23);
}

// Golgari Thug: 死んだら、墓地のクリーチャー・カード 1 枚を対象に、ライブラリーの一番上に置く (leaves to=graveyard self=true)
{
  const THUG: Ability[] = [trig({ event: "leaves", to: "graveyard", self: true }, call("target", { zone: "graveyard", kind: "card", type: "creature", controller: "you" }, "t"), call("move", { cards: { ref: "t" }, to: "top" }))];
  const book = rulesOf({ Thug: THUG, Slay: [spell(call("target", { zone: "battlefield", kind: "permanent" }, "p"), call("destroy", { target: { ref: "p" } }))] });
  const g = setup();
  g.graveyards["A"].push(card("Bear", "Creature — Bear"), card("Bolt", "Instant"));
  g.battlefield.push({ id: "Thug", card: card("Thug", "Creature — Human"), controller: "A", enteredTurn: 0 });
  g.hands["A"].push(card("Slay", "Instant"));
  castSpell(g, "A", "Slay", { p: "Thug" }, book);
  drain(g, book);
  assert.equal(g.libraries["A"][0]?.id, "Bear", "墓地のクリーチャー・カードが、一番上へ (Bolt は対象にならない)");
  assert.ok(g.graveyards["A"].some((c) => c.id === "Thug") && !g.graveyards["A"].some((c) => c.id === "Bear"));
}
// 追放 (leaves to=exile) は、「死んだ」ではない
{
  const THUG: Ability[] = [trig({ event: "leaves", to: "graveyard", self: true }, call("gainLife", { player: "you", amount: 1 }))];
  const book = rulesOf({ Thug: THUG, Exile: [spell(call("target", { zone: "battlefield", kind: "permanent" }, "p"), call("exile", { target: { ref: "p" } }))] });
  const g = setup();
  g.battlefield.push({ id: "Thug", card: card("Thug", "Creature — Human"), controller: "A", enteredTurn: 0 });
  g.hands["A"].push(card("Exile", "Instant"));
  castSpell(g, "A", "Exile", { p: "Thug" }, book);
  drain(g, book);
  assert.equal(g.life["A"], 20, "追放では、誘発しない");
}

// 墓地から戦場へ (enters from=graveyard) と、tapped=true
{
  const ENTER: Ability[] = [trig({ event: "enters", from: "graveyard", who: "you" }, call("gainLife", { player: "you", amount: 1 }))];
  const book = rulesOf({ Watcher: ENTER, Raise: [spell(call("target", { zone: "graveyard", kind: "card", type: "creature" }, "t"), call("move", { cards: { ref: "t" }, to: "battlefield", tapped: true }))] });
  const g = setup();
  g.battlefield.push({ id: "Watcher", card: card("Watcher", "Creature"), controller: "A", enteredTurn: 0 });
  g.graveyards["A"].push(card("Bear", "Creature — Bear"));
  g.hands["A"].push(card("Raise", "Sorcery"));
  castSpell(g, "A", "Raise", { t: "Bear" }, book);
  drain(g, book);
  const bear = g.battlefield.find((p) => p.id === "Bear");
  assert.ok(bear?.tapped, "タップ状態で出る");
  assert.equal(g.life["A"], 21, "墓地から出たので、誘発");
}
console.log("battle-dr1 ok");
