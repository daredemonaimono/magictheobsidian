import { App, PluginSettingTab, Setting } from "obsidian";
import { Lang, asLang, defaultLang, t } from "./i18n";

export interface Settings {
  language: Lang;
}
export const loadSettings = (d: unknown): Settings => ({ language: asLang((d as { language?: unknown } | null)?.language) ?? defaultLang() });

// 設定の画面: 一般
export class SettingsTab extends PluginSettingTab {
  constructor(app: App, private getLang: () => Lang, private onLang: (l: Lang) => Promise<void>, plugin: ConstructorParameters<typeof PluginSettingTab>[1]) {
    super(app, plugin);
  }
  display() {
    const el = this.containerEl;
    el.empty();
    new Setting(el).setName(t("settingsGeneral")).setHeading();
    new Setting(el)
      .setName(t("language"))
      .setDesc(t("languageDesc"))
      .addDropdown((d) =>
        d
          .addOption("en", "English")
          .addOption("ja", "日本語")
          .setValue(this.getLang())
          .onChange(async (v) => {
            await this.onLang(v === "ja" ? "ja" : "en");
            this.display(); // 設定の画面も、新しい言語で描き直す
          }),
      );
  }
}
