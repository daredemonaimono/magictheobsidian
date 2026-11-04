import { CastRecord, NodeCall, RunCtx, Value } from "./node";
import { checkCall, evalCondition, getNode } from "./registry";
import { Game, GameCard, Perm, PlayerId, RuleBook, StackItem, Step, statsOf } from "./state";

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

// 全ノードの検証 (checkCall) と、対象がすべて合法か。だめなら RuleError。
// 条件 (if=) を満たさないノードの対象は求めない (選ばれなかったモード、キッカーされなかったときの対象など)。条件は唱えるときの選択 (item.cast) で決まる
function validate(g: Game, item: StackItem, body: NodeCall[], name: string): void {
  for (const call of body) {
    const bad = checkCall(call);
    if (bad) throw new RuleError(`${name}: ${bad}`);
  }
  for (const call of body) {
    const def = getNode(call.node)!;
    const ctx: RunCtx = { game: g, item, vars: {}, call, phase: "cast" };
    if (!def.isTarget || (call.if !== undefined && !evalCondition(call.if, ctx))) continue;
    if (def.run!(ctx, resolveArgs(call, {})!).id === undefined) throw new RuleError(`合法な対象が無い: ${name} (${call.as ?? "?"})`);
  }
}

// モードの選び方 (modes の宣言): min〜max 個、1〜count 番、重複なし。宣言が無いのにモードを選ぶのもだめ
function checkModes(body: NodeCall[], cast: CastRecord, name: string): void {
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

// コスト (cost / additionalCost のノードから集める)。マナの色は区別しない。shortcut: 色・種類ごとのマナは、マナの仕組みを作るときに
interface CostSpec {
  mana: number;
  tap: boolean;
  sacrifice: boolean;
  tapCreatures: number;
}
const costOf = (calls: NodeCall[]): CostSpec => ({
  mana: calls.reduce((a, c) => a + Number(c.args.mana ?? 0), 0),
  tap: calls.some((c) => c.args.tap === true),
  sacrifice: calls.some((c) => c.args.sacrifice === true),
  tapCreatures: calls.reduce((a, c) => a + Number(c.args.tapCreatures ?? 0), 0),
});

// 払えるか。払えなければ理由 (状態は変えない)。tapIds = パワーの合計のためにタップするクリーチャー
function costProblem(g: Game, p: PlayerId, cost: CostSpec, source: Perm | undefined, tapIds: string[]): string | null {
  if ((g.mana[p] ?? 0) < cost.mana) return `マナが足りない (${cost.mana} 要る)`;
  if (cost.tap && (!source || source.tapped)) return "すでにタップされていて、タップできない";
  if (cost.tapCreatures > 0) {
    if (new Set(tapIds).size !== tapIds.length) return "同じクリーチャーを2回選んでいる";
    let power = 0;
    for (const id of tapIds) {
      const c = g.battlefield.find((x) => x.id === id);
      if (!c || c.controller !== p || c.tapped || !/\bCreature\b/.test(c.card.typeLine) || (source && c.id === source.id && cost.tap)) return `タップできるクリーチャーではない: ${id}`;
      power += statsOf(c)?.power ?? 0;
    }
    if (power < cost.tapCreatures) return `タップしたクリーチャーのパワーの合計が足りない (${power} / ${cost.tapCreatures})`;
  }
  return null;
}

function payCost(g: Game, p: PlayerId, cost: CostSpec, source: Perm | undefined, tapIds: string[]): void {
  g.mana[p] = (g.mana[p] ?? 0) - cost.mana;
  if (cost.tap && source) source.tapped = true;
  if (cost.tapCreatures > 0) for (const id of tapIds) g.battlefield.find((x) => x.id === id)!.tapped = true;
  if (cost.sacrifice && source) {
    g.battlefield = g.battlefield.filter((x) => x !== source);
    g.graveyards[source.card.owner].push(source.card);
  }
}

// 唱える。手札にある・いま唱えられる・ルールがある・追加コストを払える・対象がすべて合法、のどれかが欠けると RuleError で、状態は変えない。
// cast = 唱えるときの選択 (kicked / teamwork = 追加コストを払う、tap = チームワークでタップするクリーチャー)。宣言 (additionalCost) の無いフラグは選べない
export function castSpell(g: Game, p: PlayerId, cardId: string, targets: Record<string, string>, rules: RuleBook, cast: CastRecord = {}): void {
  const card = g.hands[p]?.find((c) => c.id === cardId);
  if (!card) throw new RuleError(`手札に無い: ${cardId}`);
  if (!canCastNow(g, p, card)) throw new RuleError(`いまは唱えられない: ${card.name}`);
  const body = spellBody(rules, card);
  if (!body) throw new RuleError(`呪文能力のルールが無い: ${card.name}`);
  const item: StackItem = { id: card.id, card, controller: p, targets, cast };
  checkModes(body, cast, card.name);
  validate(g, item, body, card.name);
  const chosen = (["kicked", "teamwork"] as const).filter((f) => cast[f]);
  const decls = chosen.flatMap((f) => {
    const d = body.filter((c) => c.node === "additionalCost" && c.args.flag === f);
    if (!d.length) throw new RuleError(`${card.name}: ${f} の追加コストが書かれていない`);
    return d;
  });
  const cost = costOf(decls);
  const why = costProblem(g, p, cost, undefined, cast.tap ?? []);
  if (why) throw new RuleError(`${card.name}: ${why}`);
  payCost(g, p, cost, undefined, cast.tap ?? []);
  g.hands[p] = g.hands[p].filter((c) => c !== card);
  g.stack.push(item);
  g.priority = p;
  g.passes = [];
}

// 戦場のパーマネントの起動型能力を起動する (index = そのカードの起動型能力の何番目か)。コストを払い、マナだけの能力 (addMana のみ) は即座に実行、
// それ以外はスタックに積む。優先権が必要。払えない・対象が不正なら RuleError で、状態は変えない
export function activateAbility(g: Game, p: PlayerId, permId: string, index: number, targets: Record<string, string>, rules: RuleBook, tapIds: string[] = []): void {
  const perm = g.battlefield.find((x) => x.id === permId);
  if (!perm) throw new RuleError(`戦場に無い: ${permId}`);
  if (perm.controller !== p) throw new RuleError(`${p} のコントロールするパーマネントではない: ${permId}`);
  if (g.priority !== p) throw new RuleError(`${p} は優先権を持っていない`);
  const ab = rules.get(perm.card.name)?.abilities.filter((a) => a.kind === "activated")[index];
  if (!ab) throw new RuleError(`起動型能力が無い: ${perm.card.name} (${index} 番目)`);
  const effects = ab.body.filter((c) => c.node !== "cost");
  const item: StackItem = { id: `${perm.id}#${g.serial + 1}`, card: perm.card, controller: p, targets, cast: {}, body: effects, ability: true };
  validate(g, item, ab.body, perm.card.name);
  const cost = costOf(ab.body.filter((c) => c.node === "cost"));
  const why = costProblem(g, p, cost, perm, tapIds);
  if (why) throw new RuleError(`${perm.card.name}: ${why}`);
  payCost(g, p, cost, perm, tapIds);
  g.serial++;
  if (effects.length && effects.every((c) => c.node === "addMana")) {
    for (const call of effects) getNode(call.node)!.run!({ game: g, item, vars: {}, call }, resolveArgs(call, {})!); // マナ能力はスタックを使わない
    return;
  }
  g.stack.push(item);
  g.priority = p;
  g.passes = [];
}

// 一番上の呪文を解決する。対象のノードがあるのに全部が不正になっていたら、何もせず墓地へ。実装の無いノードは飛ばして記録する
export function resolveTop(g: Game, rules: RuleBook): void {
  const item = g.stack.pop();
  if (!item) return;
  const body = item.body ?? spellBody(rules, item.card) ?? [];
  const ctx = (call: NodeCall, vars: Record<string, Value>): RunCtx => ({ game: g, item, vars, call });
  // 条件を満たす対象のノードのうち、1つでも対象が残っていれば解決する (残った対象にだけ効く)。選ばれなかったモードの対象は数えない
  const targets = body.filter((c) => getNode(c.node)?.isTarget && (c.if === undefined || evalCondition(c.if, ctx(c, {}))));
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
  if (!item.ability) g.graveyards[item.card.owner].push(item.card); // 起動型能力は、解決してもカードは墓地に行かない
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
