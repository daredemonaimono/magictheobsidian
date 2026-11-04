import { characteristics } from "./continuous";
import { Game, Perm, RuleBook } from "./state";

// ダメージを与える (ダメージのノードと戦闘ダメージで共通)。source = ダメージの発生源のパーマネント (無ければ呪文など。キーワードは効かない)。
// プレイヤー → ライフを失う / クリーチャー → ダメージが載る (接死の発生源なら、致死) / プレインズウォーカー → 忠誠度カウンターを取り除く。絆魂は、与えたダメージの分だけ、発生源のコントローラーがライフを得る
export function dealDamage(g: Game, rules: RuleBook, source: Perm | undefined, targetId: string, amount: number): void {
  if (!(amount > 0)) return;
  const kw = source ? characteristics(g, source, rules).keywords : [];
  if (g.players.includes(targetId)) g.life[targetId] -= amount;
  else {
    const p = g.battlefield.find((x) => x.id === targetId);
    if (!p) return;
    const type = characteristics(g, p, rules).typeLine;
    if (/\bCreature\b/.test(type)) {
      p.damage = (p.damage ?? 0) + amount;
      if (kw.includes("deathtouch")) p.deathtouched = true;
    }
    if (/\bPlaneswalker\b/.test(type)) p.counters = { ...p.counters, loyalty: Math.max(0, (p.counters?.loyalty ?? 0) - amount) };
  }
  if (source && kw.includes("lifelink")) g.life[source.controller] += amount;
}
