import { SavedBattle } from "./saved";

// デッキのメモの下書き (履歴から、AI に作らせる)。この中は、API を呼ばない (純粋な関数)。呼ぶのは画面 (DeckMemoDraftModal)。下書きは、人が読んで、直して、採用するまで、どこにも書かない
const RESULT_JA: Record<SavedBattle["result"], string> = { win: "勝ち", lose: "負け", draw: "引き分け", unfinished: "途中でやめた" };
const NOISE = /(のトークン: 入力|をタップしてマナを出した)/; // 下書きの材料にならない行

// この試合の、そのデッキから見た勝敗 (デッキが、相手側 = AI が使った側なら、人の勝敗の逆)
export function deckResult(deck: string, b: SavedBattle): SavedBattle["result"] {
  if (b.self === deck || b.opp !== deck) return b.result;
  return b.result === "win" ? "lose" : b.result === "lose" ? "win" : b.result;
}

// そのデッキが出てくる試合 (新しい順にしてあるものを、そのまま)
export const matchesOf = (deck: string, all: SavedBattle[]): SavedBattle[] => all.filter((b) => b.self === deck || b.opp === deck);

// ログの要点: ノイズの行を除いて、長ければ、最初の 40 行と、最後の 110 行
export function condenseLog(log: string[], max = 150): string[] {
  const kept = log.filter((l) => !NOISE.test(l));
  return kept.length <= max ? kept : [...kept.slice(0, 40), `… (${kept.length - max} 行を省略) …`, ...kept.slice(kept.length - (max - 40))];
}

export const DRAFT_SYSTEM = `あなたは、マジック:ザ・ギャザリングの対戦の記録を読んで、そのデッキの「動かし方のメモ」の下書きを作る助手です。
- 記録に根拠のあることだけを書きます。記録に無いことは、書きません (推測は、「〜かもしれない」と、はっきり分けて、少なく)。
- 日本語で、「〜のときは、〜する」の、短い文の箇条書きにします。項目は、必要なものだけ: マリガンの基準 / 序盤・中盤の立ち回り / コンボ・カードの使いどころ / 気をつけること。
- 全体で、800 字くらいまで。今のメモがあれば、矛盾させず、足りないところ・直すところを反映した、全体の下書きにします。
- 返事は、メモの本文だけ (前置きや説明は、書かない)。`;

// 下書きを頼む文章。b = 選んだ試合 (新しい順)。notes (AI の理由) は、そのデッキを AI が使った試合だけ
export function draftPrompt(deck: string, currentMemo: string, matches: SavedBattle[]): string {
  const parts = [`デッキ: ${deck}`, currentMemo.trim() ? `今のメモ:\n${currentMemo.trim()}` : "今のメモ: (まだ無い)"];
  matches.forEach((b, i) => {
    const byAi = b.opp === deck && b.mode !== "passive";
    parts.push(
      [
        `--- 試合 ${i + 1}: ${deck} は ${RESULT_JA[deckResult(deck, b)]} (${b.turns} ターン)。相手のデッキ: ${b.self === deck ? b.opp : b.self}。${deck} を使った側: ${b.self === deck ? "人" : b.mode === "claude" ? "AI" : "雑魚 CPU"}`,
        ...(byAi && b.notes?.length ? [`AI が返した理由 (抜粋): ${b.notes.slice(0, 15).map((n) => n.why).join(" / ")}`] : []),
        "ログ:",
        ...condenseLog(b.log),
      ].join("\n"),
    );
  });
  return parts.join("\n\n");
}
