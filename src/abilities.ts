// 能力ライブラリ (共有の能力)。1つの能力につき1つの定義: 実際の効果 (日本語)・引数・照合の例・処理 (関数の並び)。
// カードの記録は、{"ref":"能力のid","args":{...}} でこれを使う。カード固有の能力は、これまで通り、記録の中に直接書く。
// Obsidian に依存しない部分 (型・検証・展開・md の書き読み)。保存先は abilitystore.ts。
import { Ability, normalizeAbility, substitute, unsupportedIn } from "./effects";
import { KEYWORDS } from "./engine";
import type { NeedSpec } from "./pending";
import { TYPE_ENTRIES } from "./typecatalog";
import { KEYWORD_NAMES } from "./keywords";

export type AbilityStatus = "done" | "todo" | "needs"; // 処理済み / 未処理 / 実装待ち (新しい関数が要る)

export interface LibAbility {
  id: string; // 英数字
  title: string; // 日本語の名前
  effect: string; // 実際の効果 (日本語の標準の文。引数は {n} のように書く)
  params: Record<string, unknown>; // 引数と、その既定値
  examples: string[]; // 照合の例 (英語のオラクルテキスト。引数の所は {n} などでよい)
  ability?: unknown; // 処理: 1つの能力 (記録の書き方。引数は "$n")。無ければ、未処理
  keyword?: string; // エンジンが、キーワードとして自分で動かすもの (flying など)
  needs?: NeedSpec[]; // 新しい関数が要るときの仕様書
  created: string;
}

export const ABILITY_ID = /^[a-z][A-Za-z0-9]{1,40}$/;

export const keywordId = (k: string) => k.toLowerCase().replace(/[^a-z0-9]+(.)?/g, (_, c: string | undefined) => (c ?? "").toUpperCase()).replace(/^./, (c) => c.toLowerCase());

// 引数を入れた、記録の書き方の能力 (まだ検証していない生の形)。処理が無ければ undefined
export function instantiate(lib: LibAbility, args: Record<string, unknown> = {}): unknown | undefined {
  if (!lib.ability) return undefined;
  return substitute(JSON.parse(JSON.stringify(lib.ability)), { ...lib.params, ...args });
}

// 処理が正しく書けているか (既定の引数で、検証して、未対応が残らないか)
export function checkAbility(lib: LibAbility): { ok: boolean; error?: string } {
  if (!lib.ability) return { ok: false, error: "処理が無い" };
  const ab = normalizeAbility(instantiate(lib));
  if (!ab) return { ok: false, error: "能力の形が読めない (kind が不正など)" };
  const bad = unsupportedIn(ab.effects);
  return bad.length ? { ok: false, error: `未対応が残る: ${bad.join(" / ")}` } : { ok: true };
}

export function statusOf(lib: LibAbility): AbilityStatus {
  if (lib.keyword && KEYWORDS.includes(lib.keyword.toLowerCase()) && !lib.ability) return "done";
  if (lib.ability && checkAbility(lib).ok) return "done";
  return lib.needs?.length ? "needs" : "todo";
}

// AI や md から来た生の定義を、検証して、能力にする
export function validateLib(raw: unknown): { lib?: LibAbility; error?: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.id !== "string" || !ABILITY_ID.test(r.id)) return { error: "id は、英字で始まる英数字 (2〜41文字)" };
  if (typeof r.effect !== "string" || !r.effect.trim()) return { error: "effect (実際の効果の文) が空" };
  const lib: LibAbility = {
    id: r.id,
    title: typeof r.title === "string" && r.title ? r.title : r.id,
    effect: r.effect.trim(),
    params: r.params && typeof r.params === "object" && !Array.isArray(r.params) ? (r.params as Record<string, unknown>) : {},
    examples: Array.isArray(r.examples) ? r.examples.map(String).filter(Boolean) : [],
    ...(r.ability && typeof r.ability === "object" ? { ability: r.ability } : {}),
    ...(typeof r.keyword === "string" && r.keyword ? { keyword: r.keyword.toLowerCase() } : {}),
    ...(Array.isArray(r.needs) && r.needs.length ? { needs: r.needs as NeedSpec[] } : {}),
    created: typeof r.created === "string" ? r.created : new Date().toISOString(),
  };
  return { lib };
}

// ---- カードの記録の中の ref を、能力に展開する ----

// 未処理の能力を参照したときの、未対応の文の頭。記録を保存するときは、この文を保存せず、読み込むたびに展開から作り直す (能力が補完されたら、すぐ消えるように)
export const PLACEHOLDER = "未処理の能力";

export interface Ref {
  ability: string;
  args: Record<string, unknown>;
}

// raw = カードの記録の abilities の配列 (ref と、カード固有の能力が混ざる)。ref を、引数を入れた能力にする。
// 処理が無い (未処理) 能力は、「未対応」の印をつけた能力にする (エンジンは実行せず、ログとボットには、動かない部分として出る)
export function expandRefs(raw: unknown[], lib: Map<string, LibAbility>): { abilities: unknown[]; refs: Ref[] } {
  const refs: Ref[] = [];
  const abilities = raw.flatMap((x): unknown[] => {
    const o = (x ?? {}) as Record<string, unknown>;
    if (typeof o.ref !== "string") return [x];
    const args = (o.args && typeof o.args === "object" ? o.args : {}) as Record<string, unknown>;
    refs.push({ ability: o.ref, args });
    const l = lib.get(o.ref);
    if (!l) return [{ kind: "spell", effects: [{ do: "unsupported", text: `${PLACEHOLDER}「${o.ref}」が見つからない` }] }];
    const inst = instantiate(l, args);
    if (inst) return [inst];
    if (l.keyword && KEYWORDS.includes(l.keyword)) return []; // エンジンのキーワード (カードの keywords で動く)
    return [{ kind: "spell", effects: [{ do: "unsupported", text: `${PLACEHOLDER}「${l.title}」: ${l.effect}` }] }];
  });
  return { abilities, refs };
}

// ---- md の書き読み (保存先は隠しフォルダ。本文の JSON が元データで、ほかの節は、読むための表示) ----

export function libMd(l: LibAbility): string {
  const st = statusOf(l);
  return [
    "---",
    "mtg: bot-ability",
    `id: ${l.id}`,
    `status: ${st}`,
    "---",
    "",
    `# ${l.title}`,
    "",
    "## 実際の効果",
    "",
    l.effect,
    "",
    "## 引数",
    "",
    Object.keys(l.params).length ? Object.entries(l.params).map(([k, v]) => `- ${k} = ${JSON.stringify(v)}`).join("\n") : "- なし",
    "",
    "## 照合の例",
    "",
    l.examples.length ? l.examples.map((e) => `- ${e}`).join("\n") : "- なし",
    "",
    "## 処理 (関数)",
    "",
    "```json",
    JSON.stringify(l, null, 1),
    "```",
    "",
  ].join("\n");
}

export function parseLibMd(text: string): LibAbility | undefined {
  const m = text.match(/```json\n([\s\S]*?)\n```/);
  if (!m) return undefined;
  try {
    return validateLib(JSON.parse(m[1])).lib;
  } catch {
    return undefined;
  }
}

// ---- エンジンのキーワードの定義 (最初に、ライブラリに入れる) ----

export function keywordEntries(): LibAbility[] {
  return KEYWORDS.map((k) => {
    const e = TYPE_ENTRIES.find((x) => x.id === `kw.${k}`) ?? TYPE_ENTRIES.find((x) => x.id === "kw.landwalk");
    return { id: keywordId(k), title: KEYWORD_NAMES.ja?.[k] ?? k, effect: e?.summary ?? k, params: {}, examples: [k[0].toUpperCase() + k.slice(1)], keyword: k, created: new Date(0).toISOString() };
  });
}

// 未処理のキーワード: カードが持つキーワード (Scryfall の keywords) のうち、エンジンもライブラリも処理を持たないもの
export function unknownKeyword(k: string, lib: Map<string, LibAbility>): LibAbility | undefined {
  const id = keywordId(k);
  if (lib.has(id) || KEYWORDS.includes(k.toLowerCase())) return undefined;
  return { id, title: k, effect: `${k} (キーワード能力。処理はまだ無い)`, params: {}, examples: [k], keyword: k.toLowerCase(), created: new Date().toISOString() };
}

export type { Ability };
