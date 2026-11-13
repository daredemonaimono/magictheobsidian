import { Lang } from "../i18n";
import { CardData } from "./card";
import { KINDS } from "./kinds";
import { KEYWORDS } from "./slots";
import { NodeData } from "./md";

// 原文から、能力の候補を作る。原文 (Scryfall の oracle_text) は、能力ごとに改行されている: 1 行 = 1 候補。括弧の中の注釈は除く。
// 押すと、その原文の行が、そのまま、能力の名前になる (種類・タイミングは、推さない。人が選ぶ)。
// 例外: Scryfall の keywords にある語だけの行は、キーワード 1 つにつき 1 つの能力 (キーワード能力。定義があれば、手順も入る)。
export interface Candidate {
  line: string;
  alt: string[]; // 旧い名前の付け方で作った能力を見つけるための名前 (source を持たない、古い能力のため)
  node: NodeData;
}

const clean = (l: string) => l.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
const safeName = (l: string) => l.replace(/[\\/:*?"<>|[\]#^]/g, "").trim().slice(0, 40).trim();

// lang が ja で、日本語の原文があれば、行・名前は日本語 (種類の推測は、英語の原文から。行の数が合うときだけ、日本語を対応させる)
export function candidates(c: CardData, lang: Lang = "en"): Candidate[] {
  const kw = (c.keywords ?? []).map((k) => k.toLowerCase());
  const isKeyword = (p: string) => kw.some((k) => p.toLowerCase() === k || p.toLowerCase().startsWith(`${k} `));
  const used = new Set<string>();
  const unique = (n: string) => { let x = n || "ability", i = 2; while (used.has(x)) x = `${n} ${i++}`; used.add(x); return x; };
  const out: Candidate[] = [];
  const enLines = (c.text ?? "").split("\n");
  const jaAll = lang === "ja" && c.textJa ? c.textJa.split("\n") : [];
  const jaLines = jaAll.length === enLines.length ? jaAll : [];
  for (const [i, raw] of enLines.entries()) {
    const line = clean(raw);
    if (!line || line === "//") continue;
    const jaLine = jaLines[i] ? clean(jaLines[i]) : undefined;
    const parts = line.split(/,\s*/);
    if (kw.length && parts.every(isKeyword)) {
      // キーワードだけの行: キーワード 1 つにつき 1 能力 (飛行・到達は、キーワードの欄にも入る)
      const jaParts = jaLine?.split(/[、,]\s*/);
      for (const [j, p] of parts.entries()) {
        const shown = jaParts?.length === parts.length ? jaParts[j] : p;
        const known = KEYWORDS.find((k) => k.label.en.toLowerCase() === p.toLowerCase());
        const id = known?.id;
        out.push({ line: shown, alt: [safeName(shown), safeName(p)], node: { source: p, name: unique(safeName(known ? known.label[lang] : shown.charAt(0).toUpperCase() + shown.slice(1))), kind: "keyword", timing: "always", ...(id ? { keyword: id } : {}), steps: structuredClone(KEYWORDS.find((k) => k.id === id)?.steps?.map((x) => ({ node: false as const, ...x })) ?? []) } });
      }
      continue;
    }
    // 原文の行を、そのまま名前にする。種類・タイミングは、初期値 (人が選ぶ)
    out.push({ line: jaLine ?? line, alt: [safeName(jaLine ?? line), safeName(line)], node: { source: line, name: unique(jaLine ?? line), kind: KINDS[0].id, timing: KINDS[0].timings[0].id, steps: [] } });
  }
  return out;
}

// 選んだ候補の行を、1 つの能力にする (複数行で 1 つの能力: 選択肢つきの呪文・Saga など)。名前 = 行をつなげたもの、source = 行 (改行区切り)
export function mergeCandidates(cs: Candidate[]): NodeData {
  return { source: cs.map((x) => x.node.source).join("\n"), name: cs.map((x) => x.node.name).join(" / "), kind: KINDS[0].id, timing: KINDS[0].timings[0].id, steps: [] };
}

// この能力は、この原文の行から、できているか (source は、複数行を持てる)
export const hasSource = (a: NodeData, source: string | undefined): boolean => !!a.source && a.source.split("\n").includes(source ?? "");

// 画面に出す能力の名前。原文からできた能力で、名前を書き換えていなければ、いまの言語の原文の行 (キーワードなら、その名前。複数行なら、" / " でつなぐ) を出す
// (保存してある名前は、そのまま。言語を切り替えると、表示だけ切り替わる)。書き換えた名前は、そのまま出す
export function abilityLabel(c: CardData, a: NodeData, lang: Lang): string {
  if (!a.source) return a.name;
  const srcs = a.source.split("\n");
  const found = (l: Lang) => srcs.map((src) => candidates(c, l).find((x) => x.node.source === src));
  if (found(lang).some((x) => !x)) return a.name;
  const joined = (l: Lang) => found(l).map((x) => x!.node.name).join(" / ");
  const auto = [joined("ja"), joined("en"), ...(srcs.length === 1 ? (["ja", "en"] as const).flatMap((l) => found(l)[0]!.alt) : [])];
  return auto.includes(a.name) ? joined(lang) : a.name;
}
