import assert from "node:assert";
import { RuleError, activateAbility, castSpell, passPriority } from "../src/battle/engine";
import { stateBased } from "../src/battle/engine/battlefield";
import { NeedInput, makeDecider } from "../src/battle/input";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// 伝説のルール: 同じプレイヤーが、同名の伝説のパーマネントを 2 つ以上コントロールしたら、1 つを選んで残し、ほかは墓地に置く (状況起因処理。生け贄でも破壊でもない)
const card = (id: string, name: string, typeLine: string, owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name, typeLine, mv: 1, owner, power: 2, toughness: 2, ...extra });
const call = (node: string, args: NodeCall["args"]): NodeCall => ({ node, args });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const perm = (id: string, name: string, typeLine: string, controller = "A", turn = 0): Perm => ({ id, card: card(id, name, typeLine, controller), controller, enteredTurn: turn });
const none = rulesOf({});
const LEG = "Legendary Creature — Human";
const ids = (g: Game) => g.battlefield.map((p) => p.id);

// 既定: 先に出ていた 1 体を残し、あとから出たほうが墓地へ
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(perm("Old", "Noble", LEG), perm("New", "Noble", LEG));
  stateBased(g, none);
  assert.deepEqual(ids(g), ["Old"]);
  assert.deepEqual(g.graveyards["A"].map((c) => c.id), ["New"], "墓地に置かれる");
  assert.ok(g.log.some((l) => l.includes("伝説のルール")), "ログに残る");
  assert.ok(g.effects?.some((e) => e.text.includes("伝説のルール")), "効果の発動として、画面に出る");
}
// 選べる: 新しいほうを残す
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(perm("Old", "Noble", LEG), perm("New", "Noble", LEG));
  g.decide = { legend: (_g, _p, list) => list.find((x) => x.id === "New") };
  stateBased(g, none);
  assert.deepEqual(ids(g), ["New"]);
  assert.deepEqual(g.graveyards["A"].map((c) => c.id), ["Old"]);
}
// 3 体なら、2 体が墓地へ
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(perm("1", "Noble", LEG), perm("2", "Noble", LEG), perm("3", "Noble", LEG));
  stateBased(g, none);
  assert.deepEqual(ids(g), ["1"]);
}
// 別のプレイヤーなら、並んでよい。伝説でなければ、同名でも、そのまま。名前が違えば、そのまま
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(perm("a", "Noble", LEG, "A"), perm("b", "Noble", LEG, "B"), perm("c", "Bear", "Creature — Bear"), perm("d", "Bear", "Creature — Bear"), perm("e", "Sage", LEG), perm("f", "Other", LEG));
  stateBased(g, none);
  assert.equal(g.battlefield.length, 6, "どれも、墓地へは行かない");
}
// 「死んだ」の誘発は起きる (墓地に置かれる)。生け贄の誘発は起きない
{
  const dies: Ability = { kind: "triggered", body: [call("when", { event: "leaves", to: "graveyard", self: true }), call("gainLife", { player: "you", amount: 3 })] };
  const sac: Ability = { kind: "triggered", body: [call("when", { event: "leaves", self: true }), call("gainLife", { player: "you", amount: 100 })] };
  const book = rulesOf({ Noble: [dies] });
  const g = createGame(["A", "B"]);
  g.active = "A";
  g.priority = "A";
  g.battlefield.push(perm("Old", "Noble", LEG), perm("New", "Noble", LEG));
  stateBased(g, book);
  const { flushEvents } = await import("../src/battle/engine/triggers");
  flushEvents(g, book);
  for (let i = 0; g.stack.length && i < 10; i++) passPriority(g, g.priority!, book);
  assert.equal(g.life["A"], 23, "墓地に置かれたほうの「死んだとき」が誘発して、3 点得る");
  void sac;
}
// 呪文として唱えた 2 体目が解決したときも、処理される。「戦場に出たとき」は、誘発する (出た事実は残る)
{
  const etb: Ability = { kind: "triggered", body: [call("when", { event: "enters", self: true }), call("gainLife", { player: "you", amount: 2 })] };
  const book = rulesOf({ Noble: [etb] });
  const g = createGame(["A", "B"]);
  g.step = "main1";
  g.active = "A";
  g.priority = "A";
  g.battlefield.push(perm("Old", "Noble", LEG));
  g.hands["A"].push(card("New", "Noble", LEG));
  castSpell(g, "A", "New", {}, book);
  for (let i = 0; g.stack.length && i < 20; i++) passPriority(g, g.priority!, book);
  assert.equal(g.battlefield.filter((p) => p.card.name === "Noble").length, 1, "1 体だけ残る");
  assert.equal(g.life["A"], 22, "出たときの能力は、誘発した");
}
// 墓地に置かれた 2 体目の起動型能力は、起動できない (優先権を持つ前に、墓地へ行っている)。残ったほうは、起動できる
{
  const tap: Ability = { kind: "activated", body: [call("cost", { tap: true }), call("gainLife", { player: "you", amount: 1 })] };
  const book = rulesOf({ Noble: [tap] });
  const g = createGame(["A", "B"]);
  g.step = "main1";
  g.active = "A";
  g.priority = "A";
  g.battlefield.push(perm("Old", "Noble", LEG));
  g.hands["A"].push(card("New", "Noble", LEG));
  castSpell(g, "A", "New", {}, book);
  for (let i = 0; g.stack.length && i < 20; i++) passPriority(g, g.priority!, book);
  assert.throws(() => activateAbility(g, "A", "New", 0, {}, book), RuleError, "墓地へ行った 2 体目は、起動できない");
  activateAbility(g, "A", "Old", 0, {}, book);
}
// 人への質問 (input.ts): 残すほうを選ぶ
{
  const g = createGame(["A", "B"]);
  const list = [perm("Old", "Noble", LEG), perm("New", "Noble", LEG)];
  assert.equal(makeDecider("B", []).legend!(g, "A", list), undefined, "自分以外は、聞かない");
  try {
    makeDecider("A", []).legend!(g, "A", list);
    assert.fail("質問が出るはず");
  } catch (e) {
    assert.ok(e instanceof NeedInput);
    const r = e.request;
    assert.ok(r.kind === "choose" && r.min === 1 && r.max === 1 && r.cards.length === 2 && /伝説のルール/.test(r.label ?? "") && /Noble/.test(r.label ?? ""));
  }
  assert.equal(makeDecider("A", [["New"]]).legend!(g, "A", list)?.id, "New");
}
// 伝説のルールを無視するカード (ignoreLegendRule): who=all (Mirror Gallery) / you (自分のパーマネントだけ) / self (このパーマネントだけ)
{
  const ignore = (who: string): Ability[] => [{ kind: "static", body: [call("ignoreLegendRule", { who })] }];
  const make = (who: string, sourceOwner = "A") => {
    const g = createGame(["A", "B"]);
    g.battlefield.push(perm("Gallery", "Gallery", "Legendary Artifact", sourceOwner), perm("a1", "Noble", LEG, "A"), perm("a2", "Noble", LEG, "A"), perm("b1", "Sage", LEG, "B"), perm("b2", "Sage", LEG, "B"));
    return { g, book: rulesOf({ Gallery: ignore(who) }) };
  };
  const count = (g: Game, name: string) => g.battlefield.filter((p) => p.card.name === name).length;
  { const { g, book } = make("all"); stateBased(g, book); assert.deepEqual([count(g, "Noble"), count(g, "Sage")], [2, 2], "all: だれのパーマネントにも、伝説のルールは働かない"); }
  { const { g, book } = make("you"); stateBased(g, book); assert.deepEqual([count(g, "Noble"), count(g, "Sage")], [2, 1], "you: コントローラー (A) のパーマネントだけ。B のものは、働く"); }
  { const { g, book } = make("opponents"); stateBased(g, book); assert.deepEqual([count(g, "Noble"), count(g, "Sage")], [1, 2], "opponents: 相手 (B) のパーマネントだけ"); }
  {
    // self: このパーマネントだけ。同名のもう 1 体と並んでよい (相手でない側は、そのまま)
    const g = createGame(["A", "B"]);
    const book = rulesOf({ Sakashima: ignore("self") });
    g.battlefield.push(perm("s1", "Sakashima", "Legendary Creature — Human"), perm("s2", "Sakashima", "Legendary Creature — Human"), perm("s3", "Sakashima", "Legendary Creature — Human"));
    stateBased(g, book);
    assert.equal(count(g, "Sakashima"), 3, "全員が、自分自身を免除するので、3 体とも残る");
    const h = createGame(["A", "B"]);
    h.battlefield.push(perm("n1", "Noble", LEG), perm("n2", "Noble", LEG));
    stateBased(h, rulesOf({ n1: [], Noble: [] }));
    assert.equal(h.battlefield.length, 1, "能力の無い同名は、これまでどおり");
  }
  {
    // 能力を失ったら、無効にならない (Oko の大鹿など: 能力を失った Gallery は、免除できない)
    const { g, book } = make("all");
    g.battlefield.find((p) => p.id === "Gallery")!.becomes = [{ types: "Creature — Elk", power: 3, toughness: 3, lose: true, until: "forever" }];
    stateBased(g, book);
    assert.deepEqual([count(g, "Noble"), count(g, "Sage")], [1, 1], "能力を失った Gallery は、働かない");
  }
}
console.log("battle-legend ok");
