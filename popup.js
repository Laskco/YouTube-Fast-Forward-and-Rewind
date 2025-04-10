document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('enableToggle');
  const statusText = document.getElementById('extensionStatusText');
  const keyboardToggle = document.getElementById('keyboardEnableToggle');
  const keyboardStatusLabel = document.getElementById('keyboardStatusLabel');
  const buttonToggle = document.getElementById('buttonEnableToggle'); 
  const buttonStatusLabel = document.getElementById('buttonStatusLabel'); 
  const forwardTimeInput = document.getElementById('forwardSkipTime');
  const backwardTimeInput = document.getElementById('backwardSkipTime');
  const keyboardForwardInput = document.getElementById('keyboardForward');
  const keyboardBackwardInput = document.getElementById('keyboardBackward');
  const resetButton = document.getElementById('resetSettings');
  const saveStatusIndicator = document.getElementById('saveStatus');
  const allSkipInputs = document.querySelectorAll('.skip-time-input');
  const editPresetButtons = document.querySelectorAll('.btn-edit-presets');
  const presetButtonContainers = document.querySelectorAll('.preset-buttons');
  const allInputRows = document.querySelectorAll('.input-row');

  const defaultSettings = {
      extensionEnabled: true,
      buttonSkipEnabled: true, 
      keyboardShortcutsEnabled: true,
      forwardSkipTime: 10,
      backwardSkipTime: 10,
      keyboardForward: 5,
      keyboardBackward: 5,
      btnFwdPreset1Value: 5, btnFwdPreset2Value: 10, btnFwdPreset3Value: 15, btnFwdPreset4Value: 30,
      btnBwdPreset1Value: 5, btnBwdPreset2Value: 10, btnBwdPreset3Value: 15, btnBwdPreset4Value: 30,
      kbdFwdPreset1Value: 3, kbdFwdPreset2Value: 5, kbdFwdPreset3Value: 10, kbdFwdPreset4Value: 15,
      kbdBwdPreset1Value: 3, kbdBwdPreset2Value: 5, kbdBwdPreset3Value: 10, kbdBwdPreset4Value: 15,
  };

  let currentSettings = { ...defaultSettings };
  let saveTimeout;

  function updateStatusUI() {
      statusText.textContent = toggle.checked ? 'Extension Enabled' : 'Extension Disabled';
      statusText.classList.toggle('enabled', toggle.checked);
      statusText.classList.toggle('disabled', !toggle.checked);

      const btnLabelIconUse = buttonStatusLabel.querySelector('svg use');
      buttonStatusLabel.childNodes[2].nodeValue = buttonToggle.checked ? ' Button Skip Times Enabled' : ' Button Skip Times Disabled';
      if (btnLabelIconUse) btnLabelIconUse.setAttribute('href', buttonToggle.checked ? '#icon-toggle-right' : '#icon-toggle-left');

      const kbdLabelIconUse = keyboardStatusLabel.querySelector('svg use');
      keyboardStatusLabel.childNodes[2].nodeValue = keyboardToggle.checked ? ' Keyboard Shortcuts Enabled' : ' Keyboard Shortcuts Disabled';
      if (kbdLabelIconUse) kbdLabelIconUse.setAttribute('href', keyboardToggle.checked ? '#icon-toggle-right' : '#icon-toggle-left');
  }

  function enforceMinMax(input, min = 1, max = 99) {
      if (!input) return min;
      let value = parseInt(input.value, 10);
      if (isNaN(value) || value < min) value = min;
      else if (value > max) value = max;
      input.value = value;
      return value;
  }

  function showSaveFeedback() {
      clearTimeout(saveTimeout);
      saveStatusIndicator.classList.add('show');
      saveTimeout = setTimeout(() => saveStatusIndicator.classList.remove('show'), 1500);
  }

  function updatePresetUI() {
      allInputRows.forEach(row => {
          const context = row.dataset.presetContext;
          if (!context) return;
          const buttonsContainer = row.querySelector(`.preset-buttons[data-preset-context="${context}"]`);
          if (buttonsContainer) {
              buttonsContainer.querySelectorAll('.btn-preset').forEach(button => {
                  const index = button.dataset.presetIndex;
                  const settingKey = `${context}Preset${parseInt(index) + 1}Value`;
                  const value = currentSettings[settingKey] ?? defaultSettings[settingKey];
                  button.textContent = `${value}s`;
                  button.dataset.value = value;
              });
          }
          const editor = row.querySelector('.preset-editor');
          if (editor) {
               editor.querySelectorAll('.preset-value-input').forEach(input => {
                  const index = input.dataset.presetIndex;
                  const settingKey = `${context}Preset${parseInt(index) + 1}Value`;
                  const value = currentSettings[settingKey] ?? defaultSettings[settingKey];
                  input.value = value;
              });
          }
      });
  }

  function togglePresetEditMode(inputRowElement) {
      const editButton = inputRowElement.querySelector('.btn-edit-presets');
      const iconEdit = editButton.querySelector('.icon-edit');
      const iconSave = editButton.querySelector('.icon-save');
      const isEditing = inputRowElement.classList.contains('is-editing-presets');
      const presetEditor = inputRowElement.querySelector('.preset-editor');
      const context = inputRowElement.dataset.presetContext;
      const ariaLabelBase = editButton.getAttribute('aria-label').replace('Edit ', '').replace('Save ', '');

      if (isEditing) {
          const inputs = presetEditor.querySelectorAll('.preset-value-input');
          let changed = false;
          inputs.forEach(input => {
              const index = input.dataset.presetIndex;
              const newValue = enforceMinMax(input);
              const settingKey = `${context}Preset${parseInt(index) + 1}Value`;
              const oldValue = currentSettings.hasOwnProperty(settingKey) ? currentSettings[settingKey] : defaultSettings[settingKey];
              if (oldValue !== newValue) {
                  currentSettings[settingKey] = newValue;
                  changed = true;
              }
          });
          if (changed) {
              saveSettings(true);
          }
          inputRowElement.classList.remove('is-editing-presets');
          iconEdit.style.display = '';
          iconSave.style.display = 'none';
          editButton.setAttribute('aria-label', `Edit ${ariaLabelBase}`);
      } else {
          updatePresetUI();
          inputRowElement.classList.add('is-editing-presets');
          iconEdit.style.display = 'none';
          iconSave.style.display = '';
          editButton.setAttribute('aria-label', `Save ${ariaLabelBase}`);
      }
  }

  async function loadSettings() {
      try {
          const stored = await browser.storage.local.get(defaultSettings);
          currentSettings = { ...defaultSettings, ...stored };
          applySettings(currentSettings);
      } catch (error) {
          console.error('Error loading settings:', error);
          applySettings(defaultSettings);
      }
  }

  function applySettings(settings) {
       toggle.checked = settings.extensionEnabled;
       buttonToggle.checked = settings.buttonSkipEnabled; 
       keyboardToggle.checked = settings.keyboardShortcutsEnabled;
       forwardTimeInput.value = settings.forwardSkipTime;
       backwardTimeInput.value = settings.backwardSkipTime;
       keyboardForwardInput.value = settings.keyboardForward;
       keyboardBackwardInput.value = settings.keyboardBackward;
       updateStatusUI();
       updatePresetUI();
       allInputRows.forEach(row => {
           if (row.classList.contains('is-editing-presets')) {
               row.classList.remove('is-editing-presets');
               const editButton = row.querySelector('.btn-edit-presets');
               if(editButton) {
                   const ariaLabelBase = editButton.getAttribute('aria-label').replace('Edit ', '').replace('Save ', '');
                   editButton.querySelector('.icon-edit').style.display = '';
                   editButton.querySelector('.icon-save').style.display = 'none';
                   editButton.setAttribute('aria-label', `Edit ${ariaLabelBase}`);
               }
           }
       });
  }

  async function saveSettings(showFeedback = true) {
      currentSettings = {
          ...currentSettings,
          extensionEnabled: toggle.checked,
          buttonSkipEnabled: buttonToggle.checked, 
          keyboardShortcutsEnabled: keyboardToggle.checked,
          forwardSkipTime: enforceMinMax(forwardTimeInput),
          backwardSkipTime: enforceMinMax(backwardTimeInput),
          keyboardForward: enforceMinMax(keyboardForwardInput),
          keyboardBackward: enforceMinMax(keyboardBackwardInput),
      };
      applySettings(currentSettings); 
      try {
          await browser.storage.local.set(currentSettings);
          if (showFeedback) showSaveFeedback();
          const tabs = await browser.tabs.query({ url: '*://*.youtube.com/*' });
          tabs.forEach(tab => {
              if (tab.id) {
                  browser.tabs.sendMessage(tab.id, {
                      action: 'updateSettings',
                      settings: currentSettings 
                  }).catch(err => console.log(`Tab ${tab.id} msg failed:`, err.message));
              }
          });
      } catch (error) {
          console.error('Error saving settings:', error);
      }
  }

  toggle.addEventListener('change', () => saveSettings());
  buttonToggle.addEventListener('change', () => saveSettings()); 
  keyboardToggle.addEventListener('change', () => saveSettings());

  allSkipInputs.forEach(input => {
      input.addEventListener('change', () => {
          enforceMinMax(input);
          saveSettings();
      });
  });

  editPresetButtons.forEach(button => {
      button.addEventListener('click', (event) => {
          const inputRow = event.target.closest('.input-row');
          if (inputRow) {
              togglePresetEditMode(inputRow);
          }
      });
  });

  presetButtonContainers.forEach(container => {
      container.addEventListener('click', (event) => {
          if (event.target.classList.contains('btn-preset')) {
              const button = event.target;
              const targetInputId = container.dataset.target;
              const targetInput = document.getElementById(targetInputId);
              if (targetInput) {
                  targetInput.value = button.dataset.value;
                  targetInput.dispatchEvent(new Event('change'));
              }
          }
      });
  });

   document.querySelectorAll('.preset-value-input').forEach(input => {
       input.addEventListener('keydown', (event) => {
           if (event.key === 'Enter') {
                const inputRow = input.closest('.input-row');
                if (inputRow && inputRow.classList.contains('is-editing-presets')) {
                      enforceMinMax(input);
                      togglePresetEditMode(inputRow);
                }
           }
       });
        input.addEventListener('blur', () => {
             enforceMinMax(input);
        });
   });

  resetButton.addEventListener('click', () => {
      currentSettings = { ...defaultSettings };
      applySettings(defaultSettings);
      saveSettings(false);
  });

  loadSettings();
});