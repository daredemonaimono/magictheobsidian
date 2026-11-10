// 台座の SVG (影・床・札・光の縁・飾り)。ターンの色は、CSS 変数 --ag (台座の箱に付いている) で変わる。JS は、色の更新に要らない。
// 飾り: 標準は、ここで描く、金属の皿 (鋼の台・銅の輪・反った金と灰の帯)。じゅまが、ダッシュボードでアップロードした画像 (artUrl。輪の穴が透明で、穴の中心が、画像の中心) があれば、それに差し替える。
// 単位は、台座の輪の直径 D = 1。viewBox は箱の中心が原点 (左右に 1 つ分ずつ、上下に 0.4 ずつはみ出す。styles.css の .mtg-bt-avatar > svg と同じ)。y は下が正。
// hasImg = 絵が載る台座 (絵は HTML で、この SVG の上に重なる)。false = 空の台座 (光の縁・床の光・左の札の光)。
const CY = 0.2; // 輪の穴の中心の高さ
const RY = 0.75; // 皿の縦の縮み (見下ろす角度 約 50 度)
const ART_W = 1.26; // アップロードした飾りの幅 (穴の幅 0.9 に対して)
const HOLE_RX = 0.45, HOLE_RY = 0.28; // 穴の楕円 (アップロードした飾りの、穴の大きさの見込み)

let uid = 0; // 台座ごとに、gradient の id を分ける (同じ id だと、2 つ目が 1 つ目の色 (--ag) を使ってしまう)

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function pedestalSvg(hasImg: boolean, artUrl?: string): string {
  const id = `pd${uid++}-`;
  const el = (rx: number, dy = 0) => `cx="0" cy="${(CY + dy).toFixed(3)}" rx="${rx}" ry="${(rx * RY).toFixed(3)}"`;
  const crescent = (x: number, y0: number, c0: number, c1: number, fill: string) =>
    `<path d="M${-x} ${(CY + y0).toFixed(3)} Q0 ${(CY + c0).toFixed(3)} ${x} ${(CY + y0).toFixed(3)} Q0 ${(CY + c1).toFixed(3)} ${-x} ${(CY + y0).toFixed(3)} Z" fill="url(#${fill})" stroke="#000" stroke-opacity=".5" stroke-width=".004"/>`;
  const tab = (s: 1 | -1, lit: boolean) => `<g transform="translate(${s * 0.8} ${CY - 0.06})">`
    + `<rect x="-.085" y="0" width=".17" height=".085" rx=".012" fill="url(#pd-dark)" stroke="#000" stroke-opacity=".6" stroke-width=".004"/>`
    + (lit ? `<rect x="-.032" y=".018" width=".064" height=".05" rx=".006" style="fill:var(--ag)"/><rect x="-.032" y=".018" width=".064" height=".05" rx=".006" fill="#fff" fill-opacity=".35"/>` : "")
    + `</g>`;
  const rim = (rx: number, ry: number, k: number) => hasImg ? "" : `<ellipse cx="0" cy="${CY}" rx="${rx - k}" ry="${(ry - k * 0.6).toFixed(3)}" fill="none" style="stroke:var(--ag)" stroke-width=".014"/>`
    + `<ellipse cx="0" cy="${CY}" rx="${rx - k - 0.01}" ry="${(ry - k * 0.6 - 0.008).toFixed(3)}" style="fill:var(--ag)" fill-opacity=".14"/>`;

  // 標準の皿 (自作)
  const ring = hasImg
    ? `<ellipse ${el(0.47)} fill="none" stroke="url(#pd-copper)" stroke-width=".085"/>`
    : `<ellipse ${el(0.47)} fill="none" stroke="url(#pd-gun)" stroke-width=".085"/>`;
  const wings = crescent(0.84, 0.06, 1.1, 0.86, "pd-grey") + crescent(0.9, 0.0, 0.88, 0.56, "pd-gold")
    + `<path d="M-.9 ${CY.toFixed(3)} Q0 ${(CY + 0.88).toFixed(3)} .9 ${CY.toFixed(3)}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".006"/>`;
  const dish = `<path d="M-.58 ${CY} A.58 ${(0.58 * RY).toFixed(3)} 0 0 0 .58 ${CY} L.58 ${CY + 0.09} A.58 ${(0.58 * RY).toFixed(3)} 0 0 1 -.58 ${CY + 0.09} Z" fill="url(#pd-side)"/>`
    + `<ellipse ${el(0.58)} fill="url(#pd-steel)"/>`
    + `<ellipse ${el(0.545)} fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".008"/>`
    + `<ellipse ${el(0.44)} fill="url(#pd-floor)"/>` + rim(0.47, 0.47 * RY, 0.045) + ring + wings
    + `<ellipse ${el(0.495)} fill="none" stroke="#000" stroke-opacity=".35" stroke-width=".006"/>`;
  // アップロードした飾り: 穴の床と光の縁を、飾りの下に敷く
  const art = `<ellipse cx="0" cy="${CY}" rx="${HOLE_RX + 0.02}" ry="${HOLE_RY + 0.02}" fill="url(#pd-floor)"/>` + rim(HOLE_RX, HOLE_RY, 0.02)
    + `<image href="${esc(artUrl ?? "")}" x="${-ART_W / 2}" y="${(CY - ART_W / 2).toFixed(3)}" width="${ART_W}" height="${ART_W}" preserveAspectRatio="xMidYMid meet"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.5 -0.9 3 1.8" preserveAspectRatio="none" overflow="visible">
<defs>
<linearGradient id="pd-steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4d8dc"/><stop offset=".45" stop-color="#8f959b"/><stop offset="1" stop-color="#4a4e54"/></linearGradient>
<linearGradient id="pd-side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2c2f33"/><stop offset=".3" stop-color="#9aa0a6"/><stop offset=".55" stop-color="#d0d4d8"/><stop offset=".8" stop-color="#6c7177"/><stop offset="1" stop-color="#25282c"/></linearGradient>
<linearGradient id="pd-copper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4dca0"/><stop offset=".3" stop-color="#c99a48"/><stop offset=".7" stop-color="#7c5522"/><stop offset="1" stop-color="#d6a75a"/></linearGradient>
<linearGradient id="pd-gun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c8188"/><stop offset=".4" stop-color="#3b3e43"/><stop offset="1" stop-color="#17181a"/></linearGradient>
<linearGradient id="pd-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6e0a8"/><stop offset=".5" stop-color="#c99a48"/><stop offset="1" stop-color="#8a6128"/></linearGradient>
<linearGradient id="pd-grey" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c3c7cb"/><stop offset="1" stop-color="#6b7076"/></linearGradient>
<linearGradient id="pd-dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34363a"/><stop offset="1" stop-color="#0e0e10"/></linearGradient>
<radialGradient id="pd-floor" cx=".5" cy=".3" r=".75"><stop offset="0" stop-color="#26272a"/><stop offset="1" stop-color="#0b0b0c"/></radialGradient>
<filter id="pd-blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation=".03"/></filter>
</defs>
<ellipse ${el(0.6, 0.1)} fill="#000" fill-opacity=".45" filter="url(#pd-blur)"/>
${hasImg ? "" : tab(-1, true) + tab(1, false)}
${artUrl ? art : dish}
</svg>`.split("pd-").join(id);
}
