import { RuleError, TargetSlot, activateAbility, activateFromHand, castSpell, handAbilitiesOf, playLand, targetSlots } from "./engine";
import { activatedAbilities } from "./continuous";
import { characteristics } from "./continuous";
import { activationBlocked } from "./engine/restrict";
import { CastRecord } from "./node";
import { getNode } from "./registry";
import { Game, PlayerId, RuleBook } from "./state";

// いまできる行動の一覧 (対戦の画面・CPU・AI が使う)。判定は、エンジンの本物の入口を、コピーした局面で試し撃ちして決める (エンジンと食い違わない)
export type Action = { kind: "land"; card: string } | { kind: "cast"; card: string } | { kind: "activate"; perm: string; index: number } | { kind: "handAbility"; card: string; index: number }; // handAbility = 手札から起動する能力 (サイクリング)。人の画面だけが使う (actionsFor の一覧には入れない: CPU・AI は使わない)

export const NO_TARGET = "対象にできるものがありません";

const activatedOf = (rules: RuleBook, cardName: string) => rules.get(cardName)?.abilities.filter((x) => x.kind === "activated") ?? [];

// 行動が選ばせる対象の一覧 (対象を取らなければ空)
export function slotsOf(g: Game, rules: RuleBook, p: PlayerId, a: Action): TargetSlot[] {
  if (a.kind === "land") return [];
  if (a.kind === "cast") {
    const card = g.hands[p]?.find((x) => x.id === a.card);
    const body = card && rules.get(card.name)?.abilities.find((x) => x.kind === "spell")?.body;
    return card && body ? targetSlots(g, rules, { id: card.id, card, controller: p, targets: {}, cast: {}, body }) : [];
  }
  if (a.kind === "handAbility") {
    const card = g.hands[p]?.find((x) => x.id === a.card);
    const ab = card && handAbilitiesOf(rules, card.name)[a.index];
    return card && ab ? targetSlots(g, rules, { id: card.id, card, controller: p, targets: {}, cast: {}, body: ab.body, ability: true, source: card.id }) : [];
  }
  const perm = g.battlefield.find((x) => x.id === a.perm);
  const ab = perm && activatedAbilities(g, rules, perm)[a.index];
  return perm && ab ? targetSlots(g, rules, { id: perm.id, card: perm.card, controller: p, targets: {}, cast: {}, body: ab.body, ability: true, source: perm.id }) : [];
}

// 「使えるか」を調べるための、仮の対象 (各スロットの先頭から、min か 1 個)
export const autoTargets = (slots: TargetSlot[]): Record<string, string> =>
  Object.fromEntries(slots.filter((x) => x.legal.length).map((x) => [x.as, x.legal.slice(0, Math.max(x.min, 1)).join(",")]));

// 行動を試す。できれば undefined、できなければ理由。g は変えない。targets が無ければ、仮の対象で試す
export function tryAction(g: Game, rules: RuleBook, p: PlayerId, a: Action, targets?: Record<string, string>, cast?: CastRecord): string | undefined {
  const slots = slotsOf(g, rules, p, a);
  if (slots.some((x) => x.legal.length < x.min)) return NO_TARGET;
  const t = targets ?? autoTargets(slots);
  const copy = structuredClone({ ...g, decide: undefined }) as Game;
  try {
    if (a.kind === "land") playLand(copy, p, a.card, rules);
    else if (a.kind === "cast") castSpell(copy, p, a.card, t, rules, cast);
    else if (a.kind === "handAbility") activateFromHand(copy, p, a.card, a.index, t, rules);
    else activateAbility(copy, p, a.perm, a.index, t, rules);
  } catch (e) {
    return e instanceof RuleError ? e.message : `内部エラー: ${(e as Error).message}`; // ルールのノートの不備でも、画面を止めない (使えない扱い)
  }
  return undefined;
}

// いまできる行動すべて (手札の使えるカード + 自分のパーマネントの使える起動型能力)
export function actionsFor(g: Game, rules: RuleBook, p: PlayerId): Action[] {
  const out: Action[] = [];
  if (g.mulligan) return out; // マリガンが終わるまで、何も使えない
  const add = (a: Action) => {
    if (tryAction(g, rules, p, a) === undefined) out.push(a);
  };
  for (const c of g.hands[p] ?? []) add(/\bLand\b/.test(c.typeLine) ? { kind: "land", card: c.id } : { kind: "cast", card: c.id });
  for (const perm of g.battlefield) {
    if (perm.controller !== p) continue;
    activatedAbilities(g, rules, perm).forEach((_, index) => add({ kind: "activate", perm: perm.id, index }));
  }
  return out;
}

// マナだけの能力か。忠誠度能力 (cost loyalty / loyaltyX) は、マナを出すだけでも、マナ能力ではない (スタックを使い、1ターンに1回・ソーサリーのタイミング): 自動で払うマナには、使わない
export const manaOnly = (body: { node: string; args?: Record<string, unknown> }[]): boolean =>
  body.some((c) => c.node === "addMana") && body.every((c) => c.node === "addMana" || c.node === "cost" || c.node === "timing") && !body.some((c) => c.node === "cost" && (c.args?.loyalty !== undefined || c.args?.loyaltyX === true));

// いま (本物の局面で) できなければ、土地・マナ能力のマナを全部出せるとして、できるか。いまできるなら、本物の局面で決める (自分自身をタップする能力 (Wasteland の生け贄など) が、仮の局面で、タップ済みになって、できなくなるのを避ける)。できれば undefined、できなければ理由
export function tryWithMana(g: Game, rules: RuleBook, p: PlayerId, a: Action, targets?: Record<string, string>, cast?: CastRecord): string | undefined {
  return tryAction(g, rules, p, a, targets, cast) === undefined ? undefined : tryAction(withAllMana(g, rules, p), rules, p, a, targets, cast);
}

// 何かできるか (優先権の止まり方「使えるものがあるときだけ」の判定)。土地・マナ・アーティファクトなど、カードの能力のマナ (マナだけの起動型能力) を全部使ったと仮定して、土地を出せる・唱えられる呪文・使える (マナ以外の) 能力があるか。g は変えない
// マナだけの起動型能力を全部使った (と仮定した) コピーの局面。p に優先権がある。g は変えない
// マナ能力が 2 つ以上あり、どれも「{T}: 1 色のマナ」だけの土地 (デュアルランド): 払うとき、その中の好きな色を出せる。出せる色の集合 (例 "GU")。それ以外は undefined
export function flexColors(rules: RuleBook, cardName: string): string | undefined {
  const abs = activatedOf(rules, cardName).filter((a) => manaOnly(a.body));
  if (abs.length < 2) return undefined;
  const cols: string[] = [];
  for (const ab of abs) {
    const costs = ab.body.filter((c) => c.node === "cost");
    const mana = ab.body.filter((c) => c.node === "addMana");
    const c0 = costs[0]?.args ?? {};
    if (costs.length !== 1 || Object.keys(c0).some((k) => k !== "tap") || c0.tap !== true || mana.length !== 1) return undefined;
    const a = mana[0].args;
    if (a.amount !== 1 || typeof a.color !== "string" || !"WUBRG".includes(a.color) || a.spellType !== undefined || a.spellNotType !== undefined) return undefined;
    cols.push(a.color);
  }
  return [...new Set(cols)].join("");
}

// マナを出せるパーマネントを、1 つタップして、マナを出す (使えたら真)。デュアルランドは、好きな色のマナ ("A:GU") を出す。それ以外は、index (無ければ、最初に使えるマナ能力) を起動する
export function tapManaSource(g: Game, rules: RuleBook, p: PlayerId, permId: string, index = -1): boolean {
  const perm = g.battlefield.find((x) => x.id === permId && x.controller === p);
  if (!perm || perm.tapped) return false;
  const flex = flexColors(rules, perm.card.name);
  if (flex && !characteristics(g, perm, rules).lostAbilities && !activationBlocked(g, rules, perm, p)) {
    perm.tapped = true;
    g.mana[p] = (g.mana[p] ?? 0) + 1;
    g.pool[p] ??= {};
    const key = `A:${flex}` as keyof typeof g.pool[typeof p];
    g.pool[p][key] = (g.pool[p][key] ?? 0) + 1;
    return true;
  }
  const abs = activatedAbilities(g, rules, perm);
  for (const i of index >= 0 ? [index] : abs.map((_, k) => k)) {
    if (!abs[i] || !manaOnly(abs[i].body)) continue;
    try {
      activateAbility(g, p, perm.id, i, {}, rules);
      return true;
    } catch {
      /* 使えない: 次へ */
    }
  }
  return false;
}

export function withAllMana(g: Game, rules: RuleBook, p: PlayerId): Game {
  const copy = structuredClone({ ...g, decide: undefined }) as Game;
  copy.priority = p;
  for (const perm of copy.battlefield) {
    if (perm.controller !== p) continue;
    if (flexColors(rules, perm.card.name)) {
      tapManaSource(copy, rules, p, perm.id); // デュアルランド: 好きな色のマナ
      continue;
    }
    activatedAbilities(g, rules, perm).forEach((ab, index) => {
      if (!manaOnly(ab.body)) return;
      try {
        activateAbility(copy, p, perm.id, index, {}, rules);
      } catch {
        /* 使えないものは、飛ばす */
      }
    });
  }
  return copy;
}

export function canRespond(g: Game, rules: RuleBook, p: PlayerId): boolean {
  const copy = withAllMana(g, rules, p);
  return actionsFor(copy, rules, p).some((a) => {
    if (a.kind === "cast" || a.kind === "land") return true; // 土地を出せるのも、できること
    if (a.kind !== "activate") return false;
    const perm = copy.battlefield.find((x) => x.id === a.perm);
    const ab = perm && activatedAbilities(g, rules, perm)[a.index];
    return !!ab && !manaOnly(ab.body);
  });
}

// マナを使う先があるか: 土地・マナ能力を全部使ったとして、唱えられる呪文・使える (マナ以外の) 能力がある。無ければ、いまマナを出しても、進めるとマナが消えるだけ
export function manaUseful(g: Game, rules: RuleBook, p: PlayerId): boolean {
  const copy = withAllMana(g, rules, p);
  return actionsFor(copy, rules, p).some((a) => {
    if (a.kind === "cast") return true;
    if (a.kind !== "activate") return false;
    const perm = copy.battlefield.find((x) => x.id === a.perm);
    const ab = perm && activatedAbilities(g, rules, perm)[a.index];
    return !!ab && !manaOnly(ab.body);
  });
}

// 人の操作で、使う意味のない「マナを出すだけの能力」か (マナの使い道が無いとき、タップさせない)。CPU・AI は、必要なぶんだけ自分でタップするので、これを使わない
export function uselessMana(g: Game, rules: RuleBook, p: PlayerId, a: Action): boolean {
  if (a.kind !== "activate") return false;
  const perm = g.battlefield.find((x) => x.id === a.perm);
  const ab = perm && activatedAbilities(g, rules, perm)[a.index];
  return !!ab && manaOnly(ab.body) && !manaUseful(g, rules, p);
}

// 起動型能力ごとの短い表示 ("1: タップ → マナを出す")
// 忠誠度能力は、先頭に忠誠度 (+1 / −2 / −X) を出し、コストのノードは省く ("+1: マナを加える")。それ以外は、番号 ("1: コスト → ...")
export function abilityLabels(rules: RuleBook, cardName: string): string[] {
  return activatedOf(rules, cardName).map((ab, i) => {
    const cost = ab.body.find((c) => c.node === "cost");
    const loyalty = cost?.args.loyaltyX === true ? "−X" : cost?.args.loyalty !== undefined && !Number.isNaN(Number(cost.args.loyalty)) ? (Number(cost.args.loyalty) >= 0 ? `+${Number(cost.args.loyalty)}` : `−${-Number(cost.args.loyalty)}`) : undefined;
    const body = (loyalty ? ab.body.filter((c) => c !== cost) : ab.body).map((c) => getNode(c.node)?.title ?? c.node).join(" → ");
    return `${loyalty ?? `${i + 1}`}: ${body}`;
  });
}
