import { characteristics } from "../continuous";
import { CastRecord } from "../node";
import { entersTapped, staticCalls, whoOk } from "./restrict";
import { announceEffect, prepareAbilityOf, putInGraveyard, typeIn, Game, GameCard, Perm, PlayerId, RuleBook, Zone } from "../state";

// 戦場に出る・離れる・状況起因処理

// パーマネントを戦場に出す。「戦場に出た」イベントを積む (宣言されたキーワードは、characteristics が導く)
// opts.from = どこから出たか (墓地から出たとき from=graveyard。誘発の絞り込みに使う)。opts.tapped = タップ状態で出す
export function enterBattlefield(g: Game, card: GameCard, controller: PlayerId, rules: RuleBook, cast?: CastRecord, opts: { from?: Zone; tapped?: boolean; x?: number } = {}): void {
  const perm: Perm = { id: card.id, card, controller, enteredTurn: g.turn, ...(cast && (cast.kicked || cast.teamwork || cast.alt || (cast.from && cast.from !== "hand")) ? { cast } : {}) };
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
  const repl = (rules.get(card.name)?.abilities ?? []).filter((a) => a.kind === "static").flatMap((a) => a.body).find((c) => c.node === "exileInstead");
  if (repl) perm.exileInstead = repl.args.who as "opponents" | "you" | "all"; // shortcut: すべての能力を失っても、置換は残る (出たときに写すだけ)
  // 「エンジン始動!」: 速度が無ければ、1 から始まる
  if ((rules.get(card.name)?.abilities ?? []).some((a) => a.kind === "static" && a.body.some((c) => c.node === "startEngines")) && !(g.speed?.[controller] ?? 0)) {
    (g.speed ??= {})[controller] = 1;
    (g.speedBy ??= {})[controller] = card.name;
    g.log.push(`${card.name}: ${controller === "you" ? "あなた" : controller === "opp" ? "相手" : controller}の速度が 1 になった`);
  }
  g.battlefield.push(perm);
  g.events.push({ type: "enters", perm, ...(opts.from ? { from: opts.from } : {}) });
}

// 戦場を離れる (墓地へ。トークンは消える)。「戦場を離れた」イベントを積む
export function removeFromBattlefield(g: Game, perm: Perm): void {
  g.battlefield = g.battlefield.filter((x) => x !== perm);
  const to = perm.card.token ? "graveyard" : putInGraveyard(g, perm.card, "battlefield");
  g.events.push({ type: "leaves", perm, to });
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
  announceEffect(g, `再生: ${perm.card.name}`, perm.card.name);
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
    // 伝説のルール: 同じプレイヤーが、同名の伝説のパーマネントを 2 つ以上コントロールしたら、1 つを選んで残し、ほかは墓地に置く (生け贄でも破壊でもない。「死んだ」の誘発は起きる)
    for (const owner of g.players) {
      const groups = new Map<string, Perm[]>();
      const exempt = staticCalls(g, rules, "ignoreLegendRule"); // 伝説のルールを無視するカード (Mirror Gallery): 能力を失っていないもの
      for (const x of g.battlefield) {
        if (x.controller !== owner) continue;
        if (exempt.some(({ source, call }) => (call.args.who === "self" ? source === x : whoOk(call.args.who, source.controller, owner)))) continue; // このパーマネントには、伝説のルールが働かない
        const now = characteristics(g, x, rules);
        if (/\bLegendary\b/.test(now.typeLine)) groups.set(now.name, [...(groups.get(now.name) ?? []), x]);
      }
      for (const [name, same] of groups) {
        if (same.length < 2) continue;
        const keep = g.decide?.legend?.(g, owner, same) ?? same[0];
        for (const x of same) {
          if (x === keep) continue;
          g.log.push(`伝説のルール: ${name} が 2 体いるので、1 体を墓地に置いた`);
          announceEffect(g, `伝説のルール: ${name} を 1 体、墓地に置いた`, name);
          removeFromBattlefield(g, x);
          changed = true;
        }
      }
    }
  }
  for (const p of g.battlefield) delete p.deathtouched; // 接死のダメージによる破壊は、状況起因処理で1回だけ見る (破壊不能で生き残ったら、あとの状況で死なない)
}
