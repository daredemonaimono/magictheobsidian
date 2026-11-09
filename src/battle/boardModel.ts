import { Action, actionsFor, canRespond, manaOnly, withAllMana } from "./actions";
import { activatedAbilities } from "./continuous";
import { characteristics } from "./continuous";
import { attackersAt, canAttackPerm, canBlock, isSick } from "./engine";
import { abilityLabel } from "./abilityLabel";
import { Game, GameCard, Perm, PlayerId, RuleBook, StackItem } from "./state";

// 対戦の画面に出す内容。Game → 画面の内容の変換だけをする純粋な関数 (DOM を持たない。テストで確かめる)。画面は、これを描くだけ

export interface CardView {
  id: string;
  name: string;
  typeLine: string;
  manaCost?: string;
  colors?: string[]; // 色 (W U B R G): フレームの色
  power: number | null;
  toughness: number | null;
  powerMod?: "up" | "down"; // 戦場で、継続効果・カウンターなどで、もとのパワーより大きい (黄色) / 小さい (赤)
  toughnessMod?: "up" | "down";
  loyalty?: number;
  damage: number;
  counters: Record<string, number>;
  tapped: boolean;
  attacking: boolean;
  blocking: boolean;
  token: boolean;
  foil?: boolean; // フォイル (見た目だけ)
  typeNow?: string; // 継続効果で、型が変わっているとき、いまの型 (「Mountain」など。印を付ける)
  exiled?: boolean; // 追放して、期限までプレイしてよいカード (手札にあるあいだ、印を付ける)
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
  speed?: number; // 速度 (Start your engines!)。無ければ出さない
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
  ...(c.colors ? { colors: c.colors } : {}),
  power: c.power ?? null,
  toughness: c.toughness ?? null,
  damage: 0,
  counters: {},
  tapped: false,
  attacking: false,
  blocking: false,
  token: !!c.token,
  ...(c.foil ? { foil: true } : {}),
  ...(c.exilePlay ? { exiled: true } : {}),
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
    ...(now.typeLine !== p.card.typeLine ? { typeNow: (now.typeLine.split(/—|-/)[1] ?? now.typeLine).trim() || now.typeLine } : {}),
    ...(p.card.manaCost !== undefined ? { manaCost: p.card.manaCost } : {}),
    ...(p.card.colors ? { colors: p.card.colors } : {}),
    power: now.power,
    toughness: now.toughness,
    ...(p.card.power !== undefined && now.power !== p.card.power ? { powerMod: (now.power ?? 0) > p.card.power ? ("up" as const) : ("down" as const) } : {}),
    ...(p.card.toughness !== undefined && now.toughness !== p.card.toughness ? { toughnessMod: (now.toughness ?? 0) > p.card.toughness ? ("up" as const) : ("down" as const) } : {}),
    ...(p.counters?.loyalty !== undefined ? { loyalty: p.counters.loyalty } : {}),
    damage: p.damage ?? 0,
    counters: { ...(p.counters ?? {}) },
    tapped: !!p.tapped,
    attacking: !!p.attacking,
    blocking: p.blocking !== undefined,
    token: !!p.card.token,
    ...(p.card.foil ? { foil: true } : {}),
    prepared: p.prepared === true,
    sick: isSick(g, p, rules), // 召喚酔いの判定は、エンジンのもの
    keywords: now.keywords,
    playable,
    ...(image !== undefined ? { image } : {}),
  };
}

function loyaltyOf(s: StackItem): { loyalty?: number; loyaltyX?: boolean } {
  if (!s.ability) return {};
  return s.loyaltyX ? { loyaltyX: true } : s.loyalty !== undefined ? { loyalty: s.loyalty } : {};
}
// 1人分の表示内容。列の分け方: 型行に Creature → creatures (土地クリーチャーも) / Land → lands / それ以外 → others。順番は戦場の順
export function sideView(g: Game, rules: RuleBook, player: PlayerId, imageOf: ImageOf, showHand: boolean, playable: ReadonlySet<string> = new Set()): SideView {
  const out: SideView = {
    player,
    life: g.life[player],
    ...(g.speed?.[player] ? { speed: g.speed[player] } : {}),
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
  restricted?: { amount: number; color?: string; type?: string; notType?: string }[]; // 使い道に制限のあるマナ (「クリーチャー以外の呪文にしか使えない」など)
}
export interface StackView {
  id: string;
  name: string;
  controller: "self" | "opp";
  ability: boolean;
  typeLine?: string;
  loyalty?: number; // 忠誠度能力の、忠誠度コスト (+1 → 1、−2 → −2)
  loyaltyX?: boolean;
  modes?: number[]; // 選んだモード
  label?: string; // 能力のとき、どの能力か ("+1: トークンを作る" / "−2: 手札に戻す" / "誘発: 引く")
  image?: string; // カードの画像 (呪文・能力の発生源)
  group: string; // 同じ項目の印 (名前・能力かどうか・どの能力か・コントローラー・対象が同じ)。画面は、同じ印が並んだら、1 枚にまとめて ×N と出す (Prized Amalgam が 4 枚あると、誘発が 8 個、積まれるため)
}
// スタックの項目を、表示用にまとめる: **隣り合った**、同じ group のものだけを、1 つにして、個数 n を持たせる (A・A・B・A・A は、A×2・B・A×2。間に別のものがあれば、まとめない: 解決の順番が分かるように)
export function groupStack(stack: StackView[]): { s: StackView; n: number }[] {
  const out: { s: StackView; n: number }[] = [];
  for (const s of stack) {
    const last = out[out.length - 1];
    if (last && last.s.group === s.group) {
      last.s = s; // 位置は、いちばん上 (新しい) ものの
      last.n++;
    } else out.push({ s, n: 1 });
  }
  return out;
}

// 自分が、いま選ぶ戦闘の指定 (攻撃クリーチャー / ブロック)。mine = 選べる自分のクリーチャー、attackers = ブロックできる攻撃クリーチャー
export type AssignItem = { attacker: string; name: string; power: number; trample: boolean; blockers: { id: string; name: string; lethal: number }[]; defaults: Record<string, number> };
export type CombatChoice = { kind: "attack"; mine: string[] } | { kind: "block"; mine: string[]; attackers: string[] } | { kind: "assign"; mine: string[]; items: AssignItem[] }; // assign = 自分の攻撃クリーチャーが 2 体以上にブロックされたとき、ダメージの割り振り

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
  // 光らせる (操作できる) もの: 土地・マナ能力のマナを全部出せるとして、使える手札のカード・マナ以外の能力 (足りないぶんは、使うとき、自動でタップする) +
  // マナを出す能力 (土地のタップなど) は、光らせない: マナは、カードを使うとき、自動で払う
  const sim = withAllMana(g, rules, viewer);
  const isMana = (a: Action) => a.kind === "activate" && ((x) => !!x && manaOnly(x.body))(((perm) => (perm ? activatedAbilities(g, rules, perm)[a.index] : undefined))(g.battlefield.find((p) => p.id === a.perm)));
  // 土地を出すのは、本物の局面で調べる (マナを出す能力を使った仮の局面では、スタックに何か積まれて、出せなくなることがある)
  // 本物の局面でできるもの (自分自身をタップする能力を含む) と、マナを全部出せばできるもの (マナを出す能力そのものは、除く)
  const can = new Set([...actionsFor(sim, rules, viewer).filter((a) => !isMana(a) && a.kind !== "land"), ...actionsFor(g, rules, viewer).filter((a) => a.kind === "land" || !isMana(a))].map((a) => (a.kind === "activate" ? a.perm : a.card)));
  let choice: CombatChoice | undefined;
  if (!g.over && !g.mulligan && g.step === "combat" && g.priority === viewer && !g.stack.length) { // スタックが空のとき (戦闘の最初の誘発が解決してから)
    if (g.combatPhase === "attackers" && !g.attackersDeclared && g.active === viewer) {
      const mine = g.battlefield.filter((p) => p.controller === viewer && canAttackPerm(g, p, rules)).map((p) => p.id);
      if (mine.length) choice = { kind: "attack", mine };
    } else if (g.combatPhase === "blockers" && g.active !== viewer && !(g.blockersDeclared ?? []).includes(viewer)) {
      // 実際にブロックできる組み合わせがあるときだけ、選ばせる (飛行にブロッカーがいない・威嚇に1体しかいない、などは、選べないので、選択を出さない: 時間ゲージが進む)
      const blockers = g.battlefield.filter((p) => p.controller === viewer && !p.tapped && /\bCreature\b/.test(characteristics(g, p, rules).typeLine));
      const attackers: string[] = [];
      const mineSet = new Set<string>();
      for (const a of attackersAt(g, viewer)) {
        const cands = blockers.filter((b) => canBlock(g, b, a, rules));
        if (!cands.length || (characteristics(g, a, rules).keywords.includes("menace") && cands.length < 2)) continue;
        attackers.push(a.id);
        cands.forEach((b) => mineSet.add(b.id));
      }
      if (attackers.length && mineSet.size) choice = { kind: "block", mine: [...mineSet], attackers };
    }
  }
  if (!g.over && !g.mulligan && g.step === "combat" && g.combatPhase === "blockers" && g.active === viewer && g.priority === viewer && !g.stack.length && g.players.every((p) => p === viewer || (g.blockersDeclared ?? []).includes(p))) {
    const items: AssignItem[] = [];
    for (const a of g.battlefield) {
      if (a.controller !== viewer || !a.attacking || a.assign) continue;
      const bs = (a.blockedBy ?? []).map((id) => g.battlefield.find((x) => x.id === id && x.blocking === a.id)).filter((x): x is Perm => !!x);
      if (bs.length < 2) continue;
      const c = characteristics(g, a, rules);
      const trample = c.keywords.includes("trample");
      let rest = c.power ?? 0;
      const blockers = bs.map((b) => ({ id: b.id, name: b.card.name, lethal: c.keywords.includes("deathtouch") ? 1 : Math.max(0, (characteristics(g, b, rules).toughness ?? 0) - (b.damage ?? 0)) }));
      const defaults: Record<string, number> = {};
      blockers.forEach((b, i) => {
        const n = i === blockers.length - 1 && !trample ? rest : Math.min(rest, b.lethal);
        defaults[b.id] = n;
        rest -= n;
      });
      items.push({ attacker: a.id, name: a.card.name, power: c.power ?? 0, trample, blockers, defaults });
    }
    if (items.length) choice = { kind: "assign", mine: [], items };
  }
  const pool = g.pool[viewer] ?? {};
  // 「GWU のどれか」(A:GWU) は、画面では、好きな色 (★) にまとめる
  const shownPool = (p: Record<string, number>) => {
    const o: BoardModel["manaSelf"]["colors"] = {};
    for (const [k, n] of Object.entries(p)) {
      const key = (k.startsWith("A:") ? "A" : k) as "W" | "U" | "B" | "R" | "G" | "A";
      o[key] = (o[key] ?? 0) + n;
    }
    return o;
  };
  const colored = Object.values(pool).reduce((a, n) => a + (n ?? 0), 0);
  const out: BoardModel = {
    self: sideView(g, rules, viewer, imageOf, true, can),
    opp: sideView(g, rules, oppId, imageOf, false),
    manaSelf: { total: g.mana[viewer] ?? 0, colors: shownPool(pool), colorless: Math.max(0, (g.mana[viewer] ?? 0) - colored), ...((g.restrictedMana[viewer] ?? []).some((e) => e.amount > 0) ? { restricted: g.restrictedMana[viewer].filter((e) => e.amount > 0).map((e) => ({ ...e })) } : {}) },
    phase: PHASE_OF[g.step],
    step: g.step === "combat" && g.combatPhase ? COMBAT_LABEL[g.combatPhase] : STEP_LABEL[g.step],
    combat: g.step === "combat",
    activeSide: side(g.active),
    turn: g.turn,
    ...(choice ? { choice } : {}),
    idle: !g.over && !g.mulligan && g.priority === viewer && !choice && !canRespond(g, rules, viewer), // 戦闘の指定を選ぶときは、自動で進めない
    canNext: !g.over && !g.mulligan,
    nextLabel: g.stack.length ? "解決する" : "次へ",
    stack: g.stack.map((s) => ({ group: `${s.card.name}|${s.ability ? 1 : 0}|${abilityLabel(s) ?? ""}|${s.controller}|${Object.values(s.targets).join(",")}`, id: s.id, name: s.card.name, controller: side(s.controller), ability: !!s.ability, typeLine: s.card.typeLine, ...(abilityLabel(s) ? { label: abilityLabel(s)! } : {}), ...loyaltyOf(s), ...(s.cast.modes?.length ? { modes: [...s.cast.modes] } : {}), ...(imageOf(s.card) !== undefined ? { image: imageOf(s.card)! } : {}) })),
    log: g.log.slice(-LOG_LINES),
  };
  if (g.mulligan) out.mulligan = { ...g.mulligan };
  if (g.over) out.over = g.over.winner !== undefined ? { winner: side(g.over.winner) } : {};
  return out;
}
