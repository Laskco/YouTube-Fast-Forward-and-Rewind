const DEMO_SETTINGS = {
    extensionEnabled: true,
    buttonSkipEnabled: true,
    keyboardShortcutsEnabled: true,
    forwardSkipTime: 10,
    backwardSkipTime: 10,
    keyboardForward: 5,
    keyboardBackward: 5,
    keyboardForwardKey: 'ArrowRight',
    keyboardBackwardKey: 'ArrowLeft',
    controlsVisibleDuration: 2500,
    seekInterval: 150,
    progressBarUpdateDelay: 150,
    navigationInitDelay: 250,
    buttonPosition: 'left',
    ignoreBufferingProtection: false,
    btnFwdPreset1Value: 5,
    btnFwdPreset2Value: 10,
    btnFwdPreset3Value: 15,
    btnFwdPreset4Value: 30,
    btnBwdPreset1Value: 5,
    btnBwdPreset2Value: 10,
    btnBwdPreset3Value: 15,
    btnBwdPreset4Value: 30,
    kbdFwdPreset1Value: 5,
    kbdFwdPreset2Value: 10,
    kbdFwdPreset3Value: 15,
    kbdFwdPreset4Value: 30,
    kbdBwdPreset1Value: 5,
    kbdBwdPreset2Value: 10,
    kbdBwdPreset3Value: 15,
    kbdBwdPreset4Value: 30,
    theme: 'dark',
    stats_totalSecondsSkipped: 1250,
    stats_totalSkips: 47,
    stats_buttonSkips: 23,
    stats_keyboardSkips: 24
};

class ToastManager {
    constructor() {
        this.toastTimeout = null;
        this.toastElement = document.getElementById('toast-notification');
        this.toastIconUse = this.toastElement?.querySelector('.toast-icon use');
        this.toastMessage = this.toastElement?.querySelector('.toast-message');
    }

    show(message, type = 'success', duration = 2500) {
        if (!this.toastElement || !this.toastMessage || !this.toastIconUse) {
            console.log(`Toast (fallback): ${message} (${type})`);
            return;
        }
        clearTimeout(this.toastTimeout);
        this.toastElement.classList.remove('show', 'success', 'error', 'warning');

        this.toastMessage.textContent = String(message).substring(0, 200);
        const iconMap = {
            success: 'icon-check-circle',
            error: 'icon-x-circle',
            warning: 'icon-alert-triangle'
        };
        this.toastIconUse.setAttribute('href', `#${iconMap[type] || iconMap.success}`);

        requestAnimationFrame(() => {
            this.toastElement.classList.add(type, 'show');
        });

        this.toastTimeout = setTimeout(() => {
            this.toastElement.classList.remove('show');
            this.toastTimeout = null;
        }, duration);
    }
}

async function safeAsyncOperation(operation, errorMessage = 'Operation failed') {
    try {
        return await operation();
    } catch (error) {
        console.error(errorMessage, error);
        if (typeof toastManager !== 'undefined') {
            toastManager.show(errorMessage, 'error');
        }
        throw error;
    }
}

document.addEventListener('DOMContentLoaded', async () => {

    const UI = {
        html: document.documentElement,
        body: document.body,
        mainView: document.getElementById('main-view'),
        settingsView: document.getElementById('settings-view'),
        openSettingsBtn: document.getElementById('openSettingsBtn'),
        closeSettingsBtn: document.getElementById('closeSettingsBtn'),
        themeToggle: document.getElementById('themeToggle'),
        resetSettings: document.getElementById('resetSettings'),
        enableToggle: document.getElementById('enableToggle'),
        keyboardEnableToggle: document.getElementById('keyboardEnableToggle'),
        buttonEnableToggle: document.getElementById('buttonEnableToggle'),
        ignoreBufferingToggle: document.getElementById('ignoreBufferingToggle'),
        statusText: document.getElementById('extensionStatusText'),
        keyboardStatusLabel: document.getElementById('keyboardStatusLabel'),
        buttonStatusLabel: document.getElementById('buttonStatusLabel'),
        ignoreBufferingStatusLabel: document.getElementById('ignoreBufferingStatusLabel'),
        keyboardSkipCard: document.getElementById('keyboard-skip-card'),
        buttonSkipCard: document.getElementById('button-skip-card'),
        actionTimingCard: document.getElementById('action-timing-card'),
        forwardSkipTime: document.getElementById('forwardSkipTime'),
        backwardSkipTime: document.getElementById('backwardSkipTime'),
        keyboardForward: document.getElementById('keyboardForward'),
        keyboardBackward: document.getElementById('keyboardBackward'),
        keyboardForwardKey: document.getElementById('keyboardForwardKey'),
        keyboardBackwardKey: document.getElementById('keyboardBackwardKey'),
        hotkeyEditButton: document.getElementById('hotkeyEditButton'),
        resetHotkeysBtn: document.getElementById('resetHotkeysBtn'),
        seekInterval: document.getElementById('seekInterval'),
        controlsVisibleDuration: document.getElementById('controlsVisibleDuration'),
        progressBarUpdateDelay: document.getElementById('progressBarUpdateDelay'),
        navigationInitDelay: document.getElementById('navigationInitDelay'),
        resetActionTiming: document.getElementById('resetActionTiming'),
        openMoreSettingsBtn: document.getElementById('openMoreSettingsBtn'),
        moreTimingSettings: document.getElementById('moreTimingSettings'),
        posLeftBtn: document.getElementById('pos-left-btn'),
        posRightBtn: document.getElementById('pos-right-btn'),
        statsTotalTime: document.getElementById('statsTotalTime'),
        statsFormattedTime: document.getElementById('statsFormattedTime'),
        statsTotalSkips: document.getElementById('statsTotalSkips'),
        statsButtonSkips: document.getElementById('statsButtonSkips'),
        statsKeyboardSkips: document.getElementById('statsKeyboardSkips'),
        resetStatsBtn: document.getElementById('resetStatsBtn'),
        editPresetButtons: document.querySelectorAll('.btn-edit-presets'),
        resetPresetButtons: document.querySelectorAll('.btn-reset-presets'),
        presetButtonContainers: document.querySelectorAll('.preset-buttons'),
        allInputRows: document.querySelectorAll('.input-row'),
    };

    let currentSettings = {};
    const toastManager = new ToastManager();

    function showToast(message, type = 'success', duration = 2500) {
        toastManager.show(message, type, duration);
    }

    function formatKeyForDisplay(key) {
        if (!key) return '';
        const map = { ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', ' ': 'Space' };
        return map[key] || (key.length === 1 ? key.toUpperCase() : key);
    }

    function formatTime(totalSeconds) {
        if (isNaN(totalSeconds) || totalSeconds <= 0) return '0s';
        totalSeconds = Math.round(totalSeconds);
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        const parts = [];
        if (h > 0) parts.push(`${h}h`);
        if (m > 0) parts.push(`${m}m`);
        if (s > 0 || parts.length === 0) parts.push(`${s}s`);
        return parts.join(' ');
    }
    
    function flashElement(element) {
        if (!element) return;
        const container = element.closest('.custom-spinner-container');
        if (!container) return;

        container.classList.add('flash-indicator');
        setTimeout(() => {
            container.classList.remove('flash-indicator');
        }, 500);
    }

    function renderUI(settings) {
        if (!UI.enableToggle || !UI.buttonEnableToggle || !UI.keyboardEnableToggle) return;
        
        UI.enableToggle.checked = settings.extensionEnabled;
        UI.buttonEnableToggle.checked = settings.buttonSkipEnabled;
        UI.keyboardEnableToggle.checked = settings.keyboardShortcutsEnabled;
        
        if (UI.ignoreBufferingToggle) {
            UI.ignoreBufferingToggle.checked = !settings.ignoreBufferingProtection;
        }

        if (UI.forwardSkipTime) UI.forwardSkipTime.value = enforceMinMax({ value: settings.forwardSkipTime });
        if (UI.backwardSkipTime) UI.backwardSkipTime.value = enforceMinMax({ value: settings.backwardSkipTime });
        if (UI.keyboardForward) UI.keyboardForward.value = enforceMinMax({ value: settings.keyboardForward });
        if (UI.keyboardBackward) UI.keyboardBackward.value = enforceMinMax({ value: settings.keyboardBackward });

        if (UI.seekInterval) UI.seekInterval.value = enforceMinMax({ value: settings.seekInterval }, 0, 2000);
        if (UI.controlsVisibleDuration) UI.controlsVisibleDuration.value = enforceMinMax({ value: settings.controlsVisibleDuration }, 0, 10000);
        if (UI.progressBarUpdateDelay) UI.progressBarUpdateDelay.value = enforceMinMax({ value: settings.progressBarUpdateDelay }, 0, 2000);
        if (UI.navigationInitDelay) UI.navigationInitDelay.value = enforceMinMax({ value: settings.navigationInitDelay }, 0, 5000);

        if (UI.keyboardForwardKey) UI.keyboardForwardKey.textContent = formatKeyForDisplay(settings.keyboardForwardKey);
        if (UI.keyboardBackwardKey) UI.keyboardBackwardKey.textContent = formatKeyForDisplay(settings.keyboardBackwardKey);

        const isRight = settings.buttonPosition === 'right';
        if (UI.posRightBtn && UI.posLeftBtn) {
            UI.posRightBtn.classList.toggle('active', isRight);
            UI.posLeftBtn.classList.toggle('active', !isRight);
        }

        updateStatusUI();
        updatePresetUI();
        applyStatsToUI(settings);
    }

    function applyStatsToUI(settings) {
        const totalSeconds = settings.stats_totalSecondsSkipped || 0;
        if (UI.statsTotalTime) UI.statsTotalTime.textContent = `${totalSeconds}s`;
        if (UI.statsFormattedTime) UI.statsFormattedTime.textContent = formatTime(totalSeconds);
        if (UI.statsTotalSkips) UI.statsTotalSkips.textContent = settings.stats_totalSkips || 0;
        if (UI.statsButtonSkips) UI.statsButtonSkips.textContent = settings.stats_buttonSkips || 0;
        if (UI.statsKeyboardSkips) UI.statsKeyboardSkips.textContent = settings.stats_keyboardSkips || 0;
    }

    function updateStatusUI() {
        if (!UI.enableToggle || !UI.statusText) return;
        
        const isEnabled = UI.enableToggle.checked;
        
        if (UI.buttonSkipCard) {
            UI.buttonSkipCard.classList.toggle('is-disabled', !isEnabled || !UI.buttonEnableToggle.checked);
        }
        if (UI.keyboardSkipCard) {
            UI.keyboardSkipCard.classList.toggle('is-disabled', !isEnabled || !UI.keyboardEnableToggle.checked);
        }
        if (UI.actionTimingCard) {
            UI.actionTimingCard.classList.toggle('is-disabled', !isEnabled);
        }
        
        UI.statusText.textContent = isEnabled ? 'Extension Enabled' : 'Extension Disabled';
        UI.statusText.classList.toggle('enabled', isEnabled);
        UI.statusText.classList.toggle('disabled', !isEnabled);
        
        const updateLabel = (label, isChecked, text) => {
            if (!label) return;
            const iconUse = label.querySelector('svg use');
            const textNode = label.childNodes[2];
            if (iconUse && textNode) {
                textNode.nodeValue = ` ${text} ${isChecked ? 'Enabled' : 'Disabled'}`;
                iconUse.setAttribute('href', isChecked ? '#icon-toggle-right' : '#icon-toggle-left');
            }
        };
        
        if (UI.buttonStatusLabel && UI.buttonEnableToggle) {
            updateLabel(UI.buttonStatusLabel, UI.buttonEnableToggle.checked, 'Button Skip Times');
        }
        if (UI.keyboardStatusLabel && UI.keyboardEnableToggle) {
            updateLabel(UI.keyboardStatusLabel, UI.keyboardEnableToggle.checked, 'Keyboard Shortcuts');
        }
        if (UI.ignoreBufferingStatusLabel && UI.ignoreBufferingToggle) {
            updateLabel(UI.ignoreBufferingStatusLabel, !UI.ignoreBufferingToggle.checked, 'Buffering Protection');
        }
    }

    function updatePresetUI() {
        if (!UI.allInputRows) return;
        
        UI.allInputRows.forEach(row => {
            const context = row.dataset.presetContext;
            if (!context) return;

            const updateElements = (elements, isButton) => {
                elements.forEach(el => {
                    const index = el.dataset.presetIndex;
                    const settingKey = `${context}Preset${parseInt(index) + 1}Value`;
                    const rawValue = currentSettings[settingKey] ?? 10;
                    const value = enforceMinMax({ value: rawValue });
                    if (isButton) {
                        el.textContent = `${value}s`;
                        el.dataset.value = value;
                    } else {
                        el.value = value;
                    }
                });
            };

            const buttonsContainer = row.querySelector(`.preset-buttons[data-preset-context="${context}"]`);
            if (buttonsContainer) updateElements(buttonsContainer.querySelectorAll('.btn-preset'), true);

            const editor = row.querySelector('.preset-editor');
            if (editor) updateElements(editor.querySelectorAll('.custom-spinner-input'), false);
        });
    }

    function enforceMinMax(input, min = 1, max = 99) {
        if (!input) return min;
        try {
            let value = parseInt(input.value, 10);
            if (isNaN(value)) value = min;
            value = Math.max(min, Math.min(max, value));
            const correctedValue = value.toString();
            if (input.value !== correctedValue) input.value = correctedValue;
            return value;
        } catch (error) {
            console.error('Error in enforceMinMax:', error);
            if (input) input.value = min.toString();
            return min;
        }
    }

    function gatherSettingsFromUI() {
        const settings = {
            ...currentSettings,
        };
        
        if (UI.enableToggle) settings.extensionEnabled = UI.enableToggle.checked;
        if (UI.buttonEnableToggle) settings.buttonSkipEnabled = UI.buttonEnableToggle.checked;
        if (UI.keyboardEnableToggle) settings.keyboardShortcutsEnabled = UI.keyboardEnableToggle.checked;
        if (UI.forwardSkipTime) settings.forwardSkipTime = enforceMinMax(UI.forwardSkipTime);
        if (UI.backwardSkipTime) settings.backwardSkipTime = enforceMinMax(UI.backwardSkipTime);
        if (UI.keyboardForward) settings.keyboardForward = enforceMinMax(UI.keyboardForward);
        if (UI.keyboardBackward) settings.keyboardBackward = enforceMinMax(UI.keyboardBackward);
        if (UI.seekInterval) settings.seekInterval = enforceMinMax(UI.seekInterval, 0, 2000);
        if (UI.controlsVisibleDuration) settings.controlsVisibleDuration = enforceMinMax(UI.controlsVisibleDuration, 0, 10000);
        if (UI.progressBarUpdateDelay) settings.progressBarUpdateDelay = enforceMinMax(UI.progressBarUpdateDelay, 0, 2000);
        if (UI.navigationInitDelay) settings.navigationInitDelay = enforceMinMax(UI.navigationInitDelay, 0, 5000);
        if (UI.ignoreBufferingToggle) settings.ignoreBufferingProtection = !UI.ignoreBufferingToggle.checked;
        if (UI.posRightBtn && UI.posLeftBtn) {
            settings.buttonPosition = UI.posRightBtn.classList.contains('active') ? 'right' : 'left';
        }

        if (UI.allInputRows) {
            UI.allInputRows.forEach(row => {
                const context = row.dataset.presetContext;
                if (!context) return;
                row.querySelectorAll('.preset-editor .custom-spinner-input').forEach(input => {
                    const settingKey = `${context}Preset${parseInt(input.dataset.presetIndex) + 1}Value`;
                    settings[settingKey] = enforceMinMax(input);
                });
            });
        }

        return settings;
    }

    async function saveAndApplySettings(settingsToSave, showToastNotification = false, toastMessage = '', toastType = 'success') {
        if (typeof chrome === "undefined" || !chrome.storage) {
            console.log("Demo mode: Settings updated locally only");
            currentSettings = settingsToSave;
            if (showToastNotification) showToast(toastMessage, toastType);
            return Promise.resolve();
        }
        
        return safeAsyncOperation(async () => {
            currentSettings = settingsToSave;
            await chrome.storage.local.set(currentSettings);
            
            if (showToastNotification) showToast(toastMessage, toastType);

            if (chrome.tabs) {
                const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*', audible: true });
                tabs.forEach(tab => {
                    if (tab.id) {
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'updateSettings',
                            settings: currentSettings
                        }).catch(err => console.debug('Tab update failed:', err));
                    }
                });
            }
        }, 'Failed to save settings');
    }

    async function loadSettings() {
        if (typeof chrome === "undefined" || !chrome.storage) {
            console.log("Demo mode: Using fallback settings");
            currentSettings = { ...DEMO_SETTINGS };
            renderUI(currentSettings);
            return;
        }
        
        return safeAsyncOperation(async () => {
            currentSettings = await chrome.storage.local.get(null);
            renderUI(currentSettings);
        }, 'Failed to load settings');
    }

    function initializeSpinner(container) {
        const input = container.querySelector('.custom-spinner-input');
        const upBtn = container.querySelector('.spinner-btn-up');
        const downBtn = container.querySelector('.spinner-btn-down');
        
        if (!input || !upBtn || !downBtn) return;
        
        let intervalId = null, timeoutId = null;
        const startChanging = (direction) => {
            stopChanging(false);
            direction === 'up' ? input.stepUp() : input.stepDown();
            input.dispatchEvent(new Event('input', { bubbles: true }));
            timeoutId = setTimeout(() => {
                intervalId = setInterval(() => {
                    direction === 'up' ? input.stepUp() : input.stepDown();
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }, 100);
            }, 500);
        };
        const stopChanging = (shouldSave) => {
            clearTimeout(timeoutId);
            clearInterval(intervalId);
            if (shouldSave) input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        ['mouseup', 'mouseleave'].forEach(evt => {
            upBtn.addEventListener(evt, () => stopChanging(evt === 'mouseup'));
            downBtn.addEventListener(evt, () => stopChanging(evt === 'mouseup'));
        });
        upBtn.addEventListener('mousedown', () => startChanging('up'));
        downBtn.addEventListener('mousedown', () => startChanging('down'));
    }

    function resetCardEditState(cardElement) {
        if (!cardElement) return;
        cardElement.querySelectorAll('.input-row.is-editing-presets').forEach(row => {
            togglePresetEditMode(row);
        });
        if (cardElement.id === 'keyboard-skip-card' && cardElement.classList.contains('is-editing-hotkeys')) {
            toggleHotkeyEditMode();
        }
    }

    function togglePresetEditMode(inputRowElement) {
        const editButton = inputRowElement.querySelector('.btn-edit-presets');
        if (!editButton) return;
        const iconEdit = editButton.querySelector('.icon-edit');
        const iconSave = editButton.querySelector('.icon-save');
        const isEditing = inputRowElement.classList.toggle('is-editing-presets');

        editButton.setAttribute('aria-label', `${isEditing ? 'Save' : 'Edit'} Presets`);
        if (iconEdit) iconEdit.style.display = isEditing ? 'none' : '';
        if (iconSave) iconSave.style.display = isEditing ? '' : 'none';

        if (!isEditing) {
            const newSettings = gatherSettingsFromUI();
            saveAndApplySettings(newSettings, true, 'Presets Saved');
            updatePresetUI();
        }
    }

    function toggleHotkeyEditMode() {
        if (!UI.keyboardSkipCard || !UI.hotkeyEditButton) return;
        const isEditing = UI.keyboardSkipCard.classList.toggle('is-editing-hotkeys');
        const iconEdit = UI.hotkeyEditButton.querySelector('.icon-edit');
        const iconSave = UI.hotkeyEditButton.querySelector('.icon-check');
        UI.hotkeyEditButton.setAttribute('aria-label', `${isEditing ? 'Save' : 'Edit'} Hotkeys`);
        if (iconEdit) iconEdit.style.display = isEditing ? 'none' : '';
        if (iconSave) iconSave.style.display = isEditing ? '' : 'none';
    }

    function handleHotkeyListen(button, settingKey) {
        if (!button) return;
        
        const originalText = formatKeyForDisplay(currentSettings[settingKey]);
        const otherSettingKey = settingKey === 'keyboardForwardKey' ? 'keyboardBackwardKey' : 'keyboardForwardKey';

        document.querySelectorAll('.btn-hotkey.is-listening').forEach(btn => {
            if (btn !== button) {
                btn.classList.remove('is-listening');
                const keyToRestore = btn.id === 'keyboardForwardKey' ? currentSettings.keyboardForwardKey : currentSettings.keyboardBackwardKey;
                btn.textContent = formatKeyForDisplay(keyToRestore);
            }
        });

        button.classList.add('is-listening');
        button.textContent = 'Press key...';

        const cleanup = (shouldRevert) => {
            window.removeEventListener('keydown', keydownHandler, true);
            document.body.removeEventListener('click', clickAwayHandler, true);
            window.removeEventListener('blur', blurAwayHandler);
            button.classList.remove('is-listening');
            if (shouldRevert) button.textContent = originalText;
        };
        
        const blockedKeys = ['Control', 'Alt', 'Shift', 'Meta', 'CapsLock', 'Tab', 'Escape'];

        const keydownHandler = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const newKey = event.key;

            if (newKey === currentSettings[otherSettingKey]) {
                showToast('Key Already in Use', 'error');
            } else if (blockedKeys.includes(newKey)) {
                showToast('This key is reserved', 'error');
            } else {
                button.textContent = formatKeyForDisplay(newKey);
                const newSettings = gatherSettingsFromUI();
                newSettings[settingKey] = newKey;
                saveAndApplySettings(newSettings, true, 'Hotkey Saved');
                cleanup(false);
                return;
            }
            cleanup(true);
        };

        const clickAwayHandler = (e) => { if (e.target !== button) cleanup(true); };
        const blurAwayHandler = () => cleanup(true);

        window.addEventListener('keydown', keydownHandler, { once: true, capture: true });
        document.body.addEventListener('click', clickAwayHandler, { once: true, capture: true });
        window.addEventListener('blur', blurAwayHandler, { once: true });
    }

    async function fetchDefaults() {
        if (typeof chrome === "undefined" || !chrome.storage || !chrome.runtime) {
            console.log("Demo mode: Using fallback defaults");
            return { ...DEMO_SETTINGS };
        }
        
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getDefaultSettings' });
            if (response.success) {
                return response.settings;
            }
        } catch (e) {
            console.error("Failed to fetch default settings from background.", e);
        }
        return null;
    }
    
    function handleSettingChange(event) {
        const target = event.target;
        
        updateStatusUI();
    
        const toastMessage = target.dataset.toastMessage;
        const cardToResetSelector = target.dataset.cardToReset;
        const cardToReset = cardToResetSelector ? document.getElementById(cardToResetSelector) : null;
    
        let toastText = toastMessage;
        let showToastNotification = false;
    
        if (target.type === 'checkbox') {
            const isEnabled = target.checked;
            toastText = `${toastMessage} ${isEnabled ? 'Enabled' : 'Disabled'}`;
            showToastNotification = true;
            if (!isEnabled && cardToReset) {
                resetCardEditState(cardToReset);
            }
        }
    
        saveAndApplySettings(gatherSettingsFromUI(), showToastNotification, toastText, 'success');
    }

    function setupEventListeners() {
        function closeMoreTimingPanel() {
            if (UI.moreTimingSettings && UI.moreTimingSettings.classList.contains('visible')) {
                UI.moreTimingSettings.classList.remove('visible');
                if (UI.openMoreSettingsBtn) {
                    UI.openMoreSettingsBtn.classList.remove('open');
                    UI.openMoreSettingsBtn.setAttribute('aria-expanded', 'false');
                }
                localStorage.setItem('advancedSettingsOpen', 'false');
            }
        }
        
        if (UI.openSettingsBtn && UI.mainView && UI.settingsView) {
            UI.openSettingsBtn.addEventListener('click', () => {
                UI.mainView.classList.remove('active');
                UI.settingsView.classList.add('active');
                closeMoreTimingPanel();
            });
        }
        
        if (UI.closeSettingsBtn && UI.settingsView && UI.mainView) {
            UI.closeSettingsBtn.addEventListener('click', () => {
                UI.settingsView.classList.remove('active');
                UI.mainView.classList.add('active');
            });
        }
        
        if (UI.themeToggle && UI.body) {
            UI.themeToggle.addEventListener('click', async () => {
                const newTheme = UI.body.classList.contains('light-theme') ? 'dark' : 'light';
                applyTheme(newTheme);
                await safeAsyncOperation(async () => {
                    currentSettings.theme = newTheme;
                    if (typeof chrome !== "undefined" && chrome.storage) {
                        await chrome.storage.local.set({ theme: newTheme });
                    }
                }, "Error saving theme");
            });
        }

        [UI.enableToggle, UI.buttonEnableToggle, UI.keyboardEnableToggle, UI.ignoreBufferingToggle].forEach(toggle => {
            if (toggle) toggle.addEventListener('change', handleSettingChange);
        });
        
        document.querySelectorAll('.skip-time-input, .custom-spinner-input').forEach(input => {
             input.addEventListener('change', () => saveAndApplySettings(gatherSettingsFromUI()));
        });
        
        const handlePosClick = (activeBtn, inactiveBtn) => () => {
            if (!activeBtn || !inactiveBtn) return;
            if (activeBtn.classList.contains('active')) return;
            activeBtn.classList.add('active');
            inactiveBtn.classList.remove('active');
            saveAndApplySettings(gatherSettingsFromUI(), true, 'Button Position Saved');
        };
        if (UI.posLeftBtn && UI.posRightBtn) {
            UI.posLeftBtn.addEventListener('click', handlePosClick(UI.posLeftBtn, UI.posRightBtn));
            UI.posRightBtn.addEventListener('click', handlePosClick(UI.posRightBtn, UI.posLeftBtn));
        }

        if (UI.hotkeyEditButton) {
            UI.hotkeyEditButton.addEventListener('click', toggleHotkeyEditMode);
        }
        if (UI.keyboardForwardKey) {
            UI.keyboardForwardKey.addEventListener('click', () => handleHotkeyListen(UI.keyboardForwardKey, 'keyboardForwardKey'));
        }
        if (UI.keyboardBackwardKey) {
            UI.keyboardBackwardKey.addEventListener('click', () => handleHotkeyListen(UI.keyboardBackwardKey, 'keyboardBackwardKey'));
        }

        if (UI.editPresetButtons) {
            UI.editPresetButtons.forEach(button => button.addEventListener('click', (e) => togglePresetEditMode(e.target.closest('.input-row'))));
        }
        
        if (UI.presetButtonContainers) {
            UI.presetButtonContainers.forEach(container => {
                container.addEventListener('click', async (event) => {
                    if (!event.target.classList.contains('btn-preset')) return;
                    const button = event.target;
                    const targetInput = document.getElementById(container.dataset.target);
                    if (!targetInput) return;
                    const newValue = parseInt(button.dataset.value, 10);
                    if (parseInt(targetInput.value, 10) === newValue) {
                        showToast('Preset already selected', 'warning');
                        return;
                    }
                    targetInput.value = newValue;
                    flashElement(targetInput);
                    await saveAndApplySettings(gatherSettingsFromUI(), true, 'Skip Time Saved');
                });
            });
        }

        if (UI.resetSettings) {
            UI.resetSettings.addEventListener('click', async () => {
                const defaults = await fetchDefaults();
                if (!defaults) { return showToast('Could not fetch defaults to reset', 'error'); }
                const themeToKeep = currentSettings.theme || 'dark';
                const statsToKeep = Object.fromEntries(Object.entries(currentSettings).filter(([key]) => key.startsWith('stats_')));
                currentSettings = { ...defaults, theme: themeToKeep, ...statsToKeep };
                renderUI(currentSettings);
                await saveAndApplySettings(currentSettings);
                showToast('All Settings Reset (Excluding Stats)', 'warning');
            });
        }

        if (UI.resetStatsBtn) {
            UI.resetStatsBtn.addEventListener('click', async () => {
                Object.keys(currentSettings).filter(k => k.startsWith('stats_')).forEach(k => { currentSettings[k] = 0; });
                renderUI(currentSettings);
                await saveAndApplySettings(currentSettings);
                showToast('Statistics Reset', 'warning');
            });
        }

        if (UI.resetHotkeysBtn) {
            UI.resetHotkeysBtn.addEventListener('click', async () => {
                const defaults = await fetchDefaults();
                if (!defaults) { return showToast('Could not fetch defaults to reset', 'error'); }
                currentSettings.keyboardForwardKey = defaults.keyboardForwardKey;
                currentSettings.keyboardBackwardKey = defaults.keyboardBackwardKey;
                renderUI(currentSettings);
                await saveAndApplySettings(currentSettings);
                showToast('Hotkeys Reset', 'warning');
            });
        }

        if (UI.resetActionTiming) {
            UI.resetActionTiming.addEventListener('click', async () => {
                const defaults = await fetchDefaults();
                if (!defaults) { return showToast('Could not fetch defaults to reset', 'error'); }
                ['seekInterval', 'controlsVisibleDuration', 'ignoreBufferingProtection', 'progressBarUpdateDelay', 'navigationInitDelay']
                    .forEach(key => { currentSettings[key] = defaults[key]; });
                renderUI(currentSettings);
                await saveAndApplySettings(currentSettings);
                showToast('Action Timing Reset', 'warning');
            });
        }

        if (UI.resetPresetButtons) {
            UI.resetPresetButtons.forEach(button => {
                button.addEventListener('click', async (event) => {
                    const defaults = await fetchDefaults();
                    if (!defaults) { return showToast('Could not fetch defaults to reset', 'error'); }
                    const inputRow = event.target.closest('.input-row');
                    const context = inputRow?.dataset.presetContext;
                    if (!context) return;
                    
                    let settingsChanged = false;
                    for (let i = 1; i <= 4; i++) {
                        const settingKey = `${context}Preset${i}Value`;
                        if (currentSettings[settingKey] !== defaults[settingKey]) {
                            currentSettings[settingKey] = defaults[settingKey];
                            settingsChanged = true;
                        }
                    }

                    if (settingsChanged) {
                        renderUI(currentSettings);
                        await saveAndApplySettings(currentSettings);
                    }
                    showToast('Presets Reset', 'warning');
                });
            });
        }

        if (UI.openMoreSettingsBtn && UI.moreTimingSettings) {
            UI.openMoreSettingsBtn.addEventListener('click', () => {
                const isVisible = UI.moreTimingSettings.classList.toggle('visible');
                UI.openMoreSettingsBtn.classList.toggle('open', isVisible);
                UI.openMoreSettingsBtn.setAttribute('aria-expanded', isVisible);
                localStorage.setItem('advancedSettingsOpen', isVisible);
            });
        }

        document.addEventListener('mousedown', (evt) => {
            if (!UI.moreTimingSettings || !UI.moreTimingSettings.classList.contains('visible')) return;

            const inPanel = evt.target.closest('#moreTimingSettings');
            const inButton = evt.target.closest('#openMoreSettingsBtn');
            const onBackButton = evt.target.closest('#closeSettingsBtn');
            const inActionTimingCard = evt.target.closest('.settings-card') === UI.actionTimingCard;
            
            // Only close if clicking on another settings card (not action timing card)
            const clickedCard = evt.target.closest('.settings-card');
            if (!inPanel && !inButton && !onBackButton && !inActionTimingCard && clickedCard) {
                closeMoreTimingPanel();
            }
        }, { passive: true });
    }
    
    function applyTheme(theme) {
        const isLight = theme === 'light';
        
        if (UI.html) {
            UI.html.classList.toggle('light-theme', isLight);
            UI.html.classList.toggle('light-theme-html-override', isLight);
        }
        if (UI.body) {
            UI.body.classList.toggle('light-theme', isLight);
        }
        
        if (UI.themeToggle) {
            const sunSvg = UI.themeToggle.querySelector('svg use[href="#icon-sun"]')?.closest('svg');
            const moonSvg = UI.themeToggle.querySelector('svg use[href="#icon-moon"]')?.closest('svg');
            if (sunSvg) sunSvg.style.display = isLight ? 'none' : 'inline-block';
            if (moonSvg) moonSvg.style.display = isLight ? 'inline-block' : 'none';
        }
    }

    async function loadInitialState() {
        document.querySelectorAll('.custom-spinner-container').forEach(initializeSpinner);

        try {
            if (typeof chrome !== "undefined" && chrome.storage) {
                const data = await chrome.storage.local.get('theme');
                applyTheme(data.theme || 'dark');
            } else {
                 applyTheme('dark');
            }
        } catch (error) {
            console.error("Error loading theme setting:", error);
            applyTheme('dark');
        }
        
        const advancedSettingsOpen = localStorage.getItem('advancedSettingsOpen') === 'true';
        if (advancedSettingsOpen && UI.moreTimingSettings && UI.openMoreSettingsBtn) {
            UI.moreTimingSettings.classList.add('visible');
            UI.openMoreSettingsBtn.classList.add('open');
            UI.openMoreSettingsBtn.setAttribute('aria-expanded', 'true');
        }

        try {
            const warning = document.querySelector('#moreTimingSettings .card-warning-message');
            if (warning) {
                warning.innerHTML = ''
                  + '<svg class="feather"><use href="#icon-alert-triangle"></use></svg>'
                  + '<div class="warning-text-content">'
                  + '<strong>⚠️ Experimental & Advanced Settings</strong>'
                  + '<p>These options are intended for power users. Changing them can impact player performance, compatibility, or battery life. If the player behaves unexpectedly, tap <em>Reset to Defaults</em>.</p>'
                  + '</div>';
            }
        } catch(e) {
            console.error('Error updating warning message:', e);
        }

        await loadSettings();
        setupEventListeners();
    }
    
    loadInitialState();
});

(function(){
  function launchConfettiBurst(originEl){
    if (!originEl) return;
    
    try {
      const rect = originEl.getBoundingClientRect();
      const originX = rect.left + rect.width/2;
      const originY = rect.top + rect.height/2;

      const count = 24;
      for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.className = 'confetti-piece';
        const size = 4 + Math.random() * 6;
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        el.style.backgroundColor = `hsl(${Math.floor(Math.random()*360)}, 80%, 60%)`;
        el.style.transform = `translate(${originX}px, ${originY}px)`;
        document.body.appendChild(el);

        const angle = Math.random() * Math.PI * 2;
        const velocity = 120 + Math.random()*180;
        const dx = Math.cos(angle) * velocity;
        const dy = Math.sin(angle) * velocity;

        const duration = 900 + Math.random()*700;
        const keyframes = [
          { transform: `translate(${originX}px, ${originY}px) scale(1)`, opacity: 1 },
          { transform: `translate(${originX + dx}px, ${originY + dy}px) scale(0.9)`, opacity: 0 }
        ];
        el.animate(keyframes, { duration, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
        setTimeout(() => el.remove(), duration + 60);
      }
    } catch(e) {
      console.error('Confetti error:', e);
    }
  }

  function hookLoveHeart(){
    const heart = document.getElementById('love-heart') || document.querySelector('.heart-icon');
    if (!heart) return;
    if (heart.__confettiBound) return;
    heart.__confettiBound = true;
    heart.style.cursor = heart.style.cursor || 'pointer';
    heart.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        launchConfettiBurst(heart);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookLoveHeart, { once: true });
  } else {
    hookLoveHeart();
  }
})();