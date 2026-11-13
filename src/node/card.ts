import { UiKey, getLang, pick, setLang, t, tAny } from "../i18n";
import { CARD_TYPES } from "./cardtypes";
import { Fields, NodeData, buildNode, fields, is } from "./md";

// カード = Cards/<カード名>.md (英語)。能力のノードが、コードブロック (```node) で、1 能力に 1 つ入る。形 (日本語):
//   ---\n mtg: card\n lang: ja\n カードタイプ: インスタント\n ---
//   # カード名
//   ## 能力
//   ```node
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
  keywords?: string[]; // キーワード能力の一覧 (Scryfall の keywords)
  abilities: NodeData[];
}

const KEYS: [UiKey, keyof Fields | "name"][] = [["name", "name"], ["mdSource", "source"], ["mdKind", "kind"], ["mdTiming", "timing"], ["mdCondition", "condition"], ["mdTarget", "target"], ["mdKeyword", "keyword"], ["mdSteps", "steps"]];
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
  const meta: [string, string | undefined][] = [["type", c.type && (ty ? pick(ty.label) : c.type)], ["scryfall", c.scryfall], ["mana", c.mana], ["type-line", c.typeLine], ["art", c.art], ["keywords", c.keywords?.join(", ")], ["name-ja", c.nameJa], ["type-line-ja", c.typeLineJa]];
  const out = ["---", "mtg: card", ...meta.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), "---", `# ${c.name}`, ""];
  if (c.text) out.push("## Rules text", "", ...c.text.split("\n").map((l) => `> ${l}`), "");
  if (c.textJa) out.push("## Rules text (ja)", "", ...c.textJa.split("\n").map((l) => `> ${l}`), "");
  if (c.prints?.length) out.push("## Printings", "", ...c.prints.map((p) => `- ${p.set} ${p.number} ${p.released || "-"} ${p.id} ${p.art}`), "");
  out.push("## Abilities", "");
  for (const n of c.abilities) {
    const f = fields(n);
    out.push("```node", `name: ${n.name}`, ...(f.source ? [`source: ${f.source}`] : []), `kind: ${f.kind}`, `timing: ${f.timing}`);
    if (f.condition) out.push(`condition: ${f.condition}`);
    if (f.target) out.push(`target: ${f.target}`);
    if (f.keyword) out.push(`keyword: ${f.keyword}`);
    out.push("steps:", ...f.steps.map((s) => `  ${s}`), "```", "");
  }
  return out.join("\n");
});

function parseAbility(text: string): NodeData {
  const raw: Partial<Fields> & { name?: string } = { steps: [] };
  let inSteps = false;
  for (const line of text.split("\n")) {
    if (inSteps && /^\s+\S/.test(line)) { raw.steps!.push(line.trim()); continue; }
    const m = /^([^:]+): *(.*)$/.exec(line);
    const key = m && KEYS.find(([k]) => tAny(k).some((x) => same(x, m[1].trim())))?.[1];
    if (!m || !key) continue;
    inSteps = key === "steps";
    if (key !== "steps") (raw as Record<string, string>)[key] = m[2].trim();
  }
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
  const abilities = [...body.matchAll(/```node\n([\s\S]*?)```/g)].map((m) => parseAbility(m[1]));
  const text = new RegExp(`^## (?:${tAny("rulesText").join("|")})\\n\\n((?:>.*\\n?)*)`, "m").exec(body)?.[1].split("\n").filter((l) => l.startsWith(">")).map((l) => l.replace(/^> ?/, "")).join("\n");
  const textJa = /^## Rules text \(ja\)\n\n((?:>.*\n?)*)/m.exec(body)?.[1].split("\n").filter((l) => l.startsWith(">")).map((l) => l.replace(/^> ?/, "")).join("\n");
  const prints = [...(/^## Printings\n\n([\s\S]*?)(?:\n## |(?![\s\S]))/m.exec(body)?.[1] ?? "").matchAll(/^- (\S+) (\S+) (\S+) (\S+) (\S+)$/gm)].map((m) => ({ set: m[1], number: m[2], released: m[3] === "-" ? "" : m[3], id: m[4], art: m[5] }));
  const extra = { ...(prints.length ? { prints } : {}), nameJa: meta(["name-ja"]), typeLineJa: meta(["type-line-ja"]), ...(textJa ? { textJa } : {}), scryfall: meta(["scryfall"]), art: meta(["art"]), keywords: meta(["keywords"]).split(/,\s*/).filter(Boolean), mana: meta(["mana"]), typeLine: meta(["type-line"]), ...(text ? { text } : {}) };
  return { name, ...(type ? { type } : {}), ...Object.fromEntries(Object.entries(extra).filter(([, v]) => (Array.isArray(v) ? v.length : v))), abilities };
}
