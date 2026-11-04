import { App, Modal } from "obsidian";
import { DeckChoice, buildMatch, opponentChoices, unruledCards } from "./battle/deckToGame";
import { loadMatchInputs } from "./battleStart";

const RANDOM = "__random__";

// 「Battle: start battle」: 自分のデッキと、相手のデッキ (同じフォーマットで使えるものから、選ぶ / ランダム) を選んで、対戦を始める。
// ルールが設定されていないカードは、始める前に一覧で見せる (そのまま始められる。使うと「スキップします」とログに出る)
export class BattleStartModal extends Modal {
  private mine = "";
  private opp = RANDOM;
  private rolled = ""; // 「ランダム」で決まった相手のデッキ
  private listEl!: HTMLElement;
  private noteEl!: HTMLElement;
  private oppSel!: HTMLSelectElement;
  private startBtn!: HTMLButtonElement;
  private seq = 0;

  constructor(app: App, private decks: DeckChoice[], private onStart: (self: string, opp: string) => void) {
    super(app);
  }

  onOpen() {
    this.setTitle("対戦を始める");
    const { contentEl } = this;
    contentEl.createEl("p", { text: "自分のデッキを選ぶと、同じフォーマットで使えるデッキから、相手を選べる(ランダムも選べる)。統率戦のデッキは、まだ対戦に使えない。", cls: "setting-item-description" });

    contentEl.createEl("div", { text: "自分のデッキ", cls: "setting-item-name" });
    const mineSel = contentEl.createEl("select");
    mineSel.style.width = "100%";
    mineSel.createEl("option", { text: "(選んでください)", value: "" });
    for (const d of this.decks) {
      const o = mineSel.createEl("option", { text: d.commander ? `${d.name}(統率戦: 対戦に使えない)` : `${d.name}${d.format ? ` · ${d.format}` : ""}`, value: d.name });
      if (d.commander) o.disabled = true;
    }
    mineSel.addEventListener("change", () => {
      this.mine = mineSel.value;
      this.fillOpp();
    });

    contentEl.createEl("div", { text: "相手のデッキ", cls: "setting-item-name" }).style.marginTop = "8px";
    this.oppSel = contentEl.createEl("select");
    this.oppSel.style.width = "100%";
    this.oppSel.addEventListener("change", () => {
      this.opp = this.oppSel.value;
      if (this.opp === RANDOM) this.roll();
      void this.refresh();
    });

    this.listEl = contentEl.createDiv();
    this.listEl.style.cssText = "max-height:30vh;overflow-y:auto;margin:8px 0";
    this.noteEl = contentEl.createDiv({ cls: "setting-item-description" });
    this.startBtn = contentEl.createEl("button", { text: "対戦を始める", cls: "mod-cta" });
    this.startBtn.addEventListener("click", () => {
      const opp = this.opp === RANDOM ? this.rolled : this.opp;
      this.close();
      this.onStart(this.mine, opp);
    });
    this.fillOpp();
  }

  private candidates(): DeckChoice[] {
    return opponentChoices(this.decks.find((d) => d.name === this.mine), this.decks);
  }

  // 自分のデッキが変わったら、相手の候補を作り直す。「ランダム」を引き直す
  private fillOpp() {
    const list = this.candidates();
    this.oppSel.empty();
    this.oppSel.createEl("option", { text: "ランダム", value: RANDOM });
    for (const d of list) this.oppSel.createEl("option", { text: d.name, value: d.name });
    this.opp = RANDOM;
    this.oppSel.value = RANDOM;
    this.roll();
    void this.refresh();
  }

  private roll() {
    const list = this.candidates();
    this.rolled = list.length ? list[Math.floor(Math.random() * list.length)].name : "";
  }

  // 決まったデッキの組で、ルールが設定されていないカードの一覧を出す
  private async refresh() {
    const seq = ++this.seq;
    const opp = this.opp === RANDOM ? this.rolled : this.opp;
    this.listEl.empty();
    this.startBtn.disabled = true;
    if (!this.mine) return void this.noteEl.setText("自分のデッキを選んでください");
    if (!opp) return void this.noteEl.setText("相手にできるデッキがありません(同じフォーマットで使えるデッキが無い。判定が未取得のデッキは、デッキ画面の「情報取得」で判定できる)");
    this.noteEl.setText(this.opp === RANDOM ? `相手(ランダム): ${opp}` : `相手: ${opp}`);
    try {
      const { self, opp: o, rules } = await loadMatchInputs(this.app, this.mine, opp);
      if (seq !== this.seq) return;
      buildMatch(self, o, rules); // 始められるか確かめる (7 枚に足りない・統率戦は、ここで MatchError)
      const missing = unruledCards([self, o], rules);
      this.listEl.createEl("div", { text: missing.length ? `ルールが設定されていないカード (${missing.length} 種。使うと「スキップします」とログに出る)` : "すべてのカードにルールがあります", cls: "setting-item-description" });
      for (const n of missing) this.listEl.createDiv({ text: n });
      this.startBtn.disabled = false;
    } catch (e) {
      if (seq !== this.seq) return;
      this.noteEl.setText(`始められません: ${(e as Error).message}`);
    }
  }
}
