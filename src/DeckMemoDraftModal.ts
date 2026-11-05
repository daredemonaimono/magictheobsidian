import { App, Modal, Notice } from "obsidian";
import { AskAi } from "./battle/ai";
import { DRAFT_SYSTEM, deckResult, draftPrompt, matchesOf } from "./battle/memoDraft";
import { SavedBattle } from "./battle/saved";

const RESULT: Record<string, string> = { win: "勝ち", lose: "負け", draw: "引き分け", unfinished: "途中" };
const DEFAULT_PICK = 5; // 最初に印が付く、新しい試合の数

// 「Battle: draft deck memo」: デッキを選び、そのデッキの対戦の履歴 (Battles/) から、AI にメモの下書きを作らせる。下書きは、読んで、直して、「追記」か「置き換え」を押すまで、どこにも書かない
export class DeckMemoDraftModal extends Modal {
  private deck = "";
  private all: SavedBattle[] = [];
  private picked = new Set<number>();
  private seq = 0;

  constructor(
    app: App,
    private decks: string[],
    private loadHistory: () => Promise<SavedBattle[]>, // 新しい順
    private loadMemo: (deck: string) => Promise<string>,
    private ask: AskAi | undefined,
    private save: (deck: string, text: string, mode: "append" | "replace") => Promise<void>,
  ) {
    super(app);
  }

  async onOpen() {
    this.setTitle("デッキのメモの下書き");
    const root = this.contentEl;
    root.createEl("p", { cls: "setting-item-description", text: "選んだデッキの対戦の履歴から、AI がメモの下書きを作ります。下書きは、読んで、直して、「追記」か「置き換え」を押すまで、保存されません。履歴の内容(ログ)が、選んだ AI の会社に送られ、費用が掛かります。" });
    this.all = await this.loadHistory();
    const sel = root.createEl("select");
    sel.style.width = "100%";
    sel.createEl("option", { text: "(デッキを選んでください)", value: "" });
    for (const d of this.decks.filter((d) => matchesOf(d, this.all).length)) sel.createEl("option", { text: `${d} (${matchesOf(d, this.all).length} 試合)`, value: d });
    if (!sel.options[1]) root.createEl("p", { cls: "setting-item-description", text: "対戦の履歴(Battles/)が、まだありません。対戦すると、保存されます。" });
    const list = root.createDiv("mtg-draft-list");
    const info = root.createDiv({ cls: "setting-item-description" });
    const make = root.createEl("button", { cls: "mod-cta", text: "下書きを作る" });
    make.disabled = true;
    const area = root.createEl("textarea", { cls: "mtg-textedit" });
    area.style.display = "none";
    const bar = root.createDiv("mtg-draft-bar");
    bar.style.display = "none";
    const chosen = () => [...this.picked].sort((a, b) => a - b).map((i) => matchesOf(this.deck, this.all)[i]);
    const sync = () => {
      const ms = chosen();
      const chars = draftPrompt(this.deck, "", ms).length;
      info.setText(this.ask ? `${ms.length} 試合を送ります(約 ${chars} 字)。` : "AI のキーが未設定です。設定の「AI の接続」でキーを入れ、「AI の使い分け」で「メモの下書き」の AI を選んでください。");
      make.disabled = !this.ask || !ms.length;
    };
    sel.addEventListener("change", () => {
      this.deck = sel.value;
      list.empty();
      this.picked = new Set();
      area.style.display = bar.style.display = "none";
      if (!this.deck) return sync();
      matchesOf(this.deck, this.all).forEach((b, i) => {
        if (i < DEFAULT_PICK) this.picked.add(i);
        const row = list.createDiv("mtg-draft-row");
        const cb = row.createEl("input", { attr: { type: "checkbox" } });
        cb.checked = this.picked.has(i);
        cb.addEventListener("change", () => (cb.checked ? this.picked.add(i) : this.picked.delete(i), sync()));
        row.createSpan({ text: ` ${b.date.slice(0, 16).replace("T", " ")}  ${b.self} vs ${b.opp}  ${RESULT[deckResult(this.deck, b)]} · ${b.turns} ターン` });
      });
      sync();
    });
    make.addEventListener("click", async () => {
      const seq = ++this.seq;
      make.disabled = true;
      make.setText("作っています…");
      try {
        const memo = await this.loadMemo(this.deck);
        const r = await this.ask!(DRAFT_SYSTEM, draftPrompt(this.deck, memo, chosen()));
        if (seq !== this.seq) return;
        area.value = r.text.trim();
        area.style.display = bar.style.display = "";
      } catch (e) {
        new Notice(`下書きを作れませんでした: ${(e as Error).message}`);
      } finally {
        make.setText("下書きを作る");
        sync();
      }
    });
    const act = (label: string, mode: "append" | "replace", cta = false) =>
      bar.createEl("button", { text: label, ...(cta ? { cls: "mod-cta" } : {}) }).addEventListener("click", async () => {
        const text = area.value.trim();
        if (!text) return;
        await this.save(this.deck, text, mode);
        new Notice(`${this.deck} のメモに${mode === "append" ? "追記" : "保存"}しました`);
        this.close();
      });
    act("メモに追記", "append", true);
    act("メモを置き換える", "replace");
    sync();
  }

  onClose() {
    this.seq++;
    this.contentEl.empty();
  }
}
