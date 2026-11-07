import assert from "node:assert";
import { aiOptions } from "../src/battle/ai";
import { battleHints } from "../src/battle/battleHints";
import { activateAbility, passPriority } from "../src/battle/engine";
import { advanceStep } from "../src/battle/engine/turn";
import { makeDecider } from "../src/battle/input";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, RuleBook, createGame, dredgeOptions } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// AI の安全策 (Forge の考え方を参考): 暴走防止 (同じ能力を、1 ターンに何度も起動しない)・コスト許容 (ライフを払って 4 以下になるなら、選ばない)・タイミングの注意・Dredge の、機械的な不可・危険の判定 (AI を呼ばない)
const call = (node: string, args: NodeCall["args"] = {}): NodeCall => ({ node, args });
const m: Record<string, Ability[]> = {
  Pump: [{ kind: "activated", body: [call("cost", { mana: 0 }), call("draw", { player: "you", count: 0 })] }],
  Fetch: [{ kind: "activated", body: [call("cost", { tap: false, life: 3 }), call("draw", { player: "you", count: 1 })] }],
  Counter: [{ kind: "spell", body: [call("target", { zone: "stack", kind: "spell" }, ), call("counter", {})] }],
  Sign: [{ kind: "spell", body: [call("draw", { player: "you", count: 2 })] }],
  Imp: [{ kind: "static", body: [call("dredge", { amount: 4 })] }],
};
const rules: RuleBook = { get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) };
const card = (id: string, name: string, typeLine: string, owner = "ai", extra: Partial<GameCard> = {}): GameCard => ({ id, name, typeLine, mv: 1, owner, ...extra });
const setup = () => {
  const g = createGame(["foe", "ai"]);
  g.step = "main1";
  g.active = "ai";
  g.priority = "ai";
  g.turn = 3;
  g.libraries["ai"] = Array.from({ length: 10 }, (_, i) => card(`L${i}`, "Land", "Land"));
  g.libraries["foe"] = Array.from({ length: 10 }, (_, i) => card(`F${i}`, "Land", "Land", "foe"));
  g.battlefield.push({ id: "Pump1", card: card("Pump1", "Pump", "Artifact"), controller: "ai", enteredTurn: 0 });
  return g;
};
const has = (g: Game, label: string) => aiOptions(g, rules, "ai").some((o) => o.label.includes(label));

// ---- 暴走防止: 同じ能力は、1 ターンに 3 回まで。ターンが替わると戻る
{
  const g = setup();
  assert.ok(has(g, "Pump"), "最初は、選べる");
  for (let i = 0; i < 3; i++) {
    activateAbility(g, "ai", "Pump1", 0, {}, rules);
    for (let k = 0; g.stack.length && k < 6; k++) passPriority(g, g.priority!, rules);
    g.priority = "ai";
  }
  assert.equal(g.activated?.["Pump1:0"], 3, "起動の回数が、数えられる");
  assert.ok(!has(g, "Pump"), "3 回起動したら、選択肢に入らない (暴走防止)");
  g.step = "end";
  g.active = "ai";
  advanceStep(g, rules);
  assert.equal(g.activated?.["Pump1:0"] ?? 0, 0, "ターンが替わると、数えなおし");
}
// ---- コスト許容: ライフを払って、残りが 4 以下になる能力は、選ばない
{
  const g = setup();
  g.battlefield.push({ id: "Fetch1", card: card("Fetch1", "Fetch", "Land"), controller: "ai", enteredTurn: 0 });
  g.life["ai"] = 8;
  assert.ok(has(g, "Fetch"), "残り 5 なら、選べる");
  g.life["ai"] = 7;
  assert.ok(!has(g, "Fetch"), "残り 4 以下になるなら、選ばない");
}
// ---- 行動の分析に、タイミングとコストの注意が出る
{
  const g = setup();
  g.hands["ai"] = [card("Sign1", "Sign", "Instant")];
  const text = battleHints("act", g, rules, "ai", aiOptions(g, rules, "ai"));
  assert.ok(/タイミング: .*インスタント.*待てる/.test(text), "インスタントのドローは、相手のターン終了時まで待てる");
  g.battlefield.push({ id: "Fetch1", card: card("Fetch1", "Fetch", "Land"), controller: "ai", enteredTurn: 0 });
  g.life["ai"] = 9;
  assert.ok(/注意: ライフ 3 を払う \(9→6\)/.test(battleHints("act", g, rules, "ai", aiOptions(g, rules, "ai"))), "ライフを払うコストの注意");
  g.activated = { "Fetch1:0": 2 };
  assert.ok(/このターン 2 回、起動した/.test(battleHints("act", g, rules, "ai", aiOptions(g, rules, "ai"))), "起動回数の注意");
}

// ---- Dredge: 人は、ライブラリーが N 枚あれば選べる。AI は、機械的に不可・危険なら、質問が出ない (AI を呼ばない)
{
  const g = setup();
  g.graveyards["ai"] = [card("Imp1", "Imp", "Creature")];
  const opts = (n: number) => { g.libraries["ai"] = Array.from({ length: n }, (_, i) => card(`L${i}`, "Land", "Land")); return dredgeOptions(g, "ai", rules); };
  assert.equal(opts(3).length, 0, "ライブラリーが 3 枚: Dredge 4 は、できない");
  assert.equal(opts(4).length, 1, "4 枚: ルール上は、できる");
  const ask = (n: number) => { g.libraries["ai"] = Array.from({ length: n }, (_, i) => card(`L${i}`, "Land", "Land")); const d = makeDecider("foe", [], "ai"); try { return d.dredge!(g, "ai", dredgeOptions(g, "ai", rules)) ?? "declined"; } catch { return "asked"; } };
  assert.equal(ask(4), "declined", "AI: ちょうど N 枚だと、次のドローで負ける: 聞かずに、Dredge しない");
  assert.equal(ask(5), "asked", "AI: 1 枚以上残るなら、AI に聞く");
  assert.equal(ask(3), "declined", "できなければ、聞かない");
}
console.log("battle-aiguard ok");
