import { Ability, AbilityKind, Arg, CardRule, NodeCall } from "./node";

// vault の Rules/<カード名>.md の読み書き。見出し = 能力の4分類、箇条書き1行 = ノード呼び出し1つ:
//   - <ノードid> [as=<名前>] <引数>=<値> ...      値: $名前 (ref) / 整数 / true・false / 文字列 ("..." で空白も可)
const HEADINGS: Record<string, AbilityKind> = { 呪文能力: "spell", 起動型能力: "activated", 誘発型能力: "triggered", 常在型能力: "static", 準備呪文: "prepare" };
const NOTE = "未対応";
const HEADING_OF = Object.fromEntries(Object.entries(HEADINGS).map(([h, k]) => [k, h])) as Record<AbilityKind, string>;

export class RuleParseError extends Error {
  constructor(message: string, public line: number) {
    super(`${line} 行目: ${message}`);
  }
}

const isSpace = (c: string) => c === " " || c === "\t" || c === "　";

// 空白で区切る。"..." の中は1つの値で、引用された値は文字列のまま (数値などに変換しない)
function tokens(s: string, line: number): { text: string; quoted: boolean }[] {
  const out: { text: string; quoted: boolean }[] = [];
  let i = 0;
  while (i < s.length) {
    if (isSpace(s[i])) {
      i++;
      continue;
    }
    let text = "";
    let quoted = false;
    while (i < s.length && !isSpace(s[i])) {
      if (s[i] === '"') {
        const end = s.indexOf('"', i + 1);
        if (end < 0) throw new RuleParseError("引用符が閉じていない", line);
        text += s.slice(i + 1, end);
        quoted = true;
        i = end + 1;
      } else text += s[i++];
    }
    out.push({ text, quoted });
  }
  return out;
}

function arg(text: string, quoted: boolean): Arg {
  if (quoted) return text;
  if (text.startsWith("$")) return { ref: text.slice(1) };
  if (/^-?\d+$/.test(text)) return Number(text);
  if (text === "true" || text === "false") return text === "true";
  return text;
}

function parseCall(s: string, line: number): NodeCall {
  const [head, ...rest] = tokens(s, line);
  if (!head || head.quoted || !/^[A-Za-z][\w-]*$/.test(head.text)) throw new RuleParseError("ノードの id がない", line);
  const call: NodeCall = { node: head.text, args: {} };
  Object.defineProperty(call, "line", { value: line, enumerable: false }); // 往復の比較には出さない
  for (const t of rest) {
    const eq = t.text.indexOf("=");
    if (eq <= 0) throw new RuleParseError(`引数は 名前=値 で書く: ${t.text}`, line);
    const key = t.text.slice(0, eq);
    const val = t.text.slice(eq + 1);
    if (!val && !t.quoted) throw new RuleParseError(`値が空: ${key}`, line);
    if (key === "as") call.as = val;
    else if (key === "if") call.if = val;
    else call.args[key] = arg(val, t.quoted);
  }
  return call;
}

export function parseRule(md: string): CardRule {
  const lines = md.split(/\r?\n/);
  let i = 0;
  let card: string | undefined;
  if (lines[0]?.trim() === "---") {
    for (i = 1; i < lines.length && lines[i].trim() !== "---"; i++) {
      const m = lines[i].match(/^card:\s*"?\[\[(.+?)\]\]"?\s*$/);
      if (m) card = m[1];
    }
    i++;
  }
  if (!card) throw new RuleParseError("フロントマターに card: \"[[カード名]]\" がない", 1);

  const abilities: Ability[] = [];
  const unsupported: string[] = [];
  let inNote = false; // 「## 未対応」の中。箇条書きはノードではなく、文章のまま集める
  for (; i < lines.length; i++) {
    const line = i + 1;
    const h = lines[i].match(/^##\s+(.+?)\s*$/);
    if (h) {
      inNote = h[1] === NOTE;
      if (inNote) continue;
      const kind = HEADINGS[h[1]];
      if (!kind) throw new RuleParseError(`未知の見出し: ${h[1]}`, line);
      abilities.push({ kind, body: [] });
      continue;
    }
    const item = lines[i].match(/^[\s　]*[-*][\s　]+(.*)$/);
    if (!item) continue; // 空行・メモは読み飛ばす
    if (inNote) {
      unsupported.push(item[1].trim());
      continue;
    }
    if (!abilities.length) throw new RuleParseError("見出し (呪文能力 など) の前に箇条書きがある", line);
    abilities[abilities.length - 1].body.push(parseCall(item[1], line));
  }
  return unsupported.length ? { card, abilities, unsupported } : { card, abilities };
}

const show = (a: Arg): string => {
  if (typeof a === "object") return `$${a.ref}`;
  if (typeof a !== "string") return String(a);
  const plain = /^[^\s"$=]+$/.test(a) && !/^-?\d+$/.test(a) && a !== "true" && a !== "false";
  return plain ? a : `"${a}"`;
};

export function writeRule(rule: CardRule): string {
  let out = `---\nmtg: rule\ncard: "[[${rule.card}]]"\n---\n`;
  for (const a of rule.abilities) {
    const body = a.body.map((c) => `- ${[c.node, ...(c.as ? [`as=${c.as}`] : []), ...(c.if ? [`if=${c.if}`] : []), ...Object.entries(c.args).map(([k, v]) => `${k}=${show(v)}`)].join(" ")}`);
    out += `\n## ${HEADING_OF[a.kind]}\n\n${body.join("\n")}\n`;
  }
  if (rule.unsupported?.length) out += `\n## ${NOTE}\n\n${rule.unsupported.map((u) => `- ${u}`).join("\n")}\n`;
  return out;
}
