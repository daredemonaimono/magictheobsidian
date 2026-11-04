import { characteristics } from "./continuous";
import { isSick } from "./engine";
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

const inHand = (c: GameCard, image?: string): CardView => ({
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
  ...(image !== undefined ? { image } : {}),
});

function permView(g: Game, rules: RuleBook, p: Perm, imageOf: ImageOf): CardView {
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
    ...(image !== undefined ? { image } : {}),
  };
}

// 1人分の表示内容。列の分け方: 型行に Creature → creatures (土地クリーチャーも) / Land → lands / それ以外 → others。順番は戦場の順
export function sideView(g: Game, rules: RuleBook, player: PlayerId, imageOf: ImageOf, showHand: boolean): SideView {
  const out: SideView = {
    player,
    life: g.life[player],
    library: g.libraries[player]?.length ?? 0,
    graveyard: g.graveyards[player]?.length ?? 0,
    exile: g.exile[player]?.length ?? 0,
    handCount: g.hands[player]?.length ?? 0,
    hand: showHand ? (g.hands[player] ?? []).map((c) => inHand(c, imageOf(c))) : [],
    lands: [],
    landStacks: [],
    creatures: [],
    others: [],
  };
  const top = g.graveyards[player]?.[g.graveyards[player].length - 1];
  if (top) out.graveyardTop = inHand(top, imageOf(top));
  for (const p of g.battlefield) {
    if (p.controller !== player) continue;
    const v = permView(g, rules, p, imageOf);
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
export interface BoardModel {
  self: SideView;
  opp: SideView;
  manaSelf: ManaView;
  phase: PhaseId; // 公式の5フェイズ
  step: string; // そのフェイズの中の、いまのステップの名前 (小さく出す)
  combat: boolean;
  activeSide: "self" | "opp";
  turn: number;
  stack: StackView[];
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
  const pool = g.pool[viewer] ?? {};
  const colored = Object.values(pool).reduce((a, n) => a + (n ?? 0), 0);
  const out: BoardModel = {
    self: sideView(g, rules, viewer, imageOf, true),
    opp: sideView(g, rules, oppId, imageOf, false),
    manaSelf: { total: g.mana[viewer] ?? 0, colors: { ...pool }, colorless: Math.max(0, (g.mana[viewer] ?? 0) - colored) },
    phase: PHASE_OF[g.step],
    step: g.step === "combat" && g.combatPhase ? COMBAT_LABEL[g.combatPhase] : STEP_LABEL[g.step],
    combat: g.step === "combat",
    activeSide: side(g.active),
    turn: g.turn,
    stack: g.stack.map((s) => ({ id: s.id, name: s.card.name, controller: side(s.controller), ability: !!s.ability })),
    log: g.log.slice(-LOG_LINES),
  };
  if (g.over) out.over = g.over.winner !== undefined ? { winner: side(g.over.winner) } : {};
  return out;
}
