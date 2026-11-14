import { Label } from "../i18n";
import { byCr } from "./cr";
import { Callable, ParamDef, choice, COLOR_CHOICES } from "./params";

// ノードの「対象」と、選べるキーワード。どちらも試しの一覧 (ルールの範囲の文書ができたら、増やす)。id は、言語に依らない。
export interface Opt {
  id: string;
  cr: string;
  label: Label;
  aka?: string[]; // 前の名前 (ノートに、前の名前で保存してあっても、読めるように)
}
const O = (id: string, cr: string, ja: string, en: string): Opt => ({ id, cr, label: { ja, en } });

// 対象。引数を持つもの (params) は、md に関数の形で書く。条件に合うものすべてに効く「各〜」は、対象を取らない (115.1: 対象を取るのは、「対象の」と書かれたときだけ)
export interface TargetDef extends Opt, Callable {
  targets?: boolean; // 対象を取る (115.1)。「もう1つの対象」には、これだけ使える
}
const P = (id: string, ja: string, en: string, choices: ReturnType<typeof choice>[], def: string): ParamDef => ({ id, label: { ja, en }, type: "choice", choices, default: def });
const TG = (id: string, cr: string, ja: string, en: string, params: ParamDef[] = [], fn?: string, targets = false): TargetDef => ({ id, cr, label: { ja, en }, params, ...(fn ? { fn } : {}), ...(targets ? { targets } : {}) });
// 絞り込みの引数: プレイヤー (戦場 = コントローラー / 墓地・手札など = 持ち主: 108.3・109.4)・領域 (400.1)・タイプ (複数選べる。インスタントかソーサリー、など)・色・点数で見たマナ・コストの上限 (マナ総量: 202.3)
const ZONES = [choice("battlefield", "戦場", "the battlefield"), choice("graveyard", "墓地", "a graveyard"), choice("hand", "手札", "a hand"), choice("library", "ライブラリー", "a library"), choice("exile", "追放領域", "exile"), choice("stack", "スタック", "the stack")];
const OBJ_TYPES = [choice("permanent", "パーマネント", "permanent"), choice("card", "カード (種類を問わない)", "card (any type)"), choice("creature", "クリーチャー", "creature"), choice("planeswalker", "プレインズウォーカー", "planeswalker"), choice("artifact", "アーティファクト", "artifact"), choice("enchantment", "エンチャント", "enchantment"), choice("land", "土地", "land"), choice("instant", "インスタント", "instant"), choice("sorcery", "ソーサリー", "sorcery")];
const selector = (controller: string, type: string): ParamDef[] => [
  P("controller", "プレイヤー", "Player", [choice("you", "あなた", "you"), choice("opponent", "相手", "an opponent"), choice("any", "問わない", "any player")], controller),
  { ...P("zone", "領域", "Zone", ZONES, "battlefield"), optional: true },
  { id: "type", label: { ja: "タイプ", en: "Type" }, type: "multi", choices: OBJ_TYPES, default: type },
  P("color", "色", "Color", COLOR_CHOICES, "any"),
  { id: "mana-value-max", label: { ja: "点数で見たマナ・コストの上限", en: "Maximum mana value" }, type: "number", optional: true, default: "" },
  { id: "power-max", label: { ja: "パワーの上限", en: "Maximum power" }, type: "number", optional: true, default: "" }, // 208.1: 「パワーが 3 以下」
];
export const TARGETS: TargetDef[] = [
  // これ自身: クリーチャーとは限らない (アーティファクト・プレインズウォーカー・呪文 …)。原文の「このクリーチャー」「~」(カード名) は、これ (201.5)
  { ...TG("self", "201.5", "これ自身", "this object"), aka: ["このクリーチャー", "this creature"] },
  TG("you", "109.5", "あなた (このカードのコントローラー)", "you (this object's controller)"),
  // 各〜 (対象を取らない) と、対象の〜 (対象を取る): 同じ絞り込み (プレイヤー・領域・タイプ・色・マナ総量) を使う。
  // すべてのクリーチャー = 各〜 (タイプ: クリーチャー / プレイヤー: 問わない)。「墓地の、マナ総量 3 以下のインスタントかソーサリーのカード 1 枚」= 対象の〜
  TG("each", "109.2", "条件に合う各オブジェクト (対象を取らない)", "each object matching the conditions (doesn't target)", selector("you", "creature"), "eachObject"),
  TG("target-object", "115.1", "条件に合う、対象の 1 つ (対象を取る)", "target object matching the conditions (targets)", selector("any", "permanent"), "targetObject", true),
  TG("target-creature", "115.1", "対象のクリーチャー", "target creature", [], undefined, true),
  TG("target-player", "115.1", "対象のプレイヤー", "target player", [], undefined, true),
  TG("target-spell", "115.1", "対象の呪文", "target spell", [], undefined, true),
  // この能力で生成したトークン (「それらは速攻を得る」の「それら」)。影響を受けるものは、効果が始まったときに決まる (611.2c)
  TG("created-tokens", "611.2c", "それら (この能力で生成したトークン)", "them (the tokens this ability created)"),
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

// CR の番号順 (作った順ではない)
TARGETS.sort(byCr);
KEYWORDS.sort(byCr);

export const targetOf = (id: string) => TARGETS.find((x) => x.id === id);
export const keywordOf = (id: string) => KEYWORDS.find((x) => x.id === id);
