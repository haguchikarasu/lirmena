/*
 * world-page.ts
 * 責務: 資料ページのうち人物（characters.html）と地図（map.html）のエントリ。上の帯を結線し、<body data-world> に
 *       応じて器 #wp-panel に部品を置く。用語（glossary.html）は直リンク（#g-見出し語）の着地を持つので別のエントリ
 *       （glossary-page.ts）。どちらも上の帯は ui/world-nav が結線する。
 * export: なし（エントリ）
 * 依存: ui/world-nav（帯）、characters・map（部品）、volumes（computeStoryStage）、core/storage（既読の読み出し）、
 *       types（型）。reader 層を import しない（.dependency-cruiser.cjs の toc-no-reader）
 * CSS: toc.css（目次と同じ紙面＝パレット・stage 別キーカラー --stage-hue・dev 札の表示切替）→ _sheet.css（色の部品と
 *      アイコン .ic）→ 部品の CSS → world-page.css（資料ページの枠組み）の順に import する
 *
 * 人物の Stage は目次と同じ「読者の今の Stage」（computeStoryStage(既読, story.json)。要件 06-8）。
 * story.json が取れなければ早期スクリプトが先付けた <html data-story-stage>（前回の目次・本文が残したキャッシュ）を使う。
 * characters.json が取れなければ空で描く（部品が「紹介できる人物はまだいません。」を出す）。
 */

import './styles/toc.css';
import './styles/_sheet.css';
import './styles/_characters.css';
import './styles/_map.css';
import './styles/world-page.css';
import * as worldNav from './ui/world-nav';
import * as characters from './characters';
import * as map from './map';
import * as storage from './core/storage';
import { computeStoryStage, type StoryStage } from './volumes';
import type { CharactersData, StoryData } from './types';

worldNav.init();

const panel = document.getElementById('wp-panel');
const world = document.body.dataset.world;

if (panel && world === 'map') {
    map.mount(panel);
} else if (panel && world === 'characters') {
    void _mountCharacters(panel);
}

// 取得に失敗したものは空として扱う（ページは描く）。
// _fetchJson<T>(path: string): Promise<T | null>
async function _fetchJson<T>(path: string): Promise<T | null> {
    try {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as T;
    } catch {
        return null;
    }
}

// _mountCharacters(el: HTMLElement): Promise<void>
async function _mountCharacters(el: HTMLElement): Promise<void> {
    const [story, data] = await Promise.all([
        _fetchJson<StoryData>('story.json'),
        _fetchJson<CharactersData>('characters.json'),
    ]);
    let stage: StoryStage;
    if (story) {
        stage = computeStoryStage(Array.from(storage.loadReadKeys()), story);
        document.documentElement.dataset.storyStage = String(stage);
    } else {
        stage = Number(document.documentElement.dataset.storyStage ?? '1') as StoryStage;
    }
    characters.render(el, data ?? [], stage);
}
