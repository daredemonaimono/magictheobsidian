import { ItemView, WorkspaceLeaf } from "obsidian";

export const BATTLE_SIDE_VIEW = "mtg-battle-side";

// 対戦の画面の、右サイドバー: 上にカードのプレビュー (カーソルを合わせたカード・墓地の一覧)、下に対戦のログ。中身は、対戦の画面 (BattleView) が書く。
// 対戦の画面と一緒に出入りする (デッキ画面のカード一覧と同じ)
export class BattleSideView extends ItemView {
  previewEl!: HTMLElement;
  logEl!: HTMLElement;
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }
  getViewType() {
    return BATTLE_SIDE_VIEW;
  }
  getDisplayText() {
    return "対戦";
  }
  getIcon() {
    return "swords";
  }
  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-bt-sideview");
    const side = root.createDiv("mtg-bt-side");
    this.previewEl = side.createDiv("mtg-bt-preview");
    this.logEl = side.createDiv("mtg-bt-log");
  }
}
