async function applyTheme(theme, bodyElement, themeToggleButton) {
    if (theme === 'light') {
        bodyElement.classList.add('light-theme');
        if (themeToggleButton) {
            const sunSvg = themeToggleButton.querySelector('svg use[href="#icon-sun"]');
            const moonSvg = themeToggleButton.querySelector('svg use[href="#icon-moon"]');
            if (sunSvg) sunSvg.closest('svg').style.display = 'none';
            if (moonSvg) moonSvg.closest('svg').style.display = 'inline-block';
        }
    } else {
        bodyElement.classList.remove('light-theme');
        if (themeToggleButton) {
            const sunSvg = themeToggleButton.querySelector('svg use[href="#icon-sun"]');
            const moonSvg = themeToggleButton.querySelector('svg use[href="#icon-moon"]');
            if (sunSvg) sunSvg.closest('svg').style.display = 'inline-block';
            if (moonSvg) moonSvg.closest('svg').style.display = 'none';
        }
    }
}

async function loadInitialTheme(bodyElement, themeToggleButton) {
     try {
        const data = await browser.storage.local.get('theme');
        const savedTheme = data.theme || 'dark';
        applyTheme(savedTheme, bodyElement, themeToggleButton);
     } catch (error) {
         console.error("Error loading theme setting:", error);
         applyTheme('dark', bodyElement, themeToggleButton);
     }
}

document.addEventListener('DOMContentLoaded', async () => {
    const bodyElement = document.body;
    const themeToggleButton = document.getElementById('themeToggle');
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
      kbdFwdPreset1Value: 5, kbdFwdPreset2Value: 10, kbdFwdPreset3Value: 15, kbdFwdPreset4Value: 30,
      kbdBwdPreset1Value: 5, kbdBwdPreset2Value: 10, kbdBwdPreset3Value: 15, kbdBwdPreset4Value: 30,
      theme: 'dark'
    };

    let currentSettings = { ...defaultSettings };
    let saveTimeout;

    function updateStatusUI() {
        if (!statusText || !buttonStatusLabel || !keyboardStatusLabel || !toggle || !buttonToggle || !keyboardToggle) return;
        statusText.textContent = toggle.checked ? 'Extension Enabled' : 'Extension Disabled';
        statusText.classList.toggle('enabled', toggle.checked);
        statusText.classList.toggle('disabled', !toggle.checked);

        const btnLabelIconUse = buttonStatusLabel.querySelector('svg use');
        const btnLabelTextNode = buttonStatusLabel.childNodes[2];
        if (btnLabelIconUse && btnLabelTextNode && btnLabelTextNode.nodeType === Node.TEXT_NODE) {
            btnLabelTextNode.nodeValue = buttonToggle.checked ? ' Button Skip Times Enabled' : ' Button Skip Times Disabled';
            btnLabelIconUse.setAttribute('href', buttonToggle.checked ? '#icon-toggle-right' : '#icon-toggle-left');
        }

        const kbdLabelIconUse = keyboardStatusLabel.querySelector('svg use');
        const kbdLabelTextNode = keyboardStatusLabel.childNodes[2];
         if (kbdLabelIconUse && kbdLabelTextNode && kbdLabelTextNode.nodeType === Node.TEXT_NODE) {
            kbdLabelTextNode.nodeValue = keyboardToggle.checked ? ' Keyboard Shortcuts Enabled' : ' Keyboard Shortcuts Disabled';
            kbdLabelIconUse.setAttribute('href', keyboardToggle.checked ? '#icon-toggle-right' : '#icon-toggle-left');
        }
    }

    function enforceMinMax(input, min = 1, max = 99) {
        if (!input || typeof input.value === 'undefined') return min;
        let value = parseInt(input.value, 10);
        if (isNaN(value) || value < min) value = min;
        else if (value > max) value = max;
        if (input.value !== value.toString()) {
             input.value = value;
        }
        return value;
    }

    function showSaveFeedback() {
        if (!saveStatusIndicator) return;
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
                    const rawValue = currentSettings[settingKey] ?? defaultSettings[settingKey];
                    const value = enforceMinMax({ value: rawValue });
                    button.textContent = `${value}s`;
                    button.dataset.value = value;
                });
            }
            const editor = row.querySelector('.preset-editor');
            if (editor) {
                 editor.querySelectorAll('.preset-value-input').forEach(input => {
                    const index = input.dataset.presetIndex;
                    const settingKey = `${context}Preset${parseInt(index) + 1}Value`;
                    const rawValue = currentSettings[settingKey] ?? defaultSettings[settingKey];
                    input.value = enforceMinMax({ value: rawValue });
                });
            }
        });
    }

    function togglePresetEditMode(inputRowElement) {
        const editButton = inputRowElement.querySelector('.btn-edit-presets');
        if (!editButton) return;
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
            } else {
                 updatePresetUI();
            }
            inputRowElement.classList.remove('is-editing-presets');
            if(iconEdit) iconEdit.style.display = '';
            if(iconSave) iconSave.style.display = 'none';
            editButton.setAttribute('aria-label', `Edit ${ariaLabelBase}`);
        } else {
            updatePresetUI();
            inputRowElement.classList.add('is-editing-presets');
            if(iconEdit) iconEdit.style.display = 'none';
            if(iconSave) iconSave.style.display = '';
            editButton.setAttribute('aria-label', `Save ${ariaLabelBase}`);
        }
    }

    async function loadSettings() {
        try {
            const stored = await browser.storage.local.get(Object.keys(defaultSettings).filter(k => k !== 'theme'));
            const themeData = await browser.storage.local.get('theme');
            currentSettings = { ...defaultSettings, ...stored, theme: themeData.theme || defaultSettings.theme };
            applySettingsToUI(currentSettings);
        } catch (error) {
            console.error('Error loading settings:', error);
            applySettingsToUI(defaultSettings);
        }
    }

    function applySettingsToUI(settings) {
         if (toggle) toggle.checked = settings.extensionEnabled;
         if (buttonToggle) buttonToggle.checked = settings.buttonSkipEnabled;
         if (keyboardToggle) keyboardToggle.checked = settings.keyboardShortcutsEnabled;
         if (forwardTimeInput) forwardTimeInput.value = enforceMinMax({ value: settings.forwardSkipTime });
         if (backwardTimeInput) backwardTimeInput.value = enforceMinMax({ value: settings.backwardSkipTime });
         if (keyboardForwardInput) keyboardForwardInput.value = enforceMinMax({ value: settings.keyboardForward });
         if (keyboardBackwardInput) keyboardBackwardInput.value = enforceMinMax({ value: settings.keyboardBackward });
         updateStatusUI();
         updatePresetUI();
         allInputRows.forEach(row => {
             if (row.classList.contains('is-editing-presets')) {
                 row.classList.remove('is-editing-presets');
                 const editButton = row.querySelector('.btn-edit-presets');
                 if(editButton) {
                    const iconEdit = editButton.querySelector('.icon-edit');
                    const iconSave = editButton.querySelector('.icon-save');
                    const ariaLabelBase = editButton.getAttribute('aria-label').replace('Edit ', '').replace('Save ', '');
                    if(iconEdit) iconEdit.style.display = '';
                    if(iconSave) iconSave.style.display = 'none';
                    editButton.setAttribute('aria-label', `Edit ${ariaLabelBase}`);
                 }
             }
         });
    }

    async function saveSettings(showFeedback = true) {
        currentSettings = {
            ...currentSettings,
            extensionEnabled: toggle ? toggle.checked : defaultSettings.extensionEnabled,
            buttonSkipEnabled: buttonToggle ? buttonToggle.checked : defaultSettings.buttonSkipEnabled,
            keyboardShortcutsEnabled: keyboardToggle ? keyboardToggle.checked : defaultSettings.keyboardShortcutsEnabled,
            forwardSkipTime: enforceMinMax(forwardTimeInput),
            backwardSkipTime: enforceMinMax(backwardTimeInput),
            keyboardForward: enforceMinMax(keyboardForwardInput),
            keyboardBackward: enforceMinMax(keyboardBackwardInput),
        };

        const settingsToSave = { ...currentSettings };
        delete settingsToSave.theme;

        applySettingsToUI(currentSettings);
        try {
            await browser.storage.local.set(settingsToSave);
            if (showFeedback) showSaveFeedback();
            const tabs = await browser.tabs.query({ url: '*://*.youtube.com/*' });
            tabs.forEach(tab => {
                if (tab.id) {
                    browser.tabs.sendMessage(tab.id, {
                        action: 'updateSettings',
                        settings: currentSettings
                    }).catch(err => {});
                }
            });
        } catch (error) {
            console.error('Error saving settings:', error);
        }
    }

    if (themeToggleButton) {
        themeToggleButton.addEventListener('click', async () => {
            const isLight = bodyElement.classList.contains('light-theme');
            const newTheme = isLight ? 'dark' : 'light';
            applyTheme(newTheme, bodyElement, themeToggleButton);
            try {
                await browser.storage.local.set({ theme: newTheme });
                currentSettings.theme = newTheme;
            } catch (error) {
                console.error("Error saving theme setting:", error);
            }
        });
    }

    if (toggle) toggle.addEventListener('change', () => saveSettings());
    if (buttonToggle) buttonToggle.addEventListener('change', () => saveSettings());
    if (keyboardToggle) keyboardToggle.addEventListener('change', () => saveSettings());

    allSkipInputs.forEach(input => {
        input.addEventListener('change', () => {
            enforceMinMax(input);
            saveSettings();
        });
        input.addEventListener('blur', () => {
             enforceMinMax(input);
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

    if (resetButton) {
        resetButton.addEventListener('click', async () => {
            const themeToKeep = currentSettings.theme || 'dark';
            currentSettings = { ...defaultSettings };
            Object.keys(currentSettings).forEach(key => {
                if (key.includes('Preset') || key.includes('SkipTime') || key.includes('Forward') || key.includes('Backward')) {
                     currentSettings[key] = defaultSettings[key];
                }
            });
            currentSettings.theme = themeToKeep;
            applyTheme(themeToKeep, bodyElement, themeToggleButton);
            applySettingsToUI(currentSettings);
            const settingsToSave = { ...currentSettings };
            delete settingsToSave.theme;
             try {
                 await browser.storage.local.set(settingsToSave);
                 const tabs = await browser.tabs.query({ url: '*://*.youtube.com/*' });
                 tabs.forEach(tab => {
                     if (tab.id) {
                         browser.tabs.sendMessage(tab.id, {
                             action: 'updateSettings',
                             settings: currentSettings
                         }).catch(err => {});
                     }
                 });
             } catch (error) {
                console.error('Error saving reset settings:', error);
            }
        });
    }

    await loadSettings();
    await loadInitialTheme(bodyElement, themeToggleButton);
    if (currentSettings.theme && currentSettings.theme !== 'dark') {
        applyTheme(currentSettings.theme, bodyElement, themeToggleButton);
    } else if (!currentSettings.theme) {
        applyTheme('dark', bodyElement, themeToggleButton);
    }
});