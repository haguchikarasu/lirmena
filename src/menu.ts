/*
 * menu.ts
 * 責務: 右下ナビゲーションメニューの開閉・各項目のイベント処理
 * export: initMenu()
 * 依存: state.ts, transition.ts, bookmark.ts, settings.ts
 *
 * メニュー項目と処理：
 *   目次へ戻る        → index.html（目次ページ）へ遷移
 *   前のセクションへ  → state.getPrevSecAddress() を取得し transition.trigger("backward") を呼ぶ
 *   次のセクションへ  → state.getNextSecAddress() を取得し transition.trigger("forward") を呼ぶ
 *   栞を追加          → bookmark.addBookmark(currentAddress) を呼ぶ
 *   共有              → クリップボード / X / LINE で現在の URL をシェアする
 *   設定を開く        → settings.open() を呼ぶ
 *
 * 開閉制御：
 *   - メニューボタン押下でトグル
 *   - Escape キーで閉じる
 *   - メニュー外クリックで閉じる
 *
 * キーボード操作：
 *   - メニュー内で上下キーによる項目選択
 *   - Enter で実行
 *
 * 注意：
 *   - 「栞のクリア」「既読のクリア」は settings.ts のポップアップ内ボタンが担当する。
 *     settings.ts へのコールバック注入は main.ts が行う（menu.ts は関与しない）。
 *   - 前/次のセクションへボタンの有効/無効は state から取得して切り替える。
 */

// DOM からメニューボタン・メニュー要素・各項目を querySelector で取得し
// クリック・キーボードイベントを登録する
// - initMenu は起動時に1度だけ main.ts から呼ばれる
// initMenu(): void