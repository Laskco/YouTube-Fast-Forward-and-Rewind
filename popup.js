document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('enableToggle');
  const toggleText = document.getElementById('toggleText');
  const backwardTime = document.getElementById('backwardSkipTime');
  const forwardTime = document.getElementById('forwardSkipTime');
 
  function enforceMaxValue(event) {
    if (parseInt(event.target.value, 10) > 99) {
      event.target.value = 99;
    }
  }
 
  forwardTime.addEventListener('input', enforceMaxValue);
  backwardTime.addEventListener('input', enforceMaxValue);
 
  try {
    const stored = await browser.storage.local.get([
      'extensionEnabled',
      'forwardSkipTime',
      'backwardSkipTime'
    ]);
   
    toggle.checked = stored.extensionEnabled !== false;
    toggleText.textContent = toggle.checked ? 'Extension Enabled' : 'Extension Disabled';
    backwardTime.value = stored.backwardSkipTime || 10;
    forwardTime.value = stored.forwardSkipTime || 10;
  } catch (error) {
    console.error('Error loading settings:', error);
    toggle.checked = true;
    toggleText.textContent = 'Extension Enabled';
  }
 
  const saveTimeValue = async (key, input) => {
    const value = Math.min(Math.max(parseInt(input.value) || 10, 1), 99);
    input.value = value;
    await browser.storage.local.set({ [key]: value });
    const tabs = await browser.tabs.query({ url: '*://*.youtube.com/*' });
    for (const tab of tabs) {
      try {
        await browser.tabs.sendMessage(tab.id, {
          action: 'updateTimes',
          times: { [key]: value }
        });
      } catch (err) {
        console.log('Tab not ready:', err);
      }
    }
  };
 
  backwardTime.addEventListener('change', () => saveTimeValue('backwardSkipTime', backwardTime));
  forwardTime.addEventListener('change', () => saveTimeValue('forwardSkipTime', forwardTime));
 
  toggle.addEventListener('change', async () => {
    try {
      const newState = toggle.checked;
      toggleText.textContent = newState ? 'Extension Enabled' : 'Extension Disabled';
      await browser.storage.local.set({ extensionEnabled: newState });
     
      const tabs = await browser.tabs.query({ url: '*://*.youtube.com/*' });
      for (const tab of tabs) {
        try {
          await browser.tabs.sendMessage(tab.id, {
            action: 'updateState',
            isEnabled: newState
          });
        } catch (err) {
          console.log('Tab not ready:', err);
        }
      }
    } catch (error) {
      console.error('Error updating extension state:', error);
      toggle.checked = !toggle.checked;
    }
  });
 });