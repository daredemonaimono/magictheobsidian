import { characteristics } from "../continuous";
import { NodeCall } from "../node";
import { Game, GameCard, Perm, PlayerId, RuleBook, normKeyword, typeIn } from "../state";

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

// 量を変える置換効果 (modifyAmount): 「トークンを作るなら、2 倍」(Doubling Season・Parallel Lives)・「カウンターを置くなら、1 つ多く」(Hardened Scales)・「ダメージを与えるなら、2 倍」(Furnace of Rath)・「ライフを得るなら、2 倍」・「引くなら、2 倍」。
// n = もとの量 (0 以下はそのまま)。p = その量の持ち主 (トークン・カウンター・ライフ・引く: 受け取る人 / ダメージ: 与える発生源のコントローラー)。複数あれば、倍にするものを先に、足すものを、あとで
export function modAmount(g: Game, rules: RuleBook, what: "tokens" | "counters" | "damage" | "lifegain" | "draw", p: PlayerId, n: number): number {
  if (!(n > 0)) return n;
  const calls = staticCalls(g, rules, "modifyAmount").filter(({ source, call }) => call.args.what === what && whoOk(call.args.who, source.controller, p));
  const mul = calls.reduce((a, { call }) => a * Number(call.args.mult ?? 1), 1);
  const add = calls.reduce((a, { call }) => a + Number(call.args.add ?? 0), 0);
  return n * mul + add;
}

// このクリーチャー自身の常在型能力 (能力を失っていれば、働かない)
const selfStatic = (g: Game, rules: RuleBook, perm: Perm, node: string): NodeCall[] =>
  characteristics(g, perm, rules).lostAbilities ? [] : (rules.get(perm.card.name)?.abilities ?? []).filter((a) => a.kind === "static").flatMap((a) => a.body).filter((c) => c.node === node);

// ブロックできないか (cantBeBlocked: attacker は、ブロックされない。exceptKeyword=flying なら、飛行を持つクリーチャーには、ブロックされる。byType=Wall なら、その型のクリーチャーには、ブロックされない)
export function blockForbidden(g: Game, rules: RuleBook, attacker: Perm, blocker: Perm): boolean {
  return selfStatic(g, rules, attacker, "cantBeBlocked").some((c) => {
    if (typeof c.args.byType === "string") return typeIn(characteristics(g, blocker, rules).typeLine, c.args.byType);
    if (typeof c.args.exceptKeyword === "string") return !characteristics(g, blocker, rules).keywords.includes(normKeyword(c.args.exceptKeyword));
    return true;
  });
}
export const cantAttackNow = (g: Game, rules: RuleBook, perm: Perm): boolean => selfStatic(g, rules, perm, "cantAttack").length > 0;
export const mustAttackNow = (g: Game, rules: RuleBook, perm: Perm): boolean => selfStatic(g, rules, perm, "mustAttack").length > 0;
