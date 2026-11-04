import { CardRule, CastRecord, NodeCall } from "./node";

// ゲームの状態。プレイヤーは2人固定にせず、リストと「相手」という関係で持つ (実装は1対1だけ)
export type PlayerId = string;
export type Step = "untap" | "upkeep" | "draw" | "main1" | "combat" | "main2" | "end";

export interface GameCard {
  id: string;
  name: string;
  typeLine: string;
  mv: number;
  owner: PlayerId;
  flash?: boolean;
  power?: number; // クリーチャーのパワー・タフネス・キーワード (もとの値)
  toughness?: number;
  keywords?: string[];
}
export interface StackItem {
  id: string;
  card: GameCard;
  controller: PlayerId;
  targets: Record<string, string>; // ノードの as → 対象の StackItem.id
  cast: CastRecord;
  body?: NodeCall[]; // 起動型能力のとき、その効果 (呪文のときは、カードの呪文能力)
  ability?: boolean; // 起動型・誘発型能力 (解決しても、カードは墓地に行かない)
  source?: string; // 能力の発生源のパーマネントの id (self ノードが返す)
}
// 修整とキーワードの変更。持続「ターン終了時まで」はターンの終わりに消え、forever は残る
export interface Mod {
  power: number;
  toughness: number;
  keyword?: string;
  until: "endOfTurn" | "forever";
}
// 戦場のパーマネント
export interface Perm {
  id: string;
  card: GameCard;
  controller: PlayerId;
  tapped?: boolean;
  attacking?: boolean;
  mods?: Mod[];
  counters?: Record<string, number>; // "+1/+1" (パワー・タフネスに足される) / "stun" (麻痺: アンタップのかわりに1つ取り除く)
}

// エンジンが誘発型能力を探すためのイベント。ノードや処理が積み、エンジンが flush して、条件に合う誘発型能力をスタックに積む
export type GameEvent = { type: "cast"; player: PlayerId; card: GameCard } | { type: "enters"; perm: Perm } | { type: "leaves"; perm: Perm };
// 人の判断の差し替え口。無ければ決まった動きになる (shortcut: 判断の入力はまだ無い。入力の仕組みを作るときに置き換える)
export interface Decider {
  discard?(g: Game, p: PlayerId, n: number): GameCard[]; // 捨てるカード
  pay?(g: Game, p: PlayerId, n: number): boolean; // 「支払わないかぎり」を払うか
  choose?(g: Game, p: PlayerId, from: GameCard[], n: number): GameCard[]; // 選ぶカード (look / choose)
}
export interface Game {
  players: PlayerId[];
  active: PlayerId;
  step: Step;
  priority: PlayerId | null;
  passes: PlayerId[]; // 連続でパスした人
  hands: Record<PlayerId, GameCard[]>;
  libraries: Record<PlayerId, GameCard[]>; // 先頭が一番上
  graveyards: Record<PlayerId, GameCard[]>;
  battlefield: Perm[];
  mana: Record<PlayerId, number>; // 使えるマナの数 (色はまだ区別しない)
  decide?: Decider;
  stack: StackItem[]; // 末尾が一番上
  log: string[];
  serial: number; // 起動型・誘発型能力の id を作るための通し番号
  events: GameEvent[]; // まだ誘発型能力を探していないイベント
  landsPlayed: number; // このターンに出した土地の数 (1ターンに1枚)
}
export interface RuleBook {
  get(card: string): CardRule | undefined;
}

export function createGame(players: PlayerId[]): Game {
  const each = <T>(f: () => T) => Object.fromEntries(players.map((p) => [p, f()])) as Record<PlayerId, T>;
  return { players, active: players[0], step: "main1", priority: players[0], passes: [], hands: each<GameCard[]>(() => []), libraries: each<GameCard[]>(() => []), graveyards: each<GameCard[]>(() => []), battlefield: [], mana: each(() => 0), stack: [], log: [], serial: 0, events: [], landsPlayed: 0 };
}

export const opponentsOf = (g: Game, p: PlayerId): PlayerId[] => g.players.filter((x) => x !== p);

// ノードの player 引数: "you" = 呪文のコントローラー、"opponents" = その全相手
export const playersOf = (g: Game, controller: PlayerId, who: string): PlayerId[] => (who === "opponents" ? opponentsOf(g, controller) : [controller]);

// いまのパワー・タフネス (もとの値 + 修整)。パワーの無いカードは null
export function statsOf(p: Perm): { power: number; toughness: number } | null {
  if (p.card.power === undefined || p.card.toughness === undefined) return null;
  const mods = p.mods ?? [];
  const plus = p.counters?.["+1/+1"] ?? 0;
  return { power: p.card.power + plus + mods.reduce((a, m) => a + m.power, 0), toughness: p.card.toughness + plus + mods.reduce((a, m) => a + m.toughness, 0) };
}

// いまのキーワード (もとのもの + 得たもの)。表記ゆれ (Scryfall の "First strike" と、こちらの "firstStrike") をそろえて、小文字・空白なしで返す
const norm = (k: string) => k.toLowerCase().replace(/\s+/g, "");
export const keywordsOf = (p: Perm): string[] => [...new Set([...(p.card.keywords ?? []), ...(p.mods ?? []).flatMap((m) => (m.keyword ? [m.keyword] : []))].map(norm))];

// アンタップする。麻痺カウンターがあれば、アンタップのかわりに1つ取り除く (置換効果)
export function untapPerm(g: Game, p: Perm): void {
  if (!p.tapped) return;
  if ((p.counters?.stun ?? 0) > 0) {
    p.counters!.stun--;
    g.log.push(`${p.card.name}: 麻痺カウンターを1つ取り除いた (アンタップしない)`);
  } else p.tapped = false;
}
