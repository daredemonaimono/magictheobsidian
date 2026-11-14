import { Label } from "../i18n";
import { byCr } from "./cr";

// 能力の種類とタイミング。定義は、総合ルール (CR) に準じる。足すときは、CR の番号を付ける。id は、言語に依らない。
export interface Timing {
  id: string;
  cr: string;
  label: Label;
}
export interface Kind {
  id: string;
  cr: string;
  label: Label;
  color: string; // 画面の背景色 (Obsidian の色の名前: --color-<color>)。種類ごとに色を変える
  timings: Timing[];
  defaultTiming: string; // 新しい能力の、初期のタイミング (一覧は CR の番号順なので、先頭ではない)
}

const T = (id: string, cr: string, ja: string, en: string): Timing => ({ id, cr, label: { ja, en } });
const ALWAYS = T("always", "604.1", "戦場にいる間", "While on the battlefield");
// 代替コスト: 呪文を唱えるとき、マナ・コストを支払う代わりに、支払ってもよいコスト (118.9)。この能力の手順 = 支払うコスト (ライフ・追放など)
const ALT_COST = T("alternative-cost", "118.9", "唱えるとき、マナ・コストの代わりに支払ってもよい", "May be paid instead of the mana cost when casting");
// 置換効果: 出来事が起きる前に、別のものに置き換える (614.1a)。タイミング = 置き換える出来事 (誘発型の「攻撃したとき」と同じ並び)。手順 = 代わりに起きること
const REPLACE_DRAW = T("replace-draw", "614.11", "あなたがカードを1枚引くなら、代わりに", "If you would draw a card, instead");
const TRIGGERS: Timing[] = [
  T("enters", "603.6a", "戦場に出たとき", "When it enters the battlefield"),
  T("leaves", "603.6c", "戦場を離れたとき", "When it leaves the battlefield"),
  T("dies", "603.6c", "死亡したとき", "When it dies"),
  T("attacks", "508.1m", "攻撃したとき", "When it attacks"),
  T("blocks", "509.1i", "ブロックしたとき", "When it blocks"),
  T("becomes-blocked", "509.1i", "ブロックされたとき", "When it becomes blocked"),
  T("combat-damage", "510.2", "戦闘ダメージを与えたとき", "When it deals combat damage"),
  T("upkeep", "503.1a", "アップキープの開始時", "At the beginning of your upkeep"),
  T("draw-step", "504.1", "ドロー・ステップの開始時", "At the beginning of your draw step"),
  T("combat-begin", "507.1", "戦闘の開始時", "At the beginning of combat"),
  T("end-step", "513.1a", "終了ステップの開始時", "At the beginning of the end step"),
  T("cast", "601.2i", "呪文を唱えたとき", "When a spell is cast"),
];

export const KINDS: Kind[] = [
  { id: "static", cr: "604", label: { ja: "常在型", en: "Static" }, color: "blue", defaultTiming: "always", timings: [ALWAYS, ALT_COST, REPLACE_DRAW] },
  { id: "triggered", cr: "603", label: { ja: "誘発型", en: "Triggered" }, color: "orange", defaultTiming: "enters", timings: TRIGGERS },
  {
    id: "activated",
    cr: "602",
    label: { ja: "起動型", en: "Activated" },
    color: "green",
    defaultTiming: "anytime",
    timings: [T("anytime", "602.5d", "いつでも (優先権があるとき)", "Any time you have priority"), T("sorcery-speed", "602.5d", "ソーサリー・タイミングのみ", "Only as a sorcery"), T("loyalty", "606.3", "忠誠度能力 (自分のメイン・フェイズ、スタックが空、1ターンに1回)", "Loyalty ability (your main phase, empty stack, once per turn)")],
  },
  { id: "spell", cr: "113.3a", label: { ja: "呪文能力", en: "Spell" }, color: "purple", defaultTiming: "resolves", timings: [T("resolves", "608.2", "解決時", "On resolution")] },
  // キーワード能力: 常在型・誘発型のどちらにもなる (威迫は常在、機略は誘発)
  { id: "keyword", cr: "702", label: { ja: "キーワード能力", en: "Keyword" }, color: "yellow", defaultTiming: "always", timings: [{ ...ALWAYS, cr: "702.1" }, ...TRIGGERS] },
];

// どの一覧も、CR の番号順 (作った順ではない)
for (const k of KINDS) k.timings.sort(byCr);
KINDS.sort(byCr);

// 新しい能力の、初期の種類とタイミング
export const DEFAULT_KIND = "static";
export const defaultTiming = (kind: string): string => kindOf(kind)?.defaultTiming ?? "";

export const kindOf = (id: string): Kind | undefined => KINDS.find((k) => k.id === id);
export const timingOf = (kind: string, id: string): Timing | undefined => kindOf(kind)?.timings.find((t) => t.id === id);
