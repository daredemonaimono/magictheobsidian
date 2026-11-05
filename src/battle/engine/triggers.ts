import { characteristics, extraTriggers } from "../continuous";
import { NodeCall } from "../node";
import { evalCondition, getNode } from "../registry";
import { Game, GameCard, GameEvent, Perm, PlayerId, RuleBook, StackItem, typeIn } from "../state";
import { spellBody } from "./shared";
import { stateBased } from "./battlefield";
import { chooseTargets } from "./targets";

// 誘発型能力 (イベント → スタックに積む)

// 誘発型能力の最初のノード (when) が、このイベントに合うか。s = 能力の発生源のパーマネント (紋章を含む)
export function matchesEvent(g: Game, s: Perm, when: NodeCall, ev: GameEvent): boolean {
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

// 果敢 (キーワード prowess): 自分がクリーチャーでない呪文を唱えるたび、+1/+1 (ターン終了時まで)。組み込みの誘発型能力
export const PROWESS: NodeCall[] = [
  { node: "self", args: {}, as: "s" },
  { node: "modify", args: { target: { ref: "s" }, power: 1, toughness: 1, duration: "endOfTurn" } },
];

// 呪文・能力が、対戦相手のパーマネントを対象にしたことを知らせる (護法)。スタックに積んだ直後に呼ぶ
// 実際に対象になるのは、条件 (if=) を満たす対象のノード (選ばれなかったモード・キッカーされなかったときの対象は、数えない)。同じパーマネントを何度対象にしても、1回
export function announceTargets(g: Game, item: StackItem, rules: RuleBook): void {
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
export function flushEvents(g: Game, rules: RuleBook): void {
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
