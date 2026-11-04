// 両面・複数の面があるカード (名前が "A // B") を、裏返して見る。画像は Scryfall の裏面の画像、裏面の画像が無いカード (冒険・準備など) は、裏面のテキストを出す

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

// ↩︎ ボタン: 押すたびに、表と裏を切り替える。img を裏面の画像にし、読み込めなければ (裏面の画像が無いカード) 裏面のテキストを img の代わりに出す。onFlip は、プレビューなどを合わせる用
export function addFlip(ctl: HTMLElement, host: HTMLElement, img: HTMLImageElement | undefined, backText: () => Promise<string>, onFlip?: (back: boolean, text: string, imageSrc: string | undefined) => void): void {
  const btn = ctl.createEl("button", { text: "↩︎", attr: { "aria-label": "裏面を見る / 表に戻す" } });
  let back = false;
  let front: string | null = null;
  let panel: HTMLElement | undefined;
  const show = async (imageSrc?: string) => onFlip?.(back, back ? await backText() : "", imageSrc);
  btn.onclick = async (e) => {
    e.stopPropagation();
    back = !back;
    btn.toggleClass("is-on", back);
    panel?.remove();
    panel = undefined;
    if (!img) return void (await show());
    front ??= img.getAttribute("src");
    img.style.display = "";
    if (!back) {
      if (front) img.setAttribute("src", front);
      return void (await show(front ?? undefined));
    }
    if (!front) return;
    img.onerror = async () => {
      img.onerror = null;
      if (!back) return;
      img.style.display = "none";
      panel = host.createDiv({ cls: "mtg-backtext", text: await backText() });
      void show();
    };
    img.onload = () => void show(img.getAttribute("src") ?? undefined);
    img.setAttribute("src", backUrl(front));
  };
}
