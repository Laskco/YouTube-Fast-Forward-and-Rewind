document.addEventListener('DOMContentLoaded', async () => {
    const toggle = document.getElementById('enableToggle');
    
    // Get initial state
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
        url: '*://*.youtube.com/*'
      });
  
      if (tabs.length > 0) {
        // Get state from content script
        const response = await browser.tabs.sendMessage(tabs[0].id, {
          action: 'getState'
        });
        
        toggle.checked = response.isEnabled;
      } else {
        // If not on YouTube, get state from storage
        const stored = await browser.storage.local.get('extensionEnabled');
        toggle.checked = stored.extensionEnabled ?? true;
      }
    } catch (error) {
      console.error('Error getting initial state:', error);
      // Default to enabled if there's an error
      toggle.checked = true;
    }
  
    // Handle toggle changes
    toggle.addEventListener('change', async () => {
      try {
        // Update storage
        await browser.storage.local.set({
          extensionEnabled: toggle.checked
        });
  
        // Notify all YouTube tabs
        const tabs = await browser.tabs.query({
          url: '*://*.youtube.com/*'
        });
  
        tabs.forEach(tab => {
          browser.tabs.sendMessage(tab.id, {
            action: 'updateState',
            isEnabled: toggle.checked
          });
        });
      } catch (error) {
        console.error('Error updating state:', error);
        // Revert toggle if there's an error
        toggle.checked = !toggle.checked;
      }
    });
  });