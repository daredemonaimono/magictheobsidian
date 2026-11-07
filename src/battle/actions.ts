import { RuleError, TargetSlot, activateAbility, activateFromGraveyard, activateFromHand, castSpell, graveyardAbilitiesOf, handAbilitiesOf, playLand, targetSlots } from "./engine";
import { activatedAbilities } from "./continuous";
import { characteristics } from "./continuous";
import { activationBlocked } from "./engine/restrict";
import { CastRecord } from "./node";
import { getNode } from "./registry";
import { parseManaCost } from "./mana";
import { Game, PlayerId, RuleBook, typeIn } from "./state";

// いまできる行動の一覧 (対戦の画面・CPU・AI が使う)。判定は、エンジンの本物の入口を、コピーした局面で試し撃ちして決める (エンジンと食い違わない)
export type Action = { kind: "land"; card: string } | { kind: "cast"; card: string } | { kind: "activate"; perm: string; index: number } | { kind: "handAbility"; card: string; index: number } | { kind: "yardAbility"; card: string; index: number } | { kind: "yardCast"; card: string }; // yardAbility / yardCast = 墓地から起動する・唱える。人の画面だけが使う (actionsFor の一覧には入れない)
// handAbility = // handAbility = 手札から起動する能力 (サイクリング)。人の画面だけが使う (actionsFor の一覧には入れない: CPU・AI は使わない)

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
  if (a.kind === "yardAbility" || a.kind === "yardCast") {
    const card = g.graveyards[p]?.find((x) => x.id === a.card);
    const body = card && (a.kind === "yardCast" ? rules.get(card.name)?.abilities.find((x) => x.kind === "spell")?.body : graveyardAbilitiesOf(rules, card.name)[a.index]?.body);
    return card && body ? targetSlots(g, rules, { id: card.id, card, controller: p, targets: {}, cast: {}, body, ...(a.kind === "yardAbility" ? { ability: true, source: card.id } : {}) }) : [];
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
  // 部屋 (Room): 扉を選んでいなければ、どちらかの扉で唱えられれば、唱えられる
  if (a.kind === "cast" && !cast?.door && g.hands[p]?.find((x) => x.id === a.card)?.cost2) {
    const first = tryAction(g, rules, p, a, targets, { ...cast, door: 1 });
    return first === undefined ? undefined : tryAction(g, rules, p, a, targets, { ...cast, door: 2 });
  }
  const slots = slotsOf(g, rules, p, a);
  if (slots.some((x) => x.legal.length < x.min)) return NO_TARGET;
  const t = targets ?? autoTargets(slots);
  const copy = structuredClone({ ...g, decide: undefined }) as Game;
  try {
    if (a.kind === "land") playLand(copy, p, a.card, rules);
    else if (a.kind === "cast") castSpell(copy, p, a.card, t, rules, cast);
    else if (a.kind === "handAbility") activateFromHand(copy, p, a.card, a.index, t, rules);
    else if (a.kind === "yardAbility") activateFromGraveyard(copy, p, a.card, a.index, t, rules);
    else if (a.kind === "yardCast") castSpell(copy, p, a.card, t, rules, { ...cast, from: "graveyard" });
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
  return tryAction(g, rules, p, a, targets, cast) === undefined ? undefined : tryAction(withAllMana(g, rules, p, wantOf(g, p, a, cast)), rules, p, a, targets, cast);
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

// これから払う行動が、要るもの: 色 (WUBRG) と、唱える呪文の型。マナ能力が 2 つ以上ある土地 (Mudflat Village: 無色 / クリーチャー呪文だけの黒) で、どれを使うか決めるため
export interface Want {
  colors: string[];
  typeLine?: string; // 唱える呪文の型行。能力を起動するとき (呪文でないとき) は無い: 制限つきのマナ (呪文を唱えるためにしか使えない) は、使えない
  ability?: boolean;
}
export function wantOf(g: Game, p: PlayerId, a?: Action, cast?: CastRecord): Want | undefined {
  if (!a) return undefined;
  const colorsOf = (cost?: string): string[] => {
    try {
      return cost ? Object.entries(parseManaCost(cost).colors).filter(([k, n]) => "WUBRG".includes(k) && Number(n ?? 0) > 0).map(([k]) => k) : [];
    } catch {
      return [];
    }
  };
  if (a.kind === "cast" || a.kind === "yardCast") {
    const card = (a.kind === "cast" ? g.hands[p] : g.graveyards[p])?.find((x) => x.id === a.card);
    if (!card) return undefined;
    return { colors: colorsOf(cast?.door === 2 && card.cost2 ? card.cost2 : card.manaCost), typeLine: card.typeLine };
  }
  return { colors: [], ability: true };
}

// マナ能力 (マナだけの起動型能力) を、使う順に並べた index。必要な色を出せるもの → 無色 → 要らない色。制限つきのマナ (spellType / spellNotType) は、その呪文を唱えるときだけ。唱える呪文が分からなければ、制限つきも使う
export function manaOrder(abs: { body: { node: string; args?: Record<string, unknown> }[] }[], want?: Want): number[] {
  const scored: [number, number][] = [];
  abs.forEach((ab, i) => {
    if (!manaOnly(ab.body)) return;
    const m = ab.body.find((c) => c.node === "addMana")?.args ?? {};
    const restricted = typeof m.spellType === "string" || typeof m.spellNotType === "string";
    if (restricted && want) {
      if (want.ability || !want.typeLine) return; // 能力の起動には使えない
      if ((typeof m.spellType === "string" && !typeIn(want.typeLine, m.spellType)) || (typeof m.spellNotType === "string" && typeIn(want.typeLine, m.spellNotType))) return; // この呪文には使えない
    }
    const color = typeof m.color === "string" && "WUBRG".includes(m.color) ? m.color : undefined;
    const needed = !!color && (!want || want.colors.includes(color));
    scored.push([needed ? 0 : color ? 2 : 1, i]);
  });
  return scored.sort((x, y) => x[0] - y[0] || x[1] - y[1]).map(([, i]) => i);
}

// マナを出せるパーマネントを、1 つタップして、マナを出す (使えたら真)。デュアルランドは、好きな色のマナ ("A:GU") を出す。それ以外は、index (無ければ、最初に使えるマナ能力) を起動する
export function tapManaSource(g: Game, rules: RuleBook, p: PlayerId, permId: string, index = -1, want?: Want): boolean {
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
  for (const i of index >= 0 ? [index] : manaOrder(abs, want)) {
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

export function withAllMana(g: Game, rules: RuleBook, p: PlayerId, want?: Want): Game {
  const copy = structuredClone({ ...g, decide: undefined }) as Game;
  copy.priority = p;
  for (const perm of copy.battlefield) {
    if (perm.controller !== p) continue;
    if (flexColors(rules, perm.card.name)) {
      tapManaSource(copy, rules, p, perm.id); // デュアルランド: 好きな色のマナ
      continue;
    }
    const abs = activatedAbilities(g, rules, perm);
    for (const index of manaOrder(abs, want)) {
      try {
        activateAbility(copy, p, perm.id, index, {}, rules);
        break; // 1 つのパーマネントは、1 回しかタップできない (複数のマナ能力があっても、使うのは 1 つ)
      } catch {
        /* 使えないものは、次へ */
      }
    }
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
