import { Label } from "../i18n";
import { KEYWORDS } from "./slots";

// 動作 (コードで固定) と条件。ノードは、これらを組んで作る。id は言語に依らない。
export interface Choice {
  id: string;
  label: Label;
}
export interface ParamDef {
  id: string;
  label: Label;
  type: "number" | "choice" | "multi"; // multi = choices から、いくつでも選ぶ (値は id を | でつなぐ)
  choices?: Choice[];
  default: string; // 選択のときは、choice の id
}
export interface Def {
  id: string;
  label: Label;
  fn: string; // 割り振られた関数の名前 (中身は、エンジンで作る)。md の手順は、この名前の呼び出しで書く
  cr: string;
  help: Label;
  params: ParamDef[];
  only?: string[]; // 使える種類 (無ければ、どれでも)
}

// キーワードの選択肢。multi で複数選ぶと、それぞれのキーワードが、別々に扱われる (条件と効果が、同じキーワードどうしで対応する)
const KW_CHOICES = KEYWORDS.map((k) => ({ id: k.id, label: k.label }));
const L = (ja: string, en: string): Label => ({ ja, en });
const C = (id: string, ja: string, en: string): Choice => ({ id, label: { ja, en } });

export const ACTIONS: Def[] = [
  {
    id: "modify-pt",
    fn: "modifyPT",
    label: L("修整を与える", "Modify power/toughness"),
    cr: "613.4c",
    help: L("パワー・タフネスを変える (カウンターではない。期間が終わると戻る)", "Change power/toughness (not counters; reverts when the duration ends)"),
    params: [
      { id: "power", label: L("パワー", "Power"), type: "number", default: "0" },
      { id: "toughness", label: L("タフネス", "Toughness"), type: "number", default: "0" },
      { id: "duration", label: L("期間", "Duration"), type: "choice", choices: [C("until-eot", "ターン終了時まで", "until end of turn"), C("while-applies", "このノードが適用される間", "while this node applies")], default: "until-eot" },
    ],
  },
  {
    id: "add-counter",
    fn: "addCounter",
    label: L("カウンターを置く", "Put counters"),
    cr: "122.1",
    help: L("カウンター (残り続ける) を置く", "Put counters (they stay)"),
    params: [
      { id: "kind", label: L("種類", "Kind"), type: "choice", choices: [C("plus1", "+1/+1", "+1/+1"), C("minus1", "-1/-1", "-1/-1"), C("loyalty", "忠誠", "loyalty"), C("other", "その他", "other")], default: "plus1" },
      { id: "amount", label: L("数", "Amount"), type: "number", default: "1" },
    ],
  },
  {
    id: "deal-damage",
    fn: "dealDamage",
    label: L("ダメージを与える", "Deal damage"),
    cr: "120.3",
    help: L("ダメージを与える", "Deal damage"),
    params: [
      { id: "amount", label: L("量", "Amount"), type: "number", default: "1" },
    ],
  },
  { id: "draw",
    fn: "draw", label: L("カードを引く", "Draw cards"), cr: "121.1", help: L("ライブラリーの一番上から引く", "Draw from the top of the library"), params: [{ id: "amount", label: L("数", "Amount"), type: "number", default: "1" }] },
  {
    id: "grant-keyword",
    fn: "grantKeyword",
    label: L("キーワード能力を与える", "Grant a keyword ability"),
    cr: "613.1f",
    help: L("対象にキーワード能力を与える", "Give the target a keyword ability"),
    params: [{ id: "keyword", label: L("キーワード", "Keyword"), type: "multi", choices: KW_CHOICES, default: KEYWORDS[0].id }],
  },
  {
    id: "all-creature-types",
    fn: "setAllCreatureTypes",
    label: L("すべてのクリーチャー・タイプを持つ", "Be every creature type"),
    cr: "702.73a",
    help: L("このオブジェクトは、すべてのクリーチャー・タイプである (特性を定義する能力。戦場以外の領域でも働く: 604.3)", "This object is every creature type (a characteristic-defining ability; works in every zone: 604.3)"),
    only: ["static", "keyword"],
    params: [],
  },
  {
    id: "block-requirement",
    fn: "blockRequirement",
    label: L("ブロックの条件を課す", "Set a blocking requirement"),
    cr: "509.1b",
    help: L("このクリーチャーをブロックできる条件 (威迫: 2体以上)", "A condition on blocking this creature (menace: two or more)"),
    only: ["static", "keyword"],
    params: [{ id: "min-blockers", label: L("最少のブロッカー数", "Minimum blockers"), type: "number", default: "2" }],
  },
  {
    id: "max-blockers",
    fn: "setMaxBlockers",
    label: L("ブロックの上限を課す", "Set a blocker limit"),
    cr: "509.1b",
    help: L("このクリーチャーをブロックできるクリーチャーの数の上限 (突進するサイ: 1体まで。「2体以上によってはブロックされない」)", "The most creatures that can block this creature (e.g. 'can't be blocked by more than one creature': 1)"),
    only: ["static", "keyword"],
    params: [{ id: "max-blockers", label: L("最大のブロッカー数", "Maximum blockers"), type: "number", default: "1" }],
  },
];

export const CONDITIONS: Def[] = [
  {
    id: "controls-power-at-least",
    fn: "controlsPowerAtLeast",
    label: L("パワーがN以上のクリーチャーをコントロールしている", "You control a creature with power N or greater"),
    cr: "109.4",
    help: L("自分のコントロールするクリーチャーに、パワーが N 以上のものがある", "You control a creature whose power is at least N"),
    params: [{ id: "n", label: L("N", "N"), type: "number", default: "4" }],
  },
  {
    id: "graveyard-has-keyword-creature",
    fn: "graveyardHasCreatureWithKeyword",
    label: L("墓地に、そのキーワードを持つクリーチャー・カードがある", "A creature card with the keyword is in a graveyard"),
    cr: "404.1",
    help: L("いずれかの墓地に、そのキーワード能力を持つクリーチャー・カードがある。複数選ぶと、キーワードごとに別々に判定する (効果の同じキーワードに対応)", "A creature card with that keyword is in any graveyard. With several, each is checked separately (paired with the same keyword in the effect)"),
    params: [{ id: "keyword", label: L("キーワード", "Keyword"), type: "multi", choices: KW_CHOICES, default: KEYWORDS[0].id }],
  },
  { id: "my-turn",
    fn: "isMyTurn", label: L("自分のターン", "It's your turn"), cr: "500.1", help: L("自分のターンである", "It is your turn"), params: [] },
];

export const actionOf = (id: string) => ACTIONS.find((a) => a.id === id);
export const conditionOf = (id: string) => CONDITIONS.find((c) => c.id === id);
