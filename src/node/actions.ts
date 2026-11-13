// 動作 (コードで固定) と条件。ノードは、これらを組んで作る。パラメーターの名前 (label) が、md の key になる。
export interface ParamDef {
  label: string;
  type: "number" | "choice";
  choices?: string[];
  default: string;
}
export interface Def {
  id: string;
  cr: string;
  help: string;
  params: ParamDef[];
  only?: string[]; // 使える種類 (無ければ、どれでも)
}

const SELF_OR_TARGET = ["このクリーチャー", "対象のクリーチャー", "対象のプレイヤー"];

export const ACTIONS: Def[] = [
  {
    id: "修整を与える",
    cr: "613.4c",
    help: "パワー・タフネスを変える (カウンターではない。期間が終わると戻る)",
    params: [
      { label: "対象", type: "choice", choices: SELF_OR_TARGET.slice(0, 2), default: "このクリーチャー" },
      { label: "パワー", type: "number", default: "0" },
      { label: "タフネス", type: "number", default: "0" },
      { label: "期間", type: "choice", choices: ["ターン終了時まで", "このノードが適用される間"], default: "ターン終了時まで" },
    ],
  },
  {
    id: "カウンターを置く",
    cr: "122.1",
    help: "カウンター (残り続ける) を置く",
    params: [
      { label: "対象", type: "choice", choices: SELF_OR_TARGET.slice(0, 2), default: "このクリーチャー" },
      { label: "種類", type: "choice", choices: ["+1/+1", "-1/-1", "忠誠", "その他"], default: "+1/+1" },
      { label: "数", type: "number", default: "1" },
    ],
  },
  {
    id: "ダメージを与える",
    cr: "120.3",
    help: "ダメージを与える",
    params: [
      { label: "対象", type: "choice", choices: SELF_OR_TARGET, default: "対象のクリーチャー" },
      { label: "量", type: "number", default: "1" },
    ],
  },
  { id: "カードを引く", cr: "121.1", help: "ライブラリーの一番上から引く", params: [{ label: "数", type: "number", default: "1" }] },
  {
    id: "ブロックの条件を課す",
    cr: "509.1b",
    help: "このクリーチャーをブロックできる条件 (威迫: 2体以上)",
    only: ["常在型能力"],
    params: [{ label: "最少のブロッカー数", type: "number", default: "2" }],
  },
];

export const CONDITIONS: Def[] = [
  {
    id: "パワーがN以上のクリーチャーをコントロールしている",
    cr: "109.4",
    help: "自分のコントロールするクリーチャーに、パワーが N 以上のものがある",
    params: [{ label: "N", type: "number", default: "4" }],
  },
  { id: "自分のターン", cr: "500.1", help: "自分のターンである", params: [] },
];

export const actionOf = (id: string) => ACTIONS.find((a) => a.id === id);
export const conditionOf = (id: string) => CONDITIONS.find((c) => c.id === id);
