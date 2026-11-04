// 両面カード (変身・表裏) を、裏返して見る。裏面の画像は、表の画像と同じく、取得したときにノートに書く。冒険・準備などは、1枚の画像に裏面も載っているので、書かず、ボタンも出さない

export const isMultiFace = (name?: string): boolean => !!name?.includes(" // ");

// 裏面の画像の URL (表と同じ id で、front が back になる)。裏面の画像が無いカードは、読み込みに失敗する
export const backUrl = (url: string): string => url.replace("/front/", "/back/");

const faces = (text: string): string[] => text.split(/\n---\n/).map((f) => f.trim()).filter(Boolean);

// カードのノートの、裏面のテキスト。設定言語の節 (## Text (ja)) に裏面があればそれ、無ければ英語の本文の裏面。1面だけのカードは undefined
export function backFaceText(note: string): string | undefined {
  const local = note.match(/\n## Text \([^)]+\)\n\n([\s\S]*?)(?=\n\[Scryfall\])/)?.[1];
  const english = note
    .replace(/^---[\s\S]*?\n---\n/, "")
    .replace(/!\[\]\(.*?\)\n*/, "")
    .split("\n[Scryfall]")[0]
    .split("\n## Text (")[0];
  return (local ? faces(local)[1] : undefined) ?? faces(english)[1];
}

// ノートに書いてある裏面の画像 (![back](URL))。裏面の画像が無いカードは undefined
export const backImageOf = (note: string): string | undefined => note.match(/!\[back\]\((.+?)\)/)?.[1];

// ↩︎ ボタン: 裏面の画像があるカードにだけ付く。押すたびに、img を表と裏で切り替える。onFlip は、プレビューなどを合わせる用 (back = 裏にしたとき、src = いまの画像)
// front = 表の画像、back = 裏面の画像 (どちらも、ノートから読んだもの。版を選んでいれば、その版の表を渡して backUrl で合わせる)
export function addFlip(ctl: HTMLElement, img: HTMLImageElement | undefined, front: string | undefined, back: string | undefined, onFlip?: (back: boolean, src: string) => void): void {
  if (!img || !front || !back) return;
  const btn = ctl.createEl("button", { text: "↩︎", attr: { "aria-label": "裏面を見る / 表に戻す" } });
  let flipped = false;
  btn.onclick = (e) => {
    e.stopPropagation();
    flipped = !flipped;
    btn.toggleClass("is-on", flipped);
    const src = flipped ? back : front;
    img.setAttribute("src", src);
    onFlip?.(flipped, src);
  };
}
