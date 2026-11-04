import { CastRecord, NodeCall, RunCtx, Value } from "./node";
import { checkCall, evalCondition, getNode } from "./registry";
import { Game, GameCard, PlayerId, RuleBook, StackItem, Step } from "./state";

// ステップ進行・優先権・スタック。画面なしで、テストから動かせる

const STEPS: Step[] = ["untap", "upkeep", "draw", "main1", "combat", "main2", "end"];

export const nextPlayer = (g: Game, p: PlayerId): PlayerId => g.players[(g.players.indexOf(p) + 1) % g.players.length];

export class RuleError extends Error {}

const spellBody = (rules: RuleBook, card: GameCard): NodeCall[] | undefined => rules.get(card.name)?.abilities.find((a) => a.kind === "spell")?.body;

// {ref} を、前のノードの出力 (vars) に置き換える。まだ無い・消えた参照は undefined
function resolveArgs(call: NodeCall, vars: Record<string, Value>): Record<string, Value> | undefined {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(call.args)) {
    const x = typeof v === "object" ? vars[v.ref] : v;
    if (x === undefined) return undefined;
    out[k] = x;
  }
  return out;
}

// 唱える。手札にある・いま唱えられる・ルールがある・対象がすべて合法、のどれかが欠けると RuleError で、状態は変えない
export function castSpell(g: Game, p: PlayerId, cardId: string, targets: Record<string, string>, rules: RuleBook, cast: CastRecord = {}): void {
  const card = g.hands[p]?.find((c) => c.id === cardId);
  if (!card) throw new RuleError(`手札に無い: ${cardId}`);
  if (!canCastNow(g, p, card)) throw new RuleError(`いまは唱えられない: ${card.name}`);
  const body = spellBody(rules, card);
  if (!body) throw new RuleError(`呪文能力のルールが無い: ${card.name}`);
  const item: StackItem = { id: card.id, card, controller: p, targets, cast };
  for (const call of body) {
    const bad = checkCall(call);
    if (bad) throw new RuleError(`${card.name}: ${bad}`);
    const def = getNode(call.node)!;
    if (!def.isTarget) continue;
    const args = resolveArgs(call, {})!;
    if (!def.run!({ game: g, item, vars: {}, call }, args).id) throw new RuleError(`合法な対象が無い: ${card.name} (${call.as ?? "?"})`);
  }
  g.hands[p] = g.hands[p].filter((c) => c !== card);
  g.stack.push(item);
  g.priority = p;
  g.passes = [];
}

// 一番上の呪文を解決する。対象のノードがあるのに全部が不正になっていたら、何もせず墓地へ。実装の無いノードは飛ばして記録する
export function resolveTop(g: Game, rules: RuleBook): void {
  const item = g.stack.pop();
  if (!item) return;
  const body = spellBody(rules, item.card) ?? [];
  const ctx = (call: NodeCall, vars: Record<string, Value>): RunCtx => ({ game: g, item, vars, call });
  const targets = body.filter((c) => getNode(c.node)?.isTarget);
  const alive = targets.some((c) => getNode(c.node)!.run!(ctx(c, {}), resolveArgs(c, {})!).id !== undefined);
  if (targets.length && !alive) g.log.push(`${item.card.name}: 対象が無くなったので解決しない`);
  else {
    const vars: Record<string, Value> = {};
    for (const call of body) {
      if (call.if !== undefined && !evalCondition(call.if, ctx(call, vars))) continue; // 条件を満たさないノードは飛ばす
      const def = getNode(call.node);
      if (!def?.run) {
        g.log.push(`未実装: ${call.node}`);
        continue;
      }
      const args = resolveArgs(call, vars);
      if (!args) continue; // 前のノードが何も返さなかった (対象が消えた)
      const out = def.run(ctx(call, vars), args);
      if (call.as && Object.keys(out).length) vars[call.as] = Object.values(out)[0];
    }
  }
  g.graveyards[item.card.owner].push(item.card);
}

function advanceStep(g: Game): void {
  if (g.step === "end") {
    for (const p of g.battlefield) if (p.mods) p.mods = p.mods.filter((m) => m.until !== "endOfTurn"); // ターン終了時までの効果が消える
    g.active = nextPlayer(g, g.active);
    for (const p of g.battlefield) if (p.controller === g.active) p.tapped = false; // アンタップ・ステップ (優先権が無いので、ここで済ませてアップキープへ)
    g.step = "upkeep";
  } else g.step = STEPS[STEPS.indexOf(g.step) + 1];
  g.priority = g.active;
}

// 優先権を持つ人がパスする。全員が連続でパスしたら、スタックが空なら次のステップへ、空でなければ一番上だけを解決する
export function passPriority(g: Game, p: PlayerId, rules: RuleBook): "passed" | "resolved" | "stepEnded" {
  if (g.priority !== p) throw new Error(`${p} は優先権を持っていない`);
  g.passes.push(p);
  if (g.passes.length < g.players.length) {
    g.priority = nextPlayer(g, p);
    return "passed";
  }
  g.passes = [];
  if (!g.stack.length) {
    advanceStep(g);
    return "stepEnded";
  }
  resolveTop(g, rules);
  g.priority = g.active;
  return "resolved";
}

// 唱えられるタイミングは、カードタイプから決まる (ノードにはしない)
export function canCastNow(g: Game, p: PlayerId, card: GameCard): boolean {
  if (g.priority !== p) return false;
  if (/\bInstant\b/.test(card.typeLine) || card.flash) return true;
  return p === g.active && (g.step === "main1" || g.step === "main2") && g.stack.length === 0;
}
