import { UiKey, getLang, pick, setLang, t, tAny } from "../i18n";
import { CARD_TYPES } from "./cardtypes";
import { Fields, NodeData, buildNode, fields, is } from "./md";

// カード = Cards/<カード名>.md (英語)。能力のノードが、コードブロック (```mtg-node) で、1 能力に 1 つ入る。形 (日本語):
//   ---\n mtg: card\n lang: ja\n カードタイプ: インスタント\n ---
//   # カード名
//   ## 能力
//   ```mtg-node
//   名前: 獰猛
//   種類: 誘発型
//   タイミング: 攻撃したとき
//   条件: controlsPowerAtLeast(n=4)     (任意。対象・キーワードも、任意)
//   手順:
//     modifyPT(power=2, toughness=2, duration=until-eot)     (2 字下げ。1 行に 1 つ)
//   ```
// 手順の中で、同じカードのほかの能力を、[[名前]] で呼べる。ノードの置き場は、このノートだけ (Nodes/ は無い)。
// 版違い 1 つ (Scryfall の印刷)
export interface Print {
  id: string; // Scryfall の id
  set: string;
  number: string; // コレクター番号
  released: string; // 発売日 (YYYY-MM-DD。無ければ空)
  art: string; // 絵 (art_crop の URL)
}
export interface CardData {
  name: string;
  type?: string; // カードタイプの id (cardtypes.ts)。取り込みで、自動で入る
  // 以下は、Scryfall からの取り込みで入る (参照用。ルールの判断には使わない)
  scryfall?: string; // Scryfall の id
  art?: string; // 絵 (Scryfall の art_crop の URL)
  mana?: string; // マナ・コスト
  typeLine?: string; // タイプ行 (英語)
  text?: string; // 原文 (ルール・テキスト)
  // 設定が日本語のとき、取り込みで入る日本語 (キー・見出しは英語のまま)
  nameJa?: string;
  typeLineJa?: string;
  textJa?: string;
  prints?: Print[]; // 版違い (取り込みで入る)
  loyalty?: string; // プレインズウォーカーの、初期の忠誠度 (Scryfall。306.5a)
  token?: boolean; // トークン (唱えるカードではない)
  keywords?: string[]; // キーワード能力の一覧 (Scryfall の keywords)
  abilities: NodeData[];
}

const KEYS: [UiKey, keyof Fields | "name"][] = [["name", "name"], ["mdSource", "source"], ["mdUnsupported", "unsupported"], ["mdKind", "kind"], ["mdCost", "cost"], ["mdLoyalty", "loyalty"], ["mdTiming", "timing"], ["mdCondition", "condition"], ["mdTarget", "target"], ["mdAlsoTarget", "alsoTarget"], ["mdKeyword", "keyword"], ["mdSteps", "steps"]];
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// カードのノートは、どの言語の設定でも、英語で書き出す (世界共通。フロントマター・キー・見出し・値のすべて)。読むときは、日本語のものも読める
const inEnglish = <T>(f: () => T): T => {
  const prev = getLang();
  setLang("en");
  try {
    return f();
  } finally {
    setLang(prev);
  }
};

export const toCardMd = (c: CardData): string => inEnglish(() => {
  const ty = CARD_TYPES.find((x) => x.id === c.type);
  const meta: [string, string | undefined][] = [["type", c.type && (ty ? pick(ty.label) : c.type)], ["scryfall", c.scryfall], ["mana", c.mana], ["type-line", c.typeLine], ["loyalty", c.loyalty], ["token", c.token ? "true" : undefined], ["art", c.art], ["keywords", c.keywords?.join(", ")], ["name-ja", c.nameJa], ["type-line-ja", c.typeLineJa]];
  const out = ["---", "mtg: card", ...meta.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), "---", `# ${c.name}`, ""];
  if (c.text) out.push("## Rules text", "", ...c.text.split("\n").map((l) => `> ${l}`), "");
  if (c.textJa) out.push("## Rules text (ja)", "", ...c.textJa.split("\n").map((l) => `> ${l}`), "");
  if (c.prints?.length) out.push("## Printings", "", ...c.prints.map((p) => `- ${p.set} ${p.number} ${p.released || "-"} ${p.id} ${p.art}`), "");
  out.push("## Abilities", "");
  for (const n of c.abilities) out.push(...abilityBlockLines(n), "");
  return out.join("\n");
});

// コードブロックの言語名: mtg-node (Obsidian が、JavaScript として色づけしないように。古い「node」も、読める)
const FENCE_OPEN = "```mtg-node";

// 能力 1 つの、コードブロック (```mtg-node ... ```)。ids = true なら、種類・タイミング・対象・キーワードを、ラベルではなく id で書く (AI への手引き用。どちらも読める)
function abilityBlockLines(n: NodeData, ids = false): string[] {
  const f = fields(n, ids);
  const out = [FENCE_OPEN, `name: ${n.name}`, ...(f.source ? (f.source.includes("\n") ? ["source:", ...f.source.split("\n").map((l) => `  ${l}`)] : [`source: ${f.source}`]) : []), `kind: ${f.kind}`, `timing: ${f.timing}`];
  if (f.unsupported) out.push(`unsupported: ${f.unsupported.split("\n").join(" / ")}`);
  if (f.loyalty !== undefined) out.push(`loyalty: ${f.loyalty}`);
  if (f.cost?.length) out.push("cost:", ...f.cost.map((c) => `  ${c}`));
  if (f.condition) out.push(`condition: ${f.condition}`);
  if (f.target) out.push(`target: ${f.target}`);
  if (f.alsoTarget?.length) out.push("also-target:", ...f.alsoTarget.map((c) => `  ${c}`));
  if (f.keyword) out.push(`keyword: ${f.keyword}`);
  out.push("steps:", ...f.steps.map((s) => `  ${s}`), "```");
  return out;
}
export const abilityBlock = (n: NodeData, ids = false): string => inEnglish(() => abilityBlockLines(n, ids).join("\n"));

// コードブロックの中身 (``` の内側) から、能力を読む。AI の答えも、これで読む
export function parseAbility(text: string): NodeData {
  const raw: Partial<Fields> & { name?: string } = { steps: [] };
  let list: "steps" | "source" | "cost" | "also" | undefined; // 字下げした行が続く欄 (複数行の source は、字下げで書く)
  const srcLines: string[] = [];
  const costLines: string[] = [];
  const alsoLines: string[] = [];
  for (const line of text.split("\n")) {
    if (list && /^\s+\S/.test(line)) { (list === "steps" ? raw.steps! : list === "cost" ? costLines : list === "also" ? alsoLines : srcLines).push(line.trim()); continue; }
    const m = /^([^:]+): *(.*)$/.exec(line);
    const key = m && KEYS.find(([k]) => tAny(k).some((x) => same(x, m[1].trim())))?.[1];
    if (!m || !key) continue;
    list = key === "steps" ? "steps" : key === "cost" ? "cost" : key === "alsoTarget" ? "also" : key === "source" && !m[2].trim() ? "source" : undefined;
    if (key !== "steps" && key !== "cost" && key !== "alsoTarget") (raw as Record<string, string>)[key] = m[2].trim();
  }
  if (srcLines.length) raw.source = srcLines.join("\n");
  if (costLines.length) raw.cost = costLines;
  if (alsoLines.length) raw.alsoTarget = alsoLines;
  return buildNode(raw.name ?? "", raw);
}

export function parseCardMd(md: string): CardData {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!fm) throw new Error(t("mdErrFront"));
  const meta = (keys: string[]) => keys.map((k) => new RegExp(`^${k}: *(.*)$`, "m").exec(fm[1])?.[1].trim()).find((v) => v !== undefined) ?? "";
  if (meta(["mtg"]) !== "card") throw new Error(t("mdErrCard"));
  const body = md.slice(fm[0].length);
  const name = /^# (.+)$/m.exec(body)?.[1].trim();
  if (!name) throw new Error(t("mdErrTitle"));
  const typeText = meta(["type", ...tAny("cardType")]);
  const type = CARD_TYPES.find((x) => is(x, typeText))?.id ?? typeText;
  const abilities = [...body.matchAll(/```(?:mtg-)?node\n([\s\S]*?)```/g)].map((m) => parseAbility(m[1]));
  const text = new RegExp(`^## (?:${tAny("rulesText").join("|")})\\n\\n((?:>.*\\n?)*)`, "m").exec(body)?.[1].split("\n").filter((l) => l.startsWith(">")).map((l) => l.replace(/^> ?/, "")).join("\n");
  const textJa = /^## Rules text \(ja\)\n\n((?:>.*\n?)*)/m.exec(body)?.[1].split("\n").filter((l) => l.startsWith(">")).map((l) => l.replace(/^> ?/, "")).join("\n");
  const prints = [...(/^## Printings\n\n([\s\S]*?)(?:\n## |(?![\s\S]))/m.exec(body)?.[1] ?? "").matchAll(/^- (\S+) (\S+) (\S+) (\S+) (\S+)$/gm)].map((m) => ({ set: m[1], number: m[2], released: m[3] === "-" ? "" : m[3], id: m[4], art: m[5] }));
  const extra = { ...(prints.length ? { prints } : {}), nameJa: meta(["name-ja"]), typeLineJa: meta(["type-line-ja"]), ...(textJa ? { textJa } : {}), scryfall: meta(["scryfall"]), art: meta(["art"]), token: meta(["token"]) === "true", loyalty: meta(["loyalty"]), keywords: meta(["keywords"]).split(/,\s*/).filter(Boolean), mana: meta(["mana"]), typeLine: meta(["type-line"]), ...(text ? { text } : {}) };
  return { name, ...(type ? { type } : {}), ...Object.fromEntries(Object.entries(extra).filter(([, v]) => (Array.isArray(v) ? v.length : v))), abilities };
}

// 文章の中から、最初の ```mtg-node ブロックの中身を取り出す (AI の答え用)。ブロックが無ければ、undefined。ブロックの外の文章は、note に
export function extractNodeBlock(text: string): { body: string; note: string } | undefined {
  const m = /```(?:mtg-)?node[^\n]*\n([\s\S]*?)```/.exec(text);
  if (!m) return undefined;
  return { body: m[1], note: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim() };
}
