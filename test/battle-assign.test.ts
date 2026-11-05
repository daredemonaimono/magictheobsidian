import assert from "node:assert";
import { RuleError, assignDamage, declareAttackers, declareBlockers, passPriority } from "../src/battle/engine";
import { boardModel } from "../src/battle/boardModel";
import { BattleController } from "../src/battle/play";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const card = (id: string, owner: string, power: number, toughness: number, keywords: string[] = []): GameCard => ({ id, name: id, typeLine: "Creature — Bear", mv: 1, owner, power, toughness, keywords });
const bear = (id: string, owner: string, power = 2, toughness = 2, keywords: string[] = []): Perm => ({ id, card: card(id, owner, power, toughness, keywords), controller: owner });
const book: RuleBook = { get: () => undefined };
const get = (g: Game, id: string) => g.battlefield.find((p) => p.id === id)!;
const next = (g: Game) => {
  for (let i = 0; i < g.players.length; i++) passPriority(g, g.priority!, book);
};
// A の 5/5 (キーワード付き可) を、B の 2/2 二体 (b1, b2) がブロックした、ブロック段階まで進める
const setup = (kw: string[] = []): Game => {
  const g = createGame(["A", "B"]);
  g.battlefield.push(bear("atk", "A", 5, 5, kw), bear("b1", "B"), bear("b2", "B"));
  g.active = "A";
  g.step = "main1";
  g.priority = "A";
  next(g);
  declareAttackers(g, "A", [{ id: "atk" }], book);
  next(g);
  declareBlockers(g, "B", [{ blocker: "b1", attacker: "atk" }, { blocker: "b2", attacker: "atk" }], book);
  return g;
};

// 既定 (割り振りなし): 宣言の順に致死ダメージ、残りは最後のブロッカー (b1 に 2、b2 に 3)
{
  const g = setup();
  next(g);
  assert.equal(get(g, "b1")?.damage ?? 0, 0, "b1 は死んで戦場に無い or 墓地");
  assert.ok(!g.battlefield.some((p) => p.id === "b1" || p.id === "b2"), "どちらも倒れる");
}

// 自由な割り振り: b1 に 5、b2 に 0 → b2 は生き残る
{
  const g = setup();
  assignDamage(g, "A", "atk", { b1: 5, b2: 0 }, book);
  next(g);
  assert.ok(!g.battlefield.some((p) => p.id === "b1"));
  assert.ok(g.battlefield.some((p) => p.id === "b2"), "割り振られなかった b2 は生き残る");
}

// 不正: 合計が合わない (トランプルなし) / ブロッカー以外 / 攻撃側以外 / 負の数 → RuleError で、何も変えない
{
  const g = setup();
  for (const bad of [{ b1: 2, b2: 2 }, { b1: 6, b2: 0 }, { b1: 5, zzz: 0 }, { b1: 6, b2: -1 }]) assert.throws(() => assignDamage(g, "A", "atk", bad, book), RuleError);
  assert.throws(() => assignDamage(g, "B", "atk", { b1: 5, b2: 0 }, book), RuleError, "攻撃側だけ");
  assert.equal(get(g, "atk").assign, undefined);
}

// トランプル: 合計が power 以下でよい。残りは防御プレイヤーへ
{
  const g = setup(["trample"]);
  assignDamage(g, "A", "atk", { b1: 2, b2: 2 }, book);
  next(g);
  assert.equal(g.life.B, 20 - 1, "残り 1 が通る");
}

// 戦闘が終わったら、割り振りは消える
{
  const g = setup();
  assignDamage(g, "A", "atk", { b1: 5, b2: 0 }, book);
  next(g);
  next(g);
  assert.ok(g.battlefield.every((p) => p.assign === undefined));
}
// 画面のモデル: 2 体にブロックされた自分の攻撃クリーチャーに、割り振りの選択 (既定は宣言の順の致死ダメージ)。割り振ると、選択は消える
{
  const g = setup();
  g.priority = "A";
  const m = boardModel(g, book, "A", () => undefined);
  assert.equal(m.choice?.kind, "assign");
  if (m.choice?.kind === "assign") {
    assert.deepEqual(m.choice.items[0].defaults, { b1: 2, b2: 3 });
    assert.equal(m.idle, false, "選ぶ間は、自動で進めない");
  }
  const c = new BattleController(g, book, "A", () => 0.5);
  assert.equal(c.assign({ atk: { b1: 5, b2: 0 } }), undefined);
  assert.equal(boardModel(g, book, "A", () => undefined).choice, undefined, "割り振ったら、選択は消える");
  assert.equal(c.assign({ atk: { b1: 1, b2: 1 } }) !== undefined, true, "不正な割り振りは、失敗を返す");
}
// 防御側の画面には、割り振りは出ない
{
  const g = setup();
  assert.equal(boardModel(g, book, "B", () => undefined).choice?.kind === "assign", false);
}
console.log("battle-assign ok");
