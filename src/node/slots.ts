import { Label } from "../i18n";

// ノードの「対象」と、選べるキーワード。どちらも試しの一覧 (ルールの範囲の文書ができたら、増やす)。id は、言語に依らない。
export interface Opt {
  id: string;
  cr: string;
  label: Label;
}
const O = (id: string, cr: string, ja: string, en: string): Opt => ({ id, cr, label: { ja, en } });

export const TARGETS: Opt[] = [
  O("self", "201.5", "このクリーチャー", "this creature"),
  O("all-creatures", "109.2", "すべてのクリーチャー", "all creatures"),
  O("target-creature", "115.1", "対象のクリーチャー", "target creature"),
  O("target-player", "115.1", "対象のプレイヤー", "target player"),
];

// キーワード。steps = そのキーワードが、動作として何をするか (定義)。ここに無いものは、まだ動作で書けない (手順は、空)
export interface KeywordOpt extends Opt {
  steps?: { id: string; args: Record<string, string> }[];
}
export const KEYWORDS: KeywordOpt[] = [
  O("flying", "702.9", "飛行", "Flying"),
  O("reach", "702.17", "到達", "Reach"),
  O("fear", "702.36", "畏怖", "Fear"),
  O("first-strike", "702.7", "先制攻撃", "First strike"),
  O("double-strike", "702.4", "二段攻撃", "Double strike"),
  O("deathtouch", "702.2", "接死", "Deathtouch"),
  O("haste", "702.10", "速攻", "Haste"),
  O("landwalk", "702.14", "土地渡り", "Landwalk"),
  O("lifelink", "702.15", "絆魂", "Lifelink"),
  O("protection", "702.16", "プロテクション", "Protection"),
  O("trample", "702.19", "トランプル", "Trample"),
  O("shroud", "702.18", "被覆", "Shroud"),
  O("vigilance", "702.20", "警戒", "Vigilance"),
  // 多相: 特性を定義する能力 (604.3)。すべての領域で働き、このオブジェクトは、すべてのクリーチャー・タイプになる
  { ...O("changeling", "702.73", "多相", "Changeling"), steps: [{ id: "all-creature-types", args: {} }] },
];

export const targetOf = (id: string) => TARGETS.find((x) => x.id === id);
export const keywordOf = (id: string) => KEYWORDS.find((x) => x.id === id);
