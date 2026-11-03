// ボットに渡す、エンジンの説明とカード一覧 (Obsidian に依存しない)。カテゴリごとに整理して、読みやすくする。
import { Ability, describeAbility } from "./effects";
import { CATEGORIES, TYPE_ENTRIES, TypeEntry, collectUsage, titleOf } from "./typecatalog";

const jaName = (e: TypeEntry) => e.title.match(/\((.+)\)$/)?.[1] ?? e.title;

// エンジンが実行できること / まだできないこと (typecatalog.ts が元データ)
export function engineSummary(): string {
  const line = (cat: (typeof CATEGORIES)[number], label: string) => {
    const es = TYPE_ENTRIES.filter((e) => e.category === cat && e.status !== "planned");
    return es.length ? `- ${label}: ${es.map((e) => `${jaName(e)}${e.status === "partial" ? "(一部)" : ""}`).join("、")}` : "";
  };
  const todo = TYPE_ENTRIES.filter((e) => e.status === "planned" && e.category !== "未実装").map((e) => jaName(e));
  const todo2 = TYPE_ENTRIES.filter((e) => e.category === "未実装" && e.id !== "todo.judge").map((e) => jaName(e));
  return [
    "## エンジンが実行できること",
    line("命令", "命令"),
    line("きっかけ", "誘発のきっかけ"),
    line("コスト", "コスト"),
    line("キーワード", "キーワード"),
    line("ゲームのルール", "ルール"),
    "## まだできないこと(カードにそう書かれていても、何も起きない)",
    `- ${[...todo2, ...todo].join("、")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface CardBrief {
  n: number;
  name: string;
  manaCost: string;
  typeLine: string;
  power?: string;
  toughness?: string;
  oracle: string;
  abilities?: Ability[]; // 処理の記録 (無ければ undefined)
  unsupported: string[]; // 動かない部分
  needsRule: boolean; // 記録が要るカードか
}

const GROUPS: [string, (t: string) => boolean][] = [
  ["クリーチャー", (t) => /\bCreature\b/.test(t)],
  ["呪文(インスタント・ソーサリー)", (t) => /\b(Instant|Sorcery)\b/.test(t)],
  ["土地", (t) => /\bLand\b/.test(t)],
  ["アーティファクト・エンチャント・その他", () => true],
];

// デッキのカード一覧。種類ごとにまとめて、カードごとに「エンジンの理解」「動かない部分」「使っている型」を付ける
export function formatCardList(cards: CardBrief[]): string {
  const out: string[] = [];
  const left = [...cards];
  for (const [label, test] of GROUPS) {
    const group = left.filter((c) => test(c.typeLine));
    for (const c of group) left.splice(left.indexOf(c), 1);
    if (!group.length) continue;
    out.push(`## ${label} (${group.reduce((a, c) => a + c.n, 0)}枚)`);
    for (const c of group.sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(`- ${c.n}x ${c.name} ${c.manaCost} [${c.typeLine}${c.power !== undefined ? ` ${c.power}/${c.toughness}` : ""}]`);
      if (c.oracle) out.push(`  原文: ${c.oracle.replace(/\s+/g, " ").slice(0, 300)}`);
      if (c.abilities?.length) {
        for (const a of c.abilities) out.push(`  エンジンの理解: ${describeAbility(a)}`);
        const types = [...collectUsage(c.abilities)].map((id) => TYPE_ENTRIES.find((e) => e.id === id)).filter((e): e is TypeEntry => !!e && !e.id.startsWith("amount.") && !e.id.startsWith("sel.") && e.id !== "verb.unsupported").map(titleOf);
        if (types.length) out.push(`  使っている型: ${types.join(", ")}`);
      }
      if (c.unsupported.length) out.push(`  ⚠エンジンが実行できない部分(何も起きない): ${c.unsupported.join(" / ")}`);
      else if (!c.abilities && c.needsRule) out.push("  ⚠エンジンは、このカードの効果をまだ実行できない(処理の記録が無い)");
    }
  }
  return out.join("\n");
}
