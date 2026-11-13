import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import { setLang, t } from "./i18n";
import { NODE_EDITOR_VIEW, NodeEditorView, NodeStore } from "./NodeEditorView";
import { NodeData, parseMd, toMd } from "./node/md";
import { Settings, SettingsTab, loadSettings } from "./settings";

const NODE_DIR = "Nodes"; // ノード = Nodes/<名前>.md (1 ノード 1 ノート)

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
    const files = () => this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${NODE_DIR}/`));
    return {
      all: async () => {
        const out: NodeData[] = [];
        for (const f of files()) {
          try {
            out.push(parseMd(await this.app.vault.cachedRead(f)));
          } catch (e) {
            new Notice(t("unreadable", f.path, (e as Error).message));
          }
        }
        return out;
      },
      save: async (n) => {
        if (!this.app.vault.getAbstractFileByPath(NODE_DIR)) await this.app.vault.createFolder(NODE_DIR);
        const path = normalizePath(`${NODE_DIR}/${n.name}.md`);
        const f = this.app.vault.getAbstractFileByPath(path);
        if (f instanceof TFile) await this.app.vault.modify(f, toMd(n));
        else await this.app.vault.create(path, toMd(n));
        new Notice(t("saved", path));
      },
    };
  }
}
