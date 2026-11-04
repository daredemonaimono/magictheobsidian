import { RuleError, activateAbility, castSpell, playLand } from "./engine";
import { NodeCall } from "./node";
import { getNode } from "./registry";
import { Game, PlayerId, RuleBook } from "./state";

// いまできる行動の一覧 (対戦の画面・CPU・AI が使う)。判定は、エンジンの本物の入口を、コピーした局面で試し撃ちして決める (エンジンと食い違わない)
export type Action = { kind: "land" | "cast"; card: string } | { kind: "activate"; perm: string; index: number };

export const NEEDS_TARGET = "対象を選ぶカードは、まだ使えません";

export const needsTarget = (body: NodeCall[]): boolean => body.some((c) => getNode(c.node)?.isTarget);

const activatedOf = (rules: RuleBook, cardName: string) => rules.get(cardName)?.abilities.filter((a) => a.kind === "activated") ?? [];

// 行動を試す。できれば undefined、できなければ理由。g は変えない
export function tryAction(g: Game, rules: RuleBook, p: PlayerId, a: Action): string | undefined {
  const spell = (name: string) => rules.get(name)?.abilities.find((x) => x.kind === "spell")?.body ?? [];
  if (a.kind === "cast") {
    const c = g.hands[p]?.find((x) => x.id === a.card);
    if (c && needsTarget(spell(c.name))) return NEEDS_TARGET;
  } else if (a.kind === "activate") {
    const perm = g.battlefield.find((x) => x.id === a.perm);
    const ab = perm && activatedOf(rules, perm.card.name)[a.index];
    if (ab && needsTarget(ab.body)) return NEEDS_TARGET;
  }
  const copy = structuredClone({ ...g, decide: undefined }) as Game;
  try {
    if (a.kind === "land") playLand(copy, p, a.card, rules);
    else if (a.kind === "cast") castSpell(copy, p, a.card, {}, rules);
    else if (a.kind === "activate") activateAbility(copy, p, a.perm, a.index, {}, rules);
  } catch (e) {
    return e instanceof RuleError ? e.message : `内部エラー: ${(e as Error).message}`; // ルールのノートの不備でも、画面を止めない (使えない扱い)
  }
  return undefined;
}

// いまできる行動すべて (手札の使えるカード + 自分のパーマネントの使える起動型能力)
export function actionsFor(g: Game, rules: RuleBook, p: PlayerId): Action[] {
  const out: Action[] = [];
  const add = (a: Action) => {
    if (tryAction(g, rules, p, a) === undefined) out.push(a);
  };
  for (const c of g.hands[p] ?? []) add({ kind: /\bLand\b/.test(c.typeLine) ? "land" : "cast", card: c.id });
  for (const perm of g.battlefield) {
    if (perm.controller !== p) continue;
    activatedOf(rules, perm.card.name).forEach((_, index) => add({ kind: "activate", perm: perm.id, index }));
  }
  return out;
}

// 起動型能力ごとの短い表示 ("1: タップ → マナを出す")
export function abilityLabels(rules: RuleBook, cardName: string): string[] {
  return activatedOf(rules, cardName).map((ab, i) => `${i + 1}: ${ab.body.map((c) => getNode(c.node)?.title ?? c.node).join(" → ")}`);
}
