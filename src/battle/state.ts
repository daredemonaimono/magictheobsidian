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
export interface Game {
  players: PlayerId[];
  active: PlayerId;
  step: Step;
  priority: PlayerId | null;
  passes: PlayerId[]; // 連続でパスした人
  hands: Record<PlayerId, GameCard[]>;
  graveyards: Record<PlayerId, GameCard[]>;
  stack: StackItem[]; // 末尾が一番上
  log: string[];
}
export interface RuleBook {
  get(card: string): CardRule | undefined;
}

export function createGame(players: PlayerId[]): Game {
  const each = <T>(f: () => T) => Object.fromEntries(players.map((p) => [p, f()])) as Record<PlayerId, T>;
  return { players, active: players[0], step: "main1", priority: players[0], passes: [], hands: each<GameCard[]>(() => []), graveyards: each<GameCard[]>(() => []), stack: [], log: [] };
}

export const opponentsOf = (g: Game, p: PlayerId): PlayerId[] => g.players.filter((x) => x !== p);
