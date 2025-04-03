document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('enableToggle');
  const toggleStatus = document.getElementById('toggleStatus');
  const forwardTime = document.getElementById('forwardSkipTime');
  const backwardTime = document.getElementById('backwardSkipTime');
  const keyboardForward = document.getElementById('keyboardForward');
  const keyboardBackward = document.getElementById('keyboardBackward');

  let currentSettings = {
    extensionEnabled: true,
    forwardSkipTime: 10,
    backwardSkipTime: 10,
    keyboardForward: 5,
    keyboardBackward: 5
  };

  function updateToggleStatus() {
    if (toggle.checked) {
      toggleStatus.textContent = 'Extension Enabled';
      toggleStatus.style.color = '#4285f4';
    } else {
      toggleStatus.textContent = 'Extension Disabled';
      toggleStatus.style.color = '#ea4335';
    }
  }

  function enforceMinMax(input, min = 1, max = 300) {
    let value = parseInt(input.value) || min;
    value = Math.max(min, Math.min(max, value));
    input.value = value;
    return value;
  }

  [forwardTime, backwardTime, keyboardForward, keyboardBackward].forEach(input => {
    input.addEventListener('change', () => enforceMinMax(input));
    input.addEventListener('input', () => enforceMinMax(input));
  });

  async function loadSettings() {
    try {
      const stored = await browser.storage.local.get([
        'extensionEnabled',
        'forwardSkipTime',
        'backwardSkipTime',
        'keyboardForward',
        'keyboardBackward'
      ]);
      
      currentSettings = {
        extensionEnabled: stored.extensionEnabled !== false,
        forwardSkipTime: stored.forwardSkipTime || 10,
        backwardSkipTime: stored.backwardSkipTime || 10,
        keyboardForward: stored.keyboardForward || 5,
        keyboardBackward: stored.keyboardBackward || 5
      };

      toggle.checked = currentSettings.extensionEnabled;
      forwardTime.value = currentSettings.forwardSkipTime;
      backwardTime.value = currentSettings.backwardSkipTime;
      keyboardForward.value = currentSettings.keyboardForward;
      keyboardBackward.value = currentSettings.keyboardBackward;
      
      updateToggleStatus();
    } catch (error) {
      console.error('Error loading settings:', error);
      toggle.checked = true;
      updateToggleStatus();
    }
  }

  async function saveSettings() {
    currentSettings = {
      extensionEnabled: toggle.checked,
      forwardSkipTime: enforceMinMax(forwardTime),
      backwardSkipTime: enforceMinMax(backwardTime),
      keyboardForward: enforceMinMax(keyboardForward),
      keyboardBackward: enforceMinMax(keyboardBackward)
    };

    await browser.storage.local.set(currentSettings);
    updateToggleStatus();

    try {
      const tabs = await browser.tabs.query({ url: '*://*.youtube.com/*' });
      for (const tab of tabs) {
        try {
          await browser.tabs.sendMessage(tab.id, {
            action: 'updateSettings',
            settings: currentSettings
          });
        } catch (err) {
          console.log('Tab not ready for messaging:', err);
        }
      }
    } catch (error) {
      console.error('Error querying tabs:', error);
    }
  }

  toggle.addEventListener('change', saveSettings);
  forwardTime.addEventListener('change', saveSettings);
  backwardTime.addEventListener('change', saveSettings);
  keyboardForward.addEventListener('change', saveSettings);
  keyboardBackward.addEventListener('change', saveSettings);

  loadSettings();

  setInterval(async () => {
    if (document.hidden) return;
    
    try {
      const tabs = await browser.tabs.query({ url: '*://*.youtube.com/*' });
      for (const tab of tabs) {
        try {
          await browser.tabs.sendMessage(tab.id, {
            action: 'updateSettings',
            settings: currentSettings
          });
        } catch (err) {
        }
      }
    } catch (error) {
      console.error('Background tab check failed:', error);
    }
  }, 5000);
});