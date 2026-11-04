import type { Game, RuleBook, StackItem } from "./state";

// 対戦の核: ノード (能力の部品) の型。NodeDef 1つが唯一の元データで、検証・実行・一覧はここから作る。
// カード専用のノードは作らない。ノードはそれ以上分けられないパーツだけ

export type Value = string | number | boolean;
export type Arg = Value | { ref: string }; // ref = 前のノードの as の名前
export interface NodeCall {
  node: string;
  as?: string;
  if?: string; // 条件。このノードは、その条件のときだけ実行する ("kicked" / 否定は "!kicked")
  args: Record<string, Arg>;
  line?: number; // md の何行目か (parseRule が付ける。検証エラーに使う。列挙されない)
}

// 能力は4分類のどれかに必ず収める
export type AbilityKind = "spell" | "activated" | "triggered" | "static";
export interface Ability {
  kind: AbilityKind;
  body: NodeCall[];
}
export interface CardRule {
  card: string;
  abilities: Ability[];
  unsupported?: string[]; // ノードで表せない部分 (md の「## 未対応」。文章のまま)
}

export type ParamDef = { type: "string" | "number" | "boolean" | "ref"; required?: boolean; choices?: string[]; min?: number; max?: number };

// ノードを実行するときに渡すもの。vars は、前のノードの as の名前 → 出力
export interface RunCtx {
  game: Game;
  rules: RuleBook; // 継続効果 (装備・オーラ・常在型能力) を見るために要る
  item: StackItem; // いま解決している (唱えている) 呪文
  vars: Record<string, Value>;
  call: NodeCall; // 実行中の呼び出し (対象のノードが、自分の as を知るのに使う)
  phase?: "cast" | "resolve"; // cast = 唱える・起動するときの検査 (対象は全部が合法でなければならない)。無ければ解決 (残った合法な対象にだけ効く)
}

export interface NodeDef {
  id: string;
  title: string; // 日本語名 (一覧・AI への指示の元)
  summary: string;
  params: Record<string, ParamDef>;
  outputs: Record<string, "id" | "number" | "boolean">; // 結果の受け渡し
  isTarget?: boolean; // 唱えるときに対象を選ぶノード
  declaration?: boolean; // コストなどの宣言のノード (エンジンが読む。条件 if= は付けられない)
  only?: AbilityKind[]; // 書ける能力の種類 (無ければどの能力にも書ける)
  run?: (ctx: RunCtx, args: Record<string, Value>) => Record<string, Value>; // 無ければ「未実装」
}

// 枠の8項目 (結果の受け渡しは outputs / 各対戦相手は opponentsOf で実装。残りは型だけ。使うときに実装する)
export type Duration = { until: "endOfTurn" | "whileAttached" | "forever" };
export interface CastRecord {
  kicked?: boolean;
  teamwork?: boolean;
  tap?: string[]; // 追加コストでタップするクリーチャー (チームワーク)
  modes?: number[];
  extraCosts?: string[];
}
export interface ReplacementHook {
  id: string;
  applies: (event: string) => boolean;
}
export interface LayerEffect {
  layer: 4 | 5 | 6 | 7;
  effect: string;
}
export interface ManaRestriction {
  onlyFor: string;
}
export interface Created {
  kind: "token" | "emblem";
  name: string;
}
