import assert from "node:assert";
import { readFileSync } from "node:fs";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { parseRule } from "../src/battle/ruleMd";
import { Game, GameCard, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
// ルールは、実際の Rules/ のノートをそのまま読む (Bant Hatebears A-1: Brainstorm・Ponder・Gitaxian Probe)
const VAULT = "/Users/daredemonai/Documents/Westeros/MagicTheObsidian/Rules";
const rule = (n: string) => parseRule(readFileSync(`${VAULT}/${n}.md`, "utf-8"));
const rules: RuleBook = { get: (c) => (["Brainstorm", "Ponder", "Gitaxian Probe"].includes(c) ? rule(c) : undefined) };
const mk = (id: string, name = id, owner = "you"): GameCard => ({ id, name, typeLine: id.startsWith("Spell") ? "Instant" : "Creature — X", mv: 0, owner });
const make = (spell: string): { g: Game; c: BattleController } => {
  const g = createGame(["you", "opp"]);
  g.payManaCosts = false;
  g.step = "main1";
  g.libraries["you"] = Array.from({ length: 10 }, (_, i) => mk(`L${i}`));
  g.libraries["opp"] = Array.from({ length: 5 }, (_, i) => mk(`O${i}`, `O${i}`, "opp"));
  g.hands["you"] = [{ ...mk("Spell1", spell), typeLine: "Instant" }, mk("H1"), mk("H2")];
  g.hands["opp"] = [mk("Zap", "Zap", "opp"), mk("Bear", "Bear", "opp")];
  return { g, c: new BattleController(g, rules) };
};
const top = (g: Game) => g.libraries["you"].slice(0, 4).map((c) => c.id);

// Brainstorm: 3 枚引く → 手札から 2 枚を選ぶ → ライブラリーの上に、選んだ順で置く
{
  const { g, c } = make("Brainstorm");
  assert.equal(c.use("Spell1"), undefined);
  c.next();
  let req = c.pending!.request;
  assert.ok(req.kind === "choose" && req.min === 2 && req.max === 2, "手札から 2 枚を選ぶ");
  assert.deepEqual(req.cards.map((x) => x.id), ["H1", "H2", "L0", "L1", "L2"], "引いた 3 枚も、選べる");
  c.answer(["H1", "L1"]);
  req = c.pending!.request;
  assert.ok(req.kind === "order" && req.to === "top", "置く順を聞く");
  c.answer(["L1", "H1"]);
  assert.equal(c.pending, undefined);
  assert.deepEqual(top(g), ["L1", "H1", "L3", "L4"], "選んだ順に、上に置いた");
  assert.deepEqual(g.hands["you"].map((x) => x.id).sort(), ["H2", "L0", "L2"], "手札は、残りの 3 枚");
  assert.equal(g.log.some((l) => l.includes("手札を見た")), false, "自分の手札を渡すだけのときは、ログに出さない");
  assert.equal(g.handLook, undefined);
}
// Ponder: 上の 3 枚を見て、好きな順に戻す → 切ってもよい (断る) → 1 枚引く
{
  const { g, c } = make("Ponder");
  c.use("Spell1");
  c.next();
  const req = c.pending!.request;
  assert.ok(req.kind === "order" && req.cards.map((x) => x.id).join() === "L0,L1,L2");
  c.answer(["L2", "L0", "L1"]);
  const may = c.pending!.request;
  assert.ok(may.kind === "may", "切ってもよい");
  c.answer(false);
  assert.equal(c.pending, undefined);
  assert.ok(g.hands["you"].some((x) => x.id === "L2"), "並べ替えた一番上を、引いた");
  assert.deepEqual(top(g).slice(0, 3), ["L0", "L1", "L3"]);
}
// Ponder: 切る → ライブラリーの順が変わる。同じ状態からは、同じ切り方 (リプレイで、同じ結果)
{
  const run = () => {
    const { g, c } = make("Ponder");
    c.use("Spell1");
    c.next();
    c.answer(["L0", "L1", "L2"]);
    c.answer(true);
    return g;
  };
  const a = run();
  const b = run();
  assert.deepEqual(a.libraries["you"].map((x) => x.id), b.libraries["you"].map((x) => x.id), "同じ状態から、同じ切り方");
  assert.equal(a.libraries["you"].length, 9);
  assert.notDeepEqual(a.libraries["you"].map((x) => x.id), ["L3", "L4", "L5", "L6", "L7", "L8", "L9", "L0", "L1"], "順が変わっている (残りの 9 枚が、元の順のままではない)");
  assert.ok(a.log.includes("自分のライブラリーを切った"));
}
// Gitaxian Probe: プレイヤーを対象にして、その手札を見る → 1 枚引く。相手の手札を前に出す
{
  const { g, c } = make("Gitaxian Probe");
  c.use("Spell1", { t: "opp" });
  c.next();
  assert.equal(c.pending, undefined);
  assert.deepEqual(g.handLook, { by: "you", of: "opp", ids: ["Zap", "Bear"], n: 1 });
  assert.ok(g.log.includes("相手の手札を見た: Zap、Bear"));
  assert.equal(g.hands["you"].some((x) => x.id === "L0"), true, "1 枚引いた");
}
console.log("a1 ok");
