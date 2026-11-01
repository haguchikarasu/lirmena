// @vitest-environment node
/*
 * core/pure.test.ts
 * core の小さな純関数（query・preview・changelog）を DOM の無い環境（node）で確かめる。
 * どれも以前は目次（index.ts）と本文側に複製があり、ズレを e2e や散文で見張っていたもの。
 */

import { describe, expect, it } from 'vitest';
import { withQuery } from './query';
import { hasEffectivePreview } from './preview';
import { versionKind } from './changelog';

describe('core/query — withQuery', () => {
    it('path にクエリ文字列をそのまま連結する', () => {
        expect(withQuery('contents/01-01.html', '?dev')).toBe('contents/01-01.html?dev');
        expect(withQuery('../', '')).toBe('../');
    });
});

describe('core/preview — hasEffectivePreview', () => {
    it('text が trim して非空のときだけ true', () => {
        expect(hasEffectivePreview({ text: '近日公開' })).toBe(true);
        expect(hasEffectivePreview({ text: '  ' })).toBe(false);
        expect(hasEffectivePreview({ text: '' })).toBe(false);
    });

    it('未定義・null・非オブジェクト・非 string の text は false', () => {
        expect(hasEffectivePreview(undefined)).toBe(false);
        expect(hasEffectivePreview(null)).toBe(false);
        expect(hasEffectivePreview('近日公開')).toBe(false);
        expect(hasEffectivePreview({ text: 1 })).toBe(false);
    });
});

describe('core/changelog — versionKind', () => {
    it('z≠0 は patch、y≠0 は minor、それ以外は major', () => {
        expect(versionKind('1.2.3')).toBe('patch');
        expect(versionKind('1.2.0')).toBe('minor');
        expect(versionKind('2.0.0')).toBe('major');
    });

    it('欠けた桁は 0 とみなす', () => {
        expect(versionKind('3')).toBe('major');
        expect(versionKind('3.1')).toBe('minor');
    });
});
