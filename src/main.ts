import { FileSystemAdapter, Notice, Plugin, TFile, loadPrism, normalizePath, requestUrl } from "obsidian";
import { setLang, t } from "./i18n";
import { NODE_EDITOR_VIEW, NodeEditorView, NodeStore } from "./NodeEditorView";
import { CardData, parseCardMd, toCardMd } from "./node/card";
import { ScryCard, artFileName, cardsOf, isScryfallImage, printsFrom, printsUrl, scryfallUrl } from "./node/scryfall";
import { Settings, SettingsHost, SettingsTab, loadSettings } from "./settings";
import { ComposeResult, composeAbility } from "./ai/compose";
import { DEFAULT_MODELS, Http, Provider, errorText, modelIds, modelsRequest } from "./ai/providers";
import guide from "../docs/ai-guide.md";
import { FONT_DIR, Loaded, loadLocalFonts } from "./fonts";
import { mtgNodeEditorHighlight } from "./highlight/editor";
import { prismGrammar } from "./highlight/tokens";
import { NodeData } from "./node/md";
import { BATCH, RulingState, collect, itemKey, reportMd, ruleWithSubs, rulingAnalysis } from "./ruling";

const REPORT_DIR = "cr"; // Ruling report の置き場 (vault 直下の cr/。プラグインのフォルダの cr/ (CR の写し) とは、別)
const CARD_DIR = "Cards"; // カード = Cards/<カード名>.md (能力のノードが、コードブロックで入る。ノードの置き場は、ここだけ)

export default class MagicTheObsidian extends Plugin {
  settings!: Settings;

  async onload() {
    this.settings = loadSettings(await this.loadData());
    setLang(this.settings.language);
    // ```mtg-node ブロックの色分け: 編集表示 (CodeMirror) と、閲覧表示 (Prism) の、両方
    this.registerEditorExtension(mtgNodeEditorHighlight);
    void loadPrism().then((Prism) => { Prism.languages["mtg-node"] = prismGrammar(); }).catch(() => { /* 閲覧表示の色分けだけ、効かない */ });
    this.registerView(NODE_EDITOR_VIEW, (leaf) => new NodeEditorView(leaf, this.nodeStore()));
    this.addCommand({ id: "node-editor", name: "Node: open the node editor", callback: () => void this.openNodeEditor() });
    this.addCommand({ id: "ruling-report", name: "Ruling report", callback: () => void this.rulingReport() });
    this.addCommand({ id: "ruling-report-full", name: "Ruling report (full re-check, ignore the last one)", callback: () => void this.rulingReport(true) });
    this.addRibbonIcon("blocks", t("ribbon"), () => void this.openNodeEditor());
    void this.loadCrInfo().catch(() => undefined); // 設定の画面に出す、CR の取得日・件数
    void this.reloadFonts(); // 自分で置いたフォント (fonts/) を、読み込む
    const host: SettingsHost = {
      settings: () => this.settings,
      save: () => this.saveData(this.settings),
      changeLanguage: (l) => this.changeLanguage(l),
      fonts: () => ({ dir: this.fullPath(`${this.manifest.dir}/${FONT_DIR}`), loaded: this.loadedFonts }),
      openFontDir: () => this.openFontDir(),
      reloadFonts: () => this.reloadFonts(),
      cr: () => this.crInfo,
      refreshCr: async () => { await this.readCr(true); new Notice(t("crUpdated", String(this.crInfo?.count ?? 0))); },
      hasKey: (p) => { const id = this.settings.ai.keyIds[p]; return !!id && !!this.app.secretStorage.getSecret(id); },
      listModels: (p) => this.listModels(p),
    };
    this.addSettingTab(new SettingsTab(this.app, host, this));
  }

  onunload() {
    for (const f of this.fontFaces) this.fontSet.delete(f); // 登録したフォントを、外す
  }

  // 言語を切り替える: 保存して、開いているノードの画面を、新しい言語で描き直す
  private async changeLanguage(l: Settings["language"]) {
    this.settings.language = l;
    setLang(l);
    await this.saveData(this.settings);
    for (const leaf of this.app.workspace.getLeavesOfType(NODE_EDITOR_VIEW)) if (leaf.view instanceof NodeEditorView) leaf.view.redraw();
  }

  // 自分で置いたフォントの読み込み。登録したものは、外せるように、覚えておく
  private fontFaces: FontFace[] = [];
  private get fontSet(): Set<FontFace> { return document.fonts as unknown as Set<FontFace>; } // FontFaceSet は、add / delete を持つ (型の定義が古い)
  private fullPath(p: string): string { const a = this.app.vault.adapter; return a instanceof FileSystemAdapter ? a.getFullPath(p) : p; } // デスクトップだけ、実際のパスが分かる
  private loadedFonts: Loaded[] = [];
  private async reloadFonts() {
    for (const f of this.fontFaces) this.fontSet.delete(f);
    const r = await loadLocalFonts(this.app.vault.adapter, this.manifest.dir!, (face) => this.fontSet.add(face));
    this.fontFaces = r.faces;
    this.loadedFonts = r.loaded;
    if (r.skipped.length) new Notice(t("fontSkipped", r.skipped.join(", ")), 8000);
    // 登録したフォントを、プレビューに反映する (開いている画面を、描き直す)
    for (const leaf of this.app.workspace.getLeavesOfType(NODE_EDITOR_VIEW)) if (leaf.view instanceof NodeEditorView) leaf.view.redraw();
  }
  // フォルダを、作って、開く (デスクトップだけ)
  private async openFontDir() { await this.openDir(FONT_DIR); }
  private async openDir(name: string) {
    const dir = `${this.manifest.dir}/${name}`;
    if (!(await this.app.vault.adapter.exists(dir))) await this.app.vault.adapter.mkdir(dir);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window as any).require("electron").shell.openPath(this.fullPath(dir));
    } catch { /* モバイルなど: パスを、設定の画面に出してある */ }
  }
  // AI の API への通信。キーは、ヘッダーにだけ載せる (URL・ログには、出さない)
  private http: Http = async (req) => {
    const r = await requestUrl({ url: req.url, method: req.method, headers: req.headers, body: req.body, throw: false });
    let json: unknown = null;
    try { json = r.json; } catch { /* JSON でない答え (HTML のエラーなど) */ }
    return { status: r.status, json };
  };
  // キーは、Obsidian の SecretStorage (キーチェーン) から、使うときだけ取る。設定ファイルには、キーの名前だけ
  private apiKey(p: Provider): string {
    const id = this.settings.ai.keyIds[p];
    const key = id ? this.app.secretStorage.getSecret(id) : null;
    if (!key) throw new Error(t("aiNoKey", p));
    return key;
  }
  private async listModels(p: Provider): Promise<string[]> {
    const res = await this.http(modelsRequest(p, this.apiKey(p)));
    if (res.status !== 200) throw new Error(`HTTP ${res.status} ${errorText(res.json)}`.trim());
    return modelIds(p, res.json);
  }
  // 能力 1 つを、AI に組ませる (設定の AI。検証を通った答えだけを返す)
  private async compose(card: CardData, ability: NodeData, tokens: CardData[]): Promise<ComposeResult> {
    const p = this.settings.ai.provider;
    const tokenNames = tokens.filter((c) => c.token).map((c) => c.name);
    const key = this.apiKey(p); // 無ければ、ここで、設定を促すメッセージで止まる
    try {
      return await composeAbility({
        http: this.http, provider: p, model: this.settings.ai.models[p] || DEFAULT_MODELS[p], key, guide, card, ability, tokenNames,
        hasCard: (name, filter) => tokens.some((c) => c.name === name && (filter !== "token" || !!c.token)),
      });
    } catch (e) {
      throw new Error(t("aiError", (e as Error).message)); // 通信の失敗など (キーは、メッセージに含まれない)
    }
  }
  // 総合ルール (CR) の、ローカルのコピー: <プラグイン>/cr/cr.json = { 規則の番号: 条文 }。Academy Ruins の /cr (全文) を、1 回だけ取って置く。更新は、設定のボタン (自動では、更新しない)
  private cr?: Record<string, string>;
  crInfo?: { count: number; date: string };
  private get crPath() { return `${this.manifest.dir}/cr/cr.json`; }
  private async readCr(refresh = false): Promise<Record<string, string>> {
    const a = this.app.vault.adapter;
    if (!refresh && !this.cr && (await a.exists(this.crPath))) this.cr = JSON.parse(await a.read(this.crPath)) as Record<string, string>;
    if (!refresh && this.cr) return this.cr;
    new Notice(t("crFetching"));
    const res = await requestUrl({ url: "https://api.academyruins.com/cr", headers: { Accept: "application/json" }, throw: false }); // 送るものは、無い (全文を取るだけ)
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const cr: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.json as Record<string, { ruleText?: string }>)) if (typeof v?.ruleText === "string") cr[k] = v.ruleText;
    if (!Object.keys(cr).length) throw new Error("empty CR");
    if (!(await a.exists(`${this.manifest.dir}/cr`))) await a.mkdir(`${this.manifest.dir}/cr`);
    await a.write(this.crPath, JSON.stringify(cr));
    this.cr = cr;
    await this.loadCrInfo();
    return cr;
  }
  private async loadCrInfo() {
    const a = this.app.vault.adapter;
    const st = (await a.exists(this.crPath)) ? await a.stat(this.crPath) : null;
    if (!st) return void (this.crInfo = undefined);
    const d = new Date(st.mtime);
    this.crInfo = { count: Object.keys(this.cr ?? JSON.parse(await a.read(this.crPath))).length, date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` };
  }

  // Ruling report: 組めていない・途中の能力を、AI が公式ルールを確認して点検し、足りないノードを、md の報告書 (Reports/) にする
  private async rulingReport(full = false) {
    try {
      const p = this.settings.ai.provider;
      const key = this.apiKey(p); // 無ければ、設定を促すメッセージで止まる
      const cards = await this.nodeStore().cards();
      const all = collect(cards, (name, filter) => cards.some((c) => c.name === name && (filter !== "token" || !!c.token)));
      const items = all.filter((x) => !x.easy); // キーワードだけの行は、機械で組める (AI に渡さない)
      const easy = all.filter((x) => x.easy);
      if (!items.length) return void new Notice(t("rrNone"));
      new Notice(t("rrStart", String(Math.min(items.length, BATCH))), 8000);
      const model = this.settings.ai.models[p] || DEFAULT_MODELS[p];
      const rules = await this.readCr(); // ローカルの CR (無ければ、ここで 1 回だけ取る)
      const getRule = async (n: string) => ruleWithSubs(rules, n);
      const statePath = `${this.manifest.dir}/cr/ruling-state.json`; // 前回の結果 (変わったものだけを、調べるため)
      const a = this.app.vault.adapter;
      let prev: RulingState | undefined;
      if (!full && (await a.exists(statePath))) { try { prev = JSON.parse(await a.read(statePath)) as RulingState; } catch { /* 読めなければ、全部調べる */ } }
      const result = await rulingAnalysis({ http: this.http, provider: p, model, key, items, prev, getRule });
      if (!result.cut) await a.write(statePath, JSON.stringify({ keys: result.keys, analysis: result.analysis, rules: result.rules } satisfies RulingState)); // 切れたものは、残さない (次は、全部調べ直す)
      const crDate = this.crInfo?.date ?? "";
      const d = new Date();
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      // 報告書は 1 つ (cr/Ruling report.md)。あれば、中身を更新する (消さない。見出しの「updated 日付」が、新しくなる)
      const vault = this.app.vault;
      if (!vault.getAbstractFileByPath(REPORT_DIR)) await vault.createFolder(REPORT_DIR);
      const path = normalizePath(`${REPORT_DIR}/Ruling report.md`);
      const body = reportMd(date, model, cards.length, items, result, crDate, easy);
      const old = vault.getAbstractFileByPath(path);
      const file = old instanceof TFile ? (await vault.modify(old, body), old) : await vault.create(path, body);
      if (result.left) new Notice(t("rrLeft", String(result.left)), 8000);
      new Notice(t("saved", path));
      await this.app.workspace.getLeaf(true).openFile(file);
    } catch (e) {
      new Notice(t("aiError", (e as Error).message), 10000);
    }
  }

  private async openNodeEditor() {
    const open = this.app.workspace.getLeavesOfType(NODE_EDITOR_VIEW)[0];
    if (open) return void this.app.workspace.revealLeaf(open);
    await this.app.workspace.getLeaf(true).setViewState({ type: NODE_EDITOR_VIEW, active: true });
  }

  private nodeStore(): NodeStore {
    const vault = this.app.vault;
    const pathOf = (name: string) => normalizePath(`${CARD_DIR}/${name}.md`);
    const write = async (c: CardData) => {
      if (!vault.getAbstractFileByPath(CARD_DIR)) await vault.createFolder(CARD_DIR);
      const f = vault.getAbstractFileByPath(pathOf(c.name));
      if (f instanceof TFile) await vault.modify(f, toCardMd(c));
      else await vault.create(pathOf(c.name), toCardMd(c));
      new Notice(t("saved", pathOf(c.name)));
    };
    // Scryfall の決まり: User-Agent と Accept を付ける。送るのは、検索したカード名 (と、カードの id) だけ
    const get = async (url: string): Promise<ScryCard[]> => {
      const res = await requestUrl({ url, headers: { "User-Agent": "MagicTheObsidian/0.1", Accept: "application/json" }, throw: false });
      if (res.status === 404) return [];
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      return cardsOf(res.json as ScryCard);
    };
    const readCards = async (): Promise<CardData[]> => {
      const out: CardData[] = [];
      for (const f of vault.getMarkdownFiles().filter((x) => x.path.startsWith(`${CARD_DIR}/`))) {
        try {
          out.push(parseCardMd(await vault.cachedRead(f)));
        } catch (e) {
          new Notice(t("unreadable", f.path, (e as Error).message));
        }
      }
      return out;
    };
    return {
      cards: readCards,
      saveCard: write,
      compose: async (card, ability) => this.compose(card, ability, await readCards()),
      // 絵をローカルに保存して (あれば、取りに行かない)、画面に出せるパスを返す。保存先: プラグインのフォルダの art/ (リポジトリの外。コミットされない)
      art: async (id, url) => {
        if (!isScryfallImage(url)) throw new Error("not a Scryfall image");
        const dir = `${this.manifest.dir}/art`;
        const path = `${dir}/${artFileName(id)}`;
        const a = vault.adapter;
        if (!(await a.exists(path))) {
          if (!(await a.exists(dir))) await a.mkdir(dir);
          const res = await requestUrl({ url, throw: false });
          if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
          await a.writeBinary(path, res.arrayBuffer);
        }
        return a.getResourcePath(path);
      },
      search: async (query) => get(scryfallUrl(query)),
      prints: async (oracleId) => printsFrom({ object: "list", data: await get(printsUrl(oracleId)), id: "", name: "" }), // 1 ページ目 (最大 175 印刷)
      arts: async (id) => { const oid = (await get(`https://api.scryfall.com/cards/${encodeURIComponent(id)}`))[0]?.oracle_id; return oid ? get(printsUrl(oid)) : []; },
      addCard: async (c) => {
        const f = vault.getAbstractFileByPath(pathOf(c.name));
        if (f instanceof TFile) {
          // 保存済み: 能力を守るため、上書きしない。足りない日本語・版違いだけ足す
          const had = parseCardMd(await vault.cachedRead(f));
          const addJa = !had.textJa && c.textJa;
          const addPrints = !had.prints?.length && c.prints?.length;
          const addLoyalty = !had.loyalty && c.loyalty; // 初期の忠誠度 (前に取り込んだカードに、足す)
          if (!addJa && !addPrints && !addLoyalty) return had;
          const merged: CardData = { ...had, ...(addJa ? { nameJa: c.nameJa, typeLineJa: c.typeLineJa, textJa: c.textJa } : {}), ...(addPrints ? { prints: c.prints } : {}), ...(addLoyalty ? { loyalty: c.loyalty } : {}) };
          await write(merged);
          return merged;
        }
        await write(c);
        return c;
      },
    };
  }
}
