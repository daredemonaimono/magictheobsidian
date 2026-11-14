import { Label } from "../i18n";
import { byCr } from "./cr";

// カードタイプごとの、唱えられるタイミング。絶対条件 (ノードで変えない): カードタイプが決める。
// カードの取り込みで、カードタイプが自動で入る (まだ無い)。timing は、kinds.ts のタイミング id。
// 例外 (閃光 CR 702.8 など、ほかのルールが変える) は、盤面のルールを作るときに足す。
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
  C("creature", "302.1", "クリーチャー", "Creature", "sorcery-speed"),
  C("artifact", "301.1", "アーティファクト", "Artifact", "sorcery-speed"),
  C("enchantment", "303.1", "エンチャント", "Enchantment", "sorcery-speed"),
  C("planeswalker", "306.1", "プレインズウォーカー", "Planeswalker", "sorcery-speed"),
];

// CR の番号順 (301 アーティファクト・302 クリーチャー・303 エンチャント・304 インスタント・306 プレインズウォーカー・307 ソーサリー)
CARD_TYPES.sort(byCr);

export const cardTypeOf = (id: string) => CARD_TYPES.find((x) => x.id === id);
