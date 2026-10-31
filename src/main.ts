import { App, Modal, Notice, Plugin, Setting, TFile, normalizePath } from "obsidian";
import { ensureCardFile } from "./cards";
import { DECK_DIR, writeDeck } from "./deck";
import { ImportModal, resolveDeck } from "./import";
import { CARDLIST_VIEW, CardListView } from "./CardListView";
import { COLLECTION_VIEW, CollectionView } from "./CollectionView";
import { DASHBOARD_VIEW, DashboardView } from "./DashboardView";
import { DECKLIST_VIEW, DeckListView } from "./DeckListView";
import { DECK_VIEW, DeckView } from "./DeckView";
import { fetchCard, fileSafe } from "./scryfall";
import { priceStore, updateCollectionPrices } from "./prices";
import { DEFAULT_SETTINGS, Settings, SettingsTab } from "./settings";

// 「動き方」はカード行の外なので、デッキ画面で枚数を変えても書き換わらない
const DECK_TEMPLATE =
  "---\nmtg: deck\nformat: constructed\ntags: [mtg/deck]\n---\n\n## Main\n\n## Side\n\n## 動き方\n\n- 勝ち筋:\n- 序盤:\n- 中盤:\n- 注意点:\n";

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
  private target?: DeckView; // サイドバーの一覧からカードを足す先 (最後に触ったデッキ/コレクション画面)
  private prevCount = 0;
  private opening = false;

  async onload() {
    // data.json: 設定 + 価格キャッシュ (旧版は設定だけのフラットな形)
    const d = (await this.loadData()) ?? {};
    this.settings = {
      textLang: d.textLang ?? DEFAULT_SETTINGS.textLang,
      cardLang: d.cardLang ?? DEFAULT_SETTINGS.cardLang,
      sidebar: d.sidebar ?? DEFAULT_SETTINGS.sidebar,
      listArt: d.listArt ?? DEFAULT_SETTINGS.listArt,
    };
    priceStore.prices = d.prices ?? {};
    priceStore.updated = d.pricesUpdated ?? "";
    const saveAll = () => this.saveData({ ...this.settings, prices: priceStore.prices, pricesUpdated: priceStore.updated });
    priceStore.save = saveAll;
    this.addSettingTab(
      new SettingsTab(this.app, this, this.settings, saveAll, () => {
        for (const l of this.deckLeaves()) (l.view as DeckView).rebuild();
        for (const l of this.app.workspace.getLeavesOfType(CARDLIST_VIEW)) (l.view as CardListView).refresh();
        this.prevCount = 0; // 次の同期で開き直す
        void this.syncSidebar();
      }),
    );
    this.registerView(DECK_VIEW, (leaf) => new DeckView(leaf, this.settings));
    this.registerView(DASHBOARD_VIEW, (leaf) => new DashboardView(leaf, { collection: () => void this.openCollection(), deck: () => void this.openDeckList() }));
    this.registerView(
      DECKLIST_VIEW,
      (leaf) =>
        new DeckListView(leaf, {
          open: (f) => void this.openDeck(f),
          create: () => new NameModal(this.app, "Create deck", "赤単バーン", (n) => void this.createDeck(n)).open(),
          import: () => new ImportModal(this.app, true, (n, t) => void this.importDeck(n, t)).open(),
        }),
    );
    this.registerView(COLLECTION_VIEW, (leaf) => new CollectionView(leaf, this.settings));
    this.registerView(CARDLIST_VIEW, (leaf) => new CardListView(leaf, this.settings, () => this.liveTarget()));

    const ws = this.app.workspace;
    this.registerEvent(
      ws.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof DeckView) {
          this.target = leaf.view;
          this.updateLists();
        }
      }),
    );
    this.registerEvent(ws.on("layout-change", () => void this.syncSidebar()));
    ws.onLayoutReady(() => void this.syncSidebar());

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
    this.addCommand({ id: "open-collection", name: "Open collection", callback: () => void this.openCollection() });
    this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.openDashboard() });
    this.addRibbonIcon("layout-dashboard", "Magic the Obsidian", () => void this.openDashboard());
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

  private async openDashboard() {
    const ws = this.app.workspace;
    const open = ws.getLeavesOfType(DASHBOARD_VIEW)[0];
    if (open) return void ws.revealLeaf(open);
    await ws.getLeaf(true).setViewState({ type: DASHBOARD_VIEW, active: true });
  }

  // 開いていればそのタブへ、無ければ新しいタブで
  private async openCollection() {
    const ws = this.app.workspace;
    const open = ws.getLeavesOfType(COLLECTION_VIEW)[0];
    if (open) return void ws.revealLeaf(open);
    await ws.getLeaf(true).setViewState({ type: COLLECTION_VIEW, active: true });
  }

  private async openDeckList() {
    const ws = this.app.workspace;
    const open = ws.getLeavesOfType(DECKLIST_VIEW)[0];
    if (open) return void ws.revealLeaf(open);
    await ws.getLeaf(true).setViewState({ type: DECKLIST_VIEW, active: true });
  }

  private deckLeaves() {
    const ws = this.app.workspace;
    return [...ws.getLeavesOfType(DECK_VIEW), ...ws.getLeavesOfType(COLLECTION_VIEW)];
  }

  private liveTarget(): DeckView | undefined {
    const leaves = this.deckLeaves();
    if (this.target && leaves.some((l) => l.view === this.target)) return this.target;
    return leaves[0]?.view as DeckView | undefined;
  }

  private updateLists() {
    for (const l of this.app.workspace.getLeavesOfType(CARDLIST_VIEW)) (l.view as CardListView).updateTarget();
  }

  // デッキ/コレクション画面が0→1になったときだけ自動で開く (手で閉じたら、また0になるまで開き直さない)。0になったら閉じる
  private async syncSidebar() {
    const ws = this.app.workspace;
    const count = this.deckLeaves().length;
    const lists = ws.getLeavesOfType(CARDLIST_VIEW);
    if (!this.settings.sidebar || count === 0) {
      lists.forEach((l) => l.detach());
    } else if (this.prevCount === 0 && !lists.length && !this.opening) {
      this.opening = true;
      try {
        const leaf = ws.getRightLeaf(false);
        if (leaf) {
          await leaf.setViewState({ type: CARDLIST_VIEW, active: false });
          await ws.revealLeaf(leaf);
        }
      } finally {
        this.opening = false;
      }
    }
    this.prevCount = count;
    this.updateLists();
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
    // 同じデッキが既に開いていれば、そのタブへ
    const open = this.app.workspace.getLeavesOfType(DECK_VIEW).find((l) => l.getViewState().state?.path === file.path);
    if (open) return void this.app.workspace.revealLeaf(open);
    try {
      await this.app.workspace.getLeaf(true).setViewState({ type: DECK_VIEW, state: { path: file.path }, active: true });
    } catch (e) {
      console.error(e);
      new Notice(`Deck view failed: ${(e as Error).message}`);
    }
  }
}
