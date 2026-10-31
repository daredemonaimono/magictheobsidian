import { App, Modal, Notice, Plugin, Setting, TFile, normalizePath } from "obsidian";
import { CARD_DIR, ensureCardFile } from "./cards";
import { Deck, parseMoxfield, writeDeck } from "./deck";
import { COLLECTION_VIEW, CollectionView } from "./CollectionView";
import { DECK_VIEW, DeckView } from "./DeckView";
import { fetchCard, fetchPrint, fileSafe } from "./scryfall";
import { priceStore, updateCollectionPrices } from "./prices";
import { DEFAULT_SETTINGS, Settings, SettingsTab } from "./settings";

const DECK_DIR = "Decks";
// 「動き方」はカード行の外なので、デッキ画面で枚数を変えても書き換わらない
const DECK_TEMPLATE =
  "---\nmtg: deck\ntags: [mtg/deck]\n---\n\n## Main\n\n## Side\n\n## 動き方\n\n- 勝ち筋:\n- 序盤:\n- 中盤:\n- 注意点:\n";

class NameModal extends Modal {
  private value = "";
  constructor(app: App, private title: string, private placeholder: string, private onSubmit: (v: string) => void) {
    super(app);
  }
  onOpen() {
    const submit = () => {
      if (!this.value.trim()) return;
      this.close();
      this.onSubmit(this.value.trim());
    };
    this.setTitle(this.title);
    new Setting(this.contentEl).setName("Name").addText((t) => {
      t.setPlaceholder(this.placeholder).onChange((v) => (this.value = v));
      t.inputEl.addEventListener("keydown", (e) => e.key === "Enter" && !e.isComposing && submit());
      t.inputEl.focus();
    });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("OK").setCta().onClick(submit));
  }
  onClose() {
    this.contentEl.empty();
  }
}

class ImportModal extends Modal {
  private name = "";
  private text = "";
  constructor(app: App, private onSubmit: (name: string, text: string) => void) {
    super(app);
  }
  onOpen() {
    this.setTitle("Import deck (Moxfield text)");
    new Setting(this.contentEl).setName("Deck name").addText((t) => t.setPlaceholder("リアニ").onChange((v) => (this.name = v)));
    const area = this.contentEl.createEl("textarea", { attr: { rows: "14", placeholder: "4 Lightning Bolt (M11) 149\n...\n\nSIDEBOARD:\n3 Smash to Smithereens (ROE) 160" } });
    area.style.width = "100%";
    area.addEventListener("input", () => (this.text = area.value));
    new Setting(this.contentEl).addButton((b) =>
      b.setButtonText("Import").setCta().onClick(() => {
        if (!this.name.trim() || !this.text.trim()) return new Notice("デッキ名とリストを入れる");
        this.close();
        this.onSubmit(this.name.trim(), this.text);
      }),
    );
  }
  onClose() {
    this.contentEl.empty();
  }
}

export default class MagicTheObsidian extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };

  async onload() {
    // data.json: 設定 + 価格キャッシュ (旧版は設定だけのフラットな形)
    const d = (await this.loadData()) ?? {};
    this.settings = { textLang: d.textLang ?? DEFAULT_SETTINGS.textLang, cardLang: d.cardLang ?? DEFAULT_SETTINGS.cardLang };
    priceStore.prices = d.prices ?? {};
    priceStore.updated = d.pricesUpdated ?? "";
    const saveAll = () => this.saveData({ ...this.settings, prices: priceStore.prices, pricesUpdated: priceStore.updated });
    priceStore.save = saveAll;
    this.addSettingTab(new SettingsTab(this.app, this, this.settings, saveAll));
    this.registerView(DECK_VIEW, (leaf) => new DeckView(leaf, this.settings));
    this.registerView(COLLECTION_VIEW, (leaf) => new CollectionView(leaf, this.settings));

    this.addCommand({
      id: "fetch-card",
      name: "Fetch card from Scryfall",
      callback: () => new NameModal(this.app, "Fetch card from Scryfall", "Lightning Bolt", (n) => this.fetchCardNote(n)).open(),
    });
    this.addCommand({
      id: "create-deck",
      name: "Create deck",
      callback: () => new NameModal(this.app, "Create deck", "赤単バーン", (n) => this.createDeck(n)).open(),
    });
    this.addCommand({
      id: "import-deck",
      name: "Import deck (Moxfield text)",
      callback: () => new ImportModal(this.app, (n, t) => void this.importDeck(n, t)).open(),
    });
    this.addCommand({
      id: "open-collection",
      name: "Open collection",
      callback: () => void this.app.workspace.getLeaf(true).setViewState({ type: COLLECTION_VIEW, active: true }),
    });
    this.addCommand({
      id: "update-prices",
      name: "Update collection prices",
      callback: async () => {
        new Notice("価格を更新中…");
        try {
          new Notice(`価格を更新: ${await updateCollectionPrices(this.app)} 件`);
        } catch (e) {
          new Notice(`価格の更新失敗: ${(e as Error).message}`);
        }
      },
    });
    this.addCommand({
      id: "open-deck-view",
      name: "Open current deck in deck view",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const isDeck = file && this.app.metadataCache.getFileCache(file)?.frontmatter?.mtg === "deck";
        if (isDeck && !checking) void this.openDeck(file);
        return !!isDeck;
      },
    });
  }

  private async fetchCardNote(query: string) {
    try {
      const file = await ensureCardFile(this.app, await fetchCard(query), this.settings);
      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (e) {
      new Notice(`Card fetch failed: ${(e as Error).message}`);
    }
  }

  private async createDeck(name: string) {
    const path = normalizePath(`${DECK_DIR}/${fileSafe(name)}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) return new Notice(`Already exists: ${path}`);
    if (!this.app.vault.getAbstractFileByPath(DECK_DIR)) await this.app.vault.createFolder(DECK_DIR);
    await this.openDeck(await this.app.vault.create(path, DECK_TEMPLATE));
  }

  // カードは (セット, 番号) で版まで指定して取得し、Cards/ に無いものだけノート化する
  private async importDeck(name: string, text: string) {
    const path = normalizePath(`${DECK_DIR}/${fileSafe(name)}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) return void new Notice(`Already exists: ${path}`);
    const parsed = parseMoxfield(text);
    const total = parsed.main.size + parsed.side.size;
    if (!total) return void new Notice("読み取れる行が無い (例: 4 Lightning Bolt (M11) 149)");

    const keys = new Map<string, string>(); // 行のカード名 -> Cards/ のファイル名
    const failed: string[] = [];
    let done = 0;
    const notice = new Notice(`取り込み中… 0/${total}`, 0);
    for (const [cardName, e] of [...parsed.main, ...parsed.side]) {
      if (keys.has(cardName)) continue;
      try {
        const existing = this.app.vault.getAbstractFileByPath(normalizePath(`${CARD_DIR}/${fileSafe(cardName)}.md`));
        if (existing instanceof TFile) {
          keys.set(cardName, existing.basename);
        } else {
          const [set, no] = e.print!.split(" ");
          keys.set(cardName, (await ensureCardFile(this.app, await fetchPrint(set, no), this.settings)).basename);
          await new Promise((r) => setTimeout(r, 100)); // Scryfall の負荷配慮
        }
      } catch {
        failed.push(cardName);
      }
      notice.setMessage(`取り込み中… ${++done}/${total}`);
    }
    notice.hide();

    const deck: Deck = { main: new Map(), side: new Map() };
    for (const board of ["main", "side"] as const) {
      for (const [cardName, e] of parsed[board]) {
        const key = keys.get(cardName);
        if (key) deck[board].set(key, e);
      }
    }
    if (!this.app.vault.getAbstractFileByPath(DECK_DIR)) await this.app.vault.createFolder(DECK_DIR);
    await this.openDeck(await this.app.vault.create(path, writeDeck(DECK_TEMPLATE, deck)));
    new Notice(failed.length ? `取り込み完了。取得できなかった ${failed.length} 枚: ${failed.join(", ")}` : `取り込み完了: ${total} 種類`, failed.length ? 0 : 4000);
  }

  private async openDeck(file: TFile) {
    try {
      await this.app.workspace.getLeaf(true).setViewState({ type: DECK_VIEW, state: { path: file.path }, active: true });
    } catch (e) {
      console.error(e);
      new Notice(`Deck view failed: ${(e as Error).message}`);
    }
  }
}
