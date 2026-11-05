import { characteristics } from "../continuous";
import { prepareAbilityOf, Game, GameCard, Perm, PlayerId, RuleBook } from "../state";

// 戦場に出る・離れる・状況起因処理

// パーマネントを戦場に出す。「戦場に出た」イベントを積む (宣言されたキーワードは、characteristics が導く)
export function enterBattlefield(g: Game, card: GameCard, controller: PlayerId, rules: RuleBook): void {
  const perm: Perm = { id: card.id, card, controller, enteredTurn: g.turn };
  // 「準備済状態で戦場に出る」: 準備呪文を持つクリーチャーだけ
  if (prepareAbilityOf(rules, card.name) && (rules.get(card.name)?.abilities ?? []).some((a) => a.kind === "static" && a.body.some((c) => c.node === "entersPrepared"))) perm.prepared = true;
  if (card.loyalty !== undefined) perm.counters = { loyalty: card.loyalty }; // プレインズウォーカーは、初期忠誠度で戦場に出る
  g.battlefield.push(perm);
  g.events.push({ type: "enters", perm });
}

// 戦場を離れる (墓地へ。トークンは消える)。「戦場を離れた」イベントを積む
export function removeFromBattlefield(g: Game, perm: Perm): void {
  g.battlefield = g.battlefield.filter((x) => x !== perm);
  if (!perm.card.token) g.graveyards[perm.card.owner].push(perm.card);
  g.events.push({ type: "leaves", perm });
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
