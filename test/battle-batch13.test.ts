import assert from "node:assert";
import { RuleError, castSpell, passPriority, playLand } from "../src/battle/engine";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const card = (id: string, typeLine: string, owner = "A"): GameCard => ({ id, name: id, typeLine, mv: 1, owner });
const call = (node: string, args: NodeCall["args"]): NodeCall => ({ node, args });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const MSG = "ルールが設定されていません。スキップします。";
const count = (g: Game) => g.log.filter((l) => l.includes(MSG)).length;
const drain = (g: Game, book: RuleBook) => {
  for (let i = 0; g.stack.length && i < 20; i++) passPriority(g, g.priority!, book);
};
const setup = (skip: boolean) => {
  const g = createGame(["A", "B"]);
  g.skipUnruled = skip;
  g.step = "main1";
  return g;
};

// ルールの無いカードは、スキップ (skipUnruled が真のとき)
{
  const g = setup(true);
  g.hands["A"].push(card("Bear", "Creature — Bear"));
  castSpell(g, "A", "Bear", {}, rulesOf({}));
  drain(g, rulesOf({}));
  assert.ok(g.battlefield.some((p) => p.id === "Bear"), "クリーチャーは、解決して戦場に出る");
  assert.equal(count(g), 1, "ログは1回");
  assert.ok(g.log.some((l) => l.startsWith("Bear: ")), "カード名つき");
}
{
  const g = setup(true);
  g.hands["A"].push(card("Bolt", "Instant"));
  castSpell(g, "A", "Bolt", {}, rulesOf({}));
  drain(g, rulesOf({}));
  assert.ok(g.graveyards["A"].some((c) => c.id === "Bolt"), "インスタントは、解決して墓地へ");
  assert.equal(count(g), 1);
}
{
  const g = setup(true);
  g.hands["A"].push(card("Island", "Basic Land — Island"));
  g.priority = "A";
  playLand(g, "A", "Island", rulesOf({}));
  assert.ok(g.battlefield.some((p) => p.id === "Island"), "土地は出せる");
  assert.equal(count(g), 1);
  assert.equal(g.mana["A"], 0, "マナは出ない (基本土地も、ルールが無ければ例外なし)");
}
// ノードが空のルール (abilities: []) も、同じ扱い
{
  const g = setup(true);
  const empty: RuleBook = { get: (c) => ({ card: c, abilities: [] }) };
  g.hands["A"].push(card("Bear", "Creature — Bear"));
  castSpell(g, "A", "Bear", {}, empty);
  drain(g, empty);
  assert.ok(g.battlefield.some((p) => p.id === "Bear"));
  assert.equal(count(g), 1);
}
// 偽 (既定) なら、これまでどおり
{
  const g = setup(false);
  g.hands["A"].push(card("Bolt", "Instant"));
  assert.throws(() => castSpell(g, "A", "Bolt", {}, rulesOf({})), RuleError);
  assert.equal(count(g), 0);
}
// ルールがあるカードは、通常どおり動いて、ログに出ない
{
  const g = setup(true);
  const book = rulesOf({ Draw: [{ kind: "spell", body: [call("draw", { player: "you", count: 1 })] }] });
  g.libraries["A"] = [card("l1", "Instant")];
  g.hands["A"].push(card("Draw", "Instant"));
  castSpell(g, "A", "Draw", {}, book);
  drain(g, book);
  assert.equal(g.hands["A"].length, 1);
  assert.equal(count(g), 0);
}
// 常在型・誘発型だけのルール (ノードあり) は、スキップしない。パーマネントは、ふつうに出て、ログに出ない (述語を「簡単にして」壊さないための確認)
{
  const g = setup(true);
  const book = rulesOf({ Wall: [{ kind: "static", body: [call("keyword", { name: "flash" })] }] });
  g.hands["A"].push(card("Wall", "Creature — Wall"));
  castSpell(g, "A", "Wall", {}, book);
  drain(g, book);
  assert.ok(g.battlefield.some((p) => p.id === "Wall"));
  assert.equal(count(g), 0, "ノードがあるルールは、スキップ扱いにしない");
}
// ルールのある土地は、マナが出る。ログには出ない
{
  const g = setup(true);
  const book = rulesOf({ Island: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "U" })] }] });
  g.hands["A"].push(card("Island", "Basic Land — Island"));
  g.priority = "A";
  playLand(g, "A", "Island", book);
  assert.equal(count(g), 0);
}
console.log("batch13 ok");
