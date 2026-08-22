/*
 * firstrun.test.ts
 * 対象: firstrun.ts の「出す条件」と onDone の契約（必ず 1 回・マイクロタスク）、閉じ口ごとの後始末。
 * 方針: 期待値は要件 06-4（プリセット）／06-12（初回導線）と IF コメントから導出する（仕様駆動）。
 *   **onDone が必ず 1 回**がこのモジュールで最も壊れやすい不変条件——破れると、条件を満たさない読者
 *   （設定を触ったことがある既存読者など）が初回ガイドへ永久に到達できなくなる。
 *   「器が無い」分岐は e2e では踏めない（目次ページには firstrun 自体がロードされない）ので、ここでしか検査できない。
 * 環境: jsdom。#firstrun-popup を beforeEach で用意し、settings.init() で表示設定の module state を再構築する。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { init } from './firstrun';
import * as settings from './settings';

const SETTINGS_NOOP = { onClearBookmarks: () => {}, onClearReached: () => {}, onClearRead: () => {}, onWritingModeChange: () => {} };
const DISPLAY_KEYS = ['lirmena.writingMode', 'lirmena.lineGap', 'lirmena.fontFamily', 'lirmena.fontSize', 'lirmena.fontWeight'];

// マイクロタスクを 1 周させる（onDone は queueMicrotask 経由で呼ばれる）。
const flush = () => new Promise<void>((resolve) => { queueMicrotask(resolve); });

const popup = () => document.getElementById('firstrun-popup');
const choices = () => [...document.querySelectorAll<HTMLButtonElement>('.firstrun-choice')];
const skip = () => document.querySelector<HTMLButtonElement>('.firstrun-skip');
const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-writing-mode');
    document.body.innerHTML = '';

    const el = document.createElement('section');
    el.id = 'firstrun-popup';
    el.hidden = true;
    document.body.appendChild(el);

    settings.init(SETTINGS_NOOP);
});

// 仕様（要件 06-4 / 06-12）：質問済みフラグが無い AND 表示設定5項目がすべて既定値のときだけ出す。
// チュートリアル既読フラグは条件に入れない（設定を触っていない既存読者にも一度だけ出る）。
describe('初回ダイアログを出す条件', () => {
    it('質問済みフラグが無く全設定が既定値なら出す（onDone は閉じるまで呼ばない）', async () => {
        let done = 0;
        init({ onDone: () => { done++; } });

        expect(popup()?.hidden).toBe(false);
        expect(choices()).toHaveLength(2);
        await flush();
        expect(done).toBe(0);
    });

    it('質問済みフラグがあれば出さず、onDone だけ呼ぶ', async () => {
        localStorage.setItem('lirmena.presetAsked', '1');
        let done = 0;
        init({ onDone: () => { done++; } });

        expect(popup()?.hidden).toBe(true);
        await flush();
        expect(done).toBe(1);
    });

    it('表示設定を変えたことがあれば出さず、onDone だけ呼ぶ', async () => {
        localStorage.setItem('lirmena.fontSize', 'large');
        settings.init(SETTINGS_NOOP);   // 変更後の値で読み直す
        let done = 0;
        init({ onDone: () => { done++; } });

        expect(popup()?.hidden).toBe(true);
        await flush();
        expect(done).toBe(1);
    });

    // 目次ページのように器が無いページでも、呼び出し側が分岐せずに済むよう onDone は必ず通る。
    it('器（#firstrun-popup）が無くても onDone は呼ぶ', async () => {
        popup()?.remove();
        let done = 0;
        init({ onDone: () => { done++; } });

        await flush();
        expect(done).toBe(1);
    });
});

// 仕様（要件 06-4 / 06-12）：閉じ口はカード選択・「あとで決める」・Escape の3つ。どの経路でも
// 質問済みフラグを立て、onDone を1回だけ呼ぶ。背景クリックでは閉じない。
describe('閉じ口ごとの後始末と onDone の契約', () => {
    it('カードを選ぶとプリセットが当たり、フラグが立ち、onDone が1回呼ばれる', async () => {
        let done = 0;
        init({ onDone: () => { done++; } });

        choices().find((b) => b.textContent?.includes('書籍風'))?.click();

        expect(settings.getActivePreset()).toBe('book');
        expect(localStorage.getItem('lirmena.writingMode')).toBe('vertical');
        expect(localStorage.getItem('lirmena.presetAsked')).toBe('1');
        expect(popup()?.hidden).toBe(true);
        await flush();
        expect(done).toBe(1);
    });

    it('「あとで決める」は設定を変えずフラグだけ立てる', async () => {
        let done = 0;
        init({ onDone: () => { done++; } });

        skip()?.click();

        for (const key of DISPLAY_KEYS) expect(localStorage.getItem(key)).toBeNull();
        expect(localStorage.getItem('lirmena.presetAsked')).toBe('1');
        expect(popup()?.hidden).toBe(true);
        await flush();
        expect(done).toBe(1);
    });

    it('Escape でも閉じてフラグが立つ（キーボードでモーダルから抜けられる）', async () => {
        let done = 0;
        init({ onDone: () => { done++; } });

        pressEscape();

        expect(popup()?.hidden).toBe(true);
        expect(localStorage.getItem('lirmena.presetAsked')).toBe('1');
        await flush();
        expect(done).toBe(1);
    });

    // 他のポップアップは背景クリックで閉じるが、これは質問なので誤タップで消費させない（意図的な逸脱）。
    it('背景クリックでは閉じない', async () => {
        let done = 0;
        init({ onDone: () => { done++; } });

        popup()?.click();

        expect(popup()?.hidden).toBe(false);
        expect(localStorage.getItem('lirmena.presetAsked')).toBeNull();
        await flush();
        expect(done).toBe(0);
    });

    // 同期で呼ぶと、Escape で閉じた延長で開いたチュートリアルが同じ keydown の後続リスナーに閉じられうる。
    // 1 マイクロタスク遅らせることで、document の Escape ハンドラの登録順に依存しなくなる。
    it('onDone は同期ではなくマイクロタスクで呼ばれる', async () => {
        let done = 0;
        init({ onDone: () => { done++; } });

        skip()?.click();
        expect(done).toBe(0);   // click ハンドラの同期処理の中ではまだ呼ばれない

        await flush();
        expect(done).toBe(1);
    });

    it('閉じ口を複数通っても onDone は 1 回だけ', async () => {
        let done = 0;
        init({ onDone: () => { done++; } });

        skip()?.click();
        pressEscape();

        await flush();
        expect(done).toBe(1);
    });
});

// 仕様：自動で開くダイアログなので、開いた時点でフォーカスを中へ入れ、閉じたら外へ返す。
// オーバーレイの下の #opening-back / #opening-start は隠れていても focusable なため。
describe('フォーカスの受け渡し', () => {
    it('開いた瞬間に1枚目のカードへフォーカスする', () => {
        init({ onDone: () => {} });
        expect(document.activeElement).toBe(choices()[0]);
    });

    it('閉じたあとフォーカスがダイアログの中に残らない', () => {
        init({ onDone: () => {} });
        skip()?.click();
        expect(popup()?.contains(document.activeElement)).toBe(false);
    });
});
