import { AiOption, aiAttackers, aiBlockers } from "./ai";
import { cpuDo } from "./cpu";
import { characteristics } from "./continuous";
import { attackersAt, handAbilitiesOf, passPriority } from "./engine";
import { jevFacts } from "./jevFacts";
import { abilityRoles, cardRoles } from "./roles";
import { Game, PlayerId, RuleBook } from "./state";

// AI への「行動の分析」: コードだけで計算する (API を呼ばない・トークンは、文章の長さだけ)。
// 候補ごとの役割 (ノードから導く)・実行したあとの局面 (コピーした局面で、実際に実行して、スタックを解決する)・土地の色・攻撃とブロックの比べ合い。
// AI は、この材料を読んで、最終判断する。純粋な関数 (g は変えない)
const MAX_SIMULATED = 12; // 試し撃ちする候補の数の上限 (1 候補につき、局面のコピーが 1 つ)

interface Snap {
  me: number; foe: number; myCreatures: number; myPower: number; foeCreatures: number; foePower: number; hand: number; myGrave: number; foeGrave: number; lib: number;
}
function snap(g: Game, rules: RuleBook, p: PlayerId): Snap {
  const foe = g.players.find((x) => x !== p) ?? p;
  const cs = (owner: PlayerId) => g.battlefield.filter((x) => x.controller === owner && /\bCreature\b/.test(characteristics(g, x, rules).typeLine));
  const power = (owner: PlayerId) => cs(owner).reduce((a, x) => a + Math.max(0, characteristics(g, x, rules).power ?? 0), 0);
  return { me: g.life[p], foe: g.life[foe], myCreatures: cs(p).length, myPower: power(p), foeCreatures: cs(foe).length, foePower: power(foe), hand: g.hands[p].length, myGrave: g.graveyards[p].length, foeGrave: g.graveyards[foe].length, lib: g.libraries[p].length };
}
// 変わったものだけを、短い文章にする
function diff(a: Snap, b: Snap): string {
  const d = (label: string, x: number, y: number, arrow = true) => (x === y ? [] : [arrow ? `${label} ${x}→${y}` : `${label} ${y - x >= 0 ? "+" : ""}${y - x}`]);
  const parts = [
    ...d("あなたのライフ", a.me, b.me),
    ...d("相手のライフ", a.foe, b.foe),
    ...d("あなたのクリーチャー", a.myCreatures, b.myCreatures, false),
    ...d("あなたのパワー合計", a.myPower, b.myPower, false),
    ...d("相手のクリーチャー", a.foeCreatures, b.foeCreatures, false),
    ...d("相手のパワー合計", a.foePower, b.foePower, false),
    ...d("手札", a.hand, b.hand, false),
    ...d("あなたの墓地", a.myGrave, b.myGrave, false),
    ...d("相手の墓地", a.foeGrave, b.foeGrave, false),
    ...d("ライブラリー", a.lib, b.lib, false),
  ];
  return parts.length ? parts.join(" / ") : "盤面・ライフ・手札は、変わらない";
}

// 候補を、コピーした局面で実行して、スタックを解決したあとの変化 (できなければ undefined)
export function simulate(g: Game, rules: RuleBook, p: PlayerId, opt: AiOption): string | undefined {
  if (!opt.action) return undefined;
  const copy = structuredClone({ ...g, decide: undefined }) as Game;
  copy.priority = p;
  const before = snap(copy, rules, p);
  try {
    cpuDo(copy, rules, p, opt.action, opt.targets);
    for (let i = 0; copy.stack.length && i < 30; i++) passPriority(copy, copy.priority ?? p, rules);
  } catch {
    return undefined;
  }
  return diff(before, snap(copy, rules, p));
}

// 土地の出せる色 (起動型能力の addMana の color)
const colorsOfLand = (rules: RuleBook, name: string): string[] => [...new Set((rules.get(name)?.abilities ?? []).filter((a) => a.kind === "activated").flatMap((a) => a.body.filter((c) => c.node === "addMana" && typeof c.args.color === "string").map((c) => String(c.args.color))))];
const manaColors = (cost: string | undefined): string[] => [...new Set((cost ?? "").match(/[WUBRG]/g) ?? [])];

function actionLines(g: Game, rules: RuleBook, p: PlayerId, opts: AiOption[]): string[] {
  // 手札の呪文に要る色と、場の土地が出せる色
  const have = new Set(g.battlefield.filter((x) => x.controller === p).flatMap((x) => colorsOfLand(rules, x.card.name)));
  const need = [...new Set(g.hands[p].filter((c) => !/\bLand\b/.test(c.typeLine)).flatMap((c) => manaColors(c.manaCost)))];
  const missing = need.filter((c) => !have.has(c));
  const lines: string[] = [];
  let simulated = 0;
  for (const o of opts) {
    if (!o.action) continue;
    const a = o.action;
    const parts: string[] = [];
    if (a.kind === "land") {
      const c = g.hands[p].find((x) => x.id === a.card);
      const cols = c ? colorsOfLand(rules, c.name) : [];
      parts.push(`土地。出せる色: ${cols.join("・") || "無色"}`, `手札の呪文に要る色: ${need.join("・") || "なし"} / 場の土地が出せる色: ${[...have].join("・") || "なし"}${missing.length ? ` / 足りない色: ${missing.join("・")}${cols.some((x) => missing.includes(x)) ? " (この土地で補える)" : ""}` : ""}`);
    } else {
      const roles = a.kind === "cast" ? cardRoles(rules, g.hands[p].find((x) => x.id === a.card)?.name ?? "").all : a.kind === "activate" ? cardRoles(rules, g.battlefield.find((x) => x.id === a.perm)?.card.name ?? "").activated[a.index] ?? [] : abilityRoles(handAbilitiesOf(rules, g.hands[p].find((x) => x.id === a.card)?.name ?? "")[a.index] ?? { kind: "activated", body: [] });
      parts.push(`役割: ${roles.join("・") || "なし (ルールが無い・部品だけ)"}`);
      if (simulated < MAX_SIMULATED) {
        simulated++;
        const s = simulate(g, rules, p, o);
        if (s) parts.push(`実行すると: ${s}`);
      }
    }
    lines.push(`${o.id} (${o.label.replace(/^(唱える|土地を出す|能力を使う): /, "")}): ${parts.join(" / ")}`);
  }
  return lines;
}

// 攻撃: 攻撃できるクリーチャーごとに、相手のブロッカー (アンタップのクリーチャー) との比べ合い
function attackLines(g: Game, rules: RuleBook, p: PlayerId): string[] {
  const foe = g.players.find((x) => x !== p) ?? p;
  const blockers = g.battlefield.filter((x) => x.controller === foe && !x.tapped && /\bCreature\b/.test(characteristics(g, x, rules).typeLine));
  return aiAttackers(g, rules, p).map((a) => {
    const ca = characteristics(g, a, rules);
    const vs = blockers.map((b) => {
      const cb = characteristics(g, b, rules);
      const dies = (cb.power ?? 0) >= (ca.toughness ?? 0);
      const kills = (ca.power ?? 0) >= (cb.toughness ?? 0);
      return `${b.card.name} ${cb.power}/${cb.toughness} にブロックされると、${dies ? "倒される" : "生き残る"}・${kills ? "相手も倒す" : "相手は倒れない"}`;
    });
    return `${a.card.name} ${ca.power}/${ca.toughness}: ${vs.length ? vs.join(" / ") : "相手に、ブロックできるクリーチャーがいない"}`;
  });
}

// ブロック: 攻撃してくるクリーチャーごとに、自分のブロッカーで受けたときの結果
function blockLines(g: Game, rules: RuleBook, p: PlayerId): string[] {
  const mine = aiBlockers(g, rules, p);
  return attackersAt(g, p).map((a) => {
    const ca = characteristics(g, a, rules);
    const vs = mine.map((b) => {
      const cb = characteristics(g, b, rules);
      const dies = (ca.power ?? 0) >= (cb.toughness ?? 0);
      const kills = (cb.power ?? 0) >= (ca.toughness ?? 0);
      return `${b.card.name} ${cb.power}/${cb.toughness} でブロックすると、${dies && kills ? "相打ち" : dies ? "自分だけが倒される" : kills ? "相手だけを倒して生き残る" : "どちらも倒れない"}`;
    });
    return `攻撃してくる ${a.card.name} ${ca.power}/${ca.toughness}: ${vs.length ? vs.join(" / ") : "ブロックできるクリーチャーがいない"}`;
  });
}

export function battleHints(w: "act" | "attack" | "block", g: Game, rules: RuleBook, p: PlayerId, opts: AiOption[] = []): string {
  const f = jevFacts(g, rules, p);
  const facts = `ライフ差 ${f.lifeDiff >= 0 ? "+" : ""}${f.lifeDiff} / 相手を倒すまで ${f.turnsToKillOpp ?? "倒せない"} ターン / 自分が倒されるまで ${f.turnsToKillMe ?? "倒されない"} ターン / 使えるマナ ${f.availableMana} / 相手のアンタップの土地 ${f.oppUntappedMana}`;
  const lines = w === "act" ? actionLines(g, rules, p, opts) : w === "attack" ? attackLines(g, rules, p) : blockLines(g, rules, p);
  return `## 行動の分析 (コードが計算)\nカードのルール (ノード) から導いた役割と、コピーした局面での試し撃ちの結果です。参考にして、最終判断してください。\n計算済みの事実: ${facts}\n${lines.join("\n") || "(分析なし)"}`;
}
