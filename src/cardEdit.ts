import { App, Modal, Notice, Setting } from "obsidian";
import { cardInfo, cardText, setLocalName, setLocalText } from "./cards";
import { iconButton } from "./icons";
import { normLocalName } from "./localName";
import { Settings } from "./settings";
import { wikiUrl } from "./wiki";

// カードの、ローカルネーム・ローカルテキストを手で直す画面と、ボタン。デッキ画面のプレビューと、カード一覧が、同じものを使う

export class TextModal extends Modal {
  constructor(app: App, private title: string, private body: string, private onSave: (text: string) => Promise<void>, private hint?: string, private cards?: { key: string; label: string }[]) {
    super(app);
  }
  onOpen() {
    this.setTitle(this.title);
    if (this.hint) this.contentEl.createEl("p", { text: this.hint, cls: "setting-item-description" });
    const area = this.contentEl.createEl("textarea", { cls: "mtg-textedit" });
    area.value = this.body;
    // カードの引用: デッキのカードを選ぶと、カーソルの位置に [[カード名]] を入れる
    if (this.cards?.length) {
      const list = this.contentEl.createEl("datalist", { attr: { id: "mtg-quote-cards" } });
      for (const c of this.cards) list.createEl("option", { attr: { value: c.key, label: c.label } });
      const quote = this.contentEl.createEl("input", { cls: "mtg-quote", attr: { type: "text", list: "mtg-quote-cards", placeholder: "デッキのカードを引用 (名前を入れて選ぶ)" } });
      this.contentEl.insertBefore(quote, area);
      this.contentEl.insertBefore(list, area);
      quote.addEventListener("change", () => {
        if (!this.cards!.some((c) => c.key === quote.value)) return;
        const at = area.selectionStart ?? area.value.length;
        const text = `[[${quote.value}]]`;
        area.value = area.value.slice(0, at) + text + area.value.slice(area.selectionEnd ?? at);
        area.focus();
        area.setSelectionRange(at + text.length, at + text.length);
        quote.value = "";
      });
    }
    new Setting(this.contentEl).addButton((b) =>
      b.setButtonText("保存").setCta().onClick(async () => {
        await this.onSave(area.value);
        this.close();
      }),
    );
  }
  onClose() {
    this.contentEl.empty();
  }
}

// 設定した言語のカード名を直す。saved には、書いたあとの名前 (空・英語名と同じなら undefined) が渡る
export function editLocalName(app: App, settings: Settings, name: string, current: string | undefined, saved: (local: string | undefined) => void) {
  const lang = settings.textLang;
  new TextModal(
    app,
    `${name} のカード名 (${lang})`,
    current && current !== name ? current : "",
    async (t) => {
      await setLocalName(app, name, t);
      const n = normLocalName(t);
      saved(n && n !== name ? n : undefined);
    },
    "設定した言語のカード名。フロントマターの name_local と aliases に書く。空にすると、ローカルネームを消す。",
  ).open();
}

// 設定した言語の効果テキストを直す (英語の本文は変えない)。body = いま出ているテキスト
export function editLocalText(app: App, settings: Settings, name: string, body: string, saved: () => void) {
  const lang = settings.textLang;
  new TextModal(app, `${name} (${lang})`, body, async (t) => {
    await setLocalText(app, name, lang, t);
    saved();
  }).open();
}

// 設定した言語が英語以外で、カードのノートがあるときだけ、直せる
export const canEditLocal = (app: App, settings: Settings, name: string): boolean => settings.textLang !== "en" && !!cardInfo(app, name);

// ローカルネーム・ローカルテキストを直すペンのボタン (2つ)。名前を直したら、新しい名前が、効果テキストを直したら、新しいテキストが渡る
export function localPenButtons(app: App, settings: Settings, parent: HTMLElement, name: string, current: () => string | undefined, done: { name: (local: string | undefined) => void; text: () => void }) {
  if (!canEditLocal(app, settings, name)) return;
  iconButton(parent, "pencil", `カード名 (${settings.textLang}) を編集`).onclick = (e) => {
    e.stopPropagation();
    editLocalName(app, settings, name, current(), done.name);
  };
  iconButton(parent, "file-pen-line", `効果テキスト (${settings.textLang}) を編集`).onclick = async (e) => {
    e.stopPropagation();
    editLocalText(app, settings, name, await cardText(app, name).catch(() => ""), done.text);
  };
}

// MTG Wiki のカードのページを開くボタン。日本語の設定のときだけ付ける (呼び出し側で決める)。ページは API で探す
export function wikiButton(parent: HTMLElement, name: string, ja?: string): HTMLButtonElement {
  const b = iconButton(parent, "book-open", "MTG Wiki のカードのページを開く");
  b.onclick = async (e) => {
    e.stopPropagation();
    b.disabled = true;
    try {
      window.open(await wikiUrl(name, ja));
    } catch (err) {
      console.error(err);
      new Notice(`Wiki を開けない: ${(err as Error).message}`);
    } finally {
      b.disabled = false;
    }
  };
  return b;
}
