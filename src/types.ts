/**
 * EpisodeSection: story.json の 1 sec エントリ。
 *   published … 公開状態（reader が開けるか）
 * ステージ移行判定は volumes.ts の computeStoryStage が「最大読破位置 ≧ 各 vol の最終公開 sec 位置」＋
 * 「次巻冒頭 sec 公開済み」で動的判定する（end フィールドは撤廃）。詳細は
 * design/requirements/06-5-bookmark.html の「進捗バーの色（物語進行段階：5段階）」節。
 */
export type EpisodeSection = { id: number; published: boolean };
/**
 * Episode: story.json の ep エントリ。
 * coverFile / coverPositionX は ep扉（タイトル画面）背景の指定。任意（省略時は従来挙動）。
 *   coverFile      … 扉背景のファイル名。省略時 'title.avif'。常に epNN/ 配下から解決する
 *   coverPositionX … 例 "30%"。縦長画面（スマホ）のみ background-position-x に反映。横長・未指定は中央
 */
export type Episode = { id: number; title: string; coverFile?: string; coverPositionX?: string; sections: EpisodeSection[] };
/**
 * EpisodesData: story.json の全 vol.episodes を平坦化した Episode[]。
 * state.ts / analytics.ts / title.ts など ep 番号だけで参照したい呼び出し元向けのヘルパー型（従来互換）。
 * 派生元は StoryData。ソースコード上での実体は state.ts が内部で持つ ep のフラット配列。
 */
export type EpisodesData = Episode[];

/**
 * Afterword: story.json の巻末あとがきエントリ。全 vol が持つ（必須）。
 *   published … あとがき本文ページ (contents/vol[XX]-afterword.html) を公開するか。
 *               整合ルール：afterword.published=true ⇔ その vol の全 ep 全 sec が published=true
 *               （build 時に双方向チェック。story-integrity の (e)/(e')）。
 */
export type Afterword = { published: boolean };

/**
 * HeroCardSpec: 目次のヒーローカード画像指定。stage に応じて JS 側で選ぶ。
 *   file … public/cover/ 配下のファイル名（例 "vol01.avif"）
 */
export type HeroCardSpec = { file: string };

/**
 * Volume: story.json のトップレベル vol エントリ。
 *   volume            … 1 始まりの vol 番号（昇順・重複禁止）
 *   epRange           … その vol に属する ep 番号の [開始, 終了]（両端含む）
 *   heroCard          … stage = volume のとき目次に表示するヒーローカード（全 vol 必須）
 *   heroCardCompleted … 物語完結 stage（最終 vol 完読後）に表示するヒーローカード。
 *                       最終 vol（= volume 番号最大）のみが持ち、他 vol は持たない（story-integrity の (g)）。
 *   afterword         … 巻末あとがきのメタ（published のみ）
 *   episodes          … その vol に属する ep 定義（未執筆 ep は末尾から欠けてよい・過剰 ep は禁止）
 */
export type Volume = {
    volume: number;
    epRange: [number, number];
    heroCard: HeroCardSpec;
    heroCardCompleted?: HeroCardSpec;
    afterword: Afterword;
    episodes: Episode[];
};

/**
 * StoryData: story.json のトップレベル型（Volume[]）。
 * ステージ判定・目次・ナビ計算・整合チェックの入力。loader.loadStory() が fetch する。
 */
export type StoryData = Volume[];

/**
 * SceneAddress: 本文ページ内のシーン参照／栞・旧データ移行用の coarse アドレス。
 * マルチページ移行後、ページ間移動（タイトル⇄本文・sec/ep 境界）は ep/sec のみ（SecAddress）で表現し、
 * scene はページ内のスクロール位置から導出される値の参照・栞ジャンプの目安として残す。
 */
export type SceneAddress = { ep: number; sec: number; scene: number };

/**
 * SecAddress: ページ間移動（次/前 sec・ep 境界）を表す sec 単位アドレス。
 * URL ハッシュを廃止し location.href 遷移へ移行したため、ページの同定はこの単位で行う。
 */
export type SecAddress = { ep: number; sec: number };

/**
 * SecKey: 到達／読了セットの要素キー。"EP-SEC" の2桁ゼロ埋め文字列（例 "01-02"）。
 * 旧 sceneRead の "ep-sec-scene"（3 セグメント）とは別形式（sec 単位の2 セグメント）。
 */
export type SecKey = string;

/**
 * AfterwordKey: 巻末あとがき用の到達／読了セットキー。"vol[XX]-af" 形式（例 "vol01-af"）。
 * 既存 SecKey（"EP-SEC" 形式）と regex で区別する（^vol\d{2}-af$）。同じ localStorage キー
 * "reached" / "read" に格納し、stage 判定関数は SecKey 用 regex で除外する。
 * template literal 型で汎用 string からは narrow される（CLAUDE.md §3）。
 */
export type AfterwordKey = `vol${string}-af`;

/**
 * AfterwordAddress: あとがきページの識別。state.init の第2引数に SecAddress の代替として渡す。
 * URL は contents/vol[XX]-afterword.html、body の data 属性は data-vol / data-kind="afterword"。
 */
export type AfterwordAddress = { kind: 'afterword'; vol: number };

/**
 * PageAddress: state.init が受け付けるページアドレスの union。
 * 本文 sec モードは既存 SecAddress を kind: 'sec' で明示、あとがきモードは AfterwordAddress。
 * state.ts 内部で discriminated union として narrow する。
 */
export type PageAddress = ({ kind: 'sec' } & SecAddress) | AfterwordAddress;

/**
 * AutoSaveAfterwordEntry: あとがきページのオートセーブ。本文 sec 用 AutoSaveEntry と独立キーで並立する。
 * ratio はスクロール範囲比（0〜1・書字方向非依存）。localStorage キー "autosaveAfterword"。
 * 「続きから読む」は AutoSaveEntry / AutoSaveAfterwordEntry のうち savedAt が新しい方を採用する。
 */
export type AutoSaveAfterwordEntry = { vol: number; ratio: number; savedAt: number };

/**
 * PendingJumpAfterword: あとがきページへのジャンプ受け渡し（栞・「続きから読む」用）。
 * ratio はスクロール範囲比（0〜1・書字方向非依存）。localStorage キー "pendingJumpAfterword"。
 * 本文 sec 用 PendingJump と独立キーで並立する。
 */
export type PendingJumpAfterword = { vol: number; ratio: number };

/**
 * AutoSaveEntry: オートセーブ（現在 sec の最新読書位置）。常に最新1件を上書き保存する。
 * ratio はスクロール範囲比（forward 進行 px ÷ 進行軸の可動域＝0〜1・書字方向非依存）。座標スケールの差を割合で吸収するため
 * 縦書き⇔横書きで同一スロットを共有でき、復元時は ratio × 現在の可動域で forward 進行 px へ逆算する。
 * localStorage キー "autosave"（schemaVersion 5 で単一スロット・割合化。旧 "autosave"/"autosave.vertical" は移行元）。
 */
export type AutoSaveEntry = { ep: number; sec: number; ratio: number; savedAt: number };

/**
 * PendingJump: 栞ジャンプの受け渡し用。menu.ts / index.ts が書き、遷移先ページがロード時に読んで復元する。
 * ratio はスクロール範囲比（0〜1・書字方向非依存）。ratio>0 はその割合位置へ、ratio 0 かつ scene>0 は scene 先頭へ復元する。
 * localStorage キー "pendingJump"。
 */
export type PendingJump = { ep: number; sec: number; scene: number; ratio: number };

/**
 * ScrollNotification: bg.ts がスクロール購読（rAF スロットル）で算出し、reader.ts へ通知するペイロード。
 * scrollLeft は forward 進行 px（0 起点・正値・書字方向で正規化済み＝axis.getProgress 由来。フィールド名は後方互換で据置だが生 scrollLeft ではない）。
 * ratio はスクロール範囲比（forward 進行 px ÷ 進行軸の可動域＝0〜1・書字方向非依存）。オートセーブ／履歴エントリの位置記録に使う
 * （方向間で同一スロットを共有するための割合表現。可動域 0 のときは 0）。
 * 加えて現在シーン（連続値 P から round(P)+1 を [1,N] にクランプ・1-indexed）と
 * 本文領域基準の連続進捗 progress（0〜1・読書点が先頭テキスト→末尾テキストを走る量。前後の空白余白では 0/1 に固定）を載せる。
 * reader.ts は currentScene を state.ts へ反映し、progress を progress.ts へそのまま渡す。
 */
export type ScrollNotification = { scrollLeft: number; ratio: number; scrollWidth: number; clientWidth: number; currentScene: number; progress: number };

/**
 * BgLayerSpec: bg.ts が #bg-stack に1枚ずつ .bg-layer を構築するための背景指定。
 * main.ts が Scene[] から bgFile / bgPositionX のみを取り出して bg.init() に渡す（Scene 全体は渡さない）。
 * bgFile === null は黒背景レイヤー（@@BG@@・先頭テキスト）。
 */
export type BgLayerSpec = Pick<Scene, 'bgFile' | 'bgPositionX'>;

export type CharacterEntry = { name: string; description: string; image: string };
export type VolumeCharacters = { volume: number; characters: CharacterEntry[] };
export type CharactersData = VolumeCharacters[];

/**
 * ShareContext: state.getShareContext() の戻り値。feedback.ts が Ｘ共有テキスト生成に使う。
 * 本文モード → { kind: 'sec', ep, sec }、あとがきモード → { kind: 'afterword', vol }。
 * feedback.ts は state を通して受動的に情報を得ることで story/volumes データを import しない。
 */
export type ShareContext =
    | { kind: 'sec'; ep: number; sec: number }
    | { kind: 'afterword'; vol: number };

export type ChangelogEntry = { version: string; date: string; change: string; sha: string };

/**
 * parser.ts が生成するシーン構造体。
 * content フィールドの型は parser.ts の IF 設計時に確定する。
 */
export type Scene = {
    bgFile: string | null;
    bgPositionX?: string;  // 例: "30%"。@@BG:file:X%@@ で指定。縦長画面のみ有効
    lineCount: number;
    content: unknown;
};
