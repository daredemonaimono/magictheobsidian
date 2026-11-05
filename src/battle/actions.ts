import { RuleError, TargetSlot, activateAbility, castSpell, playLand, targetSlots } from "./engine";
import { getNode } from "./registry";
import { Game, PlayerId, RuleBook } from "./state";

// いまできる行動の一覧 (対戦の画面・CPU・AI が使う)。判定は、エンジンの本物の入口を、コピーした局面で試し撃ちして決める (エンジンと食い違わない)
export type Action = { kind: "land"; card: string } | { kind: "cast"; card: string } | { kind: "activate"; perm: string; index: number };

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
  const perm = g.battlefield.find((x) => x.id === a.perm);
  const ab = perm && activatedOf(rules, perm.card.name)[a.index];
  return perm && ab ? targetSlots(g, rules, { id: perm.id, card: perm.card, controller: p, targets: {}, cast: {}, body: ab.body, ability: true, source: perm.id }) : [];
}

// 「使えるか」を調べるための、仮の対象 (各スロットの先頭から、min か 1 個)
export const autoTargets = (slots: TargetSlot[]): Record<string, string> =>
  Object.fromEntries(slots.filter((x) => x.legal.length).map((x) => [x.as, x.legal.slice(0, Math.max(x.min, 1)).join(",")]));

// 行動を試す。できれば undefined、できなければ理由。g は変えない。targets が無ければ、仮の対象で試す
export function tryAction(g: Game, rules: RuleBook, p: PlayerId, a: Action, targets?: Record<string, string>): string | undefined {
  const slots = slotsOf(g, rules, p, a);
  if (slots.some((x) => x.legal.length < x.min)) return NO_TARGET;
  const t = targets ?? autoTargets(slots);
  const copy = structuredClone({ ...g, decide: undefined }) as Game;
  try {
    if (a.kind === "land") playLand(copy, p, a.card, rules);
    else if (a.kind === "cast") castSpell(copy, p, a.card, t, rules);
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
    activatedOf(rules, perm.card.name).forEach((_, index) => add({ kind: "activate", perm: perm.id, index }));
  }
  return out;
}

const manaOnly = (body: { node: string }[]): boolean => body.some((c) => c.node === "addMana") && body.every((c) => c.node === "addMana" || c.node === "cost" || c.node === "timing"); // エンジンも、timing を除いて、マナ能力かを決める

// 何かできるか (優先権の止まり方「使えるものがあるときだけ」の判定)。土地・マナ・アーティファクトなど、カードの能力のマナ (マナだけの起動型能力) を全部使ったと仮定して、土地を出せる・唱えられる呪文・使える (マナ以外の) 能力があるか。g は変えない
export function canRespond(g: Game, rules: RuleBook, p: PlayerId): boolean {
  const copy = structuredClone({ ...g, decide: undefined }) as Game;
  copy.priority = p;
  for (const perm of copy.battlefield) {
    if (perm.controller !== p) continue;
    activatedOf(rules, perm.card.name).forEach((ab, index) => {
      if (!manaOnly(ab.body)) return;
      try {
        activateAbility(copy, p, perm.id, index, {}, rules);
      } catch {
        /* 使えないものは、飛ばす */
      }
    });
  }
  return actionsFor(copy, rules, p).some((a) => {
    if (a.kind === "cast" || a.kind === "land") return true; // 土地を出せるのも、できること
    if (a.kind !== "activate") return false;
    const perm = copy.battlefield.find((x) => x.id === a.perm);
    const ab = perm && activatedOf(rules, perm.card.name)[a.index];
    return !!ab && !manaOnly(ab.body);
  });
}

// 起動型能力ごとの短い表示 ("1: タップ → マナを出す")
export function abilityLabels(rules: RuleBook, cardName: string): string[] {
  return activatedOf(rules, cardName).map((ab, i) => `${i + 1}: ${ab.body.map((c) => getNode(c.node)?.title ?? c.node).join(" → ")}`);
}
