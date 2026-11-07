import { characteristics } from "../continuous";
import { NodeCall } from "../node";
import { Game, GameCard, Perm, PlayerId, RuleBook, typeIn } from "../state";

// 「できない」「かわりに」の枠: 戦場のパーマネントの、常在型能力 (affect の無いもの) に書かれた制限・置換を集めて、調べる。
// 能力を失っているパーマネントの制限は、働かない。制限は、いまの戦場から、そのつど計算する (保存しない)

export interface StaticCall {
  source: Perm;
  call: NodeCall;
}

// 戦場の、node という名前の常在型能力のノード (affect の無い常在型能力)
export function staticCalls(g: Game, rules: RuleBook, node: string): StaticCall[] {
  const out: StaticCall[] = [];
  for (const s of g.battlefield) {
    const abs = (rules.get(s.card.name)?.abilities ?? []).filter((a) => a.kind === "static" && a.body[0]?.node !== "affect" && a.body.some((c) => c.node === node));
    if (!abs.length || characteristics(g, s, rules).lostAbilities) continue;
    for (const ab of abs) for (const call of ab.body) if (call.node === node) out.push({ source: s, call });
  }
  return out;
}

// who (既定は all) が、発生源 (source のコントローラー) から見て、p に当てはまるか
export const whoOk = (who: unknown, sourceController: PlayerId, p: PlayerId): boolean => (who === "you" ? sourceController === p : who === "opponents" ? sourceController !== p : true);

// type / notType (型行) に合うか
export const typeOk = (a: Record<string, unknown>, typeLine: string): boolean => (typeof a.type !== "string" || typeIn(typeLine, a.type)) && (typeof a.notType !== "string" || !typeIn(typeLine, a.notType));

// p が card を唱えられるか。だめなら理由 (castLimit: 1ターンに唱えられる数 / cantCast: 型・マナ総量の制限)
export function castProblem(g: Game, rules: RuleBook, p: PlayerId, card: GameCard, zone = "hand"): string | null {
  for (const { source, call } of staticCalls(g, rules, "castLimit")) {
    if (whoOk(call.args.who, source.controller, p) && (g.spellsBy?.[p] ?? 0) >= Number(call.args.amount)) return `${source.card.name}: 1ターンに唱えられる呪文は ${call.args.amount} つまで`;
  }
  for (const { source, call } of staticCalls(g, rules, "cantCast")) {
    if (!whoOk(call.args.who, source.controller, p) || !typeOk(call.args, card.typeLine)) continue;
    if (typeof call.args.from === "string" && !call.args.from.split("|").includes(zone)) continue; // from= そのゾーンから唱えるときだけ (Grafdigger's Cage)
    if (call.args.mvOverLands === true) {
      const lands = g.battlefield.filter((x) => x.controller === p && /\bLand\b/.test(characteristics(g, x, rules).typeLine)).length;
      if (card.mv > lands) return `${source.card.name}: マナ総量 (${card.mv}) が、土地の数 (${lands}) より大きい呪文は、唱えられない`;
    } else return `${source.card.name}: ${card.name} は、唱えられない`;
  }
  return null;
}

// perm の起動型能力を、起動できないか (cantActivate)。できなければ、その発生源の名前
export function activationBlocked(g: Game, rules: RuleBook, perm: Perm, p: PlayerId): string | null {
  const typeLine = characteristics(g, perm, rules).typeLine;
  for (const { source, call } of staticCalls(g, rules, "cantActivate")) if (whoOk(call.args.who, source.controller, p) && typeOk(call.args, typeLine)) return source.card.name;
  return null;
}

// card が、タップ状態で戦場に出るか (entersTapped)
export function entersTapped(g: Game, rules: RuleBook, card: GameCard, controller: PlayerId): boolean {
  return staticCalls(g, rules, "entersTapped").some(({ source, call }) => whoOk(call.args.who, source.controller, controller) && typeOk(call.args, card.typeLine));
}

// card が、zone (graveyard / library) から戦場に出られないか (cantEnter)
export function enterBlocked(g: Game, rules: RuleBook, card: GameCard, zone: string): boolean {
  return staticCalls(g, rules, "cantEnter").some(({ call }) => String(call.args.from ?? "").split("|").includes(zone) && typeOk(call.args, card.typeLine));
}

// ライフを得られないか (cantGainLife)
export const lifeGainBlocked = (g: Game, rules: RuleBook, p: PlayerId): boolean => staticCalls(g, rules, "cantGainLife").some(({ source, call }) => whoOk(call.args.who, source.controller, p));

// ブロックできないか (cantBlock: このクリーチャー自身の常在型能力。能力を失っていれば、働かない)
export const cantBlockNow = (g: Game, rules: RuleBook, perm: Perm): boolean => (rules.get(perm.card.name)?.abilities ?? []).some((a) => a.kind === "static" && a.body.some((c) => c.node === "cantBlock")) && !characteristics(g, perm, rules).lostAbilities;
