// カードの診断と動作テスト (Obsidian に依存しない)。
// 診断: エンジンが理解した内容を日本語にして、原文と並べる。動作テスト: 仮の盤面で、そのカードを唱える・起動して、最後まで動くか調べる (API は使わない)。
import { Ability, describeAbility, unsupportedIn } from "./effects";
import { CardDef, Controller, Game, makeDef } from "./engine";

export interface Smoke {
  status: "ok" | "unsupported" | "failed" | "unchecked" | "skipped";
  notes: string[];
}

const wild = makeDef({
  key: "Wild", name: "Wild", typeLine: "Land", manaCost: "", cmc: 0, oracle: "",
  abilities: [{ kind: "mana", cost: { tap: true }, effects: [{ do: "addMana", options: "WUBRGC" }] }],
});
const basic = (name: string, sub: string) => makeDef({ key: name, name, typeLine: `Basic Land — ${sub}`, manaCost: "", cmc: 0, oracle: "" });
const dummy = makeDef({ key: "Dummy", name: "Dummy", typeLine: "Creature — Dummy", manaCost: "{1}", cmc: 1, power: 3, toughness: 3, oracle: "" });
const oddLand = makeDef({ key: "Odd", name: "Odd Land", typeLine: "Land", manaCost: "", cmc: 0, oracle: "" });
const rock = makeDef({ key: "Rock", name: "Rock", typeLine: "Artifact", manaCost: "{1}", cmc: 1, oracle: "" });

// 仮の盤面で 1 回走らせる。subject を手札に置く (onField なら、最初から場に置く)
async function run(def: CardDef, onField: boolean, turns: number) {
  const pad: CardDef[] = [];
  for (let i = 0; i < 6; i++) pad.push(basic("Plains", "Plains"), basic("Swamp", "Swamp"), basic("Island", "Island"), basic("Mountain", "Mountain"), basic("Forest", "Forest"), dummy);
  const done = new Set<string>();
  const flags = { cast: false, land: false, activated: 0 };
  const explorer: Controller = async (g, d) => {
    if (d.type === "choice") return 0;
    if (d.type === "attackers") return [];
    if (d.type === "blockers") return [];
    const mine = (uid: number) => g.card(uid)?.def.key === def.key;
    const land = d.actions.find((a) => a.kind === "land" && mine(a.uid));
    if (land && !flags.land) return (flags.land = true), land;
    const cast = d.actions.find((a) => a.kind === "cast" && mine(a.uid));
    if (cast && !flags.cast) return (flags.cast = true), cast;
    const act = d.actions.find((a) => a.kind === "activate" && mine(a.uid) && !done.has(`${a.uid}.${a.index}`));
    if (act && act.kind === "activate") return done.add(`${act.uid}.${act.index}`), flags.activated++, act;
    return { kind: "pass" };
  };
  const g = new Game([pad, pad], 11, [explorer, async (_g, d) => (d.type === "priority" ? { kind: "pass" } : d.type === "choice" ? 0 : [])], { opening: false, first: 0 });
  const p0 = g.s.players[0];
  const p1 = g.s.players[1];
  let uid = 50000;
  const perm = (d: CardDef, owner: number) => ({ uid: uid++, def: d, owner, controller: owner, tapped: false, sick: false, damage: 0, attacking: false });
  p0.field = Array.from({ length: 10 }, () => perm(wild, 0));
  p1.field = [perm(dummy, 1), perm(oddLand, 1), perm(rock, 1)];
  p1.hand = [dummy, oddLand, dummy].map((d) => ({ uid: uid++, def: d, owner: 1 }));
  if (onField) p0.field.push(perm(def, 0));
  else p0.hand = [{ uid: uid++, def, owner: 0 }];
  const before = JSON.stringify([p0.life, p1.life, p0.hand.length, p1.hand.length, p0.library.length, p1.library.length, p0.graveyard.length, p1.graveyard.length, p0.field.length, p1.field.length, p0.exile.length, p1.exile.length]);
  await g.play(turns);
  const after = JSON.stringify([p0.life, p1.life, p0.hand.length, p1.hand.length, p0.library.length, p1.library.length, p0.graveyard.length, p1.graveyard.length, p0.field.length, p1.field.length, p0.exile.length, p1.exile.length]);
  return { log: g.s.log, changed: before !== after, flags };
}

export async function smokeTest(def: CardDef): Promise<Smoke> {
  const abilities = def.abilities;
  const hasEffects = abilities.some((a) => a.kind !== "mana" || a.effects.some((e) => e.do !== "addMana"));
  if (!abilities.length) return { status: "skipped", notes: ["能力の記録が無い (キーワードだけ・バニラ、または記録なし)"] };
  const notes: string[] = [];
  try {
    const a = await run(def, false, 1);
    const unsupported = a.log.filter((l) => l.startsWith("未対応の効果"));
    unsupported.forEach((l) => notes.push(l));
    const needsField = abilities.some((x) => x.kind === "triggered" && x.trigger?.event !== "etb");
    let checkedTrigger = !needsField;
    if (needsField) {
      const b = await run(def, true, 3);
      b.log.filter((l) => l.startsWith("未対応の効果")).forEach((l) => notes.push(l));
      if (b.log.some((l) => l.startsWith("誘発:"))) checkedTrigger = true;
      else notes.push("誘発が起きなかった (きっかけが仮の盤面で起きない可能性)");
      if (b.log.some((l) => l.startsWith("未対応の効果"))) unsupported.push("(場にある状態で)未対応の効果");
    }
    const ran = a.changed || a.log.some((l) => l.includes("を解決") || l.includes("能力を解決") || l.includes("マナ") || l.includes("起動"));
    if (unsupported.length) return { status: "unsupported", notes };
    if (!hasEffects) return { status: "ok", notes: ["マナ能力だけ (自動の支払いで使われる)"] };
    if (!ran || !checkedTrigger) return { status: "unchecked", notes: notes.length ? notes : ["効果が動いたか確認できなかった"] };
    return { status: "ok", notes: [`唱える ${a.flags.cast ? "○" : "—"} / 土地を出す ${a.flags.land ? "○" : "—"} / 起動 ${a.flags.activated} 回`] };
  } catch (e) {
    return { status: "failed", notes: [`例外: ${(e as Error).message}`] };
  }
}

export interface DiagCard {
  key: string;
  name: string;
  typeLine: string;
  manaCost: string;
  oracle: string;
  power?: string;
  toughness?: string;
  keywords?: string[];
  abilities?: Ability[]; // 記録 (無ければ undefined)
  unsupported: string[];
  status?: string; // 記録の status (ok / partial / manual)
  vocab?: number;
  stale: boolean;
  needsRule: boolean;
  smoke?: Smoke;
}

const SMOKE_JA: Record<Smoke["status"], string> = { ok: "OK", unsupported: "未対応あり", failed: "失敗", unchecked: "確認できず", skipped: "対象外" };

export function problemOf(c: DiagCard): string | undefined {
  if (c.needsRule && !c.abilities) return "処理の記録が無い";
  if (c.stale) return "古い記録 (ルール化で作り直せる)";
  if (c.smoke?.status === "failed") return "動作テスト失敗";
  if (c.unsupported.length || c.smoke?.status === "unsupported") return "一部未対応";
  if (/\bCreature\b/.test(c.typeLine) && (c.power === undefined || c.keywords === undefined)) return "パワー・タフネス/キーワードが未取得";
  if (c.smoke?.status === "unchecked") return "動作を確認できず";
  return undefined;
}

export function renderDiagnosis(deckName: string, cards: DiagCard[], now: string): string {
  const withProblem = cards.filter((c) => problemOf(c));
  const count = (f: (c: DiagCard) => boolean) => cards.filter(f).length;
  const lines: string[] = [
    "---",
    "mtg: bot-diagnosis",
    `deck: "[[${deckName}]]"`,
    `updated: ${now}`,
    "tags: [mtg/bot-diagnosis]",
    "---",
    "",
    `# 診断: ${deckName}`,
    "",
    "エンジンがカードをどう理解しているかを、原文と並べたもの。動作テストは、仮の盤面で唱える・起動して、最後まで動くかを調べた結果(API は使わない)。",
    "",
    "## 要約",
    "",
    `- カード ${cards.length} 種 / 問題あり ${withProblem.length} 種`,
    `- 処理の記録が無い: ${count((c) => c.needsRule && !c.abilities)}`,
    `- 一部未対応: ${count((c) => problemOf(c) === "一部未対応")}`,
    `- 古い記録: ${count((c) => c.stale)}`,
    `- 動作テスト失敗: ${count((c) => c.smoke?.status === "failed")}`,
    `- パワー・タフネス/キーワード未取得: ${count((c) => /\bCreature\b/.test(c.typeLine) && (c.power === undefined || c.keywords === undefined))}`,
    "",
    "## 問題のあるカード",
    "",
    ...(withProblem.length ? withProblem.map((c) => `- [[#${c.name}]]: ${problemOf(c)}`) : ["- なし"]),
    "",
    "## カードごと",
    "",
  ];
  const ordered = [...withProblem, ...cards.filter((c) => !problemOf(c))];
  for (const c of ordered) {
    lines.push(`### ${c.name}`, "", `- ${c.typeLine}${c.manaCost ? ` ${c.manaCost}` : ""}${c.power !== undefined ? ` ${c.power}/${c.toughness}` : ""}`);
    lines.push(`- 状態: ${problemOf(c) ?? "問題なし"}`);
    lines.push(`- キーワード(エンジンが読む): ${c.keywords?.length ? c.keywords.join(", ") : "なし"}`);
    lines.push(`- 記録: ${c.abilities ? `あり (status: ${c.status ?? "?"}, vocab: ${c.vocab ?? "なし"})` : c.needsRule ? "なし (要)" : "不要"}`);
    if (c.abilities?.length) for (const a of c.abilities) lines.push(`  - ${describeAbility(a)}`);
    lines.push(`- 未対応: ${c.unsupported.length ? "" : "なし"}`);
    c.unsupported.forEach((u) => lines.push(`  - ${u}`));
    if (c.smoke) {
      lines.push(`- 動作テスト: ${SMOKE_JA[c.smoke.status]}`);
      c.smoke.notes.forEach((n) => lines.push(`  - ${n}`));
    }
    lines.push(`- 原文:`, "", "  > " + (c.oracle || "(なし)").replace(/\n/g, "\n  > "), "");
  }
  return lines.join("\n");
}

export { unsupportedIn };
