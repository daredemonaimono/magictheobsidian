import { characteristics, costReduction, extraTriggers, untapsDuring } from "./continuous";
import { CastRecord, NodeCall, RunCtx, Value } from "./node";
import { checkCall, evalCondition, getNode } from "./registry";
import { addCosts, describeCost, emptyCost, ManaCost, parseManaCost, trySpend } from "./mana";
import { Game, GameCard, GameEvent, Perm, PlayerId, RuleBook, StackItem, Step, typeIn, untapPerm } from "./state";

// ステップ進行・優先権・スタック。画面なしで、テストから動かせる

const STEPS: Step[] = ["untap", "upkeep", "draw", "main1", "combat", "main2", "end"];

export const nextPlayer = (g: Game, p: PlayerId): PlayerId => g.players[(g.players.indexOf(p) + 1) % g.players.length];

export class RuleError extends Error {}

const isPermanentCard = (c: GameCard): boolean => !/\b(Instant|Sorcery)\b/.test(c.typeLine);

// ルールの常在型能力に書かれたキーワード (keyword name=…)
const staticKeywords = (rules: RuleBook, card: GameCard): string[] => (rules.get(card.name)?.abilities ?? []).filter((a) => a.kind === "static").flatMap((a) => a.body.filter((c) => c.node === "keyword").map((c) => String(c.args.name)));

// パーマネントを戦場に出す。「戦場に出た」イベントを積む (宣言されたキーワードは、characteristics が導く)
function enterBattlefield(g: Game, card: GameCard, controller: PlayerId): void {
  const perm: Perm = { id: card.id, card, controller };
  if (card.loyalty !== undefined) perm.counters = { loyalty: card.loyalty }; // プレインズウォーカーは、初期忠誠度で戦場に出る
  g.battlefield.push(perm);
  g.events.push({ type: "enters", perm });
}

// 戦場を離れる (墓地へ。トークンは消える)。「戦場を離れた」イベントを積む
function removeFromBattlefield(g: Game, perm: Perm): void {
  g.battlefield = g.battlefield.filter((x) => x !== perm);
  if (!perm.card.token) g.graveyards[perm.card.owner].push(perm.card);
  g.events.push({ type: "leaves", perm });
}

// 状態起因処理: 忠誠度 0 以下のプレインズウォーカー、タフネス 0 以下のクリーチャー、付いている先を失ったオーラは、墓地へ。落ち着くまで繰り返す
const live = (g: Game): void => {
  if (g.over) throw new RuleError("ゲームはもう終わっている");
};

function stateBased(g: Game, rules: RuleBook): void {
  for (let changed = true; changed; ) {
    changed = false;
    // 負け: ライフが 0 以下 / 空のライブラリーから引こうとした。残りが1人以下になったらゲームが終わる (残りが0人なら引き分け)
    const losers = g.players.filter((p) => !g.lost.includes(p) && (g.life[p] <= 0 || g.drewEmpty.includes(p)));
    g.drewEmpty = [];
    if (losers.length) {
      g.lost.push(...losers);
      const left = g.players.filter((p) => !g.lost.includes(p));
      if (left.length <= 1) g.over = left.length ? { winner: left[0] } : {};
    }
    for (const p of [...g.battlefield]) {
      const now = characteristics(g, p, rules);
      const dead =
        (/\bPlaneswalker\b/.test(now.typeLine) && (p.counters?.loyalty ?? 1) <= 0) ||
        (/\bCreature\b/.test(now.typeLine) && now.toughness !== null && (now.toughness <= 0 || ((p.damage ?? 0) >= now.toughness && !now.keywords.includes("indestructible")))) ||
        (/\bAura\b/.test(now.typeLine) && !g.battlefield.some((o) => o.id === p.attachedTo));
      if (dead) {
        removeFromBattlefield(g, p);
        changed = true;
      }
    }
  }
}

// 誘発型能力の最初のノード (when) が、このイベントに合うか。s = 能力の発生源のパーマネント (紋章を含む)
function matchesEvent(g: Game, s: Perm, when: NodeCall, ev: GameEvent): boolean {
  const a = when.args;
  if (a.event !== ev.type) return false;
  if (ev.type === "step" && a.step !== ev.step) return false;
  if (a.self === true && (ev.type === "cast" || ev.type === "step" || ev.perm !== s)) return false;
  const subject: { controller: PlayerId; card?: GameCard } = ev.type === "cast" ? { controller: ev.player, card: ev.card } : ev.type === "step" ? { controller: ev.player } : ev.perm;
  if (a.who === "you" && subject.controller !== s.controller) return false;
  if (a.who === "opponents" && subject.controller === s.controller) return false;
  if (subject.card) {
    if (typeof a.type === "string" && !typeIn(subject.card.typeLine, a.type)) return false;
    if (typeof a.notType === "string" && typeIn(subject.card.typeLine, a.notType)) return false;
  }
  if (a.turn === "yours" && g.active !== s.controller) return false;
  if (a.turn === "opponents" && g.active === s.controller) return false;
  return true;
}

// 誘発型能力を積むとき、対象を自動で選ぶ (誘発時に対象を選ぶ)。合法な対象を先頭から max 個 (g.decide.target で差し替え可)。min に足りなければ、能力は積まれない (false)
function chooseTargets(g: Game, item: StackItem, rules: RuleBook): boolean {
  for (const call of item.body ?? []) {
    const def = getNode(call.node);
    if (!def?.isTarget) continue;
    const ctx: RunCtx = { game: g, rules, item, vars: {}, call };
    if (call.if !== undefined && !evalCondition(call.if, ctx)) continue;
    const a = call.args as Record<string, Value>; // 対象のノードの引数は、参照ではない
    const min = typeof a.min === "number" ? a.min : 1;
    const max = typeof a.max === "number" ? a.max : Math.max(1, min);
    const pool = a.zone === "stack" ? g.stack.filter((x) => !x.ability).map((x) => x.id) : a.zone === "battlefield" ? g.battlefield.map((x) => x.id) : a.zone === "any" ? [...g.players, ...g.battlefield.map((x) => x.id)] : g.players;
    const legal = pool.filter((id) => def.run!({ ...ctx, item: { ...item, targets: { [call.as ?? ""]: id } } }, a).id !== undefined);
    const picked = (g.decide?.target?.(g, item, call, legal) ?? legal.slice(0, max)).filter((id) => legal.includes(id)).slice(0, max);
    if (picked.length < min) return false;
    item.targets[call.as ?? ""] = picked.join(",");
  }
  return true;
}

// 果敢 (キーワード prowess): 自分がクリーチャーでない呪文を唱えるたび、+1/+1 (ターン終了時まで)。組み込みの誘発型能力
const PROWESS: NodeCall[] = [
  { node: "self", args: {}, as: "s" },
  { node: "modify", args: { target: { ref: "s" }, power: 1, toughness: 1, duration: "endOfTurn" } },
];

// 積まれたイベントを見て、戦場のパーマネントの誘発型能力のうち条件に合うものを、スタックに積む。戦場を離れたパーマネント自身も見る。
// すべての能力を失っているパーマネントの能力は働かない。誘発の追加 (extraTriggers) があれば、その回数ぶん積む。
// shortcut: 誘発の順番 (APNAP) は決めず、戦場の順
function flushEvents(g: Game, rules: RuleBook): void {
  let added = false;
  const push = (s: Perm, body: NodeCall[]) => {
    for (let k = 0; k <= extraTriggers(g, s, rules); k++) {
      const item: StackItem = { id: `${s.id}#${g.serial + 1}`, card: s.card, controller: s.controller, targets: {}, cast: {}, body, ability: true, source: s.id };
      if (!chooseTargets(g, item, rules)) continue; // 合法な対象が足りない誘発型能力は、スタックに積まれない
      g.serial++;
      g.stack.push(item);
      added = true;
    }
  };
  stateBased(g, rules); // 状態起因処理 (落ちたものの「戦場を離れた」も、このあとで誘発を探す)
  while (g.events.length) {
    const ev = g.events.shift()!;
    if (ev.type === "leaves") for (const o of g.battlefield) if (o.attachedTo === ev.perm.id) delete o.attachedTo; // 付いていた先が離れたら、装備品・オーラは外れる (戻ってきても付き直さない)
    const sources = [...g.battlefield, ...(ev.type === "leaves" && !g.battlefield.includes(ev.perm) ? [ev.perm] : []), ...g.emblems];
    for (const s of sources) {
      const now = characteristics(g, s, rules);
      if (!now.lostAbilities) {
        for (const ab of rules.get(s.card.name)?.abilities ?? []) {
          // 紋章の能力は emblem name=… で始まり、同じ名前の紋章だけが持つ。ふつうのパーマネントは、紋章の能力を持たない
          const marker = ab.body[0]?.node === "emblem" ? ab.body[0] : undefined;
          if (marker ? s.emblem !== marker.args.name : s.emblem !== undefined) continue;
          const at = marker ? 1 : 0;
          const when = ab.body[at];
          if (ab.kind === "triggered" && when?.node === "when" && matchesEvent(g, s, when, ev)) push(s, ab.body.slice(at + 1));
        }
      }
      if (ev.type === "cast" && !s.emblem && ev.player === s.controller && now.keywords.includes("prowess") && !/\bcreature\b/i.test(ev.card.typeLine)) push(s, PROWESS);
    }
    stateBased(g, rules); // 誘発の効果が積まれる前に起きた変化も、落ち着かせる
  }
  if (added) g.passes = []; // 優先権は動かさない (唱えた・起動した本人が、積まれた誘発にも応答できる。解決のあとは、アクティブ・プレイヤーに戻る)
}

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
function validate(g: Game, item: StackItem, body: NodeCall[], name: string, rules: RuleBook): void {
  for (const call of body) {
    const bad = checkCall(call);
    if (bad) throw new RuleError(`${name}: ${bad}`);
  }
  for (const call of body) {
    const def = getNode(call.node)!;
    const ctx: RunCtx = { game: g, rules, item, vars: {}, call, phase: "cast" };
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

// コスト (cost / additionalCost のノードから集める)。mana = 汎用の数、manaCost = 色つきのマナコスト ("{1}{U}")
interface CostSpec {
  sym: ManaCost; // 払うマナ (mana の汎用も、ここに入る)
  tap: boolean;
  sacrifice: boolean;
  tapCreatures: number;
  loyalty: number; // 忠誠度を足す量 (+1 は 1、−2 は −2)
  loyaltyX: boolean; // −X
  isLoyalty: boolean; // 忠誠度能力 (ソーサリーのタイミングで、1ターンに1回)
}
// manaCost の形が違うときは RuleError (保存時の検査を通らなかった rule でも、エンジンが落ちないように)
const parseOrRule = (s: string): ManaCost => {
  try {
    return parseManaCost(s);
  } catch (e) {
    throw new RuleError((e as Error).message);
  }
};
const costOf = (calls: NodeCall[]): CostSpec => ({
  sym: calls.reduce((a, c) => addCosts(addCosts(a, { ...emptyCost(), generic: Number(c.args.mana ?? 0) }), typeof c.args.manaCost === "string" ? parseOrRule(c.args.manaCost) : emptyCost()), emptyCost()),
  tap: calls.some((c) => c.args.tap === true),
  sacrifice: calls.some((c) => c.args.sacrifice === true),
  tapCreatures: calls.reduce((a, c) => a + Number(c.args.tapCreatures ?? 0), 0),
  loyalty: calls.reduce((a, c) => a + Number(c.args.loyalty ?? 0), 0),
  loyaltyX: calls.some((c) => c.args.loyaltyX === true),
  isLoyalty: calls.some((c) => c.args.loyalty !== undefined || c.args.loyaltyX === true),
});

// 払えるか。払えなければ理由 (状態は変えない)。tapIds = パワーの合計のためにタップするクリーチャー
function costProblem(g: Game, p: PlayerId, cost: CostSpec, source: Perm | undefined, tapIds: string[], rules: RuleBook, spell?: GameCard, x = 0): string | null {
  if (!trySpend(g, p, cost.sym, spell, false)) return `マナが足りない (${describeCost(cost.sym)} 要る)`;
  if (cost.isLoyalty) {
    const now = source?.counters?.loyalty ?? 0;
    if (!source || source.loyaltyUsed) return "このターンは、もう忠誠度能力を起動した (1ターンに1回)";
    if (cost.loyalty < 0 && now + cost.loyalty < 0) return `忠誠度が足りない (${now} / ${-cost.loyalty})`;
    if (cost.loyaltyX && (!Number.isInteger(x) || x < 0 || x > now + cost.loyalty)) return `X は 0〜忠誠度 (${now + cost.loyalty}) の整数`;
  }
  if (cost.tap && (!source || source.tapped)) return "すでにタップされていて、タップできない";
  if (cost.tapCreatures > 0) {
    if (new Set(tapIds).size !== tapIds.length) return "同じクリーチャーを2回選んでいる";
    let power = 0;
    for (const id of tapIds) {
      const c = g.battlefield.find((x) => x.id === id);
      const now = c ? characteristics(g, c, rules) : undefined; // 継続効果をふまえた、いまの型・パワー
      if (!c || !now || c.controller !== p || c.tapped || !/\bCreature\b/.test(now.typeLine) || (source && c.id === source.id && cost.tap)) return `タップできるクリーチャーではない: ${id}`;
      power += now.power ?? 0;
    }
    if (power < cost.tapCreatures) return `タップしたクリーチャーのパワーの合計が足りない (${power} / ${cost.tapCreatures})`;
  }
  return null;
}

function payCost(g: Game, p: PlayerId, cost: CostSpec, source: Perm | undefined, tapIds: string[], spell?: GameCard, x = 0): void {
  if (!trySpend(g, p, cost.sym, spell, true)) throw new Error("マナが払えない (costProblem を通っていない)");
  if (cost.isLoyalty && source) {
    source.counters = { ...source.counters, loyalty: (source.counters?.loyalty ?? 0) + cost.loyalty - (cost.loyaltyX ? x : 0) };
    source.loyaltyUsed = true;
  }
  if (cost.tap && source) source.tapped = true;
  if (cost.tapCreatures > 0) for (const id of tapIds) g.battlefield.find((x) => x.id === id)!.tapped = true;
  if (cost.sacrifice && source) {
    g.battlefield = g.battlefield.filter((x) => x !== source);
    g.graveyards[source.card.owner].push(source.card);
    g.events.push({ type: "leaves", perm: source });
  }
}

// 唱える。手札にある・いま唱えられる・ルールがある・追加コストを払える・対象がすべて合法、のどれかが欠けると RuleError で、状態は変えない。
// cast = 唱えるときの選択 (kicked / teamwork = 追加コストを払う、tap = チームワークでタップするクリーチャー)。宣言 (additionalCost) の無いフラグは選べない
export function castSpell(g: Game, p: PlayerId, cardId: string, targets: Record<string, string>, rules: RuleBook, cast: CastRecord = {}): void {
  live(g);
  const card = g.hands[p]?.find((c) => c.id === cardId);
  if (!card) throw new RuleError(`手札に無い: ${cardId}`);
  if (/\bLand\b/.test(card.typeLine)) throw new RuleError(`土地は唱えられない (playLand で出す): ${card.name}`); // 1ターン1枚の制限は playLand にある
  if (!canCastNow(g, p, card, rules)) throw new RuleError(`いまは唱えられない: ${card.name}`);
  const body = spellBody(rules, card) ?? (rules.get(card.name) && isPermanentCard(card) ? [] : undefined); // 呪文能力の無いパーマネントも、ルールがあれば唱えられる
  if (!body) throw new RuleError(`呪文能力のルールが無い: ${card.name}`);
  const item: StackItem = { id: card.id, card, controller: p, targets, cast };
  checkModes(body, cast, card.name);
  validate(g, item, body, card.name, rules);
  const chosen = (["kicked", "teamwork"] as const).filter((f) => cast[f]);
  const decls = chosen.flatMap((f) => {
    const d = body.filter((c) => c.node === "additionalCost" && c.args.flag === f);
    if (!d.length) throw new RuleError(`${card.name}: ${f} の追加コストが書かれていない`);
    return d;
  });
  const cost = costOf(decls);
  if (g.payManaCosts) {
    // カード自体のマナコスト。コスト軽減は、汎用の分だけ減らす (色は減らない)。manaCost が無いカードは、マナ総量の数だけ (色なし)
    let own: ManaCost;
    try {
      own = card.manaCost !== undefined ? parseManaCost(card.manaCost) : { ...emptyCost(), generic: card.mv };
    } catch (e) {
      throw new RuleError(`${card.name}: ${(e as Error).message}`);
    }
    cost.sym = addCosts(cost.sym, { ...own, generic: Math.max(0, own.generic - costReduction(g, p, card, rules)) });
  }
  const why = costProblem(g, p, cost, undefined, cast.tap ?? [], rules, card);
  if (why) throw new RuleError(`${card.name}: ${why}`);
  payCost(g, p, cost, undefined, cast.tap ?? [], card);
  g.hands[p] = g.hands[p].filter((c) => c !== card);
  g.stack.push(item);
  g.priority = p;
  g.passes = [];
  g.events.push({ type: "cast", player: p, card });
  flushEvents(g, rules); // 「呪文を唱えた」ときの誘発型能力は、その呪文の上に積まれる
}

// 土地を出す。自分のメインフェイズで、スタックが空で、優先権があり、このターンにまだ出していないとき (スタックを使わない特別な動作)
export function playLand(g: Game, p: PlayerId, cardId: string, rules: RuleBook): void {
  live(g);
  const card = g.hands[p]?.find((c) => c.id === cardId);
  if (!card) throw new RuleError(`手札に無い: ${cardId}`);
  if (!/\bLand\b/.test(card.typeLine)) throw new RuleError(`土地ではない: ${card.name}`);
  if (g.priority !== p || p !== g.active || (g.step !== "main1" && g.step !== "main2") || g.stack.length) throw new RuleError(`いまは土地を出せない (自分のメインフェイズで、スタックが空のときだけ)`);
  if (g.landsPlayed >= 1) throw new RuleError("このターンは、もう土地を出した");
  g.hands[p] = g.hands[p].filter((c) => c !== card);
  g.landsPlayed++;
  enterBattlefield(g, card, p);
  flushEvents(g, rules);
}

// 戦場のパーマネントの起動型能力を起動する (index = そのカードの起動型能力の何番目か)。コストを払い、マナだけの能力 (addMana のみ) は即座に実行、
// それ以外はスタックに積む。優先権が必要。払えない・対象が不正なら RuleError で、状態は変えない
export function activateAbility(g: Game, p: PlayerId, permId: string, index: number, targets: Record<string, string>, rules: RuleBook, tapIds: string[] = [], x = 0): void {
  live(g);
  const perm = g.battlefield.find((x) => x.id === permId);
  if (!perm) throw new RuleError(`戦場に無い: ${permId}`);
  if (perm.controller !== p) throw new RuleError(`${p} のコントロールするパーマネントではない: ${permId}`);
  if (g.priority !== p) throw new RuleError(`${p} は優先権を持っていない`);
  const ab = rules.get(perm.card.name)?.abilities.filter((a) => a.kind === "activated")[index];
  if (!ab) throw new RuleError(`起動型能力が無い: ${perm.card.name} (${index} 番目)`);
  const timing = ab.body.find((c) => c.node === "timing");
  const cost = costOf(ab.body.filter((c) => c.node === "cost"));
  if ((timing?.args.sorcery === true || cost.isLoyalty) && !(p === g.active && (g.step === "main1" || g.step === "main2") && g.stack.length === 0)) throw new RuleError(`${perm.card.name}: ソーサリーのタイミングだけ起動できる (自分のメインフェイズで、スタックが空のとき)`);
  const effects = ab.body.filter((c) => c.node !== "cost" && c.node !== "timing");
  const item: StackItem = { id: `${perm.id}#${g.serial + 1}`, card: perm.card, controller: p, targets, cast: {}, body: effects, ability: true, source: perm.id, ...(cost.loyaltyX ? { x } : {}) };
  validate(g, item, ab.body, perm.card.name, rules);
  const why = costProblem(g, p, cost, perm, tapIds, rules, undefined, x);
  if (why) throw new RuleError(`${perm.card.name}: ${why}`);
  payCost(g, p, cost, perm, tapIds, undefined, x);
  g.serial++;
  if (effects.length && !cost.isLoyalty && effects.every((c) => c.node === "addMana")) {
    for (const call of effects) getNode(call.node)!.run!({ game: g, rules, item, vars: {}, call }, resolveArgs(call, {})!); // マナ能力はスタックを使わない
    flushEvents(g, rules);
    return;
  }
  g.stack.push(item);
  g.priority = p;
  g.passes = [];
  flushEvents(g, rules); // 生け贄などで「戦場を離れた」誘発は、この能力の上に積まれる
}

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
    enterBattlefield(g, item.card, item.controller);
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
  if (!item.ability && !(permanent && !fizzled)) g.graveyards[item.card.owner].push(item.card);
  flushEvents(g, rules);
}

function advanceStep(g: Game, rules: RuleBook): void {
  if (g.step === "end") {
    for (const p of g.battlefield) if (p.mods) p.mods = p.mods.filter((m) => m.until !== "endOfTurn"); // ターン終了時までの効果が消える
    for (const p of g.battlefield) delete p.damage; // ダメージも消える
    g.active = nextPlayer(g, g.active);
    g.landsPlayed = 0;
    for (const p of g.battlefield) delete p.loyaltyUsed; // 忠誠度能力は、1ターンに1回
    for (const p of g.battlefield) if (untapsDuring(g, p, g.active, rules)) untapPerm(g, p); // アンタップ・ステップ (優先権が無いので、ここで済ませてアップキープへ)。麻痺カウンターは、アンタップのかわりに取り除く
    g.step = "upkeep";
  } else g.step = STEPS[STEPS.indexOf(g.step) + 1];
  g.priority = g.active;
  g.events.push({ type: "step", step: g.step, player: g.active }); // 「ステップの開始時に」の誘発型能力
  flushEvents(g, rules);
}

// 優先権を持つ人がパスする。全員が連続でパスしたら、スタックが空なら次のステップへ、空でなければ一番上だけを解決する
export function passPriority(g: Game, p: PlayerId, rules: RuleBook): "passed" | "resolved" | "stepEnded" {
  live(g);
  if (g.priority !== p) throw new Error(`${p} は優先権を持っていない`);
  g.passes.push(p);
  if (g.passes.length < g.players.length) {
    g.priority = nextPlayer(g, p);
    return "passed";
  }
  g.passes = [];
  if (!g.stack.length) {
    advanceStep(g, rules);
    return "stepEnded";
  }
  resolveTop(g, rules);
  g.priority = g.active;
  return "resolved";
}

// 唱えられるタイミングは、カードタイプから決まる (ノードにはしない)
export function canCastNow(g: Game, p: PlayerId, card: GameCard, rules?: RuleBook): boolean {
  if (g.priority !== p) return false;
  if (/\bInstant\b/.test(card.typeLine) || card.flash || (rules && staticKeywords(rules, card).includes("flash"))) return true;
  return p === g.active && (g.step === "main1" || g.step === "main2") && g.stack.length === 0;
}
