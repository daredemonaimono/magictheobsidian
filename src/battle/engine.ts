import { characteristics, costReduction, extraTriggers, untapsDuring } from "./continuous";
import { dealDamage } from "./damage";
import { CastRecord, NodeCall, RunCtx, Value } from "./node";
import { checkCall, evalCondition, getNode } from "./registry";
import { addCosts, describeCost, emptyCost, ManaCost, parseManaCost, trySpend } from "./mana";
import { discardCards, drawCards, prepareAbilityOf, Game, GameCard, GameEvent, Perm, PlayerId, RuleBook, StackItem, Step, typeIn, untapPerm } from "./state";

// ステップ進行・優先権・スタック。画面なしで、テストから動かせる

const STEPS: Step[] = ["untap", "upkeep", "draw", "main1", "combat", "main2", "end"];

export const nextPlayer = (g: Game, p: PlayerId): PlayerId => g.players[(g.players.indexOf(p) + 1) % g.players.length];

export class RuleError extends Error {}

const UNRULED = "ルールが設定されていません。スキップします。";
// ルールが設定されていないカード (skipUnruled が真のとき): ルールが無い、またはノードが1つも無い
const unruled = (g: Game, rules: RuleBook, card: GameCard): boolean => !!g.skipUnruled && (rules.get(card.name)?.abilities ?? []).every((a) => a.body.length === 0);

const isPermanentCard = (c: GameCard): boolean => !/\b(Instant|Sorcery)\b/.test(c.typeLine);

// ルールの常在型能力に書かれたキーワード (keyword name=…)
const staticKeywords = (rules: RuleBook, card: GameCard): string[] => (rules.get(card.name)?.abilities ?? []).filter((a) => a.kind === "static").flatMap((a) => a.body.filter((c) => c.node === "keyword").map((c) => String(c.args.name)));

// パーマネントを戦場に出す。「戦場に出た」イベントを積む (宣言されたキーワードは、characteristics が導く)
function enterBattlefield(g: Game, card: GameCard, controller: PlayerId, rules: RuleBook): void {
  const perm: Perm = { id: card.id, card, controller, enteredTurn: g.turn };
  // 「準備済状態で戦場に出る」: 準備呪文を持つクリーチャーだけ
  if (prepareAbilityOf(rules, card.name) && (rules.get(card.name)?.abilities ?? []).some((a) => a.kind === "static" && a.body.some((c) => c.node === "entersPrepared"))) perm.prepared = true;
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
        (/\bCreature\b/.test(now.typeLine) && now.toughness !== null && (now.toughness <= 0 || (((p.damage ?? 0) >= now.toughness || p.deathtouched) && !now.keywords.includes("indestructible")))) ||
        (/\bAura\b/.test(now.typeLine) && !g.battlefield.some((o) => o.id === p.attachedTo));
      if (dead) {
        removeFromBattlefield(g, p);
        changed = true;
      }
    }
  }
  for (const p of g.battlefield) delete p.deathtouched; // 接死のダメージによる破壊は、状況起因処理で1回だけ見る (破壊不能で生き残ったら、あとの状況で死なない)
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
    out.push({ as: call.as ?? "", min, max, legal, zone: String(a.zone), kind: String(a.kind) });
  }
  return out;
}

// 誘発型能力を積むとき、対象を自動で選ぶ (誘発時に対象を選ぶ)。合法な対象を先頭から max 個 (g.decide.target で差し替え可)。min に足りなければ、能力は積まれない (false)
function chooseTargets(g: Game, item: StackItem, rules: RuleBook): boolean {
  for (const slot of targetSlots(g, rules, item)) {
    const call = (item.body ?? []).find((c) => (c.as ?? "") === slot.as && getNode(c.node)?.isTarget)!;
    const picked = (g.decide?.target?.(g, item, call, slot.legal) ?? slot.legal.slice(0, slot.max)).filter((id) => slot.legal.includes(id)).slice(0, slot.max);
    if (picked.length < slot.min) return false;
    item.targets[slot.as] = picked.join(",");
  }
  return true;
}

// 果敢 (キーワード prowess): 自分がクリーチャーでない呪文を唱えるたび、+1/+1 (ターン終了時まで)。組み込みの誘発型能力
const PROWESS: NodeCall[] = [
  { node: "self", args: {}, as: "s" },
  { node: "modify", args: { target: { ref: "s" }, power: 1, toughness: 1, duration: "endOfTurn" } },
];

// 呪文・能力が、対戦相手のパーマネントを対象にしたことを知らせる (護法)。スタックに積んだ直後に呼ぶ
// 実際に対象になるのは、条件 (if=) を満たす対象のノード (選ばれなかったモード・キッカーされなかったときの対象は、数えない)。同じパーマネントを何度対象にしても、1回
function announceTargets(g: Game, item: StackItem, rules: RuleBook): void {
  const body = item.body ?? spellBody(rules, item.card) ?? [];
  const seen = new Set<string>();
  for (const call of body) {
    if (!getNode(call.node)?.isTarget) continue;
    if (call.if !== undefined && !evalCondition(call.if, { game: g, rules, item, vars: {}, call })) continue;
    for (const id of (item.targets[call.as ?? ""] ?? "").split(",")) {
      const perm = g.battlefield.find((x) => x.id === id);
      if (perm && perm.controller !== item.controller && !seen.has(perm.id)) {
        seen.add(perm.id);
        g.events.push({ type: "targeted", perm, by: item });
      }
    }
  }
}

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
      announceTargets(g, item, rules);
      added = true;
    }
  };
  stateBased(g, rules); // 状態起因処理 (落ちたものの「戦場を離れた」も、このあとで誘発を探す)
  while (g.events.length) {
    const ev = g.events.shift()!;
    if (ev.type === "targeted") {
      // 護法: 対象になったパーマネントが、すべての能力を失っていなければ、{N} を払わないかぎり打ち消す誘発が積まれる
      if (!characteristics(g, ev.perm, rules).lostAbilities) {
        for (const ab of rules.get(ev.perm.card.name)?.abilities ?? []) {
          if (ab.kind !== "static") continue;
          for (const c of ab.body) {
            if (c.node !== "ward") continue;
            const item: StackItem = { id: `${ev.perm.id}#${g.serial + 1}`, card: ev.perm.card, controller: ev.perm.controller, targets: {}, cast: {}, body: [{ node: "counter", args: { target: ev.by.id, unlessPay: Number(c.args.amount) } }], ability: true, source: ev.perm.id };
            g.serial++;
            g.stack.push(item);
            added = true;
          }
        }
      }
      continue;
    }
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

// shortcut: 条件 if=$名前 (前のノードの出力) の付いた対象のノードは、唱えるとき・解決の対象確認のときは、条件を満たさない扱い (出力がまだ無いため)。「そうしたなら、対象の〜」の対象は、唱えるときに選べない
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

// 召喚酔い: クリーチャーは、このターンに戦場に出たなら、攻撃も {T} のコストの能力もできない (速攻があれば別)
export const isSick = (g: Game, p: Perm, rules: RuleBook): boolean => {
  if (p.enteredTurn === undefined || p.enteredTurn !== g.turn) return false;
  const now = characteristics(g, p, rules);
  return /\bCreature\b/.test(now.typeLine) && !now.keywords.includes("haste");
};

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
  if (cost.tap && source && isSick(g, source, rules)) return "召喚酔いで、{T} のコストを払えない";
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
  const skipped = unruled(g, rules, card); // ルールが設定されていないカード: 効果は飛ばす
  const body = skipped ? [] : spellBody(rules, card) ?? (rules.get(card.name) && isPermanentCard(card) ? [] : undefined); // 呪文能力の無いパーマネントも、ルールがあれば唱えられる
  if (!body) throw new RuleError(`呪文能力のルールが無い: ${card.name}`);
  castCore(g, p, card, body, targets, rules, cast, () => {
    g.hands[p] = g.hands[p].filter((c) => c !== card);
    if (skipped) g.log.push(`${card.name}: ${UNRULED}`);
  });
}

// 呪文を唱える本体 (手札から・準備呪文のコピーで共通)。条件を確かめ、コストを払い、スタックに積む。afterPay = 払ったあとの、元の場所からの移動。copy = 呪文のコピー
function castCore(g: Game, p: PlayerId, card: GameCard, body: NodeCall[], targets: Record<string, string>, rules: RuleBook, cast: CastRecord, afterPay: () => void, copy = false): void {
  const item: StackItem = { id: card.id, card, controller: p, targets, cast, ...(copy ? { body, copy: true } : {}) };
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
  afterPay();
  g.stack.push(item);
  announceTargets(g, item, rules);
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
  if (unruled(g, rules, card)) g.log.push(`${card.name}: ${UNRULED}`);
  enterBattlefield(g, card, p, rules);
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
  announceTargets(g, item, rules);
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
    enterBattlefield(g, item.card, item.controller, rules);
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
  if (!item.ability && !item.copy && !(permanent && !fizzled)) g.graveyards[item.card.owner].push(item.card); // 呪文のコピーは、墓地に行かず消える
  flushEvents(g, rules);
}

// マナ・プールを空にする (全員。色つき・制限つきも)
function emptyPools(g: Game): void {
  for (const p of g.players) {
    g.mana[p] = 0;
    g.pool[p] = {};
    g.restrictedMana[p] = [];
  }
}

const HAND_LIMIT = 7;

function advanceStep(g: Game, rules: RuleBook): void {
  if (g.strictTurns) emptyPools(g); // ステップの終わりに、マナが消える
  if (g.step === "end") {
    if (g.strictTurns && g.hands[g.active].length > HAND_LIMIT) discardCards(g, g.active, g.hands[g.active].length - HAND_LIMIT); // クリンナップ: 手札を 7 枚まで
    for (const p of g.battlefield) if (p.mods) p.mods = p.mods.filter((m) => m.until !== "endOfTurn"); // ターン終了時までの効果が消える
    for (const p of g.battlefield) {
      delete p.damage; // ダメージも消える
      delete p.deathtouched;
    }
    g.active = nextPlayer(g, g.active);
    g.turn++;
    g.landsPlayed = 0;
    for (const p of g.battlefield) delete p.loyaltyUsed; // 忠誠度能力は、1ターンに1回
    for (const p of g.battlefield) if (untapsDuring(g, p, g.active, rules)) untapPerm(g, p); // アンタップ・ステップ (優先権が無いので、ここで済ませてアップキープへ)。麻痺カウンターは、アンタップのかわりに取り除く
    g.step = "upkeep";
  } else g.step = STEPS[STEPS.indexOf(g.step) + 1];
  endCombat(g); // 戦闘ステップを出るとき、戦闘の状態を片づける (ふつうは、advanceCombat がすでに片づけている)
  if (g.step === "combat") {
    g.combatPhase = g.strictTurns ? "beginning" : "attackers"; // 厳密なターン: 戦闘開始ステップ (優先権の回) から。そうでなければ、攻撃クリーチャーを指定する段階から (指定が無ければ、そのまま次のステップへ進む)
    g.attackersDeclared = false;
    g.blockersDeclared = [];
  }
  if (g.strictTurns && g.step === "draw" && g.turn > 1) drawCards(g, g.active, 1); // ターンのドロー (ゲームの最初のターンは引かない)。「ドロー・ステップの開始時」の誘発より先
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
    if (g.step === "combat" && g.combatPhase && advanceCombat(g, rules)) return "stepEnded"; // 戦闘ステップの中の、次の段階へ
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

// ---- 戦闘。戦闘ステップは、攻撃クリーチャーの指定 → ブロックの指定 → (先制攻撃ダメージ) → 戦闘ダメージ → 終了 の段階 (Game.combatPhase) で進む。
// 段階は、全員がパスして、スタックが空のときに進む (攻撃が無ければ、そのまま次のステップ)。指定は、declareAttackers / declareBlockers を呼ぶ (castSpell と同じ、人や AI の入口)。
// shortcut: ダメージの割り振りは、宣言の順に致死ダメージを振る (割り振りの選択は、判断の入力を作るときに)。ブロッカー1体につき、ブロック先は1体だけ

const kwOf = (g: Game, p: Perm, rules: RuleBook): string[] => characteristics(g, p, rules).keywords;
const isCreature = (g: Game, p: Perm, rules: RuleBook): boolean => /\bCreature\b/.test(characteristics(g, p, rules).typeLine);
// 攻撃先のコントローラー (プレイヤーならその人、プレインズウォーカーならそのコントローラー)
const defenderOf = (g: Game, a: Perm): PlayerId | undefined => (a.attackTarget && g.players.includes(a.attackTarget) ? a.attackTarget : g.battlefield.find((x) => x.id === a.attackTarget)?.controller);

function endCombat(g: Game): void {
  for (const p of g.battlefield) {
    delete p.attacking;
    delete p.attackTarget;
    delete p.blocked;
    delete p.blockedBy;
    delete p.blocking;
  }
  g.combatPhase = undefined;
  g.attackersDeclared = false;
  g.blockersDeclared = [];
}

// 攻撃クリーチャーを指定する (アクティブ・プレイヤーだけ。戦闘ステップの最初の段階で、1回だけ)。attackers = [{ id, target? }] (target = 攻撃先のプレイヤー / プレインズウォーカーの id。相手が1人なら省ける)。
// 1つでも不正なら RuleError で、何も変えない。攻撃するとタップする (警戒を除く)。「攻撃したとき」の誘発がスタックに積まれる
export function declareAttackers(g: Game, p: PlayerId, attackers: { id: string; target?: string }[], rules: RuleBook): void {
  live(g);
  if (g.step !== "combat" || g.combatPhase !== "attackers" || g.attackersDeclared) throw new RuleError("いまは攻撃クリーチャーを指定できない (戦闘ステップの最初に、1回だけ)");
  if (p !== g.active) throw new RuleError("攻撃クリーチャーを指定できるのは、アクティブ・プレイヤーだけ");
  const picks = attackers.map((x) => {
    const perm = g.battlefield.find((q) => q.id === x.id);
    if (!perm || perm.controller !== p || !isCreature(g, perm, rules)) throw new RuleError(`攻撃できるクリーチャーではない: ${x.id}`);
    const kw = kwOf(g, perm, rules);
    if (perm.tapped) throw new RuleError(`タップしていて攻撃できない: ${perm.card.name}`);
    if (kw.includes("defender")) throw new RuleError(`防衛を持っていて攻撃できない: ${perm.card.name}`);
    if (isSick(g, perm, rules)) throw new RuleError(`召喚酔いで攻撃できない: ${perm.card.name}`);
    const others = g.players.filter((o) => o !== p);
    const target = x.target ?? (others.length === 1 ? others[0] : undefined);
    const wall = g.battlefield.find((q) => q.id === target);
    if (!target || !(others.includes(target) || (wall && wall.controller !== p && /\bPlaneswalker\b/.test(characteristics(g, wall, rules).typeLine)))) throw new RuleError(`攻撃先が不正: ${perm.card.name} → ${target ?? "(未指定)"}`);
    return { perm, target, vigilance: kw.includes("vigilance") };
  });
  if (new Set(picks.map((x) => x.perm.id)).size !== picks.length) throw new RuleError("同じクリーチャーを2回指定している");
  for (const x of picks) {
    if (!x.vigilance) x.perm.tapped = true;
    x.perm.attacking = true;
    x.perm.attackTarget = x.target;
    g.events.push({ type: "attacks", perm: x.perm });
  }
  g.attackersDeclared = true;
  g.passes = [];
  g.priority = p;
  flushEvents(g, rules);
}

// ブロックを指定する (防御側。ブロックの段階で、1回だけ。ブロックしなくても、空で呼んでよい)。blocks = [{ blocker, attacker }]。
// 飛行は飛行か到達でしかブロックできず、威嚇は2体以上でないとブロックできない。不正なら RuleError で、何も変えない
export function declareBlockers(g: Game, p: PlayerId, blocks: { blocker: string; attacker: string }[], rules: RuleBook): void {
  live(g);
  if (g.step !== "combat" || g.combatPhase !== "blockers" || g.blockersDeclared?.includes(p)) throw new RuleError("いまはブロックを指定できない (ブロックの段階で、1回だけ)");
  if (!g.battlefield.some((a) => a.attacking && defenderOf(g, a) === p)) throw new RuleError("ブロックを指定できるのは、攻撃されている防御側だけ");
  const used = new Set<string>();
  const per = new Map<string, string[]>();
  for (const b of blocks) {
    const blocker = g.battlefield.find((q) => q.id === b.blocker);
    const attacker = g.battlefield.find((q) => q.id === b.attacker);
    if (!blocker || blocker.controller !== p || !isCreature(g, blocker, rules) || blocker.tapped) throw new RuleError(`ブロックできるクリーチャーではない: ${b.blocker}`);
    if (!attacker || !attacker.attacking || defenderOf(g, attacker) !== p) throw new RuleError(`ブロックできる攻撃クリーチャーではない: ${b.attacker}`);
    if (used.has(blocker.id)) throw new RuleError(`1体で複数をブロックできない: ${blocker.card.name}`);
    used.add(blocker.id);
    const ak = kwOf(g, attacker, rules);
    const bk = kwOf(g, blocker, rules);
    if (ak.includes("flying") && !bk.includes("flying") && !bk.includes("reach")) throw new RuleError(`飛行はブロックできない: ${blocker.card.name} → ${attacker.card.name}`);
    per.set(attacker.id, [...(per.get(attacker.id) ?? []), blocker.id]);
  }
  for (const [aid, bs] of per) if (bs.length === 1 && kwOf(g, g.battlefield.find((q) => q.id === aid)!, rules).includes("menace")) throw new RuleError("威嚇は、2体以上でないとブロックできない");
  for (const b of blocks) {
    const blocker = g.battlefield.find((q) => q.id === b.blocker)!;
    const attacker = g.battlefield.find((q) => q.id === b.attacker)!;
    blocker.blocking = attacker.id;
    attacker.blocked = true;
    attacker.blockedBy = [...(attacker.blockedBy ?? []), blocker.id];
    g.events.push({ type: "blocks", perm: blocker });
  }
  g.blockersDeclared = [...(g.blockersDeclared ?? []), p];
  g.passes = [];
  g.priority = g.active;
  flushEvents(g, rules);
}

// 戦闘ダメージ。pass = first (先制攻撃・二段攻撃だけ) / regular (先制攻撃だけのものは除く。二段攻撃は、もう一度)。与えるものを先にすべて決めてから、同時に与える
function combatDamage(g: Game, rules: RuleBook, pass: "first" | "regular"): void {
  const deals: { src: Perm; target: string; n: number }[] = [];
  const now = (p: Perm) => {
    const k = kwOf(g, p, rules);
    return pass === "first" ? k.includes("firststrike") || k.includes("doublestrike") : k.includes("doublestrike") || !k.includes("firststrike");
  };
  const powerOf = (p: Perm) => characteristics(g, p, rules).power ?? 0;
  for (const a of g.battlefield.filter((x) => x.attacking)) {
    const target = a.attackTarget && (g.players.includes(a.attackTarget) || g.battlefield.some((x) => x.id === a.attackTarget)) ? a.attackTarget : undefined;
    if (now(a) && powerOf(a) > 0) {
      const k = kwOf(g, a, rules);
      const blockers = (a.blockedBy ?? []).map((id) => g.battlefield.find((x) => x.id === id && x.blocking === a.id)).filter((x): x is Perm => !!x);
      let rest = powerOf(a);
      if (blockers.length) {
        blockers.forEach((b, i) => {
          const t = characteristics(g, b, rules).toughness ?? 0;
          const lethal = k.includes("deathtouch") ? 1 : Math.max(0, t - (b.damage ?? 0));
          const give = i === blockers.length - 1 && !k.includes("trample") ? rest : Math.min(rest, lethal); // 最後のブロッカーが、残りを全部受ける (トランプルを除く)
          deals.push({ src: a, target: b.id, n: give });
          rest -= give;
        });
        if (k.includes("trample") && rest > 0 && target) deals.push({ src: a, target, n: rest });
      } else if (!a.blocked || k.includes("trample")) {
        if (target) deals.push({ src: a, target, n: rest }); // ブロックされていない / ブロッカーがいなくなったトランプル
      }
    }
  }
  for (const b of g.battlefield.filter((x) => x.blocking)) {
    const a = g.battlefield.find((x) => x.id === b.blocking && x.attacking);
    if (a && now(b) && powerOf(b) > 0) deals.push({ src: b, target: a.id, n: powerOf(b) });
  }
  for (const d of deals) dealDamage(g, rules, d.src, d.target, d.n);
}

// 戦闘ステップの中の、次の段階へ。まだ戦闘の中なら true。戦闘が終わったら (攻撃が無かった場合も) 状態を片づけて false (呼び出し側が、次のステップへ進める)
function advanceCombat(g: Game, rules: RuleBook): boolean {
  const inCombat = g.battlefield.filter((p) => p.attacking || p.blocking);
  switch (g.combatPhase) {
    case "beginning":
      g.combatPhase = "attackers"; // 戦闘開始ステップの優先権の回が終わった。攻撃クリーチャーの指定 (指定しないでパスすれば、攻撃しない)
      break;
    case "attackers":
      if (!g.battlefield.some((p) => p.attacking)) {
        if (!g.strictTurns) {
          endCombat(g);
          return false;
        }
        g.combatPhase = "end"; // 攻撃が無ければ、ブロックとダメージは飛ばして、戦闘終了ステップへ
        break;
      }
      g.combatPhase = "blockers";
      break;
    case "blockers":
      if (inCombat.some((p) => kwOf(g, p, rules).some((k) => k === "firststrike" || k === "doublestrike"))) {
        g.combatPhase = "firstStrike";
        combatDamage(g, rules, "first");
      } else {
        g.combatPhase = "damage";
        combatDamage(g, rules, "regular");
      }
      break;
    case "firstStrike":
      g.combatPhase = "damage";
      combatDamage(g, rules, "regular");
      break;
    case "damage":
      if (g.strictTurns) {
        g.combatPhase = "end"; // 戦闘終了ステップ (優先権の回。攻撃状態は、ここまで残る)
        break;
      }
      endCombat(g);
      return false;
    default:
      endCombat(g);
      return false;
  }
  if (g.strictTurns) emptyPools(g); // 戦闘の段階の終わりにも、マナが消える
  g.passes = [];
  g.priority = g.active;
  flushEvents(g, rules);
  return true;
}

// ゲームを始める: 手札を 7 枚ずつ引き (ライブラリーは、呼び出し側が切ったもの。マリガンは未対応)、先手のターン 1 の維持ステップから、厳密なターンで進める。
// 手札が足りなければ、負ける。createGame したばかりのゲームに、1回だけ呼ぶ (2回呼ぶと、さらに 7 枚引く)。shortcut: 2人戦の、最初のターンのドローなし (3人以上では、先手も引く) は未対応
export function startGame(g: Game, rules: RuleBook, first: PlayerId = g.players[0]): void {
  live(g);
  if (!g.players.includes(first)) throw new RuleError(`先手が、プレイヤーにいない: ${first}`);
  g.strictTurns = true;
  g.turn = 1;
  g.active = first;
  g.step = "upkeep";
  g.priority = first;
  g.passes = [];
  for (const p of g.players) drawCards(g, p, 7);
  g.events.push({ type: "step", step: "upkeep", player: first });
  flushEvents(g, rules);
}

// 準備呪文を唱える: 準備済のクリーチャーのコントローラーが、その準備呪文のコピー (追放領域にある) を唱える。唱えると、そのクリーチャーは準備済でなくなる。
// コピーは呪文なので、打ち消しの対象になる。解決しても、打ち消されても、墓地には行かず消える。唱えるタイミングは、準備呪文の型 (Instant なら優先権があるとき、Sorcery ならソーサリーのタイミング)
export function castPrepared(g: Game, p: PlayerId, permId: string, targets: Record<string, string>, rules: RuleBook, cast: CastRecord = {}): void {
  live(g);
  const perm = g.battlefield.find((x) => x.id === permId);
  if (!perm || perm.controller !== p) throw new RuleError(`自分のパーマネントではない: ${permId}`);
  if (!perm.prepared) throw new RuleError(`準備済ではない: ${perm.card.name}`);
  const ab = prepareAbilityOf(rules, perm.card.name);
  const decl = ab?.body[0];
  if (!ab || decl?.node !== "prepareSpell") throw new RuleError(`準備呪文のルールが無い: ${perm.card.name}`);
  let own: ManaCost;
  try {
    own = typeof decl.args.manaCost === "string" ? parseManaCost(decl.args.manaCost) : emptyCost();
  } catch (e) {
    throw new RuleError(`${perm.card.name}: ${(e as Error).message}`);
  }
  const mv = own.generic + Object.values(own.colors).reduce((a, n) => a + (n ?? 0), 0) + own.hybrid.length;
  const card: GameCard = { id: `${perm.id}#prepared${++g.serial}`, name: String(decl.args.name), typeLine: String(decl.args.type), mv, ...(typeof decl.args.manaCost === "string" ? { manaCost: decl.args.manaCost } : {}), owner: perm.card.owner };
  if (!canCastNow(g, p, card, rules)) throw new RuleError(`いまは唱えられない: ${card.name}`);
  castCore(g, p, card, ab.body.slice(1), targets, rules, cast, () => {
    perm.prepared = false;
  }, true);
}
