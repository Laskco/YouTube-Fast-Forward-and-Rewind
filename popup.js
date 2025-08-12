if (typeof browser === "undefined") {
    var browser = chrome;
}

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

function applyTheme(theme, bodyElement, themeToggleButton) {
    const isLight = theme === 'light';
    bodyElement.classList.toggle('light-theme', isLight);
    if (themeToggleButton) {
        const sunSvg = themeToggleButton.querySelector('svg use[href="#icon-sun"]').closest('svg');
        const moonSvg = themeToggleButton.querySelector('svg use[href="#icon-moon"]').closest('svg');
        if (sunSvg) sunSvg.style.display = isLight ? 'none' : 'inline-block';
        if (moonSvg) moonSvg.style.display = isLight ? 'inline-block' : 'none';
    }
}

async function loadInitialTheme(bodyElement, themeToggleButton) {
    try {
        const data = await browser.storage.local.get('theme');
        applyTheme(data.theme || 'dark', bodyElement, themeToggleButton);
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
    const resetButton = document.getElementById('resetSettings');

    const toggle = document.getElementById('enableToggle');
    const keyboardToggle = document.getElementById('keyboardEnableToggle');
    const buttonToggle = document.getElementById('buttonEnableToggle');
    const actionTimingEnabledToggle = document.getElementById('actionTimingEnabledToggle');
    const ignoreBufferingToggle = document.getElementById('ignoreBufferingToggle');

    const statusText = document.getElementById('extensionStatusText');
    const keyboardStatusLabel = document.getElementById('keyboardStatusLabel');
    const buttonStatusLabel = document.getElementById('buttonStatusLabel');
    const actionTimingStatusLabel = document.getElementById('actionTimingStatusLabel');
    const ignoreBufferingStatusLabel = document.getElementById('ignoreBufferingStatusLabel');

    const keyboardCard = document.getElementById('keyboard-skip-card');
    const buttonSkipCard = document.getElementById('button-skip-card');
    const actionTimingCard = document.getElementById('action-timing-card');

    const forwardTimeInput = document.getElementById('forwardSkipTime');
    const backwardTimeInput = document.getElementById('backwardSkipTime');
    const keyboardForwardInput = document.getElementById('keyboardForward');
    const keyboardBackwardInput = document.getElementById('keyboardBackward');

    const keyboardForwardKeyBtn = document.getElementById('keyboardForwardKey');
    const keyboardBackwardKeyBtn = document.getElementById('keyboardBackwardKey');
    const hotkeyEditButton = document.getElementById('hotkeyEditButton');
    const resetHotkeysBtn = document.getElementById('resetHotkeysBtn');

    const editPresetButtons = document.querySelectorAll('.btn-edit-presets');
    const resetPresetButtons = document.querySelectorAll('.btn-reset-presets');
    const presetButtonContainers = document.querySelectorAll('.preset-buttons');
    const allInputRows = document.querySelectorAll('.input-row');

    const actionDelayInput = document.getElementById('actionDelay');
    const seekThrottleInput = document.getElementById('seekThrottle');
    const seekIntervalInput = document.getElementById('seekInterval');
    const controlsVisibleDurationInput = document.getElementById('controlsVisibleDuration');
    const resetActionTimingBtn = document.getElementById('resetActionTiming');
    const openMoreSettingsBtn = document.getElementById('openMoreSettingsBtn');
    const moreTimingSettingsPanel = document.getElementById('moreTimingSettings');

    const posLeftBtn = document.getElementById('pos-left-btn');
    const posRightBtn = document.getElementById('pos-right-btn');

    const statsTotalTime = document.getElementById('statsTotalTime');
    const statsFormattedTime = document.getElementById('statsFormattedTime');
    const statsTotalSkips = document.getElementById('statsTotalSkips');
    const statsButtonSkips = document.getElementById('statsButtonSkips');
    const statsKeyboardSkips = document.getElementById('statsKeyboardSkips');
    const resetStatsBtn = document.getElementById('resetStatsBtn');

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

    function applyStatsToUI(settings) {
        const totalSeconds = settings.stats_totalSecondsSkipped || 0;
        if (statsTotalTime) statsTotalTime.textContent = `${totalSeconds}s`;
        if (statsFormattedTime) statsFormattedTime.textContent = formatTime(totalSeconds);
        if (statsTotalSkips) statsTotalSkips.textContent = settings.stats_totalSkips || 0;
        if (statsButtonSkips) statsButtonSkips.textContent = settings.stats_buttonSkips || 0;
        if (statsKeyboardSkips) statsKeyboardSkips.textContent = settings.stats_keyboardSkips || 0;
    }

    function updateStatusUI() {
        const isEnabled = toggle.checked;
        if (buttonSkipCard) buttonSkipCard.classList.toggle('is-disabled', !isEnabled || !buttonToggle.checked);
        if (keyboardCard) keyboardCard.classList.toggle('is-disabled', !isEnabled || !keyboardToggle.checked);
        if (actionTimingCard) actionTimingCard.classList.toggle('is-disabled', !isEnabled);
        if (statusText) {
            statusText.textContent = isEnabled ? 'Extension Enabled' : 'Extension Disabled';
            statusText.classList.toggle('enabled', isEnabled);
            statusText.classList.toggle('disabled', !isEnabled);
        }
        const updateLabel = (label, isChecked, text) => {
            if (!label) return;
            const iconUse = label.querySelector('svg use');
            const textNode = label.childNodes[2];
            if (iconUse && textNode) {
                textNode.nodeValue = ` ${text} ${isChecked ? 'Enabled' : 'Disabled'}`;
                iconUse.setAttribute('href', isChecked ? '#icon-toggle-right' : '#icon-toggle-left');
            }
        };
        updateLabel(buttonStatusLabel, buttonToggle.checked, 'Button Skip Times');
        updateLabel(keyboardStatusLabel, keyboardToggle.checked, 'Keyboard Shortcuts');
        updateLabel(actionTimingStatusLabel, actionTimingEnabledToggle.checked, 'Action Delay');
        updateLabel(ignoreBufferingStatusLabel, ignoreBufferingToggle.checked, 'Buffering Protection');
    }

    function updatePresetUI() {
        allInputRows.forEach(row => {
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

    function applySettingsToUI(settings) {
        try {
            if (toggle) toggle.checked = settings.extensionEnabled;
            if (buttonToggle) buttonToggle.checked = settings.buttonSkipEnabled;
            if (keyboardToggle) keyboardToggle.checked = settings.keyboardShortcutsEnabled;
            if (actionTimingEnabledToggle) actionTimingEnabledToggle.checked = settings.actionTimingEnabled;
            if (ignoreBufferingToggle) ignoreBufferingToggle.checked = !settings.ignoreBufferingProtection;

            if (forwardTimeInput) forwardTimeInput.value = enforceMinMax({ value: settings.forwardSkipTime });
            if (backwardTimeInput) backwardTimeInput.value = enforceMinMax({ value: settings.backwardSkipTime });
            if (keyboardForwardInput) keyboardForwardInput.value = enforceMinMax({ value: settings.keyboardForward });
            if (keyboardBackwardInput) keyboardBackwardInput.value = enforceMinMax({ value: settings.keyboardBackward });

            if (actionDelayInput) actionDelayInput.value = enforceMinMax({ value: settings.actionDelay }, 0, 2000);
            if (seekThrottleInput) seekThrottleInput.value = enforceMinMax({ value: settings.seekThrottle }, 0, 2000);
            if (seekIntervalInput) seekIntervalInput.value = enforceMinMax({ value: settings.seekInterval }, 0, 2000);
            if (controlsVisibleDurationInput) controlsVisibleDurationInput.value = enforceMinMax({ value: settings.controlsVisibleDuration }, 0, 10000);

            if (keyboardForwardKeyBtn) keyboardForwardKeyBtn.textContent = formatKeyForDisplay(settings.keyboardForwardKey);
            if (keyboardBackwardKeyBtn) keyboardBackwardKeyBtn.textContent = formatKeyForDisplay(settings.keyboardBackwardKey);

            if (posLeftBtn && posRightBtn) {
                const isRight = settings.buttonPosition === 'right';
                posRightBtn.classList.toggle('active', isRight);
                posLeftBtn.classList.toggle('active', !isRight);
            }

            updateStatusUI();
            updatePresetUI();
            applyStatsToUI(settings);
        } catch (error) {
            console.error('Error applying settings to UI:', error);
            showToast('Error loading settings', 'error');
        }
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
            extensionEnabled: toggle.checked,
            buttonSkipEnabled: buttonToggle.checked,
            keyboardShortcutsEnabled: keyboardToggle.checked,
            forwardSkipTime: enforceMinMax(forwardTimeInput),
            backwardSkipTime: enforceMinMax(backwardTimeInput),
            keyboardForward: enforceMinMax(keyboardForwardInput),
            keyboardBackward: enforceMinMax(keyboardBackwardInput),
            actionTimingEnabled: actionTimingEnabledToggle.checked,
            actionDelay: enforceMinMax(actionDelayInput, 0, 2000),
            seekThrottle: enforceMinMax(seekThrottleInput, 0, 2000),
            seekInterval: enforceMinMax(seekIntervalInput, 0, 2000),
            controlsVisibleDuration: enforceMinMax(controlsVisibleDurationInput, 0, 10000),
            ignoreBufferingProtection: !ignoreBufferingToggle.checked,
            buttonPosition: posRightBtn.classList.contains('active') ? 'right' : 'left',
        };

        allInputRows.forEach(row => {
            const context = row.dataset.presetContext;
            if (!context) return;
            row.querySelectorAll('.preset-editor .custom-spinner-input').forEach(input => {
                const settingKey = `${context}Preset${parseInt(input.dataset.presetIndex) + 1}Value`;
                settings[settingKey] = enforceMinMax(input);
            });
        });

        return settings;
    }

    async function saveAndApplySettings(settingsToSave, showToastNotification = false, toastMessage = '', toastType = 'success') {
        return safeAsyncOperation(async () => {
            currentSettings = settingsToSave;
            await browser.storage.local.set(currentSettings);
            
            if (showToastNotification) showToast(toastMessage, toastType);

            if (browser.tabs) {
                const tabs = await browser.tabs.query({ url: '*://*.youtube.com/*' });
                tabs.forEach(tab => {
                    if (tab.id) {
                        browser.tabs.sendMessage(tab.id, {
                            action: 'updateSettings',
                            settings: currentSettings
                        }).catch(err => console.debug('Tab update failed:', err));
                    }
                });
            }
        }, 'Failed to save settings');
    }

    async function loadSettings() {
        return safeAsyncOperation(async () => {
            currentSettings = await browser.storage.local.get(null);
            applySettingsToUI(currentSettings);
        }, 'Failed to load settings');
    }

    function initializeSpinner(container) {
        const input = container.querySelector('.custom-spinner-input');
        const upBtn = container.querySelector('.spinner-btn-up');
        const downBtn = container.querySelector('.spinner-btn-down');
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
        if (!keyboardCard || !hotkeyEditButton) return;
        const isEditing = keyboardCard.classList.toggle('is-editing-hotkeys');
        const iconEdit = hotkeyEditButton.querySelector('.icon-edit');
        const iconSave = hotkeyEditButton.querySelector('.icon-check');
        hotkeyEditButton.setAttribute('aria-label', `${isEditing ? 'Save' : 'Edit'} Hotkeys`);
        if (iconEdit) iconEdit.style.display = isEditing ? 'none' : '';
        if (iconSave) iconSave.style.display = isEditing ? '' : 'none';
    }

    function handleHotkeyListen(button, settingKey) {
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
        try {
            const response = await browser.runtime.sendMessage({ action: 'getDefaultSettings' });
            if (response.success) {
                return response.settings;
            }
        } catch (e) {
            console.error("Failed to fetch default settings from background.", e);
        }
        return null;
    }

    function setupEventListeners() {
        const addClickListener = (element, handler) => { if (element) element.addEventListener('click', handler); };
        const addChangeListener = (element, handler) => { if (element) element.addEventListener('change', handler); };

        addClickListener(openSettingsBtn, () => { mainView.classList.remove('active'); settingsView.classList.add('active'); });
        addClickListener(closeSettingsBtn, () => { settingsView.classList.remove('active'); mainView.classList.add('active'); });
        addClickListener(themeToggleButton, async () => {
            const newTheme = bodyElement.classList.contains('light-theme') ? 'dark' : 'light';
            applyTheme(newTheme, bodyElement, themeToggleButton);
            await safeAsyncOperation(async () => {
                currentSettings.theme = newTheme;
                await browser.storage.local.set({ theme: newTheme });
            }, "Error saving theme");
        });

        const createChangeHandler = (toastMessage, cardToReset) => (event) => {
            const settings = gatherSettingsFromUI();
            updateStatusUI();
            let toastText = toastMessage;
            let showToastNotification = false;
            if (event.target.type === 'checkbox') {
                const isEnabled = event.target.checked;
                toastText = `${toastMessage} ${isEnabled ? 'Enabled' : 'Disabled'}`;
                showToastNotification = true;
                if (!isEnabled && cardToReset) resetCardEditState(cardToReset);
            }
            saveAndApplySettings(settings, showToastNotification, toastText, 'success');
        };
        
        addChangeListener(toggle, createChangeHandler("Extension"));
        addChangeListener(buttonToggle, createChangeHandler("Button Skips", buttonSkipCard));
        addChangeListener(keyboardToggle, createChangeHandler("Keyboard Shortcuts", keyboardCard));
        addChangeListener(actionTimingEnabledToggle, createChangeHandler("Action Delay", actionTimingCard));
        addChangeListener(ignoreBufferingToggle, createChangeHandler("Buffering Protection", actionTimingCard));
        
        document.querySelectorAll('.skip-time-input, #actionDelay, #seekThrottle, #seekInterval, #controlsVisibleDuration').forEach(input => {
            input.addEventListener('change', () => saveAndApplySettings(gatherSettingsFromUI()));
        });
        
        const handlePosClick = (activeBtn, inactiveBtn) => () => {
            if (activeBtn.classList.contains('active')) return;
            activeBtn.classList.add('active');
            inactiveBtn.classList.remove('active');
            saveAndApplySettings(gatherSettingsFromUI(), true, 'Button Position Saved');
        };
        addClickListener(posLeftBtn, handlePosClick(posLeftBtn, posRightBtn));
        addClickListener(posRightBtn, handlePosClick(posRightBtn, posLeftBtn));

        addClickListener(hotkeyEditButton, toggleHotkeyEditMode);
        addClickListener(keyboardForwardKeyBtn, () => handleHotkeyListen(keyboardForwardKeyBtn, 'keyboardForwardKey'));
        addClickListener(keyboardBackwardKeyBtn, () => handleHotkeyListen(keyboardBackwardKeyBtn, 'keyboardBackwardKey'));

        editPresetButtons.forEach(button => addClickListener(button, (e) => togglePresetEditMode(e.target.closest('.input-row'))));
        
        presetButtonContainers.forEach(container => {
            addClickListener(container, async (event) => {
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
                await saveAndApplySettings(gatherSettingsFromUI(), true, 'Skip Time Saved');
            });
        });

        addClickListener(resetButton, async () => {
            const defaults = await fetchDefaults();
            if (!defaults) { return showToast('Could not fetch defaults to reset', 'error'); }
            const themeToKeep = currentSettings.theme || 'dark';
            const statsToKeep = Object.fromEntries(Object.entries(currentSettings).filter(([key]) => key.startsWith('stats_')));
            currentSettings = { ...defaults, theme: themeToKeep, ...statsToKeep };
            applySettingsToUI(currentSettings);
            await saveAndApplySettings(currentSettings);
            showToast('All Settings Reset (Excluding Stats)', 'warning');
        });

        addClickListener(resetStatsBtn, async () => {
            Object.keys(currentSettings).filter(k => k.startsWith('stats_')).forEach(k => { currentSettings[k] = 0; });
            applySettingsToUI(currentSettings);
            await saveAndApplySettings(currentSettings);
            showToast('Statistics Reset', 'warning');
        });

        addClickListener(resetHotkeysBtn, async () => {
            const defaults = await fetchDefaults();
            if (!defaults) { return showToast('Could not fetch defaults to reset', 'error'); }
            currentSettings.keyboardForwardKey = defaults.keyboardForwardKey;
            currentSettings.keyboardBackwardKey = defaults.keyboardBackwardKey;
            applySettingsToUI(currentSettings);
            await saveAndApplySettings(currentSettings);
            showToast('Hotkeys Reset', 'warning');
        });

        addClickListener(resetActionTimingBtn, async () => {
            const defaults = await fetchDefaults();
            if (!defaults) { return showToast('Could not fetch defaults to reset', 'error'); }
            ['actionTimingEnabled', 'actionDelay', 'seekThrottle', 'seekInterval', 'controlsVisibleDuration', 'ignoreBufferingProtection']
                .forEach(key => { currentSettings[key] = defaults[key]; });
            applySettingsToUI(currentSettings);
            await saveAndApplySettings(currentSettings);
            showToast('Action Timing Reset', 'warning');
        });

        resetPresetButtons.forEach(button => {
            addClickListener(button, async (event) => {
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
                    applySettingsToUI(currentSettings);
                    await saveAndApplySettings(currentSettings);
                }
                showToast('Presets Reset', 'warning');
            });
        });

        addClickListener(openMoreSettingsBtn, () => {
            const isVisible = moreTimingSettingsPanel.classList.toggle('visible');
            openMoreSettingsBtn.classList.toggle('open', isVisible);
            openMoreSettingsBtn.setAttribute('aria-expanded', isVisible);
        });
    }

    document.querySelectorAll('.custom-spinner-container').forEach(initializeSpinner);
    await loadInitialTheme(bodyElement, themeToggleButton);
    await loadSettings();
    setupEventListeners();
});