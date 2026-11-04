import { Ability, AbilityKind, NodeCall, NodeDef, RunCtx } from "./node";

const nodes = new Map<string, NodeDef>();

// 条件: ノードに if=<条件> を付けると、そのときだけ実行する (if=!<条件> は否定)。「〜なら」「代わりに」を、ノードを増やさずに表す、汎用のつなぎの言葉
export interface Condition {
  id: string;
  title: string; // 日本語名
  summary: string;
  test: (ctx: RunCtx) => boolean;
}
const conditions = new Map<string, Condition>();
export function defineCondition(c: Condition): void {
  if (conditions.has(c.id)) throw new Error(`条件が二重に定義された: ${c.id}`);
  conditions.set(c.id, c);
}
export const allConditions = (): Condition[] => [...conditions.values()];
// 数の条件 (カード専用にしない、汎用の形): <場所>:<型>:<数>[+|-]  例: graveyard:lesson:3+ (自分の墓地に Lesson が3枚以上) / hand:any:0 (手札が0枚) / library:any:5- (ライブラリーが5枚以下)
// 場所は graveyard / hand / library / battlefield (コントローラーのもの)、型は型行に含まれる語 (any = すべて)。+ は以上、- は以下、無印はちょうど
const COUNT = /^(graveyard|hand|library|battlefield):([^:\s]+):(\d+)([+-]?)$/;
const bare = (expr: string) => (expr.startsWith("!") ? expr.slice(1) : expr);

// 問題なければ null
export const checkCondition = (expr: string): string | null => (conditions.has(bare(expr)) || COUNT.test(bare(expr)) ? null : `未知の条件: ${expr}`);
export function evalCondition(expr: string, ctx: RunCtx): boolean {
  const neg = expr.startsWith("!");
  const id = bare(expr);
  let r = conditions.get(id)?.test(ctx) ?? false;
  const m = id.match(COUNT);
  if (m) {
    const g = ctx.game;
    const p = ctx.item.controller;
    const cards = m[1] === "battlefield" ? g.battlefield.filter((x) => x.controller === p).map((x) => x.card) : m[1] === "graveyard" ? g.graveyards[p] : m[1] === "hand" ? g.hands[p] : g.libraries[p];
    const n = cards.filter((c) => m[2].toLowerCase() === "any" || c.typeLine.toLowerCase().includes(m[2].toLowerCase())).length;
    r = m[4] === "+" ? n >= Number(m[3]) : m[4] === "-" ? n <= Number(m[3]) : n === Number(m[3]);
  }
  return neg ? !r : r;
}

export function defineNode(def: NodeDef): void {
  if (nodes.has(def.id)) throw new Error(`ノードが二重に定義された: ${def.id}`);
  nodes.set(def.id, def);
}
export const getNode = (id: string): NodeDef | undefined => nodes.get(id);
export const allNodes = (): NodeDef[] => [...nodes.values()];
export const resetRegistry = (): void => {
  nodes.clear();
  conditions.clear();
}; // テスト用

const KIND_LABEL: Record<AbilityKind, string> = { spell: "呪文能力", activated: "起動型能力", triggered: "誘発型能力", static: "常在型能力" };

// そのノードを、その種類の能力に書いてよいか。だめなら理由 (cost を呪文能力に書くと、黙って無視されるため)
export function placementProblem(kind: AbilityKind, call: NodeCall): string | null {
  const only = nodes.get(call.node)?.only;
  return only && !only.includes(kind) ? `${call.node} は${only.map((k) => KIND_LABEL[k]).join("・")}だけに書ける` : null;
}

// 能力の構造: 誘発型能力の最初のノードは when (エンジンは先頭だけを見る。ほかの位置の when や、無い場合は、黙って誘発しない)。問題なければ null
export function structureProblem(ab: Ability): string | null {
  if (!ab.body.length) return null;
  if (ab.kind === "static") {
    // 継続効果のノードは affect で始まる常在型能力だけ (affect が先頭になければ、エンジンは読まない)
    const effects = ["staticModify", "staticGrant", "loseAbilities", "setBaseStats", "setTypes", "setColors", "setName", "extraTriggers"];
    if (ab.body[0].node !== "affect" && ab.body.some((c) => effects.includes(c.node))) return "継続効果のノードは、常在型能力の最初に affect (及ぶ先) を書く";
    if (ab.body.slice(1).some((c) => c.node === "affect")) return "affect は常在型能力の最初のノードだけに書ける";
    // keyword と reduceCost は、affect の無い常在型能力として読まれる (affect の後ろに書くと、黙って無視される)
    const stray = ab.body[0].node === "affect" ? ab.body.find((c) => c.node === "keyword" || c.node === "reduceCost" || c.node === "untapDuring") : undefined;
    if (stray) return `${stray.node} は、affect の後ろには書けない (affect の無い常在型能力に書く)`;
    return null;
  }
  if (ab.kind !== "triggered") return null;
  // 紋章の能力は、emblem で始まり、そのあとに when が続く
  const at = ab.body[0].node === "emblem" ? 1 : 0;
  if (ab.body[at]?.node !== "when") return "誘発型能力の最初のノードは when にする (誘発のきっかけ。紋章の能力は emblem のあとに when)";
  if (ab.body.slice(at + 1).some((c) => c.node === "when")) return "when は誘発型能力の最初のノードだけに書ける";
  if (ab.body.slice(1).some((c) => c.node === "emblem")) return "emblem は誘発型能力の最初のノードだけに書ける";
  return null;
}

export interface RefProblem {
  node: number; // 能力の中の何番目のノードか
  message: string;
}

// 参照 ($名前) の検査: 前のノードの as にあること / $X は −X の忠誠度能力の中だけ / 数の引数には数の出力、ref の引数には id の出力 / as の重複。
// ノード設定画面・AI の返事の検証・状況レポートで共通 (未定義の参照は、黙って何もしないため)
export function refProblems(ab: Ability): RefProblem[] {
  const out: RefProblem[] = [];
  const made = new Map<string, NodeCall>(); // as → それを作ったノード
  const hasX = ab.kind === "activated" && ab.body.some((c) => c.node === "cost" && c.args.loyaltyX === true);
  ab.body.forEach((c, n) => {
    const def = nodes.get(c.node);
    for (const [k, v] of Object.entries(c.args)) {
      if (typeof v !== "object") continue;
      if (v.ref === "X") {
        if (!hasX) out.push({ node: n, message: "$X は、−X の忠誠度能力 (cost loyaltyX=true) の中でだけ使える" });
        continue;
      }
      const from = made.get(v.ref);
      if (!from) {
        out.push({ node: n, message: `$${v.ref} が見つからない (前のノードの as に無い)` });
        continue;
      }
      const kinds = Object.values(nodes.get(from.node)?.outputs ?? {});
      const want = def?.params[k]?.type;
      if (want === "number" && !kinds.includes("number")) out.push({ node: n, message: `数の引数 ${k} に、数ではない出力 ($${v.ref}) を渡している` });
      if (want === "ref" && !kinds.includes("id")) out.push({ node: n, message: `${k} に、id ではない出力 ($${v.ref}) を渡している` });
    }
    if (c.as) {
      if (made.has(c.as)) out.push({ node: n, message: `as=${c.as} が重複している` });
      made.set(c.as, c);
    }
  });
  return out;
}

// 問題なければ null、あれば日本語の理由
export function checkCall(call: NodeCall): string | null {
  const def = nodes.get(call.node);
  if (!def) return `未知のノード: ${call.node}`;
  if (call.if !== undefined) {
    if (def.declaration) return `宣言のノード (${def.id}) には条件を付けられない`; // エンジンが条件を見ずに読むため
    const bad = checkCondition(call.if);
    if (bad) return bad;
  }
  for (const [name, p] of Object.entries(def.params)) {
    const v = call.args[name];
    if (v === undefined) {
      if (p.required) return `必須の引数がない: ${name}`;
      continue;
    }
    const isRef = typeof v === "object";
    // 対象・宣言のノードは、エンジンが前のノードの出力を解決せずに読む。参照は書けない (TypeError や NaN になるため)
    if (isRef && p.type !== "ref" && (def.isTarget || def.declaration)) return `このノードの引数には、参照を書けない: ${name}`;
    // 数の引数には、参照 ($X や countCards の出力) も書ける。ほかの型は、参照を書けない (ref の引数だけが参照)
    if (p.type === "ref" ? !isRef : p.type === "number" ? !isRef && typeof v !== "number" : isRef || typeof v !== p.type) return `型が違う: ${name}`;
    if (p.choices && !p.choices.includes(String(v))) return `選べない値: ${name}=${v}`;
    if (p.min !== undefined && typeof v === "number" && v < p.min) return `値が小さすぎる: ${name} (${p.min} 以上)`;
    if (p.max !== undefined && typeof v === "number" && v > p.max) return `値が大きすぎる: ${name} (${p.max} 以下)`;
  }
  for (const name of Object.keys(call.args)) if (!(name in def.params)) return `未知の引数: ${name}`;
  return null;
}
