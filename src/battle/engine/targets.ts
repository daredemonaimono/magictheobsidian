import { CastRecord, NodeCall, RunCtx, Value } from "../node";
import { checkCall, evalCondition, getNode } from "../registry";
import { Game, RuleBook, StackItem } from "../state";
import { RuleError, beforeReflexive, resolveArgs } from "./shared";

// 対象 (合法な対象・選ぶ・検査・モード)

// 対象を取るノードごとに、いま選べる合法な対象の一覧 (条件 if= を満たすノードだけ)。唱える・起動するときの対象の選択 (画面・CPU) と、誘発時の自動選択が使う
export interface TargetSlot {
  as: string; // ノードの as (targets のキー)
  min: number;
  max: number;
  legal: string[];
  zone: string;
  kind: string;
}

export function targetSlots(g: Game, rules: RuleBook, item: StackItem): TargetSlot[] {
  const out: TargetSlot[] = [];
  for (const call of beforeReflexive(item.body ?? [])) {
    const def = getNode(call.node);
    if (!def?.isTarget) continue;
    const ctx: RunCtx = { game: g, rules, item, vars: {}, call };
    if (call.if !== undefined && !evalCondition(call.if, ctx)) continue;
    const a = call.args as Record<string, Value>; // 対象のノードの引数は、参照ではない
    const min = typeof a.min === "number" ? a.min : 1;
    const max = typeof a.max === "number" ? a.max : Math.max(1, min);
    const pool = a.zone === "stack" ? g.stack.filter((x) => !x.ability).map((x) => x.id) : a.zone === "battlefield" ? g.battlefield.map((x) => x.id) : a.zone === "any" ? [...g.players, ...g.battlefield.map((x) => x.id)] : a.zone === "graveyard" ? Object.values(g.graveyards).flat().map((c) => c.id) : g.players;
    const legal = pool.filter((id) => def.run!({ ...ctx, item: { ...item, targets: { [call.as ?? ""]: id } } }, a).id !== undefined);
    out.push({ as: call.as ?? "", min, max, legal, zone: String(a.zone), kind: String(a.kind) });
  }
  return out;
}

// 誘発型能力を積むとき、対象を自動で選ぶ (誘発時に対象を選ぶ)。合法な対象を先頭から max 個 (g.decide.target で差し替え可)。min に足りなければ、能力は積まれない (false)
export function chooseTargets(g: Game, item: StackItem, rules: RuleBook): boolean {
  for (const slot of targetSlots(g, rules, item)) {
    const call = (item.body ?? []).find((c) => (c.as ?? "") === slot.as && getNode(c.node)?.isTarget)!;
    const picked = (g.decide?.target?.(g, item, call, slot.legal) ?? slot.legal.slice(0, slot.max)).filter((id) => slot.legal.includes(id)).slice(0, slot.max);
    if (picked.length < slot.min) return false;
    item.targets[slot.as] = picked.join(",");
  }
  return true;
}

// shortcut: 条件 if=$名前 (前のノードの出力) の付いた対象のノードは、唱えるとき・解決の対象確認のときは、条件を満たさない扱い (出力がまだ無いため)。「そうしたなら、対象の〜」の対象は、唱えるときに選べない
// 全ノードの検証 (checkCall) と、対象がすべて合法か。だめなら RuleError。
// 条件 (if=) を満たさないノードの対象は求めない (選ばれなかったモード、キッカーされなかったときの対象など)。条件は唱えるときの選択 (item.cast) で決まる
export function validate(g: Game, item: StackItem, body: NodeCall[], name: string, rules: RuleBook): void {
  for (const call of body) {
    const bad = checkCall(call);
    if (bad) throw new RuleError(`${name}: ${bad}`);
  }
  for (const call of beforeReflexive(body)) {
    const def = getNode(call.node)!;
    const ctx: RunCtx = { game: g, rules, item, vars: {}, call, phase: "cast" };
    if (!def.isTarget || (call.if !== undefined && !evalCondition(call.if, ctx))) continue;
    if (def.run!(ctx, resolveArgs(call, {})!).id === undefined) throw new RuleError(`合法な対象が無い: ${name} (${call.as ?? "?"})`);
  }
}

// モードの選び方 (modes の宣言): min〜max 個、1〜count 番、重複なし。宣言が無いのにモードを選ぶのもだめ
export function checkModes(body: NodeCall[], cast: CastRecord, name: string): void {
  const decl = body.find((c) => c.node === "modes");
  const modes = cast.modes ?? [];
  if (!decl) {
    if (modes.length) throw new RuleError(`${name}: モードの宣言 (modes) が書かれていない`);
    return;
  }
  const [count, min, max] = [Number(decl.args.count), Number(decl.args.min), Number(decl.args.max)];
  if (modes.length < min || modes.length > max || new Set(modes).size !== modes.length || modes.some((m) => !Number.isInteger(m) || m < 1 || m > count)) {
    throw new RuleError(`${name}: モードの選び方が不正 (${min === max ? min : `${min}〜${max}`} 個を、1〜${count} 番から。重複なし)`);
  }
}
