# アーキテクチャ設計書

## 1. システム構成図

Dummy Text Injector は Manifest V3 Chrome拡張機能であり、以下の3つの実行コンテキストで構成される。

```
┌─────────────────────────────────────────────────────────┐
│ Chrome Browser                                          │
│                                                         │
│  ┌──────────────────┐    ┌───────────────────────────┐  │
│  │ Popup Context     │    │ Service Worker            │  │
│  │ (popup.html)      │    │ (background.js)           │  │
│  │                   │    │                           │  │
│  │ - トグルボタンUI  │    │ - バッジ制御              │  │
│  │ - 状態表示        │    │   (chrome.action.         │  │
│  │ - スクリプト注入  │    │    setBadgeText)           │  │
│  │                   │    │ - Content Scriptからの     │  │
│  │                   │    │   メッセージ受信           │  │
│  └────────┬─────────┘    └───────────────────────────┘  │
│           │                                              │
│           │ chrome.scripting.executeScript                │
│           │ chrome.tabs.sendMessage                       │
│           ▼                                              │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Content Script Context (content.js)               │    │
│  │ ※ ターゲットページの DOM 内で実行                  │    │
│  │                                                    │    │
│  │  ┌─────────────────────┐  ┌──────────────────┐    │    │
│  │  │ フローティングパネル │  │ ハイライトシステム│    │    │
│  │  │ (Shadow DOM内)      │  │ (ホストDOMに注入) │    │    │
│  │  └─────────────────────┘  └──────────────────┘    │    │
│  │                                                    │    │
│  │  ┌─────────────────────┐  ┌──────────────────┐    │    │
│  │  │ 選択システム         │  │ テキスト差替え   │    │    │
│  │  │ (hover/click/multi)  │  │ エンジン         │    │    │
│  │  └─────────────────────┘  └──────────────────┘    │    │
│  │                                                    │    │
│  │  ┌─────────────────────┐                          │    │
│  │  │ Undoシステム         │                          │    │
│  │  │ (WeakMap)            │                          │    │
│  │  └─────────────────────┘                          │    │
│  └──────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### コンテキスト別の役割

| コンテキスト | ファイル | ライフサイクル | 主な責務 |
|------------|---------|-------------|---------|
| Popup | popup.html, popup.js, popup.css | ポップアップ開閉時に生成・破棄 | 選択モードのON/OFF制御、Content Scriptの初回注入 |
| Service Worker | background.js | ブラウザ起動中常駐（idle時停止） | バッジ制御（`chrome.action.setBadgeText`）。Content Scriptからのメッセージを受信して実行 |
| Content Script | content.js | タブのページ内で実行。注入後はページ遷移まで存続 | 選択・ハイライト・テキスト差替え・Undo・パネル表示 |

---

## 2. コンポーネント間通信

### 2.1 メッセージパッシング

Content Script と Popup 間の通信には `chrome.runtime.onMessage` / `chrome.tabs.sendMessage` を使用する。

#### メッセージ一覧

| メッセージ | 方向 | リクエスト | レスポンス | 用途 |
|-----------|------|-----------|-----------|------|
| `toggle` | Popup → Content Script | `{ action: 'toggle' }` | `{ isActive: boolean }` | 選択モードの切替 |
| `getState` | Popup → Content Script | `{ action: 'getState' }` | `{ isActive: boolean }` | 現在の状態取得 |

#### バッジ制御

バッジ「ON」表示（SPEC.md §1.1）は、Content ScriptからService Worker（background.js）へメッセージパッシングで依頼する。`chrome.action` APIはContent Scriptからは直接利用できないため。

| メッセージ | 方向 | リクエスト | レスポンス | 用途 |
|-----------|------|-----------|-----------|------|
| `setBadge` | Content Script → Service Worker | `{ action: 'setBadge', text: string }` | なし | バッジテキストの設定 |

- **activate時:** `chrome.runtime.sendMessage({ action: 'setBadge', text: 'ON' })`
- **deactivate時:** `chrome.runtime.sendMessage({ action: 'setBadge', text: '' })`

Service Worker（background.js）側:
```javascript
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'setBadge') {
    chrome.action.setBadgeText({ text: message.text, tabId: sender.tab.id });
  }
});
```

### 2.2 シーケンス図

#### 初回起動（Content Script 未注入時）

```
User         Popup                Content Script         Chrome API
 │            │                        │                     │
 │─ click ───▶│                        │                     │
 │            │── sendMessage ────────▶│                     │
 │            │   (getState)    [Error: no receiver]         │
 │            │                        │                     │
 │            │── executeScript ──────────────────────────▶│
 │            │   (content.js)         │                     │
 │            │                   [content.js 注入・初期化]   │
 │            │── sendMessage ────────▶│                     │
 │            │   (toggle)             │                     │
 │            │◀─ { isActive: true } ──│                     │
 │            │                        │── パネル生成         │
 │            │── window.close() ──    │── イベント登録       │
 │            │                        │                     │
```

#### 再トグル（Content Script 注入済み）

```
User         Popup                Content Script
 │            │                        │
 │─ click ───▶│                        │
 │            │── sendMessage ────────▶│
 │            │   (toggle)             │
 │            │◀─ { isActive } ────────│
 │            │── updateUI(isActive) ──│
 │            │                        │── activate/deactivate
```

---

## 3. DOM分離戦略

### 3.1 Shadow DOM によるパネル隔離

フローティングパネルはホストページのCSSから完全に隔離するため、Shadow DOM を使用する。

```
document.documentElement
  └── <div id="__dti-host">          ← ホスト要素（position: fixed, z-index: 2147483647）
        └── #shadow-root (mode: 'open')
              ├── <style>             ← パネル専用CSS（PANEL_CSS）
              └── <div class="panel"> ← パネル本体
                    ├── .header       ← ドラッグハンドル
                    ├── .body         ← 操作UI
                    └── .footer       ← ステータス
```

**設計判断:**

| 項目 | 選択 | 理由 |
|------|------|------|
| Shadow DOM mode | `open` | DevToolsでのデバッグ容易性。閉じたShadow DOMはデバッグが困難。セキュリティ：ホストページから `shadowRoot` にアクセス可能だが、本拡張はセキュリティ境界を持たないUIツールであるため許容 |
| ホスト要素の配置先 | `document.documentElement` | `body`配下だとサイトCSSの影響を受けやすいため |
| `all: initial` | 適用 | ホスト要素のスタイルを完全リセット |
| z-index | `2147483647`（最大値） | 他の要素の上に確実に表示 |

**パネルHTMLの追加方式:**

パネルHTMLは定数文字列としてShadow Rootに `innerHTML` で注入する。パネル内容は拡張機能自身が定義した静的HTMLのためXSSリスクはない。ユーザー入力のDOM反映には `textContent` / `.value` のみ使用する。

### 3.2 ハイライトスタイルの注入

ハイライト用CSSはホストページの `<head>` に `<style id="__dti-styles">` として直接注入する。

**理由:** ハイライトはホストページの要素に直接適用するため、Shadow DOM内には配置できない。`outline` プロパティを使用し、レイアウトに影響を与えない設計とする。

```
document.head
  └── <style id="__dti-styles">
        .__dti-hover    { outline: 2px solid #6366f1 ... }
        .__dti-selected { outline: 2px solid #f59e0b ... }
        .__dti-modified { outline: 2px dashed #10b981 ... }
```

---

## 4. データ管理

### 4.1 状態変数一覧

| 変数名 | 型 | 初期値 | スコープ | 用途 |
|--------|---|--------|---------|------|
| `isActive` | `boolean` | `false` | Content Script IIFE | 選択モードの有効/無効 |
| `selectedElements` | `Set<Element>` | `new Set()` | Content Script IIFE | 現在選択中の要素群 |
| `hoveredElement` | `Element \| null` | `null` | Content Script IIFE | 現在ホバー中の要素 |
| `panelHost` | `HTMLElement \| null` | `null` | Content Script IIFE | Shadow DOM ホスト要素への参照 |
| `panelShadow` | `ShadowRoot \| null` | `null` | Content Script IIFE | Shadow Root への参照 |
| `originalTexts` | `WeakMap<Element, OriginalTextData>` | `new WeakMap()` | Content Script IIFE | Undo用の元テキスト保存 |
| `modifiedElements` | `Set<Element>` | `new Set()` | Content Script IIFE | 変更済み要素の追跡 |

### 4.2 Undoストア

```
originalTexts: WeakMap<Element, OriginalTextData>

OriginalTextData = {
  type: 'value' | 'textContent' | 'textNodes',
  data: string | TextNodeData[]
}

TextNodeData = {
  node: Text,
  text: string
}
```

**WeakMap の採用理由:**
- DOM要素が削除されると自動的にGC対象となり、メモリリークを防止
- 明示的なクリーンアップが不要
- SPA遷移で要素が差し替わった場合も自然にクリアされる

### 4.3 SPA遷移時のデータクリア

#### 遷移検知方法

SPA遷移（URLの変更を伴うもの）は以下の方法で検知する:

- `popstate` イベントのリスニング
- `history.pushState` / `history.replaceState` のラップ（元の関数を保持し、呼び出し後に検知ハンドラを実行）

> **注:** History APIのラップは、Content Scriptのisolated world内で行うためページ内のJSとは衝突しない。ただし、同じisolated world内で動作する他の拡張機能が同様のラップを行っている場合、衝突のリスクがある。

#### クリア処理

検知時、以下の状態をクリアする:

- `originalTexts`（WeakMap）を新規作成（`originalTexts = new WeakMap()`）
- `modifiedElements`（Set）を `clear()` する（`modifiedElements.clear()`）
- 変更済みハイライト（`__dti-modified` クラス）を全要素から除去

### 4.4 modifiedElements（Set）のメモリ特性

`modifiedElements` は `Set<Element>` であり、要素への強参照を保持する。DOM要素が削除されてもSetから手動で除去しない限りGC対象にならない。`WeakSet` への変更は不可（iteration機能がなく「全てリセット」で全要素を走査できないため）。

SPA遷移時の `modifiedElements.clear()` で明示的にクリアされる。同一ページ内での利用では、変更対象が通常数十〜数百要素程度のため実用上メモリ問題にはならない。

### 4.5 chrome.storage

v1では `chrome.storage` は使用しない（`storage` パーミッションも未申請）。v1.1でユーザー定義プリセット機能を実装する際に `storage` パーミッションを追加し、本格利用する。

| キー | 用途 | 計画 |
|------|------|------|
| （v1.1予定）`userPresets` | ユーザー定義プリセット | `storage.sync` で端末間同期 |

---

## 5. セキュリティ・パーミッション

### 5.1 パーミッション設計

| パーミッション | 種別 | 用途 | 必要性 |
|-------------|------|------|--------|
| `activeTab` | Permission | 現在アクティブなタブへのスクリプト注入権限 | ポップアップクリック時のみ有効。最小権限の原則 |
| `scripting` | Permission | `chrome.scripting.executeScript` の使用 | Content Scriptのオンデマンド注入に必須 |
| （v1.1予定）`storage` | Permission | `chrome.storage` API の使用 | v1では未使用。v1.1のプリセット保存で追加予定 |

### 5.2 Content Script 注入方式

**仕様上の設計:** ポップアップからの `chrome.scripting.executeScript` によるオンデマンド注入を採用する。`manifest.json` の `content_scripts` による自動注入は使用しない。

**理由:**
- ユーザーが明示的にアクティベーションした時だけスクリプトが実行される
- 全ページへの自動注入を避け、パフォーマンスとプライバシーへの影響を最小化
- `activeTab` パーミッションとの組み合わせにより、`<all_urls>` のホストパーミッションが不要になる

### 5.3 DOM操作のセキュリティ

- パネルUIはShadow DOM内に隔離。ホストページからの意図しないスタイル干渉を防止
- ユーザー入力（カスタムテキスト）は `textContent` / `.value` で設定し、`innerHTML` は使用しない（XSS防止）
- `composedPath()` でイベントがパネル内かどうかを判定し、パネル操作とページ操作を分離

---

## 6. 制限事項

### 6.1 v1 の技術的制限

| 制限 | 詳細 | 影響 | 回避策 |
|------|------|------|--------|
| iframe非対応 | `iframe`内の要素は選択・操作の対象外 | 埋め込みコンテンツのテストが不可 | DevToolsで手動編集 |
| Shadow DOM非対応 | ターゲットページのShadow DOM内部の要素は対象外 | Web Components内のテキストが変更不可 | DevToolsで手動編集 |
| SPA遷移 | URL変更を伴う遷移時、Undoストア・ハイライトがクリアされる | ページ遷移でテスト状態がリセット | 遷移前にテスト完了すること |
| CSSの干渉 | ホスト側CSSの`!important`ルールによりハイライト表示が影響を受ける可能性 | ハイライトが正しく表示されない場合がある | ハイライトCSS側も`!important`で対抗 |

### 6.2 再注入防止

Content Script の多重初期化を防ぐため、`window.__dtiInitialized` フラグを使用する。

```javascript
if (window.__dtiInitialized) return;
window.__dtiInitialized = true;
```

これにより、ポップアップから `executeScript` が複数回呼ばれても安全に動作する。

> **注:** `window.__dtiInitialized` はグローバル変数であり、理論上ホストページのJavaScriptと名前衝突する可能性がある。`__dti` プレフィックスにより実害は極めて限定的だが、リスクとして認識しておく。
