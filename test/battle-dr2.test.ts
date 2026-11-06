import assert from "node:assert";
import { castSpell, passPriority } from "../src/battle/engine";
import { NeedInput, makeDecider } from "../src/battle/input";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, RuleBook, createGame, drawCards } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// DR-2: Dredge (引くかわりに、上から N 枚を墓地に置いて、このカードを墓地から手札へ)

const card = (id: string, typeLine = "Creature", owner = "A"): GameCard => ({ id, name: id, typeLine, mv: 1, owner });
const call = (node: string, args: NodeCall["args"]): NodeCall => ({ node, args });
const DREDGE = (n: number): Ability => ({ kind: "static", body: [call("dredge", { amount: n })] });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const book = rulesOf({
  Imp: [DREDGE(3)],
  Thug: [DREDGE(2)],
  Narcomoeba: [{ kind: "triggered", body: [call("when", { event: "moved", from: "library", to: "graveyard", zone: "graveyard", self: true }), { node: "self", args: {}, as: "s" }, call("move", { cards: { ref: "s" }, to: "battlefield" })] }],
  Draw2: [{ kind: "spell", body: [call("draw", { player: "you", count: 2 })] }],
});
const setup = () => {
  const g = createGame(["A", "B"]);
  g.step = "main1";
  g.priority = "A";
  g.libraries["A"] = ["l1", "l2", "l3", "l4", "l5"].map((id) => card(id));
  return g;
};
const ids = (cs: GameCard[]) => cs.map((c) => c.id);
const pick = (...order: (string | undefined)[]) => {
  const asked: string[][] = [];
  const decide = {
    dredge: (_g: Game, _p: string, options: { card: GameCard; n: number }[]) => {
      asked.push(options.map((o) => `${o.card.id}:${o.n}`));
      const want = order.shift();
      return options.find((o) => o.card.id === want)?.card;
    },
  };
  return { decide, asked };
};

// 選ぶと、引くかわりに、3 枚を墓地に置いて、Imp が手札に戻る
{
  const g = setup();
  g.graveyards["A"].push(card("Imp"));
  const p = pick("Imp");
  g.decide = p.decide;
  drawCards(g, "A", 1, book);
  assert.deepEqual(ids(g.hands["A"]), ["Imp"], "引いたのは、Imp (l1 ではない)");
  assert.deepEqual(ids(g.graveyards["A"]), ["l1", "l2", "l3"], "上から 3 枚が墓地");
  assert.deepEqual(ids(g.libraries["A"]), ["l4", "l5"]);
  assert.deepEqual(p.asked, [["Imp:3"]]);
  assert.ok(!(g.drawn?.["A"] ?? []).includes("Imp"), "引いたカードには数えない");
}
// 選ばなければ、ふつうに引く
{
  const g = setup();
  g.graveyards["A"].push(card("Imp"));
  g.decide = pick(undefined).decide;
  drawCards(g, "A", 1, book);
  assert.deepEqual(ids(g.hands["A"]), ["l1"]);
  assert.deepEqual(ids(g.graveyards["A"]), ["Imp"]);
}
// ライブラリーが N 枚に足りなければ、選べない (聞かない)
{
  const g = setup();
  g.libraries["A"] = g.libraries["A"].slice(0, 2);
  g.graveyards["A"].push(card("Imp"));
  const p = pick("Imp");
  g.decide = p.decide;
  drawCards(g, "A", 1, book);
  assert.deepEqual(p.asked, [], "Dredge 3 は、ライブラリーが 2 枚だと、できない");
  assert.deepEqual(ids(g.hands["A"]), ["l1"]);
}
// 複数: Imp (3) と Thug (2) の両方が候補。引くたびに聞く。2 回目は、ふつうに
{
  const g = setup();
  g.graveyards["A"].push(card("Imp"), card("Thug"));
  const p = pick("Thug", undefined);
  g.decide = p.decide;
  drawCards(g, "A", 2, book);
  assert.deepEqual(p.asked[0].sort(), ["Imp:3", "Thug:2"]);
  assert.deepEqual(ids(g.hands["A"]), ["Thug", "l3"], "1 回目は Dredge (l1・l2 が墓地へ)。2 回目は、ふつうに (l3)");
  assert.equal(p.asked.length, 2);
}
// 決める人が居なければ (decide が無い・相手・CPU)、ふつうに引く。rules を渡さない引き (最初の 7 枚) も、ふつうに
{
  const g = setup();
  g.graveyards["A"].push(card("Imp"));
  drawCards(g, "A", 1, book);
  assert.deepEqual(ids(g.hands["A"]), ["l1"]);
  const h = setup();
  h.graveyards["A"].push(card("Imp"));
  h.decide = pick("Imp").decide;
  drawCards(h, "A", 1);
  assert.deepEqual(ids(h.hands["A"]), ["l1"], "rules が無ければ、Dredge しない (開始時の手札)");
}
// 「引く」ノードも、Dredge できる。墓地に置かれた Narcomoeba は、戦場に出る (誘発)
{
  const g = setup();
  g.libraries["A"] = [card("Narcomoeba"), card("l2"), card("l3"), card("l4")];
  g.graveyards["A"].push(card("Imp"));
  g.hands["A"].push(card("Draw2", "Sorcery"));
  const p = pick("Imp", undefined);
  g.decide = p.decide;
  castSpell(g, "A", "Draw2", {}, book);
  for (let i = 0; g.stack.length && i < 20; i++) passPriority(g, g.priority!, book);
  assert.deepEqual(ids(g.hands["A"]), ["Imp", "l4"], "1 枚目は Dredge、2 枚目は、ふつう");
  assert.ok(g.battlefield.some((x) => x.id === "Narcomoeba"), "Dredge で墓地に置かれた Narcomoeba が出る");
}
// 人への質問 (input.ts): 自分だけ。選ばないこともできる (0 枚)
{
  const g = setup();
  const opts = [{ card: card("Imp"), n: 3 }];
  assert.equal(makeDecider("B", []).dredge!(g, "A", opts), undefined, "自分以外は、聞かない");
  try {
    makeDecider("A", []).dredge!(g, "A", opts);
    assert.fail("質問が出るはず");
  } catch (e) {
    assert.ok(e instanceof NeedInput);
    const r = e.request;
    assert.ok(r.kind === "choose" && r.min === 0 && r.max === 1 && r.cards[0].id === "Imp" && /Dredge 3/.test(r.label ?? ""), "choose (0〜1 枚)・ラベルに Dredge の数");
  }
  assert.equal(makeDecider("A", [["Imp"]]).dredge!(g, "A", opts)?.id, "Imp");
  assert.equal(makeDecider("A", [[]]).dredge!(g, "A", opts), undefined, "選ばなければ、ふつうに引く");
}
console.log("battle-dr2 ok");
