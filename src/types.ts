/**
 * EpisodeSection: episodes.json の1 sec エントリ。
 *   published … 公開状態（reader が開けるか）
 *   end       … その sec が **属する vol の最終 sec** かを示すフラグ。**全 sec に required で明示**する。
 *               各 vol の最終 sec のみ true、他は必ず false を書く（省略不可）。
 *               「end フィールドの存在そのものを失念する」ことを防ぐため required にしてある。
 *               物語進行段階（stage 1〜5）の移行判定に使う：ある vol の end sec を read（末尾までスクロール）
 *               すると次の stage に上がる（stage N は「vol (N-1) を完読した」状態）。
 *               詳細は requirements/06-5-bookmark.html の「進捗バーの色（物語進行段階：5段階）」節、
 *               判定は volumes.ts の computeStoryStage。SNS 迷い込み等の意図せぬ移行は
 *               main.ts の外部流入抑止ロジック（recordRead が抑止される）が排除する（判定関数側では扱わない）。
 */
export type EpisodeSection = { id: number; published: boolean; end: boolean };
/**
 * Episode: episodes.json の ep エントリ。
 * coverFile / coverPositionX は ep扉（タイトル画面）背景の指定。任意（省略時は従来挙動）。
 *   coverFile      … 扉背景のファイル名。省略時 'title.avif'。常に epNN/ 配下から解決する
 *   coverPositionX … 例 "30%"。縦長画面（スマホ）のみ background-position-x に反映。横長・未指定は中央
 */
export type Episode = { id: number; title: string; coverFile?: string; coverPositionX?: string; sections: EpisodeSection[] };
export type EpisodesData = Episode[];

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

export type VolumeRange = { volume: number; epRange: [number, number] };
export type VolumesData = VolumeRange[];

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
