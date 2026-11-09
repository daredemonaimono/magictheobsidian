import assert from "node:assert";
import { buildSession } from "../src/battleStart";
import { CardData, DeckData } from "../src/battle/deckToGame";
import { BattleController } from "../src/battle/play";
import { replay } from "../src/battle/replay";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { RuleBook } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
const rules: RuleBook = { get: () => undefined };
const data = (name: string, extra: Partial<CardData> = {}) => ({ key: name, data: { name, typeLine: "Creature — Bear", cmc: 2, manaCost: "{1}{U}", colors: ["U"], power: "2", toughness: "2", ...extra } as CardData });
const deck = (): DeckData => ({ format: "standard", main: [{ ...data("Island", { typeLine: "Basic Land — Island", cmc: 0, manaCost: "" }), n: 24 }, { ...data("Bear"), n: 36 }] });
const inputs = { self: deck(), opp: deck(), rules };
const make = (seed: number, coin: boolean) => buildSession(inputs, "a", "b", seed, true, undefined, false, coin);

// コインを使わない (古い記録): いつも自分が先攻で、選択は無い
{
  const s = make(1, false);
  assert.equal(s.game.active, "you");
  assert.ok(!s.game.firstChoice);
}
// コイン: 勝つ種と負ける種がある。負けると、相手が先攻 (選択なし)。勝つと、選ぶまでマリガンできない
let win = -1, lose = -1;
for (let seed = 1; seed < 40 && (win < 0 || lose < 0); seed++) {
  const g = make(seed, true).game;
  if (g.firstChoice) win = win < 0 ? seed : win;
  else lose = lose < 0 ? seed : lose;
}
assert.ok(win > 0 && lose > 0, "どちらも出る");
{
  const g = make(lose, true).game;
  assert.equal(g.active, "opp");
  assert.equal(g.priority, "opp");
}
{
  const s = make(win, true);
  const ctl = new BattleController(s.game, s.rules, "you", s.rng!);
  assert.ok(ctl.mulligan(), "先攻後攻を選ぶまで、マリガンできない");
  assert.equal(ctl.keep(), "done");
  assert.ok(s.game.mulligan, "キープも、まだ受けない");
  assert.equal(ctl.chooseFirst(false), undefined);
  assert.equal(s.game.active, "opp", "後攻を選ぶと、相手が先攻");
  assert.ok(!s.game.firstChoice);
  assert.equal(ctl.mulligan(), undefined);
  assert.equal(ctl.keep(), "bottom");
  // リプレイ: 記録から、同じ局面を作り直せる
  ctl.bottom([s.game.hands["you"][0].id]);
  const again = make(win, true);
  const ctl2 = new BattleController(again.game, again.rules, "you", again.rng!);
  assert.equal(replay(ctl2, ctl.record), 0);
  assert.equal(again.game.active, "opp");
  assert.equal(again.game.hands["you"].length, 6);
}
{
  const s = make(win, true);
  const ctl = new BattleController(s.game, s.rules, "you", s.rng!);
  ctl.chooseFirst(true);
  assert.equal(s.game.active, "you");
}
console.log("battle-coin ok");
