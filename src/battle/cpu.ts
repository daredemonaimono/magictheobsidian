import { slotsOf, tryAction } from "./actions";
import { activateAbility, castSpell, playLand } from "./engine";
import { HAND_SIZE, putBottom, redraw } from "./mulligan";
import { Game, GameCard, PlayerId, RuleBook } from "./state";

// 雑魚 CPU。機械的な決まりだけで動く (乱数は、マリガンの切り直しだけ。ターンの中の動きは、同じ局面なら、いつも同じ)。
// やること: 土地を出す・マナを出して、いちばん重い唱えられる呪文を唱える (自分のメインフェイズ、スタックが空のとき)。やらないこと: 相手の呪文への応答、起動型能力 (マナ以外)、攻撃・ブロック (段階6)

export const CPU_MIN_LANDS = 3; // マリガンしない手札の土地の最低枚数
export const CPU_CHEAP_MV = 2; // 「コストの低いカード」のマナ総量 (土地以外で、これ以下)
export const CPU_MAX_MULLIGANS = 3;

const isLand = (c: GameCard) => /\bLand\b/.test(c.typeLine);

// キープするか: 土地が CPU_MIN_LANDS 枚以上で、コストの低い呪文がある。マリガンを重ねたら、条件をゆるめる (2 回目からは土地 2 枚以上、上限に達したら必ずキープ)
export function cpuKeeps(hand: GameCard[], mulligans: number): boolean {
  if (mulligans >= CPU_MAX_MULLIGANS) return true;
  const lands = hand.filter(isLand).length;
  const cheap = hand.some((c) => !isLand(c) && c.mv <= CPU_CHEAP_MV);
  return lands >= Math.max(1, CPU_MIN_LANDS - Math.max(0, mulligans - 1)) && cheap;
}

// 底に置くカード n 枚: 土地が 4 枚を超えて余っていれば土地、そうでなければ、マナ総量の大きい呪文から
export function cpuBottom(hand: GameCard[], n: number): string[] {
  const lands = hand.filter(isLand);
  const spells = hand.filter((c) => !isLand(c)).sort((a, b) => b.mv - a.mv);
  const out: GameCard[] = [];
  for (const l of lands.slice(4)) if (out.length < n) out.push(l);
  for (const c of spells) if (out.length < n) out.push(c);
  for (const l of lands) if (out.length < n && !out.includes(l)) out.push(l);
  return out.slice(0, n).map((c) => c.id);
}

// ロンドン・マリガンまで、続けて行う (開始前に 1 回)。マリガンした回数を返す
export function cpuMulligan(g: Game, p: PlayerId, rng: () => number): number {
  let count = 0;
  while (!cpuKeeps(g.hands[p], count) && count < HAND_SIZE) {
    redraw(g, p, rng);
    count++;
  }
  if (count > 0) putBottom(g, p, cpuBottom(g.hands[p], count));
  g.log.push(count ? `相手はマリガンした (${count} 回)` : "相手はキープした");
  return count;
}

const who = (g: Game, p: PlayerId) => (g.players.indexOf(p) === 0 ? "あなた" : "相手");

// マナだけの起動型能力で、まだタップしていないものを1つ使う (使えたら真)
function tapOne(g: Game, p: PlayerId, rules: RuleBook): boolean {
  for (const perm of g.battlefield) {
    if (perm.controller !== p || perm.tapped) continue;
    const abs = rules.get(perm.card.name)?.abilities.filter((a) => a.kind === "activated") ?? [];
    for (let i = 0; i < abs.length; i++) {
      const body = abs[i].body;
      if (!body.some((c) => c.node === "addMana") || !body.every((c) => c.node === "addMana" || c.node === "cost" || c.node === "timing")) continue;
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

// 対象: 相手 (人) 側のものを選ぶ。選べなければ、その呪文は唱えない (undefined)
// shortcut: 有利になる呪文 (+N/+N・自分のクリーチャーへの強化・対象のプレイヤーがカードを引く) も、人の側を対象にしてしまう。呪文の種類をノードから見分けられるようになったら、直す
function pickTargets(g: Game, rules: RuleBook, p: PlayerId, card: GameCard): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const slot of slotsOf(g, rules, p, { kind: "cast", card: card.id })) {
    const theirs = slot.legal.filter((id) => {
      if (g.players.includes(id)) return id !== p;
      const perm = g.battlefield.find((x) => x.id === id);
      if (perm) return perm.controller !== p;
      return (g.stack.find((s) => s.id === id)?.controller ?? p) !== p;
    });
    const need = Math.max(slot.min, 0);
    if (theirs.length < need) return undefined;
    if (theirs.length) out[slot.as] = theirs.slice(0, Math.max(need, 1)).join(",");
  }
  return out;
}

// 優先権を持っているとき、1つだけ動く。"land" = 土地を出した (続けて動ける) / "cast" = 呪文を唱えた (スタックに積まれた。続けて、パスして、相手に応答させる) / "pass" = 何もしない
export function cpuAct(g: Game, rules: RuleBook, p: PlayerId): "land" | "cast" | "pass" {
  if (g.over || g.mulligan || g.priority !== p || g.active !== p || (g.step !== "main1" && g.step !== "main2") || g.stack.length) return "pass";
  const land = g.hands[p].find((c) => isLand(c) && tryAction(g, rules, p, { kind: "land", card: c.id }) === undefined);
  if (land) {
    g.log.push(`${who(g, p)}が ${land.name} を出した`);
    playLand(g, p, land.id, rules);
    return "land";
  }
  const spells = g.hands[p].filter((c) => !isLand(c)).sort((a, b) => b.mv - a.mv);
  for (const card of spells) {
    const targets = pickTargets(g, rules, p, card);
    if (!targets) continue;
    // 土地・マナ能力を全部使えば払えるか (コピーで確かめる)。払えなければ、1つもタップしない
    const sim = structuredClone({ ...g, decide: undefined }) as Game;
    while (tryAction(sim, rules, p, { kind: "cast", card: card.id }, targets) !== undefined && tapOne(sim, p, rules));
    if (tryAction(sim, rules, p, { kind: "cast", card: card.id }, targets) !== undefined) continue;
    while (tryAction(g, rules, p, { kind: "cast", card: card.id }, targets) !== undefined && tapOne(g, p, rules));
    g.log.push(`${who(g, p)}が ${card.name} を唱えた`);
    castSpell(g, p, card.id, targets, rules);
    return "cast";
  }
  return "pass";
}
