// @vitest-environment node
/*
 * core/settings-model.test.ts
 * core/settings-model.ts（表示設定の値の規則）を DOM の無い環境（node）で確かめる。
 * 本文への反映（CSS 変数・属性）とパネルの操作は settings.test.ts（jsdom）が見ている。ここは値の規則だけ：
 *   - 未設定・不正値は既定へ倒す（目次と本文で同じ規則）
 *   - 目次の「設定をリセット」（removeSettings）が表示設定 5 項目と読書点のキーを消す
 *   - 読書点は [0,100] にクランプして保存する
 *   - プリセットの一致判定
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULTS,
    LS_KEYS,
    LS_READING_ANCHOR,
    PRESETS,
    READING_ANCHOR_DEFAULT,
    activePresetId,
    loadReadingAnchor,
    loadSettings,
    removeSettings,
    saveReadingAnchor,
    saveSetting,
    saveSettings,
} from './settings-model';

// Storage の最小実装（node には localStorage が無い）。
function memoryStorage(): Storage {
    const map = new Map<string, string>();
    return {
        get length() { return map.size; },
        clear: () => map.clear(),
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        key: (i: number) => [...map.keys()][i] ?? null,
        removeItem: (k: string) => { map.delete(k); },
        setItem: (k: string, v: string) => { map.set(k, String(v)); },
    };
}

beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe('loadSettings', () => {
    it('未設定なら既定値', () => {
        expect(loadSettings()).toEqual(DEFAULTS);
    });

    it('有効値は読み、不正値は項目ごとに既定へ倒す', () => {
        localStorage.setItem('lirmena.writingMode', 'vertical');
        localStorage.setItem('lirmena.fontSize', 'huge');
        expect(loadSettings()).toEqual({ ...DEFAULTS, writingMode: 'vertical' });
    });
});

describe('保存とリセット', () => {
    it('saveSetting は 1 項目だけを書く', () => {
        saveSetting('fontWeight', 'bold');
        expect(localStorage.getItem('lirmena.fontWeight')).toBe('bold');
        expect(localStorage.length).toBe(1);
    });

    it('saveSettings は 5 項目すべてを書く', () => {
        saveSettings(PRESETS[1].values);
        expect(loadSettings()).toEqual(PRESETS[1].values);
        expect(localStorage.length).toBe(5);
    });

    it('removeSettings は表示設定 5 項目と読書点のキーを消し、ほかのキーは残す', () => {
        saveSettings(PRESETS[0].values);
        localStorage.setItem(LS_READING_ANCHOR, '70');
        localStorage.setItem('read', '[]');
        removeSettings();
        for (const key of Object.values(LS_KEYS)) expect(localStorage.getItem(key)).toBeNull();
        expect(localStorage.getItem(LS_READING_ANCHOR)).toBeNull();
        expect(localStorage.getItem('read')).toBe('[]');
    });
});

describe('読書点', () => {
    it('未設定・不正値は既定、範囲外はクランプして読む', () => {
        expect(loadReadingAnchor()).toBe(READING_ANCHOR_DEFAULT);
        localStorage.setItem(LS_READING_ANCHOR, 'abc');
        expect(loadReadingAnchor()).toBe(READING_ANCHOR_DEFAULT);
        localStorage.setItem(LS_READING_ANCHOR, '150');
        expect(loadReadingAnchor()).toBe(100);
    });

    it('saveReadingAnchor はクランプした値を保存して返す', () => {
        expect(saveReadingAnchor(-5)).toBe(0);
        expect(localStorage.getItem(LS_READING_ANCHOR)).toBe('0');
    });
});

describe('activePresetId', () => {
    it('完全一致するプリセットだけを返し、既定値はどれとも一致しない', () => {
        expect(activePresetId(PRESETS[0].values)).toBe('web');
        expect(activePresetId({ ...PRESETS[0].values, fontSize: 'large' })).toBeNull();
        expect(activePresetId(DEFAULTS)).toBeNull();
    });
});
