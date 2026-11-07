import assert from "node:assert";
import { RuleError, applyOpening, castSpell, passPriority, serumPowder } from "../src/battle/engine";
import { enterBattlefield } from "../src/battle/engine/battlefield";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, RuleBook, createGame, discardCards } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// DR-7: 墓地に行くかわりに追放 (exileInstead)・ゲーム開始時に戦場に出す (startOnBattlefield)・マリガンの代わりに手札を入れ替える (mulliganExile)

const card = (id: string, typeLine = "Instant", owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const spell = (...body: NodeCall[]): Ability => ({ kind: "spell", body });
const drain = (g: Game, book: RuleBook) => {
  for (let i = 0; g.stack.length && i < 40; i++) passPriority(g, g.priority!, book);
};
const LEYLINE = (who: string): Ability[] => [{ kind: "static", body: [call("exileInstead", { who })] }, { kind: "static", body: [call("startOnBattlefield", {})] }];
const setup = () => {
  const g = createGame(["A", "B"]);
  g.active = "A";
  g.step = "main1";
  g.priority = "A";
  return g;
};
const ids = (cs: GameCard[]) => cs.map((c) => c.id);

// ---- Leyline of the Void: 相手の墓地に行くカードは、かわりに追放される。自分のは、墓地へ
{
  const book = rulesOf({ Leyline: LEYLINE("opponents"), Mill: [spell(call("mill", { player: "opponents", count: 1 }))], Bolt: [spell(call("gainLife", { player: "you", amount: 1 }))] });
  const g = setup();
  enterBattlefield(g, card("Leyline", "Enchantment"), "A", book);
  g.hands["A"].push(card("A1"), card("A2"));
  g.hands["B"].push(card("Bolt", "Instant", "B"), card("B1", "Instant", "B"), card("B2", "Instant", "B")); // 捨てるのは、後ろから (B2)
  discardCards(g, "A", 1);
  assert.equal(g.graveyards["A"].length, 1, "自分の捨てたカードは、墓地へ");
  discardCards(g, "B", 1);
  assert.deepEqual(ids(g.graveyards["B"]), [], "相手の捨てたカードは、墓地に行かない");
  assert.equal(g.exile["B"].length, 1, "追放される");
  assert.ok(g.effects?.some((e) => e.text.startsWith("置換:")), "置換の発動が、画面に出る");
  g.libraries["B"] = [card("Top", "Creature", "B"), card("Next", "Creature", "B")];
  g.hands["A"].push(card("Mill", "Sorcery"));
  castSpell(g, "A", "Mill", {}, book);
  drain(g, book);
  assert.ok(g.exile["B"].some((c) => c.id === "Top"), "切削されたカードも、追放");
  g.active = "B";
  g.priority = "B";
  castSpell(g, "B", "Bolt", {}, book);
  drain(g, book);
  assert.ok(g.exile["B"].some((c) => c.id === "Bolt") && !g.graveyards["B"].some((c) => c.id === "Bolt"), "相手の呪文は、解決して、追放される");
}
// 死んだクリーチャー: 追放される (「死んだ」の誘発は起きない: leaves to=exile)
{
  const gain: Ability = { kind: "triggered", body: [call("when", { event: "leaves", to: "graveyard", self: true }), call("gainLife", { player: "you", amount: 5 })] };
  const book = rulesOf({ Leyline: LEYLINE("opponents"), Imp: [gain], Kill: [spell(call("target", { zone: "battlefield", kind: "permanent" }, { as: "t" }), call("destroy", { target: { ref: "t" } }))] });
  const g = setup();
  enterBattlefield(g, card("Leyline", "Enchantment"), "A", book);
  enterBattlefield(g, card("Imp", "Creature", "B"), "B", book);
  g.hands["A"].push(card("Kill"));
  castSpell(g, "A", "Kill", { t: "Imp" }, book);
  drain(g, book);
  assert.ok(g.exile["B"].some((c) => c.id === "Imp") && !g.graveyards["B"].some((c) => c.id === "Imp"));
  assert.equal(g.life["B"], 20, "墓地に行っていないので、「死んだとき」の誘発は起きない");
}
// who=all (すべてのプレイヤー)
{
  const book = rulesOf({ Rip: LEYLINE("all") });
  const g = setup();
  enterBattlefield(g, card("Rip", "Enchantment"), "A", book);
  g.hands["A"].push(card("A1"));
  discardCards(g, "A", 1);
  assert.equal(g.graveyards["A"].length, 0);
  assert.equal(g.exile["A"].length, 1);
}
// 戦場に無ければ、働かない
{
  const g = setup();
  g.hands["B"].push(card("B1", "Instant", "B"));
  discardCards(g, "B", 1);
  assert.equal(g.graveyards["B"].length, 1);
}

// ---- ゲーム開始時に戦場に出す (startOnBattlefield): 手札の Leyline が、戦場に出る。ほかのカードは、手札のまま
{
  const book = rulesOf({ Leyline: LEYLINE("opponents") });
  const g = setup();
  g.hands["A"].push(card("Leyline", "Enchantment"), card("Other"));
  g.hands["B"].push(card("Leyline", "Enchantment", "B"));
  applyOpening(g, "A", book);
  assert.ok(g.battlefield.some((p) => p.id === "Leyline" && p.controller === "A"));
  assert.deepEqual(ids(g.hands["A"]), ["Other"]);
  assert.equal(g.hands["B"].length, 1, "B の手札には、触れない");
  discardCards(g, "B", 1);
  assert.equal(g.exile["B"].length, 1, "出たあとは、置換が効く");
}

// ---- Serum Powder: マリガンのとき、手札を全部追放して、同じ枚数を引く (マリガンの回数には数えない)
{
  const book = rulesOf({ Powder: [{ kind: "static", body: [call("mulliganExile", {})] }] });
  const g = setup();
  g.mulligan = { count: 0 };
  g.hands["A"].push(card("Powder", "Artifact"), card("H1"), card("H2"));
  g.libraries["A"] = ["l1", "l2", "l3", "l4"].map((id) => card(id, "Land"));
  serumPowder(g, "A", "Powder", book);
  assert.deepEqual(ids(g.hands["A"]), ["l1", "l2", "l3"], "3 枚追放して、3 枚引く");
  assert.deepEqual(ids(g.exile["A"]).sort(), ["H1", "H2", "Powder"]);
  assert.equal(g.mulligan?.count, 0, "マリガンの回数は増えない");
  assert.throws(() => serumPowder(g, "A", "Powder", book), RuleError, "手札に無い");
  const h = setup();
  h.hands["A"].push(card("Powder", "Artifact"));
  assert.throws(() => serumPowder(h, "A", "Powder", book), RuleError, "マリガンのときだけ");
}
console.log("battle-dr7 ok");
