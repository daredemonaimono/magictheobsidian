import { App, Modal } from "obsidian";
import { Row, filterRows, initialChecked, overwriteCount, setShown } from "./battle/select";

const LABEL: Record<Row["status"], string> = { none: "ルールなし", ok: "ok", partial: "partial", unbuilt: "unbuilt" };

// 「Battle: build rules with AI」: AI にノードを組み立ててもらうカードにチェックを入れる画面。
// 初期のチェックは、ノードの設定が無いカード。ルールがあるカードにチェックして実行すると上書きになる (直前の内容は退避される)
export class BuildRulesModal extends Modal {
  private checked: Set<string>;
  private query = "";
  private listEl!: HTMLElement;
  private runBtn!: HTMLButtonElement;

  constructor(app: App, private rows: Row[], private onRun: (names: string[]) => void) {
    super(app);
    this.checked = initialChecked(rows);
  }

  onOpen() {
    this.setTitle("AI にノードを組み立ててもらうカード");
    const { contentEl } = this;
    contentEl.createEl("p", { text: "チェックしたカードだけを AI に頼む(API の料金がかかる)。ルールがあるカードは「上書き」になり、元の内容は Rules/_backup/ に残る。", cls: "setting-item-description" });
    const search = contentEl.createEl("input", { type: "text", placeholder: "名前で絞り込み" });
    search.style.width = "100%";
    search.addEventListener("input", () => {
      this.query = search.value;
      this.draw();
    });
    const bar = contentEl.createDiv();
    const button = (text: string, f: () => void) => bar.createEl("button", { text }).addEventListener("click", f);
    button("表示中をチェック", () => this.set(setShown(this.checked, this.rows, this.query, true)));
    button("表示中を外す", () => this.set(setShown(this.checked, this.rows, this.query, false)));
    button("ルールが無いカードだけ", () => this.set(initialChecked(this.rows)));
    this.listEl = contentEl.createDiv();
    this.listEl.style.cssText = "max-height:50vh;overflow-y:auto;margin:8px 0";
    this.runBtn = contentEl.createEl("button", { cls: "mod-cta" });
    this.runBtn.addEventListener("click", () => {
      const names = this.rows.filter((r) => this.checked.has(r.card)).map((r) => r.card);
      this.close();
      this.onRun(names);
    });
    this.draw();
  }

  private set(next: Set<string>) {
    this.checked = next;
    this.draw();
  }

  // 絞り込みで一覧から消えても、チェックは保持する
  private draw() {
    this.listEl.empty();
    for (const r of filterRows(this.rows, this.query)) {
      const label = this.listEl.createEl("label");
      label.style.cssText = "display:flex;gap:8px;align-items:center;padding:2px 0";
      const box = label.createEl("input", { type: "checkbox" });
      box.checked = this.checked.has(r.card);
      box.addEventListener("change", () => {
        if (box.checked) this.checked.add(r.card);
        else this.checked.delete(r.card);
        this.refresh();
      });
      label.createSpan({ text: r.card });
      label.createSpan({ text: r.hasRule ? `${LABEL[r.status]}(上書きされる)` : LABEL[r.status], cls: "setting-item-description" });
    }
    this.refresh();
  }

  private refresh() {
    const over = overwriteCount(this.rows, this.checked);
    this.runBtn.setText(`選んだ ${this.checked.size} 枚で実行${over ? `(うち上書き ${over} 枚)` : ""}`);
    this.runBtn.disabled = this.checked.size === 0;
  }

  onClose() {
    this.contentEl.empty();
  }
}
