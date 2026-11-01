import { App, Modal, Notice, Plugin, Setting, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { ensureCardFile, localCards, updateLegality } from "./cards";
import { DECK_DIR, foldCommander, writeDeck } from "./deck";
import { CREATABLE, FORMATS } from "./rules";
import { ImportModal, resolveDeck } from "./import";
import { CARDLIST_VIEW, CardListView } from "./CardListView";
import { COLLECTION_VIEW, CollectionView } from "./CollectionView";
import { CARDS_VIEW, CardsView } from "./CardsView";
import { DASHBOARD_VIEW, DashboardView } from "./DashboardView";
import { DECKLIST_VIEW, DeckListView } from "./DeckListView";
import { DECK_VIEW, DeckView } from "./DeckView";
import { fetchCard, fileSafe } from "./scryfall";
import { priceStore, updateCollectionPrices } from "./prices";
import { DEFAULT_SETTINGS, Settings, SettingsTab } from "./settings";

// 「動き方」はカード行の外なので、デッキ画面で枚数を変えても書き換わらない。統率戦だけコマンダー欄があり、サイドは無い
const deckTemplate = (format: string) =>
  `---\nmtg: deck\nformat: ${format}\ntags: [mtg/deck]\n---\n\n${format === "commander" ? "## Commander\n\n## Main\n" : "## Main\n\n## Side\n"}\n## 動き方\n\n- 勝ち筋:\n- 序盤:\n- 中盤:\n- 注意点:\n`;

class NameModal extends Modal {
  private value = "";
  private format = CREATABLE[0];
  // askFormat: 新しいデッキを作るときはフォーマットも選ぶ
  constructor(app: App, private title: string, private placeholder: string, private onSubmit: (v: string, format: string) => void, private askFormat = false) {
    super(app);
  }
  onOpen() {
    const submit = () => {
      if (!this.value.trim()) return;
      this.close();
      this.onSubmit(this.value.trim(), this.format);
    };
    this.setTitle(this.title);
    new Setting(this.contentEl).setName("Name").addText((t) => {
      t.setPlaceholder(this.placeholder).onChange((v) => (this.value = v));
      t.inputEl.addEventListener("keydown", (e) => e.key === "Enter" && !e.isComposing && submit());
      t.inputEl.focus();
    });
    if (this.askFormat) {
      new Setting(this.contentEl)
        .setName("Format")
        .setDesc("使えないカード(禁止など)は選べなくなる。統率戦は100枚・同名1種・コマンダー1体")
        .addDropdown((d) => d.addOptions(Object.fromEntries(CREATABLE.map((id) => [id, FORMATS[id].name]))).setValue(this.format).onChange((v) => (this.format = v)));
    }
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
  private closedByTab = false;
  private opening = false;

  async onload() {
    // data.json: 設定 + 価格キャッシュ (フラットな1つのオブジェクト)
    const d = (await this.loadData()) ?? {};
    this.settings = {
      textLang: d.textLang ?? DEFAULT_SETTINGS.textLang,
      cardLang: d.cardLang ?? DEFAULT_SETTINGS.cardLang,
      sidebar: d.sidebar ?? DEFAULT_SETTINGS.sidebar,
      listArt: d.listArt ?? DEFAULT_SETTINGS.listArt,
      dashboardTab: d.dashboardTab ?? DEFAULT_SETTINGS.dashboardTab,
    };
    priceStore.prices = d.prices ?? {};
    priceStore.updated = d.pricesUpdated ?? "";
    const saveAll = () => this.saveData({ ...this.settings, prices: priceStore.prices, pricesUpdated: priceStore.updated });
    priceStore.save = saveAll;
    this.addSettingTab(
      new SettingsTab(this.app, this, this.settings, saveAll, () => {
        for (const l of this.deckLeaves()) if (l.view instanceof DeckView) l.view.rebuild();
        for (const l of this.app.workspace.getLeavesOfType(CARDLIST_VIEW)) if (l.view instanceof CardListView) l.view.refresh();
        this.prevCount = 0; // 次の同期で開き直す
        void this.syncSidebar();
      }),
    );
    this.registerView(DECK_VIEW, (leaf) => new DeckView(leaf, this.settings));
    this.registerView(DASHBOARD_VIEW, (leaf) => new DashboardView(leaf, { collection: () => void this.openOrReveal(COLLECTION_VIEW), deck: () => void this.openOrReveal(DECKLIST_VIEW), cards: () => void this.openOrReveal(CARDS_VIEW) }));
    this.registerView(CARDS_VIEW, (leaf) => new CardsView(leaf, this.settings));
    this.registerView(
      DECKLIST_VIEW,
      (leaf) =>
        new DeckListView(leaf, {
          open: (f) => void this.openDeck(f),
          create: () => new NameModal(this.app, "Create deck", "赤単バーン", (n, f) => void this.createDeck(n, f), true).open(),
          import: () => new ImportModal(this.app, true, (n, t, f) => void this.importDeck(n, t, f)).open(),
        }),
    );
    this.registerView(COLLECTION_VIEW, (leaf) => new CollectionView(leaf, this.settings));
    this.registerView(CARDLIST_VIEW, (leaf) => new CardListView(leaf, this.settings, () => this.liveTarget()));

    const ws = this.app.workspace;
    this.registerEvent(
      ws.on("active-leaf-change", (leaf) => {
        this.dashboardIfEmpty(leaf);
        if (leaf?.view.getViewType() === DECK_VIEW) void this.followDeck(leaf);
        this.tieSidebar(leaf);
      }),
    );
    this.registerEvent(ws.on("layout-change", () => void this.syncSidebar()));
    ws.onLayoutReady(() => {
      this.dashboardIfEmpty(ws.getMostRecentLeaf());
      void this.syncSidebar();
    });

    this.addCommand({
      id: "fetch-card",
      name: "Fetch card from Scryfall",
      callback: () => new NameModal(this.app, "Fetch card from Scryfall", "Lightning Bolt", (n) => this.fetchCardNote(n)).open(),
    });
    this.addCommand({
      id: "create-deck",
      name: "Create deck",
      callback: () => new NameModal(this.app, "Create deck", "赤単バーン", (n, f) => void this.createDeck(n, f), true).open(),
    });
    this.addCommand({
      id: "import-deck",
      name: "Import deck (Moxfield text)",
      callback: () => new ImportModal(this.app, true, (n, t, f) => void this.importDeck(n, t, f)).open(),
    });
    this.addCommand({ id: "open-collection", name: "Open collection", callback: () => void this.openOrReveal(COLLECTION_VIEW) });
    this.addCommand({
      id: "update-legality",
      name: "Update card legality (cards without it)",
      callback: async () => {
        const keys = localCards(this.app).filter((c) => !c.legal || !c.restricted).map((c) => c.file.basename);
        if (!keys.length) return void new Notice("リーガル情報が無いカードはない");
        new Notice(`リーガル情報を更新中… ${keys.length} 枚`);
        try {
          new Notice(`リーガル情報を更新: ${(await updateLegality(this.app, keys)).size} 枚`);
        } catch (e) {
          new Notice(`更新失敗: ${(e as Error).message}`);
        }
      },
    });
    this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.openOrReveal(DASHBOARD_VIEW) });
    this.addRibbonIcon("layout-dashboard", "Magic the Obsidian", () => void this.openOrReveal(DASHBOARD_VIEW));
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

  // 開いたデッキ (タブを切り替えたデッキ) を、サイドバーの一覧の追加先にする。
  // 背面だったタブは未読み込み (deferred) のことがあるので、読み込んでから使う
  private async followDeck(leaf: WorkspaceLeaf) {
    await (leaf as unknown as { loadIfDeferred?: () => Promise<void> }).loadIfDeferred?.();
    if (leaf.view instanceof DeckView) {
      this.target = leaf.view;
      this.updateLists();
    }
  }

  // サイドバーの一覧はデッキ画面と一緒に出入りする: 他のタブに切り替えたら畳み、デッキ画面に戻ったら開き直す
  private tieSidebar(leaf: WorkspaceLeaf | null) {
    const ws = this.app.workspace;
    if (!leaf || leaf.getRoot() !== ws.rootSplit) return; // サイドバー自身や別ウィンドウのタブは触らない
    if (leaf.view.getViewType() === DECK_VIEW) {
      if (this.closedByTab) ws.rightSplit.expand();
      this.closedByTab = false;
    } else if (ws.getLeavesOfType(CARDLIST_VIEW).some((l) => l.view.containerEl.isShown())) {
      ws.rightSplit.collapse();
      this.closedByTab = true;
    }
  }

  // 新しいタブ (空のタブ) をダッシュボードにする。サイドバーや別ウィンドウのタブは触らない
  private dashboardIfEmpty(leaf: WorkspaceLeaf | null) {
    if (!this.settings.dashboardTab || !leaf || leaf.view.getViewType() !== "empty") return;
    if (leaf.getRoot() !== this.app.workspace.rootSplit) return;
    void leaf.setViewState({ type: DASHBOARD_VIEW, active: true });
  }

  // 開いていればそのタブへ、無ければ新しいタブで
  private async openOrReveal(type: string) {
    const ws = this.app.workspace;
    const open = ws.getLeavesOfType(type)[0];
    if (open) return void ws.revealLeaf(open);
    await ws.getLeaf(true).setViewState({ type, active: true });
  }

  private deckLeaves() {
    const ws = this.app.workspace;
    return [...ws.getLeavesOfType(DECK_VIEW), ...ws.getLeavesOfType(COLLECTION_VIEW)];
  }

  // サイドバーの追加先はデッキ画面だけ (コレクション画面は自前の Add cards)
  private liveTarget(): DeckView | undefined {
    // 背面のタブは未読み込み (deferred) のことがある。その view にはメソッドが無いので、読み込んでから使う
    const views = this.app.workspace
      .getLeavesOfType(DECK_VIEW)
      .map((l) => {
        void (l as unknown as { loadIfDeferred?: () => Promise<void> }).loadIfDeferred?.();
        return l.view;
      })
      .filter((v): v is DeckView => v instanceof DeckView);
    return this.target && views.includes(this.target) ? this.target : views[0];
  }

  private updateLists() {
    // 背面のタブは未読み込み (deferred) で、まだ CardListView ではない
    for (const l of this.app.workspace.getLeavesOfType(CARDLIST_VIEW)) if (l.view instanceof CardListView) l.view.updateTarget();
  }

  // デッキ画面が0→1になったときだけ自動で開く (手で閉じたら、また0になるまで開き直さない)。デッキ画面が無いときは、手で開いても閉じる
  private async syncSidebar() {
    const ws = this.app.workspace;
    const count = ws.getLeavesOfType(DECK_VIEW).length;
    const lists = ws.getLeavesOfType(CARDLIST_VIEW);
    if (!this.settings.sidebar || count === 0) {
      // 一覧が見えていたなら、閉じるときにサイドバーも畳む。他のタブだけが見えているときは触らない
      const shown = lists.some((l) => l.view.containerEl.isShown());
      lists.forEach((l) => l.detach());
      if (shown) ws.rightSplit.collapse();
    } else if (this.prevCount === 0 && !lists.length && !this.opening) {
      this.opening = true;
      try {
        const leaf = ws.getRightLeaf(false);
        if (leaf) {
          // アイコンを置くだけ。サイドバーは勝手に開かない (開くかどうかは、アイコンを押す人が決める)
          await leaf.setViewState({ type: CARDLIST_VIEW, active: false });
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

  private async createDeck(name: string, format: string) {
    const path = normalizePath(`${DECK_DIR}/${fileSafe(name)}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) return new Notice(`Already exists: ${path}`);
    if (!this.app.vault.getAbstractFileByPath(DECK_DIR)) await this.app.vault.createFolder(DECK_DIR);
    await this.openDeck(await this.app.vault.create(path, deckTemplate(format)));
  }

  private async importDeck(name: string, text: string, format: string) {
    const path = normalizePath(`${DECK_DIR}/${fileSafe(name)}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) return void new Notice(`Already exists: ${path}`);
    const r = await resolveDeck(this.app, this.settings, text);
    if (!r) return;
    if (!this.app.vault.getAbstractFileByPath(DECK_DIR)) await this.app.vault.createFolder(DECK_DIR);
    await this.openDeck(await this.app.vault.create(path, writeDeck(deckTemplate(format), format === "commander" ? r.deck : foldCommander(r.deck))));
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
