import { Notice, Plugin, TFile, normalizePath, requestUrl } from "obsidian";
import { setLang, t } from "./i18n";
import { NODE_EDITOR_VIEW, NodeEditorView, NodeStore } from "./NodeEditorView";
import { CardData, parseCardMd, toCardMd } from "./node/card";
import { ScryCard, artFileName, cardsOf, isScryfallImage, printsFrom, printsUrl, scryfallUrl } from "./node/scryfall";
import { Settings, SettingsTab, loadSettings } from "./settings";

const CARD_DIR = "Cards"; // カード = Cards/<カード名>.md (能力のノードが、コードブロックで入る。ノードの置き場は、ここだけ)

export default class MagicTheObsidian extends Plugin {
  settings!: Settings;

  async onload() {
    this.settings = loadSettings(await this.loadData());
    setLang(this.settings.language);
    this.registerView(NODE_EDITOR_VIEW, (leaf) => new NodeEditorView(leaf, this.nodeStore()));
    this.addCommand({ id: "node-editor", name: "Node: open the node editor", callback: () => void this.openNodeEditor() });
    this.addRibbonIcon("blocks", t("ribbon"), () => void this.openNodeEditor());
    this.addSettingTab(new SettingsTab(this.app, () => this.settings.language, (l) => this.changeLanguage(l), this));
  }

  // 言語を切り替える: 保存して、開いているノードの画面を、新しい言語で描き直す
  private async changeLanguage(l: Settings["language"]) {
    this.settings.language = l;
    setLang(l);
    await this.saveData(this.settings);
    for (const leaf of this.app.workspace.getLeavesOfType(NODE_EDITOR_VIEW)) if (leaf.view instanceof NodeEditorView) leaf.view.redraw();
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
    return {
      cards: async () => {
        const out: CardData[] = [];
        for (const f of vault.getMarkdownFiles().filter((x) => x.path.startsWith(`${CARD_DIR}/`))) {
          try {
            out.push(parseCardMd(await vault.cachedRead(f)));
          } catch (e) {
            new Notice(t("unreadable", f.path, (e as Error).message));
          }
        }
        return out;
      },
      saveCard: write,
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
      addCard: async (c) => {
        const f = vault.getAbstractFileByPath(pathOf(c.name));
        if (f instanceof TFile) {
          // 保存済み: 能力を守るため、上書きしない。足りない日本語・版違いだけ足す
          const had = parseCardMd(await vault.cachedRead(f));
          const addJa = !had.textJa && c.textJa;
          const addPrints = !had.prints?.length && c.prints?.length;
          if (!addJa && !addPrints) return had;
          const merged: CardData = { ...had, ...(addJa ? { nameJa: c.nameJa, typeLineJa: c.typeLineJa, textJa: c.textJa } : {}), ...(addPrints ? { prints: c.prints } : {}) };
          await write(merged);
          return merged;
        }
        await write(c);
        return c;
      },
    };
  }
}
