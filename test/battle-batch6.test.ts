import assert from "node:assert";
import { passPriority } from "../src/battle/engine";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { checkCall, resetRegistry } from "../src/battle/registry";
import { problems, addAbility, addNode, blankRule, removeAbility } from "../src/battle/editor";
import { GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const card = (id: string, typeLine = "Artifact", owner = "A"): GameCard => ({ id, name: id, typeLine, mv: 3, owner });
const call = (node: string, args: NodeCall["args"]): NodeCall => ({ node, args });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const perm = (id: string, owner: string, tapped = true): Perm => ({ id, card: card(id, "Artifact", owner), controller: owner, tapped });

// ---- Bender's Waterskin: 他のプレイヤーのアンタップ・ステップにも、このパーマネントをアンタップする
assert.equal(checkCall(call("untapDuring", { who: "opponents" })), null);
assert.ok(checkCall(call("untapDuring", { who: "nobody" })));
assert.deepEqual(problems(addNode(addAbility(removeAbility(blankRule("X"), 0), "static"), 0, "untapDuring")), [], "affect が要らない常在型能力");

const skin: Ability[] = [{ kind: "static", body: [call("untapDuring", { who: "opponents" })] }];
const toNextTurn = (g: ReturnType<typeof createGame>, book: RuleBook) => {
  g.step = "end";
  g.priority = g.active;
  for (const p of [g.active, g.players.find((x) => x !== g.active)!]) passPriority(g, p, book);
};
{
  const g = createGame(["A", "B"]);
  g.active = "A";
  g.battlefield.push(perm("Waterskin", "A"), perm("Plain", "A"));
  const book = rulesOf({ Waterskin: skin });
  toNextTurn(g, book); // B のターンになる: A の水袋だけアンタップ
  assert.equal(g.active, "B");
  assert.equal(g.battlefield.find((p) => p.id === "Waterskin")!.tapped, false, "他のプレイヤーのアンタップ・ステップにアンタップ");
  assert.equal(g.battlefield.find((p) => p.id === "Plain")!.tapped, true, "ふつうのパーマネントはアンタップしない");
}
{
  const g = createGame(["A", "B"]);
  g.active = "B";
  g.battlefield.push(perm("Waterskin", "A"), perm("Mine", "B"));
  toNextTurn(g, rulesOf({ Waterskin: skin })); // A のターン: 自分のアンタップ・ステップでも (ふつうに) アンタップ
  assert.equal(g.battlefield.find((p) => p.id === "Waterskin")!.tapped, false);
}
{
  // 能力を失っていれば、効かない
  const g = createGame(["A", "B"]);
  g.active = "A";
  g.battlefield.push(perm("Waterskin", "A"), { id: "Wipe", card: card("Wipe", "Enchantment"), controller: "B" });
  const wipe: Ability[] = [{ kind: "static", body: [call("affect", { who: "all" }), call("loseAbilities", {})] }];
  toNextTurn(g, rulesOf({ Waterskin: skin, Wipe: wipe }));
  assert.equal(g.battlefield.find((p) => p.id === "Waterskin")!.tapped, true, "能力を失っている");
}
console.log("batch6 ok");
