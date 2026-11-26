/*
 * ブラウザごとの「未対応」の表（e2e 専用）。
 *
 * e2e は Chromium・Firefox（Gecko）・WebKit の 3 つで回す（playwright.config.ts）。ここに載っている検査は、
 * 載っているブラウザでだけ fixme（走らせない）になる。Chromium では今までどおり走る。
 * 表を読んで飛ばすのは _fixtures.ts の自動 fixture。**直したら、この表から行を消す**（検査のファイルは触らない）。
 *
 * 載せた経緯：2026-11-26 に既存の 253 件を Firefox と WebKit で初めて回し、落ちたものをそのまま載せた。
 * **原因は 1 件ずつ確かめていない**。reason の「見立て」は未確認で、サイトの挙動がブラウザで違う（＝直すべき不具合）のか、
 * 検査の書き方が Chromium 前提なだけなのかは、調べてから決める。一覧と経緯は plans/2026-11-26-e2e-firefox-webkit.md。
 *
 * 行の読み方：file は spec のファイル名、title は検査名に含まれる文字列（か正規表現）。同じ文字列を含む検査が
 * 複数あれば全部に当たる（縦書き・横書きで回している検査など）。
 *
 * IF:
 *   BROWSER_GAPS … 表そのもの
 *   findBrowserGap(file, title, browser) … 当たる行があれば返す。無ければ undefined
 * 依存: なし（Playwright にも依存しない＝表の中身だけを単体で確かめられる）
 */

export type GapBrowser = 'firefox' | 'webkit';

export interface BrowserGap {
    file: string;
    title: string | RegExp;
    browsers: GapBrowser[];
    reason: string;
}

const BOTH: GapBrowser[] = ['firefox', 'webkit'];

export const BROWSER_GAPS: BrowserGap[] = [
    // ── Firefox と WebKit の両方 ──
    {
        file: 'toc-page.spec.ts', title: '背景の上でホイールを回しても裏のページが動かない', browsers: BOTH,
        reason: '裏のページが 600px 動く。サイトの挙動の差の見込み：v4.2.3 の裏のスクロール止め（dialog::backdrop の overflow・overscroll-behavior）が Chromium でしか効いていない',
    },
    {
        file: 'opening.spec.ts', title: 'E12 Tab は', browsers: BOTH,
        reason: 'Tab の停止先の並びが違う。見立て：Firefox はスクロールできる器にも Tab が止まり、Safari は既定で Tab がリンクとボタンに止まらない。縦書きの WebKit では #btn-next が画面に映らない（別の原因かもしれない）',
    },
    {
        file: 'opening.spec.ts', title: 'E14 「読み進める」を Enter で押すと', browsers: BOTH,
        reason: '次の Tab で #btn-next にフォーカスが来ない。E12 と同じ見立て',
    },
    {
        file: 'settings-reset.spec.ts', title: '目次でリセットした読書点は本文ページで既定 45% に解決される', browsers: BOTH,
        reason: '読書点の値が空文字で返る（期待は "45%"）。未調査',
    },
    {
        file: 'writing-mode.spec.ts', title: '二重引用符は横書きで', browsers: BOTH,
        reason: '検査の中で「本文の段落が無い」になる。検査の書き方の見込み（未調査）',
    },

    // ── Firefox だけ ──
    {
        file: 'afterword-records.spec.ts', title: 'C7 あとがきでリロードすると', browsers: ['firefox'],
        reason: 'リロード後の位置が 0（期待は 0.5）。サイトの挙動の差かもしれない（位置の復元）。検査のスクロールのさせ方の差かもしれない',
    },
    {
        file: 'record-hold.spec.ts', title: 'D14 保留中でも栞の追加と位置の復元は動く', browsers: ['firefox'],
        reason: 'リロード後の位置が 0（期待は 0.5）。C7 と同じ見立て',
    },
    {
        file: 'resume.spec.ts', title: 'A14 読み返し中のリロード', browsers: ['firefox'],
        reason: 'リロード後の位置が 0（期待は 0.5）。C7 と同じ見立て',
    },
    {
        file: 'record-hold.spec.ts', title: 'D13 新たに保留を付けるのは通常の遷移だけ', browsers: ['firefox'],
        reason: 'リロードしただけで札が出る。サイトの挙動の差かもしれない（リロードの判定）',
    },
    {
        file: 'record-hold.spec.ts', title: 'D18 札は押せる範囲が札だけ', browsers: ['firefox'],
        reason: 'ホイールで本文が進まない（進み 0）。検査のホイールの送り方の見込み',
    },

    // ── WebKit だけ ──
    {
        file: 'afterword-records.spec.ts', title: 'C3/C4/C5 巻末を読了', browsers: ['webkit'],
        reason: '#btn-afterword が画面に映らない。サイトの挙動の差かもしれない（縦書きのスクロール位置の扱い）',
    },
    {
        file: 'resume.spec.ts', title: /A3\/A15 読了して閉じた.*（vertical）/, browsers: ['webkit'],
        reason: '縦書きで #btn-next が画面に映らない。C3/C4/C5 と同じ見立て',
    },
    {
        file: 'characters-popup.spec.ts', title: '3 つのタイルが見え', browsers: ['webkit'],
        reason: '絵の naturalWidth が 0。見立て：Windows 版の WebKit が AVIF を読めない（本物の Safari は読める）',
    },
    {
        file: 'characters-popup.spec.ts', title: '本文ページ：右下メニューのキャラクター紹介が開き', browsers: ['webkit'],
        reason: '人物の絵の naturalWidth が 0。上と同じ見立て',
    },
    {
        file: 'bg-priority.spec.ts', title: '本文ページ：いまの場面の近くの背景は既定の優先度', browsers: ['webkit'],
        reason: '背景の取得の優先度の条件が満たされない。未調査（WebKit の fetchpriority の対応か、AVIF か）',
    },
    {
        file: 'glossary.spec.ts', title: '直リンク #g-見出し語 で開くとその項目へ着地する', browsers: ['webkit'],
        reason: '着地先の要素が見つからない。未調査',
    },
];

/**
 * 表から、この検査・このブラウザに当たる行を探す。
 * @param file    spec のファイル名（パスでもよい。末尾のファイル名で比べる）
 * @param title   検査名（describe を含まない、test() に渡した名前）
 * @param browser Playwright の browserName（'chromium' | 'firefox' | 'webkit'）
 * @returns 当たる行。Chromium と、表に無い検査は undefined
 */
export function findBrowserGap(file: string, title: string, browser: string): BrowserGap | undefined {
    const name = file.replace(/\\/g, '/').split('/').pop() ?? file;
    return BROWSER_GAPS.find(g =>
        g.file === name
        && (g.browsers as string[]).includes(browser)
        && (typeof g.title === 'string' ? title.includes(g.title) : g.title.test(title)));
}
