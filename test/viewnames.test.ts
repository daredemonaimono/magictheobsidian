import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";

// Obsidian の View / Component が持つメソッド名を、画面クラスの field や method に使うと、本体の呼び出し (例: leaf が view.open() を呼ぶ) が壊れて、画面が空白になる。
// (0.33.0 の RulebookView が `private open = new Set()` で、空白になった)
const reserved = ["open", "close", "load", "unload", "onload", "onunload", "onOpen", "onClose", "getState", "setState", "getIcon", "getViewType", "getDisplayText", "onResize", "addAction", "addChild", "removeChild", "register", "registerEvent", "registerDomEvent", "registerInterval", "handleDrop", "handleCopy", "handleCut", "handlePaste", "updateNavButtons", "onPaneMenu", "onHeaderMenu", "onTabMenu", "onGroupChange", "onMoreOptions", "navigation", "containerEl", "contentEl", "leaf", "scope", "icon", "app"];
const own = new Set(["getViewType", "getDisplayText", "getIcon", "onOpen", "onClose", "onResize", "getState", "setState", "onPaneMenu"]); // 自分で定義してよい (本体がそれを呼ぶ)
for (const f of readdirSync("src").filter((x) => /View\.ts$/.test(x))) {
  const text = readFileSync(`src/${f}`, "utf8");
  const start = text.search(/^export class \w+ extends (ItemView|View|FileView|TextFileView)\b/m);
  if (start < 0) continue;
  const end = text.indexOf("\n}\n", start); // クラスの終わり (インターフェースなど、ほかの宣言は見ない)
  for (const m of text.slice(start, end < 0 ? undefined : end).matchAll(/^  (?:private |protected |public |readonly |async |static )*([A-Za-z_]\w*)[!?]?\s*(?:[=:(<])/gm)) {
    const name = m[1];
    if (name === "constructor" || own.has(name)) continue;
    assert.ok(!reserved.includes(name), `${f}: メンバー「${name}」は、Obsidian の View / Component の名前と重なる`);
  }
}
console.log("view names ok");
