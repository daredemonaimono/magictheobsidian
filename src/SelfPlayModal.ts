import { App, Modal, Notice } from "obsidian";
import { DeckChoice } from "./battle/deckToGame";
import { reportMarkdown, runSelfPlay } from "./battle/selfplay";
import { loadMatchInputs } from "./battleStart";

// 「Battle: self-play debug」: 2 つのデッキを選んで、CPU 同士で、何試合か自動で対戦させる。画面も API も使わない。
// 不具合の候補 (例外・判定と実行の食い違い・カードの増減・止まる) と、一度も動かなかったカードを、ノートに書く
export class SelfPlayModal extends Modal {
  private a = "";
  private b = "";
  private games = 50;
  private busy = false;

  constructor(app: App, private decks: DeckChoice[], private write: (md: string) => Promise<void>) {
    super(app);
  }

  onOpen() {
    this.setTitle("CPU 同士の自動対戦 (デバッグ)");
    const { contentEl } = this;
    contentEl.createEl("p", { text: "選んだ 2 つのデッキで、CPU が、使える行動を乱数で選んで、何試合も自動で対戦します (API は使わない)。強さの比較ではなく、いろいろなカードを動かして、不具合を見つけるための機能です。結果は、Rules/_自動対戦レポート.md に書きます。", cls: "setting-item-description" });
    const pick = (label: string, set: (v: string) => void) => {
      contentEl.createEl("div", { text: label, cls: "setting-item-name" });
      const sel = contentEl.createEl("select");
      sel.style.width = "100%";
      sel.createEl("option", { text: "(選んでください)", value: "" });
      for (const d of this.decks) {
        const o = sel.createEl("option", { text: d.commander ? `${d.name}(統率戦: 使えない)` : d.name, value: d.name });
        if (d.commander) o.disabled = true;
      }
      sel.addEventListener("change", () => set(sel.value));
    };
    pick("デッキ A", (v) => (this.a = v));
    pick("デッキ B (同じデッキでもよい)", (v) => (this.b = v));
    contentEl.createEl("div", { text: "試合数", cls: "setting-item-name" }).style.marginTop = "8px";
    const n = contentEl.createEl("input", { type: "number", value: String(this.games) });
    n.min = "1";
    n.max = "1000";
    n.addEventListener("input", () => (this.games = Math.max(1, Math.min(1000, Number(n.value) || 50))));
    const status = contentEl.createDiv({ cls: "setting-item-description" });
    status.style.margin = "8px 0";
    const run = contentEl.createEl("button", { text: "自動対戦を始める", cls: "mod-cta" });
    run.addEventListener("click", async () => {
      if (this.busy) return;
      if (!this.a || !this.b) return void new Notice("デッキを 2 つ選んでください");
      this.busy = true;
      run.disabled = true;
      try {
        const { self, opp, rules } = await loadMatchInputs(this.app, this.a, this.b);
        const r = await runSelfPlay([{ name: this.a, data: self }, { name: this.a === this.b ? `${this.b} (2)` : this.b, data: opp }], rules, { games: this.games, seed: Math.floor(Date.now() / 1000) % 100000 }, (d, t) => status.setText(`${d} / ${t} 試合 …`));
        await this.write(reportMarkdown(r, [this.a, this.b]));
        new Notice(`自動対戦が終わりました: 不具合の候補 ${r.issues.length} 種類`);
        this.close();
      } catch (e) {
        status.setText(`失敗: ${(e as Error).message}`);
        this.busy = false;
        run.disabled = false;
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
