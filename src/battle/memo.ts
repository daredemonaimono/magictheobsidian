// デッキのメモ (AI の相手が、そのデッキを使うときに読む)。デッキのノートの `## メモ` の見出しの下に、自由に書く (昔の `## 動き方` は、読まない)。純粋な関数
export const MEMO_HEADING = "## メモ";

// 見出し (## 〜) から、次の見出し (# で始まる行) の手前までの、本文
function section(content: string, heading: string): string | undefined {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === heading);
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("#")) end++;
  return lines.slice(start + 1, end).join("\n");
}

// 項目の名前だけで、中身が空の行 ("- 勝ち筋:" などの、雛形の名残) は、読まない
const EMPTY_ITEM = /^\s*[-*]\s*[^:：\n]{1,20}[:：]\s*$/;

// AI に渡すメモ: `## メモ` の本文。無ければ、空の文字列
export function extractMemo(content: string): string {
  return (section(content, MEMO_HEADING) ?? "").split("\n").filter((l) => !EMPTY_ITEM.test(l)).join("\n").trim();
}

// 編集の画面に出す、`## メモ` の本文 (無ければ空)
export const editableMemo = (content: string): string => (section(content, MEMO_HEADING) ?? "").trim();

// `## メモ` の本文を、text にする (見出しが無ければ、最後に作る)。ほかの部分は、触らない
export function setMemo(content: string, text: string): string {
  const body = text.trim();
  const lines = content.split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === MEMO_HEADING);
  if (start < 0) {
    if (!body) return content;
    const tail = content.endsWith("\n") ? "" : "\n";
    return `${content}${tail}\n${MEMO_HEADING}\n\n${body}\n`;
  }
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("#")) end++;
  lines.splice(start + 1, end - start - 1, "", ...(body ? [body, ""] : [""]));
  return lines.join("\n");
}
