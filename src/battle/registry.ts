import { NodeCall, NodeDef, RunCtx } from "./node";

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
// 問題なければ null
export const checkCondition = (expr: string): string | null => (conditions.has(expr.startsWith("!") ? expr.slice(1) : expr) ? null : `未知の条件: ${expr}`);
export function evalCondition(expr: string, ctx: RunCtx): boolean {
  const neg = expr.startsWith("!");
  const r = conditions.get(neg ? expr.slice(1) : expr)?.test(ctx) ?? false;
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

// 問題なければ null、あれば日本語の理由
export function checkCall(call: NodeCall): string | null {
  const def = nodes.get(call.node);
  if (!def) return `未知のノード: ${call.node}`;
  if (call.if !== undefined) {
    if (def.isTarget) return "対象を決めるノードには条件を付けられない"; // 唱えるときの対象の検査が条件を見ないため
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
  }
  for (const name of Object.keys(call.args)) if (!(name in def.params)) return `未知の引数: ${name}`;
  return null;
}
