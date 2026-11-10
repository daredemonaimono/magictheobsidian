import { App, EventRef, Modal, Notice, Platform, Plugin, Setting, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { allNodes } from "./battle/registry";
import { AiAdvisor } from "./battle/aiRun";
import { battleHints } from "./battle/battleHints";
import { buildRuleTwoStage, unsupportedLines } from "./battle/build";
import { DEFAULT_GLOSSARY, GLOSSARY_NOTE, OLD_GLOSSARY_NOTE } from "./battle/glossary";
import { Kind, freeName, parseVersion, sortNewestFirst } from "./battle/history";
import { obsidianHttp } from "./battle/claude";
import { CardStatus, cardStatus, report } from "./battle/coverage";
import { blankRule } from "./battle/editor";
import { registerBuiltinNodes } from "./battle/nodes";
import { SAMPLE_RULES } from "./battle/samples";
import { parseRule } from "./battle/ruleMd";
import { toRows } from "./battle/select";
import { BuildRulesModal } from "./BuildRulesModal";
import { RestoreRuleModal } from "./RestoreRuleModal";
import { RULE_EDITOR_VIEW, RuleEditorView } from "./RuleEditorView";
import { ensureCardFile, localCards, oracleEnglish, updateLegality } from "./cards";
import { DECK_DIR, foldCommander, parseDeck, writeDeck } from "./deck";
import { CardRule } from "./battle/node";
import { CREATABLE, FORMATS } from "./rules";
import { ImportModal, resolveDeck } from "./import";
import { CARDLIST_VIEW, CardListView } from "./CardListView";
import { BATTLE_VIEW, BattleView } from "./BattleView";
import { BATTLE_SIDE_VIEW, BattleSideView } from "./BattleSideView";
import { BattleStartModal } from "./BattleStartModal";
import { BattleSession, MatchError } from "./battle/deckToGame";
import { SavedBattle, battleNote, battleNoteName, parseBattleNote } from "./battle/saved";
import { findDeckFile, listDecks, startBattle, startReplay } from "./battleStart";
import { DeckMemoDraftModal } from "./DeckMemoDraftModal";
import { SelfPlayModal } from "./SelfPlayModal";
import { CARDINFO_VIEW, CardInfoApi, CardInfoView } from "./CardInfoView";
import { editableMemo, setMemo } from "./battle/memo";
import { BattleHistoryModal } from "./BattleHistoryModal";
import { COLLECTION_VIEW, CollectionView } from "./CollectionView";
import { CARDS_VIEW, CardsView } from "./CardsView";
import { AvatarApi, DASHBOARD_VIEW, DashboardView } from "./DashboardView";
import { DECKLIST_VIEW, DeckListView } from "./DeckListView";
import { DECK_VIEW, DeckView } from "./DeckView";
import { fetchCard, fileSafe } from "./scryfall";
import { priceStore, updateCollectionPrices } from "./prices";
import { IMAGE_MODES, PRELOAD_KINDS, PRELOAD_SCOPES } from "./imageKey";
import { initImageCache } from "./imageCache";
import { preloadImages } from "./imagePreload";
import { AvatarKind, DEFAULT_SETTINGS, MOD_KEYS, Settings, SettingsTab, secretKey } from "./settings";
import { Scene, aiLabel, aiReady, migrateAi, providerName, runAi } from "./battle/aiConfig";
import { AskAi } from "./battle/ai";
import { createAgentNote, loadAgentRules } from "./agentNote";
import { sharedFor, withShared } from "./battle/agentRules";

// 「メモ」はカード行の外なので、デッキ画面で枚数を変えても書き換わらない。統率戦だけコマンダー欄があり、サイドは無い
const RULES_DIR = "Rules"; // カードの能力をノードで組んだ md (Cards/ と同じ並び。Obsidian の画面で手で直せる)
const GAPS_NOTE = "_missing-nodes.md"; // (旧: _足りないノード.md。あれば、この名前に移す)
const OLD_GAPS_NOTE = "_足りないノード.md";
const GAPS_HEADER = "---\nmtg: gaps\n---\n\n# Missing nodes (unsupported effects in the rules)\n\nEffects that could not be written with the current nodes (the `## 未対応` lines of each rule, and effects the node-selection stage said it could not write). Useful as a request list for new nodes. After adding a node, rebuild that card's rule; the line disappears once it is fully supported.\n\n"; //  // AI にルールを書かせて、書けなかった効果を、カードごとに残すノート (Rules/ の中。_ で始まる名前は、ルールとして読まない)

const deckTemplate = (format: string) =>
  `---\nmtg: deck\nformat: ${format}\ntags: [mtg/deck]\n---\n\n${format === "commander" ? "## Commander\n\n## Main\n" : "## Main\n\n## Side\n"}\n## メモ\n`;

class NameModal extends Modal {
  private value = "";
  private format = CREATABLE[0];
  private list = "";
  // askFormat: 新しいデッキを作るときはフォーマットも選ぶ
  constructor(app: App, private title: string, private placeholder: string, private onSubmit: (v: string, format: string, list: string) => void, private askFormat = false) {
    super(app);
  }
  onOpen() {
    const submit = () => {
      if (!this.value.trim()) return;
      this.close();
      this.onSubmit(this.value.trim(), this.format, this.list);
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
        .addDropdown((d) => d.addOptions(Object.fromEntries(CREATABLE.map((id) => [id, FORMATS[id].name.toUpperCase()]))).setValue(this.format).onChange((v) => (this.format = v)));
      // 入れると、そのリストを取り込んでデッキを作る (空なら空のデッキ)
      const area = this.contentEl.createEl("textarea", { attr: { rows: "10", placeholder: "Import (任意): Moxfield のテキスト\n4 Lightning Bolt (M11) 149\n...\n\nSIDEBOARD:\n3 Smash to Smithereens (ROE) 160" } });
      area.style.width = "100%";
      area.addEventListener("input", () => (this.list = area.value));
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
    registerBuiltinNodes();
    initImageCache(this.app, this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`, () => this.settings.imageMode); // 画像の保存先は、プラグインのフォルダの中
    // data.json: 設定 + 価格キャッシュ (フラットな1つのオブジェクト)
    const d = (await this.loadData()) ?? {};
    this.settings = {
      textLang: d.textLang ?? DEFAULT_SETTINGS.textLang,
      cardLang: d.cardLang ?? DEFAULT_SETTINGS.cardLang,
      sidebar: d.sidebar ?? DEFAULT_SETTINGS.sidebar,
      listArt: d.listArt ?? DEFAULT_SETTINGS.listArt,
      dashboardTab: d.dashboardTab ?? DEFAULT_SETTINGS.dashboardTab,
      hideLeftBar: d.hideLeftBar ?? DEFAULT_SETTINGS.hideLeftBar,
      avatars: ((["cpu", "player", "sleeve", "pedestal"] as const).reduce((o, k) => ({ ...o, [k]: { files: Array.isArray(d.avatars?.[k]?.files) ? d.avatars[k].files.filter((x: unknown) => typeof x === "string") : [], pick: typeof d.avatars?.[k]?.pick === "string" ? d.avatars[k].pick : "" } }), {}) as Settings["avatars"]),
      deckBg: typeof d.deckBg === "string" ? d.deckBg : DEFAULT_SETTINGS.deckBg,
      sidebarLeft: d.sidebarLeft ?? DEFAULT_SETTINGS.sidebarLeft,
      currency: d.currency ?? DEFAULT_SETTINGS.currency,
      ai: migrateAi(d), // 昔の設定 (claudeKeySecret・battleModel など) も、ここで新しい形に移す
      battleStops: d.battleStops === "always" ? "always" : "smart",
      battleOpponent: d.battleOpponent === "passive" ? "passive" : d.battleOpponent === "claude" ? "claude" : "cpu",
      keyRemove: MOD_KEYS.includes(d.keyRemove) ? d.keyRemove : DEFAULT_SETTINGS.keyRemove,
      keyMove: MOD_KEYS.includes(d.keyMove) ? d.keyMove : DEFAULT_SETTINGS.keyMove,
      battleNoMirror: d.battleNoMirror ?? DEFAULT_SETTINGS.battleNoMirror,
      imageMode: IMAGE_MODES.includes(d.imageMode) ? d.imageMode : DEFAULT_SETTINGS.imageMode,
      imageScope: PRELOAD_SCOPES.includes(d.imageScope) ? d.imageScope : DEFAULT_SETTINGS.imageScope,
      imageKind: PRELOAD_KINDS.includes(d.imageKind) ? d.imageKind : DEFAULT_SETTINGS.imageKind,
      battleHistory: d.battleHistory ?? DEFAULT_SETTINGS.battleHistory,
      battleEffects: d.battleEffects ?? DEFAULT_SETTINGS.battleEffects,
      boardCard: d.boardCard === "full" ? "full" : "frame", // 昔の値 "art" は、frame に
    };
    priceStore.prices = d.prices ?? {};
    priceStore.updated = d.pricesUpdated ?? "";
    priceStore.rates = d.rates ?? {};
    await this.adoptAvatarFiles();
    const saveAll = () => this.saveData({ ...this.settings, prices: priceStore.prices, pricesUpdated: priceStore.updated, rates: priceStore.rates });
    priceStore.save = saveAll;
    this.addSettingTab(
      new SettingsTab(this.app, this, this.settings, saveAll, () => {
        for (const l of this.deckLeaves()) if (l.view instanceof DeckView) l.view.rebuild();
        for (const l of this.app.workspace.getLeavesOfType(CARDLIST_VIEW)) if (l.view instanceof CardListView) l.view.refresh();
        this.prevCount = 0; // 次の同期で開き直す
        void this.syncSidebar();
      }, () => void this.preloadImages(false), () => this.applyLeftBar(), () => void this.moveSidebars()),
    );
    this.registerView(DECK_VIEW, (leaf) => new DeckView(leaf, this.settings));
    this.registerView(BATTLE_VIEW, (leaf) => new BattleView(leaf, () => this.battleSession, () => this.settings.battleStops, () => this.settings.battleOpponent, () => this.settings.battleEffects, () => this.makeAsk(), (b) => void this.saveBattle(b), () => this.ensureBattleSide(), () => this.hintAdvisor(), () => this.settings.boardCard, (k) => this.avatarUrl(k)));
    this.registerView(BATTLE_SIDE_VIEW, (leaf) => new BattleSideView(leaf));
    this.registerView(DASHBOARD_VIEW, (leaf) => new DashboardView(leaf, { collection: () => void this.openOrReveal(COLLECTION_VIEW), deck: () => void this.openOrReveal(DECKLIST_VIEW), cards: () => void this.openOrReveal(CARDS_VIEW), pluginId: this.manifest.id, sidebarLeft: () => this.settings.sidebarLeft, avatars: this.avatarApi() }));
    this.registerView(CARDS_VIEW, (leaf) => new CardsView(leaf, this.settings, (key) => void this.showCardInfo(key, true)));
    this.registerView(CARDINFO_VIEW, (leaf) => new CardInfoView(leaf, this.cardInfoApi()));
    this.registerView(
      DECKLIST_VIEW,
      (leaf) =>
        new DeckListView(leaf, {
          open: (f) => void this.openDeck(f),
          background: () => (this.settings.deckBg ? this.app.vault.adapter.getResourcePath(this.settings.deckBg) : undefined),
          create: () => new NameModal(this.app, "Create deck", "赤単バーン", (n, f, l) => void (l.trim() ? this.importDeck(n, l, f) : this.createDeck(n, f)), true).open(),
        }),
    );
    this.registerView(COLLECTION_VIEW, (leaf) => new CollectionView(leaf, this.settings));
    // ノード設定画面: 「保存」で、saveRule が履歴を残してから md を書く
    this.registerView(
      RULE_EDITOR_VIEW,
      (leaf) =>
        new RuleEditorView(leaf, {
          load: async (card) => {
            const f = this.app.vault.getAbstractFileByPath(normalizePath(`${RULES_DIR}/${card}.md`));
            if (!(f instanceof TFile)) return { rule: blankRule(card) };
            try {
              const rule = parseRule(await this.app.vault.read(f));
              return rule.card === card ? { rule } : { error: `card: が "${rule.card}" で、ファイル名 (${card}) と合わない` };
            } catch (e) {
              return { error: `${(e as Error).message} (md を直すか、空のルールから作り直してください)` };
            }
          },
          save: async (card, md) => {
            await this.ensureRulesDir();
            return this.saveRule(card, md, "edit");
          },
        }),
    );
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
    // デッキ画面のメイン/サイドのタブを押したとき、サイドバーが畳まれていたら開く
    this.registerEvent((ws as unknown as { on(n: string, cb: () => void): EventRef }).on("mtg-show-list", () => void this.showList(ws.getActiveViewOfType(DeckView)?.leaf)));
    ws.onLayoutReady(() => {
      this.applyLeftBar();
      this.dashboardIfEmpty(ws.getMostRecentLeaf());
      void this.syncSidebar();
      window.setTimeout(() => void this.preloadImages(false), 8000); // 「先に保存」のときだけ。起動の直後を避けて、あとから、静かに
    });
    this.addCommand({ id: "create-agent-note", name: "Rules: create the shared AI rules note (_agent.md)", callback: async () => new Notice((await createAgentNote(this.app)) ? "Rules/_agent.md を作った (どの AI も読む、共通ルール)" : "Rules/_agent.md は、すでにある") });
    this.addCommand({ id: "refresh-gaps", name: "Rules: refresh the missing-nodes list (from the current rules)", callback: () => void this.refreshGaps() });
    this.addCommand({ id: "cache-images", name: "Save card images (local cache, per settings)", callback: () => void this.preloadImages(true) });

    this.addCommand({
      id: "fetch-card",
      name: "Fetch card from Scryfall",
      callback: () => new NameModal(this.app, "Fetch card from Scryfall", "Lightning Bolt", (n) => this.fetchCardNote(n)).open(),
    });
    this.addCommand({
      id: "create-deck",
      name: "Create deck",
      callback: () => new NameModal(this.app, "Create deck", "赤単バーン", (n, f, l) => void (l.trim() ? this.importDeck(n, l, f) : this.createDeck(n, f)), true).open(),
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
    this.addCommand({ id: "battle-open", name: "Battle: open battle screen (sample)", callback: () => { this.battleSession = undefined; void this.app.workspace.getLeaf(true).setViewState({ type: BATTLE_VIEW, active: true }); } });
    this.addCommand({ id: "battle-start", name: "Battle: start battle", callback: () => void this.openBattleStart() });
    this.addCommand({
      id: "battle-self-play",
      name: "Battle: self-play debug (CPU vs CPU)",
      callback: async () => {
        const decks = await listDecks(this.app);
        if (!decks.length) return void new Notice("デッキがありません (Decks/)");
        new SelfPlayModal(this.app, decks, async (md) => {
          const path = normalizePath(`${RULES_DIR}/_自動対戦レポート.md`);
          const f = this.app.vault.getAbstractFileByPath(path);
          const file = f instanceof TFile ? (await this.app.vault.modify(f, md), f) : await this.app.vault.create(path, md);
          await this.app.workspace.getLeaf(true).openFile(file);
        }).open();
      },
    });
    this.addCommand({ id: "battle-draft-memo", name: "Battle: draft deck memo", callback: () => void this.openMemoDraft() });
    this.addCommand({ id: "battle-replay", name: "Battle: replay", callback: () => new BattleHistoryModal(this.app, (f) => void this.openReplay(f)).open() });
    this.addCommand({ id: "battle-sample-rules", name: "Battle: create sample rules", callback: () => void this.createSampleRules() });
    this.addCommand({ id: "battle-create-glossary", name: "Battle: create glossary note", callback: () => void this.createGlossaryNote() });
    this.addCommand({ id: "battle-build-rules", name: "Battle: build rules with AI", callback: () => void this.openBuildRules() });
    this.addCommand({ id: "battle-edit-rule", name: "Battle: edit rule nodes", callback: () => void this.openEditor() });
    this.addCommand({ id: "battle-restore-rule", name: "Battle: restore rule version", callback: () => void this.openRestore() });
    this.addCommand({ id: "battle-rules-coverage", name: "Battle: rules coverage", callback: () => void this.rulesCoverage() });
    const ws0 = this.app.workspace;
    const refreshDeckBg = () => this.app.workspace.getLeavesOfType(DECKLIST_VIEW).forEach((l) => (l.view as DeckListView).applyBg());
    this.addCommand({
      id: "deck-background",
      name: "Set deck list background image",
      callback: () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) return;
          const ext = (f.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
          const path = `${this.manifest.dir}/deck-bg.${ext}`;
          if (this.settings.deckBg && this.settings.deckBg !== path) await this.app.vault.adapter.remove(this.settings.deckBg).catch(() => {});
          await this.app.vault.adapter.writeBinary(path, await f.arrayBuffer());
          this.settings.deckBg = path;
          await this.saveSettings();
          refreshDeckBg();
          new Notice("デッキ選択画面の背景を設定した");
        };
        input.click();
      },
    });
    this.addCommand({
      id: "deck-background-clear",
      name: "Clear deck list background image",
      callback: async () => {
        if (this.settings.deckBg) await this.app.vault.adapter.remove(this.settings.deckBg).catch(() => {});
        this.settings.deckBg = "";
        await this.saveSettings();
        refreshDeckBg();
        new Notice("デッキ選択画面の背景をもとに戻した");
      },
    });
    this.addCommand({
      id: "toggle-sidebar-side",
      name: "Toggle sidebar side (show the sidebar on the left / right)",
      callback: async () => {
        this.settings.sidebarLeft = !this.settings.sidebarLeft;
        await this.saveSettings();
        await this.moveSidebars();
        if (ws0.getLeavesOfType(BATTLE_VIEW).length === 0) new Notice(this.settings.sidebarLeft ? "サイドバーを左に出す" : "サイドバーを右に戻した");
      },
    });
    this.addCommand({
      id: "toggle-left-bar",
      name: "Toggle left sidebar (show/hide the file explorer)",
      callback: async () => {
        this.settings.hideLeftBar = !this.settings.hideLeftBar;
        await this.saveData({ ...this.settings, prices: priceStore.prices, pricesUpdated: priceStore.updated, rates: priceStore.rates });
        this.applyLeftBar();
        new Notice(this.settings.hideLeftBar ? "左のバーを隠した" : "左のバーを表示した");
      },
    });
    this.addCommand({
      id: "card-info",
      name: "Show card info (the open card note) in the right sidebar",
      callback: () => {
        const key = this.app.workspace.getActiveFile()?.path.match(/^Cards\/([^/]+)\.md$/)?.[1] ?? this.app.workspace.getActiveFile()?.path.match(new RegExp(`^${RULES_DIR}/([^/_][^/]*)\\.md$`))?.[1];
        if (key) void this.showCardInfo(key);
        else new Notice("Cards/<カード名>.md か Rules/<カード名>.md を開いてから実行してください");
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

  // サイドバーを開いて、カード一覧のタブを前に出す。操作中のデッキ画面 (back) には、そのまま戻す
  private async showList(back?: WorkspaceLeaf) {
    return this.showSide(CARDLIST_VIEW, back);
  }
  private async showSide(type: string, back?: WorkspaceLeaf) {
    const ws = this.app.workspace;
    const list = ws.getLeavesOfType(type)[0];
    if (!list || !this.settings.sidebar) return;
    await ws.revealLeaf(list);
    if (back) ws.setActiveLeaf(back, { focus: true });
  }

  // 対戦の画面のサイドバー (プレビューとログ) を、無ければ作って、開く。設定でサイドバーを使わないなら undefined (対戦の画面の中に、出す)。対戦の画面が無くなったら、閉じる (syncSidebar)
  private async ensureBattleSide(): Promise<{ preview: HTMLElement; log: HTMLElement } | undefined> {
    if (!this.settings.sidebar) return undefined;
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(BATTLE_SIDE_VIEW)[0];
    if (!leaf) {
      const fresh = this.sideLeaf();
      if (!fresh) return undefined;
      await fresh.setViewState({ type: BATTLE_SIDE_VIEW, active: false });
      leaf = fresh;
    }
    const view = leaf.view;
    if (!(view instanceof BattleSideView)) return undefined;
    const battle = ws.getActiveViewOfType(BattleView)?.leaf ?? ws.getLeavesOfType(BATTLE_VIEW)[0];
    await this.showSide(BATTLE_SIDE_VIEW, battle);
    return { preview: view.previewEl, log: view.logEl };
  }

  // サイドバーの一覧は、デッキ画面 (カード一覧)・対戦の画面 (プレビューとログ) と一緒に出入りする: 他のタブに切り替えたら畳み、戻ったら開き直す
  private tieSidebar(leaf: WorkspaceLeaf | null) {
    const ws = this.app.workspace;
    if (!leaf || leaf.getRoot() !== ws.rootSplit) return; // サイドバー自身や別ウィンドウのタブは触らない
    const pairs: [string, string][] = [[DECK_VIEW, CARDLIST_VIEW], [BATTLE_VIEW, BATTLE_SIDE_VIEW]];
    const shown = (side: string) => ws.getLeavesOfType(side).some((l) => l.view.containerEl.isShown());
    const mine = pairs.find(([v]) => v === leaf.view.getViewType());
    if (mine) {
      // 自分の側が見えていなくて、(手で畳んだのではなく) タブの切り替えで畳んだとき、または、もう一方の側が見えているとき: 開く
      if (this.closedByTab || pairs.some(([, s]) => s !== mine[1] && shown(s))) void this.showSide(mine[1], leaf);
      this.closedByTab = false;
    } else if (pairs.some(([, s]) => shown(s))) {
      this.sideSplit.collapse();
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
    // 対戦の画面が無くなったら、サイドバーのプレビュー・ログも閉じる (開くのは、対戦の画面が、始まるとき)
    const sides = ws.getLeavesOfType(BATTLE_SIDE_VIEW);
    if (sides.length && !ws.getLeavesOfType(BATTLE_VIEW).length) {
      const shown = sides.some((l) => l.view.containerEl.isShown());
      sides.forEach((l) => l.detach());
      if (shown) this.sideSplit.collapse();
    }
    // カード情報 (カードのタブから開いたもの): カードのタブが無くなったら、サイドバーも閉じる (デッキ構築のサイドバーと同じ)
    const infos = ws.getLeavesOfType(CARDINFO_VIEW);
    if (this.cardInfoFromCards && infos.length && !ws.getLeavesOfType(CARDS_VIEW).length) {
      const shown = infos.some((l) => l.view.containerEl.isShown());
      infos.forEach((l) => l.detach());
      if (shown) this.sideSplit.collapse();
    }
    if (!infos.length) this.cardInfoFromCards = false;
    const count = ws.getLeavesOfType(DECK_VIEW).length;
    const lists = ws.getLeavesOfType(CARDLIST_VIEW);
    if (!this.settings.sidebar || count === 0) {
      // 一覧が見えていたなら、閉じるときにサイドバーも畳む。他のタブだけが見えているときは触らない
      const shown = lists.some((l) => l.view.containerEl.isShown());
      lists.forEach((l) => l.detach());
      if (shown) this.sideSplit.collapse();
    } else if (this.prevCount === 0 && !lists.length && !this.opening) {
      this.opening = true;
      try {
        const leaf = this.sideLeaf();
        if (leaf) {
          const deck = ws.getActiveViewOfType(DeckView)?.leaf;
          await leaf.setViewState({ type: CARDLIST_VIEW, active: false });
          await this.showList(deck); // デッキ画面を開いたとき、サイドバーに一覧が出る
        }
      } finally {
        this.opening = false;
      }
    }
    this.prevCount = count;
    this.updateLists();
  }

  // ---- 対戦: デッキを選んで始める
  private battleSession?: BattleSession;

  // 場面 (対戦の相手・ルールを書かせる・メモの下書き) の AI を呼ぶ関数。設定の、その場面の種類・モデル。キーが無い (互換 API の URL を変えていない OpenAI・Gemini・Claude) ときは undefined
  private askFor(scene: Scene): ((system: string, messages: { role: "user" | "assistant"; content: string }[]) => Promise<{ text: string; input?: number; output?: number }>) | undefined {
    const secret = (name: string) => secretKey(this.app, name);
    const ai = this.settings.ai;
    if (!aiReady(ai, scene, secret)) return undefined;
    return (system, messages) => runAi({ ai, scene, secret, http: obsidianHttp, system, messages });
  }
  // コードが計算した行動の分析 (ノードの役割・コピーした局面での試し撃ち・攻撃とブロックの比べ合い) を、AI に渡す道具 (API を呼ばない)。設定 ai.hints が off でないとき
  private hintAdvisor(): AiAdvisor | undefined {
    const ai = this.settings.ai;
    if (ai.hints === "off") return undefined;
    return { mode: ai.hints, judge: async (w, g, rules, p, opts) => ({ text: battleHints(w, g, rules, p, opts), input: 0, output: 0, ms: 0 }) };
  }
  // 対戦の相手の AI (1 通の質問 → 返事)
  private makeAsk(scene: Scene = "battle"): AskAi | undefined {
    const f = this.askFor(scene);
    return f ? (system, user) => f(system, [{ role: "user", content: user }]) : undefined;
  }
  // 共通ルール (メモの下書き) を、AI への指示に足した問い合わせ
  private withSharedAsk(ask: AskAi | undefined, shared: string): AskAi | undefined {
    return ask ? (system, user) => ask(withShared(system, shared), user) : undefined;
  }
  private missingKeyNotice(scene: Scene) {
    new Notice(`設定の「AI の接続」で、${providerName(this.settings.ai.scenes[scene].provider)} の API キーを選んでください (Magic the Obsidian → AI の接続)`);
  }

  // 対戦の履歴を、Battles/ のノートに保存する (設定でオフにできる)。同じ名前があれば、-2, -3 …
  private async saveBattle(b: SavedBattle) {
    if (!this.settings.battleHistory) return;
    try {
      const dir = "Battles";
      if (!(await this.app.vault.adapter.exists(dir))) await this.app.vault.createFolder(dir);
      const base = battleNoteName(b).replace(/\.md$/, "");
      let path = normalizePath(`${dir}/${base}.md`);
      for (let n = 2; await this.app.vault.adapter.exists(path); n++) path = normalizePath(`${dir}/${base}-${n}.md`);
      await this.app.vault.create(path, battleNote(b.mode === "claude" ? { ...b, model: aiLabel(this.settings.ai, "battle") } : b));
    } catch (e) {
      new Notice(`対戦の履歴を保存できなかった: ${(e as Error).message}`);
    }
  }

  // 「先に保存」: デッキとコレクションのカードの画像を、ローカルへ。loud = 手で呼んだとき (設定に関係なく、結果を知らせる。ただし、保存しない設定のときは、保存されない旨を知らせる)
  private preloading = false;
  private async preloadImages(loud: boolean) {
    if (this.settings.imageMode === "off") return void (loud && new Notice("画像の保存が「保存しない」になっている。設定の「画像」で変えられる"));
    if (!loud && this.settings.imageMode !== "preload") return;
    if (this.preloading) return;
    this.preloading = true;
    const notice = loud ? new Notice("画像を保存しています…", 0) : undefined;
    try {
      const n = await preloadImages(this.app, this.settings.imageScope, this.settings.imageKind, (done, total) => notice?.setMessage(`画像を保存しています… ${done} / ${total}`));
      notice?.hide();
      if (loud) new Notice(`画像を保存した: ${n} 枚 (保存済みは、飛ばした)`);
    } catch (e) {
      notice?.hide();
      console.error(e);
      if (loud) new Notice(`画像を保存できない: ${(e as Error).message}`);
    } finally {
      this.preloading = false;
    }
  }

  private async openBattleStart() {
    const decks = await listDecks(this.app);
    if (!decks.length) return void new Notice("デッキがありません (Decks/)");
    new BattleStartModal(this.app, decks, (self, opp) => void this.beginBattle(self, opp), this.settings.battleNoMirror).open();
  }

  // デッキのメモの下書き: 対戦の履歴から、AI に作らせる。保存は、人が採用したときだけ
  private async openMemoDraft() {
    const decks = (await listDecks(this.app)).map((d) => d.name);
    if (!decks.length) return void new Notice("デッキがありません (Decks/)");
    const loadHistory = async () => {
      const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("Battles/") && this.app.metadataCache.getFileCache(f)?.frontmatter?.mtg === "battle").sort((a, b) => b.basename.localeCompare(a.basename));
      const out: SavedBattle[] = [];
      for (const f of files) {
        const s = parseBattleNote(await this.app.vault.cachedRead(f));
        if (s) out.push(s);
      }
      return out;
    };
    const fileOf = (deck: string) => findDeckFile(this.app, deck);
    new DeckMemoDraftModal(
      this.app,
      decks,
      loadHistory,
      async (deck) => {
        const f = fileOf(deck);
        return f ? editableMemo(await this.app.vault.read(f)) : "";
      },
      this.withSharedAsk(this.makeAsk("memo"), sharedFor(await loadAgentRules(this.app), "memo")),
      async (deck, text, mode) => {
        const f = fileOf(deck);
        if (!f) throw new Error(`デッキが見つからない: ${deck}`);
        await this.app.vault.process(f, (c) => setMemo(c, mode === "append" ? [editableMemo(c), text].filter(Boolean).join("\n\n") : text));
      },
    ).open();
  }

  // 履歴のリプレイを開く: 記録と同じデッキ・種から作り直して、記録を呼び直す (デッキ・ルールのノートが変わっていると、食い違うことがある)。Claude の API は呼ばない
  private async openReplay(file: TFile) {
    const saved = parseBattleNote(await this.app.vault.cachedRead(file));
    if (!saved) return void new Notice("対戦の記録として読めません");
    try {
      this.battleSession = await startReplay(this.app, saved);
    } catch (e) {
      return void new Notice(e instanceof MatchError ? e.message : `リプレイを始められません: ${(e as Error).message}`);
    }
    const open = this.app.workspace.getLeavesOfType(BATTLE_VIEW)[0];
    if (open?.view instanceof BattleView) {
      await open.view.begin();
      void this.app.workspace.revealLeaf(open);
    } else await this.app.workspace.getLeaf(true).setViewState({ type: BATTLE_VIEW, active: true });
  }

  private async beginBattle(self: string, opp: string) {
    try {
      this.battleSession = await startBattle(this.app, self, opp, this.settings.battleOpponent !== "passive", this.settings.battleOpponent === "claude" ? this.makeAsk() : undefined);
    } catch (e) {
      new Notice(e instanceof MatchError ? e.message : `始められません: ${(e as Error).message}`);
      return;
    }
    const open = this.app.workspace.getLeavesOfType(BATTLE_VIEW)[0]; // 開いている対戦の画面があれば、その局面を置き換える
    if (open?.view instanceof BattleView) {
      await open.view.begin();
      void this.app.workspace.revealLeaf(open);
    } else await this.app.workspace.getLeaf(true).setViewState({ type: BATTLE_VIEW, active: true });
  }

  private async ensureRulesDir() {
    if (!this.app.vault.getAbstractFileByPath(RULES_DIR)) await this.app.vault.createFolder(RULES_DIR);
  }

  // 打ち消し3種のサンプルを Rules/ に作る (すでにあるファイルは上書きしない)
  private async createSampleRules() {
    await this.ensureRulesDir();
    let made = 0;
    for (const [name, md] of Object.entries(SAMPLE_RULES)) {
      const path = normalizePath(`${RULES_DIR}/${fileSafe(name)}.md`);
      if (this.app.vault.getAbstractFileByPath(path)) continue;
      await this.app.vault.create(path, md);
      made++;
    }
    new Notice(`サンプルのルールを ${made} 枚作った (すでにあるものは飛ばした)`);
  }

  // Cards/ の全カードについて、Rules/<名前>.md の状況 (ok / partial / unbuilt。ノートが無ければ「ルールのノートが無い」)
  private async ruleStatuses(): Promise<Map<string, CardStatus>> {
    const out = new Map<string, CardStatus>();
    for (const c of localCards(this.app)) {
      const name = c.file.basename;
      const f = this.app.vault.getAbstractFileByPath(normalizePath(`${RULES_DIR}/${name}.md`));
      out.set(name, cardStatus(name, f instanceof TFile ? await this.app.vault.read(f) : undefined));
    }
    return out;
  }

  // 状況を Rules/_coverage.md に書き出す
  private async rulesCoverage() {
    await this.ensureRulesDir();
    const statuses = [...(await this.ruleStatuses()).values()];
    const path = normalizePath(`${RULES_DIR}/_coverage.md`);
    const body = report(statuses.sort((a, b) => a.card.localeCompare(b.card)));
    const old = this.app.vault.getAbstractFileByPath(path);
    if (old instanceof TFile) await this.app.vault.modify(old, body);
    else await this.app.vault.create(path, body);
    new Notice(`ルールの状況を書き出した: ok ${statuses.filter((s) => s.status === "ok").length} / ${statuses.length} 枚`);
  }

  // AI にノードを組み立ててもらうカードを、画面で選ぶ (初期のチェックは、ルールのノートが無いカード)
  private async openBuildRules() {
    if (!this.askFor("rules")) return void this.missingKeyNotice("rules");
    const statuses = await this.ruleStatuses();
    new BuildRulesModal(this.app, toRows([...statuses.keys()], statuses), (names, ruling) => void this.buildRulesFor(names, ruling)).open();
  }

  // AI への用語集: Rules/_glossary.md (以前の名前 _用語.md でもよい) があれば、その内容 (先頭のフロントマターは除く)。無ければ undefined (既定の用語集)
  private async readGlossary(): Promise<string | undefined> {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(`${RULES_DIR}/${GLOSSARY_NOTE}`)) ?? this.app.vault.getAbstractFileByPath(normalizePath(`${RULES_DIR}/${OLD_GLOSSARY_NOTE}`));
    return f instanceof TFile ? (await this.app.vault.read(f)).replace(/^---\n[\s\S]*?\n---\n/, "").trim() || undefined : undefined;
  }

  // 既定の用語集から Rules/_glossary.md を作る (あれば作らない)。作ったあとは、この内容が既定のかわりに AI へ渡る
  private async createGlossaryNote() {
    await this.ensureRulesDir();
    const path = normalizePath(`${RULES_DIR}/${GLOSSARY_NOTE}`);
    if (this.app.vault.getAbstractFileByPath(path)) return void new Notice(`${path} はすでにある`);
    await this.app.vault.create(path, `---\nmtg: glossary\n---\n\n${DEFAULT_GLOSSARY}\n`);
    new Notice(`${path} を作った。直した内容が、AI への既定の用語集のかわりに使われる`);
  }

  // 選ばれたカードを順に AI へ(裁定後のテキストがあれば、それも送る)。成功したら Rules/<名前>.md に書く。履歴は saveRule が残す。失敗したカードは元のまま
  private async buildRulesFor(names: string[], ruling?: string) {
    const ask = this.askFor("rules");
    if (!ask) return void this.missingKeyNotice("rules");
    await this.ensureRulesDir();
    const glossary = await this.readGlossary();
    const shared = sharedFor(await loadAgentRules(this.app), "nodes"); // 共通ルール (Rules/_agent.md の、共通 + ノード作成)
    const select = this.askFor("nodes"); // 1段目 (ノードを選ぶ)。キーが無ければ、飛ばして、全ノードを渡す
    let made = 0;
    let over = 0;
    let failed = 0;
    let fallback = 0;
    let gaps = 0;
    for (const [i, name] of names.entries()) {
      new Notice(`AI に頼んでいる (${i + 1}/${names.length}): ${name}`);
      try {
        const oracle = await oracleEnglish(this.app, name);
        const r = await buildRuleTwoStage({
          card: name,
          oracle,
          ruling,
          glossary,
          shared,
          ask: async (system, messages) => (await ask(system, messages)).text,
          ...(select
            ? { askSelect: async (system: string, user: string) => (await select(system, [{ role: "user" as const, content: user }])).text }
            : {}),
        });
        if ((await this.saveRule(name, r.md, "ai")) === "created") made++;
        else over++;
        if (r.fallback) fallback++;
        if (await this.recordGaps(name, r.md, r.missing)) gaps++;
      } catch (e) {
        failed++;
        new Notice(`${name}: ${(e as Error).message}`);
      }
    }
    new Notice(`AI のルール作成: 作った ${made} 枚 / 上書きした ${over} 枚 / 失敗 ${failed} 枚${fallback ? ` / 全ノードで、やり直した ${fallback} 枚` : ""}${gaps ? ` / 足りない効果あり ${gaps} 枚 (${RULES_DIR}/${GAPS_NOTE})` : ""}`);
  }

  onunload() {
    document.body.removeClass("mtg-hide-left-bar"); // プラグインを切ったら、左のバーは、元に戻す
  }

  // ---- カード情報 (右のサイドバー): ダッシュボードのカードを押すと、ルールの設定・採用しているデッキが見える
  private cardInfoApi(): CardInfoApi {
    return {
      rule: async (key) => {
        const f = this.app.vault.getAbstractFileByPath(normalizePath(`${RULES_DIR}/${key}.md`));
        const md = f instanceof TFile ? await this.app.vault.read(f) : undefined;
        let rule: CardRule | undefined;
        try {
          rule = md ? parseRule(md) : undefined;
        } catch {
          rule = undefined;
        }
        return { status: cardStatus(key, md), rule, hasNote: f instanceof TFile };
      },
      decks: async (key) => {
        const out: { file: TFile; name: string; counts: { board: string; n: number }[] }[] = [];
        const label: Record<string, string> = { commander: "Commander", main: "Main", side: "Side", token: "Token" };
        for (const f of this.app.vault.getMarkdownFiles().filter((x) => x.path.startsWith(`${DECK_DIR}/`) && this.app.metadataCache.getFileCache(x)?.frontmatter?.mtg === "deck").sort((a, b) => a.basename.localeCompare(b.basename))) {
          const deck = parseDeck(await this.app.vault.cachedRead(f));
          const counts = (["commander", "main", "side", "token"] as const).flatMap((b) => (deck[b].get(key) ? [{ board: label[b], n: deck[b].get(key)!.n }] : []));
          if (counts.length) out.push({ file: f, name: f.basename, counts });
        }
        return out;
      },
      openDeck: (file) => void this.openDeck(file),
      openCardNote: (key) => {
        const f = this.app.vault.getAbstractFileByPath(`Cards/${key}.md`);
        if (f instanceof TFile) void this.app.workspace.getLeaf(true).openFile(f);
      },
      openRuleNote: (key) => {
        const f = this.app.vault.getAbstractFileByPath(normalizePath(`${RULES_DIR}/${key}.md`));
        if (f instanceof TFile) void this.app.workspace.getLeaf(true).openFile(f);
      },
      editRule: (key) => void this.app.workspace.getLeaf(true).setViewState({ type: RULE_EDITOR_VIEW, state: { card: key }, active: true }),
      buildRule: (key) => (this.askFor("rules") ? void this.buildRulesFor([key]) : this.missingKeyNotice("rules")),
    };
  }

  // 右のサイドバーに、カード情報を出す (すでにあれば、そのカードに切り替える)
  private cardInfoFromCards = false; // カードのタブから開いたか (そうなら、カードのタブを閉じたとき、一緒に閉じる)
  async showCardInfo(key: string, fromCards = false) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(CARDINFO_VIEW)[0];
    if (!leaf) {
      const right = this.sideLeaf();
      if (!right) return;
      await right.setViewState({ type: CARDINFO_VIEW, active: true });
      leaf = right;
    }
    this.cardInfoFromCards = fromCards; // 最後に、どこから開いたか (コマンドから開いたら、カードのタブとは、無関係)
    ws.revealLeaf(leaf);
    if (leaf.view instanceof CardInfoView) await leaf.view.show(key);
  }

  // 左のバー (ファイル一覧) を隠す・戻す (パソコンのみ)。隠すときは、開いていれば、畳む
  applyLeftBar() {
    const left = this.settings.sidebarLeft && Platform.isDesktop; // サイドバーを左に出すモード: 左のバーは、サイドバーとして使う (隠さない)
    const hide = this.settings.hideLeftBar && Platform.isDesktop && !left;
    document.body.toggleClass("mtg-hide-left-bar", hide);
    document.body.toggleClass("mtg-sidebar-left", left);
    if (hide) this.app.workspace.leftSplit?.collapse();
    if (left) for (const l of this.app.workspace.getLeavesOfType("file-explorer")) l.detach(); // 左のバーに残るファイル一覧は、閉じる
  }

  // プラグインのサイドバーを出す側 (設定「サイドバーを左に出す」)
  private get sideSplit() {
    return this.settings.sidebarLeft && Platform.isDesktop ? this.app.workspace.leftSplit : this.app.workspace.rightSplit;
  }
  private sideLeaf(): WorkspaceLeaf | null {
    return this.settings.sidebarLeft && Platform.isDesktop ? this.app.workspace.getLeftLeaf(false) : this.app.workspace.getRightLeaf(false);
  }

  // サイドバーの側を切り替えたとき: 出ているサイドバー (カード一覧・カード情報・対戦のプレビューとログ) を、反対側に移す。対戦中は、プレビューとログの持ち主 (対戦の画面) が、場所を覚えているので、切り替えない
  async moveSidebars() {
    const ws = this.app.workspace;
    if (ws.getLeavesOfType(BATTLE_VIEW).length) {
      this.settings.sidebarLeft = !this.settings.sidebarLeft; // 元に戻す
      await this.saveSettings();
      new Notice("対戦中は、サイドバーの側を切り替えられません (対戦の画面を閉じてから)");
      return;
    }
    this.applyLeftBar();
    const info = (ws.getLeavesOfType(CARDINFO_VIEW)[0]?.view as CardInfoView | undefined)?.current();
    const fromCards = this.cardInfoFromCards;
    for (const t of [CARDLIST_VIEW, BATTLE_SIDE_VIEW, CARDINFO_VIEW]) for (const l of ws.getLeavesOfType(t)) l.detach();
    ws.leftSplit.collapse();
    ws.rightSplit.collapse();
    this.prevCount = 0; // 次の同期で、デッキ画面のカード一覧を、新しい側に開き直す
    await this.syncSidebar();
    if (info) await this.showCardInfo(info, fromCards);
    for (const l of ws.getLeavesOfType(DASHBOARD_VIEW)) if (l.view instanceof DashboardView) void l.view.refresh();
  }

  // アバター: 画像は、プラグインのフォルダの avatars/ に置く。pick が空なら、対戦のたびに、ランダム
  private avatarUrl(k: AvatarKind): string | undefined {
    const a = this.settings.avatars[k];
    if ((k === "sleeve" || k === "pedestal") && !a.pick) return undefined; // スリーブ・台座の飾りは、選ばなければ、標準 (ランダムにしない)
    const f = a.pick && a.files.includes(a.pick) ? a.pick : a.files[Math.floor(Math.random() * a.files.length)];
    return f ? this.app.vault.adapter.getResourcePath(f) : undefined;
  }
  // avatars/ に手で置いた画像 (cpu-・player-・sleeve-・pedestal- で始まる名前) を、登録されていなければ、一覧に足す。登録だけで、使われはしない (選んだときだけ)
  private async adoptAvatarFiles() {
    const ad = this.app.vault.adapter, dir = `${this.manifest.dir}/avatars`;
    if (!(await ad.exists(dir))) return;
    let changed = false;
    for (const path of (await ad.list(dir)).files.sort()) {
      const k = (["cpu", "player", "sleeve", "pedestal"] as const).find((x) => path.slice(dir.length + 1).startsWith(`${x}-`));
      if (k && !this.settings.avatars[k].files.includes(path)) { this.settings.avatars[k].files.push(path); changed = true; }
    }
    if (changed) await this.saveSettings();
  }
  private avatarApi(): AvatarApi {
    const ad = () => this.app.vault.adapter;
    const done = async () => {
      await this.saveSettings();
      for (const l of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)) if (l.view instanceof DashboardView) void l.view.refresh();
    };
    return {
      list: (k) => ({ files: this.settings.avatars[k].files.map((p) => ({ path: p, url: ad().getResourcePath(p) })), pick: this.settings.avatars[k].pick }),
      pick: async (k, p) => {
        this.settings.avatars[k].pick = p;
        await done();
      },
      add: (k) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.multiple = true;
        input.onchange = async () => {
          const dir = `${this.manifest.dir}/avatars`;
          if (!(await ad().exists(dir))) await ad().mkdir(dir);
          for (const f of Array.from(input.files ?? [])) {
            const ext = (f.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
            const path = `${dir}/${k}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
            await ad().writeBinary(path, await f.arrayBuffer());
            this.settings.avatars[k].files.push(path);
          }
          await done();
        };
        input.click();
      },
      remove: async (k, p) => {
        const a = this.settings.avatars[k];
        await ad().remove(p).catch(() => {});
        a.files = a.files.filter((x) => x !== p);
        if (a.pick === p) a.pick = "";
        await done();
      },
    };
  }

  private async saveSettings() {
    await this.saveData({ ...this.settings, prices: priceStore.prices, pricesUpdated: priceStore.updated, rates: priceStore.rates });
  }

  // 旧い名前のノート (_足りないノード.md) があって、新しい名前 (_missing-nodes.md) が無ければ、名前を移す
  private async migrateGapsNote() {
    const oldFile = this.app.vault.getAbstractFileByPath(normalizePath(`${RULES_DIR}/${OLD_GAPS_NOTE}`));
    if (oldFile instanceof TFile && !this.app.vault.getAbstractFileByPath(normalizePath(`${RULES_DIR}/${GAPS_NOTE}`))) await this.app.fileManager.renameFile(oldFile, normalizePath(`${RULES_DIR}/${GAPS_NOTE}`));
  }

  // Rules/_missing-nodes.md を、いまのルールの「未対応」から、作り直す (ノードを足したあと、ルールを手で直したあとの、古い記録を消す)。AI は呼ばない
  private async refreshGaps() {
    const entries: string[] = [];
    for (const f of this.app.vault.getMarkdownFiles().filter((x) => x.parent?.path === RULES_DIR && !x.basename.startsWith("_")).sort((a, b) => a.basename.localeCompare(b.basename))) {
      const lines = unsupportedLines(await this.app.vault.read(f));
      if (lines.length) entries.push(`- [[${f.basename}]]: ${lines.join(" / ").replace(/\n/g, " ")}`);
    }
    const text = `${GAPS_HEADER}${entries.join("\n")}${entries.length ? "\n" : ""}`;
    await this.migrateGapsNote();
    const path = normalizePath(`${RULES_DIR}/${GAPS_NOTE}`);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.vault.modify(f, text);
    else await this.app.vault.create(path, text);
    new Notice(`足りないノードの一覧を作り直した: ${entries.length} 枚`);
  }

  // 足りない効果 (ルールの「未対応」と、1段目が「書けなさそう」と答えたもの) を、Rules/_missing-nodes.md に、カードごとに残す。次に作るノードの手がかり (ノードを足したら、そのカードを、もう一度、書かせる)。無ければ、そのカードの行を消す
  private async recordGaps(card: string, md: string, missing: string[]): Promise<boolean> {
    const lines = unsupportedLines(md);
    await this.migrateGapsNote();
    const path = normalizePath(`${RULES_DIR}/${GAPS_NOTE}`);
    const f = this.app.vault.getAbstractFileByPath(path);
    const old = f instanceof TFile ? await this.app.vault.read(f) : GAPS_HEADER;
    const keep = old.split("\n").filter((l) => !l.startsWith(`- [[${card}]]`));
    const entry = lines.length || missing.length ? [`- [[${card}]]: ${[...lines, ...missing.map((x) => `(stage 1) ${x}`)].join(" / ").replace(/\n/g, " ")}`] : [];
    const text = [...keep.filter((l, i, a) => !(l === "" && a[i - 1] === "")), ...entry].join("\n").replace(/\n+$/, "\n");
    if (text !== old) {
      if (f instanceof TFile) await this.app.vault.modify(f, text);
      else if (entry.length) await this.app.vault.create(path, text);
    }
    return lines.length > 0;
  }

  // ---- ルールの履歴: Rules/_backup/<カード名>/<日時>-<種類>.md ----
  private ruleName(path: string): string | null {
    const m = path.match(new RegExp(`^${RULES_DIR}/([^/]+)\\.md$`));
    return m && !m[1].startsWith("_") ? m[1] : null;
  }

  // ルールの保存の入口。すでにあれば、書き換える前の内容を先に履歴に残してから書く (履歴の保存に失敗したら書かない)。
  // AI の作り替え (kind="ai") と、版を戻す (kind="restore") が使う。あとで作るノード設定画面の「保存」も、kind="edit" でこれを呼ぶ。
  // md を直接書き換えた分は、保存のタイミングが分からないので、履歴には残さない
  private async saveRule(name: string, md: string, kind: Kind): Promise<"created" | "updated" | "same"> {
    const path = normalizePath(`${RULES_DIR}/${fileSafe(name)}.md`);
    const old = this.app.vault.getAbstractFileByPath(path);
    if (!(old instanceof TFile)) {
      await this.app.vault.create(path, md);
      return "created";
    }
    const before = await this.app.vault.read(old);
    if (before === md) return "same";
    await this.snapshot(name, before, kind);
    await this.app.vault.modify(old, md);
    return "updated";
  }

  private versionFiles(name: string): TFile[] {
    const dir = `${RULES_DIR}/_backup/${name}/`;
    return this.app.vault.getFiles().filter((f) => f.path.startsWith(dir) && !f.path.slice(dir.length).includes("/"));
  }

  // 書き換わる前の内容を、履歴に1ファイル足す。直前の版と同じ内容なら足さない
  private async snapshot(name: string, content: string, kind: Kind) {
    for (const d of [normalizePath(`${RULES_DIR}/_backup`), normalizePath(`${RULES_DIR}/_backup/${name}`)]) if (!this.app.vault.getAbstractFileByPath(d)) await this.app.vault.createFolder(d);
    const files = this.versionFiles(name);
    const latest = sortNewestFirst(files.map((f) => f.name))[0];
    const lf = files.find((f) => f.name === latest);
    if (lf && (await this.app.vault.read(lf)) === content) return;
    await this.app.vault.create(normalizePath(`${RULES_DIR}/_backup/${name}/${freeName(new Date(), kind, new Set(files.map((f) => f.name)))}`), content);
  }

  // 開いている Rules/<名前>.md か Cards/<名前>.md のノード設定画面を開く (同じカードが開いていれば、そのタブへ)
  private async openEditor() {
    const path = this.app.workspace.getActiveFile()?.path ?? "";
    const card = this.ruleName(path) ?? path.match(/^Cards\/([^/]+)\.md$/)?.[1];
    if (!card) return void new Notice("Rules/<カード名>.md か Cards/<カード名>.md を開いてから実行してください");
    const open = this.app.workspace.getLeavesOfType(RULE_EDITOR_VIEW).find((l) => l.getViewState().state?.card === card);
    if (open) return void this.app.workspace.revealLeaf(open);
    await this.app.workspace.getLeaf(true).setViewState({ type: RULE_EDITOR_VIEW, state: { card }, active: true });
  }

  // 開いているルール (または履歴のノート) の、版の一覧から戻す
  private openRestore() {
    const path = this.app.workspace.getActiveFile()?.path ?? "";
    const name = this.ruleName(path) ?? path.match(new RegExp(`^${RULES_DIR}/_backup/([^/]+)/[^/]+\\.md$`))?.[1];
    if (!name) return void new Notice("Rules/<カード名>.md か、その履歴のノートを開いてから実行してください");
    const files = this.versionFiles(name);
    const versions = sortNewestFirst(files.map((f) => f.name)).map((n) => ({ file: files.find((f) => f.name === n)!, ...parseVersion(n)! }));
    if (!versions.length) return void new Notice(`${name}: 履歴はまだない`);
    new RestoreRuleModal(this.app, name, versions, (f) => void this.restoreVersion(name, f), (f) => void this.app.workspace.getLeaf(true).openFile(f)).open();
  }

  // 選んだ版に戻す。いまの内容は、saveRule が先に履歴に残す (戻したことも取り消せる)
  private async restoreVersion(name: string, file: TFile) {
    const r = await this.saveRule(name, await this.app.vault.read(file), "restore");
    new Notice(r === "same" ? `${name}: すでにこの版です` : `${name}: ${parseVersion(file.name)?.stamp ?? file.name} の版に戻した`);
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
