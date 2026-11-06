import { characteristics } from "../continuous";
import { CastRecord } from "../node";
import { entersTapped } from "./restrict";
import { prepareAbilityOf, putInGraveyard, typeIn, Game, GameCard, Perm, PlayerId, RuleBook, Zone } from "../state";

// 戦場に出る・離れる・状況起因処理

// パーマネントを戦場に出す。「戦場に出た」イベントを積む (宣言されたキーワードは、characteristics が導く)
// opts.from = どこから出たか (墓地から出たとき from=graveyard。誘発の絞り込みに使う)。opts.tapped = タップ状態で出す
export function enterBattlefield(g: Game, card: GameCard, controller: PlayerId, rules: RuleBook, cast?: CastRecord, opts: { from?: Zone; tapped?: boolean; x?: number } = {}): void {
  const perm: Perm = { id: card.id, card, controller, enteredTurn: g.turn, ...(cast && (cast.kicked || cast.teamwork || cast.alt) ? { cast } : {}) };
  // 「準備済状態で戦場に出る」: 準備呪文を持つクリーチャーだけ
  if (prepareAbilityOf(rules, card.name) && (rules.get(card.name)?.abilities ?? []).some((a) => a.kind === "static" && a.body.some((c) => c.node === "entersPrepared"))) perm.prepared = true;
  if (card.loyalty !== undefined) perm.counters = { loyalty: card.loyalty }; // プレインズウォーカーは、初期忠誠度で戦場に出る
  if (opts.tapped || entersTapped(g, rules, card, controller)) perm.tapped = true; // 「タップ状態で戦場に出る」(Archon of Emeria)
  // 「カウンターが置かれた状態で出る」(entersWith): X 個・決まった数・自分の墓地のカード 1 枚につき
  for (const c of (rules.get(card.name)?.abilities ?? []).filter((a) => a.kind === "static").flatMap((a) => a.body).filter((c) => c.node === "entersWith")) {
    const a = c.args;
    const n = a.x === true ? opts.x ?? 0 : typeof a.count === "number" ? a.count : a.zone === "graveyard" ? g.graveyards[controller].filter((x) => typeof a.type !== "string" || typeIn(x.typeLine, a.type)).length : 0;
    if (n > 0) perm.counters = { ...perm.counters, [String(a.kind)]: (perm.counters?.[String(a.kind)] ?? 0) + n };
  }
  g.battlefield.push(perm);
  g.events.push({ type: "enters", perm, ...(opts.from ? { from: opts.from } : {}) });
}

// 戦場を離れる (墓地へ。トークンは消える)。「戦場を離れた」イベントを積む
export function removeFromBattlefield(g: Game, perm: Perm): void {
  g.battlefield = g.battlefield.filter((x) => x !== perm);
  if (!perm.card.token) putInGraveyard(g, perm.card, "battlefield");
  g.events.push({ type: "leaves", perm, to: "graveyard" });
}

// 再生の盾があれば、1つ使って、破壊のかわりに、タップして戦闘から外れ、ダメージが取り除かれる。使ったら true
export function tryRegenerate(g: Game, perm: Perm): boolean {
  if (!(perm.regen && perm.regen > 0)) return false;
  perm.regen--;
  perm.tapped = true;
  delete perm.damage;
  delete perm.deathtouched;
  delete perm.attacking;
  delete perm.blocking;
  delete perm.blocked;
  delete perm.blockedBy;
  delete perm.attackTarget;
  g.log.push(`${perm.card.name} は再生した`);
  return true;
}

export function stateBased(g: Game, rules: RuleBook): void {
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
      const isCreature = /\bCreature\b/.test(now.typeLine) && now.toughness !== null;
      const byDamage = isCreature && now.toughness! > 0 && ((p.damage ?? 0) >= now.toughness! || !!p.deathtouched) && !now.keywords.includes("indestructible"); // 破壊 (再生で防げる)
      const dead =
        (/\bPlaneswalker\b/.test(now.typeLine) && (p.counters?.loyalty ?? 1) <= 0) ||
        (isCreature && now.toughness! <= 0) ||
        byDamage ||
        (/\bAura\b/.test(now.typeLine) && !g.battlefield.some((o) => o.id === p.attachedTo));
      if (dead && byDamage && !((/\bPlaneswalker\b/.test(now.typeLine) && (p.counters?.loyalty ?? 1) <= 0) || (isCreature && now.toughness! <= 0)) && tryRegenerate(g, p)) continue;
      if (dead) {
        removeFromBattlefield(g, p);
        changed = true;
      }
    }
  }
  for (const p of g.battlefield) delete p.deathtouched; // 接死のダメージによる破壊は、状況起因処理で1回だけ見る (破壊不能で生き残ったら、あとの状況で死なない)
}
