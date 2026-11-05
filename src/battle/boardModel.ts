import { actionsFor, canRespond } from "./actions";
import { characteristics } from "./continuous";
import { attackersAt, canAttackPerm, isSick } from "./engine";
import { Game, GameCard, Perm, PlayerId, RuleBook } from "./state";

// 対戦の画面に出す内容。Game → 画面の内容の変換だけをする純粋な関数 (DOM を持たない。テストで確かめる)。画面は、これを描くだけ

export interface CardView {
  id: string;
  name: string;
  typeLine: string;
  manaCost?: string;
  power: number | null;
  toughness: number | null;
  loyalty?: number;
  damage: number;
  counters: Record<string, number>;
  tapped: boolean;
  attacking: boolean;
  blocking: boolean;
  token: boolean;
  prepared: boolean;
  sick: boolean; // 召喚酔い (このターンに出たクリーチャーで、速攻が無い)
  keywords: string[];
  playable: boolean; // 自分が、いま使える・起動できる (手札のカード / 戦場のパーマネント)
  image?: string;
}

export interface LandStack {
  name: string;
  cards: CardView[]; // 山の中は、戦場の順
  untapped: number;
  tapped: number;
}

export interface SideView {
  player: PlayerId;
  life: number;
  library: number;
  graveyard: number;
  graveyardTop?: CardView; // 墓地の一番上 (最後に置かれたもの)
  exile: number;
  handCount: number;
  hand: CardView[]; // 相手 (showHand が偽) は空。枚数は handCount
  lands: CardView[];
  landStacks: LandStack[]; // 同じ名前の土地を、1つの山にまとめたもの (最初に出た順)
  creatures: CardView[]; // 土地クリーチャーも
  others: CardView[]; // アーティファクト・エンチャント・プレインズウォーカーなど
}

export type ImageOf = (card: GameCard) => string | undefined;

const inHand = (c: GameCard, image?: string, playable = false): CardView => ({
  id: c.id,
  name: c.name,
  typeLine: c.typeLine,
  ...(c.manaCost !== undefined ? { manaCost: c.manaCost } : {}),
  power: c.power ?? null,
  toughness: c.toughness ?? null,
  damage: 0,
  counters: {},
  tapped: false,
  attacking: false,
  blocking: false,
  token: !!c.token,
  prepared: false,
  sick: false,
  keywords: [],
  playable,
  ...(image !== undefined ? { image } : {}),
});

function permView(g: Game, rules: RuleBook, p: Perm, imageOf: ImageOf, playable: boolean): CardView {
  const now = characteristics(g, p, rules); // 継続効果をふまえた、いまの型行・P/T・キーワード
  const image = imageOf(p.card);
  return {
    id: p.id,
    name: now.name,
    typeLine: now.typeLine,
    ...(p.card.manaCost !== undefined ? { manaCost: p.card.manaCost } : {}),
    power: now.power,
    toughness: now.toughness,
    ...(p.counters?.loyalty !== undefined ? { loyalty: p.counters.loyalty } : {}),
    damage: p.damage ?? 0,
    counters: { ...(p.counters ?? {}) },
    tapped: !!p.tapped,
    attacking: !!p.attacking,
    blocking: p.blocking !== undefined,
    token: !!p.card.token,
    prepared: p.prepared === true,
    sick: isSick(g, p, rules), // 召喚酔いの判定は、エンジンのもの
    keywords: now.keywords,
    playable,
    ...(image !== undefined ? { image } : {}),
  };
}

// 1人分の表示内容。列の分け方: 型行に Creature → creatures (土地クリーチャーも) / Land → lands / それ以外 → others。順番は戦場の順
export function sideView(g: Game, rules: RuleBook, player: PlayerId, imageOf: ImageOf, showHand: boolean, playable: ReadonlySet<string> = new Set()): SideView {
  const out: SideView = {
    player,
    life: g.life[player],
    library: g.libraries[player]?.length ?? 0,
    graveyard: g.graveyards[player]?.length ?? 0,
    exile: g.exile[player]?.length ?? 0,
    handCount: g.hands[player]?.length ?? 0,
    hand: showHand ? (g.hands[player] ?? []).map((c) => inHand(c, imageOf(c), playable.has(c.id))) : [],
    lands: [],
    landStacks: [],
    creatures: [],
    others: [],
  };
  const top = g.graveyards[player]?.[g.graveyards[player].length - 1];
  if (top) out.graveyardTop = inHand(top, imageOf(top));
  for (const p of g.battlefield) {
    if (p.controller !== player) continue;
    const v = permView(g, rules, p, imageOf, playable.has(p.id));
    if (/\bCreature\b/.test(v.typeLine)) out.creatures.push(v);
    else if (/\bLand\b/.test(v.typeLine)) {
      out.lands.push(v);
      let stack = out.landStacks.find((s) => s.name === v.name);
      if (!stack) out.landStacks.push((stack = { name: v.name, cards: [], untapped: 0, tapped: 0 }));
      stack.cards.push(v);
      if (v.tapped) stack.tapped++;
      else stack.untapped++;
    }
    else out.others.push(v);
  }
  return out;
}

export type PhaseId = "beginning" | "main1" | "combat" | "main2" | "ending";
export interface ManaView {
  total: number;
  colors: Partial<Record<"W" | "U" | "B" | "R" | "G" | "A", number>>; // A = 好きな色
  colorless: number;
}
export interface StackView {
  id: string;
  name: string;
  controller: "self" | "opp";
  ability: boolean;
}
// 自分が、いま選ぶ戦闘の指定 (攻撃クリーチャー / ブロック)。mine = 選べる自分のクリーチャー、attackers = ブロックできる攻撃クリーチャー
export type CombatChoice = { kind: "attack"; mine: string[] } | { kind: "block"; mine: string[]; attackers: string[] };

export interface BoardModel {
  choice?: CombatChoice;
  self: SideView;
  opp: SideView;
  manaSelf: ManaView;
  phase: PhaseId; // 公式の5フェイズ
  step: string; // そのフェイズの中の、いまのステップの名前 (小さく出す)
  combat: boolean;
  activeSide: "self" | "opp";
  turn: number;
  stack: StackView[];
  mulligan?: { count: number }; // マリガンの途中 (回数)
  idle: boolean; // 自分に優先権があるが、いま何もできない (土地を出す・唱える・能力を使う、が無い)。「使えるものがあるときだけ止まる」のとき、画面の時間ゲージが進んで、自動で進む
  canNext: boolean; // 「次へ」を押せる (ゲームが続いている。相手が優先権を持っていても、押せば自動でパスする)
  nextLabel: string; // スタックに積まれているものがあれば「解決する」
  over?: { winner?: "self" | "opp" }; // 勝者がいなければ引き分け
  log: string[]; // 最後の 50 行
}

const PHASE_OF: Record<Game["step"], PhaseId> = { untap: "beginning", upkeep: "beginning", draw: "beginning", main1: "main1", combat: "combat", main2: "main2", end: "ending" };
const STEP_LABEL: Record<Game["step"], string> = { untap: "アンタップ", upkeep: "アップキープ", draw: "ドロー", main1: "メイン", combat: "戦闘", main2: "メイン", end: "終了" };
const COMBAT_LABEL: Record<NonNullable<Game["combatPhase"]>, string> = { beginning: "戦闘開始", attackers: "攻撃クリーチャー指定", blockers: "ブロック指定", firstStrike: "先制攻撃ダメージ", damage: "戦闘ダメージ", end: "戦闘終了" };
const LOG_LINES = 50;

// viewer = 画面を見る人 (自分)。相手は、それ以外の最初の人 (2人戦)
export function boardModel(g: Game, rules: RuleBook, viewer: PlayerId, imageOf: ImageOf): BoardModel {
  const oppId = g.players.find((p) => p !== viewer) ?? viewer;
  const side = (p: PlayerId): "self" | "opp" => (p === viewer ? "self" : "opp");
  const can = new Set(actionsFor(g, rules, viewer).map((a) => (a.kind === "activate" ? a.perm : a.card)));
  let choice: CombatChoice | undefined;
  if (!g.over && !g.mulligan && g.step === "combat" && g.priority === viewer && !g.stack.length) { // スタックが空のとき (戦闘の最初の誘発が解決してから)
    if (g.combatPhase === "attackers" && !g.attackersDeclared && g.active === viewer) {
      const mine = g.battlefield.filter((p) => p.controller === viewer && canAttackPerm(g, p, rules)).map((p) => p.id);
      if (mine.length) choice = { kind: "attack", mine };
    } else if (g.combatPhase === "blockers" && g.active !== viewer && !(g.blockersDeclared ?? []).includes(viewer)) {
      const attackers = attackersAt(g, viewer).map((p) => p.id);
      const mine = g.battlefield.filter((p) => p.controller === viewer && !p.tapped && /\bCreature\b/.test(characteristics(g, p, rules).typeLine)).map((p) => p.id);
      if (attackers.length && mine.length) choice = { kind: "block", mine, attackers };
    }
  }
  const pool = g.pool[viewer] ?? {};
  const colored = Object.values(pool).reduce((a, n) => a + (n ?? 0), 0);
  const out: BoardModel = {
    self: sideView(g, rules, viewer, imageOf, true, can),
    opp: sideView(g, rules, oppId, imageOf, false),
    manaSelf: { total: g.mana[viewer] ?? 0, colors: { ...pool }, colorless: Math.max(0, (g.mana[viewer] ?? 0) - colored) },
    phase: PHASE_OF[g.step],
    step: g.step === "combat" && g.combatPhase ? COMBAT_LABEL[g.combatPhase] : STEP_LABEL[g.step],
    combat: g.step === "combat",
    activeSide: side(g.active),
    turn: g.turn,
    ...(choice ? { choice } : {}),
    idle: !g.over && !g.mulligan && g.priority === viewer && !choice && !canRespond(g, rules, viewer), // 戦闘の指定を選ぶときは、自動で進めない
    canNext: !g.over && !g.mulligan,
    nextLabel: g.stack.length ? "解決する" : "次へ",
    stack: g.stack.map((s) => ({ id: s.id, name: s.card.name, controller: side(s.controller), ability: !!s.ability })),
    log: g.log.slice(-LOG_LINES),
  };
  if (g.mulligan) out.mulligan = { ...g.mulligan };
  if (g.over) out.over = g.over.winner !== undefined ? { winner: side(g.over.winner) } : {};
  return out;
}
