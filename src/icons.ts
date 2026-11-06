import { setIcon } from "obsidian";

// 画像を変える (カバー写真・サムネイル・カードのイラスト) ボタン。どの画面も、同じ画像のアイコンにそろえる (絵文字は使わない)
export function imageButton(parent: HTMLElement, label: string, cls = ""): HTMLButtonElement {
  const b = parent.createEl("button", { cls: `mtg-iconbtn ${cls}`.trim(), attr: { "aria-label": label } });
  setIcon(b, "image");
  return b;
}
