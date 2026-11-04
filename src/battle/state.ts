import { CardRule, CastRecord } from "./node";

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
}
export interface StackItem {
  id: string;
  card: GameCard;
  controller: PlayerId;
  targets: Record<string, string>; // ノードの as → 対象の StackItem.id
  cast: CastRecord;
}
// 戦場のパーマネント
export interface Perm {
  id: string;
  card: GameCard;
  controller: PlayerId;
  tapped?: boolean;
  attacking?: boolean;
}
// 人の判断の差し替え口。無ければ決まった動きになる (shortcut: 判断の入力はまだ無い。入力の仕組みを作るときに置き換える)
export interface Decider {
  discard?(g: Game, p: PlayerId, n: number): GameCard[]; // 捨てるカード
  pay?(g: Game, p: PlayerId, n: number): boolean; // 「支払わないかぎり」を払うか
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
}
export interface RuleBook {
  get(card: string): CardRule | undefined;
}

export function createGame(players: PlayerId[]): Game {
  const each = <T>(f: () => T) => Object.fromEntries(players.map((p) => [p, f()])) as Record<PlayerId, T>;
  return { players, active: players[0], step: "main1", priority: players[0], passes: [], hands: each<GameCard[]>(() => []), libraries: each<GameCard[]>(() => []), graveyards: each<GameCard[]>(() => []), battlefield: [], mana: each(() => 0), stack: [], log: [] };
}

export const opponentsOf = (g: Game, p: PlayerId): PlayerId[] => g.players.filter((x) => x !== p);

// ノードの player 引数: "you" = 呪文のコントローラー、"opponents" = その全相手
export const playersOf = (g: Game, controller: PlayerId, who: string): PlayerId[] => (who === "opponents" ? opponentsOf(g, controller) : [controller]);
