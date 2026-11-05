import assert from "node:assert";
import { CPU_MAX_MULLIGANS, cpuAct, cpuBottom, cpuKeeps, cpuMulligan } from "../src/battle/cpu";
import { DeckData, buildMatch } from "../src/battle/deckToGame";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, RuleBook } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const rules = rulesOf({
  Island: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "U" })] }],
  Bear: [],
  Zap: [{ kind: "spell", body: [call("target", { zone: "battlefield", kind: "permanent", type: "creature" }, { as: "t" }), call("damage", { target: { ref: "t" }, amount: 2 })] }],
});
const mk = (id: string, typeLine: string, mv: number, extra: Partial<GameCard> = {}): GameCard => ({ id, name: id.replace(/\d+$/, ""), typeLine, mv, owner: "opp", ...extra });
const land = (i: number) => mk(`Island${i}`, "Basic Land — Island", 0);
const bear = (i: number, mv = 2) => mk(`Bear${i}`, "Creature — Bear", mv, { manaCost: mv === 2 ? "{1}{U}" : "{3}{U}", power: 2, toughness: 2 });

// ---- マリガンの決まり: 土地が 3 枚以上で、コストの低い呪文がある → キープ。ゆるめていく。上限で必ずキープ
{
  const keep = [land(1), land(2), land(3), bear(1), bear(2, 4), bear(3, 4), bear(4, 4)];
  assert.equal(cpuKeeps(keep, 0), true);
  assert.equal(cpuKeeps([land(1), bear(1), bear(2), bear(3), bear(4), bear(5), bear(6)], 0), false, "土地 1 枚");
  assert.equal(cpuKeeps([land(1), land(2), land(3), land(4), land(5), bear(1, 4), bear(2, 4)], 0), false, "コストの低い呪文が無い");
  assert.equal(cpuKeeps([land(1), land(2), bear(1), bear(2), bear(3), bear(4)], 1), false, "1 回目のあとも、土地 3 枚");
  assert.equal(cpuKeeps([land(1), land(2), bear(1), bear(2), bear(3), bear(4)], 2), true, "2 回目のあとは、土地 2 枚で、よい");
  assert.equal(cpuKeeps([bear(1, 4)], CPU_MAX_MULLIGANS), true, "上限では、必ずキープ");
}
// 底に置く: 土地が余っていれば土地、そうでなければ、重い呪文から
{
  const hand = [land(1), land(2), land(3), land(4), land(5), land(6), bear(1)];
  assert.deepEqual(cpuBottom(hand, 2), ["Island5", "Island6"], "4 枚を超えた土地");
  const hand2 = [land(1), land(2), bear(1, 2), bear(2, 4), bear(3, 4)];
  assert.deepEqual(cpuBottom(hand2, 1), ["Bear2"], "重い呪文");
  assert.equal(cpuBottom(hand2, 5).length, 5);
}
// cpuMulligan: 悪い手札は引き直し、枚数は (7 - 回数)。同じ乱数なら同じ結果。ライブラリーとの合計は変わらない
{
  const deck: DeckData = { format: "standard", main: [{ key: "Island", n: 24, data: { name: "Island", typeLine: "Basic Land — Island", cmc: 0, manaCost: "", colors: [] } }, { key: "Bear", n: 36, data: { name: "Bear", typeLine: "Creature — Bear", cmc: 2, manaCost: "{1}{U}", colors: ["U"], power: "2", toughness: "2" } }] };
  const seq = (seed: number) => {
    let x = seed;
    return () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296);
  };
  const run = (seed: number) => {
    const g = buildMatch(deck, deck, rules, seq(seed));
    const total = g.hands["opp"].length + g.libraries["opp"].length;
    const n = cpuMulligan(g, "opp", seq(seed + 100));
    assert.equal(g.hands["opp"].length, 7 - n);
    assert.equal(g.hands["opp"].length + g.libraries["opp"].length, total);
    assert.ok(n <= CPU_MAX_MULLIGANS);
    assert.ok(g.log.some((l) => l.startsWith("相手は")));
    return [n, g.hands["opp"].map((c) => c.id).join()];
  };
  assert.deepEqual(run(3), run(3), "同じ乱数なら、同じ結果");
  for (let s = 1; s < 30; s++) run(s);
}

// ---- cpuAct: 土地を出す → 続けて、唱える (土地・マナ能力は、必要な分だけタップ)
const turnOf = (extra: (g: Game) => void): Game => {
  const g = buildMatch({ format: "standard", main: [{ key: "Island", n: 20, data: { name: "Island", typeLine: "Basic Land — Island", cmc: 0, manaCost: "", colors: [] } }] }, { format: "standard", main: [{ key: "Island", n: 20, data: { name: "Island", typeLine: "Basic Land — Island", cmc: 0, manaCost: "", colors: [] } }] }, rules, () => 0.5);
  g.hands["opp"] = [];
  g.hands["you"] = [];
  g.active = "opp";
  g.step = "main1";
  g.priority = "opp";
  g.turn = 2;
  extra(g);
  return g;
};
{
  const g = turnOf((x) => {
    x.hands["opp"] = [land(1), bear(1)];
    x.battlefield.push({ id: "Island9", card: land(9), controller: "opp" });
  });
  assert.equal(cpuAct(g, rules, "opp"), "land");
  assert.equal(g.battlefield.filter((p) => p.controller === "opp").length, 2);
  assert.equal(cpuAct(g, rules, "opp"), "cast", "土地 2 枚で、{1}{U} を唱える");
  assert.equal(g.stack.length, 1);
  assert.ok(g.battlefield.filter((p) => p.controller === "opp").every((p) => p.tapped), "必要な分だけ、タップ");
  assert.equal(cpuAct(g, rules, "opp"), "pass", "スタックにあるうちは、何もしない");
  assert.ok(g.log.includes("相手が Island を出した") && g.log.includes("相手が Bear を唱えた"));
}
// マナが足りなければ、1つもタップしない。重い呪文より、唱えられる呪文
{
  const g = turnOf((x) => {
    x.hands["opp"] = [bear(1, 4), bear(2)];
    x.landsPlayed = 1;
    x.battlefield.push({ id: "Island8", card: land(8), controller: "opp" }, { id: "Island9", card: land(9), controller: "opp" });
  });
  assert.equal(cpuAct(g, rules, "opp"), "cast");
  assert.equal(g.stack[0].card.id, "Bear2", "{3}{U} は払えない。{1}{U} を唱える");
}
{
  const g = turnOf((x) => {
    x.hands["opp"] = [bear(1, 4)];
    x.landsPlayed = 1;
    x.battlefield.push({ id: "Island9", card: land(9), controller: "opp" });
  });
  assert.equal(cpuAct(g, rules, "opp"), "pass");
  assert.ok(!g.battlefield[0].tapped, "払えないのに、タップしない");
}
// 対象を取る呪文: 相手 (人) 側の対象を選ぶ。自分のものしか対象にできなければ、唱えない
{
  const zap = mk("Zap1", "Instant", 1, { manaCost: "{U}" });
  const g = turnOf((x) => {
    x.hands["opp"] = [zap];
    x.landsPlayed = 1;
    x.battlefield.push({ id: "Island9", card: land(9), controller: "opp" }, { id: "Mine", card: bear(7), controller: "opp" });
  });
  assert.equal(cpuAct(g, rules, "opp"), "pass", "自分のクリーチャーしか、いない");
  g.battlefield.push({ id: "Theirs", card: { ...bear(8), owner: "you" }, controller: "you" });
  assert.equal(cpuAct(g, rules, "opp"), "cast");
  assert.deepEqual(g.stack[0].targets, { t: "Theirs" });
}
// 自分のメインフェイズ以外・スタックが空でないときは、何もしない
{
  const g = turnOf((x) => {
    x.hands["opp"] = [land(1)];
    x.step = "upkeep";
  });
  assert.equal(cpuAct(g, rules, "opp"), "pass");
  g.step = "main1";
  g.active = "you";
  assert.equal(cpuAct(g, rules, "opp"), "pass");
}

// ---- 「次へ」との組み込み: 相手のターンのメインで CPU が動き、スタックの呪文に、自分が応答できる
{
  const g = turnOf((x) => {
    x.hands["opp"] = [land(1), bear(1)];
    x.battlefield.push({ id: "Island9", card: land(9), controller: "opp" });
    x.step = "draw";
    x.priority = "opp";
  });
  const c = new BattleController(g, rules, "you", () => 0.5, "opp");
  // 相手のドロー → メインへ
  g.priority = "you"; // 相手が先にパスした状態 (相手のステップで止まったときの形)
  g.passes = ["opp"];
  c.next();
  assert.deepEqual([g.step, g.active], ["main1", "opp"]);
  assert.equal(g.stack.length, 1, "CPU が土地を出して、呪文を唱えた");
  assert.equal(g.priority, "you", "自分に優先権: 応答できる");
  assert.ok(g.battlefield.some((p) => p.id === "Island1"));
  c.next(); // 自分がパス → 解決
  assert.equal(g.stack.length, 0);
  assert.ok(g.battlefield.some((p) => p.id === "Bear1" && p.controller === "opp"), "解決して、戦場へ");
  assert.equal(g.priority, "you");
  assert.equal(g.step, "main1");
  c.next(); // 次のステップ (戦闘は、CPU が攻撃しないので飛ばす) → 戦闘後メイン
  assert.equal(g.step, "main2");
}
// 相手が何もしない設定 (cpu 無し): これまでどおり
{
  const g = turnOf((x) => {
    x.hands["opp"] = [land(1)];
    x.step = "draw";
  });
  const c = new BattleController(g, rules, "you", () => 0.5);
  g.priority = "you";
  g.passes = ["opp"];
  c.next();
  assert.equal(g.step, "main1");
  assert.equal(g.battlefield.length, 0, "何もしない");
}
console.log("cpu ok");
