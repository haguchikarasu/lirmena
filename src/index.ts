/*
 * index.ts
 * 責務: 目次ページ（index.html）の全機能制御。story.json を読み、vol 単位で ep・sec 一覧と巻末あとがき
 *       チップを描画し、栞・オートセーブ（本編／あとがき独立）を並べ、stage に応じてヒーローカード画像を
 *       差し替える。設定ポップアップ／共有／FAB／変更履歴は既存流用。
 * export: なし（script type="module" としてロードされるエントリポイント）
 * 依存（目次は core と ui だけを読み、reader 層＝本文の読書の仕組みを読まない。.dependency-cruiser.cjs の層の規則）:
 *   core: core/storage（栞・既読・読破・オートセーブの読み書きと移行 init()。read セットは storage.loadReadKeys() で毎回
 *         localStorage を読み直す＝目次内で「読破状況をクリア」した直後の再計算で古い値を返さない。applyStoryStage 参照）、
 *         core/settings-model（表示設定の値の規則）、core/query（withQuery）、core/preview（hasEffectivePreview）、
 *         core/changelog（versionKind）、volumes.ts（computeStoryStage＝ヒーローカード切替と巻カードの初期 open 判定に共用）
 *   ui:   ui/settings-panel（設定ポップアップ。markup は templates/parts/settings.html）、ui/share（共有ポップアップ。
 *         markup は templates/parts/share.html）、ruby.ts（ルビ展開）、
 *         characters.ts（付録カードから開くキャラクター紹介ポップアップ＝本文ページと同じ部品）、
 *         map.ts（付録カードから開くエシュカ地図ポップアップ＝同上）
 *   以前は「src/ に依存しない」方針で上の多くを複製して持っていた（design/modules/index.md）。
 *
 * 機能:
 *   - story.json を fetch して vol → ep → sec 一覧を動的生成
 *     （sec01 のリンク先はタイトルページ [ep]-00.html、sec02 以降は本文ページ）
 *   - 各 vol は <details class="idx-vol-card"> でグルーピングして表示（要件 06-7 巻カード＆アコーディオン表示）。
 *     summary に「第N巻」＋状態バッジ（vol.afterword.published なら「全M話」／それ以外は「連載中」。判定名としての「巻完結」は残すが pill 表示テキストには出さない）を置き、
 *     本体に当 vol の ep 一覧＋（あとがき公開時のみ）巻末あとがきチップ（ep タイトル「あとがき」＋ chip の視覚 label は `**`＝aria-hidden／aria-label は「第N巻 あとがき（＋既読／読破）」）を入れる。
 *     初期 open は storyStage（＝computeStoryStage(read, story)）と vol.volume が一致する巻のみ。
 *     storyStage === story.length + 1（物語完結）のときは全 vol 閉じる。開閉状態は永続化しない。
 *   - **vol.preview（要件 06-7 予告 vol）**：vol.preview を持つ vol は <details> ではなく
 *     <section class="idx-vol-card idx-vol-card--notice"> を生成し、summary 相当の
 *     <header class="idx-vol-head"> だけを入れる（詳細部 body は生成しない・開閉不可）。
 *     状態バッジは「連載中」の代わりに vol.preview.text を pill として表示。
 *     優先順位は完結 > 予告 > 連載中（完結と予告の併存は story-integrity (e) 強化で禁止）。
 *   - **ep.preview（要件 06-7 予告 ep）**：公開済み sec がゼロの ep で ep.preview があれば、
 *     タイトルと <span class="idx-ep-notice"> の予告テキストのみ描画する（sec chip なし・リンクなし）。
 *   - **部分公開 ep（B-1 ゴースト chip・要件 06-7）**：公開 sec 1つ以上 かつ 未公開 sec 1つ以上 の ep
 *     では、公開 chip の末尾に未公開 sec 分の ghost chip（<span class="idx-chip idx-chip--ghost">・
 *     破線グレー・href なし・aria-hidden="true"）を並べて「まだ続く」を示す。全 sec 公開の ep には
 *     出ない（＝vol/物語完結時は視覚差なし・要件 06-7 で明示された B-1 の既知の欠点）。
 *   - 表示可能な ep（＝公開済み sec が1つ以上 OR ep.preview を持つ ep）も公開あとがきも vol.preview も
 *     持たない vol は巻カードごと非表示。visibleEps ベースで判定するため、ep.preview だけを持つ
 *     vol は表示される。
 *   - 各 vol の episodes 直後に、vol.afterword.published=true のときのみあとがきチップを差し込む
 *     （href は contents/vol[XX]-afterword.html、既読/読破マークはキー "vol01-af" で照合）
 *   - **表紙ギャラリー（要件 06-7）**：現在 stage から過去の表紙へ ← → で往復できる（完結 stage は
 *     完結カードを起点に 5 枚）。未来の巻は出さない。stage 1 はナビごと隠す。閲覧位置は永続化せず、
 *     **stage 由来の状態（heroCard キャッシュ・data-story-stage・favicon・巻カードの open）とは切り離す**
 *     ＝過去の表紙を見ても次回の初期表示は現在 stage のまま。PC はホバーでボタン、スマホはスワイプ
 *     （ボタンは DOM に残す＝キーボード・支援技術から操作できる）。
 *   - stage 別ヒーローカード切替：computeStoryStage(read, story) → dataset.storyStage、
 *     stage N（N=1..story.length）→ vol.heroCard.file、stage story.length+1（物語完結）→ 最終 vol の heroCardCompleted.file
 *     （画像は #idx-hero-img の src を差し替え。CLAUDE.md「単一要素のセレクタに class を使わない」）
 *   - ep タイトル・栞の場所表示の |漢字《かんじ》 をルビ展開（applyRuby＝src/ruby.ts）
 *   - **付録カード（要件 06-7）**：巻カードと栞の間の <details id="idx-appendix">（静的 markup・初期は閉じる）。
 *     キャラクター紹介ボタンは、押された時点の Stage（computeStoryStage）を charaPopup.open() に渡す
 *     （Stage から登録を引く規則は characters.ts。characters.json は initAppendix が自分で取得し、
 *     取得に失敗したらキャラクター紹介のボタンを隠す）。エシュカ地図ボタンは initAppendixMap が同期で結線し
 *     mapPopup.open() を呼ぶ（取得するデータが無いので initAppendix とは別関数＝その早期 return に巻き込まれない）。
 *     用語集チップは別ページ（glossary.html）への <a> で、initAppendixGlossary が withQuery で href を付け直す
 *     （?dev の引き継ぎ。story.json の取得より前に同期で行う）。
 *     項目は「設定」（キャラクター紹介・エシュカ地図・用語集）と
 *     「リンク」（X・カクヨム・小説家になろう）の 2 つ。Escape は initFab のキー処理が最優先で閉じる
 *   - 到達セット・読了セットは本文 sec キー（"EP-SEC"）とあとがきキー（"vol[XX]-af"）が同じ Set に入る
 *     ＝core/storage の loadReachedKeys / loadReadKeys が localStorage キー "reached" / "read" をそのまま Set 化する
 *   - 栞欄を固定3スロット表示：スロット0＝オートセーブ（本編／あとがきのうち savedAt が新しい方を表示）
 *   - 続きから読む：getLatestAutoSave（core/storage）で本編／あとがき union を取り、pendingJump または pendingJumpAfterword を書いて遷移
 *   - **コンテンツ更新履歴（要件 06-7）**：changelog/content-changelog.json を記述順のまま全件 li に描き、
 *     各 li に data-kind（versionKind＝core/changelog。title.ts と共有）を付ける。#content-changelog-filter の
 *     版種別スイッチ（メジャー／マイナー／パッチの独立トグル・aria-pressed。初期値メジャー＋マイナー・永続化しない）と
 *     「すべて表示」の展開状態から、_applyChangelogFilter が hidden・空表示・トグルボタンを一括で決める
 *     （初期 CHANGELOG_INITIAL_COUNT 件は絞り込み後に数える）
 *
 * localStorage キー:
 *   栞・既読・読破・オートセーブ・pendingJump・schemaVersion の契約は core/storage.ts が持つ（本文側と共有）。
 *   表示設定（"lirmena.*" の 5 項目と "lirmena.readingAnchor"）の契約は core/settings-model.ts が持つ。
 *   目次だけが書くキー:
 *   "lirmena.heroCard"     : string   ヒーローカード画像の相対パス "vol[XX]/<file>"。applyStoryStage が書き、
 *                            index.html の早期 <script> が次回ロードのパース時点で読む（初期表示のちらつき回避）。
 *                            検証規則 HERO_CARD_RE は HTML 側と同一＝片方だけ直すと静かに vol01 へ落ちる。
 */

// _characters.css / _map.css は toc.css より前に読み込む：#characters-overlay と #map-overlay の z-index は
// 両方が同じ ID 指定で書いており後勝ちになる。toc.css 側の 200（FAB の 100 より上）を勝たせるため、
// この順序を崩さないこと。
import './styles/_characters.css';
import './styles/_map.css';
import './styles/toc.css';
import * as storage from './core/storage';
import type { LatestAutoSave } from './core/storage';
import { loadSettings, removeSettings, saveSetting, saveSettings, PRESETS } from './core/settings-model';
import { withQuery } from './core/query';
import { hasEffectivePreview } from './core/preview';
import { versionKind, type VersionKind } from './core/changelog';
import * as settingsPanel from './ui/settings-panel';
import * as share from './ui/share';
import { applyRuby } from './ruby';
import * as charaPopup from './characters';
import * as mapPopup from './map';
import { computeStoryStage, resolveHeroCard, HERO_CARD_RE } from './volumes';
import type { CharactersData } from './types';

// preview（vol/ep 単位の予告テキスト・要件 06-7）は任意。**text が非空**のときのみ「予告あり」扱いで
// 目次に表示する。空 text（`{ text: "" }`）は「preview 無し」と同義扱いで、事前配置テンプレとして
// 未着手 vol/ep に骨組みだけ置ける（story-integrity (j)(k)(k')(l)/(e) の判定も「非空 text」でのみ発火）。
// 目次では sec chip の代わりにタイトル＋予告テキストを出す（ep）／summary 相当のヘッダのみ出す（vol）。
type Preview = { text: string };
// 「非空 text」の判定は core/preview の hasEffectivePreview（story-integrity と同じ関数）。
type Episode = { id: number; title: string; sections: { id: number; published: boolean }[]; preview?: Preview };
// story.json のトップレベル vol エントリ（index.ts の独立方針でローカル定義。詳細は types.ts の Volume）。
// stage 判定・あとがき描画・ヒーローカード切替・予告描画に必要なフィールドを最小限持つ。
type StoryVolume = {
    volume: number;
    epRange: [number, number];
    heroCard: { file: string };
    heroCardCompleted?: { file: string };
    afterword: { published: boolean };
    episodes: Episode[];
    preview?: Preview;
};
type ContentChangelogEntry = {
    version: string;
    date: string;
    change: string;
    ep: number[];
    sha: string[];
};
type SiteChangelogEntry = {
    version: string;
    date: string;
    changes: string[];
};

// ヒーローカード画像の相対パス（"vol[XX]/<file>"）。applyStoryStage と本文側 main.ts が書き、
// index.html の早期 <script> が次回ロードのパース時点で読む＝初期表示のちらつき回避
// （lirmena.storyStage と同じ流儀）。値の解決と検証規則は volumes.ts に置く（本文側と共用するため）。
const LS_HERO_CARD             = 'lirmena.heroCard';

const GITHUB_REPO = 'haguchikarasu/lirmena';
// 短縮 sha の形。content-changelog.json の sha は「本体コミット確定後に手で入れる」運用なので、
// 未確定プレースホルダや欠損のまま公開され得る。その状態で commit/undefined を指すリンクを作らない判定。
const SHORT_SHA_RE = /^[0-9a-f]{7,40}$/;

let _episodes: Episode[] = [];
const CHANGELOG_INITIAL_COUNT = 3;

const pad = (n: number) => String(n).padStart(2, '0');

// ----- 既読/読破判定 -----

// sec 単位キー "EP-SEC" が集合に含まれるか
function isSectionInSet(ep: number, sec: number, set: Set<string>): boolean {
    return set.has(`${pad(ep)}-${pad(sec)}`);
}

// あとがきキー "vol[XX]-af" が集合に含まれるか
function isAfterwordInSet(vol: number, set: Set<string>): boolean {
    return set.has(storage.afterwordKey(vol));
}

// 読破状況のクリア（core/storage の clearRead）に、目次だけが持つヒーローカードのキャッシュの削除を足す。
function clearReadStatus(): void {
    storage.clearRead();
    // stage が 1 に戻るのでヒーローカードのキャッシュも捨てる。直後に applyStoryStage が呼ばれて上書き
    // されるが、story が空・heroFile 未解決のときは src を触らずに抜けるため古い値が残りうる。
    localStorage.removeItem(LS_HERO_CARD);
}

function confirmAndRun(msg: string, run: () => void): void {
    if (window.confirm(msg)) run();
}

// pendingJump（本編）または pendingJumpAfterword（あとがき）を書く（union 対応）
function writeResumeJump(latest: LatestAutoSave): void {
    if (latest.kind === 'afterword') {
        storage.writePendingJumpAfterword({ vol: latest.vol, ratio: latest.ratio });
    } else {
        storage.writePendingJump({ ep: latest.ep, sec: latest.sec, scene: 0, ratio: latest.ratio });
    }
}

// オートセーブ位置へ遷移する（union 対応）
function resumeReading(latest: LatestAutoSave): void {
    writeResumeJump(latest);
    const url = latest.kind === 'afterword'
        ? withQuery(`contents/vol${pad(latest.vol)}-afterword.html`)
        : withQuery(`contents/${pad(latest.ep)}-${pad(latest.sec)}.html`);
    location.href = url;
}

// ヒーロー下の「続きから読む」本体ボタン初期化。本編・あとがきのどちらか新しい方を採用する。
function initResumeButton(): void {
    const btn = document.getElementById('idx-resume') as HTMLButtonElement | null;
    if (!btn) return;
    const latest = storage.getLatestAutoSave();
    if (!latest) return;
    btn.hidden = false;
    btn.addEventListener('click', () => resumeReading(latest));
}

// ----- 物語進行段階＆ヒーローカード切替 -----

// stage を <html data-story-stage> に反映し、対応するヒーローカード画像へ差し替える。
// - stage N（1 ≤ N ≤ story.length） → story.find(v => v.volume === N)?.heroCard.file
// - stage story.length + 1（物語完結） → 最終 vol（volume 番号最大）の heroCardCompleted.file
// read セットは本文 sec キーとあとがきキーの混在だが、computeStoryStage が
// 本文 sec 用 regex でフィルタするためあとがきキーは stage 判定に影響しない。
function applyStoryStage(story: StoryVolume[]): void {
    if (story.length === 0) return;
    // localStorage を直読みして最新の read セットを取る（storage.loadReadKeys）。storage.getRead() は
    // モジュール内メモリキャッシュ（storage.init 時に固定）を返すため、目次内で「読破状況を
    // クリア」した直後の再計算では古いキャッシュを返してしまう恐れがある。目次は他の表示 API も
    // localStorage 直読みで統一しているのでこちらへ寄せる。
    const read = Array.from(storage.loadReadKeys());
    // computeStoryStage は types.ts の StoryData を受けるが、index.ts のローカル StoryVolume は
    // 判定に必要なフィールド（volume, epRange, episodes.sections.published）を全て持つため構造的互換。
    const stage = computeStoryStage(read, story as unknown as Parameters<typeof computeStoryStage>[1]);
    document.documentElement.dataset.storyStage = String(stage);
    // 次回ロード時の FOUC 回避用にキャッシュ。本文シェル雛形（reader.html/title.html）の早期 <script> が
    // 起動前に読み取り <html data-story-stage> を先付けする。値は 1〜5 の文字列のみ。
    try { localStorage.setItem('lirmena.storyStage', String(stage)); } catch {}

    // stage → 表紙画像の解決は volumes.ts に置く。**本文側（main.ts）も同じ関数でキャッシュを更新する**
    // ため、ここに解決ロジックを抱えると二重管理になる（computeStoryStage を共用しているのと同じ理由）。
    const hero = resolveHeroCard(stage, story as unknown as Parameters<typeof resolveHeroCard>[1]);
    if (hero) {
        const volStr = String(hero.volume).padStart(2, '0');
        // Vite dev サーバは public/ 配下を root（BASE_URL 直下）で配信し、build も dist/{BASE_URL}vol[XX]/ に
        // ファイルを配置する。JS 側の src 差し替えは Vite の import.meta.env.BASE_URL 経由で解決する
        // （JS 側の literal は Vite の rewrite 対象外＝本番で 404 になるため BASE_URL 必須。HTML 側は
        // src 属性を持たず早期 <script> が入れる＝ちらつき回避のため。index.html のコメント参照）。
        const heroImg = document.querySelector<HTMLImageElement>('#idx-hero-img');
        if (heroImg) heroImg.src = `${import.meta.env.BASE_URL}${hero.rel}`;
        // 次回ロードの初期表示用にキャッシュ（index.html の早期 <script> が読む）。base を含めない相対形で
        // 持つのは base を HTML と TS の二箇所にハードコードしないため（favicon の href と同じ流儀）。
        // **読取側と同じ規則で検証**し、通らない値は残さない（保存できるのに読めない非対称を作らない）。
        try {
            if (HERO_CARD_RE.test(hero.rel)) localStorage.setItem(LS_HERO_CARD, hero.rel);
            else localStorage.removeItem(LS_HERO_CARD);
        } catch { /* noop */ }
        // favicon も stage の属する vol の物へ差し替える。命名は vol[XX]/favicon[N].png で N=stage
        // （stage 1〜story.length は vol.volume と一致、stage story.length+1＝完結時は最終 vol 直下の
        // favicon[story.length+1].png を参照＝完結専用ファイルは最終 vol にのみ併置する）。
        const favicon = document.querySelector<HTMLLinkElement>('#app-favicon');
        if (favicon) favicon.href = `${import.meta.env.BASE_URL}vol${volStr}/favicon${stage}.png`;
    }

    // 表紙ギャラリーの履歴を作り直し、**閲覧位置は最新へ戻す**（stage が変わったのに古い位置へ
    // 留まらない）。イベント登録は _wireHeroGalleryOnce が 1 度だけ行うので、この関数は
    // 「読破状況をクリア」で再実行されても安全（＝冪等）。
    _rebuildHeroGallery(stage, story);
}

// ----- 表紙ギャラリー（要件 06-7）-----
// **閲覧位置は stage ではない。** 過去の表紙を見ている間も、stage 由来の状態は現在 stage のまま保つ：
//   ・localStorage 'lirmena.heroCard'（次回ロードの初期表示）
//   ・<html data-story-stage> と、そこから派生するキーカラー
//   ・favicon
//   ・巻カードの初期 open
// ここを混ぜると「過去の表紙が次回の初期表示として保存される」＝ちらつき修正そのものが壊れる。
// そのため書き込み系（キャッシュ・favicon・dataset）は applyStoryStage だけが行い、以下の関数群は
// #idx-hero-img の src/alt とナビの見た目しか触らない。

// ギャラリーの 1 コマ。stage は物語進行段階、volume は画像の置き場所（vol[XX]/）、rel は BASE_URL からの相対パス。
type HeroShot = { stage: number; volume: number; rel: string; label: string };

// [0] が現在 stage の表紙で、末尾が第1巻。**未来の巻は入れない**（ネタバレ）。
let _heroShots: HeroShot[] = [];
// 閲覧位置。0 = 最新。**永続化しない**＝再訪時は必ず最新から始まる。
let _heroPos = 0;
// イベント登録は 1 度だけ。applyStoryStage は「読破状況をクリア」でも再実行されるので、ここで
// ガードしないとクリックやスワイプが 2 回・3 回と多重に発火する。
let _heroWired = false;
// 画像の読み込み（decode）中だけ立てるフラグ。ここで弾かないと前面と背面のレイヤーが入れ違う。
// **スライド中（CSS transition）は弾かない**：300ms のあいだ操作を捨てると「押したのに動かない」に
// なるので、進行中のスライドは _finishHeroSlide で即座に畳んでから次へ進む。
let _heroBusy = false;
// 進行中スライドの後始末タイマー。次の操作が来たら打ち消して即座に畳む。
let _heroSlideTimer: number | null = null;
// 遷移の世代。decode やフレーム待ちの最中に次の操作が来たら、古い遷移は自分の描画を諦めて降りる
// （降りないと新しい遷移の途中で古い transform を書き込んでしまう）。
let _heroGen = 0;

// スタイルの確定を挟んで次の描画フレームまで待つ（double rAF）。
// transition を有効にしたのと同じフレームで transform まで変えると、ブラウザが開始値を取り違えて
// アニメーションを飛ばすことがある。1 フレーム空けて開始値を確実に固定する。
// _nextFrame(): Promise<void>
function _nextFrame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); });
    });
}

// toc.css の transition と対の値。片方だけ変えるとスライドが途中で切れる（同期を見る検査は無い）。
const HERO_SLIDE_MS = 300;
// スワイプと判定する最小の横移動量。モックで手触りを確認して決めた。
const HERO_SWIPE_MIN_PX = 45;

// stage の表示名。物語完結 stage（story.length + 1）だけ「完結」で、他は「第N巻」。
function _heroLabel(stage: number, volCount: number): string {
    return stage > volCount ? '完結' : `第${stage}巻`;
}

// 現在 stage から遡れる表紙を新しい順に並べる。stage を 1 つずつ下げて resolveHeroCard に解かせるので、
// 完結カード（最終 vol の heroCardCompleted）も自然に先頭へ入る。
// _buildHeroShots(stage: number, story: StoryVolume[]): HeroShot[]
function _buildHeroShots(stage: number, story: StoryVolume[]): HeroShot[] {
    const data = story as unknown as Parameters<typeof resolveHeroCard>[1];
    const shots: HeroShot[] = [];
    for (let s = stage; s >= 1; s--) {
        const ref = resolveHeroCard(s as Parameters<typeof resolveHeroCard>[0], data);
        if (!ref) continue;
        shots.push({ stage: s, volume: ref.volume, rel: ref.rel, label: _heroLabel(s, story.length) });
    }
    return shots;
}

// 履歴の作り直し。何度呼んでも同じ状態になる（イベント登録は _wireHeroGalleryOnce 側でガード）。
// _rebuildHeroGallery(stage: number, story: StoryVolume[]): void
function _rebuildHeroGallery(stage: number, story: StoryVolume[]): void {
    _heroShots = _buildHeroShots(stage, story);
    _heroPos = 0;
    const img = document.querySelector<HTMLImageElement>('#idx-hero-img');
    if (img && _heroShots.length > 0) img.alt = `${_heroShots[0].label}の表紙`;
    _wireHeroGalleryOnce();
    _renderHeroNav();
}

// ナビの見た目だけを現在の閲覧位置に合わせる。履歴が 1 枚（stage 1）ならボタンごと隠す。
// _renderHeroNav(): void
function _renderHeroNav(): void {
    const newer = document.querySelector<HTMLButtonElement>('#idx-hero-newer');
    const older = document.querySelector<HTMLButtonElement>('#idx-hero-older');
    const dots = document.querySelector<HTMLElement>('#idx-hero-dots');
    const many = _heroShots.length > 1;
    if (newer) { newer.hidden = !many; newer.disabled = _heroPos <= 0; }
    if (older) { older.hidden = !many; older.disabled = _heroPos >= _heroShots.length - 1; }
    if (!dots) return;

    dots.textContent = '';
    if (!many) return;
    for (let i = 0; i < _heroShots.length; i++) {
        const dot = document.createElement('span');
        dot.className = 'idx-hero-dot';
        dot.setAttribute('aria-hidden', 'true');
        if (i === _heroPos) dot.dataset.on = '1';
        dots.appendChild(dot);
    }
    // ドットは装飾なので、同じ情報を読み上げ用の文言でも置く（aria-live="polite" は HTML 側）。
    const sr = document.createElement('span');
    sr.className = 'idx-sr-only';
    sr.textContent = `${_heroShots[_heroPos].label}の表紙（${_heroPos + 1} / ${_heroShots.length}）`;
    dots.appendChild(sr);
}

// 表紙を delta 枚ぶん動かす（+1 = 過去へ、-1 = 新しい方へ）。端では何もしない。
// _goHero(delta: number): Promise<void>
async function _goHero(delta: number): Promise<void> {
    if (_heroBusy) return;
    // 進行中のスライドがあれば先に畳む＝連打しても 1 枚ずつ確実に進む
    _finishHeroSlide();
    const next = _heroPos + delta;
    if (next < 0 || next >= _heroShots.length) return;
    const card = document.querySelector<HTMLElement>('#idx-hero-card');
    const img = document.querySelector<HTMLImageElement>('#idx-hero-img');
    const prev = document.querySelector<HTMLImageElement>('#idx-hero-prev');
    if (!card || !img || !prev) return;

    _heroBusy = true;
    const gen = ++_heroGen;
    const shot = _heroShots[next];
    const dir = delta > 0 ? 1 : -1;   // 過去へ進むときは新しい絵が右から入る

    // 1. 去っていく絵を背面へ写す。currentSrc はブラウザキャッシュに載っているので即座に出る。
    prev.src = img.currentSrc || img.src;
    prev.style.transition = 'none';
    prev.style.transform = 'translateX(0)';
    prev.style.opacity = '1';

    // 2. 前面を画面外へ出してから読み込む。**画面内のまま src を差し替えると読み込み中に絵が消える**
    //    （過去の表紙は押されて初めて取得するので、ここで必ず待ちが入る）。
    img.style.transition = 'none';
    img.style.transform = `translateX(${dir * 100}%)`;
    // **transition を切ったまま、ここで開始位置を確定させる**。この確定を後回しにすると、transition を
    // 有効にした直後の確定が「0% → 100%」のアニメを走らせてしまい、続く 0% 指定と打ち消し合って
    // スライドが起きない。decode がキャッシュで即返るときだけ顕在化するので、
    // 「スマホで時々スライドせずに切り替わる」という形で出た（2026-09-09）。
    void img.offsetWidth;
    void prev.offsetWidth;

    img.src = `${import.meta.env.BASE_URL}${shot.rel}`;
    img.alt = `${shot.label}の表紙`;
    try { await img.decode(); } catch { /* 404 等でも遷移は進める */ }
    _heroBusy = false;
    if (gen !== _heroGen) return;   // 待っている間に次の操作が来た＝この遷移は捨てる

    // 3. スライド。時間とイージングは toc.css が data-hero-anim で持ち、ここは向きだけを与える。
    card.dataset.heroAnim = '1';
    img.style.transition = '';
    prev.style.transition = '';
    await _nextFrame();
    if (gen !== _heroGen) return;
    img.style.transform = 'translateX(0)';
    prev.style.transform = `translateX(${dir * -100}%)`;

    _heroPos = next;
    _renderHeroNav();

    _heroSlideTimer = window.setTimeout(_finishHeroSlide, HERO_SLIDE_MS);
}

// 進行中のスライドを畳む。タイマー満了で呼ばれるほか、次の操作が来たときにも前倒しで呼ぶ。
// 何度呼んでも安全（冪等）。
// _finishHeroSlide(): void
function _finishHeroSlide(): void {
    if (_heroSlideTimer !== null) {
        window.clearTimeout(_heroSlideTimer);
        _heroSlideTimer = null;
    }
    const card = document.querySelector<HTMLElement>('#idx-hero-card');
    const prev = document.querySelector<HTMLImageElement>('#idx-hero-prev');
    if (card) delete card.dataset.heroAnim;
    if (prev) {
        prev.style.transition = 'none';
        prev.style.opacity = '0';
        prev.style.transform = 'translateX(0)';
    }
}

// 設定・共有ポップアップが開いているか。開いている間はギャラリーのキー操作を譲る。
// _isPopupOpen(): boolean
function _isPopupOpen(): boolean {
    return settingsPanel.isOpen() || share.isOpen();
}

// クリック・キー・スワイプの登録。**1 度だけ**行う（applyStoryStage は再実行されるため）。
// _wireHeroGalleryOnce(): void
function _wireHeroGalleryOnce(): void {
    if (_heroWired) return;
    const card = document.querySelector<HTMLElement>('#idx-hero-card');
    if (!card) return;
    _heroWired = true;

    document.querySelector('#idx-hero-newer')?.addEventListener('click', () => { void _goHero(-1); });
    document.querySelector('#idx-hero-older')?.addEventListener('click', () => { void _goHero(1); });

    // ← → は**カード内にフォーカスがあるときだけ**拾う。document で拾うと、設定・共有ポップアップや
    // FAB を操作している最中にも表紙が動く（FAB は ArrowUp/Down、ポップアップは Escape を使っている）。
    card.addEventListener('keydown', (e) => {
        if (_isPopupOpen()) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); void _goHero(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); void _goHero(-1); }
    });

    // スワイプ。縦移動のほうが大きいときは何もしない＝ページのスクロールを邪魔しない。
    let sx = 0;
    let sy = 0;
    let tracking = false;
    card.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;   // PC はボタンで操作する
        sx = e.clientX; sy = e.clientY; tracking = true;
    });
    card.addEventListener('pointerup', (e) => {
        if (!tracking) return;
        tracking = false;
        const dx = e.clientX - sx;
        const dy = e.clientY - sy;
        if (Math.abs(dx) < HERO_SWIPE_MIN_PX) return;
        if (Math.abs(dx) < Math.abs(dy)) return;
        void _goHero(dx < 0 ? 1 : -1);   // 左へ払う＝過去へ（右のボタンと同じ向き）
    });
    card.addEventListener('pointercancel', () => { tracking = false; });
    card.addEventListener('dragstart', (e) => { e.preventDefault(); });
}

// ----- 目次本体（vol カード → ep → sec、直後にあとがきチップ） -----

// story を vol 単位でループして目次を描画する。通常 vol は <details class="idx-vol-card">、
// vol.preview を持つ予告 vol は <section class="idx-vol-card idx-vol-card--notice"> で描画する。
// 初期 open は computeStoryStage(read, story) と vol.volume が一致する巻のみ
// （storyStage === story.length + 1 の物語完結時は全 vol 閉じる）。開閉状態は永続化しない。
// vol 単位の非表示：visibleEps（公開 sec を持つ ep + ep.preview を持つ ep）もあとがきも vol.preview も
// 持たない vol は巻カード自体非表示。優先順位は完結 > 予告 > 連載中（integrity (e) 強化で完結×予告は禁止）。
function renderStory(story: StoryVolume[], reached: Set<string>, read: Set<string>): void {
    const area = document.getElementById('episodes-area');
    if (!area) return;
    area.innerHTML = '';

    // 初期 open 判定用の storyStage を1回だけ算出（あとがきキーは stage 判定に影響しない・要件 06-5）。
    // computeStoryStage は types.ts の StoryData（Volume[]）を受けるが、ローカル StoryVolume は判定に必要な
    // フィールド（volume・epRange・episodes.sections.published）を全て持つため構造互換（applyStoryStage と同流儀）。
    const storyStage = computeStoryStage(
        Array.from(read),
        story as unknown as Parameters<typeof computeStoryStage>[1],
    );

    for (const vol of story) {
        // 表示可能な ep：公開 sec が1つ以上 OR **非空** ep.preview を持つ。
        // 空 text preview（`{ text: "" }`）は事前配置テンプレなので「予告 ep」として扱わない
        // ＝publishedSecs も preview も無い ep と同じで非表示（vol カードごと非表示条件にも寄与）。
        // publishedSecs は sec chip 描画の入力、hasPreview は予告 ep 描画の分岐に使う。
        const visibleEps = vol.episodes
            .map(ep => ({
                ep,
                publishedSecs: ep.sections.filter(s => s.published),
                hasPreview: hasEffectivePreview(ep.preview),
            }))
            .filter(x => x.publishedSecs.length > 0 || x.hasPreview);
        const hasAfterword = vol.afterword?.published === true;
        const hasVolPreview = hasEffectivePreview(vol.preview);
        // vol 単位の非表示：表示可能な ep も vol.preview もあとがきも無い vol は巻カードを出さない
        if (visibleEps.length === 0 && !hasAfterword && !hasVolPreview) continue;

        // 予告 vol は <details> ではなく <section> ＋ ヘッダのみ生成し、開閉不可・body 非生成にする。
        // vol.preview は「予告」用途で、完結と併存する状況は integrity (e) 強化で禁止。
        if (hasVolPreview && !hasAfterword) {
            const card = document.createElement('section');
            card.className = 'idx-vol-card idx-vol-card--notice';
            card.appendChild(_buildVolHead(vol, hasAfterword, visibleEps.length));
            area.appendChild(card);
            continue;
        }

        // 通常 vol：<details> でグルーピング。open 属性で初期表示を制御し、以後の開閉はブラウザ標準に委ねる。
        const card = document.createElement('details');
        card.className = 'idx-vol-card';
        if (vol.volume === storyStage) card.open = true;
        card.appendChild(_buildVolHead(vol, hasAfterword, visibleEps.length));

        // 本体：ep ブロック（既存の idx-ep / idx-chip をそのまま使う）＋巻末あとがき
        const body = document.createElement('div');
        body.className = 'idx-vol-body';

        for (const { ep, publishedSecs, hasPreview } of visibleEps) {
            body.appendChild(_buildEpBlock(ep, publishedSecs, hasPreview, reached, read));
        }

        // 巻末あとがきチップ（vol.afterword.published=true のときのみ）
        if (hasAfterword) {
            body.appendChild(_buildAfterwordBlock(vol, reached, read));
        }

        card.appendChild(body);
        area.appendChild(card);
    }

    if (area.children.length === 0) {
        const msg = document.createElement('p');
        msg.className = 'loading-text';
        msg.textContent = '公開中のエピソードはまだありません。';
        area.appendChild(msg);
    }
}

// vol の summary 相当ヘッダ（chev / 巻見出し / 状態バッジ）を生成する。
// 通常 vol は <details> の <summary>、予告 vol は <section> の <header> として使う。
// タグは <summary>（<details> 用）か <div>（<section> 用）を返せば済むが、両者は用途が違うので
// クラス名で解決する（<summary> でないと <details> の開閉ハンドラが繋がらない）。
// pill の中身は「完結 > 予告 > 連載中」の優先順位で決める（完結と予告の併存は integrity (e) 強化で禁止）。
function _buildVolHead(vol: StoryVolume, hasAfterword: boolean, visibleEpsCount: number): HTMLElement {
    const hasVolPreview = hasEffectivePreview(vol.preview);
    // 予告 vol は <header>、通常 vol は <summary>（<details> の toggle に必要）。同じ .idx-vol-head クラスを共有し、
    // CSS 側で .idx-vol-card--notice > .idx-vol-head の cursor/hover を打ち消す。
    // <header> は必ず <section class="idx-vol-card--notice"> の内側に置くこと：セクショニング要素の外に出すと
    // ARIA ロールが banner にマップされ、ページに2つ目のランドマークが静かに生える。
    const head = hasVolPreview && !hasAfterword
        ? document.createElement('header')
        : document.createElement('summary');
    head.className = 'idx-vol-head';

    const chev = document.createElement('span');
    chev.className = 'idx-vol-chev';
    chev.setAttribute('aria-hidden', 'true');
    chev.textContent = '▶';
    head.appendChild(chev);

    const kEl = document.createElement('span');
    kEl.className = 'idx-vol-k';
    kEl.textContent = `第${vol.volume}巻`;
    head.appendChild(kEl);

    const pill = document.createElement('span');
    pill.className = 'idx-vol-pill';
    if (hasAfterword) {
        // 「巻完結」＝当 vol の全 ep 全 sec 公開（story-integrity の (e)/(e') により vol.afterword.published と同義）。
        // pill 表示テキストには「巻完結」を出さず「全M話」だけ（判定名としてだけ使い分ける・要件 06-7）
        pill.textContent = `全${visibleEpsCount}話`;
    } else if (hasVolPreview) {
        pill.classList.add('idx-vol-pill--notice');
        pill.textContent = vol.preview!.text;
    } else {
        pill.textContent = '連載中';
    }
    head.appendChild(pill);

    return head;
}

// ep 1個分のブロック（タイトル＋sec chip 群 or 予告テキスト）を生成する。
// publishedSecs が空 かつ hasPreview=true の場合は ep.preview を <span class="idx-ep-notice"> で描画。
// それ以外は従来通り公開 sec の chip 群を描画し、**部分公開 ep**（公開 sec 1つ以上 かつ 未公開 sec
// 1つ以上）では続けて未公開 sec を ghost chip（.idx-chip--ghost・破線グレー・非リンク・aria-hidden）
// として末尾に並べて「まだ続く」を示唆する（案 B-1・要件 06-7「部分公開 ep のゴースト chip」）。
// 完全公開 ep ではゴースト chip は生成されず vol/物語完結時は視覚差ゼロ（B-1 の既知の欠点）。
// 両者混在ケース（公開 sec 有り + 非空 ep.preview）は integrity (l) で禁止＝発生しない。
// ep タイトルは prefix span（.idx-ep-prefix「第◯話」）＋半角スペースのテキストノード＋
// 本体（applyRuby でルビ展開する ep.title）の 3 ノード構成（要件 06-7）。
// prefix は本体よりトーンを落とす（CSS の opacity で親色継承・stage 非依存）。
// applyRuby の正規表現は `|` と `《》` を要求するので prefix には副作用ゼロ＝本体だけに適用しても挙動不変。
function _buildEpBlock(
    ep: Episode,
    publishedSecs: { id: number; published: boolean }[],
    hasPreview: boolean,
    reached: Set<string>,
    read: Set<string>,
): HTMLElement {
    const epEl = document.createElement('article');
    epEl.className = 'idx-ep';

    const titleEl = document.createElement('p');
    titleEl.className = 'idx-ep-title';
    const prefixEl = document.createElement('span');
    prefixEl.className = 'idx-ep-prefix';
    prefixEl.textContent = `第${ep.id}話`;
    titleEl.appendChild(prefixEl);
    titleEl.appendChild(document.createTextNode(' '));
    applyRuby(ep.title, titleEl);
    epEl.appendChild(titleEl);

    const chipsEl = document.createElement('div');
    chipsEl.className = 'idx-chips';

    if (publishedSecs.length === 0 && hasPreview) {
        // 予告 ep：sec chip は生成せず、破線ボックスで予告テキストのみ出す
        epEl.classList.add('idx-ep--preview');
        const notice = document.createElement('span');
        notice.className = 'idx-ep-notice';
        notice.textContent = ep.preview!.text;
        chipsEl.appendChild(notice);
    } else {
        // 通常 ep：公開 sec を chip で並べる
        for (const sec of publishedSecs) {
            const isReached = isSectionInSet(ep.id, sec.id, reached);
            const isRead = isSectionInSet(ep.id, sec.id, read);

            const link = document.createElement('a');
            link.className = 'idx-chip'
                + (isReached ? ' idx-chip--reached' : '')
                + (isRead ? ' idx-chip--read' : '');
            link.href = sec.id === 1
                ? withQuery(`contents/${pad(ep.id)}-00.html`)
                : withQuery(`contents/${pad(ep.id)}-${pad(sec.id)}.html`);

            const labelEl = document.createElement('span');
            labelEl.textContent = pad(sec.id);
            if (isRead) link.setAttribute('aria-label', `${pad(sec.id)} 読破`);
            else if (isReached) link.setAttribute('aria-label', `${pad(sec.id)} 既読`);
            link.appendChild(labelEl);

            chipsEl.appendChild(link);
        }

        // 未公開 sec を破線グレーの ghost chip として末尾に並べる（案 B-1・部分公開 ep の未完示唆）。
        // rule (d) が「未公開 sec は末尾のみ」を保証しているため story.json 定義順そのまま append する
        // だけで公開 chip の後ろに整列する。href なし・非リンク・既読/読破マーク／aria-label なし。
        // ghost は視覚シグナル専用（非コンテンツ・非対話）なので aria-hidden="true" で支援技術には
        // 隠す — 非視覚読者は公開 chip 列だけをナビ導線として認識する形にする。
        for (const sec of ep.sections.filter(s => !s.published)) {
            const ghost = document.createElement('span');
            ghost.className = 'idx-chip idx-chip--ghost';
            ghost.setAttribute('aria-hidden', 'true');

            const labelEl = document.createElement('span');
            labelEl.textContent = pad(sec.id);
            ghost.appendChild(labelEl);

            chipsEl.appendChild(ghost);
        }
    }

    epEl.appendChild(chipsEl);
    return epEl;
}

// 巻末あとがきチップ（vol.afterword.published=true のときのみ呼ばれる）を生成する。
// ep タイトルは巻情報なしの「あとがき」だけ（巻カード内に置かれるので巻情報は summary の「第N巻」で足りる）。
// chip の視覚 label は `**`（視覚シンボル・aria-hidden で支援技術からは隠す）／link の aria-label は
// 「第N巻 あとがき」を巻ごとに必ず含める（複数完結巻それぞれに `**` chip がある場合の識別可能性を担保・
// 未読／既読／読破の 3 分岐すべてで常時セット）。本文ページ側 `#btn-afterword` の「第◯巻あとがき」表記
// とは意図的に非対称（要件 06-7）。
function _buildAfterwordBlock(vol: StoryVolume, reached: Set<string>, read: Set<string>): HTMLElement {
    const afterwordEl = document.createElement('article');
    afterwordEl.className = 'idx-ep idx-ep--afterword';

    const titleEl = document.createElement('p');
    titleEl.className = 'idx-ep-title';
    titleEl.textContent = 'あとがき';
    afterwordEl.appendChild(titleEl);

    const chips = document.createElement('div');
    chips.className = 'idx-chips';

    const isReached = isAfterwordInSet(vol.volume, reached);
    const isRead = isAfterwordInSet(vol.volume, read);

    const link = document.createElement('a');
    link.className = 'idx-chip'
        + (isReached ? ' idx-chip--reached' : '')
        + (isRead ? ' idx-chip--read' : '');
    link.href = withQuery(`contents/vol${pad(vol.volume)}-afterword.html`);

    const baseAria = `第${vol.volume}巻 あとがき`;
    if (isRead) link.setAttribute('aria-label', `${baseAria} 読破`);
    else if (isReached) link.setAttribute('aria-label', `${baseAria} 既読`);
    else link.setAttribute('aria-label', baseAria);

    const labelEl = document.createElement('span');
    labelEl.textContent = '**';
    labelEl.setAttribute('aria-hidden', 'true');
    link.appendChild(labelEl);
    chips.appendChild(link);

    afterwordEl.appendChild(chips);
    return afterwordEl;
}

// ----- 栞 -----

function fmtDate(savedAt: number): string {
    const d = new Date(savedAt);
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function locLabel(ep: number, sec: number): string {
    const epTitle = _episodes.find(e => e.id === ep)?.title ?? '';
    return epTitle ? `第${ep}話 ${epTitle} #${sec}` : `第${ep}話 #${sec}`;
}

// あとがきのオートセーブ用ラベル：「第◯巻あとがき」
function afterwordLabel(vol: number): string {
    return `第${vol}巻あとがき`;
}

function fmtRatioPercent(ratio: number): string {
    return `${Math.round(ratio * 100)}%`;
}

function buildSlotCard(slotLabel: string, locText: string, dateText: string, actions: HTMLElement | null): HTMLElement {
    const card = document.createElement('article');
    card.className = 'idx-bm-card' + (actions ? '' : ' idx-bm-card--empty');

    const info = document.createElement('div');
    info.className = 'idx-bm-info';

    const slotEl = document.createElement('p');
    slotEl.className = 'idx-bm-slot';
    slotEl.textContent = slotLabel;
    info.appendChild(slotEl);

    const locEl = document.createElement('p');
    locEl.className = 'idx-bm-loc';
    applyRuby(locText, locEl);
    info.appendChild(locEl);

    if (dateText) {
        const dateEl = document.createElement('p');
        dateEl.className = 'idx-bm-date';
        dateEl.textContent = dateText;
        info.appendChild(dateEl);
    }

    card.appendChild(info);
    if (actions) card.appendChild(actions);
    return card;
}

// 栞欄。スロット0＝オートセーブ（本編／あとがき union の新しい方）、スロット1〜3＝手動栞（本編のみ）。
function renderBookmarks(): void {
    const container = document.getElementById('bookmark-slots');
    if (!container) return;
    container.innerHTML = '';

    // スロット0：オートセーブ（本編／あとがきのうち savedAt が新しい方）
    const latest = storage.getLatestAutoSave();
    if (latest) {
        const actions = document.createElement('div');
        actions.className = 'idx-bm-btns';
        const resumeBtn = document.createElement('a');
        resumeBtn.className = 'idx-bm-go';
        resumeBtn.href = latest.kind === 'afterword'
            ? withQuery(`contents/vol${pad(latest.vol)}-afterword.html`)
            : withQuery(`contents/${pad(latest.ep)}-${pad(latest.sec)}.html`);
        resumeBtn.textContent = '続きから読む';
        resumeBtn.addEventListener('click', () => { writeResumeJump(latest); });
        actions.appendChild(resumeBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'idx-bm-del';
        delBtn.type = 'button';
        delBtn.textContent = '削除';
        // 削除は該当オートセーブ（本編／あとがき）のキーを消す
        delBtn.addEventListener('click', () => {
            if (latest.kind === 'afterword') storage.clearAutoSaveAfterword();
            else storage.clearAutoSave();
            renderBookmarks();
        });
        actions.appendChild(delBtn);

        const locText = latest.kind === 'afterword'
            ? `${afterwordLabel(latest.vol)}（${fmtRatioPercent(latest.ratio)}）`
            : `${locLabel(latest.ep, latest.sec)}（${fmtRatioPercent(latest.ratio)}）`;
        const card = buildSlotCard('スロット0：オートセーブ', locText, fmtDate(latest.savedAt), actions);
        card.classList.add('idx-bm-card--auto');
        container.appendChild(card);
    }

    // スロット1〜3：手動栞（本編 sec のみ・あとがきは手動栞対象外）
    const bySlot = new Map(storage.getBookmarksWithSlots().map(b => [b.slot, b]));
    for (let slot = 1; slot <= 3; slot++) {
        const entry = bySlot.get(slot);
        if (!entry) {
            container.appendChild(buildSlotCard(`スロット${slot}`, '空き', '', null));
            continue;
        }

        const { ep, sec, scene } = entry;
        const actions = document.createElement('div');
        actions.className = 'idx-bm-btns';

        const jumpBtn = document.createElement('a');
        jumpBtn.className = 'idx-bm-go';
        jumpBtn.href = withQuery(`contents/${pad(ep)}-${pad(sec)}.html`);
        jumpBtn.textContent = 'ここから読む';
        jumpBtn.addEventListener('click', () => {
            storage.writePendingJump({ ep, sec, scene, ratio: entry.ratio });
        });
        actions.appendChild(jumpBtn);

        const clearBtn = document.createElement('button');
        clearBtn.className = 'idx-bm-del';
        clearBtn.type = 'button';
        clearBtn.textContent = '削除';
        clearBtn.addEventListener('click', () => {
            storage.removeBookmark(entry.slot);
            renderBookmarks();
        });
        actions.appendChild(clearBtn);

        const locText = locLabel(ep, sec) + (scene === 0 ? '（タイトル画面）' : `（${fmtRatioPercent(entry.ratio)}）`);
        container.appendChild(buildSlotCard(`スロット${slot}`, locText, fmtDate(entry.savedAt), actions));
    }
}

// ----- 設定ポップアップ・共有ポップアップ -----

// 設定ポップアップ（ui/settings-panel。markup は templates/parts/settings.html＝本文ページと同じ断片）の host を目次用に結ぶ。
// 目次ページは本文を持たないので CSS 変数・<html data-writing-mode> へは反映せず、localStorage への保存だけを行う
// （反映するのは本文側の settings.ts だけ＝目次が縦書きになる事故が構造的に起きない）。
// 「設定をリセット」は表示設定 5 項目と読書点のキーを消す（removeSettings）。本文側は既定値を書くが、読み手が
// null を既定へ倒すので読者にとっては同値（e2e/settings-reset.spec.ts が目次側のキーの網羅と、本文での解決を見る）。
// Escape で閉じる順番は initFab のキー処理が決めるので、パネル自身には Escape を拾わせない。
// initSettingsPopup(story: StoryVolume[]): void
function initSettingsPopup(story: StoryVolume[]): void {
    settingsPanel.init({
        current: loadSettings,
        select: saveSetting,
        preset: (id) => {
            const preset = PRESETS.find((p) => p.id === id);
            if (preset) saveSettings(preset.values);
        },
        reset: removeSettings,
        clearBookmarks: () => {
            storage.clearSlots();
            renderBookmarks();
        },
        clearReached: () => {
            storage.clearReached();
            renderStory(story, storage.loadReachedKeys(), storage.loadReadKeys());
        },
        clearRead: () => {
            clearReadStatus();
            renderStory(story, storage.loadReachedKeys(), storage.loadReadKeys());
            applyStoryStage(story);
        },
    });
}

// ----- FAB メニュー -----

function initFab(story: StoryVolume[]): void {
    const toggleOrNull = document.getElementById('fab-toggle');
    const panelOrNull  = document.getElementById('fab-panel');
    if (!toggleOrNull || !panelOrNull) return;

    const toggle = toggleOrNull as HTMLButtonElement;
    const panel  = panelOrNull  as HTMLUListElement;

    function isOpen() { return !panel.hidden; }

    function openFab() {
        panel.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', 'メニューを閉じる');
        panel.querySelector<HTMLButtonElement>('.fab-item')?.focus();
    }

    function closeFab() {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'メニューを開く');
    }

    function addItem(label: string, handler: () => void): void {
        const li = document.createElement('li');
        li.setAttribute('role', 'presentation');
        const btn = document.createElement('button');
        btn.className = 'fab-item';
        btn.type = 'button';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = label;
        btn.addEventListener('click', () => { closeFab(); handler(); });
        li.appendChild(btn);
        panel.appendChild(li);
    }

    const latest = storage.getLatestAutoSave();
    if (latest) addItem('続きから読む', () => { resumeReading(latest); });
    addItem('栞をすべてクリア', () => {
        confirmAndRun('保存した栞をすべて削除しますか？', () => {
            storage.clearSlots();
            renderBookmarks();
        });
    });
    addItem('既読をクリア', () => {
        confirmAndRun('既読の記録をすべて削除しますか？', () => {
            storage.clearReached();
            renderStory(story, storage.loadReachedKeys(), storage.loadReadKeys());
        });
    });
    addItem('読破状況をクリア', () => {
        confirmAndRun('読破の記録をすべて削除しますか？', () => {
            clearReadStatus();
            renderStory(story, storage.loadReachedKeys(), storage.loadReadKeys());
            applyStoryStage(story);
        });
    });
    addItem('設定', () => { settingsPanel.open(); });
    addItem('共有', () => { share.open(); });

    toggle.addEventListener('click', () => { if (isOpen()) closeFab(); else openFab(); });

    document.addEventListener('click', (e) => {
        const container = document.getElementById('fab-container');
        if (isOpen() && container && !container.contains(e.target as Node)) {
            closeFab();
        }
    });

    panel.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const items = Array.from(panel.querySelectorAll<HTMLButtonElement>('.fab-item'));
        const idx = items.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown') {
            items[(idx + 1) % items.length]?.focus();
        } else {
            items[(idx - 1 + items.length) % items.length]?.focus();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // キャラクター紹介とエシュカ地図は付録カードからだけ開く最前面のポップアップなので最優先で閉じる
        // （characters.ts / map.ts は Escape を拾わない＝優先順位は各ページのキー処理が決める）。
        // 両者は同時に開かないので相対順は実害が無いが、本文側（menu.ts）と並びを揃えてある
        if (charaPopup.isOpen()) { charaPopup.close(); return; }
        if (mapPopup.isOpen()) { mapPopup.close(); return; }
        if (share.isOpen()) { share.close(); return; }
        if (settingsPanel.isOpen()) { settingsPanel.close(); return; }
        if (isOpen()) closeFab(); else openFab();
    });
}

// ----- 更新履歴 -----

// 版種別スイッチで ON の種別（初期値はメジャー＋マイナー。永続化しない＝ページを開くたびにこの値へ戻る）と、
// 「すべて表示」の展開状態。どちらも _applyChangelogFilter が唯一の読み手。
const _changelogKinds = new Set<VersionKind>(['major', 'minor']);
let _changelogExpanded = false;

/**
 * 版種別フィルタと展開状態を #content-changelog-list に反映する。表示の出し入れはこの関数だけが決める。
 * 初期件数（CHANGELOG_INITIAL_COUNT）は絞り込み後の何件目かで数える。該当 0 件なら空表示、
 * 絞り込み後の件数が初期件数を超えるときだけ「すべて表示／閉じる」を出す。
 * _applyChangelogFilter(): void
 */
function _applyChangelogFilter(): void {
    const listEl    = document.getElementById('content-changelog-list');
    const emptyEl   = document.getElementById('content-changelog-empty');
    const toggleBtn = document.getElementById('content-changelog-toggle');
    if (!listEl) return;

    let shown = 0;
    listEl.querySelectorAll<HTMLLIElement>('li.cl-entry').forEach(li => {
        const match = _changelogKinds.has(li.dataset.kind as VersionKind);
        li.hidden = !match || (!_changelogExpanded && shown >= CHANGELOG_INITIAL_COUNT);
        if (match) shown++;
    });
    if (emptyEl) emptyEl.hidden = shown > 0;
    if (toggleBtn) {
        toggleBtn.hidden = shown <= CHANGELOG_INITIAL_COUNT;
        toggleBtn.textContent = _changelogExpanded ? '閉じる' : 'すべて表示';
    }
}

/** 版種別スイッチ（aria-pressed のトグル）と「すべて表示」を 1 度だけ結線する。_initChangelogControls(): void */
function _initChangelogControls(): void {
    document.querySelectorAll<HTMLButtonElement>('#content-changelog-filter button[data-kind]').forEach(btn => {
        const kind = btn.dataset.kind as VersionKind;
        btn.setAttribute('aria-pressed', String(_changelogKinds.has(kind)));
        btn.addEventListener('click', () => {
            if (_changelogKinds.has(kind)) _changelogKinds.delete(kind); else _changelogKinds.add(kind);
            btn.setAttribute('aria-pressed', String(_changelogKinds.has(kind)));
            _applyChangelogFilter();
        });
    });
    document.getElementById('content-changelog-toggle')?.addEventListener('click', () => {
        _changelogExpanded = !_changelogExpanded;
        _applyChangelogFilter();
    });
}

function _renderContentChangelog(entries: ContentChangelogEntry[]): void {
    const listEl = document.getElementById('content-changelog-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    entries.forEach(entry => {
        const li = document.createElement('li');
        li.className = 'cl-entry';
        li.dataset.kind = versionKind(entry.version);

        const header = document.createElement('p');
        header.className = 'cl-header';

        const versionSpan = document.createElement('span');
        versionSpan.className = 'cl-version';
        versionSpan.textContent = `v${entry.version}`;
        header.appendChild(versionSpan);

        const dateSpan = document.createElement('span');
        dateSpan.className = 'cl-date';
        dateSpan.textContent = entry.date;
        header.appendChild(dateSpan);
        li.appendChild(header);

        const changeEl = document.createElement('p');
        changeEl.className = 'cl-change';
        changeEl.textContent = entry.change;
        li.appendChild(changeEl);

        if (entry.ep.length > 0) {
            const epLinks = document.createElement('div');
            epLinks.className = 'cl-ep-links';
            entry.ep.forEach((epNum, j) => {
                // sha 配列は ep 配列と同じ長さ・同じ並びである前提だが、正のソースの epNN-changelog.json
                // は手書きで sha が後入れなので揃わない状態が起こり得る。揃っていなければリンクにせず
                // ラベルだけ出す（生成側の対応ズレは tool/changelog/convert.mjs が検出する）。
                const sha = entry.sha?.[j] ?? '';
                let chip: HTMLElement;
                if (SHORT_SHA_RE.test(sha)) {
                    const link = document.createElement('a');
                    link.href   = `https://github.com/${GITHUB_REPO}/commit/${sha}`;
                    link.target = '_blank';
                    link.rel    = 'noopener noreferrer';
                    chip = link;
                } else {
                    chip = document.createElement('span');
                }
                chip.className   = 'cl-ep-link';
                chip.textContent = `第${epNum}話`;
                epLinks.appendChild(chip);
            });
            li.appendChild(epLinks);
        }

        listEl.appendChild(li);
    });

    _applyChangelogFilter();
}

function _updateVersionBadge(type: 'content' | 'site', version: string): void {
    const el = document.getElementById(`badge-${type}-version`);
    if (el) el.textContent = `${type} version ${version}`;
}

async function loadChangelog(type: 'content' | 'site'): Promise<void> {
    try {
        const res = await fetch(`changelog/${type}-changelog.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (type === 'content') {
            const entries = (await res.json()) as ContentChangelogEntry[];
            _updateVersionBadge('content', entries[0]?.version ?? '');
            _renderContentChangelog(entries);
        } else {
            const entries = (await res.json()) as SiteChangelogEntry[];
            _updateVersionBadge('site', entries[0]?.version ?? '');
        }
    } catch {
        if (type === 'content') {
            const section = document.getElementById('content-changelog');
            if (section) section.hidden = true;
        }
    }
}

// ----- 付録カード（キャラクター紹介・エシュカ地図・用語集） -----

// 付録カードのエシュカ地図ボタンを結線する（要件 06-14）。取得するデータが無いので同期で済み、
// 押された側の要素を mapPopup.open() に渡して閉じたときのフォーカス戻り先にする。
// **initAppendix に同居させない**：あちらは characters.json の取得失敗で早期 return するので、
// 中に置くとネットワーク不調の読者に「見えるのに押しても何も起きない地図チップ」が残る。
// initAppendixMap(): void
function initAppendixMap(): void {
    const btn = document.getElementById('appendix-map');
    if (!btn) return;
    btn.addEventListener('click', () => mapPopup.open(btn));
}

// 付録カードの用語集チップ（<a href="glossary.html">）に現在のクエリを付け直す（要件 06-15）。用語集は
// 別ページへの遷移なので、エピソード一覧と同じく withQuery で ?dev を引き継ぐ＝作者の閲覧を計測させない。
// **initAppendix に同居させない**（地図と同じ理由：あちらは取得失敗で早期 return する）。
// initAppendixGlossary(): void
function initAppendixGlossary(): void {
    const link = document.getElementById('appendix-glossary');
    if (link instanceof HTMLAnchorElement) link.href = withQuery('glossary.html');
}

// 付録カードのキャラクター紹介ボタンを結線する。characters.json を取得し、押された時点の Stage を
// charaPopup.open() に渡す（Stage を変数に持ち回らない＝「読破状況をクリア」で下がった後も追従する）。
// story か characters.json が取れなければボタンを隠す（押しても何も出ないボタンを残さない）。その結果
// 「設定」に見える項目が 1 つも無くなったら見出しごと隠す。
// **後者の見出し隠しは 2026-10-09 以降は到達しない**：地図チップを公開したので「見える項目が 1 つも無い」
// が成立しなくなった（要件 06-7 の条項ごと残してあるのは、将来また全項目が非公開になる場合に効くため）。
// characters.json の取得を loader.ts に寄せないのは story.json と同じく目次の独立方針のため。
// initAppendix(story: StoryVolume[]): Promise<void>
async function initAppendix(story: StoryVolume[]): Promise<void> {
    const section = document.getElementById('appendix-settings');
    const btn = document.getElementById('appendix-chara-btn');
    if (!section || !btn) return;

    let data: CharactersData = [];
    try {
        const res = await fetch('characters.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = (await res.json()) as CharactersData;
    } catch {
        data = [];
    }
    if (story.length === 0 || data.length === 0) {
        btn.hidden = true;
        if (!section.querySelector('.idx-chip:not([hidden])')) section.hidden = true;
        return;
    }

    btn.addEventListener('click', () => {
        const stage = computeStoryStage(
            Array.from(storage.loadReadKeys()),
            story as unknown as Parameters<typeof computeStoryStage>[1],
        );
        charaPopup.open(data, stage);
    });
    // index.html では disabled で置いてある：結線が済むまで押せないようにする（読み込み中のクリックが空振りしないように）
    (btn as HTMLButtonElement).disabled = false;
}

// ----- エントリポイント -----

async function main(): Promise<void> {
    // 栞・オートセーブのスキーマ移行（schemaVersion 5：単一スロット化＋割合化）を確実に走らせる（移行の持ち主は core/storage だけ）。
    storage.init();
    // 用語集チップの href に ?dev を引き継ぐ。story.json の取得を待たない（待つ間に押されると素の href で遷移する）
    initAppendixGlossary();

    let story: StoryVolume[] = [];
    try {
        const res = await fetch('story.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        story = (await res.json()) as StoryVolume[];
    } catch {
        const area = document.getElementById('episodes-area');
        if (area) {
            area.innerHTML = '';
            const msg = document.createElement('p');
            msg.className = 'loading-text';
            msg.textContent = 'エピソードの読み込みに失敗しました。';
            area.appendChild(msg);
        }
    }

    _episodes = story.flatMap(vol => vol.episodes);
    renderStory(story, storage.loadReachedKeys(), storage.loadReadKeys());
    renderBookmarks();
    applyStoryStage(story);
    _initChangelogControls();
    loadChangelog('content');
    loadChangelog('site');

    initResumeButton();
    charaPopup.init();
    mapPopup.init();
    initAppendixMap();
    void initAppendix(story);

    initSettingsPopup(story);
    share.init();
    initFab(story);
}

main();
