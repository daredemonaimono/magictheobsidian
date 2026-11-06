import assert from "node:assert";
import { RuleError, activateFromHand, castSpell, passPriority } from "../src/battle/engine";
import { tryAction } from "../src/battle/actions";
import { advanceStep } from "../src/battle/engine/turn";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, RuleBook, createGame, discardCards } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// DR-6: 手札から起動する能力 (cost discardSelf・サイクリング)・このターンに捨てた・サイクリングしたカードの数 (g.discarded)・自分自身のコスト軽減 (reduceCost self per=discarded)

const card = (id: string, typeLine = "Instant", owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const drain = (g: Game, book: RuleBook) => {
  for (let i = 0; g.stack.length && i < 40; i++) passPriority(g, g.priority!, book);
};
const setup = () => {
  const g = createGame(["A", "B"]);
  g.active = "A";
  g.step = "main1";
  g.priority = "A";
  g.libraries["A"] = ["l1", "l2", "l3"].map((id) => card(id, "Land"));
  return g;
};

const HOLLOW: Ability[] = [
  { kind: "spell", body: [] },
  { kind: "static", body: [call("reduceCost", { amount: 2, self: true, per: "discarded" })] },
  { kind: "activated", body: [call("cost", { mana: 2, discardSelf: true }), call("draw", { player: "you", count: 1 })] },
];
const book = rulesOf({ Hollow: HOLLOW });
const hollow = () => card("Hollow", "Artifact Creature — Golem", "A", { mv: 4, manaCost: "{4}" });

// ---- サイクリング: {2} と、このカードを手札から捨てる (コスト)。スタックに積まれ、解決すると 1 枚引く
{
  const g = setup();
  g.hands["A"].push(hollow());
  g.mana["A"] = 2;
  assert.equal(tryAction(g, book, "A", { kind: "handAbility", card: "Hollow", index: 0 }), undefined, "マナがあれば、できる");
  activateFromHand(g, "A", "Hollow", 0, {}, book);
  assert.ok(g.graveyards["A"].some((c) => c.id === "Hollow") && !g.hands["A"].some((c) => c.id === "Hollow"), "コストで、手札から墓地へ");
  assert.equal(g.mana["A"], 0, "{2} を払った");
  assert.equal(g.stack.length, 1);
  drain(g, book);
  assert.deepEqual(g.hands["A"].map((c) => c.id), ["l1"], "解決して、1 枚引いた");
  assert.equal(g.discarded?.["A"], 1, "サイクリングは、捨てたものに数える");
}
{
  const g = setup();
  g.hands["A"].push(hollow());
  g.mana["A"] = 1;
  assert.throws(() => activateFromHand(g, "A", "Hollow", 0, {}, book), RuleError, "マナが足りない");
  assert.ok(g.hands["A"].some((c) => c.id === "Hollow"), "失敗したら、状態は変わらない");
  assert.throws(() => activateFromHand(g, "A", "Nothing", 0, {}, book), RuleError, "手札に無い");
}

// ---- このターンに捨てたカードの数: 捨てる (discard) も数える。ターンが替わると 0。墓地に置かれても、呪文を唱えたものは数えない
{
  const g = setup();
  g.hands["A"].push(card("X1"), card("X2"));
  discardCards(g, "A", 2);
  assert.equal(g.discarded?.["A"], 2);
  g.step = "end";
  advanceStep(g, book);
  assert.equal(g.discarded?.["A"] ?? 0, 0, "ターンが替わると 0");
}
{
  const g = setup();
  const free = rulesOf({ Bolt: [{ kind: "spell", body: [call("gainLife", { player: "you", amount: 1 })] }] });
  g.hands["A"].push(card("Bolt"));
  castSpell(g, "A", "Bolt", {}, free);
  drain(g, free);
  assert.equal(g.discarded?.["A"] ?? 0, 0, "唱えて墓地に行った呪文は、捨てたものではない");
}

// ---- Hollow One: このターンに捨てた・サイクリングしたカード 1 枚につき {2} 安い (マナ総量 4 → 捨てた 1 枚で {2}・2 枚で {0})
for (const [discarded, mana, ok] of [[0, 3, false], [1, 1, false], [1, 2, true], [2, 0, true]] as const) {
  const g = setup();
  g.payManaCosts = true;
  g.hands["A"].push(hollow());
  g.discarded = { A: discarded };
  g.mana["A"] = mana;
  const t = tryAction(g, book, "A", { kind: "cast", card: "Hollow" });
  assert.equal(t === undefined, ok, `捨てた ${discarded} 枚・マナ ${mana}`);
}
{
  // 戦場に出た Hollow One の self の軽減は、他の呪文には効かない
  const g = setup();
  g.payManaCosts = true;
  g.battlefield.push({ id: "Hollow", card: hollow(), controller: "A", enteredTurn: 0 });
  g.discarded = { A: 2 };
  const other = rulesOf({ Hollow: HOLLOW, Big: [{ kind: "spell", body: [] }] });
  g.hands["A"].push(card("Big", "Sorcery", "A", { mv: 3, manaCost: "{3}" }));
  g.mana["A"] = 0;
  assert.notEqual(tryAction(g, other, "A", { kind: "cast", card: "Big" }), undefined, "他の呪文は、安くならない");
}
console.log("battle-dr6 ok");
