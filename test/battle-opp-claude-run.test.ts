import assert from "node:assert";
import { AskAi, aiAttackers, aiBlockers } from "../src/battle/ai";
import { aiStep } from "../src/battle/aiRun";
import { CardData, DeckData, buildMatch } from "../src/battle/deckToGame";
import { attackersAt } from "../src/battle/engine";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { RuleBook } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rules: RuleBook = {
  get: (c) =>
    ({
      Island: { card: c, abilities: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "U" })] }] as Ability[] },
      Bear: { card: c, abilities: [] as Ability[] },
      Zap: { card: c, abilities: [{ kind: "spell", body: [call("target", { zone: "any", kind: "any" }, { as: "t" }), call("damage", { target: { ref: "t" }, amount: 2 })] }] as Ability[] },
    } as Record<string, { card: string; abilities: Ability[] }>)[c],
};
const data = (name: string, extra: Partial<CardData> = {}) => ({ key: name, data: { name, typeLine: "Creature — Bear", cmc: 2, manaCost: "{1}{U}", colors: ["U"], power: "2", toughness: "2", ...extra } as CardData });
const deck = (): DeckData => ({
  format: "standard",
  main: [
    { ...data("Island", { typeLine: "Basic Land — Island", cmc: 0, manaCost: "", power: undefined, toughness: undefined }), n: 24 },
    { ...data("Bear"), n: 26 },
    { ...data("Zap", { typeLine: "Instant", power: undefined, toughness: undefined, manaCost: "{U}" }), n: 10 },
  ],
});

// 乱数 (固定)
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// Claude の代わりの、決まった返事の返し方 (選択肢の番号・攻撃・ブロックは、盤面から作る)
const g = buildMatch(deck(), deck(), rules, () => 0.5);
g.mulligan = undefined;
const c = new BattleController(g, rules, "you", () => 0.5, undefined, "opp");
let calls = 0;
const ask: AskAi = async (_s, user) => {
  calls++;
  let text: string;
  if (user.includes("攻撃クリーチャーを指定する段階")) text = JSON.stringify({ attackers: aiAttackers(g, rules, "opp").map((x) => x.id), why: "全員" });
  else if (user.includes("ブロックを指定する段階")) {
    const a = attackersAt(g, "opp")[0];
    const b = aiBlockers(g, rules, "opp")[0];
    text = JSON.stringify({ blocks: a && b ? [{ blocker: b.id, attacker: a.id }] : [], why: "止める" });
  } else {
    const nums = [...user.matchAll(/^(\d+): /gm)].map((m) => Number(m[1]));
    text = "```json\n" + JSON.stringify({ choice: nums.length > 1 && rnd() < 0.8 ? nums[1 + Math.floor(rnd() * (nums.length - 1))] : 0, why: "選んだ" }) + "\n```";
  }
  return { text, input: 100, output: 20 };
};

let failed = "";
for (let i = 0; i < 600 && !g.over && !failed; i++) {
  for (let k = 0; k < 40; k++) {
    const r = await aiStep(c, ask, "opp");
    if (r === "failed") failed = g.log.filter((l) => l.includes("使えない")).pop() ?? "failed";
    if (r !== "acted") break;
  }
  if (failed || g.over) break;
  if (c.pending) { c.cancel(); }
  if (g.priority === "you") {
    // 人の動き: 土地・クリーチャー、攻撃は全員
    if (g.active === "you" && g.step === "main1" && !g.stack.length) {
      const l = g.hands["you"].find((x) => /Land/.test(x.typeLine));
      if (l) c.use(l.id);
      for (const p of g.battlefield.filter((x) => x.controller === "you" && x.card.name === "Island" && !x.tapped)) c.activate(p.id, 0);
      const b = g.hands["you"].find((x) => x.name === "Bear");
      if (b) c.use(b.id);
    }
    if (g.active === "you" && g.step === "combat" && g.combatPhase === "attackers" && !g.attackersDeclared) {
      const ids = g.battlefield.filter((x) => x.controller === "you" && /Creature/.test(x.card.typeLine) && !x.tapped && x.enteredTurn !== g.turn).map((x) => x.id);
      if (ids.length) c.declareAttackers(ids);
    }
    c.next();
  }
}
assert.equal(failed, "", `Claude の相手が途中で失敗した: ${failed}`);
assert.ok(g.turn >= 8 || g.over, `対戦が進む (ターン ${g.turn})`);
assert.ok(calls > 5, "API (の代わり) を何度も呼んだ");
assert.ok(g.log.some((l) => l.startsWith("相手 (Claude) のトークン")), "トークン数がログに残る");
assert.equal(c.aiTokens.input, calls * 100);
console.log(`opp-claude-run ok (turn ${g.turn}, calls ${calls})`);
