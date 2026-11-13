import { pick } from "../i18n";
import { ACTIONS, CONDITIONS, Def } from "./actions";
import { KINDS, kindOf } from "./kinds";
import { KEYWORDS, Opt, TARGETS } from "./slots";

// ノードの型と、書き出す文字 (fields) / 文字から組む (buildNode)。ノードは、カードのノート (card.ts) の中に、コードブロックで入る。
export interface Call {
  id: string;
  args: Record<string, string>;
}
export type Step = ({ node: false } & Call) | { node: true; id: string };
export interface NodeData {
  name: string;
  kind: string;
  timing: string;
  condition?: Call;
  target?: string; // 対象 (slots.ts の id)
  keyword?: string; // キーワード (slots.ts の id)
  source?: string; // この能力のもとになった、原文の 1 行 (英語。原文からの候補を作ったとき。作ったかどうかの判定に使う)
  steps: Step[];
}

// 手順・条件は、割り振られた関数の呼び出しで書く: modifyPT(power=2, toughness=2, duration=until-eot)。名前と引数は id (言語に依らない)
function fmtCall(c: Call, defs: Def[]): string {
  const d = defs.find((x) => x.id === c.id);
  return `${d?.fn ?? c.id}(${Object.entries(c.args).map(([k, v]) => `${k}=${v}`).join(", ")})`;
}
const optLabel = (list: Opt[], id: string) => { const o = list.find((x) => x.id === id); return o ? pick(o.label) : id; };

// 書き出す文字 (設定の言語)。toMd と、カードの中の能力 (card.ts) が使う
export interface Fields { source?: string; kind: string; timing: string; condition?: string; target?: string; keyword?: string; steps: string[] }
export function fields(n: NodeData): Fields {
  const k = kindOf(n.kind);
  const tm = k?.timings.find((x) => x.id === n.timing);
  return {
    ...(n.source ? { source: n.source } : {}),
    kind: k ? pick(k.label) : n.kind,
    timing: tm ? pick(tm.label) : n.timing,
    ...(n.condition ? { condition: fmtCall(n.condition, CONDITIONS) } : {}),
    ...(n.target ? { target: optLabel(TARGETS, n.target) } : {}),
    ...(n.keyword ? { keyword: optLabel(KEYWORDS, n.keyword) } : {}),
    steps: n.steps.map((s) => (s.node ? `[[${s.id}]]` : fmtCall(s, ACTIONS))),
  };
}

export const is = (x: { id: string; label: { ja: string; en: string } }, v: string) => x.id === v || x.label.ja === v || x.label.en === v;

function parseCall(text: string, defs: Def[]): Call {
  // 関数の形 name(k=v, …) と、読みやすい文の形 "名前: k=v, …" (古い書き方) のどちらも読む
  const f = /^([A-Za-z_]\w*)\((.*)\)$/.exec(text.trim());
  const i = text.indexOf(": ");
  const name = f ? f[1] : (i < 0 ? text : text.slice(0, i)).trim();
  const argText = f ? f[2] : i >= 0 ? text.slice(i + 2) : "";
  const def = defs.find((d) => d.fn === name || is(d, name));
  const args: Record<string, string> = {};
  if (argText.trim()) {
    for (const pair of argText.split(/,\s*(?=[^,=]+=)/)) {
      const e = pair.indexOf("=");
      if (e < 0) continue;
      const key = pair.slice(0, e).trim();
      const val = pair.slice(e + 1).trim();
      const p = def?.params.find((x) => is(x, key));
      const idOf = (x: string) => p!.choices!.find((c) => is(c, x))?.id ?? x;
      args[p?.id ?? key] = p?.type === "choice" ? idOf(val) : p?.type === "multi" ? val.split(/[|、]/).map((x) => idOf(x.trim())).join("|") : val;
    }
  }
  return { id: def?.id ?? name, args };
}

// 文字 (どちらの言語でも) から、ノードを組む
export function buildNode(name: string, raw: Partial<Fields>): NodeData {
  const kind = KINDS.find((k) => is(k, raw.kind ?? ""));
  const timing = kind?.timings.find((x) => is(x, raw.timing ?? ""));
  const opt = (list: Opt[], v?: string) => (v === undefined ? undefined : list.find((x) => is(x, v))?.id ?? v);
  const target = opt(TARGETS, raw.target);
  const keyword = opt(KEYWORDS, raw.keyword);
  const steps: Step[] = (raw.steps ?? []).map((line) => {
    const ref = /^\[\[(.+)\]\]$/.exec(line.trim());
    return ref ? { node: true, id: ref[1] } : { node: false, ...parseCall(line, ACTIONS) };
  });
  return {
    name,
    kind: kind?.id ?? raw.kind ?? "",
    timing: timing?.id ?? raw.timing ?? "",
    ...(raw.source ? { source: raw.source } : {}),
    ...(raw.condition ? { condition: parseCall(raw.condition.replace(/^`(.*)`$/, "$1"), CONDITIONS) } : {}),
    ...(target ? { target } : {}),
    ...(keyword ? { keyword } : {}),
    steps,
  };
}

export const defaults = (d: Def): Record<string, string> => Object.fromEntries(d.params.map((p) => [p.id, p.default]));
