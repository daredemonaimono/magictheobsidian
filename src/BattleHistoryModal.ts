import { App, Modal, TFile } from "obsidian";

export const BATTLE_DIR = "Battles";
const RESULT: Record<string, string> = { win: "勝ち", lose: "負け", draw: "引き分け", unfinished: "途中" };
const MODE: Record<string, string> = { cpu: "雑魚 CPU", claude: "Claude", passive: "何もしない" };

// 「Battle: replay」: 保存した対戦 (Battles/) の一覧から選んで、「再生」で、対戦の画面でリプレイを開く
export class BattleHistoryModal extends Modal {
  private picked?: TFile;
  constructor(app: App, private onPlay: (file: TFile) => void) {
    super(app);
  }
  onOpen() {
    this.setTitle("対戦のリプレイ");
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(`${BATTLE_DIR}/`) && this.app.metadataCache.getFileCache(f)?.frontmatter?.mtg === "battle")
      .sort((a, b) => b.basename.localeCompare(a.basename)); // 日時が名前の先頭: 新しい順
    if (!files.length) return void this.contentEl.createEl("p", { text: "保存された対戦がありません (対戦が終わると、Battles/ に保存されます)。", cls: "setting-item-description" });
    const list = this.contentEl.createDiv("mtg-bt-histlist");
    const play = this.contentEl.createEl("button", { cls: "mod-cta", text: "再生" });
    play.disabled = true;
    play.addEventListener("click", () => {
      if (!this.picked) return;
      this.close();
      this.onPlay(this.picked);
    });
    const rows = new Map<TFile, HTMLElement>();
    for (const f of files) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
      const row = list.createDiv({ cls: "mtg-bt-histrow" });
      rows.set(f, row);
      row.createSpan({ cls: "mtg-bt-histdate", text: String(fm.date ?? "").slice(0, 16).replace("T", " ") });
      row.createSpan({ text: ` ${fm.self ?? "?"} vs ${fm.opp ?? "?"}  ` });
      row.createSpan({ cls: `mtg-bt-histres is-${fm.result}`, text: `${RESULT[String(fm.result)] ?? "?"} · ${fm.turns ?? "?"} ターン · ${MODE[String(fm.mode)] ?? ""}${fm.tokens_in !== undefined ? ` · ${Number(fm.tokens_in) + Number(fm.tokens_out ?? 0)} トークン` : ""}` });
      row.addEventListener("click", () => {
        this.picked = f;
        for (const [g, el] of rows) el.toggleClass("is-picked", g === f);
        play.disabled = false;
      });
      row.addEventListener("dblclick", () => {
        this.picked = f;
        play.click();
      });
    }
  }
  onClose() {
    this.contentEl.empty();
  }
}
