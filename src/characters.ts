/*
 * characters.ts
 * 責務: キャラクター紹介ポップアップ（#characters-overlay）の中身の生成・開閉。本文ページ（menu.ts）と
 *       目次ページ（index.ts の付録カード）で共用する。
 * export: resolveCharacters(data: CharactersData, stage: StoryStage): CharacterEntry[]
 *         init(): void
 *         open(data: CharactersData, stage: StoryStage): void
 *         close(): void
 *         isOpen(): boolean
 * 依存: ruby.ts（キャラ名/説明のルビ展開）, types.ts, volumes.ts（StoryStage の型のみ）
 *
 * 分担（要件 06-8・design/modules/characters.md）：
 *   - 「どの Stage のキャラ紹介を出すか」は呼び出す側が決める。本文は「そのページが属する Stage」
 *     （vol n のページ＝Stage n）、目次は「読者の今の Stage」（computeStoryStage）を渡す
 *   - 「Stage からどの登録を引くか」はここだけが持つ（resolveCharacters）。呼び出す側は巻番号を扱わない
 *
 * 器と中身：
 *   - 各ページは空の器 <section id="characters-overlay" hidden role="dialog"> だけを置き、init() が中身
 *     （#characters-popup ＞ #characters-popup-close ＋ #characters-list）を生成する＝markup の複製を持たない。
 *     ID は _characters.css と immersive.ts が参照しているので変えない
 *   - 閉じる方法：背景クリックと閉じるボタンはここで登録する。**Escape は拾わない**：ほかのポップアップとの
 *     優先順位がページごとに違うので、各ページのキー処理が isOpen() / close() を呼ぶ
 *
 * 読み込む側は `import * as charaPopup from './characters'` とする
 * （menu.ts の init(characters: CharactersData) の引数名と衝突させないため）。
 */

import { applyRuby } from './ruby';
import type { CharactersData, CharacterEntry } from './types';
import type { StoryStage } from './volumes';

let _overlay: HTMLElement | null = null;
let _list: HTMLElement | null = null;

// Stage に対応するキャラ紹介を返す純関数。規則は「巻番号が Stage 以下の登録のうち、巻番号が最大のもの」：
// Stage 1〜4 は同じ番号の巻、Stage 5（物語完結）は最終巻（vol4）になる。
// 巻数（story.json）を受け取らずに Stage 5 → 最終巻を決めるための形で、前提（公開済みの巻には登録がある／
// story.json に無い巻・重複した巻の登録は無い）は story-integrity の (o) がビルドで保証する。
// 該当が無ければ空配列。
// resolveCharacters(data: CharactersData, stage: StoryStage): CharacterEntry[]
export function resolveCharacters(data: CharactersData, stage: StoryStage): CharacterEntry[] {
    let best: CharactersData[number] | undefined;
    for (const entry of data) {
        if (entry.volume <= stage && (best === undefined || entry.volume > best.volume)) best = entry;
    }
    return best?.characters ?? [];
}

// 空の器 #characters-overlay にパネル（閉じるボタン＋カード一覧）を生成し、背景クリックと閉じるボタンを登録する。
// 各ページの起動時に一度だけ呼ぶ。器が無いページでは何もしない。
// init(): void
export function init(): void {
    _overlay = document.querySelector<HTMLElement>('#characters-overlay');
    if (!_overlay) return;

    const popup = document.createElement('article');
    popup.id = 'characters-popup';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.id = 'characters-popup-close';
    closeBtn.textContent = '閉じる';
    closeBtn.addEventListener('click', () => close());

    _list = document.createElement('div');
    _list.id = 'characters-list';

    popup.append(closeBtn, _list);
    _overlay.appendChild(popup);

    _overlay.addEventListener('click', (e) => {
        if (e.target === _overlay) close();
    });
}

// Stage に対応するキャラクターカードを作り直して表示する（前に開いたときのカードは残さない）。
// 該当が無ければ空のまま開く（本文側の従来挙動。ビルド時は (o) が登録漏れを止める）。
// 画像が未用意（image が ""）のキャラは画像エリアを出さない（要件 06-8）。
// open(data: CharactersData, stage: StoryStage): void
export function open(data: CharactersData, stage: StoryStage): void {
    if (!_overlay || !_list) return;
    _list.innerHTML = '';

    for (const chara of resolveCharacters(data, stage)) {
        const card = document.createElement('div');
        card.className = 'character-card';

        if (chara.image !== '') {
            const img = document.createElement('img');
            img.src = `${import.meta.env.BASE_URL}chara/${chara.image}`;
            img.alt = '';
            card.appendChild(img);
        }

        const info = document.createElement('div');
        info.className = 'character-info';

        const name = document.createElement('p');
        name.className = 'character-name';
        applyRuby(chara.name, name);

        const desc = document.createElement('p');
        desc.className = 'character-description';
        applyRuby(chara.description, desc);

        info.append(name, desc);
        card.appendChild(info);
        _list.appendChild(card);
    }

    _overlay.hidden = false;
}

// ポップアップを閉じる。
// close(): void
export function close(): void {
    if (_overlay) _overlay.hidden = true;
}

// ポップアップが開いているか（各ページの Escape 処理が優先順位を決めるのに使う）。
// isOpen(): boolean
export function isOpen(): boolean {
    return _overlay !== null && !_overlay.hidden;
}
