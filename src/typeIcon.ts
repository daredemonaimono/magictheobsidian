import { setIcon } from "obsidian";
import { TYPE_SVGS } from "./typeIconSvgs";
import { GROUP_ICONS } from "./layout";

// カードタイプのアイコン。Mana フォントのもの (プレインズウォーカー・クリーチャー・ソーサリー・インスタント・アーティファクト・エンチャント・土地・トークン) は、埋め込んだ SVG。
// ないもの (コマンダー・バトル・その他) は、Obsidian 標準のアイコン。名前は、カーソルを合わせたときに出す
const KEY: Record<string, string> = { Planeswalker: "planeswalker", Creature: "creature", Sorcery: "sorcery", Instant: "instant", Artifact: "artifact", Enchantment: "enchantment", Land: "land", Token: "token" };

export function typeIcon(parent: HTMLElement, group: string): HTMLElement {
  const el = parent.createSpan({ cls: "mtg-typeicon", attr: { "aria-label": GROUP_ICONS[group]?.ja ?? group, title: GROUP_ICONS[group]?.ja ?? group } });
  const svg = KEY[group] && TYPE_SVGS[KEY[group]];
  if (svg) {
    const node = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement; // 自分で埋め込んだ文字列だけを読む
    el.appendChild(document.importNode(node, true));
  } else if (GROUP_ICONS[group]) setIcon(el, GROUP_ICONS[group].icon);
  else el.setText(group);
  return el;
}
