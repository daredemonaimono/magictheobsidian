import { setIcon } from "obsidian";

// アイコンのボタン。絵文字は使わず、Obsidian の枠線のアイコン (lucide) にそろえる
export function iconButton(parent: HTMLElement, icon: string, label: string, cls = ""): HTMLButtonElement {
  const b = parent.createEl("button", { cls: `mtg-iconbtn ${cls}`.trim(), attr: { "aria-label": label } });
  setIcon(b, icon);
  return b;
}

// 画像を変える (カバー写真・サムネイル・カードのイラスト) ボタン。どの画面も、同じ画像のアイコンにそろえる (絵文字は使わない)
export function imageButton(parent: HTMLElement, label: string, cls = ""): HTMLButtonElement {
  return iconButton(parent, "image", label, cls);
}

// foil の印 (✨ の絵文字のかわり)。文字のあとに、小さなアイコンを足す
export function foilMark(parent: HTMLElement): void {
  setIcon(parent.createSpan({ cls: "mtg-foilmark", attr: { "aria-label": "foil" } }), "sparkles");
}
