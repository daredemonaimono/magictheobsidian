import { untapsDuring } from "../continuous";
import { discardCards, drawCards, expireMayPlay, Game, PlayerId, RuleBook, untapPerm } from "../state";
import { HAND_LIMIT, RuleError, STEPS, live, nextPlayer, who } from "./shared";
import { flushEvents } from "./triggers";
import { modAmount } from "./restrict";
import { resolveTop } from "./stack";
import { advanceCombat, endCombat } from "./combat";

// ステップの進行・優先権・ゲームの開始

// マナ・プールを空にする (全員。色つき・制限つきも)
export function emptyPools(g: Game): void {
  for (const p of g.players) {
    g.mana[p] = 0;
    g.pool[p] = {};
    g.restrictedMana[p] = [];
  }
}

export function advanceStep(g: Game, rules: RuleBook): void {
  if (g.strictTurns) emptyPools(g); // ステップの終わりに、マナが消える
  if (g.step === "end") {
    expireMayPlay(g, "endOfTurn"); // 「このターン中プレイしてよい」は、クリンナップの前に切れる
    if (g.strictTurns && g.hands[g.active].length > HAND_LIMIT) discardCards(g, g.active, g.hands[g.active].length - HAND_LIMIT, true); // クリンナップ: 手札を 7 枚まで
    for (const p of g.battlefield) if (p.mods) p.mods = p.mods.filter((m) => m.until !== "endOfTurn"); // ターン終了時までの効果が消える
    for (const p of g.battlefield) {
      delete p.damage; // ダメージも消える
      delete p.deathtouched;
      delete p.regen; // 再生の盾も消える
    }
    // クリンナップ中に誘発したもの (捨てたときの誘発など) があれば、優先権が回る。解決したあと、もう一度クリンナップ (手札・ダメージ・ターン終了時までの効果を、もう一度)
    flushEvents(g, rules);
    if (g.stack.length) {
      g.priority = g.active;
      g.passes = [];
      return;
    }
    g.active = g.extraTurns?.shift() ?? nextPlayer(g, g.active); // 追加のターンがあれば、それが先
    g.turn++;
    g.landsPlayed = 0;
    g.spellsCast = 0;
    g.spellsBy = {};
    g.castTypes = {};
    g.drawn = {};
    g.gained = {};
    g.died = {};
    g.attacked = {};
    g.lostLife = {};
    g.discarded = {};
    g.activated = {};
    for (const p of g.battlefield) if (p.becomes) p.becomes = p.becomes.filter((b) => b.until !== "endOfTurn");
    for (const p of g.battlefield) delete p.loyaltyUsed; // 忠誠度能力は、1ターンに1回
    for (const p of g.battlefield) if (untapsDuring(g, p, g.active, rules)) untapPerm(g, p); // アンタップ・ステップ (優先権が無いので、ここで済ませてアップキープへ)。麻痺カウンターは、アンタップのかわりに取り除く
    g.step = "upkeep";
    g.log.push(`ターン ${g.turn}: ${who(g.active)}のターン`);
  } else g.step = STEPS[STEPS.indexOf(g.step) + 1];
  if (g.step === "end") expireMayPlay(g, "yourNextEnd"); // 「次の終了ステップまで」は、その終了ステップの開始時に切れる
  endCombat(g); // 戦闘ステップを出るとき、戦闘の状態を片づける (ふつうは、advanceCombat がすでに片づけている)
  if (g.step === "combat") {
    g.combatPhase = g.strictTurns ? "beginning" : "attackers"; // 厳密なターン: 戦闘開始ステップ (優先権の回) から。そうでなければ、攻撃クリーチャーを指定する段階から (指定が無ければ、そのまま次のステップへ進む)
    g.attackersDeclared = false;
    g.blockersDeclared = [];
  }
  if (g.strictTurns && g.step === "draw" && g.turn > 1) {
    drawCards(g, g.active, modAmount(g, rules, "draw", g.active, 1), rules);
    g.log.push(`${who(g.active)}がカードを引いた`);
  } // ターンのドロー (ゲームの最初のターンは引かない)。「ドロー・ステップの開始時」の誘発より先
  g.priority = g.active;
  g.events.push({ type: "step", step: g.step, player: g.active }); // 「ステップの開始時に」の誘発型能力
  flushEvents(g, rules);
}

// 優先権を持つ人がパスする。全員が連続でパスしたら、スタックが空なら次のステップへ、空でなければ一番上だけを解決する
export function passPriority(g: Game, p: PlayerId, rules: RuleBook): "passed" | "resolved" | "stepEnded" {
  live(g);
  if (g.priority !== p) throw new Error(`${p} は優先権を持っていない`);
  g.passes.push(p);
  if (g.passes.length < g.players.length) {
    g.priority = nextPlayer(g, p);
    return "passed";
  }
  g.passes = [];
  if (!g.stack.length) {
    if (g.step === "combat" && g.combatPhase && advanceCombat(g, rules)) return "stepEnded"; // 戦闘ステップの中の、次の段階へ
    advanceStep(g, rules);
    return "stepEnded";
  }
  resolveTop(g, rules);
  g.priority = g.active;
  return "resolved";
}

// ゲームを始める: 手札を 7 枚ずつ引き (ライブラリーは、呼び出し側が切ったもの。マリガンは未対応)、先手のターン 1 の維持ステップから、厳密なターンで進める。
// 手札が足りなければ、負ける。createGame したばかりのゲームに、1回だけ呼ぶ (2回呼ぶと、さらに 7 枚引く)。shortcut: 2人戦の、最初のターンのドローなし (3人以上では、先手も引く) は未対応
export function startGame(g: Game, rules: RuleBook, first: PlayerId = g.players[0]): void {
  live(g);
  if (!g.players.includes(first)) throw new RuleError(`先手が、プレイヤーにいない: ${first}`);
  g.strictTurns = true;
  g.turn = 1;
  g.active = first;
  g.step = "upkeep";
  g.priority = first;
  g.passes = [];
  for (const p of g.players) drawCards(g, p, 7);
  g.events.push({ type: "step", step: "upkeep", player: first });
  flushEvents(g, rules);
}
