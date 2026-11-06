import { NodeCall } from "./node";
import { Game, GameCard, Perm, PlayerId, RuleBook, normKeyword, typeIn } from "./state";

// 継続効果 (常在型能力・装備・オーラ): パーマネントの「いまの姿」を、保存せずに、そのつど計算する。
// 装備が外れる・オーラが離れる、で自然に元に戻る。レイヤーの順に適用する:
//   レイヤー4 型・名前 (setTypes / setName)、5 色 (setColors)、6 能力 (staticGrant / loseAbilities)、
//   7b 基本のパワー・タフネス (setBaseStats)、7c 修整 (staticModify、カウンター、一時的な修整)
// shortcut: タイムスタンプは見ない (戦場の順)。「能力を失う」は、他のパーマネントの継続効果が、その持ち主の能力に及ぶのを止める (再帰はしない)

export interface Chars {
  name: string;
  typeLine: string;
  colors: string[];
  power: number | null;
  toughness: number | null;
  keywords: string[]; // 小文字・空白なし (firststrike)
  lostAbilities: boolean; // すべての能力を失っている (誘発型・起動型・常在型の能力が働かない)
}

interface Eff {
  call: NodeCall;
  source: Perm;
}

const typeOk = (a: Record<string, unknown>, typeLine: string): boolean => {
  if (typeof a.type === "string" && !typeIn(typeLine, a.type)) return false;
  if (typeof a.notType === "string" && typeIn(typeLine, a.notType)) return false;
  return true;
};

// 継続効果の常在型能力: 最初のノードが affect のもの
const continuous = (s: Perm, rules: RuleBook) => (rules.get(s.card.name)?.abilities ?? []).filter((a) => a.kind === "static" && a.body[0]?.node === "affect");

function affects(s: Perm, aff: NodeCall, p: Perm): boolean {
  if (p.emblem) return false; // 紋章は、継続効果の影響を受けない
  switch (aff.args.who) {
    case "attached":
      return s !== p && s.attachedTo === p.id;
    case "self":
      return s === p;
    case "yours":
      return s.controller === p.controller && typeOk(aff.args, p.card.typeLine);
    default:
      return typeOk(aff.args, p.card.typeLine); // all
  }
}

// 他のパーマネントの継続効果で、すべての能力を失っているか (再帰はしない)
function losesAll(g: Game, p: Perm, rules: RuleBook): boolean {
  if (p.becomes?.some((b) => b.lose)) return true;
  return g.battlefield.some((o) => o !== p && continuous(o, rules).some((ab) => affects(o, ab.body[0], p) && ab.body.slice(1).some((c) => c.node === "loseAbilities")));
}

// p に及ぶ継続効果 (能力を失っている発生源のものは除く)
function effectsOn(g: Game, p: Perm, rules: RuleBook): Eff[] {
  return g.battlefield
    .filter((o) => !losesAll(g, o, rules))
    .flatMap((o) => continuous(o, rules).filter((ab) => affects(o, ab.body[0], p)).flatMap((ab) => ab.body.slice(1).map((call) => ({ call, source: o }))));
}

// 常在型能力のキーワードの宣言 (affect の無い常在型能力の keyword ノード)
const declared = (rules: RuleBook, card: GameCard): string[] =>
  (rules.get(card.name)?.abilities ?? []).filter((a) => a.kind === "static" && a.body[0]?.node !== "affect").flatMap((a) => a.body.filter((c) => c.node === "keyword").map((c) => String(c.args.name)));

export function characteristics(g: Game, p: Perm, rules: RuleBook): Chars {
  const lost = losesAll(g, p, rules);
  const effs = effectsOn(g, p, rules);
  const last = (node: string): NodeCall | undefined => effs.filter((e) => e.call.node === node).map((e) => e.call).pop();
  const base = last("setBaseStats");
  const bec = p.becomes ?? [];
  const becStats = [...bec].reverse().find((b) => b.power !== undefined && b.toughness !== undefined); // 「〜になる」の基本のパワー・タフネスが、いちばん後
  let power: number | null = becStats ? becStats.power! : base ? Number(base.args.power) : p.card.power ?? null;
  let toughness: number | null = becStats ? becStats.toughness! : base ? Number(base.args.toughness) : p.card.toughness ?? null;
  if (power !== null && toughness !== null) {
    const plus = p.counters?.["+1/+1"] ?? 0;
    power += plus + (p.mods ?? []).reduce((a, m) => a + m.power, 0);
    toughness += plus + (p.mods ?? []).reduce((a, m) => a + m.toughness, 0);
    for (const e of effs) if (e.call.node === "staticModify") {
      power += Number(e.call.args.power);
      toughness += Number(e.call.args.toughness);
    }
  }
  const kw = [
    ...(lost ? [] : [...(p.card.keywords ?? []), ...declared(rules, p.card)]),
    ...(p.mods ?? []).flatMap((m) => (m.keyword ? [m.keyword] : [])),
    ...effs.filter((e) => e.call.node === "staticGrant").map((e) => String(e.call.args.keyword)),
  ].map(normKeyword);
  return {
    name: last("setName") ? String(last("setName")!.args.name) : p.card.name,
    typeLine: [...bec].reverse().find((b) => b.types)?.types ?? (last("setTypes") ? String(last("setTypes")!.args.types) : p.card.typeLine),
    colors: [...bec].reverse().find((b) => b.colors)?.colors ?? (last("setColors") ? String(last("setColors")!.args.colors).split(/[\s,]+/).filter(Boolean) : p.card.colors ?? []),
    power,
    toughness,
    keywords: [...new Set(kw)],
    lostAbilities: lost,
  };
}

// この発生源の誘発型能力が、追加で何回誘発するか (extraTriggers)
export const extraTriggers = (g: Game, s: Perm, rules: RuleBook): number => effectsOn(g, s, rules).reduce((a, e) => a + (e.call.node === "extraTriggers" ? Number(e.call.args.amount) : 0), 0);

// コスト軽減 (reduceCost): p が唱える card のマナ総量から引く量。能力を失っていない戦場のパーマネントの、affect の無い常在型能力から集める
export function costReduction(g: Game, p: PlayerId, card: GameCard, rules: RuleBook): number {
  let sum = 0;
  for (const s of g.battlefield) {
    if (losesAll(g, s, rules)) continue;
    for (const ab of rules.get(s.card.name)?.abilities ?? []) {
      if (ab.kind !== "static" || ab.body[0]?.node === "affect") continue;
      for (const c of ab.body) {
        if (c.node !== "reduceCost" || c.args.self === true || !typeOk(c.args, card.typeLine)) continue; // self は、唱えるカード自身の軽減 (下)
        const who = c.args.who ?? "you";
        if (who === "all" || (who === "you" ? s.controller === p : s.controller !== p)) sum += Number(c.args.amount);
      }
    }
  }
  // このカード自身を唱えるときの軽減 (reduceCost self=true): 手札のカードの、常在型能力。per=discarded なら、このターンに捨てた・サイクリングした数ぶん
  for (const ab of rules.get(card.name)?.abilities ?? []) {
    if (ab.kind !== "static") continue;
    for (const c of ab.body) if (c.node === "reduceCost" && c.args.self === true) sum += Number(c.args.amount) * (c.args.per === "discarded" ? g.discarded?.[p] ?? 0 : 1);
  }
  return sum;
}

// アンタップ・ステップ (active のターン) に、s をアンタップするか。ふつうは自分のターンだけ。untapDuring who=opponents / all があれば、他のプレイヤーのターンにも (能力を失っていなければ)
export function untapsDuring(g: Game, s: Perm, active: PlayerId, rules: RuleBook): boolean {
  if (s.controller === active) return true;
  if (losesAll(g, s, rules)) return false;
  return (rules.get(s.card.name)?.abilities ?? []).some((ab) => ab.kind === "static" && ab.body.some((c) => c.node === "untapDuring" && (c.args.who === "all" || c.args.who === "opponents")));
}
