/*
 * ブラウザごとの「未対応」の表（e2e 専用）。
 *
 * e2e は Chromium・Firefox（Gecko）・WebKit の 3 つで回す（playwright.config.ts）。ここに載っている検査は、
 * 載っているブラウザでだけ「落ちるはず」（fail）になる＝検査は走り、落ちれば通過の扱い、**通ると赤になる**。
 * Chromium では今までどおり走る。表を読んで印を付けるのは _fixtures.ts の自動 fixture。**直したら、この表から行を消す**。
 *
 * 載せた経緯：2026-11-26 に既存の 253 件を Firefox と WebKit で初めて回し、落ちた 27 件をそのまま載せた。
 * 2026-11-27 に 1 件ずつ原因を確かめ（Playwright の 3 ブラウザで。本物の Firefox・Safari ではほぼ確かめていない）、
 * 検査の書き方で直せるものは直して表から消した。サイトの不具合 1 つ（開幕の Enter のあとの Tab）は直し、末尾の着地の
 * 受け入れ条件は作者の判断で検査の側を改めた。**いま残っているのは、検査でもサイトでも直さないと決めたもの**
 * （Playwright の Firefox だけの差、Safari の既知の未対応＝作者が「今のまま」と決めた）。一覧と経緯は plans/2026-11-26-e2e-firefox-webkit.md。
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

export const BROWSER_GAPS: BrowserGap[] = [
    // ── Firefox だけ ──
    {
        file: 'toc-page.spec.ts', title: '背景の上でホイールを回しても裏のページが動かない', browsers: ['firefox'],
        reason: 'Playwright の Firefox だけの差。mouse.wheel は合成のイベント（windowUtils.sendWheelEvent）で、Firefox 150 の'
            + '「スクロールしない器でも overscroll-behavior が効く」修正（bug 1837436。非同期スクロール側）を通らない。'
            + '同じ Firefox に OS の本物のホイールを送ると裏は動かなかった。検査で通す書き方は見つかっていない',
    },

    // ── WebKit だけ ──
    {
        file: 'toc-page.spec.ts', title: '背景の上でホイールを回しても裏のページが動かない', browsers: ['webkit'],
        reason: 'Safari の既知の未対応（_sheet.css のコメントの制約）。スクロールしない器（::backdrop）の overscroll-behavior に'
            + '対応していない（WebKit bug 176454）。Safari の読者は、シートを開いたまま背景の上でスクロールすると裏が動く',
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
