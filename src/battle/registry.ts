import { AbilityKind, NodeCall, NodeDef, RunCtx } from "./node";

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
    if (p.type === "ref" ? !isRef : isRef || typeof v !== p.type) return `型が違う: ${name}`;
    if (p.choices && !p.choices.includes(String(v))) return `選べない値: ${name}=${v}`;
    if (p.min !== undefined && typeof v === "number" && v < p.min) return `値が小さすぎる: ${name} (${p.min} 以上)`;
    if (p.max !== undefined && typeof v === "number" && v > p.max) return `値が大きすぎる: ${name} (${p.max} 以下)`;
  }
  for (const name of Object.keys(call.args)) if (!(name in def.params)) return `未知の引数: ${name}`;
  return null;
}
