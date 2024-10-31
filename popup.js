document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('enableToggle');
  const toggleLabel = document.getElementById('toggleLabel');

  function updateLabel(isEnabled) {
    toggleLabel.textContent = isEnabled ? 'Disable Extension' : 'Enable Extension';
  }

  // Get initial state
  try {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
      url: '*://*.youtube.com/*'
    });

    if (tabs.length > 0) {
      try {
        // Get state from content script
        const response = await browser.tabs.sendMessage(tabs[0].id, {
          action: 'getState'
        });
        
        toggle.checked = response.isEnabled;
        updateLabel(response.isEnabled);
      } catch (error) {
        // If content script hasn't loaded yet, fall back to storage
        const stored = await browser.storage.local.get('extensionEnabled');
        toggle.checked = stored.extensionEnabled ?? true;
        updateLabel(toggle.checked);
      }
    } else {
      // If not on YouTube, get state from storage
      const stored = await browser.storage.local.get('extensionEnabled');
      toggle.checked = stored.extensionEnabled ?? true;
      updateLabel(toggle.checked);
    }
  } catch (error) {
    console.error('Error getting initial state:', error);
    // Default to enabled if there's an error
    toggle.checked = true;
    updateLabel(true);
  }

  // Handle toggle changes
  toggle.addEventListener('change', async () => {
    const newState = toggle.checked;
    
    try {
      // Update storage first
      await browser.storage.local.set({
        extensionEnabled: newState
      });

      // Update label
      updateLabel(newState);

      // Notify all YouTube tabs
      const tabs = await browser.tabs.query({
        url: '*://*.youtube.com/*'
      });

      await Promise.all(tabs.map(tab => 
        browser.tabs.sendMessage(tab.id, {
          action: 'updateState',
          isEnabled: newState
        }).catch(error => {
          console.warn(`Could not update tab ${tab.id}:`, error);
        })
      ));

    } catch (error) {
      console.error('Error updating state:', error);
      // Revert toggle and label if there's an error
      toggle.checked = !newState;
      updateLabel(!newState);
    }
  });
});