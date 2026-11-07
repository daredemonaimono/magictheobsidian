import { characteristics } from "../continuous";
import { activatedAbilities } from "../continuous";
import { spendGeneric } from "../mana";
import { Game, PlayerId, RuleBook } from "../state";
import { removeFromBattlefield } from "./battlefield";
import { costOf, costProblem, payCost } from "./costs";
import { activateAbility } from "./cast";
import { staticCalls, typeOk, whoOk } from "./restrict";

// 維持コスト (upkeepTax): 「〜は、コントローラーのアップキープの開始時に、{N} を支払わないかぎり、生け贄 (破壊) される」。
// shortcut: スタックを使わず、アップキープの開始時に、そのプレイヤーのパーマネントを1つずつ、その場で解決する。マナは、払えるなら、マナ能力を自動でタップして払う

// マナだけの起動型能力を1つタップして、マナを出す (出せたら真)
export function tapOneSource(g: Game, p: PlayerId, rules: RuleBook): boolean {
  for (const perm of g.battlefield) {
    if (perm.controller !== p || perm.tapped) continue;
    const abs = activatedAbilities(g, rules, perm);
    for (let i = 0; i < abs.length; i++) {
      const body = abs[i].body;
      const manaOnly = body.some((c) => c.node === "addMana") && body.every((c) => c.node === "addMana" || c.node === "cost" || c.node === "timing") && !body.some((c) => c.node === "cost" && (c.args?.loyalty !== undefined || c.args?.loyaltyX === true));
      if (!manaOnly) continue;
      try {
        activateAbility(g, p, perm.id, i, {}, rules);
        return true;
      } catch {
        /* 使えない: 次へ */
      }
    }
  }
  return false;
}

// いまのプールと、タップできるマナ源で、汎用 n を払えるか (g は変えない)
function canPay(g: Game, p: PlayerId, n: number, rules: RuleBook): boolean {
  const sim = structuredClone({ ...g, decide: undefined }) as Game;
  while (!spendGeneric(sim, p, n, false) && tapOneSource(sim, p, rules));
  return spendGeneric(sim, p, n, false);
}

export function applyUpkeepTaxes(g: Game, rules: RuleBook, player: PlayerId): void {
  const taxes = staticCalls(g, rules, "upkeepTax");
  if (!taxes.length) return;
  const jobs = g.battlefield.flatMap((x) => (x.controller === player ? taxes.filter((t) => whoOk(t.call.args.who, t.source.controller, x.controller) && typeOk(t.call.args, characteristics(g, x, rules).typeLine)).map((t) => ({ perm: x, tax: t })) : []));
  for (const { perm, tax } of jobs) {
    if (!g.battlefield.includes(perm)) continue;
    const n = Number(tax.call.args.mana);
    const why = `${perm.card.name}: ${tax.source.card.name} (${tax.call.args.else === "destroy" ? "破壊される" : "生け贄に捧げる"})`;
    if (canPay(g, player, n, rules) && (g.decide?.pay?.(g, player, n, why) ?? true)) {
      while (!spendGeneric(g, player, n, false) && tapOneSource(g, player, rules));
      spendGeneric(g, player, n);
      g.log.push(`${perm.card.name} のために {${n}} を支払った (${tax.source.card.name})`);
      continue;
    }
    if (tax.call.args.else === "destroy" && characteristics(g, perm, rules).keywords.includes("indestructible")) continue;
    g.log.push(`${perm.card.name} は、支払われなかったので、${tax.call.args.else === "destroy" ? "破壊された" : "生け贄に捧げられた"} (${tax.source.card.name})`);
    removeFromBattlefield(g, perm);
  }
}

// 色つきのマナコスト ("{B}") を、払えるなら、マナ能力を自動でタップして払う (払えなければ、何も変えず false)。「{B} を支払ってもよい。そうしたなら」(payMana)
export function payManaCost(g: Game, p: PlayerId, manaCost: string, rules: RuleBook): boolean {
  const cost = costOf([{ node: "cost", args: { manaCost } }]);
  const attempt = (game: Game): boolean => {
    for (let i = 0; i < 12; i++) {
      if (!costProblem(game, p, cost, undefined, [], rules)) {
        payCost(game, p, cost, undefined, []);
        return true;
      }
      if (!tapOneSource(game, p, rules)) return false;
    }
    return false;
  };
  const sim = structuredClone({ ...g, decide: undefined }) as Game;
  return attempt(sim) && attempt(g);
}
