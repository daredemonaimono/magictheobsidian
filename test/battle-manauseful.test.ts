import assert from "node:assert";
import { actionsFor, manaUseful, uselessMana } from "../src/battle/actions";
import { boardModel } from "../src/battle/boardModel";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { GameCard, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
const call = (node: string, args: NodeCall["args"]): NodeCall => ({ node, args });
const rules: RuleBook = { get: (c) => (c === "Swamp" ? { card: c, abilities: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "B" })] }] as Ability[] } : c === "Island" ? { card: c, abilities: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "U" })] }] as Ability[] } : c === "Bear" ? { card: c, abilities: [] } : undefined) };
const mk = (id: string, typeLine: string, mv: number, extra: Partial<GameCard> = {}): GameCard => ({ id, name: id.replace(/\d+$/, ""), typeLine, mv, owner: "you", ...extra });
const make = (hand: GameCard[]) => {
  const g = createGame(["you", "opp"]);
  g.payManaCosts = true;
  g.step = "main1";
  g.hands["you"] = hand;
  g.libraries["you"] = [mk("L1", "Land", 0)];
  g.libraries["opp"] = [mk("O1", "Land", 0, { owner: "opp" })];
  g.battlefield.push({ id: "Island1", card: mk("Island1", "Basic Land — Island", 0), controller: "you" });
  return g;
};
const tap = { kind: "activate", perm: "Island1", index: 0 } as const;
const bear = (mv: number) => mk("Bear1", "Creature — Bear", mv, { manaCost: mv === 1 ? "{U}" : "{1}{U}", power: 1, toughness: 1 });

// 唱えられる呪文が無い (手札が空 / マナが足りない): マナを出しても消えるだけ → タップできない・光らない
for (const hand of [[], [bear(2)]]) {
  const g = make(hand);
  assert.equal(manaUseful(g, rules, "you"), false);
  assert.equal(uselessMana(g, rules, "you", tap), true);
  const m = boardModel(g, rules, "you", () => undefined);
  assert.equal(m.self.landStacks.flatMap((s) => s.cards).some((c) => c.playable), false, "光らない");
  const c = new BattleController(g, rules);
  assert.ok(c.activate("Island1", 0), "理由が返る");
  assert.equal(g.mana["you"], 0);
  assert.equal(g.battlefield[0].tapped, undefined);
}
// 唱えられる呪文がある: タップできる
{
  const g = make([bear(1)]);
  assert.equal(manaUseful(g, rules, "you"), true);
  assert.equal(uselessMana(g, rules, "you", tap), false);
  assert.ok(boardModel(g, rules, "you", () => undefined).self.landStacks.flatMap((s) => s.cards).some((c) => c.playable));
  const c = new BattleController(g, rules);
  assert.equal(c.activate("Island1", 0), undefined);
  assert.equal(g.mana["you"], 1);
}
// 土地は、マナ能力ではないので、いつもの通り (土地を出す)
{
  const g = make([mk("Island2", "Basic Land — Island", 0)]);
  assert.ok(actionsFor(g, rules, "you").some((a) => a.kind === "land"));
}
// ---- 公式の順番: カードを選ぶと、足りないマナを自動でタップして払う。先にタップしたぶんは、そのまま使う
const withLands = (n: number, hand: GameCard[]) => {
  const g = make(hand);
  for (let i = 2; i <= n; i++) g.battlefield.push({ id: `Island${i}`, card: mk(`Island${i}`, "Basic Land — Island", 0), controller: "you" });
  if (n === 0) g.battlefield.length = 0;
  return g;
};
{
  const g = withLands(2, [bear(2)]); // 土地 2 枚 (どちらも、まだタップしていない)。MV2
  const c = new BattleController(g, rules);
  assert.equal(c.whyNot("Bear1"), undefined);
  assert.ok(boardModel(g, rules, "you", () => undefined).self.hand[0].playable, "光る");
  assert.equal(c.use("Bear1"), undefined);
  assert.equal(g.stack.length, 1, "唱えた");
  assert.equal(g.battlefield.filter((p) => p.tapped).length, 2, "足りないマナを、自動でタップした");
  assert.equal(g.mana["you"], 0, "マナは使い切った");
}
{
  const g = withLands(2, [bear(2)]);
  const c = new BattleController(g, rules);
  assert.equal(c.activate("Island1", 0), undefined); // 先に 1 枚タップ (これまで通り)
  assert.equal(c.use("Bear1"), undefined);
  assert.equal(g.stack.length, 1);
  assert.equal(g.battlefield.filter((p) => p.tapped).length, 2, "足りない 1 枚だけ、追加でタップした");
}
for (const n of [0, 1]) {
  const g = withLands(n, [bear(2)]); // 土地が無い / 出せるマナの合計が足りない
  const c = new BattleController(g, rules);
  assert.ok(c.whyNot("Bear1")?.includes("マナが足りません"), `土地 ${n} 枚: 理由が出る`);
  assert.equal(boardModel(g, rules, "you", () => undefined).self.hand[0].playable, false, "光らない");
  assert.ok(c.use("Bear1")?.includes("マナが足りません"));
  assert.equal(g.stack.length, 0);
  assert.equal(g.battlefield.some((p) => p.tapped), false, "失敗したら、何もタップしない");
}
// ---- 払うマナの選択: 種類の違う土地があり、全部は要らないときだけ、選ばせる。選んだ土地を、タップして払う
{
  const mkLand = (id: string, name: string) => ({ id, card: mk(id, `Basic Land — ${name}`, 0, { name }), controller: "you" });
  const make3 = () => {
    const g = make([bear(2)]);
    g.battlefield.length = 0;
    g.battlefield.push(mkLand("Island1", "Island"), mkLand("Island2", "Island"), mkLand("Swamp1", "Swamp"));
    return { g, c: new BattleController(g, rules) };
  };
  const a = { kind: "cast", card: "Bear1" } as const;
  {
    const { g, c } = make3();
    const src = c.payChoice(a, undefined, undefined);
    assert.deepEqual(src?.map((s) => `${s.name}:${s.label}`), ["Island:U", "Island:U", "Swamp:B"], "島 2 枚と沼 1 枚: 2 マナで足りるので、選べる");
    assert.equal(c.payableWith(a, undefined, undefined, ["Swamp1"]), false, "沼 1 枚では足りない");
    assert.equal(c.payableWith(a, undefined, undefined, ["Swamp1", "Island1"]), true);
    assert.equal(c.payableWith(a, undefined, undefined, ["Island1", "Island2"]), true);
    assert.equal(c.use("Bear1", undefined, undefined, ["Swamp1", "Island2"]), undefined);
    assert.deepEqual(g.battlefield.filter((p) => p.tapped).map((p) => p.id).sort(), ["Island2", "Swamp1"], "選んだ土地だけが、タップされた");
  }
  { // 選ばなければ、自動 (並んでいる順)
    const { g, c } = make3();
    assert.equal(c.use("Bear1"), undefined);
    assert.equal(g.battlefield.filter((p) => p.tapped).length, 2);
  }
  { // 島だけ (全部同じ種類) / 全部タップが要る: 選ばせない
    const g = make([bear(2)]);
    g.battlefield.length = 0;
    g.battlefield.push(mkLand("Island1", "Island"), mkLand("Island2", "Island"), mkLand("Island3", "Island"));
    assert.equal(new BattleController(g, rules).payChoice(a, undefined, undefined), undefined, "同じ種類");
    const h = make([bear(2)]);
    h.battlefield.length = 0;
    h.battlefield.push(mkLand("Island1", "Island"), mkLand("Swamp1", "Swamp"));
    assert.equal(new BattleController(h, rules).payChoice(a, undefined, undefined), undefined, "2 枚とも要る");
  }
}
console.log("manauseful ok");
