import { Label } from "../i18n";

// 動作 (コードで固定) と条件。ノードは、これらを組んで作る。id は言語に依らない。
export interface Choice {
  id: string;
  label: Label;
}
export interface ParamDef {
  id: string;
  label: Label;
  type: "number" | "choice";
  choices?: Choice[];
  default: string; // 選択のときは、choice の id
}
export interface Def {
  id: string;
  label: Label;
  cr: string;
  help: Label;
  params: ParamDef[];
  only?: string[]; // 使える種類 (無ければ、どれでも)
}

const L = (ja: string, en: string): Label => ({ ja, en });
const C = (id: string, ja: string, en: string): Choice => ({ id, label: { ja, en } });
const SELF = C("self", "このクリーチャー", "this creature");
const TARGET_CREATURE = C("target-creature", "対象のクリーチャー", "target creature");
const TARGET_PLAYER = C("target-player", "対象のプレイヤー", "target player");

export const ACTIONS: Def[] = [
  {
    id: "modify-pt",
    label: L("修整を与える", "Modify power/toughness"),
    cr: "613.4c",
    help: L("パワー・タフネスを変える (カウンターではない。期間が終わると戻る)", "Change power/toughness (not counters; reverts when the duration ends)"),
    params: [
      { id: "target", label: L("対象", "Target"), type: "choice", choices: [SELF, TARGET_CREATURE], default: "self" },
      { id: "power", label: L("パワー", "Power"), type: "number", default: "0" },
      { id: "toughness", label: L("タフネス", "Toughness"), type: "number", default: "0" },
      { id: "duration", label: L("期間", "Duration"), type: "choice", choices: [C("until-eot", "ターン終了時まで", "until end of turn"), C("while-applies", "このノードが適用される間", "while this node applies")], default: "until-eot" },
    ],
  },
  {
    id: "add-counter",
    label: L("カウンターを置く", "Put counters"),
    cr: "122.1",
    help: L("カウンター (残り続ける) を置く", "Put counters (they stay)"),
    params: [
      { id: "target", label: L("対象", "Target"), type: "choice", choices: [SELF, TARGET_CREATURE], default: "self" },
      { id: "kind", label: L("種類", "Kind"), type: "choice", choices: [C("plus1", "+1/+1", "+1/+1"), C("minus1", "-1/-1", "-1/-1"), C("loyalty", "忠誠", "loyalty"), C("other", "その他", "other")], default: "plus1" },
      { id: "amount", label: L("数", "Amount"), type: "number", default: "1" },
    ],
  },
  {
    id: "deal-damage",
    label: L("ダメージを与える", "Deal damage"),
    cr: "120.3",
    help: L("ダメージを与える", "Deal damage"),
    params: [
      { id: "target", label: L("対象", "Target"), type: "choice", choices: [SELF, TARGET_CREATURE, TARGET_PLAYER], default: "target-creature" },
      { id: "amount", label: L("量", "Amount"), type: "number", default: "1" },
    ],
  },
  { id: "draw", label: L("カードを引く", "Draw cards"), cr: "121.1", help: L("ライブラリーの一番上から引く", "Draw from the top of the library"), params: [{ id: "amount", label: L("数", "Amount"), type: "number", default: "1" }] },
  {
    id: "block-requirement",
    label: L("ブロックの条件を課す", "Set a blocking requirement"),
    cr: "509.1b",
    help: L("このクリーチャーをブロックできる条件 (威迫: 2体以上)", "A condition on blocking this creature (menace: two or more)"),
    only: ["static", "keyword"],
    params: [{ id: "min-blockers", label: L("最少のブロッカー数", "Minimum blockers"), type: "number", default: "2" }],
  },
];

export const CONDITIONS: Def[] = [
  {
    id: "controls-power-at-least",
    label: L("パワーがN以上のクリーチャーをコントロールしている", "You control a creature with power N or greater"),
    cr: "109.4",
    help: L("自分のコントロールするクリーチャーに、パワーが N 以上のものがある", "You control a creature whose power is at least N"),
    params: [{ id: "n", label: L("N", "N"), type: "number", default: "4" }],
  },
  { id: "my-turn", label: L("自分のターン", "It's your turn"), cr: "500.1", help: L("自分のターンである", "It is your turn"), params: [] },
];

export const actionOf = (id: string) => ACTIONS.find((a) => a.id === id);
export const conditionOf = (id: string) => CONDITIONS.find((c) => c.id === id);
