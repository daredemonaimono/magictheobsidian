import { NodeCall, NodeDef } from "./node";

const nodes = new Map<string, NodeDef>();

export function defineNode(def: NodeDef): void {
  if (nodes.has(def.id)) throw new Error(`ノードが二重に定義された: ${def.id}`);
  nodes.set(def.id, def);
}
export const getNode = (id: string): NodeDef | undefined => nodes.get(id);
export const allNodes = (): NodeDef[] => [...nodes.values()];
export const resetRegistry = (): void => nodes.clear(); // テスト用

// 問題なければ null、あれば日本語の理由
export function checkCall(call: NodeCall): string | null {
  const def = nodes.get(call.node);
  if (!def) return `未知のノード: ${call.node}`;
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
