// 似たカードの記録を探す (Obsidian に依存しない)。新しいカードの記録を AI に作らせるとき、似たカードの記録を例として見せて、書き方を揃える。
export interface Example {
  key: string;
  name: string;
  oracle: string;
  json: string; // 記録の JSON (マクロは use のまま)
  clean: boolean; // 未対応が無い記録か
}

// 効果テキストを、比べやすい単語の集まりにする: カード名は ~、数字は N、マナ記号は M、注釈 (括弧) は除く。単語 1 つと、続く 2 語の組みの両方を使う
export function oracleTokens(text: string, name: string): Set<string> {
  const plain = text
    .replace(/\(.*?\)/g, " ")
    .replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ~ ")
    .replace(/\{[^}]+\}/g, " M ")
    .replace(/\b\d+\b/g, " N ")
    .toLowerCase();
  const words = plain.split(/[^a-z~]+/).filter(Boolean);
  const out = new Set<string>(words);
  for (let i = 0; i + 1 < words.length; i++) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
}

// 似ている順に k 件。未対応の無い記録を、少し優先する。似ていなさすぎるもの (min 未満) は出さない
export function pickSimilar(target: { name: string; oracle: string }, pool: Example[], k = 3, min = 0.12): Example[] {
  const t = oracleTokens(target.oracle, target.name);
  return pool
    .map((e) => ({ e, score: similarity(t, oracleTokens(e.oracle, e.name)) + (e.clean ? 0.05 : -0.05) }))
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.e);
}

export function formatExamples(examples: Example[]): string {
  return examples.map((e) => `- ${e.name}\n  原文: ${e.oracle.replace(/\s+/g, " ").slice(0, 400)}\n  記録: ${e.json.replace(/\s+/g, " ")}`).join("\n");
}
