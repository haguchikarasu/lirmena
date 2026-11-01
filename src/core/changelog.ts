/*
 * core/changelog.ts
 * 責務: 変更履歴の版番号 "x.y.z" を版種別（メジャー／マイナー／パッチ）に分ける。版種別スイッチの絞り込みに使う。
 * export: type VersionKind = 'major' | 'minor' | 'patch'
 *         versionKind(version: string): VersionKind
 * 依存: なし（document・要素に触らない純関数）。
 *       呼び出し元：index.ts（目次のコンテンツ更新履歴）、title.ts（タイトルページの変更履歴）。以前は 2 か所の複製だった。
 */

export type VersionKind = 'major' | 'minor' | 'patch';

// z≠0→patch、y≠0→minor、それ以外→major。欠けた桁は "0" とみなす。
// versionKind(version: string): VersionKind
export function versionKind(version: string): VersionKind {
    const [, minor = '0', patch = '0'] = version.split('.');
    if (Number(patch) !== 0) return 'patch';
    if (Number(minor) !== 0) return 'minor';
    return 'major';
}
