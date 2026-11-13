// ノードの「種類」と「タイミング」。定義は、総合ルール (CR) に準じる。足すときは、CR の番号を付ける。
export interface Timing {
  id: string;
  cr: string;
}
export interface Kind {
  id: string;
  cr: string;
  timings: Timing[];
}

export const KINDS: Kind[] = [
  {
    id: "誘発型能力",
    cr: "603",
    timings: [
      { id: "戦場に出たとき", cr: "603.6a" },
      { id: "戦場を離れたとき", cr: "603.6c" },
      { id: "死亡したとき", cr: "603.6c" },
      { id: "攻撃したとき", cr: "508.1m" },
      { id: "ブロックしたとき", cr: "509.1i" },
      { id: "ブロックされたとき", cr: "509.1i" },
      { id: "戦闘ダメージを与えたとき", cr: "510.2" },
      { id: "アップキープの開始時", cr: "503.1a" },
      { id: "戦闘の開始時", cr: "507.1" },
      { id: "終了ステップの開始時", cr: "513.1a" },
      { id: "呪文を唱えたとき", cr: "601.2i" },
    ],
  },
  { id: "常在型能力", cr: "604", timings: [{ id: "常に", cr: "604.1" }] },
  {
    id: "起動型能力",
    cr: "602",
    timings: [
      { id: "いつでも (優先権があるとき)", cr: "602.5d" },
      { id: "ソーサリー・タイミングのみ", cr: "602.5d" },
    ],
  },
  { id: "呪文能力", cr: "112.3a", timings: [{ id: "解決時", cr: "608.2" }] },
  {
    id: "置換効果",
    cr: "614",
    timings: [
      { id: "ダメージを受けるとき", cr: "614.1" },
      { id: "戦場に出るとき", cr: "614.1c" },
      { id: "カードを引くとき", cr: "614.11" },
    ],
  },
];

export const kindOf = (id: string): Kind | undefined => KINDS.find((k) => k.id === id);
export const timingOf = (kind: string, id: string): Timing | undefined => kindOf(kind)?.timings.find((t) => t.id === id);
