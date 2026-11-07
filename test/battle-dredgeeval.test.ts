import assert from "node:assert";
import { aiStep } from "../src/battle/aiRun";
import { dredgeNote, dredgeVerdict, evalDredge, millRole } from "../src/battle/dredgeEval";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { GameCard, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// 発掘 (Dredge) の判断: ノードの役割から、デッキの内訳で確率を計算する。カード名・デッキ固有の指定は、使わない
//   落とすと得 (millPayoff): 「ライブラリーから墓地に置かれたとき」に働く誘発を持つ / 落とすと困る (lossy): 墓地では使えない起動型能力を持つ (Bazaar など)
const call = (node: string, args: NodeCall["args"] = {}): NodeCall => ({ node, args });
const m: Record<string, Ability[]> = {
  Narco: [{ kind: "triggered", body: [call("when", { event: "moved", from: "library", to: "graveyard", zone: "graveyard", self: true }), call("self"), call("move", { cards: { ref: "s" }, to: "battlefield" })] }],
  Bazaar: [{ kind: "activated", body: [call("cost", { tap: true }), call("draw", { player: "you", count: 2 }), call("discard", { player: "you", count: 3 })] }],
  Swamp: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "B" })] }],
  Imp: [{ kind: "static", body: [call("dredge", { amount: 5 })] }],
  Thug: [{ kind: "static", body: [call("dredge", { amount: 4 })] }],
  Ichorid: [{ kind: "triggered", body: [call("when", { event: "step", step: "upkeep", zone: "graveyard" }), call("self")] }],
};
const rules: RuleBook = { get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) };
const card = (id: string, name: string, typeLine = "Land"): GameCard => ({ id, name, typeLine, mv: 1, owner: "ai" });
const lib = (...groups: [string, number][]) => groups.flatMap(([name, n]) => Array.from({ length: n }, (_, i) => card(`${name}${i}`, name)));
const game = (library: GameCard[]) => {
  const g = createGame(["foe", "ai"]);
  g.libraries["ai"] = library;
  return g;
};

// ---- 役割: ノードから導く (カード名は見ない)
assert.equal(millRole(rules, "Narco"), "payoff", "ライブラリーから墓地に置かれたときの誘発: 落とすと得");
assert.equal(millRole(rules, "Ichorid"), "neutral", "墓地で働くが、落とされたときの誘発ではない");
assert.equal(millRole(rules, "Bazaar"), "lossy", "墓地では使えない起動型能力: 落とすと困る");
assert.equal(millRole(rules, "Swamp"), "neutral", "マナを出すだけの土地は、困らない");
assert.equal(millRole(rules, "Imp"), "neutral", "Dredge 持ちは、落ちても取り戻せる");
assert.equal(millRole(rules, "Unknown"), "neutral", "ルールの無いカードも、neutral");

// ---- 確率: 上から N 枚に、少なくとも 1 枚。超幾何分布 (デッキの内訳から)
{
  const g = game(lib(["Narco", 2], ["Bazaar", 1], ["Filler", 7]));
  const e = evalDredge(g, rules, "ai", 5);
  assert.deepEqual([e.library, e.n, e.payoff, e.lossy], [10, 5, 2, 1]);
  assert.ok(Math.abs(e.pLossy - 0.5) < 1e-9, "10 枚中 1 枚の Bazaar が、上から 5 枚に落ちる確率は 1/2");
  assert.ok(Math.abs(e.pPayoff - (1 - (8 * 7 * 6 * 5 * 4) / (10 * 9 * 8 * 7 * 6) * 1)) < 1e-9, "Narcomoeba が 2 枚: 少なくとも 1 枚落ちる確率");
  assert.ok(Math.abs(e.expPayoff - 1) < 1e-9 && Math.abs(e.expLossy - 0.5) < 1e-9, "期待枚数 = K × N / 枚数");
  assert.match(dredgeNote(e), /Dredge 5/);
  assert.match(dredgeNote(e), /落とすと得/);
  assert.match(dredgeNote(e), /落とすと困る/);
}

// ---- 判定: 得だけ → する (機械的)・困るだけ (得が見込めない) → しない (機械的)・両方・どちらも無い → AI に聞く
assert.equal(dredgeVerdict(evalDredge(game(lib(["Narco", 3], ["Filler", 7])), rules, "ai", 5)), "yes", "困るカードが無く、得が見込める: する");
assert.equal(dredgeVerdict(evalDredge(game(lib(["Bazaar", 2], ["Filler", 8])), rules, "ai", 5)), "no", "困るカードだけが落ちうる: しない");
assert.equal(dredgeVerdict(evalDredge(game(lib(["Narco", 2], ["Bazaar", 1], ["Filler", 7])), rules, "ai", 5)), "ask", "両方: AI に聞く");
assert.equal(dredgeVerdict(evalDredge(game(lib(["Filler", 10])), rules, "ai", 5)), "ask", "どちらも無い: AI に聞く");

// ---- AI の Dredge: 機械的に決まるときは、AI を呼ばない。聞くときは、数字つき。同じ状況は、答えを使い回す
const make = (library: GameCard[]) => {
  const g = createGame(["foe", "ai"]);
  g.strictTurns = true;
  g.turn = 2;
  g.active = "ai";
  g.step = "upkeep";
  g.priority = "ai";
  g.libraries["ai"] = library;
  g.libraries["foe"] = lib(["Filler", 5]).map((c) => ({ ...c, owner: "foe" }));
  g.graveyards["ai"] = [card("Imp1", "Imp", "Creature")];
  return { g, c: new BattleController(g, rules, "foe", () => 0.5, undefined, "ai") };
};
(async () => {
  let calls = 0;
  const prompts: string[] = [];
  const ask = async (_s: string, user: string) => (calls++, prompts.push(user), { text: '{"ids": ["Imp1"], "why": "x"}', input: 1, output: 1 });
  {
    // 機械的に「する」: 聞かずに Dredge。ログに残る
    const { g, c } = make(lib(["Narco", 3], ["Filler", 12]));
    c.aiAuto();
    c.next();
    assert.equal(c.pending, undefined, "質問が出ない");
    assert.equal(calls, 0);
    assert.ok(g.hands["ai"].some((x) => x.id === "Imp1"), "Dredge した");
    assert.ok(g.log.some((l) => l.includes("機械的")), "機械的に判断したことが、ログに出る");
  }
  {
    // 機械的に「しない」: 聞かず、ふつうに引く。ログに連打しない
    const { g, c } = make(lib(["Bazaar", 2], ["Filler", 12]));
    c.aiAuto();
    c.next();
    assert.equal(c.pending, undefined);
    assert.equal(calls, 0);
    assert.ok(!g.hands["ai"].some((x) => x.id === "Imp1"));
    assert.ok(!g.log.some((l) => l.includes("Dredge しなかった")), "「しなかった」の通知は出さない");
  }
  {
    // 聞く: 質問に、確率・内訳が入る
    const { c } = make(lib(["Narco", 2], ["Bazaar", 1], ["Filler", 12]));
    c.aiAuto();
    c.next();
    assert.ok(c.pending);
    await aiStep(c, ask, "ai");
    assert.equal(calls, 1);
    assert.ok(/落とすと得/.test(prompts[0]) && /落とすと困る/.test(prompts[0]) && /%/.test(prompts[0]), "質問に、確率の説明");
  }
  {
    // 同じ状況 (内訳・N・墓地が同じ): 2 回目は、AI を呼ばずに、前の答えを使う
    const first = make(lib(["Narco", 2], ["Bazaar", 1], ["Filler", 12]));
    first.c.aiAuto();
    first.c.next();
    calls = 0;
    await aiStep(first.c, ask, "ai");
    const again = make(lib(["Narco", 2], ["Bazaar", 1], ["Filler", 12]));
    again.c.aiDredgeCache = first.c.aiDredgeCache;
    again.c.aiAuto();
    again.c.next();
    await aiStep(again.c, ask, "ai");
    assert.equal(calls, 1, "2 回目は、聞かない");
    assert.ok(again.g.hands["ai"].some((x) => x.id === "Imp1"), "前の答え (Dredge する) が使われた");
  }
  console.log("battle-dredgeeval ok");
})();
