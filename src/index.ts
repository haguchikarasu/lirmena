/*
 * index.ts
 * 責務: 目次ページ（index.html）の全機能制御。story.json を読み、vol 単位で ep・sec 一覧と巻末あとがき
 *       チップを描画し、栞・オートセーブ（本編／あとがき独立）を並べ、stage に応じてヒーローカード画像を
 *       差し替える。設定ポップアップ／共有／FAB／変更履歴は既存流用。
 * export: なし（script type="module" としてロードされるエントリポイント）
 * 依存: bookmark.ts（スキーマ移行 init() のみ。read セットは loadReadKeys() で localStorage を直読みする
 *       ＝目次内で「読破状況をクリア」した直後に bookmark 側のメモリキャッシュが古いままになるのを避けるため。
 *       applyStoryStage 参照）、
 *       volumes.ts（computeStoryStage＝ヒーローカード切替と巻カードの初期 open 判定に共用）。
 *       src/ 内はこの2本のみ例外 import（目次の独立方針の緩和：判定ロジックを二重化しない・二重管理を避ける）。
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
 *   - ep タイトル・栞の場所表示の |漢字《かんじ》 をルビ展開（applyRuby＝src/ruby.ts の inline 複製）
 *   - 到達セット・読了セットは本文 sec キー（"EP-SEC"）とあとがきキー（"vol[XX]-af"）が同じ Set に入る
 *     ＝bookmark.ts と共有する localStorage キー "reached" / "read" をそのまま Set 化する
 *   - 栞欄を固定3スロット表示：スロット0＝オートセーブ（本編／あとがきのうち savedAt が新しい方を表示）
 *   - 続きから読む：loadLatestAutoSave で本編／あとがき union を取り、pendingJump または pendingJumpAfterword を書いて遷移
 *
 * localStorage キー（bookmark.ts と共有・変更時は両側を合わせる）:
 *   "reached"              : string[]         到達キー集合。"EP-SEC" と "vol[XX]-af" が混在
 *   "read"                : string[]         読了キー集合。同上
 *   "autosave"             : { ep, sec, ratio, savedAt }   本編の最新読書位置
 *   "autosaveAfterword"    : { vol, ratio, savedAt }        あとがきの最新読書位置（独立キー）
 *   "bookmarks"            : BookmarkEntry[]  手動栞（本編 sec のみ・あとがきは対象外）
 *   "pendingJump"          : { ep, sec, scene, ratio }     本編ジャンプ受け渡し
 *   "pendingJumpAfterword" : { vol, ratio }                あとがきジャンプ受け渡し
 *   "sceneRead"            : string[]         旧 "ep-sec-scene" 形式（移行前フォールバック）
 *   "lirmena.*"            : 表示設定（writingMode/lineGap/fontFamily/fontSize/fontWeight）
 *   "lirmena.readingAnchor": 読書点の位置（settings.ts が所有。目次は表示に使わず「設定をリセット」で消すだけ）
 *   "lirmena.heroCard"     : string   ヒーローカード画像の相対パス "vol[XX]/<file>"。applyStoryStage が書き、
 *                            index.html の早期 <script> が次回ロードのパース時点で読む（初期表示のちらつき回避）。
 *                            検証規則 HERO_CARD_RE は HTML 側と同一＝片方だけ直すと静かに vol01 へ落ちる。
 */

import './styles/toc.css';
import * as bookmark from './bookmark';
import { computeStoryStage, resolveHeroCard, HERO_CARD_RE } from './volumes';

// preview（vol/ep 単位の予告テキスト・要件 06-7）は任意。**text が非空**のときのみ「予告あり」扱いで
// 目次に表示する。空 text（`{ text: "" }`）は「preview 無し」と同義扱いで、事前配置テンプレとして
// 未着手 vol/ep に骨組みだけ置ける（story-integrity (j)(k)(k')(l)/(e) の判定も「非空 text」でのみ発火）。
// 目次では sec chip の代わりにタイトル＋予告テキストを出す（ep）／summary 相当のヘッダのみ出す（vol）。
type Preview = { text: string };
// preview が定義されかつ text の trim が非空なら true。renderStory の描画分岐に使う。
// **src/story-integrity.ts の同名関数と対の複製**（独立方針で import しない）。向こうはビルドを止める判定・
// こちらは目次に描くかの判定なので、ズレると build は通るのに目次だけ壊れる（vol が丸ごと消える等）。
// 片方を直したら必ず両方直すこと。
// 実データは build 時 (j) 検査を通っているが、null/非オブジェクト/非 string text にも防御的に false を返す。
function _hasEffectivePreview(preview: Preview | undefined): boolean {
    if (preview === undefined || preview === null) return false;
    if (typeof preview !== 'object') return false;
    if (typeof preview.text !== 'string') return false;
    return preview.text.trim() !== '';
}
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
type BookmarkEntry = {
    slot: number;
    ep: number;
    sec: number;
    scene: number;
    ratio: number;
    savedAt: number;
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

// 本編／あとがきのオートセーブを union で表す。「続きから読む」は savedAt が新しい方を採用する。
type LatestAutoSave =
    | { kind: 'sec'; ep: number; sec: number; ratio: number; savedAt: number }
    | { kind: 'afterword'; vol: number; ratio: number; savedAt: number };

// localStorage キー（bookmark.ts / settings.ts と同一）
const LS_REACHED               = 'reached';
const LS_READ                  = 'read';
const LS_AUTOSAVE              = 'autosave';
const LS_AUTOSAVE_AFTERWORD    = 'autosaveAfterword';
const LS_BOOKMARKS             = 'bookmarks';
const LS_PENDING_JUMP          = 'pendingJump';
const LS_PENDING_JUMP_AFTERWORD = 'pendingJumpAfterword';
const LS_SCENE_READ            = 'sceneRead';
const LS_FONT_SIZE             = 'lirmena.fontSize';
const LS_FONT_FAMILY           = 'lirmena.fontFamily';
const LS_LINE_GAP              = 'lirmena.lineGap';
const LS_FONT_WEIGHT           = 'lirmena.fontWeight';
const LS_WRITING_MODE          = 'lirmena.writingMode';
// 読書点。目次は調整 UI も表示反映も持たないが「設定をリセット」の対象には入る（要件 06-4）。
// そのため設定行の DEFAULTS / buildRow / refreshRows には現れず、リセットの removeItem にだけ現れる。
const LS_READING_ANCHOR        = 'lirmena.readingAnchor';
// ヒーローカード画像の相対パス（"vol[XX]/<file>"）。applyStoryStage と本文側 main.ts が書き、
// index.html の早期 <script> が次回ロードのパース時点で読む＝初期表示のちらつき回避
// （lirmena.storyStage と同じ流儀）。値の解決と検証規則は volumes.ts に置く（本文側と共用するため）。
const LS_HERO_CARD             = 'lirmena.heroCard';

const DEFAULTS = { fontSize: 'medium', fontFamily: 'serif', lineGap: 'on', fontWeight: 'normal', writingMode: 'horizontal' } as const;

function clearAllBookmarkSlots(): void {
    localStorage.removeItem(LS_BOOKMARKS);
}

const GITHUB_REPO = 'haguchikarasu/lirmena';
// 短縮 sha の形。content-changelog.json の sha は「本体コミット確定後に手で入れる」運用なので、
// 未確定プレースホルダや欠損のまま公開され得る。その状態で commit/undefined を指すリンクを作らない判定。
const SHORT_SHA_RE = /^[0-9a-f]{7,40}$/;

let _episodes: Episode[] = [];
const CHANGELOG_INITIAL_COUNT = 3;

const pad = (n: number) => String(n).padStart(2, '0');
const withQuery = (path: string): string => path + location.search;

// あとがきキー "vol01-af" を生成（bookmark.ts の afterwordKey と同じ形式・独立方針で複製）
const afterwordKey = (vol: number): string => `vol${pad(vol)}-af`;

// |base《rt》 記法をパースして ruby 要素とテキストノードを el に追加する。
// src/ruby.ts の applyRuby と同一ロジック（独立方針で inline 複製・XSS 安全）。
function applyRuby(text: string, el: HTMLElement): void {
    const re = /\|([^《\n]+)《([^》\n]+)》/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
        const ruby = document.createElement('ruby');
        ruby.appendChild(document.createTextNode(m[1]));
        const rt = document.createElement('rt');
        rt.textContent = m[2];
        ruby.appendChild(rt);
        el.appendChild(ruby);
        last = m.index + m[0].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}

// ----- localStorage ヘルパー -----

function loadStringSet(key: string): Set<string> {
    try {
        const raw = localStorage.getItem(key);
        if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
    return new Set();
}

// 旧 "sceneRead" の完了マーカー "ep-sec-00" を "ep-sec" 集合として返す（移行前フォールバック）
function loadLegacyDoneSections(): Set<string> {
    const result = new Set<string>();
    for (const k of loadStringSet(LS_SCENE_READ)) {
        const parts = k.split('-');
        if (parts.length === 3 && parts[2] === '00') result.add(`${parts[0]}-${parts[1]}`);
    }
    return result;
}

// 到達キー集合（本文 sec "EP-SEC" とあとがき "vol[XX]-af" が混在）＋旧 sceneRead フォールバック
function loadReachedKeys(): Set<string> {
    const result = loadStringSet(LS_REACHED);
    for (const k of loadLegacyDoneSections()) result.add(k);
    return result;
}

// 読了キー集合（同上）
function loadReadKeys(): Set<string> {
    const result = loadStringSet(LS_READ);
    for (const k of loadLegacyDoneSections()) result.add(k);
    return result;
}

function loadBookmarks(): BookmarkEntry[] {
    try {
        const raw = localStorage.getItem(LS_BOOKMARKS);
        if (!raw) return [];
        const list = JSON.parse(raw) as Array<Record<string, unknown>>;
        const entries = list.map((o) => {
            const addr = (o.address ?? o) as Record<string, unknown>;
            const slotRaw = Number(o.slot);
            const slot = (slotRaw === 1 || slotRaw === 2 || slotRaw === 3) ? slotRaw : 0;
            const ratio = Number(o.ratio);
            return {
                slot,
                ep: Number(addr.ep),
                sec: Number(addr.sec),
                scene: Number(addr.scene) || 0,
                ratio: Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0,
                savedAt: Number(o.savedAt) || Date.now(),
            };
        }).filter((b) => Number.isFinite(b.ep) && Number.isFinite(b.sec));

        const taken = new Set(entries.filter(b => b.slot >= 1 && b.slot <= 3).map(b => b.slot));
        for (const b of entries.filter(b => b.slot === 0).sort((a, b) => a.savedAt - b.savedAt)) {
            for (let s = 1; s <= 3; s++) {
                if (!taken.has(s)) { b.slot = s; taken.add(s); break; }
            }
        }
        return entries;
    } catch { /* ignore */ }
    return [];
}

// ----- 既読/読破判定 -----

// sec 単位キー "EP-SEC" が集合に含まれるか
function isSectionInSet(ep: number, sec: number, set: Set<string>): boolean {
    return set.has(`${pad(ep)}-${pad(sec)}`);
}

// あとがきキー "vol[XX]-af" が集合に含まれるか
function isAfterwordInSet(vol: number, set: Set<string>): boolean {
    return set.has(afterwordKey(vol));
}

function clearReached(): void {
    localStorage.removeItem(LS_REACHED);
    localStorage.removeItem(LS_SCENE_READ);
}

function clearReadStatus(): void {
    localStorage.removeItem(LS_READ);
    localStorage.removeItem(LS_SCENE_READ);
    // stage が 1 に戻るのでヒーローカードのキャッシュも捨てる。直後に applyStoryStage が呼ばれて上書き
    // されるが、story が空・heroFile 未解決のときは src を触らずに抜けるため古い値が残りうる。
    localStorage.removeItem(LS_HERO_CARD);
}

function confirmAndRun(msg: string, run: () => void): void {
    if (window.confirm(msg)) run();
}

// 本編オートセーブ（最新の読書位置）を読む
function loadAutoSave(): { ep: number; sec: number; ratio: number; savedAt: number } | null {
    try {
        const raw = localStorage.getItem(LS_AUTOSAVE);
        if (!raw) return null;
        const o = JSON.parse(raw) as { ep?: unknown; sec?: unknown; ratio?: unknown; savedAt?: unknown };
        const ep = Number(o.ep);
        const sec = Number(o.sec);
        if (Number.isFinite(ep) && Number.isFinite(sec)) {
            const ratio = Number(o.ratio);
            return { ep, sec, ratio: Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0, savedAt: Number(o.savedAt) || Date.now() };
        }
    } catch { /* ignore */ }
    return null;
}

// あとがきオートセーブを読む（独立キー）
function loadAutoSaveAfterword(): { vol: number; ratio: number; savedAt: number } | null {
    try {
        const raw = localStorage.getItem(LS_AUTOSAVE_AFTERWORD);
        if (!raw) return null;
        const o = JSON.parse(raw) as { vol?: unknown; ratio?: unknown; savedAt?: unknown };
        const vol = Number(o.vol);
        if (!Number.isFinite(vol)) return null;
        const ratio = Number(o.ratio);
        return { vol, ratio: Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0, savedAt: Number(o.savedAt) || Date.now() };
    } catch { /* ignore */ }
    return null;
}

// 本編／あとがきのうち savedAt が新しい方を union として返す。「続きから読む」ボタン／FAB／スロット0で使う。
function loadLatestAutoSave(): LatestAutoSave | null {
    const sec = loadAutoSave();
    const aft = loadAutoSaveAfterword();
    if (!sec && !aft) return null;
    if (!aft) return { kind: 'sec', ep: sec!.ep, sec: sec!.sec, ratio: sec!.ratio, savedAt: sec!.savedAt };
    if (!sec) return { kind: 'afterword', vol: aft.vol, ratio: aft.ratio, savedAt: aft.savedAt };
    return sec.savedAt >= aft.savedAt
        ? { kind: 'sec', ep: sec.ep, sec: sec.sec, ratio: sec.ratio, savedAt: sec.savedAt }
        : { kind: 'afterword', vol: aft.vol, ratio: aft.ratio, savedAt: aft.savedAt };
}

// pendingJump（本編）または pendingJumpAfterword（あとがき）を書く（union 対応）
function writeResumeJump(latest: LatestAutoSave): void {
    if (latest.kind === 'afterword') {
        localStorage.setItem(LS_PENDING_JUMP_AFTERWORD, JSON.stringify({ vol: latest.vol, ratio: latest.ratio }));
    } else {
        localStorage.setItem(LS_PENDING_JUMP, JSON.stringify({ ep: latest.ep, sec: latest.sec, scene: 0, ratio: latest.ratio }));
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
    const latest = loadLatestAutoSave();
    if (!latest) return;
    btn.hidden = false;
    btn.addEventListener('click', () => resumeReading(latest));
}

// ----- 物語進行段階＆ヒーローカード切替 -----

// stage を <html data-story-stage> に反映し、対応するヒーローカード画像へ差し替える。
// - stage N（1 ≤ N ≤ story.length） → story.find(v => v.volume === N)?.heroCard.file
// - stage story.length + 1（物語完結） → 最終 vol（volume 番号最大）の heroCardCompleted.file
// bookmark.getRead() は本文 sec キーとあとがきキーの混在配列だが、computeStoryStage が
// 本文 sec 用 regex でフィルタするためあとがきキーは stage 判定に影響しない。
function applyStoryStage(story: StoryVolume[]): void {
    if (story.length === 0) return;
    // localStorage を直読みして最新の read セットを取る。bookmark.getRead() は
    // モジュール内メモリキャッシュ（bookmark.init 時に固定）を返すため、目次内で「読破状況を
    // クリア」した直後の再計算では古いキャッシュを返してしまい stage / ヒーローカードが
    // 更新されない。目次は他の表示 API も localStorage 直読みで統一しているのでこちらへ寄せる。
    const read = Array.from(loadReadKeys());
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
    return ['#settings-popup', '#share-popup'].some((sel) => {
        const el = document.querySelector<HTMLElement>(sel);
        return el !== null && !el.hidden;
    });
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
                hasPreview: _hasEffectivePreview(ep.preview),
            }))
            .filter(x => x.publishedSecs.length > 0 || x.hasPreview);
        const hasAfterword = vol.afterword?.published === true;
        const hasVolPreview = _hasEffectivePreview(vol.preview);
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
    const hasVolPreview = _hasEffectivePreview(vol.preview);
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
    const latest = loadLatestAutoSave();
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
            if (latest.kind === 'afterword') localStorage.removeItem(LS_AUTOSAVE_AFTERWORD);
            else localStorage.removeItem(LS_AUTOSAVE);
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
    const bySlot = new Map(loadBookmarks().map(b => [b.slot, b]));
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
            localStorage.setItem(LS_PENDING_JUMP, JSON.stringify({ ep, sec, scene, ratio: entry.ratio }));
        });
        actions.appendChild(jumpBtn);

        const clearBtn = document.createElement('button');
        clearBtn.className = 'idx-bm-del';
        clearBtn.type = 'button';
        clearBtn.textContent = '削除';
        clearBtn.addEventListener('click', () => {
            const remaining = loadBookmarks().filter(b => b.savedAt !== entry.savedAt);
            if (remaining.length === 0) {
                localStorage.removeItem(LS_BOOKMARKS);
            } else {
                localStorage.setItem(LS_BOOKMARKS, JSON.stringify(remaining));
            }
            renderBookmarks();
        });
        actions.appendChild(clearBtn);

        const locText = locLabel(ep, sec) + (scene === 0 ? '（タイトル画面）' : `（${fmtRatioPercent(entry.ratio)}）`);
        container.appendChild(buildSlotCard(`スロット${slot}`, locText, fmtDate(entry.savedAt), actions));
    }
}

// ----- 設定ポップアップ -----

// 本文ページ src/settings.ts の _buildPopup() と同じ markup・同じ localStorage キーを手で揃えた二重実装
// （index.ts は settings.ts を import しない＝リーフ間非依存を保つため。.dependency-cruiser.cjs の
//   index-src-isolation ルールが機械的に強制する。理由は design/modules/index.md）。
// **行の並びは両ページで一致させること**（要件 06-4 の設定項目表の順）。
// 設定行を足す・並びを変えるときは settings.ts 側と、このファイル内の次の6箇所を同時に直す：
//   1) LS_* 定数  2) DEFAULTS  3) DISPLAY_SETTINGS（キー・既定値・有効値。refreshRows と一致判定が共用）
//   4) buildRow の呼び出し順  5) 「設定をリセット」の removeItem  6) PRESETS の values（全プリセットに新項目を足す）
// （さらにファイル冒頭 IF コメントの localStorage キー一覧）。並びのズレは e2e/settings-order.spec.ts が検出する。
// 目次ページは本文を持たないので CSS 変数へは反映せず、localStorage 保存と .active トグルだけを行う。
// なお読書点（lirmena.readingAnchor）は設定「行」を持たないので上記 1)〜4) には現れないが、
// **5) のリセットには含める**：「設定をリセット」はグローバルな初期化であって表示設定だけの初期化ではない
// （要件 06-4）。目次には読書点マーカーが無いため効果は次に本文ページを開いたときに現れる。
// 本文側は setReadingAnchor(既定) ＝ setItem('45')、目次側は removeItem という非対称だが、
// settings.ts の _loadReadingAnchor() が null を既定値 45 へ倒すので読み手にとっては同値。
function buildSettingsPopup(story: StoryVolume[]): void {
    const popup = document.getElementById('settings-popup');
    if (!popup) return;

    const optEntries = new Map<string, Array<{ btn: HTMLButtonElement; value: string }>>();
    const presetEntries: Array<{ btn: HTMLButtonElement; id: string }> = [];

    // 表示設定5項目の localStorage キー・既定値・有効値。行の並び順（要件 06-4）に合わせてある。
    // 有効値を持つのは本文側 settings.ts の _readEnum に揃えるため——揃えないと lirmena.fontSize='huge' のような
    // 残留値があったときに、本文は既定へ倒して目次は生値のまま扱い、両ページのプリセット選択表示がズレる。
    const DISPLAY_SETTINGS: ReadonlyArray<{ key: string; def: string; valid: readonly string[] }> = [
        { key: LS_WRITING_MODE, def: DEFAULTS.writingMode, valid: ['vertical', 'horizontal'] },
        { key: LS_LINE_GAP,     def: DEFAULTS.lineGap,     valid: ['on', 'off'] },
        { key: LS_FONT_FAMILY,  def: DEFAULTS.fontFamily,  valid: ['serif', 'sans'] },
        { key: LS_FONT_SIZE,    def: DEFAULTS.fontSize,    valid: ['large', 'medium', 'small'] },
        { key: LS_FONT_WEIGHT,  def: DEFAULTS.fontWeight,  valid: ['normal', 'bold'] },
    ];

    // 本文側 src/settings.ts の PRESETS と手で揃えた複製（settings.ts を import できないため）。
    // ズレは e2e/settings-preset.spec.ts が両ページの表示文字列と localStorage の値マップを突き合わせて検出する。
    const PRESETS: ReadonlyArray<{ id: string; name: string; desc: string; values: Record<string, string> }> = [
        {
            id: 'web', name: 'ウェブ小説風', desc: '横書き・空行あり / ゴシック体',
            values: {
                [LS_WRITING_MODE]: 'horizontal', [LS_LINE_GAP]: 'on', [LS_FONT_FAMILY]: 'sans',
                [LS_FONT_SIZE]: 'medium', [LS_FONT_WEIGHT]: 'normal',
            },
        },
        {
            id: 'book', name: '書籍風', desc: '縦書き・字下げ / 明朝体',
            values: {
                [LS_WRITING_MODE]: 'vertical', [LS_LINE_GAP]: 'off', [LS_FONT_FAMILY]: 'serif',
                [LS_FONT_SIZE]: 'medium', [LS_FONT_WEIGHT]: 'normal',
            },
        },
    ];

    // 未設定・DISPLAY_SETTINGS に無い値は既定へ倒す（本文側 settings.ts の _readEnum と同じ役目）。
    function readSetting(key: string, defaultVal: string): string {
        const raw = localStorage.getItem(key);
        if (raw === null) return defaultVal;
        const spec = DISPLAY_SETTINGS.find((s) => s.key === key);
        return !spec || spec.valid.includes(raw) ? raw : defaultVal;
    }

    // 表示設定1項目の現在値（既定値は DISPLAY_SETTINGS から引く）。
    function currentOf(key: string): string {
        const spec = DISPLAY_SETTINGS.find((s) => s.key === key);
        return readSetting(key, spec?.def ?? '');
    }

    function buildRow(
        label: string,
        lsKey: string,
        defaultVal: string,
        opts: Array<{ value: string; label: string }>,
    ): HTMLElement {
        const row = document.createElement('div');
        row.className = 'settings-row';

        const labelEl = document.createElement('span');
        labelEl.className = 'settings-row__label';
        labelEl.textContent = label;
        row.appendChild(labelEl);

        const optsEl = document.createElement('div');
        optsEl.className = 'settings-row__opts';

        const current = readSetting(lsKey, defaultVal);
        const entries: Array<{ btn: HTMLButtonElement; value: string }> = [];

        for (const opt of opts) {
            const btn = document.createElement('button');
            btn.className = 'settings-opt';
            btn.type = 'button';
            btn.textContent = opt.label;
            if (current === opt.value) btn.classList.add('active');
            btn.addEventListener('click', () => {
                localStorage.setItem(lsKey, opt.value);
                for (const e of entries) {
                    e.btn.classList.toggle('active', e.value === opt.value);
                }
                // 単一行の変更でプリセットとの一致が成立・崩壊するのでカードも更新する（永続化しない派生状態）。
                refreshPresets();
            });
            optsEl.appendChild(btn);
            entries.push({ btn, value: opt.value });
        }
        optEntries.set(lsKey, entries);
        row.appendChild(optsEl);
        return row;
    }

    function buildAction(label: string, handler: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = 'settings-action';
        btn.type = 'button';
        btn.textContent = label;
        btn.addEventListener('click', handler);
        return btn;
    }

    function refreshRows(): void {
        for (const { key } of DISPLAY_SETTINGS) {
            const current = currentOf(key);
            for (const e of optEntries.get(key) ?? []) {
                e.btn.classList.toggle('active', e.value === current);
            }
        }
    }

    // プリセットの小見出しとカード2枚。本文側 settings.ts の _buildPresets と同じ markup・同じ表示文字列。
    // カードは設定の「行」ではない（.settings-row / .settings-row__label を使わない）＝行順を検査する
    // e2e/settings-order.spec.ts の対象外に保つ。
    function buildPresets(): DocumentFragment {
        const frag = document.createDocumentFragment();

        const label = document.createElement('div');
        label.className = 'settings-subtitle';
        label.id = 'settings-preset-label';
        label.textContent = 'プリセット';
        frag.appendChild(label);

        const box = document.createElement('section');
        box.className = 'settings-preset';
        box.setAttribute('aria-labelledby', 'settings-preset-label');

        for (const preset of PRESETS) {
            const btn = document.createElement('button');
            btn.className = 'settings-preset__btn';
            btn.type = 'button';

            const name = document.createElement('span');
            name.className = 'settings-preset__name';
            name.textContent = preset.name;
            btn.appendChild(name);

            const desc = document.createElement('span');
            desc.className = 'settings-preset__desc';
            desc.textContent = preset.desc;
            btn.appendChild(desc);

            btn.addEventListener('click', () => {
                for (const [key, val] of Object.entries(preset.values)) {
                    localStorage.setItem(key, val);
                }
                // buildRow のクリックは自分の行しか更新しないので、複数キーを一括で変えたら refreshRows が要る。
                refreshRows();
                refreshPresets();
            });
            box.appendChild(btn);
            presetEntries.push({ btn, id: preset.id });
        }

        frag.appendChild(box);
        return frag;
    }

    // カードの .active を現在値との一致から導く（永続化しない派生状態。既定値はどちらとも一致しない）。
    function refreshPresets(): void {
        const hit = PRESETS.find((p) => Object.entries(p.values).every(([key, val]) => currentOf(key) === val));
        for (const e of presetEntries) {
            const on = hit !== undefined && e.id === hit.id;
            e.btn.classList.toggle('active', on);
            // .active は見た目だけなので、選択状態を支援技術にも伝える（本文側 settings.ts と同じ）。
            e.btn.setAttribute('aria-pressed', String(on));
        }
    }

    const panel = document.createElement('div');
    panel.className = 'settings-panel';

    const titleEl = document.createElement('div');
    titleEl.className = 'settings-panel__title';
    titleEl.textContent = '表示設定';
    panel.appendChild(titleEl);

    panel.appendChild(buildPresets());
    refreshPresets();

    const presetDivider = document.createElement('div');
    presetDivider.className = 'settings-divider';
    panel.appendChild(presetDivider);

    panel.appendChild(buildRow('書字方向', LS_WRITING_MODE, DEFAULTS.writingMode, [
        { value: 'vertical',   label: '縦書き' },
        { value: 'horizontal', label: '横書き' },
    ]));
    panel.appendChild(buildRow('段落間の空行', LS_LINE_GAP, DEFAULTS.lineGap, [
        { value: 'on',  label: 'あり' },
        { value: 'off', label: 'なし' },
    ]));
    panel.appendChild(buildRow('フォント', LS_FONT_FAMILY, DEFAULTS.fontFamily, [
        { value: 'serif', label: '明朝体' },
        { value: 'sans',  label: 'ゴシック体' },
    ]));
    panel.appendChild(buildRow('文字サイズ', LS_FONT_SIZE, DEFAULTS.fontSize, [
        { value: 'small',  label: '小' },
        { value: 'medium', label: '中' },
        { value: 'large',  label: '大' },
    ]));
    panel.appendChild(buildRow('文字の太さ', LS_FONT_WEIGHT, DEFAULTS.fontWeight, [
        { value: 'normal', label: '通常' },
        { value: 'bold',   label: '太字' },
    ]));

    const divider = document.createElement('div');
    divider.className = 'settings-divider';
    panel.appendChild(divider);

    panel.appendChild(buildAction('栞をクリア', () => {
        confirmAndRun('保存した栞をすべて削除しますか？', () => {
            clearAllBookmarkSlots();
            renderBookmarks();
        });
    }));
    panel.appendChild(buildAction('既読をクリア', () => {
        confirmAndRun('既読の記録をすべて削除しますか？', () => {
            clearReached();
            renderStory(story, loadReachedKeys(), loadReadKeys());
        });
    }));
    panel.appendChild(buildAction('読破状況をクリア', () => {
        confirmAndRun('読破の記録をすべて削除しますか？', () => {
            clearReadStatus();
            renderStory(story, loadReachedKeys(), loadReadKeys());
            applyStoryStage(story);
        });
    }));
    panel.appendChild(buildAction('設定をリセット', () => {
        localStorage.removeItem(LS_WRITING_MODE);
        localStorage.removeItem(LS_LINE_GAP);
        localStorage.removeItem(LS_FONT_FAMILY);
        localStorage.removeItem(LS_FONT_SIZE);
        localStorage.removeItem(LS_FONT_WEIGHT);
        // 表示設定の行を持たないが対象に含める（要件 06-4「設定をリセットでデフォルトに戻す」）。
        localStorage.removeItem(LS_READING_ANCHOR);
        refreshRows();
        // 既定値はどちらのプリセットとも一致しないので、リセット後は両カードとも非 active になるのが正。
        refreshPresets();
    }));

    const closeBtn = document.createElement('button');
    closeBtn.className = 'settings-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '閉じる';
    closeBtn.addEventListener('click', () => { popup.hidden = true; });
    panel.appendChild(closeBtn);

    popup.appendChild(panel);

    popup.addEventListener('click', (e) => {
        if (e.target === popup) popup.hidden = true;
    });
}

// ----- 共有ポップアップ -----

function buildSharePopup(sharePopup: HTMLElement): void {
    const panel = document.createElement('div');
    panel.className = 'settings-panel';

    const titleEl = document.createElement('div');
    titleEl.className = 'settings-panel__title';
    titleEl.textContent = '共有';
    panel.appendChild(titleEl);

    const makeAction = (label: string, handler: () => void): HTMLButtonElement => {
        const btn = document.createElement('button');
        btn.className = 'settings-action';
        btn.type = 'button';
        btn.textContent = label;
        btn.addEventListener('click', () => { sharePopup.hidden = true; handler(); });
        return btn;
    };

    const shareUrl = location.origin + location.pathname;
    panel.append(
        makeAction('リンクをコピー', () => {
            navigator.clipboard.writeText(shareUrl).catch(() => {});
        }),
        makeAction('Xでシェア', () => {
            window.open(
                `https://x.com/intent/tweet?url=${encodeURIComponent(shareUrl)}`,
                '_blank', 'noopener,noreferrer',
            );
        }),
        makeAction('LINEでシェア', () => {
            window.open(
                `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}`,
                '_blank', 'noopener,noreferrer',
            );
        }),
    );

    const closeBtn = document.createElement('button');
    closeBtn.className = 'settings-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '閉じる';
    closeBtn.addEventListener('click', () => { sharePopup.hidden = true; });
    panel.appendChild(closeBtn);

    sharePopup.appendChild(panel);

    sharePopup.addEventListener('click', (e) => {
        if (e.target === sharePopup) sharePopup.hidden = true;
    });
}

// ----- FAB メニュー -----

function initFab(popup: HTMLElement, sharePopup: HTMLElement, story: StoryVolume[]): void {
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

    const latest = loadLatestAutoSave();
    if (latest) addItem('続きから読む', () => { resumeReading(latest); });
    addItem('栞をすべてクリア', () => {
        confirmAndRun('保存した栞をすべて削除しますか？', () => {
            clearAllBookmarkSlots();
            renderBookmarks();
        });
    });
    addItem('既読をクリア', () => {
        confirmAndRun('既読の記録をすべて削除しますか？', () => {
            clearReached();
            renderStory(story, loadReachedKeys(), loadReadKeys());
        });
    });
    addItem('読破状況をクリア', () => {
        confirmAndRun('読破の記録をすべて削除しますか？', () => {
            clearReadStatus();
            renderStory(story, loadReachedKeys(), loadReadKeys());
            applyStoryStage(story);
        });
    });
    addItem('設定', () => { popup.hidden = false; });
    addItem('共有', () => { sharePopup.hidden = false; });

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
        if (!sharePopup.hidden) { sharePopup.hidden = true; return; }
        if (!popup.hidden) { popup.hidden = true; return; }
        if (isOpen()) closeFab(); else openFab();
    });
}

// ----- 更新履歴 -----

function _initChangelogToggle(listEl: HTMLElement, toggleBtn: HTMLButtonElement | null): void {
    if (!toggleBtn) return;
    toggleBtn.hidden = false;
    toggleBtn.addEventListener('click', () => {
        const expanding = toggleBtn.textContent === 'すべて表示';
        listEl.querySelectorAll<HTMLLIElement>('li').forEach((item, i) => {
            if (i >= CHANGELOG_INITIAL_COUNT) item.hidden = !expanding;
        });
        toggleBtn.textContent = expanding ? '閉じる' : 'すべて表示';
    });
}

function _renderContentChangelog(entries: ContentChangelogEntry[]): void {
    const listEl    = document.getElementById('content-changelog-list');
    const toggleBtn = document.getElementById('content-changelog-toggle') as HTMLButtonElement | null;
    if (!listEl) return;
    listEl.innerHTML = '';

    entries.forEach((entry, i) => {
        const li = document.createElement('li');
        li.className = 'cl-entry';

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

        if (i >= CHANGELOG_INITIAL_COUNT) li.hidden = true;
        listEl.appendChild(li);
    });

    if (entries.length > CHANGELOG_INITIAL_COUNT) _initChangelogToggle(listEl, toggleBtn);
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

// ----- エントリポイント -----

async function main(): Promise<void> {
    // 栞・オートセーブのスキーマ移行（schemaVersion 5：単一スロット化＋割合化）を確実に走らせる。
    bookmark.init();

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
    renderStory(story, loadReachedKeys(), loadReadKeys());
    renderBookmarks();
    applyStoryStage(story);
    loadChangelog('content');
    loadChangelog('site');

    initResumeButton();

    const popup = document.getElementById('settings-popup');
    const sharePopup = document.getElementById('share-popup');
    if (popup && sharePopup) {
        buildSettingsPopup(story);
        buildSharePopup(sharePopup);
        initFab(popup, sharePopup, story);
    }
}

main();
