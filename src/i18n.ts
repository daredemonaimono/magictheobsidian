// 言語 (English / 日本語)。内部のデータは、言語に依らない id で持ち、表示 (UI・md の書き出し) のときだけ、ラベルに直す。
export type Lang = "ja" | "en";
export type Label = Record<Lang, string>;

let cur: Lang = "en";
export const getLang = (): Lang => cur;
export const setLang = (l: Lang): void => void (cur = l);
export const pick = (l: Label): string => l[cur];
// 既定は、Obsidian の言語が日本語なら日本語、それ以外は English
export const defaultLang = (): Lang => (typeof window !== "undefined" && /^ja/i.test(window.localStorage.getItem("language") ?? "") ? "ja" : "en");
export const asLang = (v: unknown): Lang | undefined => (v === "ja" || v === "en" ? v : undefined);

const UI = {
  title: { ja: "ノードを作る", en: "Node editor" },
  openExisting: { ja: "既存のノードを開く…", en: "Open an existing node…" },
  newNode: { ja: "新規", en: "New" },
  name: { ja: "名前", en: "Name" },
  kind: { ja: "種類", en: "Kind" },
  timing: { ja: "タイミング", en: "Timing" },
  condition: { ja: "条件", en: "Condition" },
  conditionOpt: { ja: "条件 (任意)", en: "Condition (optional)" },
  none: { ja: "なし", en: "None" },
  steps: { ja: "手順", en: "Steps" },
  stepsHint: { ja: "手順 (上から順に行う)", en: "Steps (run top to bottom)" },
  addAction: { ja: "+ 動作を足す…", en: "+ Add an action…" },
  callNode: { ja: "+ 別のノードを呼ぶ…", en: "+ Call another node…" },
  save: { ja: "保存", en: "Save" },
  saved: { ja: "保存した: {0}", en: "Saved: {0}" },
  unreadable: { ja: "ノードとして読めない: {0} ({1})", en: "Cannot read as a node: {0} ({1})" },
  settingsGeneral: { ja: "一般", en: "General" },
  language: { ja: "言語", en: "Language" },
  languageDesc: { ja: "画面・ノードのノート (フロントマター・見出し・名前) の言語。読むときは、どちらの言語で書かれていても読める。", en: "Language of the UI and of node notes (frontmatter, headings, labels). Notes written in either language can still be read." },
  ribbon: { ja: "Magic the Obsidian: ノードを作る", en: "Magic the Obsidian: Node editor" },
  // 検証の問題
  wordCondition: { ja: "条件", en: "condition" },
  wordAction: { ja: "動作", en: "action" },
  badName: { ja: "名前が空か、使えない文字 (\\ / : * ? \" < > | [ ] # ^) を含む", en: "The name is empty or has a character that cannot be used (\\ / : * ? \" < > | [ ] # ^)" },
  badKind: { ja: "種類 \"{0}\" は、定義にない", en: "Kind \"{0}\" is not defined" },
  badTiming: { ja: "タイミング \"{0}\" は、{1}にない", en: "Timing \"{0}\" does not exist for {1}" },
  unknownDef: { ja: "{0} \"{1}\" は、定義にない", en: "Unknown {0} \"{1}\"" },
  onlyFor: { ja: "{0} \"{1}\" は、{2}でだけ使える", en: "{0} \"{1}\" can only be used in: {2}" },
  missingParam: { ja: "{0} \"{1}\": {2} が無い", en: "{0} \"{1}\": {2} is missing" },
  notInteger: { ja: "{0} \"{1}\": {2} は整数 ({3})", en: "{0} \"{1}\": {2} must be an integer ({3})" },
  notChoice: { ja: "{0} \"{1}\": {2} は {3} のどれか ({4})", en: "{0} \"{1}\": {2} must be one of {3} ({4})" },
  unknownParam: { ja: "{0} \"{1}\": {2} は、引数にない", en: "{0} \"{1}\": {2} is not a parameter" },
  noSteps: { ja: "手順が空", en: "No steps" },
  noNode: { ja: "ノード [[{0}]] が無い", en: "Node [[{0}]] does not exist" },
  cycle: { ja: "循環: {0}", en: "Cycle: {0}" },
  // md の書き出し (キーと見出し)
  mdKind: { ja: "種類", en: "kind" },
  mdTiming: { ja: "タイミング", en: "timing" },
  mdCondition: { ja: "条件", en: "Condition" },
  mdSteps: { ja: "手順", en: "Steps" },
  mdErrFront: { ja: "先頭の --- ... --- が読めない", en: "Cannot read the frontmatter (--- ... ---)" },
  mdErrType: { ja: "mtg: node ではない", en: "Not an \"mtg: node\" note" },
  mdErrTitle: { ja: "見出し (# 名前) が無い", en: "The heading (# name) is missing" },
} satisfies Record<string, Label>;

export type UiKey = keyof typeof UI;
export const t = (k: UiKey, ...a: (string | number)[]): string => UI[k][cur].replace(/\{(\d)\}/g, (_, i) => String(a[Number(i)] ?? ""));
// md を読むときは、どちらの言語のキー・見出しでも受ける
export const tAny = (k: UiKey): string[] => [UI[k].ja, UI[k].en];
