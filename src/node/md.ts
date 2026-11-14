import { pick } from "../i18n";
import { ACTIONS, CONDITIONS } from "./actions";
import { Callable } from "./params";
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
  targetArgs?: Record<string, string>; // 引数つきの対象 (「各〜」) の引数
  alsoTargets?: Call[]; // もう 1 つ以降の対象 (「target A and target B」の、B)。順に、対象 2・対象 3。対象を取るものだけ (115.1・115.3)
  keyword?: string; // キーワード (slots.ts の id)
  loyalty?: string; // 忠誠度能力のコスト (+1・0・-2。忠誠カウンターを、置く・取り除く: 606.4)。タイミング「忠誠度能力」(606.3) と組
  source?: string; // この能力のもとになった、原文の 1 行 (英語。原文からの候補を作ったとき。作ったかどうかの判定に使う)
  cost?: Call[]; // 起動型のコスト (コストの動作。{T}・マナ・ライフなど)。忠誠度のコストは、loyalty
  steps: Step[];
}

// 手順・条件は、割り振られた関数の呼び出しで書く: modifyPT(power=2, toughness=2, duration=until-eot)。名前と引数は id (言語に依らない)
function fmtCall(c: Call, defs: Callable[]): string {
  const d = defs.find((x) => x.id === c.id);
  return `${d?.fn ?? c.id}(${Object.entries(c.args).filter(([, v]) => v !== "").map(([k, v]) => `${k}=${v}`).join(", ")})`;
}
const optLabel = (list: Opt[], id: string) => { const o = list.find((x) => x.id === id); return o ? pick(o.label) : id; };

// 書き出す文字 (設定の言語)。toMd と、カードの中の能力 (card.ts) が使う
export interface Fields { source?: string; loyalty?: string; cost?: string[]; alsoTarget?: string[]; kind: string; timing: string; condition?: string; target?: string; keyword?: string; steps: string[] }
export function fields(n: NodeData, ids = false): Fields {
  const k = kindOf(n.kind);
  const tm = k?.timings.find((x) => x.id === n.timing);
  return {
    ...(n.source ? { source: n.source } : {}),
    ...(n.loyalty !== undefined ? { loyalty: n.loyalty } : {}),
    ...(n.cost?.length ? { cost: n.cost.map((c) => fmtCall(c, ACTIONS)) } : {}),
    kind: ids || !k ? n.kind : pick(k.label),
    timing: ids || !tm ? n.timing : pick(tm.label),
    ...(n.condition ? { condition: fmtCall(n.condition, CONDITIONS) } : {}),
    // 引数つきの対象 (「各〜」) は、関数の形 (eachObject(controller=you, …))。引数の無い対象は、ラベル
    ...(n.target ? { target: TARGETS.find((x) => x.id === n.target)?.params.length ? fmtCall({ id: n.target, args: n.targetArgs ?? {} }, TARGETS) : ids ? n.target : optLabel(TARGETS, n.target) } : {}),
    ...(n.alsoTargets?.length ? { alsoTarget: n.alsoTargets.map((c) => (TARGETS.find((x) => x.id === c.id)?.params.length ? fmtCall(c, TARGETS) : ids ? c.id : optLabel(TARGETS, c.id))) } : {}),
    ...(n.keyword ? { keyword: ids ? n.keyword : optLabel(KEYWORDS, n.keyword) } : {}),
    steps: n.steps.map((s) => (s.node ? `[[${s.id}]]` : fmtCall(s, ACTIONS))),
  };
}

export const is = (x: { id: string; label: { ja: string; en: string }; aka?: string[] }, v: string) => x.id === v || x.label.ja === v || x.label.en === v || !!x.aka?.includes(v);

function parseCall(text: string, defs: Callable[]): Call {
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
  const asCall = raw.target && /^[A-Za-z_]\w*\(.*\)$/.test(raw.target.trim()) ? parseCall(raw.target, TARGETS) : undefined;
  const target = asCall ? asCall.id : opt(TARGETS, raw.target);
  const targetArgs = asCall && Object.keys(asCall.args).length ? asCall.args : undefined;
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
    ...(raw.cost?.length ? { cost: raw.cost.map((l) => parseCall(l, ACTIONS)) } : {}),
    ...(raw.loyalty ? { loyalty: raw.loyalty.replace(/[\u2212\u2013]/g, "-").trim() } : {}), // 「−」(U+2212) も、読める
    ...(raw.condition ? { condition: parseCall(raw.condition.replace(/^`(.*)`$/, "$1"), CONDITIONS) } : {}),
    ...(target ? { target } : {}),
    ...(targetArgs ? { targetArgs } : {}),
    ...(raw.alsoTarget?.length ? { alsoTargets: raw.alsoTarget.map((l): Call => (/^[A-Za-z_]\w*\(.*\)$/.test(l.trim()) ? parseCall(l, TARGETS) : { id: opt(TARGETS, l.trim()) ?? l.trim(), args: {} })) } : {}),
    ...(keyword ? { keyword } : {}),
    steps,
  };
}

export const defaults = (d: Callable): Record<string, string> => Object.fromEntries(d.params.map((p) => [p.id, p.default]));
