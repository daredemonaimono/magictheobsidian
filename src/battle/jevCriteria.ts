import { JevQuestion } from "./jev";
import defaults from "./jev-criteria.json";

// Jev の判断基準の定義 (src/battle/jev-criteria.json)。コードは、判断ごとにデッキの数字を計算して state に入れ、この質問を Jev に聞く。
// Jev の答え (確率・段階) は、AI に渡す材料にする (AI が最終判断する)。質問を直すときは、JSON だけを直す (コードは、デッキごとに増やさない)
export type Scope = "once" | "each"; // once = 1 回 / each = 対象 (攻撃クリーチャー・手札のカード) ごと。{label} が、対象の説明になる
export interface QuestionDef {
  id: string;
  title?: string; // AI への文章に出す、短い名前
  type: "noul" | "choice" | "score";
  scope: Scope;
  instructions: string;
  criteria?: unknown; // noul: { true, false } / choice: { 名前: 説明 } / score: [段階…]
}
export interface Criteria {
  version: number;
  about?: string;
  facts: Record<string, string>;
  cards: { about?: string; questions: QuestionDef[] };
  decisions: Record<string, { about?: string; questions: QuestionDef[] }>;
}
export const DEFAULT_CRITERIA = defaults as unknown as Criteria;
export const MAX_QUESTIONS = 10; // 1 回のリクエストで聞ける数 (Jev の上限)

const ID = /^[a-z][A-Za-z0-9]*$/;
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

// 定義の間違いを、すべて、文章で返す (空なら、使える)
export function validateCriteria(c: unknown): string[] {
  const out: string[] = [];
  const cr = c as Criteria;
  if (!cr || typeof cr !== "object") return ["定義が、オブジェクトではない"];
  if (cr.version !== 1) out.push(`version は 1 (いまは ${String(cr.version)})`);
  const checkList = (where: string, qs: unknown, limitEach = true) => {
    if (!Array.isArray(qs) || !qs.length) return void out.push(`${where}: questions が、空か、配列ではない`);
    const seen = new Set<string>();
    for (const q of qs as QuestionDef[]) {
      const at = `${where}.${q?.id ?? "?"}`;
      if (!ID.test(String(q?.id))) out.push(`${at}: id は、小文字で始まる英数字`);
      else if (seen.has(q.id)) out.push(`${at}: id が重複`);
      else seen.add(q.id);
      if (!isStr(q?.instructions)) out.push(`${at}: instructions が空`);
      if (q?.scope !== "once" && q?.scope !== "each") out.push(`${at}: scope は once か each`);
      const k = q?.criteria as unknown;
      if (q?.type === "noul") {
        const o = k as { true?: unknown; false?: unknown } | undefined;
        if (k !== undefined && (typeof k !== "object" || Array.isArray(k) || (o?.true !== undefined && !isStr(o.true)) || (o?.false !== undefined && !isStr(o.false)))) out.push(`${at}: noul の criteria は { true, false } (文字列)`);
      } else if (q?.type === "choice") {
        const keys = k && typeof k === "object" && !Array.isArray(k) ? Object.keys(k) : [];
        if (keys.length < 1 || keys.length > 255) out.push(`${at}: choice の criteria は、選択肢 1〜255 個のオブジェクト`);
      } else if (q?.type === "score") {
        if (!Array.isArray(k) || k.length < 2 || k.length > 10 || !k.every(isStr)) out.push(`${at}: score の criteria は、段階 2〜10 個の配列 (低い順)`);
      } else out.push(`${at}: type は noul / choice / score`);
    }
    if (limitEach && (qs as QuestionDef[]).filter((q) => q?.scope === "once").length > MAX_QUESTIONS) out.push(`${where}: once の質問が ${MAX_QUESTIONS} 個を超えている`);
  };
  if (!cr.facts || typeof cr.facts !== "object") out.push("facts が無い");
  checkList("cards", cr.cards?.questions);
  if (!cr.decisions || typeof cr.decisions !== "object") out.push("decisions が無い");
  else for (const [name, d] of Object.entries(cr.decisions)) checkList(`decisions.${name}`, d?.questions);
  return out;
}

// 定義 → Jev に送る質問。once はそのまま。each は、対象ごとに、`<id>_<番号>` で 1 つずつ ({label} を置き換える)
export function toJevQuestions(defs: QuestionDef[], items: { id: string; label: string }[] = []): Record<string, JevQuestion> {
  const out: Record<string, JevQuestion> = {};
  const make = (q: QuestionDef, instructions: string): JevQuestion => ({ type: q.type, instructions, ...(q.criteria !== undefined ? { criteria: q.criteria } : {}) } as JevQuestion);
  for (const q of defs) {
    if (q.scope === "once") out[q.id] = make(q, q.instructions);
    else items.forEach((it, i) => (out[`${q.id}_${i}`] = make(q, q.instructions.split("{label}").join(it.label))));
  }
  return out;
}

// 1 回のリクエストの上限 (10) ごとに、質問を分ける
export function chunkQuestions(qs: Record<string, JevQuestion>): Record<string, JevQuestion>[] {
  const keys = Object.keys(qs);
  const out: Record<string, JevQuestion>[] = [];
  for (let i = 0; i < keys.length; i += MAX_QUESTIONS) out.push(Object.fromEntries(keys.slice(i, i + MAX_QUESTIONS).map((k) => [k, qs[k]])));
  return out;
}
