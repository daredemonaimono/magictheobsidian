import { ItemView, WorkspaceLeaf } from "obsidian";

export const DASHBOARD_VIEW = "mtg-dashboard";

export interface DashboardActions {
  collection: () => void;
  deck: () => void;
  cards: () => void;
  bot: () => void;
}

// ホーム画面。今はテキストのボタンだけ。機能が増えたらここに足していく
export class DashboardView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private actions: DashboardActions) {
    super(leaf);
  }

  getViewType() {
    return DASHBOARD_VIEW;
  }
  getDisplayText() {
    return "Magic the Obsidian";
  }
  getIcon() {
    return "layout-dashboard";
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-dashboard");
    root.createEl("h2", { text: "Magic the Obsidian" });
    const row = root.createDiv("mtg-dash-buttons");
    row.createEl("button", { text: "コレクション" }).onclick = () => this.actions.collection();
    row.createEl("button", { text: "デッキ" }).onclick = () => this.actions.deck();
    row.createEl("button", { text: "カード" }).onclick = () => this.actions.cards();
    row.createEl("button", { text: "Bot (試し)" }).onclick = () => this.actions.bot();
  }
}
