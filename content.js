(() => {
  // Prevent re-initialization on duplicate injection
  if (window.__dtiInitialized) return;
  window.__dtiInitialized = true;

  // ── State ───────────────────────────────────────────────────────────────────
  let isActive = false;
  let selectedElement = null;
  let hoveredElement = null;
  let panelHost = null;
  let panelShadow = null;

  // ── Text presets ─────────────────────────────────────────────────────────────
  const PRESETS = {
    'lorem-xs': 'Lorem ipsum',
    'lorem-s': 'Lorem ipsum dolor sit amet.',
    'lorem-m':
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
      'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
      'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
    'lorem-l':
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
      'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
      'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ' +
      'ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit ' +
      'esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non ' +
      'proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
    'jp-xs': 'ダミーテキスト',
    'jp-s': '吾輩は猫である。名前はまだない。',
    'jp-m':
      '吾輩は猫である。名前はまだない。どこで生れたかとんと見当がつかぬ。' +
      '何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。',
    'jp-l':
      '吾輩は猫である。名前はまだない。どこで生れたかとんと見当がつかぬ。' +
      '何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。' +
      '吾輩はここで始めて人間というものを見た。しかもあとで聞くとそれは書生という' +
      '人間中で一番獰悪な種族であったそうだ。この書生というのは時々我々を捕えて' +
      '煮て食うという話である。しかしその当時は何という考えもなかったから別段恐しいとも思わなかった。',
    number: '1234567890',
    phone: '090-1234-5678',
    email: 'example@example.com',
    url: 'https://example.com',
    date: '2024年1月1日',
    'name-jp': '山田 太郎',
    address: '東京都渋谷区渋谷1-1-1',
  };

  // ── Panel HTML ────────────────────────────────────────────────────────────────
  const PANEL_CSS = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', sans-serif;
      font-size: 13px;
    }
    .panel {
      width: 288px;
      background: #1e1e2e;
      border: 1px solid #383854;
      border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5);
      overflow: hidden;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #6366f1;
      cursor: move;
      user-select: none;
    }
    .header-title {
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.3px;
    }
    .close-btn {
      background: rgba(255,255,255,0.2);
      border: none;
      border-radius: 50%;
      width: 20px;
      height: 20px;
      color: #fff;
      cursor: pointer;
      font-size: 11px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
      flex-shrink: 0;
      line-height: 1;
    }
    .close-btn:hover { background: rgba(255,255,255,0.4); }

    .body { padding: 12px 14px; }

    .selected-info {
      background: #26263a;
      border: 1px solid #383854;
      border-radius: 6px;
      padding: 7px 10px;
      margin-bottom: 10px;
      font-size: 11px;
      color: #9090b0;
      word-break: break-all;
      line-height: 1.4;
    }
    .selected-info .tag { color: #818cf8; font-weight: 700; font-family: monospace; }
    .selected-info .no-sel { color: #555570; font-style: italic; }

    .field { margin-bottom: 10px; }
    label {
      display: block;
      font-size: 10px;
      color: #8080a0;
      margin-bottom: 4px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    select, textarea {
      width: 100%;
      background: #26263a;
      border: 1px solid #383854;
      border-radius: 6px;
      color: #e0e0f0;
      font-size: 12px;
      padding: 7px 10px;
      outline: none;
      transition: border-color 0.15s;
      font-family: inherit;
    }
    select:focus, textarea:focus { border-color: #6366f1; }
    option, optgroup { background: #26263a; }

    textarea {
      resize: vertical;
      min-height: 58px;
      line-height: 1.5;
    }
    .hidden { display: none !important; }

    .btn-row {
      display: flex;
      gap: 7px;
      margin-top: 10px;
    }
    .btn {
      flex: 1;
      padding: 8px 6px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
      font-family: inherit;
    }
    .btn:hover { opacity: 0.82; }
    .btn:active { opacity: 0.65; }
    .btn-primary { background: #6366f1; color: #fff; }
    .btn-secondary { background: #383854; color: #c0c0e0; }
    .btn-danger { background: #7f1d1d; color: #fca5a5; }

    .status {
      margin-top: 8px;
      font-size: 11px;
      color: #4ade80;
      text-align: center;
      min-height: 15px;
      transition: opacity 0.3s;
    }
    .status.error { color: #f87171; }

    .footer {
      padding: 7px 14px;
      background: #16162a;
      border-top: 1px solid #2a2a40;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      color: #6060a0;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #4ade80;
      flex-shrink: 0;
      animation: blink 1.8s infinite;
    }
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
  `;

  const PANEL_HTML = `
    <div class="panel">
      <div class="header" id="drag-handle">
        <span class="header-title">🔤 Dummy Text Injector</span>
        <button class="close-btn" id="close-btn" title="閉じる">✕</button>
      </div>
      <div class="body">
        <div class="selected-info" id="selected-info">
          <span class="no-sel">要素をクリックして選択してください</span>
        </div>

        <div class="field">
          <label>テキスト種別</label>
          <select id="text-type">
            <optgroup label="Lorem ipsum">
              <option value="lorem-xs">極短 (2語)</option>
              <option value="lorem-s">短 (1文)</option>
              <option value="lorem-m" selected>中 (3文)</option>
              <option value="lorem-l">長 (段落)</option>
            </optgroup>
            <optgroup label="日本語">
              <option value="jp-xs">極短 (4文字)</option>
              <option value="jp-s">短 (1文)</option>
              <option value="jp-m">中 (2文)</option>
              <option value="jp-l">長 (段落)</option>
            </optgroup>
            <optgroup label="データ形式">
              <option value="number">数字</option>
              <option value="phone">電話番号</option>
              <option value="email">メールアドレス</option>
              <option value="url">URL</option>
              <option value="date">日付</option>
              <option value="name-jp">氏名（日本語）</option>
              <option value="address">住所</option>
            </optgroup>
            <option value="custom">── カスタム ──</option>
          </select>
        </div>

        <div class="field hidden" id="custom-field">
          <label>カスタムテキスト</label>
          <textarea id="custom-text" placeholder="挿入するテキストを入力..."></textarea>
        </div>

        <div class="btn-row">
          <button class="btn btn-primary" id="inject-btn">挿入</button>
          <button class="btn btn-secondary" id="clear-btn">クリア</button>
        </div>
        <div class="status" id="status"></div>
      </div>
      <div class="footer">
        <div class="dot"></div>
        <span>選択モード ON — 要素をクリックして選択</span>
      </div>
    </div>
  `;

  // ── Panel lifecycle ───────────────────────────────────────────────────────────
  function createPanel() {
    const host = document.createElement('div');
    host.id = '__dti-host';
    host.style.cssText =
      'all: initial !important; position: fixed !important; top: 16px !important; ' +
      'right: 16px !important; z-index: 2147483647 !important;';

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    shadow.appendChild(style);
    shadow.innerHTML += PANEL_HTML;

    document.documentElement.appendChild(host);
    panelHost = host;
    panelShadow = shadow;

    // Wire up events
    shadow.getElementById('close-btn').addEventListener('click', deactivate);
    shadow.getElementById('inject-btn').addEventListener('click', handleInject);
    shadow.getElementById('clear-btn').addEventListener('click', handleClear);
    shadow.getElementById('text-type').addEventListener('change', (e) => {
      const customField = shadow.getElementById('custom-field');
      customField.classList.toggle('hidden', e.target.value !== 'custom');
    });

    makeDraggable(host, shadow.getElementById('drag-handle'));
  }

  function removePanel() {
    if (panelHost) {
      panelHost.remove();
      panelHost = null;
      panelShadow = null;
    }
  }

  // ── Draggable panel ───────────────────────────────────────────────────────────
  function makeDraggable(element, handle) {
    let dragging = false;
    let startX, startY, origRight, origTop;

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origRight = parseInt(element.style.right) || 16;
      origTop = parseInt(element.style.top) || 16;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      element.style.right = origRight - (e.clientX - startX) + 'px';
      element.style.top = origTop + (e.clientY - startY) + 'px';
    });
    document.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  // ── Selection helpers ─────────────────────────────────────────────────────────
  function isInsidePanel(e) {
    return (e.composedPath ? e.composedPath() : []).some(
      (el) => el && el.id === '__dti-host'
    );
  }

  function onMouseOver(e) {
    if (isInsidePanel(e)) return;
    if (hoveredElement) hoveredElement.classList.remove('__dti-hover');
    hoveredElement = e.target;
    if (hoveredElement) hoveredElement.classList.add('__dti-hover');
  }

  function onMouseOut(e) {
    if (e.target === hoveredElement) {
      hoveredElement.classList.remove('__dti-hover');
      hoveredElement = null;
    }
  }

  function onClick(e) {
    if (isInsidePanel(e)) return;
    e.preventDefault();
    e.stopPropagation();

    // Clear previous selection highlight
    document.querySelectorAll('.__dti-selected').forEach((el) =>
      el.classList.remove('__dti-selected')
    );
    if (hoveredElement) hoveredElement.classList.remove('__dti-hover');

    selectedElement = e.target;
    selectedElement.classList.add('__dti-selected');
    updateSelectedInfo(selectedElement);
  }

  function updateSelectedInfo(element) {
    if (!panelShadow) return;
    const info = panelShadow.getElementById('selected-info');
    if (!element) {
      info.innerHTML = '<span class="no-sel">要素をクリックして選択してください</span>';
      return;
    }
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    const cls =
      element.className && typeof element.className === 'string'
        ? '.' + element.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
    info.innerHTML = `選択中: <span class="tag">&lt;${tag}${id}${cls}&gt;</span>`;
  }

  // ── Text injection ────────────────────────────────────────────────────────────
  function handleInject() {
    if (!selectedElement) {
      showStatus('要素を選択してください', true);
      return;
    }
    const typeSelect = panelShadow.getElementById('text-type');
    const type = typeSelect.value;
    const text =
      type === 'custom'
        ? panelShadow.getElementById('custom-text').value
        : PRESETS[type] || '';
    injectText(selectedElement, text);
    showStatus('✓ テキストを挿入しました');
  }

  function handleClear() {
    if (!selectedElement) {
      showStatus('要素を選択してください', true);
      return;
    }
    injectText(selectedElement, '');
    showStatus('✓ クリアしました');
  }

  function injectText(element, text) {
    const tag = element.tagName.toLowerCase();
    const type = element.getAttribute('type') || '';
    const nonEditable = ['checkbox', 'radio', 'submit', 'button', 'file', 'image', 'reset'];

    if ((tag === 'input' && !nonEditable.includes(type)) || tag === 'textarea') {
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (element.isContentEditable) {
      element.textContent = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      element.textContent = text;
    }
  }

  function showStatus(msg, isError = false) {
    if (!panelShadow) return;
    const status = panelShadow.getElementById('status');
    status.textContent = msg;
    status.className = 'status' + (isError ? ' error' : '');
    clearTimeout(status.__dtiTimer);
    status.__dtiTimer = setTimeout(() => {
      status.textContent = '';
      status.className = 'status';
    }, 2200);
  }

  // ── Highlight styles ──────────────────────────────────────────────────────────
  function injectHighlightStyles() {
    if (document.getElementById('__dti-styles')) return;
    const style = document.createElement('style');
    style.id = '__dti-styles';
    style.textContent = `
      .__dti-hover {
        outline: 2px solid #6366f1 !important;
        outline-offset: 1px !important;
        cursor: crosshair !important;
      }
      .__dti-selected {
        outline: 2px solid #f59e0b !important;
        outline-offset: 1px !important;
      }
    `;
    document.head.appendChild(style);
  }

  function removeHighlightStyles() {
    const style = document.getElementById('__dti-styles');
    if (style) style.remove();
  }

  // ── Activate / Deactivate ─────────────────────────────────────────────────────
  function activate() {
    if (isActive) return;
    isActive = true;
    injectHighlightStyles();
    createPanel();
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    document.querySelectorAll('.__dti-hover, .__dti-selected').forEach((el) => {
      el.classList.remove('__dti-hover', '__dti-selected');
    });
    removeHighlightStyles();
    removePanel();
    selectedElement = null;
    hoveredElement = null;
  }

  // ── Message listener ──────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'toggle') {
      if (isActive) deactivate();
      else activate();
      sendResponse({ isActive });
      return true;
    }
    if (message.action === 'getState') {
      sendResponse({ isActive });
      return true;
    }
  });
})();
