# コンポーネント設計書

## 1. manifest.json

### 1.1 基本設定

```json
{
  "manifest_version": 3,
  "name": "Dummy Text Injector",
  "version": "1.0.0",
  "description": "クリックで要素にダミーテキストを挿入するページ検証ツール"
}
```

### 1.2 パーミッション設計

```json
{
  "permissions": ["activeTab", "scripting"]
}
```

| パーミッション | 目的 |
|-------------|------|
| `activeTab` | ユーザーがポップアップをクリックした時のみ、現在のタブへのアクセスを許可 |
| `scripting` | `chrome.scripting.executeScript` による Content Script のオンデマンド注入 |
| （v1.1予定）`storage` | ユーザー定義プリセットの保存。v1では未使用・未申請 |

```json
{
  "background": {
    "service_worker": "background.js"
  }
}
```

**`host_permissions` は不要。** `activeTab` によりユーザーアクション時に一時的なホスト権限が付与される。

### 1.3 Content Script 注入方式

**仕様:** `content_scripts` フィールドは使用しない。`chrome.scripting.executeScript` によるオンデマンド注入のみ。

```json
{
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  }
}
```

---

## 2. popup.js — ポップアップ処理

### 2.1 初期化処理

```
DOMContentLoaded
  │
  ├── chrome.tabs.query({ active: true, currentWindow: true })
  │     → 現在のアクティブタブを取得
  │
  └── chrome.tabs.sendMessage(tab.id, { action: 'getState' })
        ├── 成功 → updateUI(response.isActive)
        └── 失敗 → Content Script未注入と判定 → updateUI(false)
```

### 2.2 トグル処理

```
ボタンクリック
  │
  ├── chrome.tabs.sendMessage(tab.id, { action: 'toggle' })
  │     ├── 成功 → updateUI(response.isActive)
  │     │           isActive=true なら window.close()（ポップアップを閉じる）
  │     │
  │     └── 失敗（Content Script 未注入）
  │           │
  │           ├── chrome.scripting.executeScript({ files: ['content.js'] })
  │           └── chrome.tabs.sendMessage(tab.id, { action: 'toggle' })
  │                 └── updateUI(response.isActive)
  │                      isActive=true なら window.close()
  │
  └── エラーハンドリング
        ├── chrome.scripting.executeScript 失敗時
        │     （chrome:// ページ、Chrome Web Store等の注入不可ページ）
        │     → ポップアップUIにエラーメッセージを表示
        │       例: 「このページでは使用できません」
        └── その他のエラー → console.error で記録
```

### 2.3 UI更新

`updateUI(isActive)` 関数:

| isActive | ボタンクラス | ボタンテキスト |
|----------|------------|-------------|
| `true` | `.active` 追加 | `選択モードを停止` |
| `false` | `.active` 除去 | `選択モードを開始` |

---

## 3. content.js — メインコンポーネント

Content Script の全機能を単一のIIFE内に実装する。ビルドツールによる物理的なファイル分割は行わない。

#### 内部構成マップ

IIFE内部は以下の論理モジュールで構成される:

| モジュール | 主な関数・定数 | 責務 |
|-----------|-------------|------|
| 定数・設定 | `EXCLUDED_TAGS`, `EXCLUDED_INPUT_TYPES`, `HIRAGANA`, `PRESETS`, `PANEL_CSS`, `PANEL_HTML` | 定数定義 |
| 状態管理 | 状態変数群（§3.1参照） | グローバル状態の保持 |
| 要素判定 | `hasTextContent()`, `isInsidePanel()` | テキスト要素の判定 |
| 選択システム | `handleMouseOver()`, `handleMouseOut()`, `handleClick()`, `handleKeyDown()`, `updateSelectedInfo()` | ホバー・クリック・キーボード操作 |
| テキストエンジン | `generateDummyText()`, `applyText()` | テキスト生成・適用 |
| Undoシステム | `saveOriginalText()`, `restoreOriginalText()` | 元テキスト保存・復元 |
| パネルUI | `createPanel()`, `makeDraggable()`, `showStatus()` | フローティングパネル管理 |
| ライフサイクル | `activate()`, `deactivate()`, `handleSPANavigation()` | モード切替・SPA対応 |
| メッセージ | `chrome.runtime.onMessage` リスナー | Popup/Service Workerとの通信 |

### 3.1 状態変数テーブル

| 変数名 | 型 | 初期値 | 説明 |
|--------|---|--------|------|
| `isActive` | `boolean` | `false` | 選択モードのON/OFF |
| `selectedElements` | `Set<Element>` | `new Set()` | 選択中の要素群（複数選択対応） |
| `hoveredElement` | `Element \| null` | `null` | ホバー中の要素 |
| `panelHost` | `HTMLElement \| null` | `null` | パネルのホスト要素 |
| `panelShadow` | `ShadowRoot \| null` | `null` | パネルのShadow Root |
| `originalTexts` | `WeakMap<Element, OriginalTextData>` | `new WeakMap()` | Undo用の元テキスト保存 |
| `modifiedElements` | `Set<Element>` | `new Set()` | 変更済み要素の追跡（ハイライト用） |
| `currentMode` | `'preset' \| 'charcount'` | `'preset'` | 現在のテキスト入力モード |

### 3.2 テキスト要素判定ロジック（hasTextContent）

```javascript
function hasTextContent(element) → boolean
```

#### 判定フロー

```
hasTextContent(element)
  │
  ├── 除外タグチェック
  │     SCRIPT, STYLE, META, LINK, BR, HR, IMG, SVG → false
  │
  ├── パネル要素チェック
  │     __dti-host 配下 → false
  │
  ├── input[type=text|search|email|tel|url|number|password] → true
  │
  ├── input[type=checkbox|radio|submit|button|file|image|reset|hidden] → false
  │
  ├── textarea → true
  │
  ├── contentEditable → true
  │
  └── 直接の子テキストノードに空白以外の文字があるか
        ├── あり → true
        └── なし → false（ラッパーdiv等）
```

#### 除外タグ一覧

```javascript
const EXCLUDED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'META', 'LINK', 'BR', 'HR', 'IMG', 'SVG'
]);
```

#### 除外 input type 一覧

```javascript
const EXCLUDED_INPUT_TYPES = new Set([
  'checkbox', 'radio', 'submit', 'button', 'file', 'image', 'reset', 'hidden'
]);
```

### 3.3 選択システム

#### 3.3.1 ホバー処理

```
mouseover(e)
  │
  ├── isInsidePanel(e) → true: 無視
  │
  ├── hasTextContent(e.target) → false: 無視
  │
  └── hasTextContent(e.target) → true:
        ├── 前の hoveredElement から __dti-hover を除去
        ├── hoveredElement = e.target
        └── e.target に __dti-hover を追加

mouseout(e)
  └── e.target === hoveredElement の場合:
        ├── __dti-hover を除去
        └── hoveredElement = null
```

#### 3.3.2 クリック選択

```
click(e)
  │
  ├── isInsidePanel(e) → true: 無視
  │
  ├── hasTextContent(e.target) → false: 無視
  │
  ├── e.preventDefault() + e.stopPropagation()
  │
  ├── Cmd/Ctrl キー押下？
  │     │
  │     ├── YES（複数選択モード）
  │     │     ├── 要素が選択済み → 選択から除外、__dti-selected 除去
  │     │     └── 要素が未選択 → 選択に追加、__dti-selected 追加
  │     │
  │     └── NO（単体選択モード）
  │           ├── selectedElements.size >= 3 ?
  │           │     ├── YES → ステータスバーに確認UIを表示
  │           │     │         「N個の選択をクリアしますか？」メッセージ
  │           │     │         ＋「クリアして選択」「キャンセル」ボタン
  │           │     │         ※ 確認UIは自動消去しない（通常のステータスメッセージの2.2秒消去とは異なる）
  │           │     │         ├── 「クリアして選択」クリック → 下記のクリア処理へ進む
  │           │     │         └── 「キャンセル」クリック or Escキー → 何もしない（return）
  │           │     └── NO → 即クリア処理へ
  │           ├── 全選択要素から __dti-selected を除去
  │           ├── selectedElements.clear()
  │           ├── e.target に __dti-selected 追加
  │           └── selectedElements.add(e.target)
  │
  └── updateSelectedInfo()
```

#### 3.3.3 Escキー処理

```
keydown(e)
  │
  ├── e.key !== 'Escape' → 無視
  │
  └── e.key === 'Escape'
        ├── selectedElements.size > 0 ?
        │     └── YES → 全選択クリア（モードは維持）
        │           ├── 全要素から __dti-selected 除去
        │           ├── selectedElements.clear()
        │           └── updateSelectedInfo()
        │
        └── NO（選択なし）
              └── deactivate()（モードOFF）
```

### 3.4 テキスト差し替えエンジン

#### 3.4.1 ダミーテキスト生成（文字数指定モード）

```javascript
function generateDummyText(charCount) → string
```

ひらがな五十音（「あいうえお…わをん」）を繰り返し連結し、指定文字数で切り詰める。

```javascript
const HIRAGANA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';

function generateDummyText(count) {
  let result = '';
  while (result.length < count) {
    result += HIRAGANA;
  }
  return result.slice(0, count);
}
```

#### 3.4.2 プリセット定義

| キー | カテゴリ | プリセット名 | テキスト |
|------|---------|------------|---------|
| `jp-xs` | 日本語 | 極短（6文字） | ダミーテキスト |
| `jp-s` | 日本語 | 短（1文） | 吾輩は猫である。名前はまだない。 |
| `jp-m` | 日本語 | 中（2文） | 吾輩は猫である。名前はまだない。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。 |
| `jp-l` | 日本語 | 長（段落） | 吾輩は猫である。名前はまだない。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。吾輩はここで始めて人間というものを見た。しかもあとで聞くとそれは書生という人間中で一番獰悪な種族であったそうだ。 |
| `lorem-s` | Lorem | Short | Lorem ipsum dolor sit amet. |
| `lorem-m` | Lorem | Medium | Lorem ipsum dolor sit amet, consectetur... (3文) |
| `lorem-l` | Lorem | Long | Lorem ipsum... (フルパラグラフ) |
| `phone` | データ | 電話番号 | 090-1234-5678 |
| `email` | データ | メールアドレス | example@example.com |
| `url` | データ | URL | https://example.com |
| `date` | データ | 日付 | 2024年1月1日 |
| `name-jp` | データ | 氏名 | 山田 太郎 |
| `address` | データ | 住所 | 東京都渋谷区渋谷1-1-1 |

#### 3.4.3 テキスト適用処理

```javascript
function applyText(element, text)
```

```
applyText(element, text)
  │
  ├── saveOriginalText(element)  ← Undo用に保存（初回のみ）
  │
  ├── input[text系] / textarea
  │     ├── element.value = text
  │     ├── dispatch Event('input', { bubbles: true })
  │     └── dispatch Event('change', { bubbles: true })
  │
  ├── contentEditable
  │     ├── element.textContent = text
  │     └── dispatch Event('input', { bubbles: true })
  │
  └── 通常要素
        └── 直接の子テキストノードのみを置換
              ├── childNodes を走査
              ├── Text ノードの場合 → nodeValue を text に設定
              │   （最初のText ノードにテキストを設定、残りは空文字）
              └── Element ノードは保持（<span>, <small> 等）
```

**子要素の保持について:**

仕様上、通常要素のテキスト適用では直接の子テキストノードのみを置換し、子要素は保持する。

```html
<!-- 適用前 -->
<h2>Title <small>sub</small></h2>

<!-- 適用後 -->
<h2>ダミーテキスト <small>sub</small></h2>
```

### 3.5 Undoシステム

#### 3.5.1 データ構造

```javascript
const originalTexts = new WeakMap();
// Key: Element
// Value: OriginalTextData

// OriginalTextData の形式:
{
  type: 'value',        // input/textarea の場合
  data: string          // element.value の値
}
// または
{
  type: 'textContent',  // contentEditable の場合
  data: string          // element.textContent の値
}
// または
{
  type: 'textNodes',    // 通常要素の場合
  data: [               // 各テキストノードの元テキスト
    { node: Text, text: string },
    ...
  ]
}
```

#### 3.5.2 保存ロジック

```javascript
function saveOriginalText(element)
```

```
saveOriginalText(element)
  │
  ├── originalTexts.has(element) → true: 何もしない（チェーン修正対応）
  │
  └── originalTexts.has(element) → false:
        ├── input/textarea → { type: 'value', data: element.value }
        ├── contentEditable → { type: 'textContent', data: element.textContent }
        └── 通常要素 → { type: 'textNodes', data: 子テキストノードの配列 }
```

**チェーン修正対応:** 同じ要素に複数回テキストを適用した場合でも、最初の元テキストのみを保持する。これにより「最初の状態に戻す」動作を保証する。

#### 3.5.3 復元ロジック

```javascript
function restoreOriginalText(element)
```

```
restoreOriginalText(element)
  │
  ├── originalTexts.has(element) → false: 何もしない
  │
  └── originalTexts.has(element) → true:
        ├── type === 'value' → element.value = data + イベント発火
        ├── type === 'textContent' → element.textContent = data + イベント発火
        └── type === 'textNodes' → 各テキストノードの nodeValue を復元
        │
        ├── originalTexts.delete(element)
        ├── modifiedElements.delete(element)
        └── __dti-modified クラスを除去
```

#### 3.5.4 個別Undo・全リセット

| 操作 | 対象 | 処理 |
|------|------|------|
| 選択を元に戻す | `selectedElements` 内の要素 | 各要素に `restoreOriginalText` を適用 |
| 全てリセット | `modifiedElements` 内の全要素 | 全要素に `restoreOriginalText` を適用 |

### 3.6 フローティングパネル

#### 3.6.1 パネル生成

```javascript
function createPanel()
```

1. `<div id="__dti-host">` を生成
2. `all: initial` と `position: fixed` を設定
3. `attachShadow({ mode: 'open' })` で Shadow Root を生成
4. PANEL_CSS と PANEL_HTML を Shadow Root に追加
5. `document.documentElement.appendChild(host)` でDOM追加
6. イベントリスナーを登録
7. `makeDraggable()` でドラッグ機能を設定

#### 3.6.2 deactivate/activate時のパネル処理

**`deactivate()` 時:**
- パネルを**削除**（`panelHost.remove()`）
- イベントリスナー解除（mouseover, mouseout, click, keydown）
- ホバーハイライト（`__dti-hover`）を除去
- 選択ハイライト（`__dti-selected`）を除去、`selectedElements.clear()`
- **保持するもの:**
  - `__dti-modified` クラス（変更済みハイライト）は維持
  - ハイライトCSS（`<style id="__dti-styles">`）は維持
  - `originalTexts`（WeakMap）は保持
  - `modifiedElements`（Set）は保持

**`activate()` 時:**
- パネルを**再生成**（`createPanel()`）
- イベントリスナー再登録
- 前回の変更済みハイライトが残っているため、再ON時にUndoが利用可能

#### 3.6.3 パネル内部構成

```
.panel (width: 288px)
  │
  ├── .header                    ← ドラッグハンドル
  │     ├── .header-title        ← "Dummy Text Injector"
  │     ├── .minimize-btn        ← 最小化ボタン（━）
  │     └── .close-btn           ← 閉じるボタン（✕） → deactivate()
  │
  ├── .body
  │     ├── .selected-info       ← 選択要素の情報表示
  │     │
  │     ├── .mode-tabs           ← モード切替タブ
  │     │     ├── [プリセット]    ← プリセットモード
  │     │     └── [文字数指定]    ← 文字数指定モード
  │     │
  │     ├── .preset-section      ← プリセット選択（プリセットモード時表示）
  │     │     ├── <select>       ← プリセットドロップダウン
  │     │     └── .custom-field  ← カスタムテキスト入力（カスタム選択時表示）
  │     │
  │     ├── .charcount-section   ← 文字数指定（文字数指定モード時表示）
  │     │     ├── <input number> ← 文字数入力 (1〜10000)
  │     │     └── .preview       ← 生成テキストプレビュー
  │     │
  │     ├── .btn-row             ← アクションボタン
  │     │     └── .btn-primary   ← 「適用」ボタン
  │     │
  │     ├── .undo-row            ← Undoコントロール
  │     │     ├── .btn-secondary ← 「選択を元に戻す」
  │     │     └── .btn-danger    ← 「全てリセット」
  │     │
  │     └── .status              ← ステータスメッセージ表示
  │
  └── .footer                    ← 状態表示
        ├── .dot                 ← アクティブ表示（緑点滅ドット）
        └── <span>               ← "選択モード ON"
```

#### 3.6.4 モードタブ切替

```
モードタブクリック(targetMode)
  │
  ├── targetMode === currentMode → 何もしない
  │
  └── targetMode !== currentMode
        ├── currentMode = targetMode
        ├── アクティブタブのスタイル切替
        │     ├── 前のタブ: bg: transparent, color: #8080a0
        │     └── 新しいタブ: bg: #6366f1, color: white
        ├── セクション表示切替
        │     ├── targetMode === 'preset'
        │     │     ├── .preset-section → display: block
        │     │     └── .charcount-section → display: none
        │     └── targetMode === 'charcount'
        │           ├── .preset-section → display: none
        │           └── .charcount-section → display: block
        └── プレビュー更新（文字数指定モードの場合）
```

#### 3.6.5 文字数指定プレビュー

文字数入力欄（`<input type="number">`）の `input` イベントのたびにリアルタイムでプレビューを更新する。

```
charcount-input の input イベント
  │
  ├── 値が空 or 範囲外（< 1 or > 10000）→ プレビュー非表示
  │
  └── 有効な値
        ├── JavaScript側でクランプ: Math.max(1, Math.min(10000, value))
        └── generateDummyText(clampedValue) の先頭部分をプレビュー表示
```

#### 3.6.6 ドラッグ移動

```javascript
function makeDraggable(element, handle)
```

- `mousedown` on handle: ドラッグ開始。初期位置を記録
- `mousemove` on document: ドラッグ中。`right` / `top` を更新
- `mouseup` on document: ドラッグ終了

位置は `right` と `top` で管理（初期位置: right=16px, top=16px）。

**ビューポート制約:** ドラッグ中、パネルのヘッダー部分が常にビューポート内に残るよう位置を制約する。`mousemove` 時に `right` / `top` の値をクランプし、ヘッダーが画面外に完全に出ることを防止する。

### 3.7 ハイライトシステム

#### 3.7.1 CSSクラス

| クラス名 | 用途 | スタイル |
|---------|------|---------|
| `__dti-hover` | ホバー中の要素 | `outline: 2px solid #6366f1; outline-offset: 1px; cursor: crosshair` |
| `__dti-selected` | 選択中の要素 | `outline: 2px solid #f59e0b; outline-offset: 1px` |
| `__dti-modified` | テキスト変更済みの要素 | `outline: 2px dashed #10b981; outline-offset: 1px` |

#### 3.7.2 優先度制御

CSS の記述順とセレクタの特異性で優先度を制御する。

```css
/* 低優先: 変更済み */
.__dti-modified {
  outline: 2px dashed #10b981 !important;
  outline-offset: 1px !important;
}

/* 中優先: ホバー */
.__dti-hover {
  outline: 2px solid #6366f1 !important;
  outline-offset: 1px !important;
  cursor: crosshair !important;
}

/* 高優先: 選択 */
.__dti-selected {
  outline: 2px solid #f59e0b !important;
  outline-offset: 1px !important;
}

/* 複合: 変更済み + ホバーまたは選択 → 薄緑背景を追加 */
.__dti-modified.__dti-hover,
.__dti-modified.__dti-selected {
  background-color: #10b98120 !important;
}
```

### 3.8 SPA遷移検知

URLの変更を伴うSPA遷移を検知し、Undoストアとハイライトをクリアする。具体的には、`originalTexts`（WeakMap）を新規作成し、`modifiedElements`（Set）も `clear()` する。

> **注:** History APIのラップはContent Scriptのisolated world内で行うため、ページ内のJavaScriptとは衝突しない。ただし、同じisolated world内で動作する他の拡張機能が同様のラップを行っている場合、衝突のリスクがある。元の関数を確実に保持・チェーン呼び出しすることでリスクを軽減する。

```javascript
// popstate イベントで検知
window.addEventListener('popstate', handleSPANavigation);

// History API のラップ
const originalPushState = history.pushState;
history.pushState = function(...args) {
  originalPushState.apply(this, args);
  handleSPANavigation();
};

const originalReplaceState = history.replaceState;
history.replaceState = function(...args) {
  originalReplaceState.apply(this, args);
  handleSPANavigation();
};

function handleSPANavigation() {
  // Undoストアのクリア（WeakMapは新規作成）
  originalTexts = new WeakMap();
  // 変更済みハイライトの除去
  document.querySelectorAll('.__dti-modified').forEach(el => {
    el.classList.remove('__dti-modified');
  });
  modifiedElements.clear();
}
```

---

## 4. 仕様と現状実装の差分テーブル

現在の実装（commit `cbcfd09`）と仕様書（SPEC.md）の差分を以下にまとめる。

| # | 機能 | 仕様 (SPEC.md) | 現状実装 (cbcfd09) | 差分の内容 |
|---|------|----------------|-------------------|-----------|
| 1 | 複数選択 | Cmd/Ctrl+クリックで複数選択（トグル動作） | 単体選択のみ（`selectedElement` 単一変数） | `Set<Element>` への変更と Cmd/Ctrl キー判定の追加が必要 |
| 2 | テキスト要素判定 | `hasTextContent` による厳密な判定（テキストノード・input種別・除外タグ） | 判定なし。全要素が選択可能 | `hasTextContent()` 関数の実装が必要 |
| 3 | Undoシステム | WeakMapによる元テキスト保存、個別Undo・全リセット | 未実装 | Undoストア・復元ロジック・UIボタンの実装が必要 |
| 4 | 文字数指定モード | ひらがな五十音の繰り返しで指定文字数のテキスト生成 | 未実装（プリセット選択のみ） | モードタブ・数値入力・テキスト生成ロジックの実装が必要 |
| 5 | Escキー処理 | 選択中→選択クリア、選択なし→モードOFF | 未実装 | keydown イベントリスナーの追加が必要 |
| 6 | 変更済みハイライト | 緑点線の枠で表示（`__dti-modified`） | 未実装 | CSSクラスの追加と適用ロジックが必要 |
| 7 | 複合ハイライト | 変更済み+ホバー/選択で薄緑背景 | 未実装 | 複合CSSセレクタの追加が必要 |
| 8 | バッジ表示 | ON時にバッジに「ON」表示 | 未実装 | Content ScriptからService Workerへメッセージパッシングで `chrome.action.setBadgeText` を依頼。background.js の実装が必要 |
| 9 | SPA遷移検知 | URL変更時にUndoストア・ハイライトクリア | 未実装 | History API ラップと popstate リスナーが必要 |
| 10 | 最小化ボタン | パネルヘッダーに最小化ボタン | 未実装 | 最小化ボタンとパネル折りたたみロジックが必要 |
| 11 | 3要素以上の選択クリア確認 | 単体クリックで3要素以上選択中の場合に確認メッセージ | 未実装（複数選択自体が未実装） | 確認メッセージ表示ロジックが必要 |
| 12 | `storage` パーミッション | v1では未使用・未申請（v1.1で追加予定） | `manifest.json` に `storage` がない | 仕様通り。v1.1で必要になった時点で `permissions` に `"storage"` を追加 |
| 13 | Content Script注入方式 | オンデマンド注入のみ（`content_scripts` 不使用） | `content_scripts` フィールドによる自動注入が存在する | 仕様ではオンデマンド注入のみのため `content_scripts` フィールドの削除が必要 |
| 14 | `host_permissions` | 不要（`activeTab` で代替） | `host_permissions: ["<all_urls>"]` が設定されている | `activeTab` で代替可能なため `host_permissions` フィールドの削除が必要 |
| 15 | 子要素の保持 | 通常要素では直接の子テキストノードのみ置換、子要素は保持 | `textContent` で全置換（子要素が失われる） | テキストノード走査ロジックへの変更が必要 |
| 16 | モードOFF後の状態保持 | 変更済みハイライトとUndoストアは保持される | モードOFFで全クリーンアップ | deactivate時にハイライトスタイルと修正状態を保持する変更が必要 |
| 17 | イベント発火 | input/textarea 変更時に `input`/`change` イベント発火 | 実装済み | 差分なし |
| 18 | Shadow DOM分離 | パネルをShadow DOM（mode: open）で分離 | 実装済み | 差分なし |
| 19 | ドラッグ移動 | ヘッダーによるパネルドラッグ | 実装済み | 差分なし |
| 20 | 再注入防止 | `window.__dtiInitialized` フラグ | 実装済み | 差分なし |
