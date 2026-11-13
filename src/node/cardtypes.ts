import { Label } from "../i18n";

// カードタイプごとの、唱えられるタイミング。絶対条件 (ノードで変えない): カードタイプが決める。
// カードの取り込みで、カードタイプが自動で入る (まだ無い)。timing は、kinds.ts のタイミング id。
// 例外 (閃光 CR 702.36 など、ほかのルールが変える) は、盤面のルールを作るときに足す。
export interface CardType {
  id: string;
  cr: string;
  label: Label;
  castTiming: "anytime" | "sorcery-speed";
}
const C = (id: string, cr: string, ja: string, en: string, castTiming: CardType["castTiming"]): CardType => ({ id, cr, label: { ja, en }, castTiming });

export const CARD_TYPES: CardType[] = [
  C("instant", "304.1", "インスタント", "Instant", "anytime"), // 優先権があれば、いつでも (117.1a)
  C("sorcery", "307.1", "ソーサリー", "Sorcery", "sorcery-speed"), // 自分のメイン・フェイズで、スタックが空のとき (307.1)
  C("creature", "117.1a", "クリーチャー", "Creature", "sorcery-speed"),
  C("artifact", "117.1a", "アーティファクト", "Artifact", "sorcery-speed"),
  C("enchantment", "117.1a", "エンチャント", "Enchantment", "sorcery-speed"),
  C("planeswalker", "117.1a", "プレインズウォーカー", "Planeswalker", "sorcery-speed"),
];

export const cardTypeOf = (id: string) => CARD_TYPES.find((x) => x.id === id);
