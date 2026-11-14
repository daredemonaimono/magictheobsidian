import { t } from "../i18n";
import { CardData } from "./card";
import { NodeData } from "./md";
import { KEYWORDS } from "./slots";
import { validate } from "./validate";

// 組んだものの点検。「組んではあるが、原文のすべてを組めていない」ものを、見つける (抜けの疑い)。
// 原文 (英語) の言い回しから、本来ある (はずの) 動作・コスト・対象を拾い、ノードに無ければ、知らせる。
// 完全ではない: 疑いを示すだけ (誤りの可能性もある)。保存は、止めない。
interface Rule {
  re: RegExp; // 原文の中の言い回し
  any: string[]; // あるはずの動作 (どれか 1 つ)。空 = 定義されている動作が、まだ無い (部品が足りない)
  label: string; // 知らせる文での、動作の名前
}
const KW = KEYWORDS.map((k) => k.label.en.toLowerCase().replace(/ /g, "\\s")).join("|");

// 効果の部分 (コロンの後ろ。コロンが無ければ、全体)
const EFFECT: Rule[] = [
  { re: /\bdraws? (?:a|an|one|two|three|four|\d+) cards?\b/i, any: ["draw"], label: "draw" },
  { re: /\bdeals? (?:\d+|x) damage\b/i, any: ["deal-damage"], label: "damage" },
  { re: /\bcounter target\b/i, any: ["counter"], label: "counter" },
  { re: /\badds? (?:\{|(?:one|two|three|four|five|\d+) mana|mana)/i, any: ["add-mana", "add-mana-any-color"], label: "add mana" },
  { re: /\bcreates? .*\btokens?\b/i, any: ["create-token"], label: "create tokens" },
  { re: /\buntaps?\b/i, any: ["untap", "does-not-untap"], label: "untap" },
  { re: /\bsacrifices? (?!this\b.*:)/i, any: ["sacrifice", "sacrifice-cost"], label: "sacrifice" },
  { re: /\bgets? [+\-\u2212]\d+\/[+\-\u2212]\d+/i, any: ["modify-pt"], label: "+N/+N" },
  { re: /\bput(?:s)? (?:a|an|one|two|three|\d+) [\w+\-/]+ counters? on\b/i, any: ["add-counter"], label: "put counters" },
  { re: new RegExp(`\\b(?:has|have|gains?) (?:${KW})\\b`, "i"), any: ["grant-keyword"], label: "keyword" },
  { re: /\bexchange control\b/i, any: ["exchange-control"], label: "exchange control" },
  { re: /\byou may cast\b/i, any: ["may-cast"], label: "you may cast" },
  { re: /\bbecomes? an? [^.]*\b(?:creature|artifact|enchantment|land)\b/i, any: ["become-token"], label: "becomes" },
  { re: /\bgains? \d+ life\b|\bgain life\b/i, any: ["gain-life"], label: "gain life" },
  { re: /\bloses? \d+ life\b/i, any: ["lose-life"], label: "lose life" },
  { re: /\bdestroys?\b/i, any: ["destroy"], label: "destroy" },
  { re: /\bshuffles?\b/i, any: ["shuffle"], label: "shuffle" },
  { re: /\b(?:take|takes) an extra turn\b/i, any: ["extra-turn"], label: "extra turn" },
  { re: /\bcan't be countered\b/i, any: ["cant-be-countered"], label: "can't be countered" },
  { re: /\bloses? the game\b/i, any: ["lose-game"], label: "lose the game" },
  { re: /\bcopy (?:this|that|target) spell\b/i, any: ["copy-spell"], label: "copy a spell" },
  { re: /\battacks each combat if able\b/i, any: ["must-attack"], label: "attacks each combat" },
  { re: /\bplay lands\b/i, any: ["may-play-land"], label: "play lands" },
  { re: /\bthe Ring tempts you\b/i, any: ["ring-tempts"], label: "the Ring tempts you" },
  { re: /\breturn(?:s)? .*\bto (?:its owner's|their owner's|your) hand\b|\bon (?:their choice of )?the top or bottom of (?:their|your) library\b|\bonto the battlefield\b/i, any: ["move-zone"], label: "move to a zone" },
  { re: /\bexile it instead\b/i, any: ["exile-instead-of-graveyard"], label: "exile instead" },
  { re: /\bat the beginning of the next\b/i, any: ["delayed-trigger"], label: "delayed" },
  { re: /\byou may pay \{/i, any: ["may-pay"], label: "you may pay" },
  // 定義されている動作が、まだ無いもの (部品が足りない)
  { re: /\bdiscards?\b/i, any: [], label: "discard" },
  { re: /\bscry\b/i, any: [], label: "scry" },
  { re: /\bsearch(?:es)? (?:your|their|target) library\b/i, any: [], label: "search library" },
  { re: /\bexile (?:target|all|each|another)\b/i, any: [], label: "exile" },
  { re: /\bmills?\b|\bmill \d+/i, any: [], label: "mill" },
  { re: /\btaps? (?:target|all|up to)\b/i, any: [], label: "tap" },
  { re: /\bregenerate\b/i, any: [], label: "regenerate" },
  { re: /\bfights?\b/i, any: [], label: "fight" },
  { re: /\breveals?\b/i, any: [], label: "reveal" },
  { re: /\blook at the top\b/i, any: [], label: "look at the top" },
];

// コストの部分 (コロンの前)
const COST: Rule[] = [
  { re: /\{t\}/i, any: ["tap-self"], label: "{T}" },
  { re: /\bsacrifice\b/i, any: ["sacrifice-cost"], label: "sacrifice" },
  { re: /\bpay \d+ life\b/i, any: ["pay-life"], label: "pay life" },
  { re: /\{(?:[0-9WUBRGCX]|[0-9WUBRGC]\/[0-9WUBRGCP])\}/, any: ["pay-mana"], label: "mana" },
];

export interface AbilityAudit {
  problems: string[]; // 検証の問題 (保存は、できる)
  gaps: string[]; // 抜けの疑い
}

const stepIds = (a: NodeData): Set<string> => new Set([...a.steps.filter((s) => !s.node).map((s) => s.id)]);

export function auditAbility(card: CardData, a: NodeData, hasCard: (n: string, f?: string) => boolean): AbilityAudit {
  const problems = validate(a, (n) => card.abilities.find((x) => x.name === n), hasCard);
  const gaps: string[] = a.unsupported ? [t("gapAiUnsupported", a.unsupported)] : []; // AI が「未対応」と答えた理由 (消えない)
  const text = (a.source ?? a.name).split("\n").join(" ").trim();
  if (a.kind === "keyword" && a.keyword && !a.steps.length) return { problems, gaps }; // キーワードだけの能力 (定義のあるものは、手順が入る)
  // 「コスト: 効果」の形 (コロンの前が、コスト)。忠誠度能力 (+1: / −2: / 0:) も
  const m = /^(.{1,80}?):\s+(.*)$/.exec(text);
  const costText = m && !/^when|^whenever|^at the beginning/i.test(text) ? m[1] : "";
  const effectText = costText ? m![2] : text;
  const miss = (rules: Rule[], src: string, have: Set<string>) => {
    for (const r of rules) {
      const hit = r.re.exec(src);
      if (!hit) continue;
      if (!r.any.length) gaps.push(t("gapUnsupported", hit[0].trim(), r.label));
      else if (!r.any.some((id) => have.has(id))) gaps.push(t("gapMissing", hit[0].trim(), r.any.join(" / ")));
    }
  };
  if (costText) {
    if (/^[+−-]?\d+$/.test(costText.trim())) {
      if (a.loyalty === undefined) gaps.push(t("gapLoyalty", costText.trim()));
    } else {
      if (a.kind !== "activated") gaps.push(t("gapActivated"));
      miss(COST, costText, new Set((a.cost ?? []).map((c) => c.id)));
    }
  }
  miss(EFFECT, effectText, new Set([...stepIds(a), ...(a.cost ?? []).map((c) => c.id)]));
  if (/\btarget\b/i.test(effectText) && !a.target) gaps.push(t("gapTarget"));
  if (/\btarget\b[^.]*\band target\b/i.test(effectText) && !a.alsoTargets?.length) gaps.push(t("gapAlsoTarget")); // 対象が 2 つ
  return { problems, gaps: [...new Set(gaps)] };
}

export interface CardAudit {
  noRules: boolean; // 原文 (ルール・テキスト) があるのに、能力が 1 つも無い (原文の無いカード = バニラのクリーチャー・トークンなどは、組むものが無いので、対象外)
  abilities: (AbilityAudit & { name: string })[];
  problemCount: number;
  gapCount: number;
  needsReview: boolean; // ルールなし・問題あり・抜けの疑いあり
}
export function auditCard(card: CardData, hasCard: (n: string, f?: string) => boolean): CardAudit {
  const abilities = card.abilities.map((a) => ({ name: a.name, ...auditAbility(card, a, hasCard) }));
  const problemCount = abilities.reduce((n, a) => n + a.problems.length, 0);
  const gapCount = abilities.reduce((n, a) => n + a.gaps.length, 0);
  const noRules = card.abilities.length === 0 && !!card.text?.trim();
  return { noRules, abilities, problemCount, gapCount, needsReview: noRules || problemCount > 0 || gapCount > 0 };
}
