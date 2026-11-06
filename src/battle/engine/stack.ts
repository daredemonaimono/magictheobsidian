import { NodeCall, RunCtx, Value } from "../node";
import { evalCondition, getNode } from "../registry";
import { Game, RuleBook, putInGraveyard } from "../state";
import { isPermanentCard, live, resolveArgs, spellBody } from "./shared";
import { enterBattlefield } from "./battlefield";
import { flushEvents } from "./triggers";

// スタックの解決

// 一番上の呪文・能力を解決する。対象のノードがあるのに全部が不正になっていたら、何もせず (呪文は墓地へ)。実装の無いノードは飛ばして記録する。
// パーマネント呪文は、先に戦場に出てから効果を実行する (オーラが、出た自分を付けるため)
export function resolveTop(g: Game, rules: RuleBook): void {
  live(g);
  const item = g.stack.pop();
  if (!item) return;
  const body = item.body ?? spellBody(rules, item.card) ?? [];
  const ctx = (call: NodeCall, vars: Record<string, Value>): RunCtx => ({ game: g, rules, item, vars, call });
  // 条件を満たす対象のノードのうち、1つでも対象が残っていれば解決する (残った対象にだけ効く)。選ばれなかったモードの対象は数えない
  const targets = body.filter((c) => getNode(c.node)?.isTarget && (c.if === undefined || evalCondition(c.if, ctx(c, {}))));
  const fizzled = targets.length > 0 && !targets.some((c) => getNode(c.node)!.run!(ctx(c, {}), resolveArgs(c, {})!).id !== undefined);
  if (fizzled) g.log.push(`${item.card.name}: 対象が無くなったので解決しない`);
  const permanent = !item.ability && isPermanentCard(item.card);
  if (permanent && !fizzled) {
    enterBattlefield(g, item.card, item.controller, rules, item.cast);
    item.source = item.card.id;
  }
  if (!fizzled) {
    const vars: Record<string, Value> = item.x !== undefined ? { X: item.x } : {}; // 起動時に選んだ X は、$X として参照できる
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
  // 起動型・誘発型能力は、解決してもカードは動かない。パーマネント呪文は戦場へ(解決しなかったときは墓地へ)、インスタント・ソーサリーは墓地へ
  if (!item.ability && !item.copy && !(permanent && !fizzled)) putInGraveyard(g, item.card, "stack"); // 呪文のコピーは、墓地に行かず消える
  flushEvents(g, rules);
}
