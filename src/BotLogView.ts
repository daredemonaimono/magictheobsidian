import { ItemView, WorkspaceLeaf } from "obsidian";
import { botBus } from "./botbus";
import { cardText } from "./cards";
import { keywordLabel } from "./keywords";
import { Settings } from "./settings";

export const BOTLOG_VIEW = "mtg-botlog";

// 右サイドバー: カーソルを合わせたカードの効果テキストと、対戦ログ
export class BotLogView extends ItemView {
  private cardEl!: HTMLElement;
  private logEl!: HTMLElement;

  getViewType() {
    return BOTLOG_VIEW;
  }
  getDisplayText() {
    return "Bot log";
  }
  getIcon() {
    return "scroll-text";
  }

  constructor(leaf: WorkspaceLeaf, private settings: Settings) {
    super(leaf);
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-botlogview");
    this.cardEl = root.createDiv("mtg-botcard");
    this.logEl = root.createDiv("mtg-botlog");
    botBus.log.forEach((l) => this.logEl.createDiv({ text: l }));
    const onLog = (line: string) => {
      if (!line) this.logEl.empty(); // clear
      else this.logEl.createDiv({ text: line });
      this.logEl.scrollTop = this.logEl.scrollHeight;
    };
    const onHover = () => void this.showCard();
    botBus.onLog.add(onLog);
    botBus.onHover.add(onHover);
    this.register(() => (botBus.onLog.delete(onLog), botBus.onHover.delete(onHover)));
    void this.showCard();
  }

  private async showCard() {
    const c = botBus.hover;
    this.cardEl.empty();
    if (!c) return void this.cardEl.createDiv({ text: "カードにカーソルを合わせると、効果が出る", cls: "mtg-dim" });
    this.cardEl.createEl("h4", { text: `${c.name} ${c.manaCost}` });
    this.cardEl.createDiv({ text: c.typeLine, cls: "mtg-dim" });
    if (c.keywords?.length) this.cardEl.createDiv({ text: c.keywords.map((k) => keywordLabel(k, this.settings.textLang)).join("・"), cls: "mtg-botkw" });
    this.cardEl.createDiv({ text: await cardText(this.app, c.key), cls: "mtg-botcardtext" });
  }
}
