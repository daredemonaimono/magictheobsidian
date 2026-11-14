import { App, Notice, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import { DEFAULT_MODELS, PROVIDERS, Provider } from "./ai/providers";
import { Loaded } from "./fonts";
import { Lang, asLang, defaultLang, t } from "./i18n";

// AI の設定。**API キーの値は、ここに持たない**: Obsidian の SecretStorage (キーチェーン) に置き、設定には、その名前 (keyIds) だけを残す。
export interface AiSettings {
  provider: Provider; // 能力を組ませる AI
  models: Record<Provider, string>;
  keyIds: Record<Provider, string>; // SecretStorage の、キーの名前 (空 = 未設定)
}
export interface Settings {
  language: Lang;
  ai: AiSettings;
}

const asProvider = (v: unknown): Provider => (PROVIDERS.some((p) => p.id === v) ? (v as Provider) : "claude");
const str = (v: unknown, d: string): string => (typeof v === "string" ? v : d);

export function loadSettings(d: unknown): Settings {
  const r = (d ?? {}) as { language?: unknown; ai?: { provider?: unknown; models?: Record<string, unknown>; keyIds?: Record<string, unknown> } };
  const pick = (m: Record<string, unknown> | undefined, f: (p: Provider) => string): Record<Provider, string> => ({ claude: str(m?.claude, f("claude")), openai: str(m?.openai, f("openai")), gemini: str(m?.gemini, f("gemini")) });
  return {
    language: asLang(r.language) ?? defaultLang(),
    ai: { provider: asProvider(r.ai?.provider), models: pick(r.ai?.models, (p) => DEFAULT_MODELS[p]), keyIds: pick(r.ai?.keyIds, () => "") },
  };
}

// 設定の画面が、プラグイン本体に頼むこと
export interface SettingsHost {
  settings(): Settings;
  save(): Promise<void>;
  changeLanguage(l: Lang): Promise<void>;
  fonts(): { dir: string; loaded: Loaded[] }; // 自分で置いたフォントのフォルダと、読み込めたもの
  openFontDir(): Promise<void>;
  reloadFonts(): Promise<void>;
  hasKey(p: Provider): boolean; // キーが、キーチェーンに入っているか
  listModels(p: Provider): Promise<string[]>; // キーを使って、モデルの一覧を取る
}

// 設定の画面: 「一般」「API」「対戦」のタブ。API (キー・モデル) は、対戦から分けてある (対戦には、使う AI の選択だけ)
export class SettingsTab extends PluginSettingTab {
  private tab: "general" | "api" | "battle" = "general";
  private models: Partial<Record<Provider, string[]>> = {}; // 取得したモデルの一覧
  private busy = new Set<Provider>(); // 取得中
  private failed = new Set<Provider>(); // 取得に失敗した (キーを変えるまで、自動では、取り直さない)
  constructor(app: App, private host: SettingsHost, plugin: ConstructorParameters<typeof PluginSettingTab>[1]) {
    super(app, plugin);
  }
  display() {
    const el = this.containerEl;
    el.empty();
    const bar = el.createDiv("mtg-set-tabs");
    for (const [id, text] of [["general", t("settingsGeneral")], ["api", t("settingsApi")], ["battle", t("settingsBattle")]] as const) {
      const b = bar.createEl("button", { text, cls: "mtg-set-tab" });
      b.toggleClass("is-on", this.tab === id);
      b.onclick = () => { this.tab = id; this.display(); };
    }
    if (this.tab === "general") this.general(el);
    else if (this.tab === "api") this.api(el);
    else this.battle(el);
  }

  private general(el: HTMLElement) {
    this.fontSection = this.fontSection.bind(this);
    new Setting(el).setName(t("settingsGeneral")).setHeading();
    new Setting(el)
      .setName(t("language"))
      .setDesc(t("languageDesc"))
      .addDropdown((d) =>
        d.addOption("en", "English").addOption("ja", "日本語").setValue(this.host.settings().language).onChange(async (v) => {
          await this.host.changeLanguage(v === "ja" ? "ja" : "en");
          this.display(); // 設定の画面も、新しい言語で描き直す
        }),
      );
    this.fontSection(el);
  }

  // 対戦: AI にノードを組ませる設定。使う AI だけ (キー・モデルは、「API」タブ)
  // フォント: 同梱できないフォント (Beleren など) を、自分で置いて、読み込む。ダウンロードは、しない
  private fontSection(el: HTMLElement) {
    const f = this.host.fonts();
    new Setting(el).setName(t("fontHeading")).setDesc(t("fontDesc")).setHeading();
    new Setting(el)
      .setName(t("fontDir"))
      .setDesc(f.dir)
      .addButton((b) => b.setButtonText(t("fontOpen")).onClick(async () => { await this.host.openFontDir(); this.display(); }))
      .addButton((b) => b.setButtonText(t("fontReload")).onClick(async () => { await this.host.reloadFonts(); this.display(); }));
    new Setting(el).setName(t("fontLoaded")).setDesc(f.loaded.length ? f.loaded.map((x) => `${x.file} → ${x.families.join(" / ")}`).join("\n") : t("fontNone"));
  }

  private battle(el: HTMLElement) {
    const s = this.host.settings().ai;
    new Setting(el).setName(t("aiHeading")).setDesc(t("aiHeadingDesc")).setHeading();
    new Setting(el)
      .setName(t("aiProvider"))
      .setDesc(t("aiProviderDesc"))
      .addDropdown((d) => {
        for (const p of PROVIDERS) d.addOption(p.id, p.name);
        d.setValue(s.provider).onChange(async (v) => { s.provider = asProvider(v); await this.host.save(); });
      });
  }

  // API: AI ごとの、API キー (Obsidian の SecretStorage) とモデル
  private api(el: HTMLElement) {
    const s = this.host.settings().ai;
    new Setting(el).setName(t("settingsApi")).setDesc(t("apiDesc")).setHeading();
    for (const p of PROVIDERS) {
      new Setting(el).setName(p.name).setHeading();
      // API キー: Obsidian の SecretStorage (キーチェーン)。ここには、キーの名前だけが残り、値は、設定ファイルに書かれない
      new Setting(el)
        .setName(t("aiKey", p.name))
        .setDesc(t("aiKeyDesc"))
        .addComponent((c) =>
          new SecretComponent(this.app, c).setValue(s.keyIds[p.id]).onChange(async (v) => {
            s.keyIds[p.id] = v ?? "";
            await this.host.save();
            delete this.models[p.id]; // キーが変わったので、モデルを取り直す
            this.failed.delete(p.id);
            this.display();
          }),
        );
      // モデル: キーを入れたら、その AI の API から一覧を取って、選べるようにする (文字では、入れない)
      const list = this.models[p.id];
      const model = new Setting(el).setName(t("aiModel"));
      const keyed = this.host.hasKey(p.id);
      model.setDesc(!keyed ? t("aiModelNoKey") : this.busy.has(p.id) ? t("aiModelLoading") : this.failed.has(p.id) ? t("aiModelFailed") : "");
      model.addDropdown((d) => {
        const ids = list?.length ? (list.includes(s.models[p.id]) ? list : [s.models[p.id], ...list]) : [s.models[p.id]];
        for (const id of ids) d.addOption(id, id);
        d.setValue(s.models[p.id]).setDisabled(!list?.length).onChange(async (v) => { s.models[p.id] = v; await this.host.save(); });
      });
      model.addButton((b) => b.setButtonText(t("aiFetch")).setDisabled(!keyed || this.busy.has(p.id)).onClick(() => { this.failed.delete(p.id); void this.load(p.id); }));
      if (keyed && !list && !this.busy.has(p.id) && !this.failed.has(p.id)) void this.load(p.id); // キーがあれば、開いたときに、自動で取る
    }
  }

  // モデルの一覧を取る。取れたら、保存してあるモデルが一覧に無いとき (初期値の仮の名前など) は、一覧の先頭にする
  private async load(p: Provider) {
    this.busy.add(p);
    this.display();
    try {
      const ids = await this.host.listModels(p);
      this.models[p] = ids;
      const s = this.host.settings().ai;
      if (ids.length && !ids.includes(s.models[p])) { s.models[p] = ids[0]; await this.host.save(); }
      new Notice(t("aiFetched", ids.length));
    } catch (e) {
      this.failed.add(p);
      new Notice(t("aiError", (e as Error).message));
    }
    this.busy.delete(p);
    this.display();
  }
}
