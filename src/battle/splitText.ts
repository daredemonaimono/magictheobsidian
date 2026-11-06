// 効果テキスト (英語のオラクル) を、コードで、小さな単位に切る (純粋な関数)。AI に丸ごと渡さず、切った結果だけを渡すための、最初の段。
// 能力 (キーワード / 起動型 / 誘発型 / 呪文 / 常在型) → 節 (1つの動作) → 節ごとに、数字・対象・プレイヤー・ノードの候補 を取り出す。
// 数えることや、数字の読み取りは、コードがする (Jev など、選ぶモデルは、数えるのが苦手)。ノードの候補は、辞書 (LEXICON) の形に合ったもの。どれにも合わない節は、effects が空 = 後ろの段 (AI) に回す
export type AbilityKind = "keyword" | "activated" | "triggered" | "spell" | "static";
export interface Clause {
  text: string;
  effects: string[]; // ノードの候補 (辞書に合ったもの。複数ありうる)
  numbers: (number | "X")[]; // 節の中の数字 (単語も数に直す。a / an は 1)
  targets: string[]; // 「target 〜」の句
  players: ("you" | "opponent" | "target" | "each")[]; // 節に出てくるプレイヤーの言い方
}
export interface Ability {
  kind: AbilityKind;
  text: string;
  cost?: string; // 起動型: コロンの前
  condition?: string; // 誘発型: 「When / Whenever / At …」の部分 (カンマの前)
  keywords?: string[]; // キーワード行
  clauses: Clause[];
}

import { allNodes } from "./registry";

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const NUM = "(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\\d+)";

// 節 → ノードの候補。辞書は、ノード側 (NodeDef.patterns。src/battle/nodes/keys.ts) が持つ。ノードの数が変わったら、作り直す
let lexCache: { n: number; lex: [RegExp, string][] } | undefined;
export function lexicon(): [RegExp, string][] {
  const nodes = allNodes();
  if (lexCache && lexCache.n === nodes.length) return lexCache.lex;
  const lex: [RegExp, string][] = [];
  for (const n of nodes) for (const p of n.patterns ?? []) lex.push([new RegExp(p), n.id]);
  lexCache = { n: nodes.length, lex };
  return lex;
}

const num = (s: string): number | "X" => (s.toLowerCase() === "x" ? "X" : WORDS[s.toLowerCase()] ?? Number(s));

// 括弧の注釈 (reminder text) を除く
const stripReminder = (s: string): string => s.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();

// 節に切る: 文の終わり・「. Then」・「, then」・「; 」・「 If you do, 」で
export function splitClauses(text: string): string[] {
  const t = stripReminder(text);
  return t
    .split(/(?<=[.!?])\s+|;\s+|,\s+then\s+|\s+then\s+(?=[a-z])/i)
    .map((s) => s.trim().replace(/[.]$/, ""))
    .filter(Boolean);
}

export function analyzeClause(raw: string): Clause {
  const text = raw.trim();
  const low = text.toLowerCase();
  const effects: string[] = [];
  for (const [re, id] of lexicon()) if (re.test(low) && !effects.includes(id)) effects.push(id);
  const numbers: Clause["numbers"] = [];
  for (const m of low.matchAll(new RegExp(`\\b${NUM}\\b`, "g"))) {
    const v = num(m[0]);
    if (v === "X" || !Number.isNaN(v)) numbers.push(v);
  }
  const targets = [...low.matchAll(/\btarget ([a-z ]+?)(?= (?:to|and|or|from|with|you|that|can't|loses|gains|draws|discards|deals|gets|becomes|puts?|unless|if|until)\b|[,.{]|$)/g)].map((m) => m[1].trim());
  const players: Clause["players"] = [];
  if (/\btarget (?:player|opponent)\b/.test(low)) players.push("target");
  if (/\beach (?:opponent|player)\b/.test(low)) players.push("each");
  if (/\b(?:you|your)\b/.test(low)) players.push("you");
  if (/\b(?:an |each )?opponents?\b/.test(low) && !players.includes("target")) players.push("opponent");
  return { text, effects, numbers, targets, players };
}

const KEYWORDS = /^(?:flash|flying|reach|haste|trample|vigilance|lifelink|deathtouch|first strike|double strike|menace|hexproof|indestructible|defender|prowess|exalted|ward|cycling|flashback|delve|storm|kicker|convoke|affinity|unearth|evoke|equip|enchant|crew|(?:protection from [a-z ]+))(?:\s|\{|$)/i;

// 能力 (行) の種類と、中身
export function splitAbility(line: string): Ability {
  const whole = line.trim().match(/^\((.+)\)$/); // 全体が括弧の行 (基本土地の「({T}: Add {G}.)」): 注釈ではなく、能力として読む
  const text = whole ? stripReminder(whole[1]) : stripReminder(line);
  const kw = text.split(/,\s*/);
  if (kw.length && kw.every((k) => KEYWORDS.test(k.trim() + " "))) {
    const keywords = kw.map((k) => k.trim().toLowerCase());
    const attach = keywords.some((k) => /^(?:equip|enchant)\b/.test(k)); // 装備・オーラは、「付ける」動作
    return { kind: "keyword", text, keywords, clauses: attach ? [{ text, effects: ["attach"], numbers: [], targets: [], players: [] }] : [] };
  }
  const colon = text.match(/^((?:[+−-]?\d+|[+−-]?x|\{[^}]+\}[^:]*|sacrifice [^:]+|discard [^:]+|pay [^:]+)):\s*(.+)$/i) ?? text.match(/^([^:.]{1,80}):\s+(.+)$/);
  if (colon) return { kind: "activated", text, cost: colon[1].trim(), clauses: splitClauses(colon[2]).map(analyzeClause) };
  const trig = text.match(/^((?:when|whenever|at the beginning of|at)\b[^,]*),\s*(.+)$/i);
  if (trig) return { kind: "triggered", text, condition: trig[1].trim(), clauses: splitClauses(trig[2]).map(analyzeClause) };
  const stat = /^(?:each|all|creatures|players|spells|nonbasic|activated abilities|[a-z ]+ (?:can't|enter|have|get)s?\b)/i.test(text) && /\b(?:can't|enters? (?:the battlefield )?tapped|have|has|get|gets)\b/i.test(text);
  return { kind: stat ? "static" : "spell", text, clauses: splitClauses(text).map(analyzeClause) };
}

// オラクルの本文 (型行を含んでよい) → 能力の並び。型行だけの行は飛ばす
const TYPE_LINE = /^(?:(?:legendary|basic|snow|world|tribal|artifact|creature|enchantment|instant|sorcery|land|planeswalker|battle|token|kindred)\b[\w\s—-]*)$/i;
export function splitOracle(oracle: string): Ability[] {
  return oracle
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !TYPE_LINE.test(l) && !/^\*/.test(l))
    .map(splitAbility);
}

// この能力のノードの候補 (動作の、順番つきの、重ならない並び)
export const effectsOf = (abilities: Ability[]): string[] => [...new Set(abilities.flatMap((a) => a.clauses.flatMap((c) => c.effects)))];
