/*
 * index.ts
 * 責務: 目次ページ（index.html）の全機能制御（要件 06-7）。story.json を読み、ヒーロー（巻の絵・ロゴ・読み始めるボタン・
 *       表紙ギャラリー）・上の帯・巻 → 話の扉絵バナー → 節のチップ・右カラム（最新・世界・栞・変更履歴・リンク）・
 *       足もとの版・設定と共有のシートを組む。markup の骨組みは index.html が持ち、ここはデータと状態で変わる所だけ。
 * export: なし（script type="module" としてロードされるエントリポイント）
 * 依存（目次は core と ui だけを読み、reader 層＝本文の読書の仕組みを読まない。.dependency-cruiser.cjs の層の規則）:
 *   core: core/record-hold（目次を開いたら記録の保留を解除する。要件 06-5）、core/storage（栞・既読・読破・オートセーブの読み書きと移行 init()。read セットは storage.loadReadKeys() で毎回
 *         localStorage を読み直す＝目次内で「読破を消す」した直後の再計算で古い値を返さない）、
 *         core/settings-model（表示設定の値の規則）、core/query（withQuery）、core/preview（hasEffectivePreview）、
 *         core/changelog（versionKind）、core/theme（巻の素材の規約と stage → 素材の組）、core/schedule（次回の更新）、volumes.ts（computeStoryStage＝素材・キーカラー・巻カードの初期 open に共用）
 *   ui:   ui/settings-panel（設定シート。markup は templates/parts/settings.html）、ui/share（共有シート。
 *         markup は templates/parts/share.html）、ui/confirm（消す前の確認）、ruby.ts（ルビ展開）、
 *   資料（人物・地図・用語）は目次からはページへ移るだけで、資料シートは読まない。
 *
 * 機能:
 *   - **巻の素材（ヒーローの絵・ロゴ・ページの背景）**：stage から core/theme の規約で URL を組む（story.json には書かない）。
 *     初期表示は index.html の早期スクリプトが端末の stage（lirmena.storyStage。公開直後は埋め込みの表で引き上げる）から先に入れ、ここは story.json で
 *     stage を算出し直して違っていれば差し替える（applyStoryStage）。キーカラーは <html data-story-stage>（toc.css）
 *   - **表紙ギャラリー**：今の stage から過去の巻の絵へ遡れる（右＝過去）。替えるのは絵だけで、ロゴ・キーカラー・
 *     favicon・次に開いたときの絵は今の stage のまま。閲覧位置は覚えない。PC はボタン（ホバーで出る）、スマホは払う
 *     （指に付いてくるカルーセル）、ドットでも移れる。隣の巻の絵は img.decode() まで先読みする（R17）
 *   - **読み始めるボタン**（ヒーロー）と上の帯の「▶ 第N話#M」：初めて＝第一話から、途中＝「続きから読む」の地点
 *     （volumes.resolveResumePoint）へ、最新まで読了＝最新の節を読み返す（下に次回の更新）。
 *     読者の状態は <body data-reader="first|mid|caught">
 *   - 巻カード（<details class="idx-vol-card">）→ 話の扉絵バナー（article.idx-ep）→ 節のチップ。巻の初期 open は
 *     stage の巻だけ（物語完結なら全部閉じる）。予告の巻・予告の話・部分公開の話のゴーストのチップ・巻末のあとがきの帯
 *   - 節のチップの状態（B 案）：読了＝右上の点、到達（か読了）＝明るい数字、「続きから読む」の地点＝細い枠（toc-page.css）
 *   - 右カラム：最新（最後に公開した節と次回の更新）・世界（資料ページ 3 枚への入口）・栞（スロット 0 は地点。手動栞は行の × で確認つきで 1 件ずつ消す）・
 *     変更履歴（版種別スイッチ・最初は 3 件・すべて表示で枠の中だけスクロール）・リンク
 *   - 設定（上の帯の ⚙）：本文と同じ設定シート。スマホは全画面、PC は開いている間ページ全体を本文の見本にする（#idx-preview）。
 *     記録の消去（栞・既読・読破）と初期値に戻すもここ（以前の FAB の項目）
 *   - **シート（設定・共有）と確認は <dialog>**（ui/sheet・ui/confirm）。Escape は開いている一番上の <dialog> をブラウザが閉じる
 *
 * localStorage キー:
 *   栞・既読・読破・オートセーブ・pendingJump・schemaVersion の契約は core/storage.ts が持つ（本文側と共有）。
 *   表示設定（"lirmena.*" の 5 項目と "lirmena.readingAnchor"）の契約は core/settings-model.ts が持つ。
 *   "lirmena.storyStage"（stage のキャッシュ）は目次と本文（main.ts）が書き、各シェルの早期スクリプトが読む。
 *   以前の "lirmena.heroCard"（表紙の URL のキャッシュ）は P4 で廃止＝起動時に消す（読者の端末に残った値の掃除）。
 */

import './styles/toc.css';
import './styles/toc-page.css';
import './styles/_sheet.css';
import * as storage from './core/storage';
import { loadSettings, removeSettings, saveSetting, saveSettings, PRESETS } from './core/settings-model';
import { withQuery } from './core/query';
import { hasEffectivePreview } from './core/preview';
import { versionKind, type VersionKind } from './core/changelog';
import { themeKeyForStage, themePath, type ThemeFile } from './core/theme';
import { nextScheduledAt, formatScheduledAt } from './core/schedule';
import * as recordHold from './core/record-hold';
import * as settingsPanel from './ui/settings-panel';
import * as share from './ui/share';
import { confirmDialog } from './ui/confirm';
import { applyRuby } from './ruby';
import { computeStoryStage, resolveResumePoint, type ResumePoint, type StoryStage } from './volumes';

// preview（vol/ep 単位の予告テキスト・要件 06-7）は任意。**text が非空**のときのみ「予告あり」扱い（core/preview）。
type Preview = { text: string };
type Section = { id: number; published: boolean; scheduledAt?: string };
type Episode = {
    id: number;
    title: string;
    sections: Section[];
    preview?: Preview;
    coverFile?: string;
    coverPositionX?: string;
    tocCoverPositionY?: string;
};
// story.json のトップレベル vol エントリ（目次が使うフィールドだけ。全体は types.ts の Volume）。
type StoryVolume = {
    volume: number;
    epRange: [number, number];
    afterword: { published: boolean };
    episodes: Episode[];
    preview?: Preview;
};
type ContentChangelogEntry = { version: string; date: string; change: string; ep: number[]; sha: string[] };
type SiteChangelogEntry = { version: string; date: string; changes: string[] };
// 節の位置（どの巻のどの話の何節か）
type SecPos = { vol: number; ep: Episode; sec: number };

const BASE = import.meta.env.BASE_URL;
const GITHUB_REPO = 'haguchikarasu/lirmena';
// 短縮 sha の形。content-changelog.json の sha は「本体コミット確定後に手で入れる」運用なので、
// 未確定プレースホルダや欠損のまま公開され得る。その状態で commit/undefined を指すリンクを作らない判定。
const SHORT_SHA_RE = /^[0-9a-f]{7,40}$/;
const CHANGELOG_INITIAL_COUNT = 3;
// PC の 2 カラム・右から出るシートに切り替わる幅（toc-page.css・_sheet.css の @media と同じ値）
const PC_QUERY = '(min-width: 901px)';

let _story: StoryVolume[] = [];
let _episodes: Episode[] = [];

const pad = (n: number) => String(n).padStart(2, '0');
// 「第4話#3」（sec 番号はゼロ埋めしない）
const posLabel = (ep: number, sec: number) => `第${ep}話#${sec}`;
// |漢字《かな》 の書式を外した読み（aria-label・確認文に使う）
const plainTitle = (t: string) => t.replace(/\|([^《|]+)《[^》]+》/g, '$1');

// 節のページの URL。sec01 は ep の扉（タイトルページ EE-00.html）、sec02 以降は本文ページ（要件 06-7）
function secHref(ep: number, sec: number): string {
    return withQuery(`contents/${pad(ep)}-${sec === 1 ? '00' : pad(sec)}.html`);
}

function afterwordHref(vol: number): string {
    return withQuery(`contents/vol${pad(vol)}-afterword.html`);
}

// 話の扉絵（タイトルページの背景と同じ絵。title.ts と同じく coverFile の省略時は title.avif）
function coverUrl(vol: number, ep: Episode): string {
    return `${BASE}vol${pad(vol)}/ep${pad(ep.id)}/${ep.coverFile ?? 'title.avif'}`;
}

// 扉絵バナーで見せる位置。横は扉の指定（coverPositionX）を流用し、縦は目次専用の tocCoverPositionY（省略時は中央）
function coverPosition(ep: Episode): string {
    return `${ep.coverPositionX ?? '50%'} ${ep.tocCoverPositionY ?? '50%'}`;
}

function themeUrl(stage: number, file: ThemeFile): string {
    return BASE + themePath(themeKeyForStage(stage, _story.length), file);
}

// src を絶対 URL で比べて、同じなら触らない（同じ画像の取り直し・decode のやり直しで一瞬消えるのを避ける）
function setSrc(img: HTMLImageElement | null, url: string): void {
    if (img && img.src !== new URL(url, location.href).href) img.src = url;
}

// ----- 既読/読破判定 -----

function secKey(ep: number, sec: number): string {
    return `${pad(ep)}-${pad(sec)}`;
}

// 公開済みの節を物語の順に並べる（未公開の節は story-integrity (d) により各話の末尾）
function publishedSecs(story: StoryVolume[]): SecPos[] {
    return story.flatMap((v) => v.episodes.flatMap((ep) =>
        ep.sections.filter((s) => s.published).map((s) => ({ vol: v.volume, ep, sec: s.id }))));
}

// 取り消せない操作の前の確認（ui/confirm）。「削除する」が押されたら run()。
// confirmAndRun(msg: string, run: () => void): Promise<void>
async function confirmAndRun(msg: string, run: () => void): Promise<void> {
    if (await confirmDialog(msg, '削除する')) run();
}

// 「続きから読む」の地点（要件 06-5）。story.json がまだ無いときはオートセーブだけで決める（届いたら描き直す）。
// _resumePoint(): ResumePoint | null
function _resumePoint(): ResumePoint | null {
    const auto = storage.getAutoSave();
    if (_story.length === 0) return auto ? { kind: 'autosave', ep: auto.ep, sec: auto.sec, ratio: auto.ratio } : null;
    return resolveResumePoint(Array.from(storage.loadReadKeys()), auto, _story as unknown as Parameters<typeof resolveResumePoint>[2]);
}

// 地点へ着地させる受け渡しを書く。オートセーブの位置なら pendingJump、読破した節の末尾なら pendingScrollEnd（着地の手段が違う。_scrollToEnd）。
function _writeResumeLanding(p: ResumePoint): void {
    if (p.kind === 'autosave') storage.writePendingJump({ ep: p.ep, sec: p.sec, scene: 0, ratio: p.ratio });
    else if (p.kind === 'read-end') storage.writePendingScrollEnd(p.ep, p.sec);
}

// 地点の本文ページ。secHref と違って sec 1 でも扉（EE-00）を通さない（位置つきで本文へ直接着地するため）
function _resumeHref(p: ResumePoint): string {
    return withQuery(`contents/${pad(p.ep)}-${pad(p.sec)}.html`);
}

// ----- 読み始めるボタン（ヒーロー）と上の帯の「▶ 第N話#M」 -----

// 押されたときにすること（地点へ行くときに着地の受け渡しを書く）。結線は 1 度だけで、中身をここで替える
let _ctaGo: (() => void) | null = null;

// 読者の状態から、ボタンの文字・行き先・下の行を決める（story.json がまだ無いときはオートセーブだけで決める）。
//   caught（最新の公開済みの節を読了）→「第N話#M を読み返す」・下に次回の更新（予定が無ければ空）
//   mid（読破かオートセーブがある） →「続きから読む」・下に地点
//   first（どちらでもない）         →「第一話から読む」・下は空
// renderCta(): void
function renderCta(): void {
    const btn = document.getElementById('idx-cta-btn') as HTMLAnchorElement | null;
    const sub = document.getElementById('idx-cta-sub');
    const resume = document.getElementById('idx-topbar-resume') as HTMLAnchorElement | null;
    const resumeLabel = resume?.querySelector('span');
    if (!btn || !sub) return;

    const secs = publishedSecs(_story);
    const latest = secs[secs.length - 1] as SecPos | undefined;
    const point = _resumePoint();
    const caught = latest !== undefined && storage.loadReadKeys().has(secKey(latest.ep.id, latest.sec));
    let state: 'first' | 'mid' | 'caught';
    let href: string;
    let label: string;
    sub.textContent = '';
    _ctaGo = null;
    if (caught) {
        state = 'caught';
        href = secHref(latest.ep.id, latest.sec);
        label = posLabel(latest.ep.id, latest.sec);
        btn.textContent = `${label} を読み返す`;
        const next = nextScheduledAt(_story, Date.now());
        if (next) sub.append(_clockIcon(), _timeEl(next));
    } else if (point && point.kind !== 'first') {
        state = 'mid';
        href = _resumeHref(point);
        label = posLabel(point.ep, point.sec);
        btn.textContent = '続きから読む';
        sub.textContent = label;
        _ctaGo = () => _writeResumeLanding(point);
    } else {
        state = 'first';
        const first = secs[0];
        href = first ? secHref(first.ep.id, first.sec) : withQuery('contents/01-00.html');
        label = first ? `第${first.ep.id}話` : '第1話';
        btn.textContent = '第一話から読む';
    }
    document.body.dataset.reader = state;
    btn.href = href;
    if (resume && resumeLabel) {
        resume.href = href;
        resumeLabel.textContent = label;
        resume.setAttribute('aria-label', `${btn.textContent}（${label}）`);
    }
}

function _clockIcon(): SVGSVGElement {
    const t = document.getElementById('idx-news-next')?.querySelector('svg');
    return (t?.cloneNode(true) as SVGSVGElement | undefined) ?? document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}

function _timeEl(at: Date): HTMLTimeElement {
    const time = document.createElement('time');
    time.dateTime = at.toISOString();
    time.textContent = formatScheduledAt(at);
    return time;
}

function initCta(): void {
    for (const id of ['idx-cta-btn', 'idx-topbar-resume']) {
        document.getElementById(id)?.addEventListener('click', () => { _ctaGo?.(); });
    }
}

// ----- 右カラム：最新 -----

// 最後に公開した節を扉絵つきの 1 枚で。下に次回の更新（予定が無ければ出さない）。公開済みの節が無ければ枠ごと出さない
function renderNews(): void {
    const box = document.getElementById('idx-news') as HTMLAnchorElement | null;
    if (!box) return;
    const secs = publishedSecs(_story);
    const latest = secs[secs.length - 1] as SecPos | undefined;
    box.hidden = !latest;
    if (!latest) return;
    box.href = secHref(latest.ep.id, latest.sec);
    const cover = document.getElementById('idx-news-cover') as HTMLImageElement | null;
    if (cover) {
        // 扉絵がまだ無い話（公開を先にして絵を後から足す場合）は、壊れた画像の印を出さず絵の列ごと畳む（話のバナーと同じ扱い）
        box.classList.remove('idx-news--nocover');
        cover.onerror = () => { box.classList.add('idx-news--nocover'); };
        setSrc(cover, coverUrl(latest.vol, latest.ep));
        cover.style.objectPosition = coverPosition(latest.ep);
    }
    const pos = document.getElementById('idx-news-pos');
    if (pos) pos.textContent = posLabel(latest.ep.id, latest.sec);
    const title = document.getElementById('idx-news-title');
    if (title) { title.textContent = ''; applyRuby(latest.ep.title, title); }
    const next = nextScheduledAt(_story, Date.now());
    const nextEl = document.getElementById('idx-news-next');
    const time = nextEl?.querySelector('time');
    if (nextEl && time) {
        nextEl.hidden = !next;
        if (next) { time.dateTime = next.toISOString(); time.textContent = formatScheduledAt(next); }
    }
}

// ----- 物語進行段階と巻の素材 -----

// stage を <html data-story-stage> に反映し、巻の素材（ロゴ・ページの背景・ヒーローの絵）と favicon を stage の組へ差し替える。
// read セットは本文 sec キーとあとがきキーの混在だが、computeStoryStage が本文 sec 用 regex でフィルタするので
// あとがきキーは stage に影響しない。「読破を消す」で再実行されても安全（冪等）。
// applyStoryStage(): void
function applyStoryStage(): void {
    if (_story.length === 0) return;
    // localStorage を直読みして最新の read セットを取る（storage.getRead() は init 時に固定したキャッシュ）
    const read = Array.from(storage.loadReadKeys());
    // computeStoryStage は types.ts の StoryData を受けるが、ローカルの StoryVolume は判定に要るフィールド
    // （volume・epRange・episodes.sections.published）を全て持つので構造的に互換
    const stage = computeStoryStage(read, _story as unknown as Parameters<typeof computeStoryStage>[1]);
    document.documentElement.dataset.storyStage = String(stage);
    // 次回ロードの早期スクリプト（全シェル）が読むキャッシュ。値は 1〜5 の文字列のみ
    try { localStorage.setItem('lirmena.storyStage', String(stage)); } catch { /* noop */ }

    setSrc(document.querySelector<HTMLImageElement>('#idx-hero-logo'), themeUrl(stage, 'logo.webp'));
    const bg = document.querySelector<HTMLImageElement>('#idx-page-bg');
    if (bg) { bg.hidden = false; setSrc(bg, themeUrl(stage, 'page-bg.avif')); }
    // favicon は stage の属する vol の物（vol[XX]/favicon[N].png で N=stage。完結は最終 vol 直下の favicon[巻数+1].png）
    const favicon = document.querySelector<HTMLLinkElement>('#app-favicon');
    if (favicon) favicon.href = `${BASE}vol${pad(Math.min(stage, _story.length))}/favicon${stage}.png`;

    // 表紙ギャラリーの履歴を作り直し、閲覧位置は今の stage へ戻す（stage が変わったのに古い位置に留まらない）
    _rebuildHeroGallery(stage);
}

// ----- 表紙ギャラリー（要件 06-7）-----
// **閲覧位置は stage ではない。** 過去の表紙を見ている間も、stage 由来の状態（data-story-stage・キーカラー・ロゴ・
// favicon・lirmena.storyStage・巻カードの初期 open）は今の stage のまま＝書き込み系は applyStoryStage だけが行い、
// 以下の関数群はヒーローの絵（#idx-hero-img と隣の #idx-hero-peer）とナビの見た目しか触らない。
// 絵は 1 枚ずつ枠（.idx-hero-slide）に入れ、払う間は枠ごと指に付いてくる。確定は「幅の 1/5 以上」か「0.5px/ms より速い払い」。

// ギャラリーの 1 コマ。[0] が今の stage の絵で、末尾が第1巻。**未来の巻は入れない**（ネタバレ）
type HeroShot = { url: string; label: string };
let _shots: HeroShot[] = [];
// 閲覧位置。0 = 今の stage。**永続化しない**
let _pos = 0;
let _sliding = false;
// 先読み：URL → decode 済みの Promise。全巻は読まない（過去の表紙を見ない読者が大半で、スマホの通信量が無駄になる）
const _ready = new Map<string, Promise<void>>();
// toc-page.css の .idx-hero-slide とは独立（動きは JS が transition を書く）
const SLIDE = 'translate 0.32s cubic-bezier(.2, .8, .2, 1)';
const SLIDE_FALLBACK_MS = 450;

const _heroEl = {
    art: () => document.getElementById('idx-hero-art'),
    slide: () => document.getElementById('idx-hero-slide'),
    peer: () => document.getElementById('idx-hero-slide-peer'),
    img: () => document.getElementById('idx-hero-img') as HTMLImageElement | null,
    peerImg: () => document.getElementById('idx-hero-peer') as HTMLImageElement | null,
};

// _rebuildHeroGallery(stage: StoryStage): void — stage から 1 まで遡る履歴を作り、今の stage の絵を出す
function _rebuildHeroGallery(stage: StoryStage): void {
    _shots = [];
    for (let s = stage; s >= 1; s--) {
        _shots.push({ url: themeUrl(s, 'hero-wide.avif'), label: s > _story.length ? '完結' : `第${s}巻` });
    }
    _pos = 0;
    _buildHeroDots();
    _renderHero();
    // ページが落ち着いたら 1 つ前の巻だけ先読み（払い始めてから読むと、届くまで枠の地が見える）
    const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 1500));
    idle(() => _preload(1));
}

// 今の閲覧位置の絵とナビを描く。ナビは遡れる表紙が 1 枚なら出さず、端の向きのボタンは押せなくする
function _renderHero(): void {
    const shot = _shots[_pos];
    const img = _heroEl.img();
    if (!shot || !img) return;
    setSrc(img, shot.url);
    img.alt = `${shot.label}の表紙`;
    // 空気（PC）の背景。CSS 変数の url() は使う側のスタイルシートの場所で解決されるので絶対 URL で渡す
    document.getElementById('idx-hero-ext')?.style.setProperty('--art-url', `url("${img.src}")`);
    const many = _shots.length > 1;
    const newer = document.getElementById('idx-hero-newer') as HTMLButtonElement | null;
    const older = document.getElementById('idx-hero-older') as HTMLButtonElement | null;
    const focused = document.activeElement;
    if (newer) { newer.hidden = !many; newer.disabled = _pos <= 0; }
    if (older) { older.hidden = !many; older.disabled = _pos >= _shots.length - 1; }
    // 端に来て押せなくなったボタンにフォーカスがあると、フォーカスがページの外（body）へ落ちて ← → も効かなくなる。
    // 反対向きのボタンへ移す（キーボードの読者がヒーローの中に留まる）
    if (focused === newer && newer?.disabled) older?.focus();
    else if (focused === older && older?.disabled) newer?.focus();
    // ドットは作り直さず印だけ替える（作り直すと、押したドットが消えてフォーカスが落ちる）
    document.querySelectorAll<HTMLButtonElement>('#idx-hero-dots button[data-pos]').forEach((b) => {
        b.setAttribute('aria-current', String(Number(b.dataset.pos) === _pos));
    });
    const status = document.getElementById('idx-hero-status');
    if (status) status.textContent = many ? `${shot.label}の表紙（${_pos + 1} / ${_shots.length}）` : '';
}

// ドットを履歴の枚数だけ作る（履歴が変わったとき＝_rebuildHeroGallery だけ）。遡れる表紙が 1 枚なら出さない
function _buildHeroDots(): void {
    const dots = document.getElementById('idx-hero-dots');
    if (!dots) return;
    const many = _shots.length > 1;
    dots.hidden = !many;
    dots.textContent = '';
    if (!many) return;
    _shots.forEach((s, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.pos = String(i);
        b.setAttribute('aria-label', `${s.label}の表紙`);
        dots.appendChild(b);
    });
}

// 閲覧位置 pos の絵を「すぐ描ける」状態（decode 済み）にしておく。範囲外・読み済みは何もしない
function _preload(pos: number): void {
    const shot = _shots[pos];
    if (!shot || _ready.has(shot.url)) return;
    const im = new Image();
    im.fetchPriority = 'low';
    im.src = shot.url;
    _ready.set(shot.url, im.decode().catch(() => { /* 404 でも払う操作は止めない */ }));
}

// 隣（step＝+1 で過去、-1 で新しい方。ドットからは 2 以上もある）の絵を外側に置く。範囲外なら false。
// 間に合わなかったとき（遅い回線）に黒い地が見えないよう、枠の地に今の絵をぼかして敷く（--fallback。toc-page.css）
function _placePeer(step: number): boolean {
    const peer = _heroEl.peer();
    const peerImg = _heroEl.peerImg();
    const shot = _shots[_pos + step];
    if (!peer || !peerImg || !shot || step === 0) { if (peer) peer.hidden = true; return false; }
    setSrc(peerImg, shot.url);
    peer.style.setProperty('--fallback', `url("${_heroEl.img()?.src ?? ''}")`);
    peer.hidden = false;
    _preload(_pos + step + Math.sign(step));   // さらにその先を先読み
    return true;
}

// 指の位置 dx（px）に合わせて 2 枚を並べる（transition なし＝指に付いてくる）。左へ払う（dx < 0）と過去の巻が右から入る
function _follow(dx: number, step: number = dx < 0 ? 1 : -1): void {
    const art = _heroEl.art();
    const slide = _heroEl.slide();
    const peer = _heroEl.peer();
    if (!art || !slide || !peer) return;
    const w = art.clientWidth;
    const has = _placePeer(step);
    const d = has ? dx : dx / 4;   // 端の巻では 1/4 しか付いてこない＝「この先は無い」
    slide.style.transition = peer.style.transition = 'none';
    slide.style.translate = `${d}px 0`;
    peer.style.translate = `${d + (step > 0 ? w : -w)}px 0`;
}

// el の transition が終わったら 1 度だけ fn。transitionend が来ない場合（動きを減らす設定・裏のタブ）に備えて時間でも締める
function _afterSlide(el: HTMLElement, fn: () => void): void {
    let done = false;
    const end = () => { if (!done) { done = true; fn(); } };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { end(); return; }
    el.addEventListener('transitionend', end, { once: true });
    window.setTimeout(end, SLIDE_FALLBACK_MS);
}

// 確定：今の絵を外へ、隣の絵を真ん中へ滑らせてから、2 枚の役を入れ替える
function _commit(step: number): void {
    const art = _heroEl.art();
    const slide = _heroEl.slide();
    const peer = _heroEl.peer();
    if (!art || !slide || !peer) return;
    const w = art.clientWidth;
    _sliding = true;
    slide.style.transition = peer.style.transition = SLIDE;
    slide.style.translate = `${step > 0 ? -w : w}px 0`;
    peer.style.translate = '0 0';
    _afterSlide(peer, () => {
        _pos += step;
        slide.style.transition = 'none';
        _renderHero();                 // 前面に隣の絵を入れる（decode 済みの同じ画像なので見た目は変わらない）
        slide.style.translate = '0 0';
        peer.hidden = true;
        _sliding = false;
        _preload(_pos - 1); _preload(_pos + 1);
    });
}

// 取り消し：2 枚とも元の位置へ滑って戻る
function _cancel(step: number): void {
    const art = _heroEl.art();
    const slide = _heroEl.slide();
    const peer = _heroEl.peer();
    if (!art || !slide || !peer) return;
    const w = art.clientWidth;
    slide.style.transition = peer.style.transition = SLIDE;
    slide.style.translate = '0 0';
    peer.style.translate = `${step > 0 ? w : -w}px 0`;
    _afterSlide(slide, () => { peer.hidden = true; });
}

// ボタン・ドット・矢印キーから：行き先の絵を外側に置いてから滑らせる（離れた巻へは 1 枚ずつではなく直接）
function _goHero(step: number): void {
    if (_sliding || !_placePeer(step)) return;
    // 予約した時点で「動いている」にする（_commit まで 2 フレームあり、その間の連打・キーリピートが二重に確定して _pos が範囲外へ出る）
    _sliding = true;
    _follow(step > 0 ? -0.01 : 0.01, step);
    // transition を切った位置を確定させてから動かす（同じフレームだと開始値を取り違えて動きが飛ぶ）
    requestAnimationFrame(() => requestAnimationFrame(() => _commit(step)));
}

// クリック・キー・払う操作の登録（1 度だけ。applyStoryStage は「読破を消す」で再実行されるため、ここに置かない）
function initHeroGallery(): void {
    const art = _heroEl.art();
    if (!art) return;
    document.getElementById('idx-hero-older')?.addEventListener('click', () => _goHero(1));
    document.getElementById('idx-hero-newer')?.addEventListener('click', () => _goHero(-1));
    document.getElementById('idx-hero-dots')?.addEventListener('click', (e) => {
        const b = (e.target as Element).closest<HTMLButtonElement>('button[data-pos]');
        if (b && !_sliding) { const d = Number(b.dataset.pos) - _pos; if (d) _goHero(d); }
    });
    // ← → はヒーローの中にフォーカスがあるときだけ（ページのどこでも拾うと、シートの操作中にも絵が動く）
    art.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); _goHero(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); _goHero(-1); }
    });
    // 払う操作（指・ペン）：横の動きだけを拾い、縦のスクロールはブラウザに任せる（CSS の touch-action: pan-y）
    let swipe: { x: number; y: number; t: number; id: number; dx: number; active: boolean } | null = null;
    art.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' || _shots.length < 2 || _sliding) return;
        swipe = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, dx: 0, active: false };
    });
    art.addEventListener('pointermove', (e) => {
        if (!swipe || e.pointerId !== swipe.id) return;
        const dx = e.clientX - swipe.x;
        const dy = e.clientY - swipe.y;
        if (!swipe.active) {
            if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }   // 縦のスクロールだった
            if (Math.abs(dx) < 10) return;
            swipe.active = true;
            // 指が枠の外へ出ても追い続ける。捕まえられない指（すでに離れた等）でも払う操作は続ける
            try { art.setPointerCapture(e.pointerId); } catch { /* noop */ }
        }
        swipe.dx = dx;
        _follow(dx);
    });
    const endSwipe = (e: PointerEvent) => {
        if (!swipe || e.pointerId !== swipe.id) return;
        const { dx, active, t } = swipe;
        swipe = null;
        if (!active) return;
        const step = dx < 0 ? 1 : -1;
        const fast = Math.abs(dx) / Math.max(1, e.timeStamp - t) > 0.5;
        const far = Math.abs(dx) > art.clientWidth / 5;
        if ((far || fast) && e.type === 'pointerup' && !_heroEl.peer()?.hidden) _commit(step);
        else _cancel(step);
    };
    art.addEventListener('pointerup', endSwipe);
    art.addEventListener('pointercancel', endSwipe);
    art.addEventListener('dragstart', (e) => { e.preventDefault(); });
}

// ----- 上の帯・右カラムの貼り付き -----

// ヒーローを過ぎたら帯にする（JS は「過ぎたか」を <body data-past-hero> に写すだけ。見た目は toc-page.css）。
// 右カラムの高さを --side-h に渡す（画面より高いとき、下端が見えたところで止めるため）
function initLayoutObservers(): void {
    const art = document.getElementById('idx-hero-art');
    if (art && 'IntersectionObserver' in window) {
        new IntersectionObserver(([e]) => { document.body.dataset.pastHero = String(!e.isIntersecting); },
            { rootMargin: '-64px 0px 0px 0px' }).observe(art);
    }
    const side = document.getElementById('idx-side');
    if (side && 'ResizeObserver' in window) {
        new ResizeObserver(() => { document.body.style.setProperty('--side-h', `${side.offsetHeight}px`); }).observe(side);
    }
}

// ----- 目次本体（巻カード → 話の扉絵バナー → 節のチップ、巻末にあとがきの帯） -----

// story を巻ごとに描く。通常の巻は <details class="idx-vol-card">、予告の巻は <section class="idx-vol-card--notice">（見出しだけ）。
// 初期 open は stage の巻だけ（物語完結は全部閉じる）。開閉は保存しない。
// 表示できる話（公開済みの節がある・予告がある）もあとがきも予告も無い巻は出さない。優先順位は完結 > 予告 > 連載中。
function renderStory(reached: Set<string>, read: Set<string>): void {
    const area = document.getElementById('episodes-area');
    if (!area) return;
    area.innerHTML = '';
    const storyStage = computeStoryStage(Array.from(read), _story as unknown as Parameters<typeof computeStoryStage>[1]);
    const point = _resumePoint();

    for (const vol of _story) {
        // 表示できる話：公開済みの節が 1 つ以上 OR **非空**の ep.preview（空 text は事前配置のテンプレ＝出さない）
        const visibleEps = vol.episodes
            .map(ep => ({ ep, published: ep.sections.filter(s => s.published), hasPreview: hasEffectivePreview(ep.preview) }))
            .filter(x => x.published.length > 0 || x.hasPreview);
        const hasAfterword = vol.afterword?.published === true;
        const hasVolPreview = hasEffectivePreview(vol.preview);
        if (visibleEps.length === 0 && !hasAfterword && !hasVolPreview) continue;

        // 予告の巻：<details> ではなく <section>＋見出しだけ（開閉できない・中身を作らない）
        if (hasVolPreview && !hasAfterword) {
            const card = document.createElement('section');
            card.className = 'idx-vol-card idx-vol-card--notice';
            card.appendChild(_buildVolHead(vol, hasAfterword, visibleEps.length));
            area.appendChild(card);
            continue;
        }

        const card = document.createElement('details');
        card.className = 'idx-vol-card';
        if (vol.volume === storyStage) card.open = true;
        card.appendChild(_buildVolHead(vol, hasAfterword, visibleEps.length));
        const body = document.createElement('section');
        body.className = 'idx-vol-body';
        for (const { ep, published, hasPreview } of visibleEps) {
            body.appendChild(_buildEpBlock(vol.volume, ep, published, hasPreview, reached, read, point));
        }
        if (hasAfterword) body.appendChild(_buildAfterwordBlock(vol, reached, read));
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

// 巻の見出し（▶・「第N巻」・状態の札）。通常の巻は <summary>（<details> の開閉に要る）、予告の巻は <header>
// （<header> は必ず <section class="idx-vol-card--notice"> の内側に置く：外に出すとランドマーク banner が 2 つ目に生える）。
// 札は「完結（全M話）> 予告の文 > 連載中」
function _buildVolHead(vol: StoryVolume, hasAfterword: boolean, visibleEpsCount: number): HTMLElement {
    const hasVolPreview = hasEffectivePreview(vol.preview);
    const head = document.createElement(hasVolPreview && !hasAfterword ? 'header' : 'summary');
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
        // 「巻完結」は判定名だけ。札には「全M話」だけを出す（要件 06-7）
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

// 話の扉絵バナー：絵を全面に敷き（タイトルページと同じ扉絵）、見出し（「第◯話」＋ルビ展開したタイトル）と節のチップを載せる。
// 予告の話（公開済みの節が無く非空の ep.preview）は絵を敷かず、タイトルと予告の文だけ。
// 部分公開の話は公開済みのチップの後ろに未公開の節のゴーストのチップ（.idx-chip--ghost・非リンク・aria-hidden）を並べる。
// 見出しは prefix（.idx-ep-prefix「第◯話」）＋半角スペースのテキストノード＋本体の 3 ノード（要件 06-7）
function _buildEpBlock(
    vol: number,
    ep: Episode,
    published: Section[],
    hasPreview: boolean,
    reached: Set<string>,
    read: Set<string>,
    point: ResumePoint | null,
): HTMLElement {
    const epEl = document.createElement('article');
    epEl.className = 'idx-ep';
    const isPreview = published.length === 0 && hasPreview;

    if (!isPreview) {
        const cover = document.createElement('img');
        cover.className = 'idx-ep-cover';
        cover.alt = '';
        cover.loading = 'lazy';
        cover.src = coverUrl(vol, ep);
        cover.style.objectPosition = coverPosition(ep);
        // 扉絵がまだ無い話（公開を先にして絵を後から足す場合）は、空の大きな枠を残さず文字の高さに縮める
        cover.addEventListener('error', () => { cover.hidden = true; epEl.classList.add('idx-ep--nocover'); }, { once: true });
        epEl.appendChild(cover);
    }

    const titleEl = document.createElement('h3');
    titleEl.className = 'idx-ep-title';
    const prefixEl = document.createElement('span');
    prefixEl.className = 'idx-ep-prefix';
    prefixEl.textContent = `第${ep.id}話`;
    titleEl.appendChild(prefixEl);
    titleEl.appendChild(document.createTextNode(' '));
    applyRuby(ep.title, titleEl);
    epEl.appendChild(titleEl);

    const chipsEl = document.createElement('p');
    chipsEl.className = 'idx-chips';
    if (isPreview) {
        epEl.classList.add('idx-ep--preview');
        const notice = document.createElement('span');
        notice.className = 'idx-ep-notice';
        notice.textContent = ep.preview!.text;
        chipsEl.appendChild(notice);
    } else {
        for (const sec of published) {
            const isReached = reached.has(secKey(ep.id, sec.id));
            const isRead = read.has(secKey(ep.id, sec.id));
            const isHere = point !== null && point.kind !== 'first' && point.ep === ep.id && point.sec === sec.id;
            const link = document.createElement('a');
            link.className = 'idx-chip'
                + (isReached ? ' idx-chip--reached' : '')
                + (isRead ? ' idx-chip--read' : '')
                + (isHere ? ' idx-chip--here' : '');
            link.href = secHref(ep.id, sec.id);
            const labelEl = document.createElement('span');
            labelEl.textContent = pad(sec.id);
            link.appendChild(labelEl);
            // 文字を減らしても読み上げの名前は残す：読破（読了）＞既読（到達）、「続きから読む」の地点なら「続きから」
            const marks = [isRead ? '読破' : isReached ? '既読' : '', isHere ? '続きから' : ''].filter(Boolean);
            if (marks.length > 0) link.setAttribute('aria-label', `${pad(sec.id)} ${marks.join(' ')}`);
            chipsEl.appendChild(link);
        }
        // 未公開の節（story-integrity (d) により末尾に集まっている）。視覚だけの「まだ続く」の印＝支援技術には隠す
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

// 巻末のあとがきの帯（vol.afterword.published のときだけ）。絵を敷かない低い帯で（話のバナーと並べると、絵つきの低い帯は
// 中途半端に見えた）、チップは「01」1 つ（話の節のチップと同じ数字。
// 以前は「**」、次に「読む」だったが、チップの列の中で 1 つだけ動詞になって日本語として浮いた）。
// チップの文字は飾り（aria-hidden）で、名前は link の aria-label「第N巻 あとがき（ 既読／読破）」が持つ
// （完結した巻が複数あっても読み上げで区別できる）。記録のキーは "vol[XX]-af"（本文の節と同じ Set に入る）。「続きから」の枠は付かない（あとがきは地点にならない。要件 06-5）
function _buildAfterwordBlock(vol: StoryVolume, reached: Set<string>, read: Set<string>): HTMLElement {
    const el = document.createElement('article');
    el.className = 'idx-ep idx-ep--afterword';

    const titleEl = document.createElement('h3');
    titleEl.className = 'idx-ep-title';
    titleEl.textContent = 'あとがき';
    el.appendChild(titleEl);

    const chips = document.createElement('p');
    chips.className = 'idx-chips';
    const key = storage.afterwordKey(vol.volume);
    const isReached = reached.has(key);
    const isRead = read.has(key);
    const link = document.createElement('a');
    link.className = 'idx-chip'
        + (isReached ? ' idx-chip--reached' : '')
        + (isRead ? ' idx-chip--read' : '');
    link.href = afterwordHref(vol.volume);
    const marks = [isRead ? '読破' : isReached ? '既読' : ''].filter(Boolean);
    link.setAttribute('aria-label', [`第${vol.volume}巻 あとがき`, ...marks].join(' '));
    const labelEl = document.createElement('span');
    labelEl.textContent = '01';
    labelEl.setAttribute('aria-hidden', 'true');
    link.appendChild(labelEl);
    chips.appendChild(link);
    el.appendChild(chips);
    return el;
}

// ----- 栞 -----

function locLabel(ep: number, sec: number): string {
    const epTitle = _episodes.find(e => e.id === ep)?.title ?? '';
    return epTitle ? `第${ep}話 ${plainTitle(epTitle)} #${sec}` : `第${ep}話 #${sec}`;
}

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

// 1 行（index.html の #idx-bm-row-tpl）。go は押したときにすること（着地の受け渡しを書く）、del は確認のあとに消すこと。
// del が無い行（スロット 0）は × を出さない
function _bmRow(o: { auto: boolean; name: string; loc: string; detail: string; href: string; ratio: number; go: () => void; del?: () => void }): HTMLElement {
    const tpl = document.getElementById('idx-bm-row-tpl') as HTMLTemplateElement;
    const row = (tpl.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
    const link = row.querySelector<HTMLAnchorElement>('.idx-bm-go')!;
    if (o.auto) {
        row.classList.add('idx-bm-slot--auto');
        const icon = (document.getElementById('idx-bm-auto-icon-tpl') as HTMLTemplateElement).content.firstElementChild!.cloneNode(true);
        link.querySelector('svg')?.replaceWith(icon);
    }
    link.href = o.href;
    link.title = `${o.name}：${o.detail}`;
    link.setAttribute('aria-label', `${o.name}：${o.detail}`);
    link.addEventListener('click', o.go);
    row.querySelector('.idx-bm-loc')!.textContent = o.loc;
    (row.querySelector('.idx-bm-ratio') as HTMLMeterElement).value = o.ratio;
    const del = row.querySelector<HTMLButtonElement>('.idx-bm-del')!;
    const remove = o.del;
    if (!remove) {
        del.remove();
        return row;
    }
    del.setAttribute('aria-label', `${o.name}を消す`);
    del.addEventListener('click', () => {
        void confirmAndRun(`${o.name}（${o.loc}）を削除しますか？`, () => {
            // 欄は描き直す＝押した × は消える。フォーカスがページの外（body）へ落ちないよう、同じ位置かその上の × へ移す
            const at = [...document.querySelectorAll('#bookmark-slots .idx-bm-slot')].indexOf(row);
            remove();
            _focusBookmarkNear(at);
        });
    });
    return row;
}

// 栞の欄を描き直したあとのフォーカス：at 行目以降で最初の ×、無ければその上の最後の ×、それも無ければ栞の見出し
function _focusBookmarkNear(at: number): void {
    const rows = [...document.querySelectorAll<HTMLElement>('#bookmark-slots .idx-bm-slot')];
    const delAt = (r: HTMLElement | undefined) => r?.querySelector<HTMLButtonElement>('.idx-bm-del') ?? null;
    const target = rows.slice(at).map(delAt).find(Boolean) ?? rows.slice(0, at).reverse().map(delAt).find(Boolean)
        ?? document.getElementById('idx-bm-label');
    // 確認（<dialog>）が閉じたときの「開いた要素へ戻す」が先に走るので、その後で移す
    requestAnimationFrame(() => target?.focus());
}

// 栞の欄。スロット0＝オートセーブ（「続きから読む」の地点。読破した節の末尾なら帯を満たす。読破もオートセーブも無ければ出さない。
// 消す手段は「読破を消す」だけなので × は無い）、スロット1〜3＝手動栞（常に出す）
function renderBookmarks(): void {
    const container = document.getElementById('bookmark-slots');
    if (!container) return;
    container.innerHTML = '';

    const point = _resumePoint();
    if (point && point.kind !== 'first') {
        const ratio = point.kind === 'autosave' ? point.ratio : 1;
        container.appendChild(_bmRow({
            auto: true, name: 'オートセーブ', loc: posLabel(point.ep, point.sec),
            detail: `${locLabel(point.ep, point.sec)}（${percent(ratio)}）`,
            href: _resumeHref(point), ratio,
            go: () => _writeResumeLanding(point),
        }));
    }

    const bySlot = new Map(storage.getBookmarksWithSlots().map(b => [b.slot, b]));
    const emptyTpl = document.getElementById('idx-bm-empty-tpl') as HTMLTemplateElement;
    for (let slot = 1; slot <= 3; slot++) {
        const entry = bySlot.get(slot);
        if (!entry) {
            const row = (emptyTpl.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
            row.querySelector('.idx-sr-only')!.textContent = `栞 ${slot}：`;   // 見える文字は「空き」だけ（HTML）。読み上げはどのスロットかを足す
            container.appendChild(row);
            continue;
        }
        const { ep, sec, scene } = entry;
        container.appendChild(_bmRow({
            auto: false, name: `栞 ${slot}`, loc: posLabel(ep, sec),
            detail: locLabel(ep, sec) + (scene === 0 ? '（タイトル画面）' : `（${percent(entry.ratio)}）`),
            href: withQuery(`contents/${pad(ep)}-${pad(sec)}.html`), ratio: scene === 0 ? 0 : entry.ratio,
            go: () => storage.writePendingJump({ ep, sec, scene, ratio: entry.ratio }),
            del: () => { storage.removeBookmark(entry.slot); refreshRecords(); },
        }));
    }
}

// 読者の記録（栞・既読・読破・オートセーブ）が変わったあとに、それを映す所をまとめて描き直す
function refreshRecords(): void {
    renderStory(storage.loadReachedKeys(), storage.loadReadKeys());
    renderBookmarks();
    renderCta();
}

// ----- 世界（資料ページへの入口） -----

// 3 つのタイルの href に今のクエリを付け直す（?dev の引き継ぎ＝作者の閲覧を計測させない）。story.json を待たない
function initWorldLinks(): void {
    for (const [id, page] of [['idx-world-chara', 'characters.html'], ['idx-world-map', 'map.html'], ['idx-world-glossary', 'glossary.html']]) {
        const link = document.getElementById(id);
        if (link instanceof HTMLAnchorElement) link.href = withQuery(page);
    }
}

// ----- 設定（上の帯の ⚙）・共有 -----

// 設定シート（ui/settings-panel。markup は templates/parts/settings.html＝本文ページと同じ断片）の host を目次用に結ぶ。
// 目次は本文を持たないので CSS 変数・<html data-writing-mode> へは反映せず、保存だけ（目次が縦書きになる事故が構造的に起きない）。
// PC では開いている間、ページ全体を本文の見本（#idx-preview）にして、選んだ設定をそこへ写す。
// 「設定を初期値に戻す」は表示設定 5 項目と読書点のキーを消す（removeSettings。本文側は既定値を書くが、読み手が null を
// 既定へ倒すので読者にとっては同値。e2e/settings-reset.spec.ts）。
function initSettings(): void {
    settingsPanel.init({
        current: loadSettings,
        select: (key, value) => { saveSetting(key, value); renderPreview(); },
        preset: (id) => {
            const preset = PRESETS.find((p) => p.id === id);
            if (preset) saveSettings(preset.values);
            renderPreview();
        },
        reset: () => { removeSettings(); renderPreview(); },
        clearBookmarks: () => { storage.clearAllBookmarks(); refreshRecords(); },   // 手動の栞だけ
        clearReached: () => { storage.clearReached(); refreshRecords(); },
        clearRead: () => {
            storage.clearRead();
            refreshRecords();
            applyStoryStage();
        },
    });
    const btn = document.getElementById('idx-btn-settings');
    const preview = document.getElementById('idx-preview');
    btn?.addEventListener('click', () => {
        const wide = matchMedia(PC_QUERY).matches;
        if (wide && preview) { renderPreview(); preview.hidden = false; }
        // スマホは見本を出さないので全画面（本文から開くときは裏の本文が見本になる＝断片の段のまま）
        settingsPanel.open(btn, { detent: wide ? undefined : 'full' });
    });
    document.getElementById('settings-popup')?.addEventListener('close', () => { if (preview) preview.hidden = true; });
}

// 本文の見本に今の設定を写す（data-* だけ。組みは toc-page.css）
function renderPreview(): void {
    const text = document.getElementById('idx-preview-text');
    if (!text) return;
    const s = loadSettings();
    text.dataset.writingMode = s.writingMode;
    text.dataset.lineGap = s.lineGap;
    text.dataset.font = s.fontFamily;
    text.dataset.size = s.fontSize;
    text.dataset.weight = s.fontWeight;
}

function initShare(): void {
    share.init();
    const btn = document.getElementById('idx-btn-share');
    btn?.addEventListener('click', () => share.open(btn));
}

// ----- 変更履歴 -----

// 版種別スイッチで ON の種別（初期値はメジャー＋マイナー。永続化しない）と、「すべて表示」の展開状態
const _changelogKinds = new Set<VersionKind>(['major', 'minor']);
let _changelogExpanded = false;

/**
 * 版種別と展開状態を #content-changelog-list に反映する。表示の出し入れはこの関数だけが決める。
 * 初期件数は絞り込み後の何件目かで数える。該当 0 件なら空表示、初期件数を超えるときだけ「すべて表示（N 件）／閉じる」。
 * 展開したら枠の中だけをスクロールさせる（ページを伸ばさない＝ .is-expanded。toc-page.css）
 * _applyChangelogFilter(): void
 */
function _applyChangelogFilter(): void {
    const listEl = document.getElementById('content-changelog-list');
    const emptyEl = document.getElementById('content-changelog-empty');
    const toggleBtn = document.getElementById('content-changelog-toggle');
    if (!listEl) return;
    let shown = 0;
    listEl.querySelectorAll<HTMLLIElement>('li.cl-entry').forEach(li => {
        const match = _changelogKinds.has(li.dataset.kind as VersionKind);
        li.hidden = !match || (!_changelogExpanded && shown >= CHANGELOG_INITIAL_COUNT);
        if (match) shown++;
    });
    listEl.classList.toggle('is-expanded', _changelogExpanded);
    if (emptyEl) emptyEl.hidden = shown > 0;
    if (toggleBtn) {
        toggleBtn.hidden = shown <= CHANGELOG_INITIAL_COUNT;
        toggleBtn.textContent = _changelogExpanded ? '閉じる' : `すべて表示（${shown} 件）`;
        toggleBtn.setAttribute('aria-expanded', String(_changelogExpanded));
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

// 1 行＝日付・版・話ごとのコミットへのリンク（上の行）＋変更の内容。記述順のまま全件を描く
function _renderContentChangelog(entries: ContentChangelogEntry[]): void {
    const listEl = document.getElementById('content-changelog-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    for (const entry of entries) {
        const li = document.createElement('li');
        li.className = 'cl-entry';
        li.dataset.kind = versionKind(entry.version);

        const header = document.createElement('header');
        header.className = 'cl-header';
        const date = document.createElement('time');
        date.className = 'cl-date';
        date.textContent = entry.date;
        header.appendChild(date);
        const ver = document.createElement('span');
        ver.className = 'cl-version';
        ver.textContent = `v${entry.version}`;
        header.appendChild(ver);
        entry.ep.forEach((epNum, j) => {
            // sha は ep と同じ並びの前提だが手で後入れするので揃わないことがある。揃っていなければリンクにしない
            const sha = entry.sha?.[j] ?? '';
            let chip: HTMLElement;
            if (SHORT_SHA_RE.test(sha)) {
                const link = document.createElement('a');
                link.href = `https://github.com/${GITHUB_REPO}/commit/${sha}`;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                chip = link;
            } else {
                chip = document.createElement('span');
            }
            chip.className = 'cl-ep-link';
            chip.textContent = `第${epNum}話`;
            header.appendChild(chip);
        });
        li.appendChild(header);

        const changeEl = document.createElement('p');
        changeEl.className = 'cl-change';
        changeEl.textContent = entry.change;
        li.appendChild(changeEl);
        listEl.appendChild(li);
    }
    _applyChangelogFilter();
}

// 足もとの版（本文・サイト）。changelog の先頭の版
function _updateVersion(type: 'content' | 'site', version: string): void {
    const el = document.getElementById(`badge-${type}-version`);
    if (el) el.textContent = version;
}

async function loadChangelog(type: 'content' | 'site'): Promise<void> {
    try {
        const res = await fetch(`changelog/${type}-changelog.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (type === 'content') {
            const entries = (await res.json()) as ContentChangelogEntry[];
            _updateVersion('content', entries[0]?.version ?? '');
            _renderContentChangelog(entries);
        } else {
            const entries = (await res.json()) as SiteChangelogEntry[];
            _updateVersion('site', entries[0]?.version ?? '');
        }
    } catch {
        if (type === 'content') {
            const section = document.getElementById('content-changelog');
            if (section) section.hidden = true;
        }
    }
}

// ----- エントリポイント -----

async function main(): Promise<void> {
    // 栞・オートセーブのスキーマ移行を確実に走らせる（移行の持ち主は core/storage だけ）
    storage.init();
    // 目次を開いたら記録の保留を解除する（要件 06-5）。bfcache から戻ったときは下の起動処理が走らないので pageshow でも
    recordHold.clearHeld();
    window.addEventListener('pageshow', (e) => { if (e.persisted) recordHold.clearHeld(); });
    // 廃止した表紙の URL のキャッシュ（P4 まで index.ts と main.ts が書いていた）を掃除する
    try { localStorage.removeItem('lirmena.heroCard'); } catch { /* noop */ }
    // story.json の取得を待たずに結線する（待つ間に押されても素の href で動く）
    initWorldLinks();
    initCta();
    renderCta();
    initHeroGallery();
    initLayoutObservers();
    initSettings();
    initShare();
    _initChangelogControls();
    void loadChangelog('content');
    void loadChangelog('site');

    try {
        // 毎回確認して取得する（変更がなければ 304）。HTML だけ新しく story.json が 10 分キャッシュのままだと、
        // 埋め込みの表で第 2 巻を出した後に第 1 巻へ戻ってしまうため（要件 06-7「次巻の公開直後」）
        const res = await fetch('story.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _story = (await res.json()) as StoryVolume[];
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
    _episodes = _story.flatMap(vol => vol.episodes);
    refreshRecords();
    renderNews();
    applyStoryStage();
}

void main();
