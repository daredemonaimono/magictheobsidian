import assert from "node:assert";
import { aiOptions } from "../src/battle/ai";
import { aiStep, humanAsking } from "../src/battle/aiRun";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { replay } from "../src/battle/replay";
import { GameCard, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// AI の相手が Dredge を使う: 引くとき、AI (API) に聞いて、答える。雑魚 CPU・失敗・API なしは、Dredge しない。手札から起動する能力 (サイクリング) も、選択肢に入る
const call = (node: string, args: NodeCall["args"] = {}): NodeCall => ({ node, args });
const m: Record<string, Ability[]> = {
  Imp: [{ kind: "static", body: [call("dredge", { amount: 3 })] }],
  Hollow: [{ kind: "activated", body: [call("cost", { mana: 2, discardSelf: true }), call("draw", { player: "you", count: 1 })] }],
};
const rules: RuleBook = { get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) };
const mk = (id: string, name: string, owner: string, typeLine = "Land"): GameCard => ({ id, name, typeLine, mv: 1, owner });
const setup = (withAi = true) => {
  const g = createGame(["you", "opp"]);
  g.strictTurns = true;
  g.turn = 2;
  g.active = "opp";
  g.step = "upkeep";
  g.priority = "opp";
  g.libraries["opp"] = Array.from({ length: 8 }, (_, i) => mk(`L${i}`, "Land", "opp"));
  g.libraries["you"] = Array.from({ length: 8 }, (_, i) => mk(`Y${i}`, "Land", "you"));
  g.graveyards["opp"] = [mk("Imp1", "Imp", "opp", "Creature")];
  return { g, c: new BattleController(g, rules, "you", () => 0.5, undefined, withAi ? "opp" : undefined) };
};
const names = (cs: GameCard[]) => cs.map((c) => c.id);

(async () => {
  // AI に聞く: 「Imp を選ぶ」と答えると、Dredge する (上から 3 枚が墓地へ、Imp が手札へ)
  {
    const { g, c } = setup();
    const prompts: string[] = [];
    const ask = async (_s: string, user: string) => (prompts.push(user), { text: '{"ids": ["Imp1"], "why": "墓地を肥やしたい"}', input: 50, output: 10 });
    c.aiAuto();
    c.next(); // 人がパスして、次のステップ (ドロー) へ
    assert.ok(c.pending?.request.kind === "choose" && c.pending.request.for === "opp", "AI への質問が出る");
    assert.equal(humanAsking(c), false, "人への質問ではない");
    assert.equal(await aiStep(c, ask, "opp"), "acted");
    assert.equal(c.pending, undefined, "答えると、続きが進む");
    assert.ok(prompts[0].includes("Dredge 3") && prompts[0].includes("Imp1"), "質問の文章に、Dredge の数とカードの id");
    assert.deepEqual(names(g.hands["opp"]), ["Imp1"], "Imp が手札に戻った");
    assert.deepEqual(names(g.graveyards["opp"]), ["L0", "L1", "L2"], "上から 3 枚が墓地へ");
    assert.ok(c.aiNotes.some((n) => n.why.startsWith("Dredge する")), "理由は、履歴の裏側に");
    assert.equal(c.aiTokens.input, 50);
    // 記録に答えが残り、リプレイで、同じ局面になる
    const again = setup().c;
    again.aiAuto();
    again.next();
    again.answer(["Imp1"]);
    assert.deepEqual(names(again.game.hands["opp"]), ["Imp1"]);
    assert.ok(c.record.some((e) => e.answers?.some((a) => Array.isArray(a) && a.includes("Imp1"))), "答えが、記録に残る");
    void replay;
  }
  // 「選ばない」と答えると、ふつうに引く
  {
    const { g, c } = setup();
    c.aiAuto();
    c.next();
    await aiStep(c, async () => ({ text: '{"ids": [], "why": "温存"}' }), "opp");
    assert.deepEqual(names(g.hands["opp"]), ["L0"], "ふつうに引く");
    assert.deepEqual(names(g.graveyards["opp"]), ["Imp1"]);
  }
  // 使えない返事・失敗: Dredge しない (ふつうに引く)。API が無い (ask なし) ときも
  for (const ask of [async () => ({ text: "よく分かりません" }), async () => { throw new Error("通信できない"); }, undefined]) {
    const { g, c } = setup();
    c.aiAuto();
    c.next();
    assert.equal(await aiStep(c, ask, "opp"), "acted");
    assert.deepEqual(names(g.hands["opp"]), ["L0"]);
  }
  // 雑魚 CPU (AI でない): 質問は出ず、ふつうに引く
  {
    const { g, c } = setup(false);
    const cpu = new BattleController(g, rules, "you", () => 0.5, "opp");
    cpu.next();
    assert.equal(c.pending, undefined);
    assert.ok(!g.hands["opp"].some((x) => x.id === "Imp1"), "CPU は Dredge しない");
  }
  // サイクリング: 手札から起動する能力が、選択肢に入る (マナがあるとき)
  {
    const { g } = setup();
    g.step = "main1";
    g.hands["opp"] = [mk("Hollow1", "Hollow", "opp", "Artifact Creature")];
    g.mana["opp"] = 2;
    const opts = aiOptions(g, rules, "opp");
    const cyc = opts.find((o) => o.label.startsWith("手札から起動: Hollow"));
    assert.ok(cyc?.action?.kind === "handAbility", "サイクリングの選択肢");
    g.mana["opp"] = 0;
    assert.ok(!aiOptions(g, rules, "opp").some((o) => o.label.startsWith("手札から起動")), "マナが無ければ、選択肢に入らない");
  }
  console.log("battle-aidredge ok");
})();
