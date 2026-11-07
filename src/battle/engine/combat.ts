import { characteristics } from "../continuous";
import { blockForbidden, cantAttackNow, cantBlockNow, mustAttackNow } from "./restrict";
import { dealDamage } from "../damage";
import { Game, Perm, PlayerId, RuleBook } from "../state";
import { RuleError, defenderOf, evasionAllows, isCreature, isSick, kwOf, live } from "./shared";
import { flushEvents } from "./triggers";
import { emptyPools } from "./turn";

// 戦闘 (攻撃・ブロック・ダメージ)

// p が、いま攻撃できるクリーチャーを持っているか (アンタップ・召喚酔いでない・防衛でない)。無ければ、対戦の画面は戦闘ステップを飛ばす
export const canAttackPerm = (g: Game, x: Perm, rules: RuleBook): boolean => {
  if (x.tapped || isSick(g, x, rules) || cantAttackNow(g, rules, x)) return false;
  const now = characteristics(g, x, rules);
  return /\bCreature\b/.test(now.typeLine) && !now.keywords.includes("defender");
};

export const canAttackWith = (g: Game, p: PlayerId, rules: RuleBook): boolean => g.battlefield.some((x) => x.controller === p && canAttackPerm(g, x, rules));

// p が、いま攻撃されている (戦闘の最中) ときの、攻撃クリーチャー
export const attackersAt = (g: Game, p: PlayerId): Perm[] => g.battlefield.filter((a) => a.attacking && defenderOf(g, a) === p);

export function endCombat(g: Game): void {
  for (const p of g.battlefield) {
    delete p.attacking;
    delete p.attackTarget;
    delete p.blocked;
    delete p.blockedBy;
    delete p.assign;
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
  // 「攻撃しなければならない」(mustAttack): 攻撃できるのに、指定に入っていないものは、足す
  for (const x of g.battlefield) if (x.controller === p && mustAttackNow(g, rules, x) && canAttackPerm(g, x, rules) && !attackers.some((q) => q.id === x.id)) attackers = [...attackers, { id: x.id }];
  const picks = attackers.map((x) => {
    const perm = g.battlefield.find((q) => q.id === x.id);
    if (!perm || perm.controller !== p || !isCreature(g, perm, rules)) throw new RuleError(`攻撃できるクリーチャーではない: ${x.id}`);
    const kw = kwOf(g, perm, rules);
    if (perm.tapped) throw new RuleError(`タップしていて攻撃できない: ${perm.card.name}`);
    if (cantAttackNow(g, rules, perm)) throw new RuleError(`攻撃できない: ${perm.card.name}`);
    if (kw.includes("defender")) throw new RuleError(`防衛を持っていて攻撃できない: ${perm.card.name}`);
    if (isSick(g, perm, rules)) throw new RuleError(`召喚酔いで攻撃できない: ${perm.card.name}`);
    const others = g.players.filter((o) => o !== p);
    const target = x.target ?? (others.length === 1 ? others[0] : undefined);
    const wall = g.battlefield.find((q) => q.id === target);
    if (!target || !(others.includes(target) || (wall && wall.controller !== p && /\bPlaneswalker\b/.test(characteristics(g, wall, rules).typeLine)))) throw new RuleError(`攻撃先が不正: ${perm.card.name} → ${target ?? "(未指定)"}`);
    return { perm, target, vigilance: kw.includes("vigilance") };
  });
  if (new Set(picks.map((x) => x.perm.id)).size !== picks.length) throw new RuleError("同じクリーチャーを2回指定している");
  for (const [k, x] of picks.entries()) {
    if (!x.vigilance) x.perm.tapped = true;
    x.perm.attacking = true;
    x.perm.attackTarget = x.target;
    g.events.push({ type: "attacks", perm: x.perm, ...(k === 0 ? { first: true } : {}) });
  }
  g.attackersDeclared = true;
  (g.attacked ??= {})[p] = true;
  g.passes = [];
  g.priority = p;
  flushEvents(g, rules);
}

// この blocker が、この attacker を (単独の決まりで) ブロックできるか。画面が、ブロックの選択が要るかを決めるのに使う (威嚇は、2体以上が要る: 呼び出し側が数える)
export const canBlock = (g: Game, blocker: Perm, attacker: Perm, rules: RuleBook): boolean => !blocker.tapped && !cantBlockNow(g, rules, blocker) && !blockForbidden(g, rules, attacker, blocker) && isCreature(g, blocker, rules) && evasionAllows(kwOf(g, attacker, rules), kwOf(g, blocker, rules));

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
    if (!blocker || blocker.controller !== p || !isCreature(g, blocker, rules) || blocker.tapped || cantBlockNow(g, rules, blocker)) throw new RuleError(`ブロックできるクリーチャーではない: ${b.blocker}`);
    if (!attacker || !attacker.attacking || defenderOf(g, attacker) !== p) throw new RuleError(`ブロックできる攻撃クリーチャーではない: ${b.attacker}`);
    if (used.has(blocker.id)) throw new RuleError(`1体で複数をブロックできない: ${blocker.card.name}`);
    used.add(blocker.id);
    const ak = kwOf(g, attacker, rules);
    const bk = kwOf(g, blocker, rules);
    if (blockForbidden(g, rules, attacker, blocker)) throw new RuleError(`ブロックされない: ${attacker.card.name} は、${blocker.card.name} にブロックされない`);
    if (!evasionAllows(ak, bk)) throw new RuleError(`飛行はブロックできない: ${blocker.card.name} → ${attacker.card.name}`);
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

// 攻撃クリーチャーのダメージを、ブロッカーに割り振る (攻撃側が、ブロックの指定のあと・ダメージの前に、1回。自由な数)。トランプルなしは、合計がパワーと同じ。トランプルは、パワー以下 (残りは防御側へ)。不正なら RuleError で、何も変えない
export function assignDamage(g: Game, p: PlayerId, attackerId: string, amounts: Record<string, number>, rules: RuleBook): void {
  live(g);
  const a = g.battlefield.find((x) => x.id === attackerId && x.attacking);
  if (!a || a.controller !== p) throw new RuleError("割り振れるのは、自分の攻撃クリーチャーだけ");
  if (g.step !== "combat" || g.combatPhase !== "blockers") throw new RuleError("ダメージの割り振りは、ブロックの指定のあと、ダメージの前に");
  const ids = (a.blockedBy ?? []).filter((id) => g.battlefield.some((x) => x.id === id && x.blocking === a.id));
  if (Object.keys(amounts).some((id) => !ids.includes(id))) throw new RuleError("ブロックしているクリーチャーにだけ、割り振れる");
  const full = Object.fromEntries(ids.map((id) => [id, amounts[id] ?? 0]));
  if (Object.values(full).some((n) => !Number.isInteger(n) || n < 0)) throw new RuleError("割り振る数は、0 以上の整数");
  const power = characteristics(g, a, rules).power ?? 0;
  const sum = Object.values(full).reduce((x, n) => x + n, 0);
  const trample = kwOf(g, a, rules).includes("trample");
  if (sum > power || (!trample && sum !== power)) throw new RuleError(`割り振りの合計は、パワー (${power}) ${trample ? "以下" : "と同じ"}にする`);
  a.assign = full;
}

// 戦闘ダメージ。pass = first (先制攻撃・二段攻撃だけ) / regular (先制攻撃だけのものは除く。二段攻撃は、もう一度)。与えるものを先にすべて決めてから、同時に与える
export function combatDamage(g: Game, rules: RuleBook, pass: "first" | "regular"): void {
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
      const given = a.assign;
      if (blockers.length && given && blockers.every((b) => given[b.id] !== undefined)) {
        for (const b of blockers) {
          const n = Math.min(rest, given[b.id]);
          if (n > 0) deals.push({ src: a, target: b.id, n });
          rest -= n;
        }
        if (k.includes("trample") && rest > 0 && target) deals.push({ src: a, target, n: rest });
      } else if (blockers.length) {
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
  for (const d of deals) dealDamage(g, rules, d.src, d.target, d.n, true);
}

// 戦闘ステップの中の、次の段階へ。まだ戦闘の中なら true。戦闘が終わったら (攻撃が無かった場合も) 状態を片づけて false (呼び出し側が、次のステップへ進める)
export function advanceCombat(g: Game, rules: RuleBook): boolean {
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
