document.addEventListener('DOMContentLoaded', async () => {
  const btn = document.getElementById('toggle-btn');
  const btnText = document.getElementById('btn-text');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Get current state from content script
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getState' });
    updateUI(response.isActive);
  } catch {
    // Content script not yet injected into this tab (pre-existing page)
    updateUI(false);
  }

  btn.addEventListener('click', async () => {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'toggle' });
      updateUI(response.isActive);
      // Close popup so the page is fully visible during selection
      if (response.isActive) window.close();
    } catch {
      // Inject script first, then toggle
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'toggle' });
        updateUI(response.isActive);
        if (response.isActive) window.close();
      } catch (err) {
        console.error('Failed to inject content script:', err);
      }
    }
  });

  function updateUI(isActive) {
    if (isActive) {
      btn.classList.add('active');
      btnText.textContent = '選択モードを停止';
    } else {
      btn.classList.remove('active');
      btnText.textContent = '選択モードを開始';
    }
  }
});
