'use strict';

// ─── Demo / fallback data ─────────────────────────────────────────────────────

const DEMO_SETTINGS = {
    extensionEnabled: true, buttonSkipEnabled: true, keyboardShortcutsEnabled: true,
    forwardSkipTime: 10, backwardSkipTime: 10, keyboardForward: 5, keyboardBackward: 5,
    keyboardForwardKey: 'ArrowRight', keyboardBackwardKey: 'ArrowLeft',
    controlsVisibleDuration: 2500, seekInterval: 150, progressBarUpdateDelay: 150,
    navigationInitDelay: 250, buttonPosition: 'left', ignoreBufferingProtection: false,
    btnFwdPreset1Value: 5, btnFwdPreset2Value: 10, btnFwdPreset3Value: 15, btnFwdPreset4Value: 30,
    btnBwdPreset1Value: 5, btnBwdPreset2Value: 10, btnBwdPreset3Value: 15, btnBwdPreset4Value: 30,
    kbdFwdPreset1Value: 5, kbdFwdPreset2Value: 10, kbdFwdPreset3Value: 15, kbdFwdPreset4Value: 30,
    kbdBwdPreset1Value: 5, kbdBwdPreset2Value: 10, kbdBwdPreset3Value: 15, kbdBwdPreset4Value: 30,
    theme: 'dark',
    stats_totalSecondsSkipped: 0, stats_totalSkips: 0, stats_buttonSkips: 0, stats_keyboardSkips: 0,
};

const IS_EXTENSION = typeof chrome !== 'undefined' && !!chrome?.storage;

// ─── Storage helpers ──────────────────────────────────────────────────────────

const Storage = {
    async get()   { return IS_EXTENSION ? chrome.storage.local.get(null) : { ...DEMO_SETTINGS }; },
    async set(s)  { if (IS_EXTENSION) await chrome.storage.local.set(s); },
    async defaults() {
        if (!IS_EXTENSION) return { ...DEMO_SETTINGS };
        const r = await chrome.runtime.sendMessage({ action: 'getDefaultSettings' });
        return r?.ok ? r.settings : null;
    },
};

// ─── Chrome tab broadcasting ──────────────────────────────────────────────────

async function broadcastToYouTube(settings) {
    if (!IS_EXTENSION || !chrome.tabs) return;
    try {
        const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*', audible: true });
        for (const tab of tabs) {
            if (tab.id) {
                chrome.tabs.sendMessage(tab.id, { action: 'updateSettings', settings })
                    .catch(() => {}); // tab may not have the content script
            }
        }
    } catch (_) {}
}

// ─── Toast ────────────────────────────────────────────────────────────────────

const Toast = (() => {
    let timer = null;
    const el  = () => document.getElementById('toast-notification');
    const ICONS = { success: 'icon-check-circle', error: 'icon-x-circle', warning: 'icon-alert-triangle' };

    return {
        show(message, type = 'success', duration = 2500) {
            const root = el();
            if (!root) return;
            clearTimeout(timer);
            root.classList.remove('show', 'success', 'error', 'warning');

            root.querySelector('.toast-message').textContent = String(message).substring(0, 200);
            root.querySelector('.toast-icon use').setAttribute('href', `#${ICONS[type] ?? ICONS.success}`);

            requestAnimationFrame(() => root.classList.add(type, 'show'));
            timer = setTimeout(() => root.classList.remove('show'), duration);
        },
    };
})();

// ─── Number utilities ─────────────────────────────────────────────────────────

function clamp(value, min = 1, max = 99) {
    const n = parseInt(value, 10);
    return isNaN(n) ? min : Math.max(min, Math.min(max, n));
}

/** Read + enforce an <input type=number> min/max. Returns the clamped value. */
function enforceInput(input, min = 1, max = 99) {
    const val = clamp(input.value, min, max);
    input.value = val;
    return val;
}

function formatTime(secs) {
    if (!secs || secs <= 0) return '0s';
    secs = Math.round(secs);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return [h && `${h}h`, m && `${m}m`, (s || (!h && !m)) && `${s}s`].filter(Boolean).join(' ');
}

function formatKey(key) {
    if (!key) return '';
    return { ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', ' ': 'Space' }[key]
        ?? (key.length === 1 ? key.toUpperCase() : key);
}

function flashSpinner(input) {
    const c = input?.closest('.custom-spinner-container');
    if (!c) return;
    c.classList.add('flash-indicator');
    setTimeout(() => c.classList.remove('flash-indicator'), 500);
}

// ─── Spinner widget ───────────────────────────────────────────────────────────

function initSpinner(container) {
    const input = container.querySelector('.custom-spinner-input');
    const up    = container.querySelector('.spinner-btn-up');
    const down  = container.querySelector('.spinner-btn-down');
    if (!input || !up || !down) return;

    let repeatTimer = null, repeatInterval = null;

    const step = (dir) => {
        dir === 'up' ? input.stepUp() : input.stepDown();
        input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const startRepeat = (dir) => {
        stopRepeat(false);
        step(dir);
        repeatTimer = setTimeout(() => {
            repeatInterval = setInterval(() => step(dir), 100);
        }, 500);
    };
    const stopRepeat = (fire) => {
        clearTimeout(repeatTimer);
        clearInterval(repeatInterval);
        if (fire) input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    up.addEventListener('mousedown',  () => startRepeat('up'));
    down.addEventListener('mousedown', () => startRepeat('down'));
    ['mouseup', 'mouseleave'].forEach(evt => {
        up.addEventListener(evt,   () => stopRepeat(evt === 'mouseup'));
        down.addEventListener(evt, () => stopRepeat(evt === 'mouseup'));
    });
}

// ─── Theme ────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
    const light = theme === 'light';
    document.documentElement.classList.toggle('light-theme', light);
    document.documentElement.classList.toggle('light-theme-html-override', light);
    document.body.classList.toggle('light-theme', light);

    const sunSvg  = document.querySelector('#themeToggle svg:first-child');
    const moonSvg = document.querySelector('#themeToggle svg:last-child');
    if (sunSvg)  sunSvg.style.display  = light ? 'none' : 'inline-block';
    if (moonSvg) moonSvg.style.display = light ? 'inline-block' : 'none';
}

// ─── Main popup logic ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {

    // ── DOM refs ──────────────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);
    const $$ = (sel) => document.querySelectorAll(sel);

    const el = {
        // Views
        mainView:     $('main-view'),
        settingsView: $('settings-view'),
        openSettings: $('openSettingsBtn'),
        closeSettings: $('closeSettingsBtn'),

        // Header actions
        themeToggle:   $('themeToggle'),
        resetSettings: $('resetSettings'),

        // Core toggles
        enableToggle:   $('enableToggle'),
        btnToggle:      $('buttonEnableToggle'),
        kbdToggle:      $('keyboardEnableToggle'),
        bufToggle:      $('ignoreBufferingToggle'),

        // Status labels
        statusText:     $('extensionStatusText'),
        btnStatusLabel: $('buttonStatusLabel'),
        kbdStatusLabel: $('keyboardStatusLabel'),
        bufStatusLabel: $('ignoreBufferingStatusLabel'),

        // Cards (used for disabled state)
        btnCard: $('button-skip-card'),
        kbdCard: $('keyboard-skip-card'),
        timingCard: $('action-timing-card'),

        // Skip time inputs
        fwdTime: $('forwardSkipTime'),
        bwdTime: $('backwardSkipTime'),
        kbdFwd:  $('keyboardForward'),
        kbdBwd:  $('keyboardBackward'),

        // Hotkeys
        fwdKey: $('keyboardForwardKey'),
        bwdKey: $('keyboardBackwardKey'),
        hotkeyEditBtn: $('hotkeyEditButton'),
        resetHotkeys:  $('resetHotkeysBtn'),

        // Advanced timing
        seekInterval:        $('seekInterval'),
        controlsDuration:    $('controlsVisibleDuration'),
        progressDelay:       $('progressBarUpdateDelay'),
        navDelay:            $('navigationInitDelay'),
        resetTiming:         $('resetActionTiming'),
        moreTimingBtn:       $('openMoreSettingsBtn'),
        moreTimingPanel:     $('moreTimingSettings'),

        // Position
        posLeft:  $('pos-left-btn'),
        posRight: $('pos-right-btn'),

        // Stats
        statsTotalTime: $('statsTotalTime'),
        statsFormatted: $('statsFormattedTime'),
        statsTotalSkips: $('statsTotalSkips'),
        statsBtnSkips: $('statsButtonSkips'),
        statsKbdSkips: $('statsKeyboardSkips'),
        resetStats: $('resetStatsBtn'),

        // Preset groups
        allInputRows: $$('.input-row'),
    };

    let settings = {};

    // ── Gather settings from UI ───────────────────────────────────────────────
    function gather() {
        const s = { ...settings };

        s.extensionEnabled         = el.enableToggle.checked;
        s.buttonSkipEnabled        = el.btnToggle.checked;
        s.keyboardShortcutsEnabled = el.kbdToggle.checked;
        s.ignoreBufferingProtection = el.bufToggle ? !el.bufToggle.checked : false;

        s.forwardSkipTime  = enforceInput(el.fwdTime);
        s.backwardSkipTime = enforceInput(el.bwdTime);
        s.keyboardForward  = enforceInput(el.kbdFwd);
        s.keyboardBackward = enforceInput(el.kbdBwd);

        s.seekInterval             = enforceInput(el.seekInterval, 0, 2000);
        s.controlsVisibleDuration  = enforceInput(el.controlsDuration, 0, 10000);
        s.progressBarUpdateDelay   = enforceInput(el.progressDelay, 0, 2000);
        s.navigationInitDelay      = enforceInput(el.navDelay, 0, 5000);

        s.buttonPosition = el.posRight.classList.contains('active') ? 'right' : 'left';

        el.allInputRows.forEach(row => {
            const ctx = row.dataset.presetContext;
            if (!ctx) return;
            row.querySelectorAll('.preset-editor .custom-spinner-input').forEach(input => {
                const key = `${ctx}Preset${parseInt(input.dataset.presetIndex) + 1}Value`;
                s[key] = enforceInput(input);
            });
        });

        return s;
    }

    // ── Save + broadcast ──────────────────────────────────────────────────────
    async function save(overrides = {}, toastMsg = '', toastType = 'success') {
        Object.assign(settings, gather(), overrides);
        await Storage.set(settings);
        if (toastMsg) Toast.show(toastMsg, toastType);
        await broadcastToYouTube(settings);
    }

    // ── Render UI from settings object ────────────────────────────────────────
    function render(s) {
        el.enableToggle.checked = s.extensionEnabled;
        el.btnToggle.checked    = s.buttonSkipEnabled;
        el.kbdToggle.checked    = s.keyboardShortcutsEnabled;
        if (el.bufToggle) el.bufToggle.checked = !s.ignoreBufferingProtection;

        el.fwdTime.value = clamp(s.forwardSkipTime);
        el.bwdTime.value = clamp(s.backwardSkipTime);
        el.kbdFwd.value  = clamp(s.keyboardForward);
        el.kbdBwd.value  = clamp(s.keyboardBackward);

        el.seekInterval.value     = clamp(s.seekInterval, 0, 2000);
        el.controlsDuration.value = clamp(s.controlsVisibleDuration, 0, 10000);
        el.progressDelay.value    = clamp(s.progressBarUpdateDelay, 0, 2000);
        el.navDelay.value         = clamp(s.navigationInitDelay, 0, 5000);

        el.fwdKey.textContent = formatKey(s.keyboardForwardKey);
        el.bwdKey.textContent = formatKey(s.keyboardBackwardKey);

        const right = s.buttonPosition === 'right';
        el.posRight.classList.toggle('active', right);
        el.posLeft.classList.toggle('active', !right);

        renderPresets(s);
        renderStatus();
        renderStats(s);
    }

    function renderStatus() {
        const enabled = el.enableToggle.checked;

        el.btnCard?.classList.toggle('is-disabled',  !enabled || !el.btnToggle.checked);
        el.kbdCard?.classList.toggle('is-disabled',  !enabled || !el.kbdToggle.checked);
        el.timingCard?.classList.toggle('is-disabled', !enabled);

        el.statusText.textContent = enabled ? 'Extension Enabled' : 'Extension Disabled';
        el.statusText.classList.toggle('enabled',  enabled);
        el.statusText.classList.toggle('disabled', !enabled);

        updateToggleLabel(el.btnStatusLabel, el.btnToggle?.checked, 'Button Skip Times');
        updateToggleLabel(el.kbdStatusLabel, el.kbdToggle?.checked, 'Keyboard Shortcuts');
        if (el.bufToggle) updateToggleLabel(el.bufStatusLabel, !el.bufToggle.checked, 'Buffering Protection');
    }

    function updateToggleLabel(label, isOn, text) {
        if (!label) return;
        const use  = label.querySelector('svg use');
        const span = label.querySelector('span');
        if (use)  use.setAttribute('href', isOn ? '#icon-toggle-right' : '#icon-toggle-left');
        if (span) span.textContent = ` ${text} ${isOn ? 'Enabled' : 'Disabled'}`;
    }

    function renderPresets(s) {
        el.allInputRows.forEach(row => {
            const ctx = row.dataset.presetContext;
            if (!ctx) return;

            // Preset buttons
            row.querySelectorAll(`.preset-buttons .btn-preset`).forEach(btn => {
                const key = `${ctx}Preset${parseInt(btn.dataset.presetIndex) + 1}Value`;
                const val = clamp(s[key] ?? 10);
                btn.textContent  = `${val}s`;
                btn.dataset.value = val;
            });

            // Editor spinners
            row.querySelectorAll('.preset-editor .custom-spinner-input').forEach(input => {
                const key = `${ctx}Preset${parseInt(input.dataset.presetIndex) + 1}Value`;
                input.value = clamp(s[key] ?? 10);
            });
        });
    }

    function renderStats(s) {
        const secs = s.stats_totalSecondsSkipped || 0;
        if (el.statsTotalTime) el.statsTotalTime.textContent  = `${Math.round(secs)}s`;
        if (el.statsFormatted) el.statsFormatted.textContent  = formatTime(secs);
        if (el.statsTotalSkips) el.statsTotalSkips.textContent = s.stats_totalSkips || 0;
        if (el.statsBtnSkips) el.statsBtnSkips.textContent    = s.stats_buttonSkips || 0;
        if (el.statsKbdSkips) el.statsKbdSkips.textContent    = s.stats_keyboardSkips || 0;
    }

    // ── Preset edit mode ──────────────────────────────────────────────────────
    function togglePresetEdit(row) {
        const btn      = row.querySelector('.btn-edit-presets');
        if (!btn) return;
        const editing  = row.classList.toggle('is-editing-presets');
        const iconEdit = btn.querySelector('.icon-edit');
        const iconSave = btn.querySelector('.icon-save');
        btn.setAttribute('aria-label', editing ? 'Save Presets' : 'Edit Presets');
        if (iconEdit) iconEdit.style.display = editing ? 'none' : '';
        if (iconSave) iconSave.style.display = editing ? '' : 'none';
        if (!editing) {
            save({}, 'Presets Saved').then(() => renderPresets(settings));
        }
    }

    function closeAllPresetEditors(card) {
        card?.querySelectorAll('.input-row.is-editing-presets').forEach(row => togglePresetEdit(row));
    }

    // ── Hotkey edit mode ──────────────────────────────────────────────────────
    function toggleHotkeyEdit() {
        if (!el.kbdCard || !el.hotkeyEditBtn) return;
        const editing  = el.kbdCard.classList.toggle('is-editing-hotkeys');
        const iconEdit = el.hotkeyEditBtn.querySelector('.icon-edit');
        const iconSave = el.hotkeyEditBtn.querySelector('.icon-check');
        el.hotkeyEditBtn.setAttribute('aria-label', editing ? 'Save Hotkeys' : 'Edit Hotkeys');
        if (iconEdit) iconEdit.style.display = editing ? 'none' : '';
        if (iconSave) iconSave.style.display = editing ? '' : 'none';
    }

    function listenForHotkey(button, settingKey) {
        const otherKey  = settingKey === 'keyboardForwardKey' ? 'keyboardBackwardKey' : 'keyboardForwardKey';
        const original  = formatKey(settings[settingKey]);
        const BLOCKED   = new Set(['Control', 'Alt', 'Shift', 'Meta', 'CapsLock', 'Tab', 'Escape']);

        // Cancel any other active listener
        $$('.btn-hotkey.is-listening').forEach(b => {
            if (b !== button) {
                b.classList.remove('is-listening');
                const k = b.id === 'keyboardForwardKey' ? settings.keyboardForwardKey : settings.keyboardBackwardKey;
                b.textContent = formatKey(k);
            }
        });

        button.classList.add('is-listening');
        button.textContent = 'Press key...';

        const cleanup = (revert) => {
            window.removeEventListener('keydown', onKey, true);
            document.removeEventListener('click', onClickAway, true);
            window.removeEventListener('blur', onBlur);
            button.classList.remove('is-listening');
            if (revert) button.textContent = original;
        };

        const onKey = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const k = e.key;

            if (k === settings[otherKey])   { Toast.show('Key already in use', 'error');    cleanup(true);  return; }
            if (BLOCKED.has(k))             { Toast.show('Key is reserved', 'error');        cleanup(true);  return; }

            button.textContent = formatKey(k);
            save({ [settingKey]: k }, 'Hotkey Saved');
            cleanup(false);
        };

        const onClickAway = (e) => { if (e.target !== button) cleanup(true); };
        const onBlur      = ()  => cleanup(true);

        window.addEventListener('keydown',  onKey,        { once: true, capture: true });
        document.addEventListener('click',  onClickAway,  { once: true, capture: true });
        window.addEventListener('blur',     onBlur,       { once: true });
    }

    // ── Event wiring ──────────────────────────────────────────────────────────
    function setupListeners() {
        // View navigation
        el.openSettings?.addEventListener('click', () => {
            el.mainView.classList.remove('active');
            el.settingsView.classList.add('active');
            closeMoreTiming();
        });
        el.closeSettings?.addEventListener('click', () => {
            el.settingsView.classList.remove('active');
            el.mainView.classList.add('active');
        });

        // Theme
        el.themeToggle?.addEventListener('click', async () => {
            const newTheme = document.body.classList.contains('light-theme') ? 'dark' : 'light';
            applyTheme(newTheme);
            settings.theme = newTheme;
            await Storage.set({ theme: newTheme });
        });

        // Core toggles
        [el.enableToggle, el.btnToggle, el.kbdToggle, el.bufToggle].forEach(t => {
            t?.addEventListener('change', (e) => {
                renderStatus();
                const label = e.target.dataset.toastMessage;
                if (label) {
                    const on = e.target.checked;
                    // bufToggle: checked = protection ON = "Buffering Protection Enabled"
                    const msg = t === el.bufToggle
                        ? `Buffering Protection ${on ? 'Enabled' : 'Disabled'}`
                        : `${label} ${on ? 'Enabled' : 'Disabled'}`;
                    save({}, msg);
                } else {
                    save();
                }
                // Close editors when a card gets disabled
                const cardId = e.target.dataset.cardToReset;
                if (cardId && !e.target.checked) {
                    closeAllPresetEditors($(cardId));
                    if (cardId === 'keyboard-skip-card' && el.kbdCard.classList.contains('is-editing-hotkeys')) {
                        toggleHotkeyEdit();
                    }
                }
            });
        });

        // Skip time change
        $$('.skip-time-input').forEach(input => {
            input.addEventListener('change', () => save());
        });

        // Advanced timing inputs
        [el.seekInterval, el.controlsDuration, el.progressDelay, el.navDelay].forEach(input => {
            input?.addEventListener('change', () => save());
        });

        // Position buttons
        el.posLeft?.addEventListener('click', () => {
            if (el.posLeft.classList.contains('active')) return;
            el.posLeft.classList.add('active');
            el.posRight.classList.remove('active');
            save({}, 'Button Position Saved');
        });
        el.posRight?.addEventListener('click', () => {
            if (el.posRight.classList.contains('active')) return;
            el.posRight.classList.add('active');
            el.posLeft.classList.remove('active');
            save({}, 'Button Position Saved');
        });

        // Hotkeys
        el.hotkeyEditBtn?.addEventListener('click', toggleHotkeyEdit);
        el.fwdKey?.addEventListener('click', () => listenForHotkey(el.fwdKey, 'keyboardForwardKey'));
        el.bwdKey?.addEventListener('click', () => listenForHotkey(el.bwdKey, 'keyboardBackwardKey'));
        el.resetHotkeys?.addEventListener('click', async () => {
            const defs = await Storage.defaults();
            if (!defs) return Toast.show('Could not fetch defaults', 'error');
            settings.keyboardForwardKey  = defs.keyboardForwardKey;
            settings.keyboardBackwardKey = defs.keyboardBackwardKey;
            render(settings);
            await save({}, 'Hotkeys Reset', 'warning');
        });

        // Preset edit / save buttons
        $$('.btn-edit-presets').forEach(btn => {
            btn.addEventListener('click', () => togglePresetEdit(btn.closest('.input-row')));
        });

        // Preset quick-select buttons
        $$('.preset-buttons').forEach(container => {
            container.addEventListener('click', async (e) => {
                const btn = e.target.closest('.btn-preset');
                if (!btn) return;
                const target = $(container.dataset.target);
                if (!target) return;
                const val = parseInt(btn.dataset.value, 10);
                if (parseInt(target.value) === val) { Toast.show('Preset already active', 'warning'); return; }
                target.value = val;
                flashSpinner(target);
                await save({}, 'Skip Time Saved');
            });
        });

        // Preset reset buttons
        $$('.btn-reset-presets').forEach(btn => {
            btn.addEventListener('click', async () => {
                const defs = await Storage.defaults();
                if (!defs) return Toast.show('Could not fetch defaults', 'error');
                const ctx = btn.closest('.input-row')?.dataset.presetContext;
                if (!ctx) return;
                let changed = false;
                for (let i = 1; i <= 4; i++) {
                    const key = `${ctx}Preset${i}Value`;
                    if (settings[key] !== defs[key]) { settings[key] = defs[key]; changed = true; }
                }
                if (changed) { render(settings); await save({}, 'Presets Reset', 'warning'); }
                else Toast.show('Presets Reset', 'warning');
            });
        });

        // Reset all settings
        el.resetSettings?.addEventListener('click', async () => {
            const defs = await Storage.defaults();
            if (!defs) return Toast.show('Could not fetch defaults', 'error');
            const theme  = settings.theme || 'dark';
            const stats  = Object.fromEntries(Object.entries(settings).filter(([k]) => k.startsWith('stats_')));
            settings = { ...defs, theme, ...stats };
            render(settings);
            await save({}, 'All Settings Reset', 'warning');
        });

        // Reset stats
        el.resetStats?.addEventListener('click', async () => {
            ['stats_totalSecondsSkipped','stats_totalSkips','stats_buttonSkips','stats_keyboardSkips']
                .forEach(k => { settings[k] = 0; });
            render(settings);
            await save({}, 'Statistics Reset', 'warning');
        });

        // Reset action timing
        el.resetTiming?.addEventListener('click', async () => {
            const defs = await Storage.defaults();
            if (!defs) return Toast.show('Could not fetch defaults', 'error');
            ['seekInterval','controlsVisibleDuration','ignoreBufferingProtection','progressBarUpdateDelay','navigationInitDelay']
                .forEach(k => { settings[k] = defs[k]; });
            render(settings);
            await save({}, 'Action Timing Reset', 'warning');
        });

        // More timing panel
        function closeMoreTiming() {
            if (!el.moreTimingPanel?.classList.contains('visible')) return;
            el.moreTimingPanel.classList.remove('visible');
            el.moreTimingBtn?.classList.remove('open');
            el.moreTimingBtn?.setAttribute('aria-expanded', 'false');
            localStorage.setItem('advancedOpen', 'false');
        }

        el.moreTimingBtn?.addEventListener('click', () => {
            const open = el.moreTimingPanel.classList.toggle('visible');
            el.moreTimingBtn.classList.toggle('open', open);
            el.moreTimingBtn.setAttribute('aria-expanded', String(open));
            localStorage.setItem('advancedOpen', String(open));
        });

        // Close more-timing panel when clicking a different card
        document.addEventListener('mousedown', (e) => {
            if (!el.moreTimingPanel?.classList.contains('visible')) return;
            const inPanel   = e.target.closest('#moreTimingSettings');
            const inButton  = e.target.closest('#openMoreSettingsBtn');
            const inBack    = e.target.closest('#closeSettingsBtn');
            const thisCard  = e.target.closest('.settings-card') === el.timingCard;
            const otherCard = e.target.closest('.settings-card');
            if (!inPanel && !inButton && !inBack && !thisCard && otherCard) closeMoreTiming();
        }, { passive: true });

        // Restore advanced panel state
        if (localStorage.getItem('advancedOpen') === 'true') {
            el.moreTimingPanel?.classList.add('visible');
            el.moreTimingBtn?.classList.add('open');
            el.moreTimingBtn?.setAttribute('aria-expanded', 'true');
        }
    }

    // ── Bootstrap ─────────────────────────────────────────────────────────────
    $$('.custom-spinner-container').forEach(initSpinner);

    try {
        const { theme = 'dark' } = IS_EXTENSION ? await chrome.storage.local.get('theme') : {};
        applyTheme(theme);
    } catch (_) { applyTheme('dark'); }

    settings = await Storage.get();
    render(settings);
    setupListeners();
});

// ─── Confetti easter egg ──────────────────────────────────────────────────────

(function attachConfetti() {
    function burst(origin) {
        const rect = origin.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top  + rect.height / 2;

        for (let i = 0; i < 24; i++) {
            const el  = document.createElement('div');
            el.className = 'confetti-piece';
            const sz  = 4 + Math.random() * 6;
            el.style.cssText = `width:${sz}px;height:${sz}px;background:hsl(${Math.random()*360|0},80%,60%);transform:translate(${cx}px,${cy}px);`;
            document.body.appendChild(el);

            const angle = Math.random() * Math.PI * 2;
            const speed = 120 + Math.random() * 180;
            const dx    = Math.cos(angle) * speed;
            const dy    = Math.sin(angle) * speed;
            const dur   = 900 + Math.random() * 700;

            el.animate([
                { transform: `translate(${cx}px,${cy}px) scale(1)`,   opacity: 1 },
                { transform: `translate(${cx+dx}px,${cy+dy}px) scale(0.8)`, opacity: 0 },
            ], { duration: dur, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });

            setTimeout(() => el.remove(), dur + 60);
        }
    }

    const attach = () => {
        const heart = document.getElementById('love-heart') ?? document.querySelector('.heart-icon');
        if (!heart || heart.__confettiAttached) return;
        heart.__confettiAttached = true;
        heart.style.cursor = 'pointer';
        heart.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); burst(heart); });
    };

    document.readyState === 'loading'
        ? document.addEventListener('DOMContentLoaded', attach, { once: true })
        : attach();
})();
