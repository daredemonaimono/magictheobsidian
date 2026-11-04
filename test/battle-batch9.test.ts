import assert from "node:assert";
import { RuleError, activateAbility, castSpell, declareAttackers, declareBlockers, passPriority } from "../src/battle/engine";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { checkCall, resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const card = (id: string, typeLine = "Instant", owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const noRules = rulesOf({});
const bear = (id: string, owner: string, power = 2, toughness = 2, keywords: string[] = [], extra: Partial<Perm> = {}): Perm => ({ id, card: card(id, "Creature — Bear", owner, { power, toughness, keywords }), controller: owner, ...extra });
const get = (g: Game, id: string) => g.battlefield.find((p) => p.id === id);
// 全員がパスして、次へ進む (スタックが空のとき)
const next = (g: Game, book: RuleBook = noRules) => {
  for (let i = 0; i < g.players.length; i++) passPriority(g, g.priority!, book);
};
// メインフェイズ1 から、戦闘ステップ (攻撃クリーチャー指定) まで進める
const toCombat = (g: Game, book: RuleBook = noRules) => {
  g.active = "A";
  g.step = "main1";
  g.priority = "A";
  next(g, book);
  assert.equal(g.step, "combat");
};

// ---- 検査: 誘発のきっかけに「攻撃した」「ブロックした」
assert.equal(checkCall(call("when", { event: "attacks", self: true })), null);
assert.equal(checkCall(call("when", { event: "blocks", who: "you" })), null);

// ---- 攻撃しなければ、いままでどおり (戦闘ステップは、全員がパスして次へ)
{
  const g = createGame(["A", "B"]);
  toCombat(g);
  next(g);
  assert.equal(g.step, "main2", "攻撃クリーチャーがいなければ、戦闘ステップは飛ばす");
}

// ---- 攻撃: ブロックされなければ、プレイヤーにダメージ。攻撃クリーチャーはタップする
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(bear("atk", "A", 3, 3));
  toCombat(g);
  declareAttackers(g, "A", [{ id: "atk" }], noRules);
  assert.equal(get(g, "atk")!.tapped, true, "攻撃でタップする");
  assert.equal(get(g, "atk")!.attacking, true);
  next(g); // → ブロック
  next(g); // → 戦闘ダメージ
  assert.equal(g.life["B"], 17);
  next(g); // → 戦闘終了
  assert.equal(g.step, "main2");
  assert.equal(get(g, "atk")!.attacking, undefined, "戦闘が終わると、攻撃状態が消える");
}

// ---- 攻撃の制限
{
  const g = createGame(["A", "B"]);
  g.turn = 3;
  g.battlefield.push(bear("sick", "A", 2, 2, [], { enteredTurn: 3 }), bear("fast", "A", 2, 2, ["haste"], { enteredTurn: 3 }), bear("tapped", "A", 2, 2, [], { tapped: true }), bear("wall", "A", 0, 4, ["defender"]), bear("theirs", "B"));
  toCombat(g);
  assert.throws(() => declareAttackers(g, "A", [{ id: "sick" }], noRules), RuleError, "召喚酔い");
  assert.throws(() => declareAttackers(g, "A", [{ id: "tapped" }], noRules), RuleError, "タップしている");
  assert.throws(() => declareAttackers(g, "A", [{ id: "wall" }], noRules), RuleError, "防衛");
  assert.throws(() => declareAttackers(g, "A", [{ id: "theirs" }], noRules), RuleError, "相手のクリーチャー");
  assert.throws(() => declareAttackers(g, "B", [{ id: "theirs" }], noRules), RuleError, "アクティブ・プレイヤーだけ");
  assert.equal(get(g, "tapped")!.attacking, undefined, "失敗したら、何も変わらない");
  declareAttackers(g, "A", [{ id: "fast" }], noRules);
  assert.throws(() => declareAttackers(g, "A", [{ id: "fast" }], noRules), RuleError, "宣言は1回だけ");
}
{
  // 攻撃クリーチャーの指定は、戦闘ステップの攻撃クリーチャー指定のときだけ
  const g = createGame(["A", "B"]);
  g.battlefield.push(bear("atk", "A"));
  g.step = "main1";
  assert.throws(() => declareAttackers(g, "A", [{ id: "atk" }], noRules), RuleError);
}
{
  // 警戒: 攻撃してもタップしない
  const g = createGame(["A", "B"]);
  g.battlefield.push(bear("vig", "A", 2, 2, ["vigilance"]));
  toCombat(g);
  declareAttackers(g, "A", [{ id: "vig" }], noRules);
  assert.equal(get(g, "vig")!.tapped, undefined);
}

// ---- ブロック: 互いにダメージを与える
const fight = (atk: Perm, blockers: Perm[], assign?: string[]) => {
  const g = createGame(["A", "B"]);
  g.battlefield.push(atk, ...blockers);
  toCombat(g);
  declareAttackers(g, "A", [{ id: atk.id }], noRules);
  next(g);
  declareBlockers(g, "B", blockers.map((b) => ({ blocker: b.id, attacker: atk.id })), noRules);
  while (g.step === "combat") next(g);
  return g;
};
{
  const g = fight(bear("atk", "A", 3, 3), [bear("blk", "B", 2, 2)]);
  assert.equal(get(g, "blk"), undefined, "ブロッカーは致死ダメージで死ぬ");
  assert.equal(get(g, "atk")!.damage, 2, "攻撃クリーチャーにも、ブロッカーのダメージが載る");
  assert.equal(g.life["B"], 20, "ブロックされたら、プレイヤーにはダメージが行かない");
  assert.ok(g.graveyards["B"].some((c) => c.id === "blk"));
}
{
  const g = fight(bear("atk", "A", 2, 2), [bear("blk", "B", 2, 2)]);
  assert.equal(get(g, "atk"), undefined);
  assert.equal(get(g, "blk"), undefined, "相討ち");
}
{
  // ブロッカーが2体: ダメージは、宣言の順に致死ダメージを振り分ける (3 → 2 と 1)
  const g = fight(bear("atk", "A", 3, 3), [bear("b1", "B", 2, 2), bear("b2", "B", 2, 2)]);
  assert.equal(get(g, "b1"), undefined, "1体目に致死ダメージ");
  assert.equal(get(g, "b2")!.damage, 1, "残りを2体目に");
  assert.equal(get(g, "atk"), undefined, "ブロッカー2体から 4 ダメージ");
}

// ---- 先制攻撃・二段攻撃
{
  const g = fight(bear("atk", "A", 2, 2, ["firstStrike"]), [bear("blk", "B", 2, 2)]);
  assert.equal(get(g, "blk"), undefined, "先に倒す");
  assert.equal(get(g, "atk")!.damage ?? 0, 0, "倒されたブロッカーは、ダメージを与えない");
}
{
  const g = fight(bear("atk", "A", 2, 2), [bear("blk", "B", 2, 2, ["firstStrike"])]);
  assert.equal(get(g, "atk"), undefined, "先制攻撃のブロッカーが先に倒す");
  assert.equal(get(g, "blk")!.damage ?? 0, 0);
}
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(bear("dbl", "A", 2, 2, ["doubleStrike"]));
  toCombat(g);
  declareAttackers(g, "A", [{ id: "dbl" }], noRules);
  next(g);
  next(g); // 先制攻撃ダメージ
  assert.equal(g.life["B"], 18);
  next(g); // 通常のダメージ
  assert.equal(g.life["B"], 16, "二段攻撃は、2回ダメージを与える");
}

// ---- 接死・絆魂・トランプル
{
  const g = fight(bear("atk", "A", 1, 1, ["deathtouch"]), [bear("big", "B", 5, 5)]);
  assert.equal(get(g, "big"), undefined, "接死は、1点で倒す");
  assert.equal(get(g, "atk"), undefined);
}
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(bear("atk", "A", 3, 3, ["lifelink"]));
  toCombat(g);
  declareAttackers(g, "A", [{ id: "atk" }], noRules);
  while (g.step === "combat") next(g);
  assert.equal(g.life["A"], 23, "絆魂: ダメージの分だけライフを得る");
  assert.equal(g.life["B"], 17);
}
{
  const g = fight(bear("atk", "A", 5, 5, ["trample"]), [bear("blk", "B", 2, 2)]);
  assert.equal(g.life["B"], 17, "トランプル: 致死ダメージの残りが、プレイヤーに");
}
{
  const g = fight(bear("atk", "A", 3, 3, ["trample", "deathtouch"]), [bear("blk", "B", 2, 2)]);
  assert.equal(g.life["B"], 18, "接死 + トランプル: 1 点で致死なので、残り 2 点がプレイヤーに");
}
{
  // ブロッカーが取り除かれても、トランプルなら全部プレイヤーに。トランプルでなければ、ダメージなし
  for (const [kw, life] of [[["trample"], 17], [[], 20]] as const) {
    const g = createGame(["A", "B"]);
    g.battlefield.push(bear("atk", "A", 3, 3, [...kw]), bear("blk", "B", 2, 2));
    toCombat(g);
    declareAttackers(g, "A", [{ id: "atk" }], noRules);
    next(g);
    declareBlockers(g, "B", [{ blocker: "blk", attacker: "atk" }], noRules);
    g.battlefield = g.battlefield.filter((p) => p.id !== "blk");
    while (g.step === "combat") next(g);
    assert.equal(g.life["B"], life);
  }
}

// ---- ブロックの制限
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(bear("fly", "A", 2, 2, ["flying"]), bear("ground", "B"), bear("reach", "B", 1, 3, ["reach"]), bear("tapped", "B", 2, 2, [], { tapped: true }), bear("mine", "A"));
  toCombat(g);
  declareAttackers(g, "A", [{ id: "fly" }], noRules);
  next(g);
  assert.throws(() => declareBlockers(g, "B", [{ blocker: "ground", attacker: "fly" }], noRules), RuleError, "飛行は、飛行か到達でしかブロックできない");
  assert.throws(() => declareBlockers(g, "B", [{ blocker: "tapped", attacker: "fly" }], noRules), RuleError);
  assert.throws(() => declareBlockers(g, "A", [{ blocker: "mine", attacker: "fly" }], noRules), RuleError, "防御側だけ");
  assert.equal(get(g, "ground")!.blocking, undefined, "失敗したら、何も変わらない");
  declareBlockers(g, "B", [{ blocker: "reach", attacker: "fly" }], noRules);
  assert.throws(() => declareBlockers(g, "B", [{ blocker: "ground", attacker: "fly" }], noRules), RuleError, "宣言は1回だけ");
}
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(bear("men", "A", 2, 2, ["menace"]), bear("b1", "B"), bear("b2", "B"));
  toCombat(g);
  declareAttackers(g, "A", [{ id: "men" }], noRules);
  next(g);
  assert.throws(() => declareBlockers(g, "B", [{ blocker: "b1", attacker: "men" }], noRules), RuleError, "威嚇: 2体以上でないとブロックできない");
  declareBlockers(g, "B", [{ blocker: "b1", attacker: "men" }, { blocker: "b2", attacker: "men" }], noRules);
}

// ---- プレインズウォーカーへの攻撃
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(bear("atk", "A", 3, 3), { id: "jace", card: card("jace", "Legendary Planeswalker — Jace", "B", { loyalty: 4 }), controller: "B", counters: { loyalty: 4 } });
  toCombat(g);
  declareAttackers(g, "A", [{ id: "atk", target: "jace" }], noRules);
  while (g.step === "combat") next(g);
  assert.equal(get(g, "jace")!.counters!.loyalty, 1);
  assert.equal(g.life["B"], 20, "プレイヤーにはダメージが行かない");
}

// ---- 攻撃・ブロックの誘発
{
  const g = createGame(["A", "B"]);
  g.libraries["A"] = [card("l1")];
  const book = rulesOf({ atk: [{ kind: "triggered", body: [call("when", { event: "attacks", self: true }), call("draw", { player: "you", count: 1 })] }] });
  g.battlefield.push(bear("atk", "A"));
  toCombat(g, book);
  declareAttackers(g, "A", [{ id: "atk" }], book);
  assert.equal(g.stack.length, 1, "攻撃したとき、誘発する");
  while (g.stack.length) passPriority(g, g.priority!, book);
  assert.equal(g.hands["A"].length, 1);
}

// ---- 戦闘のあと、ブロック状態も消える。ターン終了でダメージも消える
{
  const g = fight(bear("atk", "A", 5, 5), [bear("blk", "B", 2, 4)]);
  assert.equal(get(g, "atk")!.blocking, undefined);
  assert.equal(get(g, "atk")!.damage, 2);
  assert.equal(g.step, "main2");
}

// ---- 召喚酔い: {T} のコストの能力 (クリーチャー) も、出たばかりでは起動できない
{
  const g = createGame(["A", "B"]);
  g.turn = 2;
  g.step = "main1";
  g.mana["A"] = 0;
  g.battlefield.push(bear("elf", "A", 1, 1, [], { enteredTurn: 2 }));
  const book = rulesOf({ elf: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1 })] }] });
  assert.throws(() => activateAbility(g, "A", "elf", 0, {}, book), RuleError, "召喚酔い");
  g.turn = 3;
  activateAbility(g, "A", "elf", 0, {}, book);
  assert.equal(g.mana["A"], 1, "次のターンからは使える");
}

// ---- ライフが 0 になったら、戦闘中でもゲームが終わる
{
  const g = createGame(["A", "B"]);
  g.life["B"] = 3;
  g.battlefield.push(bear("atk", "A", 3, 3));
  toCombat(g);
  declareAttackers(g, "A", [{ id: "atk" }], noRules);
  while (g.step === "combat" && !g.over) next(g);
  assert.deepEqual(g.over, { winner: "A" });
}
console.log("batch9 ok");
