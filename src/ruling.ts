import { compactReference } from "./ai/guide";
import { Http, Msg, Provider, chatRequest, chatText, errorText, truncated } from "./ai/providers";
import { auditCard } from "./node/audit";
import { CardData, abilityBlock } from "./node/card";
import { KEYWORDS } from "./node/slots";

// Ruling report: ノードが組めていない・途中のものを、AI が、公式ルール (CR) を確認した上で点検し、「足りないノード」を炙り出して、md の報告書にする。
// この報告書をもとに、エージェントが、新しいノードを組む (agent.md「Ruling report から、新しいノードを組む」)。
// 流れ: ① 点検 (audit。機械) → ② AI が、必要な CR の番号を挙げる → ③ Academy Ruins から、条文を取る (送るのは、規則の番号だけ) → ④ AI が、条文を見て、報告を書く。

export interface Item {
  card: string;
  typeLine: string;
  ability: string; // 能力の名前 (ルールなしのカードは、空)
  line: string; // 原文の行
  node?: string; // いまの状態 (組みかけ)
  notes: string[]; // 問題・抜けの疑い
  easy?: boolean; // 定義済みのキーワードだけの行 (飛行・警戒 …): 機械で、組める。AI には、渡さない
}
const KW = new Set(KEYWORDS.map((k) => k.label.en.toLowerCase()));
export const isKeywordOnly = (line: string): boolean => line.split(/,\s*/).every((x) => KW.has(x.trim().replace(/\.$/, "").toLowerCase()));
export const BATCH = 20; // 1 回に、AI が読む件数 (多いと、出力が上限に近づき、分析も粗くなる。残りは、次の実行へ)
// 前回と照合するための、能力の印 (カード・能力・原文・いまのノード。どれかが変われば、別のもの)
export const itemKey = (it: Item): string => [it.card, it.ability, it.line, it.node ?? "", it.notes.join("|")].join("\u0001");

// 組めていないもの: ルールなしのカードは、原文の行ごと / 組みかけの能力は、問題・抜けの疑いごと
export function collect(cards: CardData[], hasCard: (n: string, f?: string) => boolean): Item[] {
  const out: Item[] = [];
  for (const c of cards) {
    const a = auditCard(c, hasCard);
    if (!a.needsReview) continue;
    const typeLine = c.typeLine ?? "";
    if (a.noRules) {
      for (const line of (c.text ?? "").split("\n").map((l) => l.trim()).filter(Boolean)) out.push({ card: c.name, typeLine, ability: "", line, notes: ["No rules (the card has no abilities yet)"], ...(isKeywordOnly(line) ? { easy: true } : {}) });
      continue;
    }
    c.abilities.forEach((ab, i) => {
      const r = a.abilities[i];
      if (r.problems.length || r.gaps.length) out.push({ card: c.name, typeLine, ability: ab.name, line: (ab.source ?? ab.name).split("\n").join(" / "), ...(ab.steps.length || ab.target || ab.condition || ab.cost?.length ? { node: abilityBlock(ab, true) } : {}), notes: [...r.problems, ...r.gaps].slice(0, 4) });
    });
  }
  return out;
}

const itemText = (it: Item): string =>
  [`- **${it.card}**${it.typeLine ? ` (${it.typeLine})` : ""}${it.ability ? ` / ability: ${it.ability}` : ""}`, `  - text: ${it.line}`, ...it.notes.map((n) => `  - check: ${n}`), ...(it.node ? ["  - current node:", ...it.node.split("\n").map((l) => `    ${l}`)] : [])].join("\n");

export const itemsText = (items: Item[]): string => items.map(itemText).join("\n");

const SYSTEM = [
  "You are a rules auditor for Magic: The Gathering, expert in the Comprehensive Rules (CR).",
  "An Obsidian plugin models each card's rules text as nodes (parts: actions, conditions, targets, keywords, kinds/timings). Below is the list of parts already defined.",
  "Be concise: every output token costs.",
  "",
  compactReference(),
].join("\n");

export const pickPrompt = (items: Item[], known: string[] = []): string =>
  [
    "Below are card abilities that are not yet modelled as nodes (or only partly).",
    "",
    itemsText(items),
    "",
    ...(known.length ? [`Rule numbers already fetched (do not list them again): ${known.join(", ")}`, ""] : []),
    "Think about which parts are MISSING to model them. List the CR rule numbers that ground those missing parts. The official text for each number is fetched afterwards: do not quote rule text from memory.",
    'Answer with only a JSON code block: ```json\n{"rules": ["701.24", "603.7"]}\n``` (at most 40; plain rule numbers like 701.24 or 603.7a; a number without a letter also brings its lettered sub-rules).',
  ].join("\n");

export const rulesFrom = (text: string): string[] => {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  try {
    const r = (JSON.parse(m ? m[1] : text) as { rules?: unknown }).rules;
    return [...new Set((Array.isArray(r) ? r : []).map(String).map((x) => x.trim()).filter((x) => /^\d+(?:\.\d+)*[a-z]?$/.test(x)))].slice(0, 40);
  } catch {
    return [];
  }
};

export interface Rule { number: string; text?: string } // text が無い = 公式で、確認できなかった
export const fetchRules = async (get: (n: string) => Promise<string | undefined>, numbers: string[]): Promise<Rule[]> =>
  Promise.all(numbers.map(async (number) => { try { return { number, text: await get(number) }; } catch { return { number }; } }));

// 規則の番号 → 条文 + その枝 (701.24 → 701.24a, b…。見出しだけの規則に、細部を付ける)
export function ruleWithSubs(cr: Record<string, string>, n: string): string | undefined {
  const head = cr[n];
  if (head === undefined) return undefined;
  const subs = Object.keys(cr).filter((k) => k.length === n.length + 1 && k.startsWith(n) && /[a-z]$/.test(k)).sort();
  return (head + subs.map((k) => `\n  - ${k}: ${cr[k]}`).join("")).slice(0, 2500);
}

export interface Prev { analysis: string; gone: string[] } // 前回の分析と、前回から解決した (一覧から消えた) 能力
export const reportPrompt = (items: Item[], rules: Rule[], prev?: Prev): string =>
  [
    ...(prev
      ? ["A previous report exists. UPDATE it: keep entries that are still valid, add entries for the new/changed abilities below, and drop or shrink entries whose abilities are now resolved. Output the FULL updated body.", "", "Previous report body:", prev.analysis, "", prev.gone.length ? `Resolved since then (no longer incomplete):\n${prev.gone.slice(0, 40).map((g) => `- ${g}`).join("\n")}` : "Resolved since then: none", "", "New/changed incomplete abilities:"]
      : ["Below are card abilities that are not yet modelled as nodes (or only partly)."]),
    "",
    items.length ? itemsText(items) : "(none)",
    "",
    "Official Comprehensive Rules text (fetched from the local CR copy). **Cite only the numbers and text given here**:",
    ...rules.map((r) => (r.text ? `- CR ${r.number}: ${r.text}` : `- CR ${r.number}: (not found; do not cite)`)),
    "",
    "Write the report body in English Markdown, with exactly these headings:",
    "",
    "## Missing nodes",
    "(highest need first; one `###` per part, each with these bullets)",
    "### <part id (lowercase-hyphen)> — <short name>",
    "- kind: action / condition / target / keyword / kind-timing",
    "- grounds: CR <number> (only from the text above) + one-line gist",
    "- params: <name, type, choices>. Generic and composable, never card-specific",
    "- cards: <card names>",
    "- note: <1-2 lines>",
    "",
    "## Buildable with existing parts",
    "(abilities that existing parts can already express: card, ability, parts, step sketch)",
    "",
    "## Undecided",
    "(cannot decide because the official text was not found)",
    "",
    "Rules: do not invent cards or rules not in the list; do not cite a CR number whose text was not found; do not propose a part that duplicates a defined one; be terse; output the body only (no preface or afterword).",
  ].join("\n");

export interface RulingInput {
  http: Http;
  provider: Provider;
  model: string;
  key: string;
  items: Item[];
  prev?: RulingState; // 前回の結果 (あれば、変わったものだけを、調べる)
  getRule: (n: string) => Promise<string | undefined>;
  progress?: (msg: string) => void;
}
const ask = async (i: RulingInput, content: string, maxTokens = 16000): Promise<{ text: string; cut: boolean }> => {
  const messages: Msg[] = [{ role: "user", content }];
  const res = await i.http(chatRequest(i.provider, i.model, i.key, SYSTEM, messages, maxTokens));
  if (res.status !== 200) throw new Error(`HTTP ${res.status} ${errorText(res.json)}`.trim());
  return { text: chatText(i.provider, res.json), cut: truncated(i.provider, res.json) };
};

export interface RulingState { keys: string[]; analysis: string; rules: Rule[] } // 前回の結果 (プラグインのフォルダに、残す)
export interface RulingResult { analysis: string; rules: Rule[]; keys: string[]; left: number; cut?: boolean; incremental?: boolean; reused?: boolean; fresh?: number; gone?: number }
// 前回があれば、変わったもの (新しい・書き換えた) だけを AI に調べさせる。変わりが無ければ、AI を呼ばない。条文も、前回取ったものは、取り直さない
export async function rulingAnalysis(i: RulingInput): Promise<RulingResult> {
  const prev = i.prev;
  const had = new Set(prev?.keys ?? []);
  const now = new Set(i.items.map(itemKey));
  const todo = prev ? i.items.filter((x) => !had.has(itemKey(x))) : i.items;
  const fresh = todo.slice(0, BATCH); // 今回、読むもの
  const left = todo.length - fresh.length; // 次の実行に回すもの
  const gone = prev ? prev.keys.filter((k) => !now.has(k)) : [];
  if (prev && !fresh.length && !gone.length) return { analysis: prev.analysis, rules: prev.rules, keys: prev.keys, incremental: true, reused: true, fresh: 0, gone: 0, left: 0 };
  let rules = prev?.rules ?? [];
  if (fresh.length) {
    i.progress?.("1/3");
    const known = new Set(rules.map((r) => r.number));
    const numbers = rulesFrom((await ask(i, pickPrompt(fresh, [...known]), 1500)).text).filter((n) => !known.has(n));
    i.progress?.("2/3");
    rules = [...rules, ...(await fetchRules(i.getRule, numbers))];
  }
  i.progress?.("3/3");
  const r = await ask(i, reportPrompt(fresh, rules, prev ? { analysis: prev.analysis, gone: gone.map((k) => k.split("\u0001").filter((x, n) => n === 0 || n === 2).join(": ")) } : undefined));
  const keys = [...(prev?.keys ?? []).filter((k) => now.has(k)), ...fresh.map(itemKey)]; // 読み終えたもの (残りは、含めない)
  return { analysis: r.text.trim(), rules, keys, cut: r.cut, incremental: !!prev, fresh: fresh.length, gone: gone.length, left };
}

// 報告書 (md) 全体 (英語: トークンの節約)。上 = AI の分析 / 中 = 機械の点検 (確かな部分) / 下 = 取得した公式の条文 (確かめられるように)
export function reportMd(date: string, model: string, cards: number, items: Item[], r: RulingResult, crDate = "", easy: Item[] = []): string {
  const rules = r.rules.map((x) => `- CR ${x.number}: ${x.text ?? "(not found)"}`);
  return [
    "---",
    "mtg: ruling-report",
    `updated: ${date}`,
    `model: ${model}`,
    `cards: ${cards}`,
    `items: ${items.length}`,
    ...(crDate ? [`cr: ${crDate}`] : []),
    "---",
    `# Ruling report (updated ${date})`,
    "",
    `> The agent builds new nodes from this report (procedure: agent.md, "Ruling report → build new nodes"). Rule text comes from the local Comprehensive Rules copy (Academy Ruins${crDate ? `, fetched ${crDate}` : ""}). The AI analysis may be wrong: re-read the rule text before building a part.`,
    "",
    `Incomplete abilities: ${items.length} (${cards} cards checked)${r.left ? `. ${r.left} not analysed yet (the AI reads ${BATCH} per run): run the command again` : ""}`,
    "",
    ...(r.incremental ? [r.reused ? "Nothing changed since the last report: its analysis was reused (no AI call).\n" : `Since the last report: ${r.fresh} new/changed, ${r.gone} resolved. Only those were re-analysed; rule text fetched earlier was not re-fetched.\n`] : []),
    ...(r.cut ? ["> ⚠ The AI output hit the token limit and is cut off. Re-run, or raise the limit.", ""] : []),
    r.analysis,
    "",
    ...(easy.length ? ["## Keyword-only lines (machine: build with the defined keywords)", "", ...easy.map((e) => `- ${e.card}: ${e.line}`), ""] : []),
    "## Check list (machine)",
    "",
    items.map(itemText).join("\n"),
    "",
    "## Official rule text used",
    "",
    ...(rules.length ? rules : ["(none)"]),
    "",
  ].join("\n");
}
