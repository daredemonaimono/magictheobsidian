import assert from "node:assert";
import { enterBattlefield } from "../src/battle/engine/battlefield";
import { flushEvents } from "../src/battle/engine/triggers";
import { NeedInput, makeDecider } from "../src/battle/input";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// 同じプレイヤーの、同時の誘発: 自分 (人) は順番を選べる。同じものばかりなら聞かない。AI・CPU は、見つけた順
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const etb = (life: number): Ability => ({ kind: "triggered", body: [call("when", { event: "enters", self: true }), call("gainLife", { player: "you", amount: life })] });
const book: RuleBook = { get: (c) => ({ X: [etb(1)], Y: [etb(2)], Z: [etb(1)] } as Record<string, Ability[]>)[c] && { card: c, abilities: ({ X: [etb(1)], Y: [etb(2)], Z: [etb(1)] } as Record<string, Ability[]>)[c] } };
const card = (id: string, name: string, owner = "A"): GameCard => ({ id, name, typeLine: "Creature", mv: 1, owner });
const setup = (names: string[], owner = "A") => {
  const g = createGame(["A", "B"]);
  g.active = "A";
  g.step = "main1";
  g.priority = "A";
  names.forEach((n, i) => enterBattlefield(g, card(`${n}${i}`, n, owner), owner, book));
  return g;
};
const names = (g: Game) => g.stack.map((s) => s.card.name); // 末尾 = 上 (先に解決される)

// 既定: 見つけた順に積む (最初に見つけたものが下)
{
  const g = setup(["X", "Y"]);
  flushEvents(g, book);
  assert.deepEqual(names(g), ["X", "Y"]);
}
// 人: 順番を聞く (違う誘発が 2 つ以上)。答え = 先に解決したい順
{
  const g = setup(["X", "Y"]);
  g.decide = makeDecider("A", [], undefined, book);
  let asked: any;
  try { flushEvents(g, book); } catch (e) { asked = (e as NeedInput).request; }
  assert.equal(asked?.kind, "order");
  assert.equal(asked.to, "stack");
  assert.deepEqual(asked.cards.map((c: any) => c.name), ["X", "Y"]);
  const g2 = setup(["X", "Y"]);
  const ids = asked.cards.map((c: any) => c.id);
  g2.decide = makeDecider("A", [[ids[1], ids[0]]], undefined, book); // Y を先に解決
  flushEvents(g2, book);
  assert.deepEqual(names(g2), ["X", "Y"], "先に解決する Y が、上");
  const g3 = setup(["X", "Y"]);
  g3.decide = makeDecider("A", [[ids[0], ids[1]]], undefined, book); // X を先に解決
  flushEvents(g3, book);
  assert.deepEqual(names(g3), ["Y", "X"]);
}
// 同じ誘発ばかり (X と Z は同じ効果) なら、聞かない
{
  const g = setup(["X", "X"]);
  g.decide = makeDecider("A", [], undefined, book);
  flushEvents(g, book);
  assert.equal(g.stack.length, 2);
}
// 1 つだけなら、聞かない。相手 (AI・CPU) のものも聞かない
{
  const g = setup(["X"]);
  g.decide = makeDecider("A", [], undefined, book);
  flushEvents(g, book);
  const h = setup(["X", "Y"], "B");
  h.decide = makeDecider("A", [], "B", book);
  flushEvents(h, book);
  assert.equal(h.stack.length, 2);
}
console.log("battle-triggerorder ok");
