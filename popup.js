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
    const mainView = document.getElementById('main-view');
    const settingsView = document.getElementById('settings-view');
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
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
    const editPresetButtons = document.querySelectorAll('.btn-edit-presets');
    const presetButtonContainers = document.querySelectorAll('.preset-buttons');
    const allInputRows = document.querySelectorAll('.input-row');
    const keyboardForwardKeyBtn = document.getElementById('keyboardForwardKey');
    const keyboardBackwardKeyBtn = document.getElementById('keyboardBackwardKey');
    const hotkeyEditButton = document.getElementById('hotkeyEditButton');
    const keyboardCard = document.getElementById('keyboard-skip-card');
    const resetHotkeysBtn = document.getElementById('resetHotkeysBtn');
    const buttonSkipCard = document.getElementById('button-skip-card');
    
    const actionTimingCard = document.getElementById('action-timing-card');
    const actionTimingEnabledToggle = document.getElementById('actionTimingEnabledToggle');
    const actionTimingStatusLabel = document.getElementById('actionTimingStatusLabel');
    const actionDelayInput = document.getElementById('actionDelay');
    const resetActionTimingBtn = document.getElementById('resetActionTiming');

    const warningOverlay = document.getElementById('advanced-warning-overlay');
    const proceedBtn = document.getElementById('proceed-ack');

    const defaultSettings = {
      extensionEnabled: true,
      buttonSkipEnabled: true,
      keyboardShortcutsEnabled: true,
      forwardSkipTime: 10,
      backwardSkipTime: 10,
      keyboardForward: 5,
      keyboardBackward: 5,
      keyboardForwardKey: 'ArrowRight',
      keyboardBackwardKey: 'ArrowLeft',
      actionTimingEnabled: true,
      actionDelay: 50,
      advancedWarningAcknowledged: false,
      btnFwdPreset1Value: 5, btnFwdPreset2Value: 10, btnFwdPreset3Value: 15, btnFwdPreset4Value: 30,
      btnBwdPreset1Value: 5, btnBwdPreset2Value: 10, btnBwdPreset3Value: 15, btnBwdPreset4Value: 30,
      kbdFwdPreset1Value: 5, kbdFwdPreset2Value: 10, kbdFwdPreset3Value: 15, kbdFwdPreset4Value: 30,
      kbdBwdPreset1Value: 5, kbdBwdPreset2Value: 10, kbdBwdPreset3Value: 15, kbdBwdPreset4Value: 30,
      theme: 'dark'
    };

    let currentSettings = { ...defaultSettings };
    let saveTimeout;
    
    function resetCardEditState(cardElement) {
        if (!cardElement) return;

        const openPresetEditors = cardElement.querySelectorAll('.input-row.is-editing-presets');
        openPresetEditors.forEach(row => {
            row.classList.remove('is-editing-presets');
            const button = row.querySelector('.btn-edit-presets');
            if (button) {
                button.querySelector('.icon-edit').style.display = 'inline-block';
                button.querySelector('.icon-save').style.display = 'none';
            }
        });

        if (cardElement.id === 'keyboard-skip-card' && cardElement.classList.contains('is-editing-hotkeys')) {
            cardElement.classList.remove('is-editing-hotkeys');
            const button = cardElement.querySelector('#hotkeyEditButton');
            if (button) {
                button.querySelector('.icon-edit').style.display = 'inline-block';
                button.querySelector('.icon-check').style.display = 'none';
            }
        }
    }
    
    function initializeSpinner(container) {
        const input = container.querySelector('.custom-spinner-input');
        const upBtn = container.querySelector('.spinner-btn-up');
        const downBtn = container.querySelector('.spinner-btn-down');
        
        let intervalId = null;
        let timeoutId = null;
        const initialDelay = 500;
        const repeatDelay = 100;

        const startChanging = (direction) => {
            stopChanging();
            
            if (direction === 'up') {
                input.stepUp();
            } else {
                input.stepDown();
            }
            input.dispatchEvent(new Event('change', { bubbles: true }));

            timeoutId = setTimeout(() => {
                intervalId = setInterval(() => {
                    if (direction === 'up') {
                        input.stepUp();
                    } else {
                        input.stepDown();
                    }
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }, repeatDelay);
            }, initialDelay);
        };

        const stopChanging = () => {
            clearTimeout(timeoutId);
            clearInterval(intervalId);
        };

        upBtn.addEventListener('mousedown', () => startChanging('up'));
        downBtn.addEventListener('mousedown', () => startChanging('down'));
        upBtn.addEventListener('mouseup', stopChanging);
        upBtn.addEventListener('mouseleave', stopChanging);
        downBtn.addEventListener('mouseup', stopChanging);
        downBtn.addEventListener('mouseleave', stopChanging);
    }

    document.querySelectorAll('.custom-spinner-container').forEach(initializeSpinner);

    if (openSettingsBtn) {
        openSettingsBtn.addEventListener('click', () => {
            mainView.classList.remove('active');
            settingsView.classList.add('active');
        });
    }
    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => {
            settingsView.classList.remove('active');
            mainView.classList.add('active');
        });
    }

    function updateStatusUI() {
        const isEnabled = toggle.checked;
        if (buttonSkipCard) buttonSkipCard.classList.toggle('is-disabled', !isEnabled || !buttonToggle.checked);
        if (keyboardCard) keyboardCard.classList.toggle('is-disabled', !isEnabled || !keyboardToggle.checked);
        if (actionTimingCard) actionTimingCard.classList.toggle('is-disabled', !isEnabled || !actionTimingEnabledToggle.checked);

        statusText.textContent = isEnabled ? 'Extension Enabled' : 'Extension Disabled';
        statusText.classList.toggle('enabled', isEnabled);
        statusText.classList.toggle('disabled', !isEnabled);

        const btnLabelIconUse = buttonStatusLabel.querySelector('svg use');
        const btnLabelTextNode = buttonStatusLabel.childNodes[2];
        if (btnLabelIconUse && btnLabelTextNode) {
            btnLabelTextNode.nodeValue = buttonToggle.checked ? ' Button Skip Times Enabled' : ' Button Skip Times Disabled';
            btnLabelIconUse.setAttribute('href', buttonToggle.checked ? '#icon-toggle-right' : '#icon-toggle-left');
        }

        const kbdLabelIconUse = keyboardStatusLabel.querySelector('svg use');
        const kbdLabelTextNode = keyboardStatusLabel.childNodes[2];
         if (kbdLabelIconUse && kbdLabelTextNode) {
            kbdLabelTextNode.nodeValue = keyboardToggle.checked ? ' Keyboard Shortcuts Enabled' : ' Keyboard Shortcuts Disabled';
            kbdLabelIconUse.setAttribute('href', keyboardToggle.checked ? '#icon-toggle-right' : '#icon-toggle-left');
        }
        
        const atLabelIconUse = actionTimingStatusLabel.querySelector('svg use');
        const atLabelTextNode = actionTimingStatusLabel.childNodes[2];
        if (atLabelIconUse && atLabelTextNode) {
            atLabelTextNode.nodeValue = actionTimingEnabledToggle.checked ? ' Action Delay Enabled' : ' Action Delay Disabled';
            atLabelIconUse.setAttribute('href', actionTimingEnabledToggle.checked ? '#icon-toggle-right' : '#icon-toggle-left');
        }
    }

    function enforceMinMax(input, min = 1, max = 99) {
        if (!input || typeof input.value === 'undefined') return min;
        let value = parseInt(input.value, 10);
        if (isNaN(value)) value = min;
        value = Math.max(min, Math.min(max, value));
        if (input.value !== value.toString()) {
             input.value = value;
        }
        return value;
    }

    function showFeedback(message, isError = false) {
        if (!saveStatusIndicator) return;
        clearTimeout(saveTimeout);
        saveStatusIndicator.textContent = message;
        saveStatusIndicator.className = 'show';
        if (isError) {
            saveStatusIndicator.classList.add('error');
        }
        saveTimeout = setTimeout(() => {
            saveStatusIndicator.classList.remove('show', 'error');
        }, 2000);
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
                 editor.querySelectorAll('.custom-spinner-input').forEach(input => {
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
            const inputs = presetEditor.querySelectorAll('.custom-spinner-input');
            let changed = false;
            inputs.forEach(input => {
                const index = input.dataset.presetIndex;
                const newValue = enforceMinMax(input);
                const settingKey = `${context}Preset${parseInt(index) + 1}Value`;
                if (currentSettings[settingKey] !== newValue) {
                    currentSettings[settingKey] = newValue;
                    changed = true;
                }
            });

            if (changed) {
                saveSettings(true);
            }
            updatePresetUI();
            
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
    
    function toggleHotkeyEditMode() {
        const isEditing = keyboardCard.classList.contains('is-editing-hotkeys');
        const iconEdit = hotkeyEditButton.querySelector('.icon-edit');
        const iconSave = hotkeyEditButton.querySelector('.icon-check');

        keyboardCard.classList.toggle('is-editing-hotkeys');

        if (isEditing) {
            iconEdit.style.display = '';
            iconSave.style.display = 'none';
            hotkeyEditButton.setAttribute('aria-label', 'Edit Hotkeys');
        } else {
            iconEdit.style.display = 'none';
            iconSave.style.display = '';
            hotkeyEditButton.setAttribute('aria-label', 'Save Hotkeys');
        }
    }

    async function loadSettings() {
        try {
            const stored = await browser.storage.local.get(null);
            const newSettings = { ...defaultSettings, ...stored };
            
            if (Object.keys(stored).length !== Object.keys(newSettings).length) {
                await browser.storage.local.set(newSettings);
            }
            
            currentSettings = newSettings;
            
            if (currentSettings.advancedWarningAcknowledged) {
                warningOverlay.classList.add('hidden');
            } else {
                warningOverlay.classList.remove('hidden');
            }

            applySettingsToUI(currentSettings);
        } catch (error) {
            console.error('Error loading settings:', error);
            applySettingsToUI(defaultSettings);
        }
    }

    function formatKeyForDisplay(key) {
        if (!key) return '';
        switch (key) {
            case 'ArrowRight': return '→';
            case 'ArrowLeft': return '←';
            case 'ArrowUp': return '↑';
            case 'ArrowDown': return '↓';
            case ' ': return 'Space';
            default: return key.length === 1 ? key.toUpperCase() : key;
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
         if (keyboardForwardKeyBtn) keyboardForwardKeyBtn.textContent = formatKeyForDisplay(settings.keyboardForwardKey);
         if (keyboardBackwardKeyBtn) keyboardBackwardKeyBtn.textContent = formatKeyForDisplay(settings.keyboardBackwardKey);
         
         if(actionTimingEnabledToggle) actionTimingEnabledToggle.checked = settings.actionTimingEnabled;
         if(actionDelayInput) actionDelayInput.value = enforceMinMax({ value: settings.actionDelay }, 0, 2000);

         updateStatusUI();
         updatePresetUI();
    }

    async function saveSettings(showSuccess = true) {
        currentSettings = {
            ...currentSettings,
            extensionEnabled: toggle.checked,
            buttonSkipEnabled: buttonToggle.checked,
            keyboardShortcutsEnabled: keyboardToggle.checked,
            forwardSkipTime: enforceMinMax(forwardTimeInput),
            backwardSkipTime: enforceMinMax(backwardTimeInput),
            keyboardForward: enforceMinMax(keyboardForwardInput),
            keyboardBackward: enforceMinMax(keyboardBackwardInput),
            actionTimingEnabled: actionTimingEnabledToggle.checked,
            actionDelay: enforceMinMax(actionDelayInput, 0, 2000),
        };
        
        try {
            await browser.storage.local.set(currentSettings);
            if (showSuccess) showFeedback("Settings Saved!");
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

    function handleHotkeyListen(button, settingKey) {
        const originalText = formatKeyForDisplay(currentSettings[settingKey]);
        const otherSettingKey = settingKey === 'keyboardForwardKey' ? 'keyboardBackwardKey' : 'keyboardForwardKey';

        document.querySelectorAll('.btn-hotkey.is-listening').forEach(btn => {
            btn.classList.remove('is-listening');
            const keyToRestore = btn.id === 'keyboardForwardKey' ? currentSettings.keyboardForwardKey : currentSettings.keyboardBackwardKey;
            btn.textContent = formatKeyForDisplay(keyToRestore);
        });
        
        button.classList.add('is-listening');
        button.textContent = 'Press key...';

        const cleanup = (shouldRevert) => {
            if (shouldRevert) {
                button.textContent = originalText;
            }
            button.classList.remove('is-listening');
            window.removeEventListener('keydown', keydownHandler, { capture: true });
            document.body.removeEventListener('click', clickAwayHandler, { capture: true });
            window.removeEventListener('blur', blurAwayHandler);
        };

        const keydownHandler = (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            const newKey = event.key;
            
            if (newKey === currentSettings[otherSettingKey]) {
                showFeedback('This key is already in use!', true);
                cleanup(true);
                return;
            }

            currentSettings[settingKey] = newKey;
            button.textContent = formatKeyForDisplay(newKey);
            saveSettings();
            cleanup(false);
        };
        
        const clickAwayHandler = (e) => {
             if (e.target !== button) {
                cleanup(true);
             }
        };

        const blurAwayHandler = () => cleanup(true);
        
        window.addEventListener('keydown', keydownHandler, { once: true, capture: true });
        document.body.addEventListener('click', clickAwayHandler, { once: true, capture: true });
        window.addEventListener('blur', blurAwayHandler, { once: true });
    }

    if (keyboardForwardKeyBtn) {
        keyboardForwardKeyBtn.addEventListener('click', () => handleHotkeyListen(keyboardForwardKeyBtn, 'keyboardForwardKey'));
    }
    if (keyboardBackwardKeyBtn) {
        keyboardBackwardKeyBtn.addEventListener('click', () => handleHotkeyListen(keyboardBackwardKeyBtn, 'keyboardBackwardKey'));
    }
    if (hotkeyEditButton) {
        hotkeyEditButton.addEventListener('click', toggleHotkeyEditMode);
    }
    if (resetHotkeysBtn) {
        resetHotkeysBtn.addEventListener('click', () => {
            currentSettings.keyboardForwardKey = defaultSettings.keyboardForwardKey;
            currentSettings.keyboardBackwardKey = defaultSettings.keyboardBackwardKey;
            applySettingsToUI(currentSettings);
            saveSettings();
        });
    }

    if (themeToggleButton) {
        themeToggleButton.addEventListener('click', async () => {
            const isLight = bodyElement.classList.contains('light-theme');
            const newTheme = isLight ? 'dark' : 'light';
            applyTheme(newTheme, bodyElement, themeToggleButton);
            try {
                currentSettings.theme = newTheme;
                await browser.storage.local.set({ theme: newTheme });
            } catch (error) {
                console.error("Error saving theme setting:", error);
            }
        });
    }

    toggle.addEventListener('change', () => { 
        updateStatusUI(); 
        saveSettings(); 
        if (!toggle.checked) {
            resetCardEditState(buttonSkipCard);
            resetCardEditState(keyboardCard);
        }
    });

    buttonToggle.addEventListener('change', () => { 
        updateStatusUI(); 
        saveSettings(); 
        if (!buttonToggle.checked) {
            resetCardEditState(buttonSkipCard);
        }
    });

    keyboardToggle.addEventListener('change', () => { 
        updateStatusUI(); 
        saveSettings(); 
        if (!keyboardToggle.checked) {
            resetCardEditState(keyboardCard);
        }
    });
    
    document.querySelectorAll('.custom-spinner-input').forEach(input => {
        input.addEventListener('change', (e) => {
            if (e.target.classList.contains('preset-value-input')) {
                enforceMinMax(e.target);
            } else if (e.target.id === 'actionDelay') {
                enforceMinMax(e.target, 0, 2000);
            } else {
                enforceMinMax(e.target);
            }
            saveSettings();
        });
        input.addEventListener('blur', (e) => {
            if (e.target.classList.contains('preset-value-input')) {
                enforceMinMax(e.target);
            } else if (e.target.id === 'actionDelay') {
                enforceMinMax(e.target, 0, 2000);
            } else {
                enforceMinMax(e.target);
            }
        });
    });

    editPresetButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            const inputRow = event.target.closest('.input-row');
            if (inputRow) togglePresetEditMode(inputRow);
        });
    });

    presetButtonContainers.forEach(container => {
        container.addEventListener('click', (event) => {
            if (event.target.classList.contains('btn-preset')) {
                const button = event.target;
                const targetInput = document.getElementById(container.dataset.target);
                if (targetInput) {
                    targetInput.value = button.dataset.value;
                    targetInput.dispatchEvent(new Event('change'));
                }
            }
        });
    });

    if (proceedBtn) {
        proceedBtn.addEventListener('click', async () => {
            warningOverlay.classList.add('hidden');
            currentSettings.advancedWarningAcknowledged = true;
            await browser.storage.local.set({ advancedWarningAcknowledged: true });
        });
    }
    
    actionTimingEnabledToggle.addEventListener('change', () => {
        updateStatusUI();
        saveSettings();
    });

    if (resetActionTimingBtn) {
        resetActionTimingBtn.addEventListener('click', () => {
            currentSettings.actionTimingEnabled = defaultSettings.actionTimingEnabled;
            currentSettings.actionDelay = defaultSettings.actionDelay;
            applySettingsToUI(currentSettings);
            saveSettings(true);
        });
    }

    if (resetButton) {
        resetButton.addEventListener('click', async () => {
            const themeToKeep = currentSettings.theme || 'dark';
            currentSettings = { ...defaultSettings, theme: themeToKeep };
            
            warningOverlay.classList.remove('hidden');

            applySettingsToUI(currentSettings);
            await browser.storage.local.set(currentSettings);
            showFeedback("Settings Reset!");

            const tabs = await browser.tabs.query({ url: '*://*.youtube.com/*' });
            tabs.forEach(tab => {
                if (tab.id) {
                    browser.tabs.sendMessage(tab.id, {
                        action: 'updateSettings',
                        settings: currentSettings
                    }).catch(err => {});
                }
            });
        });
    }
    
    await loadInitialTheme(bodyElement, themeToggleButton);
    await loadSettings();
});