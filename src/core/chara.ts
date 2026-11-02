/*
 * core/chara.ts
 * 責務: 人物の画像の置き場所とファイル名の規約（public/chara/ の下。作るのは tool/chara-crop）。
 *       規約：全身＝characters.json の image そのまま（例 vol1_リッカ.avif）、顔＝その拡張子の前に -face を足したもの
 *             （vol1_リッカ-face.avif）。image が "" のキャラは画像を持たない（顔の所に名前の頭文字を出す。要件 06-8）
 * export: charaPath(file: string): string   — public からの相対パス（例 "chara/vol1_リッカ.avif"）
 *         faceImage(image: string): string   — 全身の画像名から顔の画像名
 * 依存: なし（DOM / localStorage / fs 非依存の純関数）。
 *       呼び出し元：characters.ts（画像の URL を組む）、story-integrity（画像の実在検査＝(o)）。
 *       規約を 1 か所に置くのは、表示と検査で食い違うと「検査は通るのに顔が出ない」が起きるため。
 *       URL にするときは呼び出し側が base（import.meta.env.BASE_URL 等）を前に付ける。
 */

// charaPath(file: string): string — 例 "vol1_リッカ.avif" → "chara/vol1_リッカ.avif"
export function charaPath(file: string): string {
    return `chara/${file}`;
}

// 全身の画像名から顔の画像名を作る純関数（拡張子の前に -face を足す）。
// faceImage(image: string): string
export function faceImage(image: string): string {
    return image.replace(/(\.[A-Za-z0-9]+)$/, '-face$1');
}
