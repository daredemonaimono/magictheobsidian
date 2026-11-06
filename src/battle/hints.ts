import { Ability, splitOracle } from "./splitText";
import { allNodes } from "./registry";

// 効果テキストを、コードで切った結果を、LLM へのヒントの文章にする (純粋な関数。切る段 = splitText)。
// LLM は、丸ごと読んで考える代わりに、「この節は draw・数字は 3・対象は player」のような、機械的な下ごしらえを、参考にできる。コードの読み違いも、ありうるので、「参考。違うと思ったら無視してよい」と添える。
// 何も切れなかった (能力が無い) ときは、空文字 (ヒントを付けない)
const KIND_JA: Record<string, string> = { keyword: "キーワード", activated: "起動型", triggered: "誘発型", spell: "呪文", static: "常在型 (継続)" };
const PLAYER_JA: Record<string, string> = { you: "あなた (コントローラー)", opponent: "相手", target: "対象に取るプレイヤー", each: "各プレイヤー" };

export function hintsFor(oracle: string): string {
  const abilities: Ability[] = splitOracle(oracle);
  if (!abilities.length) return "";
  const title = new Map(allNodes().map((n) => [n.id, n.title]));
  const lines: string[] = [];
  abilities.forEach((a, i) => {
    const head = [`能力 ${i + 1}: ${KIND_JA[a.kind]}`, a.cost ? `コスト「${a.cost}」` : "", a.condition ? `きっかけ「${a.condition}」` : "", a.keywords ? `キーワード: ${a.keywords.join("、")}` : ""].filter(Boolean).join(" / ");
    lines.push(`- ${head}`);
    a.clauses.forEach((c, j) => {
      const parts = [
        c.effects.length ? `動作の候補: ${c.effects.map((e) => `${e} (${title.get(e) ?? e})`).join("、")}` : "動作の候補: 無し (辞書に合わない。自分で、組み合わせを考える)",
        c.numbers.length ? `数: ${c.numbers.join("、")}` : "",
        c.targets.length ? `対象の句: ${c.targets.join("、")}` : "",
        c.players.length ? `プレイヤー: ${c.players.map((p) => PLAYER_JA[p]).join("、")}` : "",
      ].filter(Boolean);
      lines.push(`  - 節 ${j + 1}「${c.text}」 → ${parts.join(" / ")}`);
    });
  });
  return `\n\n## 機械的に切った結果 (参考)\nコードが、テキストを、能力と節に切って、動作の候補・数・対象の句を、取り出したものです。読み違いもありうるので、参考にして、違うと思ったら、無視してください。\n${lines.join("\n")}`;
}
