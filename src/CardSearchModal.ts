import { App, Modal } from "obsidian";
import { Label, pick, t } from "./i18n";
import { CARD_TYPES } from "./node/cardtypes";
import { COLORS, ScryCard, buildQuery, thumbOf } from "./node/scryfall";

// タイプの絞り込み (Scryfall の t: に渡す英語)。土地は、唱えないので、cardtypes.ts には無いが、探せる
const TYPES: { id: string; label: Label }[] = [...CARD_TYPES.map((x) => ({ id: x.id, label: x.label })), { id: "land", label: { ja: "土地", en: "Land" } }];

// 新規カード: Scryfall を、名前・色 (アイコン)・タイプ (選択) で探し、カードの絵を見て選ぶ。選んだカードは、onPick で、Cards/ に保存される
export class CardSearchModal extends Modal {
  constructor(app: App, private search: (q: string) => Promise<ScryCard[]>, private onPick: (c: ScryCard) => Promise<void>) {
    super(app);
  }
  onOpen() {
    this.titleEl.setText(t("modalTitle"));
    const row = this.contentEl.createDiv("mtg-cs-row");
    const input = row.createEl("input", { type: "text", cls: "mtg-cs-input" });
    input.placeholder = t("importPh");
    const btn = row.createEl("button", { text: t("importBtn"), cls: "mod-cta" });
    // 絞り込み: 色 (アイコンを押して、入り切り。選んだ色をすべて含む) と、タイプ
    const filters = this.contentEl.createDiv("mtg-cs-row");
    const colors = new Set<string>();
    for (const c of COLORS) {
      const b = filters.createEl("button", { cls: "mtg-cs-color", attr: { "aria-label": c } });
      b.createEl("img", { attr: { src: `https://svgs.scryfall.io/card-symbols/${c}.svg`, alt: c } });
      b.onclick = () => { b.toggleClass("is-on", !colors.has(c)); if (colors.has(c)) colors.delete(c); else colors.add(c); };
    }
    const type = filters.createEl("select");
    type.createEl("option", { text: `${t("cardType")}: ${t("none")}`, value: "" });
    for (const ty of TYPES) type.createEl("option", { text: pick(ty.label), value: ty.id });
    const out = this.contentEl.createDiv("mtg-cs-grid");
    const go = async () => {
      const q = buildQuery(input.value, { colors: COLORS.filter((c) => colors.has(c)), type: type.value });
      if (!q) return;
      btn.disabled = true;
      out.empty();
      try {
        const found = (await this.search(q)).slice(0, 30);
        if (!found.length) out.createDiv({ text: t("importNotFound"), cls: "mtg-ne-dim" });
        for (const c of found) {
          const cell = out.createDiv("mtg-cs-card");
          const img = thumbOf(c);
          if (img) cell.createEl("img", { attr: { src: img, alt: c.printed_name ?? c.name } });
          else cell.createDiv({ text: c.printed_name ?? c.name });
          cell.onclick = async () => { await this.onPick(c); this.close(); };
        }
      } catch (e) {
        out.createDiv({ text: t("importFail", (e as Error).message), cls: "mtg-ne-problem" });
      }
      btn.disabled = false;
    };
    btn.onclick = go;
    input.onkeydown = (e) => { if (e.key === "Enter") void go(); };
    input.focus();
  }
  onClose() {
    this.contentEl.empty();
  }
}
