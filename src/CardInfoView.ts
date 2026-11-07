import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { cardImage, cardInfo, cardText } from "./cards";
import { CardRule } from "./battle/node";
import { getNode } from "./battle/registry";
import { abilityRoles, roleValue } from "./battle/roles";
import { CardStatus } from "./battle/coverage";
import { setImg } from "./imageCache";
import { manaCost } from "./symbols";

export const CARDINFO_VIEW = "mtg-card-info";

// 画面が呼ぶ、外の処理 (main.ts が渡す)
export interface CardInfoApi {
  rule(key: string): Promise<{ status: CardStatus; rule?: CardRule; hasNote: boolean }>; // Rules/<カード名>.md の状況と、読めたルール
  decks(key: string): Promise<{ file: TFile; name: string; counts: { board: string; n: number }[] }[]>; // このカードを採用しているデッキ
  openDeck(file: TFile): void;
  openCardNote(key: string): void;
  openRuleNote(key: string): void;
  editRule(key: string): void; // ノード設定画面
  buildRule(key: string): void; // AI にルールを作らせる
}

const STATUS_JA: Record<string, string> = { ok: "ok (動いた記録がある)", partial: "partial (一部だけ・記録なし)", unbuilt: "unbuilt (組めていない)", none: "ルールなし" };
const KIND_JA: Record<string, string> = { spell: "呪文能力", activated: "起動型", triggered: "誘発型", static: "常在型", prepare: "準備呪文" };

// 右のサイドバーの「カード情報」: ダッシュボードのカードを押すと、そのカードの、画像・テキスト・ルールの設定・採用しているデッキを出す。ここから、ルールを編集・AI で作る・デッキを開く
export class CardInfoView extends ItemView {
  private key = "";
  private seq = 0;

  constructor(leaf: WorkspaceLeaf, private api: CardInfoApi) {
    super(leaf);
  }

  getViewType() {
    return CARDINFO_VIEW;
  }
  getDisplayText() {
    return this.key ? `Card: ${this.key}` : "Card info";
  }
  getIcon() {
    return "info";
  }

  getState() {
    return { card: this.key };
  }
  async setState(state: { card?: string }) {
    if (state?.card) await this.show(state.card);
    else this.render();
  }

  async onOpen() {
    this.contentEl.addClass("mtg-ci");
    this.render();
  }

  // 表示するカードを切り替える (Cards/ のファイル名)
  async show(key: string) {
    this.key = key;
    (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.(); // 見出し (タブの名前) を更新する
    await this.render();
  }

  private async render() {
    const seq = ++this.seq;
    const root = this.contentEl;
    root.empty();
    if (!this.key) {
      root.createDiv({ cls: "mtg-ci-empty", text: "ダッシュボードの「カード」から、カードを選ぶと、ここに情報が出ます。" });
      return;
    }
    const key = this.key;
    const info = cardInfo(this.app, key);
    const head = root.createDiv("mtg-ci-head");
    const imgWrap = head.createDiv("mtg-ci-img");
    if (info) void cardImage(this.app, info.file).then((u) => seq === this.seq && setImg(imgWrap.createEl("img", { attr: { alt: key } }), u));
    const title = head.createDiv("mtg-ci-title");
    title.createDiv({ text: info?.nameLocal && info.nameLocal !== key ? `${key} (${info.nameLocal})` : key, cls: "mtg-ci-name" });
    if (info) {
      title.createDiv({ text: info.typeLine, cls: "mtg-dim" });
      if (info.manaCost) manaCost(title, info.manaCost);
    }
    const btns = root.createDiv("mtg-ci-btns");
    btns.createEl("button", { text: "カードのノートを開く" }).onclick = () => this.api.openCardNote(key);
    const text = root.createDiv({ cls: "mtg-ci-text" });
    void cardText(this.app, key).then((t) => seq === this.seq && text.setText(t));

    // ルールの設定
    root.createEl("h4", { text: "ルールの設定" });
    const ruleBox = root.createDiv("mtg-ci-rule");
    const decksBox = (root.createEl("h4", { text: "採用しているデッキ" }), root.createDiv("mtg-ci-decks"));
    const [r, decks] = await Promise.all([this.api.rule(key), this.api.decks(key)]);
    if (seq !== this.seq) return;
    const st = r.hasNote ? r.status.status : "none";
    ruleBox.createDiv({ text: STATUS_JA[st], cls: `mtg-ci-status is-${st}` });
    if (r.status.reasons.length && st !== "ok") for (const reason of r.status.reasons.slice(0, 6)) ruleBox.createDiv({ text: `・${reason}`, cls: "mtg-dim" });
    if (r.rule) {
      const roles = [...new Set(r.rule.abilities.flatMap((a) => abilityRoles(a)))];
      if (roles.length) ruleBox.createDiv({ text: `役割: ${roles.join("・")} (重み ${roleValue(roles) >= 0 ? "+" : ""}${roleValue(roles)})`, cls: "mtg-ci-roles" });
      for (const ab of r.rule.abilities) {
        const line = ab.body.map((c) => getNode(c.node)?.title ?? c.node).join(" → ");
        ruleBox.createDiv({ cls: "mtg-ci-ability" }).setText(`${KIND_JA[ab.kind] ?? ab.kind}: ${line || "(空)"}`);
      }
      for (const u of r.rule.unsupported ?? []) ruleBox.createDiv({ text: `未対応: ${u}`, cls: "mtg-ci-unsupported" });
    }
    const rb = ruleBox.createDiv("mtg-ci-btns");
    rb.createEl("button", { text: "ノードを編集" }).onclick = () => this.api.editRule(key);
    rb.createEl("button", { text: r.hasNote ? "AI で作り直す" : "AI でルールを作る" }).onclick = () => this.api.buildRule(key);
    if (r.hasNote) rb.createEl("button", { text: "ルールのノートを開く" }).onclick = () => this.api.openRuleNote(key);

    // 採用しているデッキ
    if (!decks.length) decksBox.createDiv({ text: "どのデッキにも入っていません", cls: "mtg-dim" });
    for (const d of decks) {
      const row = decksBox.createDiv("mtg-ci-deckrow");
      row.createSpan({ text: d.name, cls: "mtg-ci-deckname" });
      row.createSpan({ text: d.counts.map((c) => `${c.board} ×${c.n}`).join(" / "), cls: "mtg-dim" });
      row.onclick = () => this.api.openDeck(d.file);
    }
  }
}
