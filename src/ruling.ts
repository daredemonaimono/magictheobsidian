import { reference } from "./ai/guide";
import { Http, Msg, Provider, chatRequest, chatText, errorText } from "./ai/providers";
import { auditCard } from "./node/audit";
import { CardData, abilityBlock } from "./node/card";

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
}
export const MAX_ITEMS = 60;

// 組めていないもの: ルールなしのカードは、原文の行ごと / 組みかけの能力は、問題・抜けの疑いごと
export function collect(cards: CardData[], hasCard: (n: string, f?: string) => boolean): Item[] {
  const out: Item[] = [];
  for (const c of cards) {
    const a = auditCard(c, hasCard);
    if (!a.needsReview) continue;
    const typeLine = c.typeLine ?? "";
    if (a.noRules) {
      for (const line of (c.text ?? "").split("\n").map((l) => l.trim()).filter(Boolean)) out.push({ card: c.name, typeLine, ability: "", line, notes: ["ルールなし (能力が 1 つも無い)"] });
      continue;
    }
    c.abilities.forEach((ab, i) => {
      const r = a.abilities[i];
      if (r.problems.length || r.gaps.length) out.push({ card: c.name, typeLine, ability: ab.name, line: (ab.source ?? ab.name).split("\n").join(" / "), node: abilityBlock(ab, true), notes: [...r.problems, ...r.gaps] });
    });
  }
  return out;
}

const itemText = (it: Item): string =>
  [`- **${it.card}**${it.typeLine ? ` (${it.typeLine})` : ""}${it.ability ? ` / 能力: ${it.ability}` : ""}`, `  - 原文: ${it.line}`, ...it.notes.map((n) => `  - 点検: ${n}`), ...(it.node ? ["  - いまの状態:", ...it.node.split("\n").map((l) => `    ${l}`)] : [])].join("\n");

// AI に渡す一覧 (多すぎるときは、最初の MAX_ITEMS だけ)
export const itemsText = (items: Item[]): string => items.slice(0, MAX_ITEMS).map(itemText).join("\n") + (items.length > MAX_ITEMS ? `\n(ほか ${items.length - MAX_ITEMS} 件は、省いた)` : "");

const SYSTEM = [
  "あなたは、Magic: The Gathering の総合ルール (CR) に詳しい、ルールの点検者です。",
  "Obsidian のプラグインが、カードの原文を、ノード (動作・条件・対象・キーワードなどの部品) に組んで、ルールを表します。下は、いま定義済みの部品の一覧です。",
  "",
  reference(),
].join("\n");

export const pickPrompt = (items: Item[]): string =>
  [
    "次は、ノードに組めていない・途中のカードの能力の一覧です。",
    "",
    itemsText(items),
    "",
    "これらを組むために、**定義が足りない部品**を考えてください。その定義の根拠になる、総合ルールの規則の番号を挙げてください (番号は、あとで、公式の条文を取って確かめます。記憶で、条文を書かないでください)。",
    '答えは、次の形の JSON コードブロックだけ: ```json\n{"rules": ["701.22", "603.7a"]}\n```(最大 40 個。「701.22」のような、番号だけ)',
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

export const reportPrompt = (items: Item[], rules: Rule[]): string =>
  [
    "次は、ノードに組めていない・途中のカードの能力の一覧です。",
    "",
    itemsText(items),
    "",
    "公式の総合ルール (Academy Ruins で確認した条文。**ここにある番号と条文だけを、根拠にする**):",
    ...rules.map((r) => (r.text ? `- CR ${r.number}: ${r.text}` : `- CR ${r.number}: (確認できなかった。根拠にしない)`)),
    "",
    "報告書の本文 (Markdown) を書いてください。見出しは、この形:",
    "",
    "## 足りないノード",
    "(必要度の高い順。1 つの部品に、1 つの `###`。下の項目を、箇条書きで)",
    "### <部品の id (小文字・ハイフン)> — <日本語の名前>",
    "- 種類: action / condition / target / keyword / kind・timing のどれか",
    "- 根拠: CR <番号> (上の条文だけ。条文の要点を、日本語で)",
    "- 引数: <名前・型・選択肢>。カード専用にせず、組み合わせで効く、汎用の部品にする",
    "- 使うカード: <カード名のリスト>",
    "- 実装の注意: <1〜2 行>",
    "",
    "## 既存の部品で組めるもの",
    "(定義済みの部品で組めるのに、組めていないもの。カード名・能力・使う部品・手順の案)",
    "",
    "## 判断できなかったもの",
    "(公式の条文が確認できず、決められないもの)",
    "",
    "守ること: 一覧に無いカード・規則を作らない。条文が確認できないものは、CR の番号を書かない。定義済みの部品と、重複する提案をしない。本文だけを答える (前置き・後書きは、書かない)。",
  ].join("\n");

export interface RulingInput {
  http: Http;
  provider: Provider;
  model: string;
  key: string;
  items: Item[];
  getRule: (n: string) => Promise<string | undefined>;
  progress?: (msg: string) => void;
}
const ask = async (i: RulingInput, content: string): Promise<string> => {
  const messages: Msg[] = [{ role: "user", content }];
  const res = await i.http(chatRequest(i.provider, i.model, i.key, SYSTEM, messages, 8000));
  if (res.status !== 200) throw new Error(`HTTP ${res.status} ${errorText(res.json)}`.trim());
  return chatText(i.provider, res.json);
};

export interface RulingResult { analysis: string; rules: Rule[] }
export async function rulingAnalysis(i: RulingInput): Promise<RulingResult> {
  i.progress?.("1/3");
  const numbers = rulesFrom(await ask(i, pickPrompt(i.items)));
  i.progress?.("2/3");
  const rules = await fetchRules(i.getRule, numbers);
  i.progress?.("3/3");
  return { analysis: (await ask(i, reportPrompt(i.items, rules))).trim(), rules };
}

// 報告書 (md) 全体。上 = 機械の点検 (確かな部分) / 中 = AI の分析 / 下 = 取得した公式の条文 (確かめられるように)
export function reportMd(date: string, model: string, cards: number, items: Item[], r: RulingResult, crDate = ""): string {
  const rules = r.rules.map((x) => `- CR ${x.number}: ${x.text ?? "(確認できなかった)"}`);
  return [
    "---",
    "mtg: ruling-report",
    `date: ${date}`,
    `model: ${model}`,
    `cards: ${cards}`,
    `items: ${items.length}`,
    ...(crDate ? [`cr: ${crDate}`] : []),
    "---",
    `# Ruling report ${date}`,
    "",
    `> このノードをもとに、エージェントが、新しい部品を組む (手順は、agent.md「Ruling report から、新しいノードを組む」)。条文は、Academy Ruins から取った、ローカルの総合ルール (CR)${crDate ? ` (取得: ${crDate})` : ""} で確認したもの。AI の分析は、誤りがありうる: 部品を作る前に、条文を読み直すこと。`,
    "",
    `組めていない能力: ${items.length} 件 (点検したカード ${cards} 枚)${items.length > MAX_ITEMS ? `。AI に渡したのは、最初の ${MAX_ITEMS} 件` : ""}`,
    "",
    r.analysis,
    "",
    "## 点検の一覧 (機械)",
    "",
    items.map(itemText).join("\n"),
    "",
    "## 確認した公式の条文",
    "",
    ...(rules.length ? rules : ["(なし)"]),
    "",
  ].join("\n");
}
