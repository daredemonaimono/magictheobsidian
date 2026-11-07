import { characteristics } from "./continuous";
import { lifeGainBlocked, modAmount } from "./engine/restrict";
import { Game, Perm, RuleBook, gainLife, loseLife } from "./state";

// ダメージを与える (ダメージのノードと戦闘ダメージで共通)。source = ダメージの発生源のパーマネント (無ければ呪文など。キーワードは効かない)。
// プレイヤー → ライフを失う / クリーチャー → ダメージが載る (接死の発生源なら、致死) / プレインズウォーカー → 忠誠度カウンターを取り除く。絆魂は、与えたダメージの分だけ、発生源のコントローラーがライフを得る
// combat = 戦闘ダメージ。ダメージを与えたら、damaged のイベントを積む (「クリーチャーにダメージを与えたら」の誘発)
export function dealDamage(g: Game, rules: RuleBook, source: Perm | undefined, targetId: string, amount: number, combat = false): void {
  if (!(amount > 0)) return;
  amount = modAmount(g, rules, "damage", source?.controller ?? g.active, amount); // 置換効果 (ダメージを倍にする)
  const kw = source ? characteristics(g, source, rules).keywords : [];
  let kind: "player" | "creature" | "planeswalker" | undefined;
  if (g.players.includes(targetId)) {
    loseLife(g, targetId, amount);
    kind = "player";
  } else {
    const p = g.battlefield.find((x) => x.id === targetId);
    if (!p) return;
    const type = characteristics(g, p, rules).typeLine;
    if (/\bCreature\b/.test(type)) {
      kind = "creature";
      p.damage = (p.damage ?? 0) + amount;
      if (kw.includes("deathtouch")) p.deathtouched = true;
    }
    if (/\bPlaneswalker\b/.test(type)) kind = "planeswalker";
    if (/\bPlaneswalker\b/.test(type)) p.counters = { ...p.counters, loyalty: Math.max(0, (p.counters?.loyalty ?? 0) - amount) };
  }
  if (source && kw.includes("lifelink") && !lifeGainBlocked(g, rules, source.controller)) gainLife(g, source.controller, modAmount(g, rules, "lifegain", source.controller, amount));
  if (kind) g.events.push({ type: "damaged", source, target: targetId, kind, amount, combat });
}
