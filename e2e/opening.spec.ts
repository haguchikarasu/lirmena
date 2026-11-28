/*
 * 受け入れテスト：開幕アフォーダンス（本文先頭の黒い余白に出る「もどる」「読み進める」）のアイコン＋小さい文字（要件 06-6）。
 * テスト名の先頭の番号は plans/2026-11-17-opening-icon-label.md の「テスト計画」の番号（E8＝「もどる」の着地は
 * resume.spec.ts・afterword-records.spec.ts・record-hold.spec.ts が担保しているので、ここには置かない）。
 *
 * 見るのは利用者に届く結果：計算後のスタイル、画面上の実際の位置と向き、アクセシビリティの名前、スクロールの着地点。
 * 時間には頼らない：揺れはアニメーションを止めて時刻を指定してから測り、待ちは expect の再試行（poll）だけで書く。
 * 静的な約束（SVG が aria-hidden・名前と見える文字の一致・並び）は src/opening-shell.test.ts が CI で見る。ここはその実ブラウザ版も兼ねる。
 * ボタンは開幕の中に絞って探す（tutorial.ts にも別の「もどる」ボタンがあるため）。
 */

import type { Locator, Page } from '@playwright/test';
import { test, expect } from './_fixtures';
import { gotoToc, openFromToc, position, scrollForward, setupRoutes, setWritingMode, waitReader } from './_records';

const MODES = ['horizontal', 'vertical'] as const;
type Mode = (typeof MODES)[number];

const aff = (page: Page): Locator => page.locator('#opening-affordance');
const startBtn = (page: Page): Locator => aff(page).getByRole('button', { name: '読み進める', exact: true });
const backBtn = (page: Page): Locator => aff(page).getByRole('button', { name: 'もどる', exact: true });

// 「もどる」が前の節へ行く普通の節（01-02）を、書字方向を決めて開幕の状態で開く。本文は route で固定の長さにする
async function openAtOpening(page: Page, mode: Mode): Promise<void> {
    await setupRoutes(page);
    await setWritingMode(page, mode);
    await page.goto('/lirmena/contents/01-02.html');
    await waitReader(page);
    await expect(page.locator('html')).toHaveAttribute('data-writing-mode', mode);
    await expect(page.locator('html')).toHaveClass(/\bat-opening\b/);
    await expect(startBtn(page)).toBeVisible();
}

type Vec = { x: number; y: number };

// 要素の中心に対する、子要素の中心のずれ（画面上の px）。CSS の回転・移動を通した後の実際の位置で測る
async function offsetFromCenter(page: Page, outer: string, inner: string): Promise<Vec> {
    return page.evaluate(([o, i]) => {
        const a = document.querySelector(o)!.getBoundingClientRect();
        const b = document.querySelector(i)!.getBoundingClientRect();
        return { x: (b.left + b.width / 2) - (a.left + a.width / 2), y: (b.top + b.height / 2) - (a.top + a.height / 2) };
    }, [outer, inner] as const);
}

// 画面上の向き（アイコンが指す向き）を、実際の描画位置から読む。
//   もどる：折り返しの矢印の矢じり（2 本目の path）がアイコンの中心からどちらにずれているか＝戻る向き
//   読み進める：山形（1 本の path）の外接矩形が横長なら上下を指し、縦長なら左右を指す（向きの符号は回転の値で見る）
async function iconDirections(page: Page): Promise<{ backHead: Vec; startWide: boolean; startRotate: string; backRotate: string }> {
    const backHead = await offsetFromCenter(page, '#opening-back svg', '#opening-back svg path:nth-of-type(2)');
    const extra = await page.evaluate(() => {
        const r = document.querySelector('#opening-start svg path')!.getBoundingClientRect();
        return {
            startWide: r.width > r.height,
            startRotate: getComputedStyle(document.querySelector('#opening-start svg')!).rotate,
            backRotate: getComputedStyle(document.querySelector('#opening-back svg')!).rotate,
        };
    });
    return { backHead, ...extra };
}

// 書字方向ごとの期待（要件 06-6：読み進める＝進行方向、もどる＝その逆。横書き＝下へ進む／縦書き＝左へ進む）
async function expectIconsFacing(page: Page, mode: Mode): Promise<void> {
    const d = await iconDirections(page);
    if (mode === 'vertical') {
        expect(d.startRotate, '縦書きは横書きの絵を 90° 回す').toBe('90deg');
        expect(d.backRotate).toBe('90deg');
        expect(d.startWide, '縦書きの「読み進める」は左右を指す（縦長の山形）').toBe(false);
        expect(d.backHead.x, '縦書きの「もどる」の矢じりは右（戻る向き）').toBeGreaterThan(3);
        expect(Math.abs(d.backHead.y)).toBeLessThan(Math.abs(d.backHead.x));
    } else {
        expect(d.startRotate, '横書きは描いたままの向き').toBe('none');
        expect(d.backRotate).toBe('none');
        expect(d.startWide, '横書きの「読み進める」は上下を指す（横長の山形）').toBe(true);
        expect(d.backHead.y, '横書きの「もどる」の矢じりは上（戻る向き）').toBeLessThan(-3);
        expect(Math.abs(d.backHead.x)).toBeLessThan(Math.abs(d.backHead.y));
    }
}

// 「読み進める」の着地点（要件 06-6）：文章の先頭辺が読書点マーカー位置へ来る量＝ --reading-anchor の比率 × 進行軸の表示幅。
// 比率は既定値をテストに焼き込まず、そのページの計算値から読む
async function readOnTarget(page: Page): Promise<number> {
    const ratio = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reading-anchor')) / 100);
    expect(Number.isFinite(ratio), '--reading-anchor が読めない').toBe(true);
    const { client, range } = await position(page);
    const target = Math.min(range, ratio * client);
    expect(target, '本文が短すぎて着地点を検査できない').toBeGreaterThan(50);
    return target;
}

async function expectLandedAt(page: Page, target: number): Promise<void> {
    await expect.poll(async () => (await position(page)).progress, { message: '「読み進める」の着地点' }).toBeGreaterThanOrEqual(target - 4);
    expect((await position(page)).progress).toBeLessThanOrEqual(target + 4);
}

// 揺れのアニメーションを止めて時刻 ms に置き、アイコンの中心の画面上の位置を返す（時間の経過に頼らず決まる）
async function iconCenterAt(page: Page, ms: number): Promise<Vec> {
    return page.evaluate((t) => {
        const svg = document.querySelector('#opening-start svg')!;
        const anims = svg.getAnimations();
        if (anims.length === 0) throw new Error('「読み進める」のアイコンにアニメーションが無い');
        for (const a of anims) { a.pause(); a.currentTime = t; }
        const r = svg.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, ms);
}

for (const mode of MODES) {
    test.describe(`書字方向：${mode}`, () => {
        // E1：アイコンが書字方向の進む向き・戻る向きを指す（縦＝読み進めるが左・もどるが右、横＝下・上）
        test(`E1 アイコンの向きが書字方向に合う（${mode}）`, async ({ page }) => {
            await openAtOpening(page, mode);
            await expectIconsFacing(page, mode);
        });

        // E2：揺れが進行方向を向く（縦＝左へ 5px、横＝下へ 5px）。中間（周期 2.6 秒の半分）で止めて実際の位置の差を測る
        test(`E2 「読み進める」のアイコンは進行方向へ揺れる（${mode}）`, async ({ page }) => {
            await openAtOpening(page, mode);
            const rest = await iconCenterAt(page, 0);
            const mid = await iconCenterAt(page, 1300);
            const dx = mid.x - rest.x;
            const dy = mid.y - rest.y;
            if (mode === 'vertical') {
                expect(dx).toBeCloseTo(-5, 0);
                expect(dy).toBeCloseTo(0, 0);
            } else {
                expect(dx).toBeCloseTo(0, 0);
                expect(dy).toBeCloseTo(5, 0);
            }
        });

        // E7：「読み進める」でフェードして本文の先頭が読書点に着く（アイコン化で押せる範囲・処理が壊れていない）
        test(`E7 「読み進める」で開幕が消え、読書点の位置へ送られる（${mode}）`, async ({ page }) => {
            await openAtOpening(page, mode);
            const target = await readOnTarget(page);
            await startBtn(page).click();
            await expect(page.locator('html')).not.toHaveClass(/\bat-opening\b/);
            await expect(aff(page), '開幕の器が透明になる').toHaveCSS('opacity', '0');
            await expectLandedAt(page, target);
        });

        // E9：開幕でないときは見えず、押せず、キーボードでも入れない。先頭へ戻すと再び出る
        // E12：Tab は HTML に書いた順に動き、止まった部品が画面に映る位置へ本文が動く（要件 08）。Shift+Tab は同じ停止先を
        // 逆順にたどり、本文の位置も行きと同じになる（開幕のボタンへ戻れば本文は頭へ戻る）。
        // 目次から入る（直接開くと「読書記録抑止中」の札が出て、札が先に止まる＝下の E13）
        // ブラウザの既定の差（読者に害はない）を 2 つ吸収する。どちらも「押せるものへ順に届く」という意図は変えない：
        //   - Firefox はスクロールする器（#main-container）にも Tab が止まる（Bugzilla 1069739）。器に止まった回だけ、もう 1 回押して読み飛ばす
        //   - WebKit は既定で Tab がリンク（<a>。共有の 2 つ）に止まらない（Safari の既定と同じ）。WebKit では停止先の期待から
        //     リンクの 2 つだけを外す（ボタンの並びと Shift+Tab の逆順は同じに見る）。Windows 版の Playwright WebKit では
        //     Alt+Tab・Control+Tab などでもリンクに止まらなかった（2026-11-27 に確かめた）ので、押し方では吸収できない
        // 画面に映っているかは矩形で見る：WebKit の IntersectionObserver が縦書きの器の中の横書き flex の子を「交差 0」と返し、
        // それで判定する toBeInViewport が偽になるため。矩形は「全体がビューポートの中」を求める（toBeInViewport の既定の 1px より厳しい）
        test(`E12 Tab は「もどる」→「読み進める」→ 本文末 → メニューの順に進み、Shift+Tab で同じ道を戻る（${mode}）`, async ({ page, browserName }) => {
            const press = async (shift: boolean): Promise<void> => {
                const key = shift ? 'Shift+Tab' : 'Tab';
                await page.keyboard.press(key);
                if (browserName === 'firefox' && await page.evaluate(() => document.activeElement?.id === 'main-container')) {
                    await page.keyboard.press(key);
                }
            };
            await setupRoutes(page);
            await setWritingMode(page, mode);
            await gotoToc(page);
            await openFromToc(page, 1, 2);
            await expect(page.locator('html')).toHaveClass(/\bat-opening\b/);
            await expect(page.locator('#badge-hold')).toBeHidden();

            // 止まった部品の id と、そのときの状態（開幕かどうか・本文の位置が頭か末尾か）を読む。
            // 位置は「頭」か「本文末（頭を離れている）」に丸める（フォーカスに合わせた移動量はブラウザが決めるので px では比べない）
            const stop = async (): Promise<string> => {
                await expect.poll(async () => page.evaluate(() => document.activeElement?.id ?? '')).not.toBe('');
                const id = await page.evaluate(() => document.activeElement!.id);
                const opening = id.startsWith('opening-');
                // 開幕のボタンに止まったら本文は頭にあり、開幕が出ている（スクロールの通知を待つ）
                if (opening) await expect(page.locator('html')).toHaveClass(/\bat-opening\b/);
                const { progress, range } = await position(page);
                expect(range, '本文が短すぎて位置を区別できない').toBeGreaterThan(50);
                const where = progress <= 4 ? '頭' : '本文末';
                await expect.poll(async () => {
                    const b = await page.locator(`#${id}`).boundingBox();
                    const vp = page.viewportSize()!;
                    if (!b || b.width === 0 || b.height === 0) return false;
                    return b.x >= -1 && b.y >= -1 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1;
                }, { message: `#${id} の全体が画面に映っている` }).toBe(true);
                return `${id}@${where}`;
            };

            const links = ['btn-share-x@本文末', 'btn-share-marshmallow@本文末'];
            const expected = [
                'opening-back@頭', 'opening-start@頭',
                'btn-next@本文末', ...links, 'menu-toggle@本文末',
            ].filter((s) => browserName !== 'webkit' || !links.includes(s));
            const forward: string[] = [];
            for (let i = 0; i < expected.length; i++) {
                await press(false);
                forward.push(await stop());
            }
            expect(forward).toEqual(expected);

            const backward: string[] = [forward[forward.length - 1]];
            for (let i = 0; i < expected.length - 1; i++) {
                await press(true);
                backward.push(await stop());
            }
            expect(backward, 'Shift+Tab は行きと同じ停止先を逆順にたどる').toEqual([...forward].reverse());
        });

        // E13：直接開いたときは、画面の上端にある「読書記録抑止中」の札が先で、そのあとは E12 と同じ
        test(`E13 直接開いたときの Tab は、札 →「もどる」→「読み進める」の順（${mode}）`, async ({ page }) => {
            await openAtOpening(page, mode);
            await page.keyboard.press('Tab');
            await expect(page.locator('#badge-hold')).toBeFocused();
            await page.keyboard.press('Tab');
            await expect(backBtn(page)).toBeFocused();
            await page.keyboard.press('Tab');
            await expect(startBtn(page)).toBeFocused();
            await expect(page.locator('html')).toHaveClass(/\bat-opening\b/);
        });

        // E14：「読み進める」で本文へ入ったあと、見えなくなったボタンにフォーカスが残らない。次の Tab は本文末へ進む。
        // フォーカスは本文（#scene-content）へ移る：blur() で外すだけだと、次の Tab の起点がブラウザで違い、Firefox と WebKit では
        // 開幕のボタンに止まって本文が頭へ巻き戻った（2026-11-27 に見つけて直した）
        test(`E14 「読み進める」を Enter で押すとフォーカスが本文へ移り、次の Tab は本文末の「次へ」に止まる（${mode}）`, async ({ page }) => {
            await openAtOpening(page, mode);
            const target = await readOnTarget(page);
            await startBtn(page).focus();
            await page.keyboard.press('Enter');
            await expectLandedAt(page, target);
            await expect(page.locator('#scene-content'), '見えないボタンにフォーカスを残さず、本文へ移す').toBeFocused();
            await expect(page.locator('#scene-content'), '本文には枠を出さない').toHaveCSS('outline-style', 'none');
            await page.keyboard.press('Tab');
            await expect(page.locator('#btn-next')).toBeFocused();
            await expect(page.locator('html'), '開幕へ巻き戻らない').not.toHaveClass(/at-opening/);
            expect(await page.locator('#scene-content').getAttribute('tabindex'), '本文を Tab の停止先・クリックのフォーカス先に残さない').toBeNull();
        });

        // 開幕でないときのボタンは透明で、マウス・タッチでは押せない。キーボードのフォーカスは止めない（E12 が見る）
        test(`E9 開幕でないときはボタンが見えず押せない（${mode}）`, async ({ page }) => {
            await openAtOpening(page, mode);
            const target = await readOnTarget(page);
            await startBtn(page).click();
            await expectLandedAt(page, target);   // スクロールのアニメーションが終わる（＝update が開幕を判定し直せる）まで待つ

            const expectUnreachable = async (): Promise<void> => {
                await expect(aff(page), '開幕の器が透明になる').toHaveCSS('opacity', '0');
                for (const sel of ['#opening-start', '#opening-back']) {
                    const hitInside = await page.evaluate((s) => {
                        const b = document.querySelector<HTMLElement>(s)!.getBoundingClientRect();
                        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
                        return !!hit?.closest('#opening-affordance');
                    }, sel);
                    expect(hitInside, `${sel} の位置を押しても開幕に当たらない`).toBe(false);
                }
            };
            await expectUnreachable();

            // 先頭へ手で戻すと開幕が戻る
            await scrollForward(page, 0);
            await expect(page.locator('html')).toHaveClass(/\bat-opening\b/);
            await expect(startBtn(page)).toBeVisible();
            await expect(backBtn(page)).toBeVisible();

            // 手でスクロールして先頭を離れても消える
            await scrollForward(page, 200);
            await expect(page.locator('html')).not.toHaveClass(/\bat-opening\b/);
            await expectUnreachable();
        });

        // E10：スマホの縦・横で、開幕の列が画面に収まり、右下のメニューボタンと重ならず、小さい文字が折り返さない
        for (const vp of [{ width: 375, height: 812 }, { width: 812, height: 375 }]) {
            test(`E10 スマホ ${vp.width}×${vp.height} で画面に収まりメニューと重ならない（${mode}）`, async ({ page }) => {
                await page.setViewportSize(vp);
                await openAtOpening(page, mode);
                const menu = (await page.locator('#menu-toggle').boundingBox())!;
                expect(menu, 'メニューボタンが無い').toBeTruthy();
                for (const sel of ['#opening-label', '#opening-back', '#opening-start']) {
                    const b = (await page.locator(sel).boundingBox())!;
                    expect(b, `${sel} の箱が無い`).toBeTruthy();
                    expect(b.x, `${sel} が左にはみ出さない`).toBeGreaterThanOrEqual(0);
                    expect(b.y, `${sel} が上にはみ出さない`).toBeGreaterThanOrEqual(0);
                    expect(b.x + b.width, `${sel} が右にはみ出さない`).toBeLessThanOrEqual(vp.width);
                    expect(b.y + b.height, `${sel} が下にはみ出さない`).toBeLessThanOrEqual(vp.height);
                    const overlap = b.x < menu.x + menu.width && menu.x < b.x + b.width && b.y < menu.y + menu.height && menu.y < b.y + b.height;
                    expect(overlap, `${sel} がメニューボタンと重ならない`).toBe(false);
                }
                // 小さい文字は 1 行（高さが行の高さ 1 つ分）
                const lines = await page.locator('#opening-affordance .opening-caption').evaluateAll((els) =>
                    els.map((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
                expect(lines).toHaveLength(2);
                for (const n of lines) expect(n).toBeLessThan(1.5);
            });
        }
    });
}

// E3：開幕を出したまま設定で書字方向を切り替えると、アイコンの向きがその場で追従する（初回の読み方の選択も同じ属性の書き換え）
test('E3 開幕のまま書字方向を切り替えると、アイコンの向きがその場で変わる', async ({ page }) => {
    await openAtOpening(page, 'horizontal');
    await expectIconsFacing(page, 'horizontal');

    await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await expect(page.locator('#settings-popup')).toBeVisible();
    await page.locator('#settings-popup').getByRole('radio', { name: '縦書き', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-writing-mode', 'vertical');
    await expect(page.locator('html')).toHaveClass(/\bat-opening\b/);
    await expectIconsFacing(page, 'vertical');

    await page.locator('#settings-popup').getByRole('radio', { name: '横書き', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-writing-mode', 'horizontal');
    await expectIconsFacing(page, 'horizontal');
});

// E4：読み上げでの名前が「読み進める」「もどる」のまま。アイコン（SVG）は読み上げに出ない
test('E4 ボタンの名前は「読み進める」「もどる」で、アイコンは読み上げから隠れている', async ({ page }) => {
    await openAtOpening(page, 'horizontal');
    await expect(aff(page).getByRole('button')).toHaveCount(2);
    await expect(startBtn(page)).toHaveId('opening-start');
    await expect(backBtn(page)).toHaveId('opening-back');
    await expect(aff(page).locator('svg')).toHaveCount(2);
    await expect(aff(page).locator('svg:not([aria-hidden="true"])')).toHaveCount(0);
    // 名前の出どころはボタン自身（見える文字の重複読みが無い）＝アクセシビリティツリー上はボタン 2 つと現在地だけ
    await expect(aff(page)).toMatchAriaSnapshot(`
      - complementary:
        - paragraph: 01-02
        - button "もどる"
        - button "読み進める"
    `);
});

// E6：押せる範囲が 44px 以上（アイコン化で文字の大きさに頼らなくなっても指で押せる）
test('E6 「もどる」「読み進める」の押せる範囲は縦横 44px 以上', async ({ page }) => {
    await openAtOpening(page, 'horizontal');
    for (const btn of [startBtn(page), backBtn(page)]) {
        const b = (await btn.boundingBox())!;
        expect(b.width).toBeGreaterThanOrEqual(44);
        expect(b.height).toBeGreaterThanOrEqual(44);
    }
});

// E5：普段は明滅と揺れが付いている（誘目が消えていない）
test('E5 既定では「読み進める」は明滅し、アイコンは揺れる', async ({ page }) => {
    await openAtOpening(page, 'horizontal');
    const s = await page.evaluate(() => {
        const btn = document.querySelector('#opening-start')!;
        const svg = btn.querySelector('svg')!;
        return {
            btn: getComputedStyle(btn).animationName, svg: getComputedStyle(svg).animationName,
            btnRunning: btn.getAnimations().length, svgRunning: svg.getAnimations().length,
        };
    });
    expect(s).toEqual({ btn: 'opening-breathe', svg: 'opening-nudge', btnRunning: 1, svgRunning: 1 });
});

test.describe('動きを減らす設定（prefers-reduced-motion: reduce）', () => {
    // test.use({ reducedMotion }) は @playwright/test の直下のオプションに無く、黙って無視される（contextOptions の中にしか無い）。
    // ページを開く前に emulateMedia で切り替える
    test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: 'reduce' }); });

    // E5：動きを減らす設定では明滅も揺れも止まる（どちらかの止め忘れで落ちる）
    test('E5 明滅も揺れも止まる', async ({ page }) => {
        await openAtOpening(page, 'horizontal');
        expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), '設定の切り替えが効いている').toBe(true);
        const s = await page.evaluate(() => {
            const btn = document.querySelector('#opening-start')!;
            const svg = btn.querySelector('svg')!;
            return {
                btn: getComputedStyle(btn).animationName, svg: getComputedStyle(svg).animationName,
                btnRunning: btn.getAnimations().length, svgRunning: svg.getAnimations().length,
            };
        });
        expect(s).toEqual({ btn: 'none', svg: 'none', btnRunning: 0, svgRunning: 0 });
    });

    for (const mode of MODES) {
        // E7b：動きを減らす設定では、アニメーションせず押した時点で着地点にいる（_animateScrollTo の reduced-motion の分岐）
        test(`E7b 「読み進める」は押した時点で読書点の位置に着く（${mode}）`, async ({ page }) => {
            await openAtOpening(page, mode);
            const target = await readOnTarget(page);
            await startBtn(page).click();
            // poll せず直後に 1 回だけ読む＝アニメーション（約 0.45 秒）で追いつく余地を与えない
            const p = await position(page);
            expect(Math.abs(p.progress - target)).toBeLessThanOrEqual(4);
            await expect(page.locator('html')).not.toHaveClass(/\bat-opening\b/);
        });
    }
});

// E11：小さい文字を消しても（将来の文字なしへの移行）名前・押せる範囲・「読み進める」の働きが残る
test('E11 小さい文字を隠しても、名前・押せる範囲・「読み進める」が壊れない', async ({ page }) => {
    await openAtOpening(page, 'horizontal');
    await page.addStyleTag({ content: '.opening-caption { display: none !important; }' });
    await expect(aff(page).locator('.opening-caption').first()).toBeHidden();

    await expect(startBtn(page)).toHaveId('opening-start');
    await expect(backBtn(page)).toHaveId('opening-back');
    for (const btn of [startBtn(page), backBtn(page)]) {
        const b = (await btn.boundingBox())!;
        expect(b.width).toBeGreaterThanOrEqual(44);
        expect(b.height).toBeGreaterThanOrEqual(44);
    }

    const target = await readOnTarget(page);
    await startBtn(page).click();
    await expect(page.locator('html')).not.toHaveClass(/\bat-opening\b/);
    await expectLandedAt(page, target);
});
