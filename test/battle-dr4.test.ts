import assert from "node:assert";
import { RuleError, castSpell, passPriority } from "../src/battle/engine";
import { characteristics } from "../src/battle/continuous";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// DR-4: 別のコストの拡張 (Evoke・追放するカードのマナ総量が X・相手が N 個以上呪文を唱えていたら)・数の計算 (math)・スタックの呪文の追放

const card = (id: string, typeLine = "Instant", owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const trig = (when: NodeCall["args"], ...body: NodeCall[]): Ability => ({ kind: "triggered", body: [call("when", when), ...body] });
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
const has = (g: Game, id: string) => g.battlefield.some((p) => p.id === id);
const black = (id: string, mv: number, owner = "A") => card(id, "Creature — Zombie", owner, { colors: ["B"], mv });

// ---- Grief: Evoke (手札から黒いカードを追放して唱え、出たら生け贄) と、ふつうの唱え方 (残る)
const GRIEF: Ability[] = [
  spell(call("altCost", { exile: 1, exileColor: "B" })),
  trig({ event: "enters", self: true }, call("lookHand", { player: "opponents" }, { as: "h" }), call("choose", { from: { ref: "h" }, count: 1 }, { as: "c" }), call("discard", { player: "opponents", cards: { ref: "c" } })),
  trig({ event: "enters", self: true }, call("self", {}, { as: "s" }), call("sacrifice", { target: { ref: "s" } }, { if: "alt" })),
];
for (const evoke of [true, false]) {
  const book = rulesOf({ Grief: GRIEF });
  const g = setup();
  g.hands["A"].push(card("Grief", "Creature — Elemental Incarnation", "A", { colors: ["B"] }), black("Fodder", 2));
  g.hands["B"].push(card("Bolt", "Instant", "B"));
  castSpell(g, "A", "Grief", {}, book, evoke ? { alt: true, exile: ["Fodder"] } : {});
  drain(g, book);
  assert.deepEqual(g.graveyards["B"].map((c) => c.id), ["Bolt"], "どちらでも、相手の手札から 1 枚捨てさせる");
  assert.equal(has(g, "Grief"), !evoke, evoke ? "Evoke なら、出て、生け贄に捧げられる" : "ふつうに唱えれば、残る");
  assert.equal(g.exile["A"].some((c) => c.id === "Fodder"), evoke, "Evoke では、手札の黒いカードが追放される");
}

// ---- Sickening Shoal: 手札の黒いカード (マナ総量 X) を追放して唱え、X は、そのカードのマナ総量。対象のクリーチャーは -X/-X
const SHOAL: Ability[] = [
  spell(call("altCost", { exile: 1, exileColor: "B", exileX: true }), call("target", { zone: "battlefield", kind: "permanent", type: "creature" }, { as: "t" }), call("math", { a: { ref: "X" }, op: "mul", b: -1 }, { as: "m" }), call("modify", { target: { ref: "t" }, power: { ref: "m" }, toughness: { ref: "m" }, duration: "endOfTurn" })),
];
{
  const book = rulesOf({ Shoal: SHOAL });
  const g = setup();
  const bear: Perm = { id: "Bear", card: card("Bear", "Creature — Bear", "B", { power: 5, toughness: 5 }), controller: "B", enteredTurn: 0 };
  g.battlefield.push(bear);
  g.hands["A"].push(card("Shoal", "Instant — Arcane"), black("Fodder3", 3), card("Elf", "Creature — Elf", "A", { colors: ["G"], mv: 3 }));
  assert.throws(() => castSpell(g, "A", "Shoal", { t: "Bear" }, book, { alt: true, exile: ["Elf"] }), RuleError, "黒でないカードは、追放できない");
  castSpell(g, "A", "Shoal", { t: "Bear" }, book, { alt: true, exile: ["Fodder3"] });
  drain(g, book);
  const now = characteristics(g, bear, book);
  assert.deepEqual([now.power, now.toughness], [2, 2], "X = 3 (追放したカードのマナ総量): -3/-3");
  assert.ok(g.exile["A"].some((c) => c.id === "Fodder3"));
}

// ---- Mindbreak Trap: 相手がこのターンに 3 個以上呪文を唱えていたら、{0} で唱えられる。好きな数の呪文を追放する
const TRAP: Ability[] = [spell(call("altCost", { mana: 0, oppSpells: 3 }), call("target", { zone: "stack", kind: "spell", min: 0, max: 9 }, { as: "t" }), call("exile", { target: { ref: "t" } }))];
const FREE: Ability[] = [spell(call("gainLife", { player: "you", amount: 1 }))];
const stackOfB = (g: Game, book: RuleBook, n: number) => {
  g.active = "B";
  g.priority = "B";
  for (let i = 1; i <= n; i++) {
    g.hands["B"].push(card(`S${i}`, "Instant", "B"));
    castSpell(g, "B", `S${i}`, {}, book);
  }
  g.priority = "A";
};
{
  const book = rulesOf({ Trap: TRAP, S1: FREE, S2: FREE, S3: FREE });
  const g = setup();
  g.hands["A"].push(card("Trap", "Instant — Trap"));
  stackOfB(g, book, 2);
  assert.throws(() => castSpell(g, "A", "Trap", { t: "S1" }, book, { alt: true }), RuleError, "相手が 2 個では、使えない");
  g.hands["B"].push(card("S3", "Instant", "B"));
  g.priority = "B";
  castSpell(g, "B", "S3", {}, book);
  g.priority = "A";
  castSpell(g, "A", "Trap", { t: "S1,S3" }, book, { alt: true });
  drain(g, book);
  assert.deepEqual(g.exile["B"].map((c) => c.id).sort(), ["S1", "S3"], "対象にした 2 つが追放される");
  assert.ok(g.graveyards["B"].some((c) => c.id === "S2"), "対象にしなかった S2 は、解決して墓地へ");
  assert.equal(g.life["B"], 21, "S2 だけが解決した (B が 1 点得る)");
}
console.log("battle-dr4 ok");
