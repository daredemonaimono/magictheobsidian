// カードのノートのフロントマターの、ローカルネーム (設定した言語のカード名)。name_local と aliases を、いっしょに直す (Obsidian では aliases で、その名前でもリンクできる)。
// 純粋な関数 (obsidian を読み込まない): processFrontMatter に渡すオブジェクトを書き換える

export function normLocalName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

// name_local を name にする。空・英語名と同じなら、ローカルネームを消す。以前のローカルネームは aliases から外し、新しいものを先頭に入れる (ほかの別名は残す)
export function applyLocalName(fm: Record<string, unknown>, name: string): void {
  const n = normLocalName(name);
  const old = typeof fm.name_local === "string" ? fm.name_local : undefined;
  const rest = (Array.isArray(fm.aliases) ? fm.aliases.map(String) : []).filter((a) => a !== old && a !== n);
  if (!n || n === fm.name) {
    delete fm.name_local;
    if (rest.length) fm.aliases = rest;
    else delete fm.aliases;
    return;
  }
  fm.name_local = n;
  fm.aliases = [n, ...rest];
}
