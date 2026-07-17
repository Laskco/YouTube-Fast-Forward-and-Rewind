'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

// Media / headset keys — shared with content.js for hotkey capture
const MEDIA_KEYS = new Set([
    'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
    'MediaTrackNext', 'MediaTrackPrevious', 'MediaFastForward', 'MediaRewind',
]);

// Modifier-only and control keys that cannot be bound as hotkeys
const HOTKEY_BLOCKED = new Set(['Control', 'Alt', 'Shift', 'Meta', 'CapsLock', 'Tab', 'Escape', 'Enter']);

// YouTube-native shortcuts that would conflict if bound to FF skip keys.
// Shown as a warning rather than a hard block — the user may intentionally
// want to override them. Mirrors SponsorBlock's KeybindDialogComponent check.
const HOTKEY_YT_CONFLICT = new Set([
    'k',                // play / pause
    ' ',                // play / pause (spacebar)
    'j',                // rewind 10s (YouTube native)
    'l',                // fast forward 10s (YouTube native)
    'f',                // fullscreen
    'm',                // mute
    'c',                // captions
    'i',                // miniplayer
    't',                // theatre mode
    'ArrowUp',          // volume up
    'ArrowDown',        // volume down
    'ArrowLeft',        // seek back 5s  (YouTube default — warn if overriding)
    'ArrowRight',       // seek forward 5s
    '0','1','2','3','4','5','6','7','8','9', // seek to 0-90%
    'Home', 'End',      // seek to start / end
    'PageUp', 'PageDown', // seek ±10%
]);

// ─── Storage key classification ──────────────────────────────────────────────
// Mirrors the split in background.js: settings → sync, stats → local.

const STAT_KEYS = new Set([
    'stats_totalSecondsSkipped', 'stats_totalSkips',
    'stats_buttonSkips', 'stats_keyboardSkips',
]);

// ─── Demo / fallback data ─────────────────────────────────────────────────────

const DEMO_SETTINGS = {
    extensionEnabled: true, buttonSkipEnabled: true, keyboardShortcutsEnabled: true,
    forwardSkipTime: 10, backwardSkipTime: 10, keyboardForward: 5, keyboardBackward: 5,
    keyboardForwardKey: 'ArrowRight', keyboardBackwardKey: 'ArrowLeft',
    seekInterval: 150, progressBarUpdateDelay: 150,
    navigationInitDelay: 250, buttonPosition: 'left', ignoreBufferingProtection: false,
    btnFwdPreset1Value: 5, btnFwdPreset2Value: 10, btnFwdPreset3Value: 15, btnFwdPreset4Value: 30,
    btnBwdPreset1Value: 5, btnBwdPreset2Value: 10, btnBwdPreset3Value: 15, btnBwdPreset4Value: 30,
    kbdFwdPreset1Value: 5, kbdFwdPreset2Value: 10, kbdFwdPreset3Value: 15, kbdFwdPreset4Value: 30,
    kbdBwdPreset1Value: 5, kbdBwdPreset2Value: 10, kbdBwdPreset3Value: 15, kbdBwdPreset4Value: 30,
    theme: 'dark',
    stats_totalSecondsSkipped: 0, stats_totalSkips: 0, stats_buttonSkips: 0, stats_keyboardSkips: 0,
    _uiAdvancedOpen: false,
};

const BOOLEAN_SETTING_KEYS = [
    'extensionEnabled', 'buttonSkipEnabled', 'keyboardShortcutsEnabled',
    'ignoreBufferingProtection', '_uiAdvancedOpen',
];
const SKIP_TIME_KEYS = [
    'forwardSkipTime', 'backwardSkipTime', 'keyboardForward', 'keyboardBackward',
    ...['btnFwd', 'btnBwd', 'kbdFwd', 'kbdBwd']
        .flatMap(prefix => [1, 2, 3, 4].map(index => `${prefix}Preset${index}Value`)),
];

function normalizePopupSettings(raw = {}) {
    const normalized = { ...DEMO_SETTINGS };
    BOOLEAN_SETTING_KEYS.forEach(key => {
        if (typeof raw[key] === 'boolean') normalized[key] = raw[key];
    });
    SKIP_TIME_KEYS.forEach(key => {
        normalized[key] = boundedInteger(raw[key], DEMO_SETTINGS[key], 1, 99);
    });
    normalized.seekInterval = boundedInteger(raw.seekInterval, DEMO_SETTINGS.seekInterval, 50, 2000);
    normalized.progressBarUpdateDelay = boundedInteger(
        raw.progressBarUpdateDelay,
        DEMO_SETTINGS.progressBarUpdateDelay,
        0,
        2000,
    );
    normalized.navigationInitDelay = boundedInteger(
        raw.navigationInitDelay,
        DEMO_SETTINGS.navigationInitDelay,
        0,
        5000,
    );
    normalized.buttonPosition = raw.buttonPosition === 'right' ? 'right' : 'left';
    normalized.theme = raw.theme === 'light' ? 'light' : 'dark';
    normalized.keyboardForwardKey = normalizeStoredHotkey(raw.keyboardForwardKey, 'ArrowRight');
    normalized.keyboardBackwardKey = normalizeStoredHotkey(raw.keyboardBackwardKey, 'ArrowLeft');
    if (normalized.keyboardForwardKey === normalized.keyboardBackwardKey) {
        normalized.keyboardBackwardKey = normalized.keyboardForwardKey === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
    }
    normalized.stats_totalSecondsSkipped = nonnegativeNumber(raw.stats_totalSecondsSkipped);
    normalized.stats_totalSkips = nonnegativeInteger(raw.stats_totalSkips);
    normalized.stats_buttonSkips = nonnegativeInteger(raw.stats_buttonSkips);
    normalized.stats_keyboardSkips = nonnegativeInteger(raw.stats_keyboardSkips);
    return normalized;
}

function boundedInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.round(number)));
}

function nonnegativeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
}

function nonnegativeInteger(value) {
    return Math.floor(nonnegativeNumber(value));
}

function normalizeStoredHotkey(value, fallback) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 64) return fallback;
    return normalizeHotkey(value);
}

const IS_EXTENSION = typeof chrome !== 'undefined' && !!chrome?.storage;
const UI_KEYS = new Set(['_uiAdvancedOpen']);
const REINJECT_NOTICES = Object.freeze({
    no_active_tab: ['No active YouTube tab found', 'warning'],
    not_on_watch_page: ['Open a YouTube video first', 'warning'],
    disabled: ['Enable the extension first', 'warning'],
    button_disabled: ['Enable Button Skips first', 'warning'],
    player_not_ready: ['Player is not ready yet — try again in a moment', 'warning'],
    ok: ['Buttons re-injected', 'success'],
});
const PRESET_CONTEXT_NAMES = Object.freeze({
    btnFwd: 'Forward Button',
    btnBwd: 'Backward Button',
    kbdFwd: 'Forward Keyboard',
    kbdBwd: 'Backward Keyboard',
});
const SYNC_KEYS = new Set(
    Object.keys(DEMO_SETTINGS).filter(key => !STAT_KEYS.has(key) && !UI_KEYS.has(key)),
);
const SYNC_KEY_LIST = [...SYNC_KEYS];
const LOCAL_KEY_LIST = [...STAT_KEYS, ...UI_KEYS];

// ─── Storage helpers ──────────────────────────────────────────────────────────

const Storage = {
    async get() {
        if (!IS_EXTENSION) return { ...DEMO_SETTINGS };
        const [synced, local] = await Promise.all([
            chrome.storage.sync.get(SYNC_KEY_LIST),
            chrome.storage.local.get(LOCAL_KEY_LIST),
        ]);
        return normalizePopupSettings({ ...synced, ...local });
    },

    async set(s) {
        if (!IS_EXTENSION) return;
        const syncData  = Object.fromEntries(Object.entries(s).filter(([key]) => SYNC_KEYS.has(key)));
        const localData = Object.fromEntries(Object.entries(s).filter(([key]) => UI_KEYS.has(key)));
        const ops = [];
        if (Object.keys(syncData).length)  ops.push(chrome.storage.sync.set(syncData));
        if (Object.keys(localData).length) ops.push(chrome.storage.local.set(localData));
        await Promise.all(ops);
    },

    async defaults() {
        if (!IS_EXTENSION) return { ...DEMO_SETTINGS };
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getDefaultSettings' });
            return response?.ok ? normalizePopupSettings(response.settings) : null;
        } catch {
            return null;
        }
    },

    async resetStats() {
        if (!IS_EXTENSION) return {
            totalSecondsSkipped: 0, totalSkips: 0, buttonSkips: 0, keyboardSkips: 0,
        };
        const response = await chrome.runtime.sendMessage({ action: 'resetStats' });
        if (!response?.ok) throw new Error(response?.error || 'Could not reset statistics');
        return response.stats;
    },
};

// ─── Toast ────────────────────────────────────────────────────────────────────

const Toast = (() => {
    let timer = null;
    const el  = () => document.getElementById('toast-notification');
    const ICONS = {
        success: 'icon-check-circle',
        error:   'icon-x-circle',
        warning: 'icon-alert-triangle',
    };

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

function showReinjectNotice(status) {
    const notice = REINJECT_NOTICES[status];
    if (!notice) return false;
    Toast.show(...notice);
    return true;
}

function parseUrl(value) {
    try { return new URL(value); }
    catch { return null; }
}

function isYouTubeTab(tab) {
    if (!Number.isInteger(tab?.id) || !tab.url) return false;
    const url = parseUrl(tab.url);
    if (!url) return false;
    const isYouTube = url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com');
    return url.protocol === 'https:' && isYouTube;
}

async function activeYouTubeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return isYouTubeTab(tab) ? tab : null;
}

function requestButtonReinject(tab) {
    return chrome.tabs.sendMessage(tab.id, { action: 'injectButtons' });
}

// ─── Number utilities ─────────────────────────────────────────────────────────

function clamp(value, min = 1, max = 99) {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? min : Math.max(min, Math.min(max, n));
}

function enforceInput(input, min = 1, max = 99) {
    const val = clamp(input.value, min, max);
    input.value = val;
    return val;
}

function formatTime(secs) {
    const total = Math.max(0, Math.floor(Number(secs) || 0));
    if (total === 0) return '0s';
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [[h, 'h'], [m, 'm'], [s, 's']]
        .map(([value, unit]) => value ? `${value}${unit}` : '')
        .filter(Boolean)
        .join(' ');
}

function normalizeHotkey(key) {
    return typeof key === 'string' && key.length === 1 ? key.toLowerCase() : key;
}

function formatKey(key) {
    if (!key) return '';
    const map = {
        ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', ' ': 'Space',
        MediaPlayPause:     '⏯ Play/Pause',
        MediaPlay:          '▶ Play',
        MediaPause:         '⏸ Pause',
        MediaStop:          '⏹ Stop',
        MediaTrackNext:     '⏭ Next',
        MediaTrackPrevious: '⏮ Prev',
        MediaFastForward:   '⏩ Fast Fwd',
        MediaRewind:        '⏪ Rewind',
    };
    return map[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

function flashSpinner(input) {
    const c = input?.closest('.custom-spinner-container');
    if (!c) return;
    c.classList.add('flash-indicator');
    setTimeout(() => c.classList.remove('flash-indicator'), 500);
}

function spinnerAccessibleLabel(input) {
    const label = document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() || 'value';
    if (!input.classList.contains('preset-value-input')) return label;
    const direction = input.closest('.input-row')?.querySelector('.input-label')?.textContent?.trim()?.replace(/:$/, '');
    return direction ? `${direction} ${label} preset` : `${label} preset`;
}

// ─── Spinner widget ───────────────────────────────────────────────────────────

function initSpinner(container) {
    const input = container.querySelector('.custom-spinner-input');
    const up    = container.querySelector('.spinner-btn-up');
    const down  = container.querySelector('.spinner-btn-down');
    if (!input || !up || !down) return;

    let repeatTimer = null, repeatInterval = null, repeating = false;
    const label = spinnerAccessibleLabel(input);
    up.setAttribute('aria-label', `Increase ${label}`);
    down.setAttribute('aria-label', `Decrease ${label}`);

    const step = (dir) => {
        dir === 'up' ? input.stepUp() : input.stepDown();
        input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const startRepeat = (event, dir) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        stopRepeat(false);
        repeating = true;
        step(dir);
        repeatTimer = setTimeout(() => {
            repeatInterval = setInterval(() => step(dir), 100);
        }, 500);
    };
    const stopRepeat = (fire) => {
        if (!repeating) return;
        clearTimeout(repeatTimer);
        clearInterval(repeatInterval);
        repeatTimer = repeatInterval = null;
        repeating = false;
        if (fire) input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    up.addEventListener('pointerdown', event => startRepeat(event, 'up'));
    down.addEventListener('pointerdown', event => startRepeat(event, 'down'));
    window.addEventListener('pointerup', () => stopRepeat(true));
    window.addEventListener('pointercancel', () => stopRepeat(false));
    window.addEventListener('blur', () => stopRepeat(false));
    [up, down].forEach((button, index) => {
        button.addEventListener('click', event => {
            if (event.detail !== 0) return;
            step(index === 0 ? 'up' : 'down');
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });
}

// ─── Theme ────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
    const light = theme === 'light';
    document.documentElement.classList.toggle('light-theme-html-override', light);
    document.body.classList.toggle('light-theme', light);

    document.querySelector('#themeToggle svg:first-child')?.classList.toggle('is-hidden', light);
    document.querySelector('#themeToggle svg:last-child')?.classList.toggle('is-hidden', !light);
    const toggle = document.getElementById('themeToggle');
    const label = light ? 'Use dark theme' : 'Use light theme';
    toggle?.setAttribute('aria-label', label);
    if (toggle) toggle.title = label;
}

// ─── Main popup logic ─────────────────────────────────────────────────────────

const $  = (id)  => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

let el = null;
let settings = {};
let persistedSettings = {};
let saveQueue = Promise.resolve();
let saveRevision = 0;
let activeHotkeyCleanup = null;

document.addEventListener('DOMContentLoaded', initPopup);

function collectViewElements() {
    return {
        mainView:      $('main-view'),
        settingsView:  $('settings-view'),
        openSettings:  $('openSettingsBtn'),
        closeSettings: $('closeSettingsBtn'),
    };
}

function collectHeaderElements() {
    return {
        themeToggle:   $('themeToggle'),
        resetSettings: $('resetSettings'),
    };
}

function collectToggleElements() {
    return {
        enableToggle: $('enableToggle'),
        btnToggle:    $('buttonEnableToggle'),
        kbdToggle:    $('keyboardEnableToggle'),
        bufToggle:    $('ignoreBufferingToggle'),
        statusText:     $('extensionStatusText'),
        btnStatusLabel: $('buttonStatusLabel'),
        kbdStatusLabel: $('keyboardStatusLabel'),
        bufStatusLabel: $('ignoreBufferingStatusLabel'),
        btnCard:    $('button-skip-card'),
        kbdCard:    $('keyboard-skip-card'),
        timingCard: $('action-timing-card'),
    };
}

function collectInputElements() {
    return {
        fwdTime: $('forwardSkipTime'),
        bwdTime: $('backwardSkipTime'),
        kbdFwd:  $('keyboardForward'),
        kbdBwd:  $('keyboardBackward'),
        fwdKey:        $('keyboardForwardKey'),
        bwdKey:        $('keyboardBackwardKey'),
        hotkeySummary: $('hotkeySummary'),
        hotkeyEditBtn: $('hotkeyEditButton'),
        resetHotkeys:  $('resetHotkeysBtn'),
    };
}

function collectAdvancedElements() {
    return {
        seekInterval:    $('seekInterval'),
        progressDelay:   $('progressBarUpdateDelay'),
        navDelay:        $('navigationInitDelay'),
        resetTiming:     $('resetActionTiming'),
        moreTimingBtn:   $('openMoreSettingsBtn'),
        moreTimingPanel: $('moreTimingSettings'),
        reinjectBtn:     $('reinjectBtn'),
    };
}

function collectActionElements() {
    return {
        posLeft:  $('pos-left-btn'),
        posRight: $('pos-right-btn'),
        statsTotalTime:  $('statsTotalTime'),
        statsFormatted:  $('statsFormattedTime'),
        statsTotalSkips: $('statsTotalSkips'),
        statsBtnSkips:   $('statsButtonSkips'),
        statsKbdSkips:   $('statsKeyboardSkips'),
        resetStats:      $('resetStatsBtn'),
        errorIndicatorBtn: $('errorIndicatorBtn'),
        errorCount:        $('errorCount'),
        versionText:       $('versionText'),
        allInputRows: $$('.input-row'),
    };
}

function collectElements() {
    return {
        ...collectViewElements(),
        ...collectHeaderElements(),
        ...collectToggleElements(),
        ...collectInputElements(),
        ...collectAdvancedElements(),
        ...collectActionElements(),
    };
}

    // ── More-timing panel ─────────────────────────────────────────────────────
    // Defined early so it can be called from the openSettings click handler below.

    function renderMoreTimingState(open) {
        el.moreTimingPanel?.classList.toggle('visible', open);
        el.moreTimingPanel?.setAttribute('aria-hidden', String(!open));
        if (el.moreTimingPanel) el.moreTimingPanel.inert = !open;
        el.moreTimingBtn?.classList.toggle('open', open);
        el.moreTimingBtn?.setAttribute('aria-expanded', String(open));
        setText(el.moreTimingBtn?.querySelector('span'), open ? 'Hide Settings' : 'View Settings');
    }

    async function closeMoreTiming() {
        if (!el.moreTimingPanel?.classList.contains('visible')) return;
        renderMoreTimingState(false);
        settings._uiAdvancedOpen = false;
        try {
            await Storage.set({ _uiAdvancedOpen: false });
            persistedSettings._uiAdvancedOpen = false;
        } catch { /* UI state is non-critical. */ }
    }

    // ── Gather settings from UI ───────────────────────────────────────────────

    function gather() {
        const s = { ...settings };

        s.extensionEnabled          = el.enableToggle.checked;
        s.buttonSkipEnabled         = el.btnToggle.checked;
        s.keyboardShortcutsEnabled  = el.kbdToggle.checked;
        s.ignoreBufferingProtection = el.bufToggle ? !el.bufToggle.checked : false;

        s.forwardSkipTime  = enforceInput(el.fwdTime);
        s.backwardSkipTime = enforceInput(el.bwdTime);
        s.keyboardForward  = enforceInput(el.kbdFwd);
        s.keyboardBackward = enforceInput(el.kbdBwd);

        s.seekInterval            = enforceInput(el.seekInterval,    50, 2000);
        s.progressBarUpdateDelay  = enforceInput(el.progressDelay,   0, 2000);
        s.navigationInitDelay     = enforceInput(el.navDelay,        0, 5000);

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

    function save(overrides = {}, toastMsg = '', toastType = 'success') {
        const next = { ...gather(), ...overrides };
        STAT_KEYS.forEach(key => { next[key] = settings[key] ?? 0; });
        UI_KEYS.forEach(key => { next[key] = settings[key] ?? false; });
        settings = next;
        const revision = ++saveRevision;
        const commit = async () => {
            const changed = Object.fromEntries(
                Object.entries(next)
                    .filter(([key, value]) => !STAT_KEYS.has(key)
                        && !UI_KEYS.has(key)
                        && !Object.is(persistedSettings[key], value)),
            );
            try {
                if (Object.keys(changed).length) await Storage.set(changed);
                persistedSettings = { ...persistedSettings, ...changed };
                if (toastMsg) Toast.show(toastMsg, toastType);
                return true;
            } catch {
                // A newer queued save includes this desired state and will retry
                // it. Only the newest failed save should roll the UI back.
                if (revision === saveRevision) {
                    settings = { ...persistedSettings };
                    applyTheme(settings.theme);
                    render(settings);
                    Toast.show('Could not save settings', 'error');
                }
                return false;
            }
        };
        const pending = saveQueue.then(commit, commit);
        saveQueue = pending.then(() => undefined, () => undefined);
        return pending;
    }

    // ── Render UI from settings ───────────────────────────────────────────────

    function render(s) {
        el.enableToggle.checked = s.extensionEnabled;
        el.btnToggle.checked    = s.buttonSkipEnabled;
        el.kbdToggle.checked    = s.keyboardShortcutsEnabled;
        if (el.bufToggle) el.bufToggle.checked = !s.ignoreBufferingProtection;

        el.fwdTime.value = clamp(s.forwardSkipTime);
        el.bwdTime.value = clamp(s.backwardSkipTime);
        el.kbdFwd.value  = clamp(s.keyboardForward);
        el.kbdBwd.value  = clamp(s.keyboardBackward);

        el.seekInterval.value     = clamp(s.seekInterval,            50, 2000);
        el.progressDelay.value    = clamp(s.progressBarUpdateDelay,  0, 2000);
        el.navDelay.value         = clamp(s.navigationInitDelay,     0, 5000);

        renderHotkeys(s);

        renderPosition(s.buttonPosition);

        renderPresets(s);
        renderStatus();
        renderStats(s);
    }

    function renderPosition(position) {
        const right = position === 'right';
        el.posRight.classList.toggle('active',  right);
        el.posLeft.classList.toggle('active',  !right);
        el.posRight.setAttribute('aria-pressed', String(right));
        el.posLeft.setAttribute('aria-pressed', String(!right));
    }

    function renderStatus() {
        const enabled = el.enableToggle.checked;

        setCardDisabled(el.btnCard, cardDisabled(enabled, el.btnToggle));
        setCardDisabled(el.kbdCard, cardDisabled(enabled, el.kbdToggle));
        setCardDisabled(el.timingCard, !enabled);
        setExtensionStatus(enabled);

        updateToggleLabel(el.btnStatusLabel, el.btnToggle?.checked,  'Button Skip Times');
        updateToggleLabel(el.kbdStatusLabel, el.kbdToggle?.checked,  'Keyboard Shortcuts');
        updateToggleLabel(el.bufStatusLabel, el.bufToggle?.checked, 'Buffering Protection');
    }

    function cardDisabled(extensionEnabled, toggle) {
        return [extensionEnabled, toggle?.checked].includes(false);
    }

    function setCardDisabled(card, disabled) {
        card?.classList.toggle('is-disabled', disabled);
        setRegionDisabled(card?.querySelector('.card-content-wrapper'), disabled);
        setRegionDisabled(card?.querySelector('.position-toggle-group'), disabled);
    }

    function setRegionDisabled(region, disabled) {
        if (!region) return;
        region.inert = disabled;
        if (disabled) region.setAttribute('aria-disabled', 'true');
        else region.removeAttribute('aria-disabled');
    }

    function setExtensionStatus(enabled) {
        el.statusText.textContent = enabled ? 'Extension Enabled' : 'Extension Disabled';
        el.statusText.classList.toggle('enabled',  enabled);
        el.statusText.classList.toggle('disabled', !enabled);
    }

    function updateToggleLabel(label, isOn, text) {
        label?.querySelector('svg use')?.setAttribute('href', isOn ? '#icon-toggle-right' : '#icon-toggle-left');
        setText(label?.querySelector('span'), ` ${text} ${isOn ? 'Enabled' : 'Disabled'}`);
    }

    function setText(node, text) {
        if (node) node.textContent = text;
    }

    function renderPresets(s) {
        el.allInputRows.forEach(row => {
            const ctx = row.dataset.presetContext;
            if (!ctx) return;

            row.querySelectorAll('.preset-buttons .btn-preset').forEach(btn => {
                const key = `${ctx}Preset${parseInt(btn.dataset.presetIndex) + 1}Value`;
                const val = clamp(s[key] ?? 10);
                btn.textContent   = `${val}s`;
                btn.dataset.value = val;
                btn.setAttribute('aria-label', `Set skip time to ${val} seconds`);
            });

            row.querySelectorAll('.preset-editor .custom-spinner-input').forEach(input => {
                const key = `${ctx}Preset${parseInt(input.dataset.presetIndex) + 1}Value`;
                input.value = clamp(s[key] ?? 10);
            });

            const editing = row.classList.contains('is-editing-presets');
            const editor = row.querySelector('.preset-editor');
            const editButton = row.querySelector('.btn-edit-presets');
            if (editor) {
                editor.inert = !editing;
                editor.setAttribute('aria-hidden', String(!editing));
            }
            editButton?.setAttribute('aria-expanded', String(editing));
        });
    }

    function renderStats(s) {
        const secs = s.stats_totalSecondsSkipped || 0;
        [
            [el.statsTotalTime,  `${Math.floor(secs)}s`],
            [el.statsFormatted,  formatTime(secs)],
            [el.statsTotalSkips, statValue(s, 'stats_totalSkips')],
            [el.statsBtnSkips,   statValue(s, 'stats_buttonSkips')],
            [el.statsKbdSkips,   statValue(s, 'stats_keyboardSkips')],
        ].forEach(([node, value]) => setText(node, value));
    }

    function renderHotkeys(s) {
        const forward = formatKey(s.keyboardForwardKey);
        const backward = formatKey(s.keyboardBackwardKey);
        el.fwdKey.textContent = forward;
        el.bwdKey.textContent = backward;
        el.fwdKey.setAttribute('aria-label', `Change forward hotkey, currently ${forward}`);
        el.bwdKey.setAttribute('aria-label', `Change backward hotkey, currently ${backward}`);
        setText(el.hotkeySummary, `Hotkeys (${forward} / ${backward})`);

        const editing = el.kbdCard.classList.contains('is-editing-hotkeys');
        setHotkeyEditorState(editing);
    }

    function setHotkeyEditorState(editing) {
        el.hotkeyEditBtn?.setAttribute('aria-expanded', String(editing));
        const editor = el.kbdCard.querySelector('.hotkey-editor');
        if (editor) {
            editor.inert = !editing;
            editor.setAttribute('aria-hidden', String(!editing));
        }
    }

    function statValue(source, key) {
        return source[key] || 0;
    }

    // ── Preset edit mode ──────────────────────────────────────────────────────

    function togglePresetEdit(row) {
        const btn = row.querySelector('.btn-edit-presets');
        if (!btn) return;
        const editing  = row.classList.toggle('is-editing-presets');
        const editor = row.querySelector('.preset-editor');
        if (editor) {
            editor.inert = !editing;
            editor.setAttribute('aria-hidden', String(!editing));
        }
        btn.setAttribute('aria-expanded', String(editing));
        const contextName = PRESET_CONTEXT_NAMES[row.dataset.presetContext] ?? 'Custom';
        btn.setAttribute('aria-label', `${editing ? 'Save' : 'Edit'} ${contextName} Presets`);
        toggleEditIcons(btn, editing, '.icon-edit', '.icon-save');
        saveClosedPresetEditor(editing);
    }

    function toggleEditIcons(root, editing, editSel, saveSel) {
        root.querySelector(editSel)?.classList.toggle('is-hidden', editing);
        root.querySelector(saveSel)?.classList.toggle('is-hidden', !editing);
    }

    function saveClosedPresetEditor(editing) {
        if (editing) return;
        save({}, 'Presets Saved').then(() => renderPresets(settings)).catch(() => {});
    }

    function closeAllPresetEditors(card) {
        card?.querySelectorAll('.input-row.is-editing-presets').forEach(row => togglePresetEdit(row));
    }

    // ── Hotkey edit mode ──────────────────────────────────────────────────────

    function toggleHotkeyEdit() {
        if (!el.kbdCard || !el.hotkeyEditBtn) return;
        const editing  = el.kbdCard.classList.toggle('is-editing-hotkeys');
        if (!editing) activeHotkeyCleanup?.(true);
        el.hotkeyEditBtn.setAttribute('aria-label', editing ? 'Save Hotkeys' : 'Edit Hotkeys');
        setHotkeyEditorState(editing);
        toggleEditIcons(el.hotkeyEditBtn, editing, '.icon-edit', '.icon-check');
    }

    function listenForHotkey(button, settingKey) {
        const otherKey = settingKey === 'keyboardForwardKey' ? 'keyboardBackwardKey' : 'keyboardForwardKey';
        const original = formatKey(settings[settingKey]);

        // Toggle off if this button was already listening
        if (button.classList.contains('is-listening')) {
            activeHotkeyCleanup?.(true);
            return;
        }

        activeHotkeyCleanup?.(true);

        button.classList.add('is-listening');
        button.textContent = 'Press key...';

        let cleaned = false;
        const cleanup = (revert) => {
            if (cleaned) return;
            cleaned = true;
            window.removeEventListener('keydown',  onKeyDown,   true);
            window.removeEventListener('keyup',    onKeyUp,     true);
            document.removeEventListener('mousedown', onMouseDown, true);
            window.removeEventListener('blur',     onBlur);
            button.classList.remove('is-listening');
            if (revert) button.textContent = original;
            if (activeHotkeyCleanup === cleanup) activeHotkeyCleanup = null;
        };
        activeHotkeyCleanup = cleanup;

        const assignKey = (k) => assignHotkey(k, otherKey, settingKey, button, cleanup);

        // Regular keys: capture on keydown
        const onKeyDown = (e) => {
            if (MEDIA_KEYS.has(e.key)) return; // handled by keyup
            e.preventDefault();
            e.stopPropagation();
            if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
                Toast.show('Modifier combinations are not supported', 'error');
                cleanup(true);
                return;
            }
            assignKey(normalizeHotkey(e.key));
        };

        // Media / headset keys: capture on keyup (browsers may not fire keydown for these)
        const onKeyUp = (e) => {
            if (!MEDIA_KEYS.has(e.key)) return;
            e.preventDefault();
            e.stopPropagation();
            assignKey(e.key);
        };

        // Mousedown outside the active button cancels listening
        const onMouseDown = (e) => { if (!button.contains(e.target)) cleanup(true); };
        const onBlur      = ()    => cleanup(true);

        window.addEventListener('keydown',     onKeyDown,   { capture: true });
        window.addEventListener('keyup',       onKeyUp,     { capture: true });
        document.addEventListener('mousedown', onMouseDown, { capture: true });
        window.addEventListener('blur',        onBlur,      { once: true });
    }

    function hotkeyError(k, otherKey) {
        if (normalizeHotkey(k) === normalizeHotkey(settings[otherKey])) return 'Key already in use';
        if (HOTKEY_BLOCKED.has(k)) return 'Key is reserved';
        return '';
    }

    function youtubeConflictMessage(k) {
        const keyName = k === ' ' ? 'Space' : k;
        return `"${keyName}" is a YouTube shortcut — it will be overridden`;
    }

    function assignHotkey(k, otherKey, settingKey, button, cleanup) {
        k = normalizeHotkey(k);
        const error = hotkeyError(k, otherKey);
        if (error) { Toast.show(error, 'error'); cleanup(true); return; }
        if (HOTKEY_YT_CONFLICT.has(k)) Toast.show(youtubeConflictMessage(k), 'warning');
        renderHotkeys({ ...settings, [settingKey]: k });
        void save({ [settingKey]: k }, HOTKEY_YT_CONFLICT.has(k) ? '' : 'Hotkey Saved');
        cleanup(false);
    }

    // ── Event wiring ──────────────────────────────────────────────────────────

    function toggleToastMessage(target, sourceToggle) {
        const label = target.dataset.toastMessage;
        if (!label) return '';
        if (sourceToggle === el.bufToggle) return `Buffering Protection ${toggleStateText(target)}`;
        return `${label} ${toggleStateText(target)}`;
    }

    function toggleStateText(target) {
        return target.checked ? 'Enabled' : 'Disabled';
    }

    function closeDisabledEditors(target) {
        const cardId = target.dataset.cardToReset;
        if (!cardId || target.checked) return;
        closeAllPresetEditors($(cardId));
        closeHotkeyEditorForDisabledCard(cardId);
    }

    function closeHotkeyEditorForDisabledCard(cardId) {
        if (cardId !== 'keyboard-skip-card') return;
        if (el.kbdCard.classList.contains('is-editing-hotkeys')) toggleHotkeyEdit();
    }

    function handleCoreToggle(e) {
        renderStatus();
        save({}, toggleToastMessage(e.target, e.currentTarget));
        closeDisabledEditors(e.target);
    }

    function savePosition(side) {
        const target = side === 'right' ? el.posRight : el.posLeft;
        if (target.classList.contains('active')) return;
        renderPosition(side);
        save({}, 'Button Position Saved');
    }

    async function reinjectButtons() {
        if (!IS_EXTENSION) { Toast.show('Not available in preview', 'warning'); return; }
        try {
            const tab = await activeYouTubeTab();
            const status = tab ? (await requestButtonReinject(tab))?.status : 'no_active_tab';
            if (!showReinjectNotice(status)) throw new Error('Unexpected response from page');
        } catch {
            // Content script not loaded on this page, or tab was closed
            Toast.show('Could not reach the page — try reloading it', 'error');
        }
    }

    function shouldCloseMoreTiming(e) {
        const anyCard  = e.target.closest('.settings-card');
        const blockers = [
            e.target.closest('#moreTimingSettings'),
            e.target.closest('#openMoreSettingsBtn'),
            e.target.closest('#closeSettingsBtn'),
            e.target.closest('.settings-card') === el.timingCard,
        ];
        return Boolean(anyCard) && !blockers.some(Boolean);
    }

    function handleDocumentMouseDown(e) {
        if (!el.moreTimingPanel?.classList.contains('visible')) return;
        if (shouldCloseMoreTiming(e)) closeMoreTiming();
    }

    function setupViewListeners() {
        el.openSettings?.addEventListener('click', () => {
            el.mainView.classList.remove('active');
            el.mainView.setAttribute('aria-hidden', 'true');
            el.mainView.inert = true;
            el.settingsView.classList.add('active');
            el.settingsView.setAttribute('aria-hidden', 'false');
            el.settingsView.inert = false;
            el.closeSettings?.focus();
        });
        el.closeSettings?.addEventListener('click', () => {
            el.settingsView.classList.remove('active');
            el.settingsView.setAttribute('aria-hidden', 'true');
            el.settingsView.inert = true;
            el.mainView.classList.add('active');
            el.mainView.setAttribute('aria-hidden', 'false');
            el.mainView.inert = false;
            el.openSettings?.focus();
        });
    }

    function setupThemeListener() {
        el.themeToggle?.addEventListener('click', async () => {
            const newTheme = document.body.classList.contains('light-theme') ? 'dark' : 'light';
            applyTheme(newTheme);
            await save({ theme: newTheme });
        });
    }

    function setupToggleListeners() {
        [el.enableToggle, el.btnToggle, el.kbdToggle, el.bufToggle].forEach(t => {
            t?.addEventListener('change', handleCoreToggle);
        });
    }

    function setupInputListeners() {
        $$('.skip-time-input').forEach(input => input.addEventListener('change', () => save()));
        [el.seekInterval, el.progressDelay, el.navDelay].forEach(input => {
            input?.addEventListener('change', () => save());
        });
    }

    function setupPositionListeners() {
        el.posLeft?.addEventListener('click', () => savePosition('left'));
        el.posRight?.addEventListener('click', () => savePosition('right'));
    }

    function setupHotkeyListeners() {
        el.hotkeyEditBtn?.addEventListener('click', toggleHotkeyEdit);
        el.fwdKey?.addEventListener('click', () => listenForHotkey(el.fwdKey, 'keyboardForwardKey'));
        el.bwdKey?.addEventListener('click', () => listenForHotkey(el.bwdKey, 'keyboardBackwardKey'));
        el.resetHotkeys?.addEventListener('click', async () => {
            const defs = await Storage.defaults();
            if (!defs) return Toast.show('Could not fetch defaults', 'error');
            await save({
                keyboardForwardKey: defs.keyboardForwardKey,
                keyboardBackwardKey: defs.keyboardBackwardKey,
            }, 'Hotkeys Reset', 'warning');
            render(settings);
        });
    }

    function setupPresetEditListeners() {
        $$('.btn-edit-presets').forEach(btn => {
            btn.addEventListener('click', () => togglePresetEdit(btn.closest('.input-row')));
        });
    }

    function setupPresetSelectListeners() {
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
    }

    function setupPresetResetListeners() {
        $$('.btn-reset-presets').forEach(btn => {
            btn.addEventListener('click', async () => {
                const defs = await Storage.defaults();
                if (!defs) return Toast.show('Could not fetch defaults', 'error');
                const ctx = btn.closest('.input-row')?.dataset.presetContext;
                if (!ctx) return;
                const overrides = {};
                for (let i = 1; i <= 4; i++) {
                    const key = `${ctx}Preset${i}Value`;
                    overrides[key] = defs[key];
                }
                await save(overrides, 'Presets Reset', 'warning');
                render(settings);
            });
        });
    }

    function setupResetListeners() {
        el.resetSettings?.addEventListener('click', async () => {
            const defs = await Storage.defaults();
            if (!defs) return Toast.show('Could not fetch defaults', 'error');
            const theme   = settings.theme || 'dark';
            const stats   = Object.fromEntries(Object.entries(settings).filter(([k]) => k.startsWith('stats_')));
            const uiState = { _uiAdvancedOpen: settings._uiAdvancedOpen ?? false };
            await save({ ...defs, theme, ...stats, ...uiState }, 'All Settings Reset', 'warning');
            render(settings);
        });

        el.resetStats?.addEventListener('click', async () => {
            try {
                const reset = await Storage.resetStats();
                mergeLiveStats(reset);
                Toast.show('Statistics Reset', 'warning');
            } catch {
                Toast.show('Could not reset statistics', 'error');
            }
        });

        el.resetTiming?.addEventListener('click', async () => {
            const defs = await Storage.defaults();
            if (!defs) return Toast.show('Could not fetch defaults', 'error');
            const timingKeys = ['seekInterval', 'ignoreBufferingProtection', 'progressBarUpdateDelay', 'navigationInitDelay'];
            const overrides = Object.fromEntries(timingKeys.map(key => [key, defs[key]]));
            await save(overrides, 'Action Timing Reset', 'warning');
            render(settings);
        });
    }

    function setupAdvancedPanelListeners() {
        // Re-inject button — sends 'injectButtons' to the active YouTube tab's
        // content script, which calls tryInject(0) to force a fresh injection.
        // Mirrors the competitor extension's manual refresh approach, surfaced
        // here in Advanced Settings as a safety net for edge cases.
        el.reinjectBtn?.addEventListener('click', reinjectButtons);

        el.moreTimingBtn?.addEventListener('click', async () => {
            const open = !el.moreTimingPanel.classList.contains('visible');
            renderMoreTimingState(open);
            settings._uiAdvancedOpen = open;
            try {
                await Storage.set({ _uiAdvancedOpen: open });
                persistedSettings._uiAdvancedOpen = open;
            } catch { /* UI state is non-critical. */ }
        });

        document.addEventListener('mousedown', handleDocumentMouseDown, { passive: true });
        restoreAdvancedPanelState();
    }

    function restoreAdvancedPanelState() {
        const open = settings._uiAdvancedOpen === true;
        renderMoreTimingState(open);
    }

    function setupListeners() {
        setupViewListeners();
        setupThemeListener();
        setupToggleListeners();
        setupInputListeners();
        setupPositionListeners();
        setupHotkeyListeners();
        setupPresetEditListeners();
        setupPresetSelectListeners();
        setupPresetResetListeners();
        setupResetListeners();
        setupAdvancedPanelListeners();
    }

    function mergeLiveStats(stats) {
        if (!stats) return;
        settings.stats_totalSecondsSkipped = stats.totalSecondsSkipped;
        settings.stats_totalSkips          = stats.totalSkips;
        settings.stats_buttonSkips         = stats.buttonSkips;
        settings.stats_keyboardSkips       = stats.keyboardSkips;
        persistedSettings.stats_totalSecondsSkipped = stats.totalSecondsSkipped;
        persistedSettings.stats_totalSkips          = stats.totalSkips;
        persistedSettings.stats_buttonSkips         = stats.buttonSkips;
        persistedSettings.stats_keyboardSkips       = stats.keyboardSkips;
        renderStats(settings);
    }

    function handleLocalStorageChange(changes, area) {
        if (area !== 'local') return;
        const statMap = {
            stats_totalSecondsSkipped: 'totalSecondsSkipped',
            stats_totalSkips: 'totalSkips',
            stats_buttonSkips: 'buttonSkips',
            stats_keyboardSkips: 'keyboardSkips',
        };
        const liveStats = {};
        let hasStatChange = false;
        Object.entries(statMap).forEach(([storageKey, snapshotKey]) => {
            if (!changes[storageKey]) return;
            liveStats[snapshotKey] = changes[storageKey].newValue ?? 0;
            hasStatChange = true;
        });
        if (hasStatChange) {
            Object.entries(statMap).forEach(([storageKey, snapshotKey]) => {
                if (liveStats[snapshotKey] === undefined) liveStats[snapshotKey] = settings[storageKey] ?? 0;
            });
            mergeLiveStats(liveStats);
        }
        if (changes.recentErrors) {
            const errors = Array.isArray(changes.recentErrors.newValue) ? changes.recentErrors.newValue : [];
            updateErrorIndicator(errors.length);
        }
    }

    function updateErrorIndicator(count) {
        const hasErrors = count > 0;
        el.errorIndicatorBtn?.classList.toggle('visible', hasErrors);
        setText(el.errorCount, hasErrors ? count : 0);
    }

    function requestRecentErrors() {
        try {
            chrome.runtime.sendMessage({ action: 'getRecentErrors' }, (res) => {
                if (chrome.runtime.lastError) return; // background not awake yet
                updateErrorIndicator((res?.errors ?? []).length);
            });
        } catch {}
    }

    async function fetchRecentErrors() {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'getRecentErrors' }, response => {
                const error = chrome.runtime.lastError;
                if (error) reject(new Error(error.message));
                else resolve(response);
            });
        });
    }

    async function copyErrorLog() {
        try {
            const res = await fetchRecentErrors();
            await copyErrorsToClipboard(res?.errors ?? []);
        } catch {
            Toast.show('Could not copy error log', 'error');
        }
    }

    async function copyErrorsToClipboard(errors) {
        if (!errors.length) { Toast.show('No errors logged', 'success'); return; }
        await navigator.clipboard.writeText(JSON.stringify(errors, null, 2));
        Toast.show(`Copied ${errors.length} error(s) to clipboard`, 'success');
    }

    function setupExtensionRuntime() {
        if (!IS_EXTENSION) return;
        chrome.storage.onChanged.addListener(handleLocalStorageChange);
        requestRecentErrors();
        el.errorIndicatorBtn?.addEventListener('click', copyErrorLog);
    }

async function initPopup() {
    el = collectElements();
    $$('.custom-spinner-container').forEach(initSpinner);
    el.mainView?.setAttribute('aria-hidden', 'false');
    if (el.mainView) el.mainView.inert = false;
    el.settingsView?.setAttribute('aria-hidden', 'true');
    if (el.settingsView) el.settingsView.inert = true;

    let loadFailed = false;
    try {
        settings = await Storage.get();
    } catch {
        settings = { ...DEMO_SETTINGS };
        loadFailed = true;
    }
    persistedSettings = { ...settings };
    applyTheme(settings.theme);
    render(settings);
    setupListeners();
    setupExtensionRuntime();
    if (el.versionText && IS_EXTENSION) {
        el.versionText.textContent = `v${chrome.runtime.getManifest().version}`;
    }
    if (loadFailed) Toast.show('Settings could not be loaded; showing defaults', 'error', 4000);
}

// ─── Confetti easter egg ──────────────────────────────────────────────────────

(function attachConfetti() {
    function burst(origin) {
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        const rect  = origin.getBoundingClientRect();
        const cx    = rect.left + rect.width  / 2;
        const cy    = rect.top  + rect.height / 2;

        for (let i = 0; i < 24; i++) {
            const piece = document.createElement('div');
            piece.className  = 'confetti-piece';
            const sz = 4 + Math.random() * 6;
            piece.style.cssText = `width:${sz}px;height:${sz}px;background:hsl(${Math.random() * 360 | 0},80%,60%);transform:translate(${cx}px,${cy}px);`;
            document.body.appendChild(piece);

            const angle = Math.random() * Math.PI * 2;
            const speed = 120 + Math.random() * 180;
            const dx    = Math.cos(angle) * speed;
            const dy    = Math.sin(angle) * speed;
            const dur   = 900 + Math.random() * 700;

            piece.animate([
                { transform: `translate(${cx}px,${cy}px) scale(1)`,          opacity: 1 },
                { transform: `translate(${cx + dx}px,${cy + dy}px) scale(0.8)`, opacity: 0 },
            ], { duration: dur, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });

            setTimeout(() => piece.remove(), dur + 60);
        }
    }

    const attach = () => {
        const heart = document.getElementById('love-heart');
        if (!heart) return;
        heart.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); burst(heart); });
    };

    document.readyState === 'loading'
        ? document.addEventListener('DOMContentLoaded', attach, { once: true })
        : attach();
})();
