import assert from "node:assert";
import { JevAdvisor, aiStep } from "../src/battle/aiRun";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { GameCard, RuleBook, createGame } from "../src/battle/state";

// Jev の判断を AI に渡す (advisor): 指示に添える・比較 (添えた / 添えない) を履歴の裏側に残す・失敗しても続ける
resetRegistry();
registerBuiltinNodes();
const call = (node: string, args: NodeCall["args"]): NodeCall => ({ node, args });
const abilities: Record<string, Ability[]> = { Island: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "U" })] }] };
const rules: RuleBook = { get: (c) => (abilities[c] ? { card: c, abilities: abilities[c] } : undefined) };
const mk = (id: string, typeLine: string, mv: number, owner: string): GameCard => ({ id, name: id.replace(/\d+$/, ""), typeLine, mv, owner });
const setup = () => {
  const g = createGame(["you", "opp"]);
  g.hands["opp"] = [mk("Island1", "Basic Land — Island", 0, "opp")];
  g.libraries["you"] = Array.from({ length: 10 }, (_, i) => mk(`Lib${i}`, "Instant", 1, "you"));
  g.libraries["opp"] = Array.from({ length: 10 }, (_, i) => mk(`OLib${i}`, "Instant", 1, "opp"));
  g.step = "main1";
  g.active = "opp";
  g.priority = "opp";
  return { g, c: new BattleController(g, rules, "you", () => 0.5, undefined, "opp") };
};
const advisor = (mode: "on" | "compare", fail = false): JevAdvisor & { calls: number } => {
  const a = {
    calls: 0,
    mode,
    judge: async () => {
      a.calls++;
      if (fail) throw new Error("Jev が混雑している");
      return { text: "## Jev の判断 (参考)\n- 形勢: やや有利", input: 200, output: 5, ms: 120 };
    },
  };
  return a;
};
const land = (user: string) => (user.match(/(\d+): 土地を出す/) ?? [])[1] ?? "0";

(async () => {
  // on: 指示に添える。AI の答え (土地を出す) が使われる
  {
    const { g, c } = setup();
    const seen: string[] = [];
    const ask = async (_s: string, user: string) => (seen.push(user), { text: `{"choice": ${land(user)}, "why": "出す"}`, input: 10, output: 5 });
    const adv = advisor("on");
    assert.equal(await aiStep(c, ask, "opp", undefined, adv), "acted");
    assert.equal(adv.calls, 1);
    assert.equal(seen.length, 1, "on は、AI を 1 回だけ呼ぶ");
    assert.ok(seen[0].includes("## Jev の判断 (参考)") && seen[0].includes("形勢: やや有利"), "指示に、Jev の判断が添えられる");
    assert.ok(g.battlefield.some((p) => p.card.name === "Island"), "AI の答えが使われる");
    assert.equal(c.aiTokens.input, 210, "Jev の入力トークンも、数える");
  }
  // compare: 添えた場合と、添えない場合の、2 回。結果は、履歴の裏側 (aiNotes) に。同じとき・変わったとき
  for (const [plainChoice, label] of [["land", "同じ"], ["pass", "変わった"]] as const) {
    const { g, c } = setup();
    const seen: string[] = [];
    const ask = async (_s: string, user: string) => {
      seen.push(user);
      const withAdvice = user.includes("## Jev の判断");
      const choice = withAdvice || plainChoice === "land" ? land(user) : "0";
      return { text: `{"choice": ${choice}, "why": "x"}`, input: 10, output: 5 };
    };
    await aiStep(c, ask, "opp", undefined, advisor("compare"));
    assert.equal(seen.length, 2);
    assert.ok(seen[0].includes("## Jev の判断") && !seen[1].includes("## Jev の判断"), "1 回目は助言あり、2 回目はなし");
    assert.ok(c.aiNotes.some((n) => n.why.startsWith(`[Jev比較] ${label}`)), `比較の結果 (${label}) が、裏側に残る`);
    assert.ok(g.battlefield.some((p) => p.card.name === "Island"), "実行されるのは、助言ありの答え");
  }
  // Jev が失敗: 材料なしで、AI は動く
  {
    const { g, c } = setup();
    const seen: string[] = [];
    const ask = async (_s: string, user: string) => (seen.push(user), { text: `{"choice": ${land(user)}, "why": "x"}`, input: 1, output: 1 });
    assert.equal(await aiStep(c, ask, "opp", undefined, advisor("on", true)), "acted");
    assert.ok(!seen[0].includes("Jev の判断"));
    assert.ok(g.log.some((l) => l.includes("Jev の判断を、AI に渡せなかった")), "失敗は、ログに");
    assert.ok(g.battlefield.some((p) => p.card.name === "Island"));
  }
  // advisor が無ければ、いままでどおり
  {
    const { c } = setup();
    const seen: string[] = [];
    const ask = async (_s: string, user: string) => (seen.push(user), { text: `{"choice": 0, "why": "x"}`, input: 1, output: 1 });
    await aiStep(c, ask, "opp");
    assert.ok(seen.length === 1 && !seen[0].includes("Jev"));
  }
  console.log("battle-jevadvise ok");
})();
