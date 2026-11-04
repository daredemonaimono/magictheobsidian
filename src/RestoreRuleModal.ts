import { App, Modal, TFile } from "obsidian";
import { KIND_LABEL, Kind } from "./battle/history";

export interface Version {
  file: TFile;
  stamp: string; // 2026-11-05-153012
  kind: Kind;
}

// 「Battle: restore rule version」: ルールの履歴 (新しい順) から、戻す版を選ぶ。戻す前の内容も履歴に入るので、戻したことも取り消せる
export class RestoreRuleModal extends Modal {
  constructor(app: App, private card: string, private versions: Version[], private onRestore: (file: TFile) => void, private onView: (file: TFile) => void) {
    super(app);
  }

  onOpen() {
    this.setTitle(`${this.card} のルールの履歴`);
    this.contentEl.createEl("p", { text: "書き換わる前の内容が、新しい順に並ぶ。「戻す」を押すと、いまの内容を履歴に残してから、その版に置き換える。", cls: "setting-item-description" });
    const list = this.contentEl.createDiv();
    list.style.cssText = "max-height:50vh;overflow-y:auto";
    for (const v of this.versions) {
      const row = list.createDiv();
      row.style.cssText = "display:flex;gap:8px;align-items:center;padding:4px 0";
      const [y, mo, d, hms] = [v.stamp.slice(0, 4), v.stamp.slice(5, 7), v.stamp.slice(8, 10), v.stamp.slice(11)];
      row.createSpan({ text: `${y}-${mo}-${d} ${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}` });
      row.createSpan({ text: KIND_LABEL[v.kind], cls: "setting-item-description" }).style.flex = "1";
      row.createEl("button", { text: "開く" }).addEventListener("click", () => this.onView(v.file));
      row.createEl("button", { text: "戻す", cls: "mod-warning" }).addEventListener("click", () => {
        this.close();
        this.onRestore(v.file);
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
