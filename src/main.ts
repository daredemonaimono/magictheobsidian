import { App, Modal, Notice, Plugin, Setting, TFile, normalizePath } from "obsidian";
import { ensureCardFile } from "./cards";
import { writeDeck } from "./deck";
import { ImportModal, resolveDeck } from "./import";
import { COLLECTION_VIEW, CollectionView } from "./CollectionView";
import { DECK_VIEW, DeckView } from "./DeckView";
import { fetchCard, fileSafe } from "./scryfall";
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
      callback: () => new ImportModal(this.app, true, (n, t) => void this.importDeck(n, t)).open(),
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

  private async importDeck(name: string, text: string) {
    const path = normalizePath(`${DECK_DIR}/${fileSafe(name)}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) return void new Notice(`Already exists: ${path}`);
    const r = await resolveDeck(this.app, this.settings, text);
    if (!r) return;
    if (!this.app.vault.getAbstractFileByPath(DECK_DIR)) await this.app.vault.createFolder(DECK_DIR);
    await this.openDeck(await this.app.vault.create(path, writeDeck(DECK_TEMPLATE, r.deck)));
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
