import assert from "node:assert";
import { AI_SYSTEM, aiOptions, aiParse, aiTrivial } from "../src/battle/ai";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
const call = (node: string, args: NodeCall["args"]): NodeCall => ({ node, args });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const rules = rulesOf({ Island: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "U" })] }], Bear: [] });
const mk = (id: string, typeLine: string, mv: number, owner: string, extra: Partial<GameCard> = {}): GameCard => ({ id, name: id.replace(/\d+$/, ""), typeLine, mv, owner, ...extra });
const land = (i: number, owner = "opp") => mk(`Island${i}`, "Basic Land — Island", 0, owner);
const bear = (i: number, owner = "opp") => mk(`Bear${i}`, "Creature — Bear", 2, owner, { manaCost: "{1}{U}", power: 2, toughness: 2 });
const perm = (c: GameCard, extra: Partial<Perm> = {}): Perm => ({ id: c.id, card: c, controller: c.owner, ...extra });
// 人 (you) のメインフェイズ 1 から。AI (opp) の手札・戦場は、引数
const setup = (oppHand: GameCard[], oppField: Perm[] = []): { g: Game; c: BattleController } => {
  const g = createGame(["you", "opp"]);
  g.hands["opp"] = oppHand;
  g.battlefield.push(...oppField);
  g.libraries["you"] = Array.from({ length: 10 }, (_, i) => mk(`Lib${i}`, "Instant", 1, "you"));
  g.libraries["opp"] = Array.from({ length: 10 }, (_, i) => mk(`OLib${i}`, "Instant", 1, "opp"));
  g.payManaCosts = true;
  g.step = "main1";
  g.active = "you";
  g.priority = "you";
  return { g, c: new BattleController(g, rules, "you", () => 0.5, undefined, "opp") };
};
// 人が「次へ」を押し続けて、AI の判断が要るところまで (最大 n 回)
const untilWaiting = (c: BattleController, n = 30) => {
  for (let i = 0; i < n && !c.aiWaiting(); i++) c.next();
  return c.aiWaiting();
};

// ---- 返事の読み取り
assert.deepEqual(aiParse('はい\n```json\n{"choice": 2, "why": "x"}\n```'), { choice: 2, why: "x" });
assert.equal(aiParse("JSON なし"), undefined);
assert.equal(aiParse("[1,2]"), undefined);
assert.ok(AI_SYSTEM.includes("choice") && AI_SYSTEM.includes("attackers") && AI_SYSTEM.includes("blocks"));

// ---- 選択肢: 0 番はパス。土地を出す・唱える (土地のマナを全部出せば唱えられるもの)。マナを出すだけの能力は、選択肢にしない
{
  const { g } = setup([land(1), bear(1)], [perm(land(2)), perm(land(3))]);
  g.active = "opp";
  g.priority = "opp";
  const o = aiOptions(g, rules, "opp");
  assert.equal(o[0].action, undefined);
  assert.deepEqual(o.slice(1).map((x) => x.action?.kind), ["land", "cast"], "土地を出す・唱える (土地 2 枚で、MV2 が唱えられる)");
  assert.ok(o.every((x, i) => x.id === i));
  assert.equal(o.some((x) => x.label.includes("能力を使う")), false);
  assert.equal(aiTrivial([o[0]]), true);
}

// ---- 人の「次へ」で、AI のメインフェイズ 1 に来たら止まる。土地 → 唱える → (スタックに積んで、人に優先権)
{
  const { g, c } = setup([land(1), bear(1)], [perm(land(2)), perm(land(3))]);
  const w0 = untilWaiting(c);
  assert.equal(w0, "act", "AI のメインで、判断が要る");
  assert.equal(g.active, "opp");
  assert.equal(g.priority, "opp");
  const opts = c.aiOptions();
  const landOpt = opts.find((o) => o.action?.kind === "land")!;
  assert.equal(c.aiDo(landOpt), undefined);
  assert.ok(g.battlefield.some((p) => p.id === "Island1"), "土地が出た");
  assert.equal(c.aiWaiting(), "act", "まだ唱えられる");
  const cast = c.aiOptions().find((o) => o.action?.kind === "cast")!;
  assert.equal(c.aiDo(cast), undefined);
  assert.equal(g.stack.length, 1, "呪文がスタックに");
  assert.equal(g.priority, "you", "人に優先権 (応答できる)");
  assert.equal(g.battlefield.filter((p) => p.controller === "opp" && p.tapped).length >= 2, true, "必要なぶんだけ土地をタップした");
  assert.equal(c.aiWaiting(), undefined);
  c.next(); // 人がパスして、解決
  assert.ok(g.battlefield.some((p) => p.id === "Bear1"), "クリーチャーが出た");
  // 何もしない
}

// ---- 何もできない (手札が空・何も唱えられない) AI は、聞かずに、人の「次へ」だけで進む
{
  const { c, g } = setup([]);
  for (let i = 0; i < 20; i++) c.next();
  assert.equal(c.aiWaiting(), undefined);
  assert.ok(g.turn >= 2 || g.active === "opp", "判断が要らないので、止まらずに進む");
}

// ---- 攻撃: AI のターンの戦闘で、攻撃できるクリーチャーがいれば、攻撃の判断で止まる。指定すると攻撃して、人に優先権
{
  const bearPerm = perm(bear(1), { enteredTurn: 0 });
  const { g, c } = setup([], [bearPerm]);
  g.turn = 5;
  let w = untilWaiting(c, 60);
  assert.equal(w, "attack");
  assert.equal(g.step, "combat");
  assert.equal(c.aiAttack(["Bear1"]), undefined);
  assert.equal(g.battlefield.find((p) => p.id === "Bear1")?.attacking, true);
  assert.equal(g.priority, "you");
  assert.equal(c.aiWaiting(), undefined, "同じターンに、もう聞かない");
  // 不正な攻撃は、理由を返して、局面は変わらない
  const g2 = setup([], [perm(bear(2), { enteredTurn: 0 })]);
  g2.g.turn = 5;
  assert.equal(untilWaiting(g2.c, 60), "attack");
  assert.notEqual(g2.c.aiAttack(["Nothing"]), undefined);
  assert.ok(!g2.g.battlefield.some((p) => p.attacking));
}

// ---- ブロック: 人が攻撃したら、ブロックの段階で、AI の判断が要る
{
  const { g, c } = setup([], [perm(bear(1))]);
  g.battlefield.push(perm(bear(9, "you"), { enteredTurn: 0 }));
  g.turn = 3;
  for (let i = 0; i < 6 && g.combatPhase !== "attackers"; i++) c.next();
  assert.equal(g.combatPhase, "attackers");
  assert.equal(c.declareAttackers(["Bear9"]), undefined);
  let w: ReturnType<typeof c.aiWaiting>;
  for (let i = 0; i < 6 && !(w = c.aiWaiting()); i++) c.next();
  assert.equal(w, "block");
  assert.equal(c.aiBlock([{ blocker: "Bear1", attacker: "Bear9" }]), undefined);
  assert.equal(g.battlefield.find((p) => p.id === "Bear1")?.blocking, "Bear9");
  assert.equal(c.aiWaiting(), undefined);
}

// ---- API が使えない: 以降は雑魚 CPU の決まり (土地を出す・唱える)。ログに理由
{
  const { g, c } = setup([land(1), bear(1)], [perm(land(2)), perm(land(3))]);
  assert.equal(untilWaiting(c), "act");
  c.aiFail("act", "APIキー未設定");
  assert.ok(g.log.some((l) => l.includes("APIキー未設定")));
  assert.ok(g.battlefield.some((p) => p.id === "Island1"), "CPU の決まりで、土地を出した");
  assert.equal(c.aiActive, false);
  assert.equal(c.aiWaiting(), undefined);
}
// ---- 人への質問 (pending) が出ている間は、aiAuto は質問を消さない
{
  const { c } = setup([], []);
  (c as unknown as { pending: unknown }).pending = { request: { kind: "may", what: "x" } };
  c.aiAuto();
  assert.ok(c.pending, "質問が残る");
}
// ---- 空のブロックでも、エンジンが宣言済みを覚える (聞き直さない)
{
  const { g, c } = setup([], [perm(bear(1))]);
  g.battlefield.push(perm(bear(9, "you"), { enteredTurn: 0 }));
  g.turn = 3;
  for (let i = 0; i < 6 && g.combatPhase !== "attackers"; i++) c.next();
  c.declareAttackers(["Bear9"]);
  let w: ReturnType<typeof c.aiWaiting>;
  for (let i = 0; i < 6 && !(w = c.aiWaiting()); i++) c.next();
  assert.equal(w, "block");
  assert.equal(c.aiBlock([]), undefined);
  assert.ok((g.blockersDeclared ?? []).includes("opp"));
  assert.equal(c.aiWaiting(), undefined);
}
console.log("battle-opp-claude ok");
