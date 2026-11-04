import assert from "node:assert";
import { declareAttackers, passPriority, startGame } from "../src/battle/engine";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const card = (id: string, owner = "A"): GameCard => ({ id, name: id, typeLine: "Instant", mv: 1, owner });
const call = (node: string, args: NodeCall["args"]): NodeCall => ({ node, args });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const noRules = rulesOf({});
const next = (g: Game, book: RuleBook = noRules) => {
  for (let i = 0; i < g.players.length; i++) passPriority(g, g.priority!, book);
};
const lib = (g: Game, p: string, n: number) => (g.libraries[p] = Array.from({ length: n }, (_, i) => card(`${p}${i}`, p)));
const at = (g: Game, step: Game["step"], active = "A") => {
  g.active = active;
  g.step = step;
  g.priority = active;
};

// ---- 既定 (厳密でない): いままでどおり。ドローも、マナの消失も、手札上限も無い
{
  const g = createGame(["A", "B"]);
  lib(g, "A", 3);
  g.mana["A"] = 2;
  g.pool["A"] = { U: 1 };
  g.restrictedMana["A"] = [{ amount: 1, notType: "creature" }];
  for (let i = 0; i < 9; i++) g.hands["A"].push(card(`h${i}`));
  at(g, "upkeep");
  next(g); // → draw
  assert.equal(g.step, "draw");
  assert.equal(g.hands["A"].length, 9, "ドローしない");
  next(g);
  next(g);
  assert.equal(g.mana["A"], 2, "マナは消えない");
  at(g, "end");
  next(g);
  assert.equal(g.hands["A"].length, 9, "手札上限なし");
}

// ---- 厳密: ドロー・ステップに、アクティブ・プレイヤーが1枚引く。最初のターンは引かない
{
  const g = createGame(["A", "B"]);
  g.strictTurns = true;
  lib(g, "A", 3);
  lib(g, "B", 3);
  at(g, "upkeep");
  next(g);
  assert.equal(g.step, "draw");
  assert.equal(g.hands["A"].length, 0, "ゲームの最初のターンは、ドローしない");
  at(g, "end");
  next(g); // → B のターン (turn 2) の upkeep
  assert.equal(g.active, "B");
  assert.equal(g.turn, 2);
  next(g); // → draw
  assert.equal(g.step, "draw");
  assert.equal(g.hands["B"].length, 1, "2ターン目からは引く");
  assert.equal(g.hands["A"].length, 0);
  assert.equal(g.libraries["B"].length, 2);
}
{
  // ドローは、「ドロー・ステップの開始時」の誘発より先 (誘発は、引いたあとに積まれる)
  const g = createGame(["A", "B"]);
  g.strictTurns = true;
  g.turn = 3;
  lib(g, "A", 3);
  g.battlefield.push({ id: "T", card: card("T"), controller: "A" });
  const book = rulesOf({ T: [{ kind: "triggered", body: [call("when", { event: "step", step: "draw", who: "you" }), call("draw", { player: "you", count: 1 })] }] });
  at(g, "upkeep");
  next(g, book);
  assert.equal(g.hands["A"].length, 1, "ターンのドロー");
  assert.equal(g.stack.length, 1, "そのあとで、誘発が積まれる");
}
{
  // 空のライブラリーから引くターンは、負ける
  const g = createGame(["A", "B"]);
  g.strictTurns = true;
  g.turn = 2;
  lib(g, "B", 0);
  at(g, "upkeep", "B");
  next(g);
  assert.deepEqual(g.over, { winner: "A" });
}

// ---- 厳密: マナ・プールは、ステップの終わりに空になる (色つき・制限つきも)
{
  const g = createGame(["A", "B"]);
  g.strictTurns = true;
  g.turn = 2;
  g.mana["A"] = 3;
  g.pool["A"] = { U: 2 };
  g.mana["B"] = 1;
  g.restrictedMana["A"] = [{ amount: 1, notType: "creature" }];
  at(g, "main1");
  next(g);
  assert.equal(g.step, "combat");
  assert.equal(g.mana["A"], 0);
  assert.equal(g.mana["B"], 0, "全員のプールが空になる");
  assert.deepEqual(g.pool["A"], {});
  assert.deepEqual(g.restrictedMana["A"], []);
}
{
  // 戦闘の段階のあいだも、空になる
  const g = createGame(["A", "B"]);
  g.strictTurns = true;
  g.turn = 2;
  g.battlefield.push({ id: "atk", card: { ...card("atk"), typeLine: "Creature — Bear", power: 1, toughness: 1 }, controller: "A" });
  at(g, "main1");
  next(g);
  next(g); // 戦闘開始 → 攻撃クリーチャー指定
  declareAttackers(g, "A", [{ id: "atk" }], noRules);
  g.mana["A"] = 2;
  next(g); // 攻撃の段階 → ブロックの段階
  assert.equal(g.combatPhase, "blockers");
  assert.equal(g.mana["A"], 0);
}

// ---- 厳密: 終了ステップの終わりに、手札を 7 枚まで捨てる
{
  const g = createGame(["A", "B"]);
  g.strictTurns = true;
  g.turn = 2;
  for (let i = 0; i < 10; i++) g.hands["A"].push(card(`h${i}`));
  at(g, "end");
  next(g);
  assert.equal(g.hands["A"].length, 7);
  assert.deepEqual(g.graveyards["A"].map((c) => c.id), ["h7", "h8", "h9"], "既定は、後ろから");
  // 相手の手札は、そのターンのプレイヤーではないので、そのまま
  const g2 = createGame(["A", "B"]);
  g2.strictTurns = true;
  g2.turn = 2;
  for (let i = 0; i < 9; i++) g2.hands["B"].push(card(`b${i}`, "B"));
  at(g2, "end");
  next(g2);
  assert.equal(g2.hands["B"].length, 9);
  // 選ぶ (Decider)
  const g3 = createGame(["A", "B"]);
  g3.strictTurns = true;
  g3.turn = 2;
  for (let i = 0; i < 8; i++) g3.hands["A"].push(card(`h${i}`));
  g3.decide = { discard: (_g, p, n) => g3.hands[p].slice(0, n) };
  at(g3, "end");
  next(g3);
  assert.deepEqual(g3.graveyards["A"].map((c) => c.id), ["h0"]);
}

// ---- ゲームの開始: 手札を 7 枚引いて、厳密なターンになる
{
  const g = createGame(["A", "B"]);
  lib(g, "A", 20);
  lib(g, "B", 20);
  startGame(g, noRules, "B");
  assert.equal(g.strictTurns, true);
  assert.equal(g.active, "B");
  assert.equal(g.turn, 1);
  assert.equal(g.step, "upkeep");
  assert.equal(g.hands["A"].length, 7);
  assert.equal(g.hands["B"].length, 7);
  next(g); // → draw: 先手は引かない
  assert.equal(g.step, "draw");
  assert.equal(g.hands["B"].length, 7);
  // 1周: B (先手) → A のターンで、A は引く
  while (g.active === "B") next(g);
  while (g.step !== "draw") next(g);
  assert.equal(g.active, "A");
  assert.equal(g.hands["A"].length, 8);
  assert.equal(g.turn, 2);
}
{
  // 手札が足りない (7枚未満のライブラリー) なら、負ける
  const g = createGame(["A", "B"]);
  lib(g, "A", 3);
  lib(g, "B", 20);
  startGame(g, noRules);
  assert.deepEqual(g.over, { winner: "B" });
}
// ---- 厳密: 戦闘開始ステップと戦闘終了ステップが、攻撃指定・戦闘ダメージとは別に、優先権の回を持つ
{
  const g = createGame(["A", "B"]);
  g.strictTurns = true;
  g.turn = 2;
  g.battlefield.push({ id: "atk", card: { ...card("atk"), typeLine: "Creature — Bear", power: 1, toughness: 1 }, controller: "A" });
  at(g, "main1");
  next(g);
  assert.equal(g.step, "combat");
  assert.equal(g.combatPhase, "beginning", "戦闘開始ステップ");
  assert.throws(() => declareAttackers(g, "A", [{ id: "atk" }], noRules), /指定できない/, "戦闘開始ステップでは、まだ攻撃を指定できない");
  next(g);
  assert.equal(g.combatPhase, "attackers", "攻撃クリーチャー指定ステップ");
  declareAttackers(g, "A", [{ id: "atk" }], noRules);
  next(g);
  assert.equal(g.combatPhase, "blockers");
  next(g);
  assert.equal(g.combatPhase, "damage");
  assert.equal(g.life["B"], 19);
  next(g);
  assert.equal(g.step, "combat", "戦闘ダメージのあと、戦闘終了ステップの優先権の回がある");
  assert.equal(g.combatPhase, "end", "戦闘終了ステップ");
  assert.equal(g.battlefield[0].attacking, true, "戦闘終了ステップまで、攻撃状態は残る");
  next(g);
  assert.equal(g.step, "main2");
  assert.equal(g.battlefield[0].attacking, undefined);
}
{
  // 攻撃しない: 戦闘開始 → (攻撃指定を飛ばす) → 戦闘終了 → 戦闘後メイン
  const g = createGame(["A", "B"]);
  g.strictTurns = true;
  g.turn = 2;
  at(g, "main1");
  next(g);
  assert.equal(g.combatPhase, "beginning");
  next(g);
  assert.equal(g.combatPhase, "attackers");
  next(g); // 攻撃しない
  assert.equal(g.combatPhase, "end", "ブロックとダメージは飛ばして、戦闘終了ステップへ");
  next(g);
  assert.equal(g.step, "main2");
}
console.log("batch10 ok");

