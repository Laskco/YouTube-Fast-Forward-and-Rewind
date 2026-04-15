// ─── Settings Schema ──────────────────────────────────────────────────────────

const SETTINGS_SCHEMA = {
    extensionEnabled:          { type: 'boolean', default: true },
    buttonSkipEnabled:         { type: 'boolean', default: true },
    keyboardShortcutsEnabled:  { type: 'boolean', default: true },
    forwardSkipTime:           { type: 'number',  default: 10,   min: 1,  max: 99 },
    backwardSkipTime:          { type: 'number',  default: 10,   min: 1,  max: 99 },
    keyboardForward:           { type: 'number',  default: 5,    min: 1,  max: 99 },
    keyboardBackward:          { type: 'number',  default: 5,    min: 1,  max: 99 },
    keyboardForwardKey:        { type: 'string',  default: 'ArrowRight' },
    keyboardBackwardKey:       { type: 'string',  default: 'ArrowLeft'  },
    controlsVisibleDuration:   { type: 'number',  default: 2500, min: 0,  max: 10000 },
    seekInterval:              { type: 'number',  default: 150,  min: 0,  max: 2000  },
    progressBarUpdateDelay:    { type: 'number',  default: 150,  min: 0,  max: 2000  },
    navigationInitDelay:       { type: 'number',  default: 250,  min: 0,  max: 5000  },
    ignoreBufferingProtection: { type: 'boolean', default: false },
    buttonPosition:            { type: 'string',  default: 'left', enum: ['left', 'right'] },
    theme:                     { type: 'string',  default: 'dark', enum: ['dark', 'light']  },
    btnFwdPreset1Value: { type: 'number', default: 5,  min: 1, max: 99 },
    btnFwdPreset2Value: { type: 'number', default: 10, min: 1, max: 99 },
    btnFwdPreset3Value: { type: 'number', default: 15, min: 1, max: 99 },
    btnFwdPreset4Value: { type: 'number', default: 30, min: 1, max: 99 },
    btnBwdPreset1Value: { type: 'number', default: 5,  min: 1, max: 99 },
    btnBwdPreset2Value: { type: 'number', default: 10, min: 1, max: 99 },
    btnBwdPreset3Value: { type: 'number', default: 15, min: 1, max: 99 },
    btnBwdPreset4Value: { type: 'number', default: 30, min: 1, max: 99 },
    kbdFwdPreset1Value: { type: 'number', default: 5,  min: 1, max: 99 },
    kbdFwdPreset2Value: { type: 'number', default: 10, min: 1, max: 99 },
    kbdFwdPreset3Value: { type: 'number', default: 15, min: 1, max: 99 },
    kbdFwdPreset4Value: { type: 'number', default: 30, min: 1, max: 99 },
    kbdBwdPreset1Value: { type: 'number', default: 5,  min: 1, max: 99 },
    kbdBwdPreset2Value: { type: 'number', default: 10, min: 1, max: 99 },
    kbdBwdPreset3Value: { type: 'number', default: 15, min: 1, max: 99 },
    kbdBwdPreset4Value: { type: 'number', default: 30, min: 1, max: 99 },
    stats_totalSecondsSkipped: { type: 'number', default: 0 },
    stats_totalSkips:          { type: 'number', default: 0 },
    stats_buttonSkips:         { type: 'number', default: 0 },
    stats_keyboardSkips:       { type: 'number', default: 0 },
    _uiAdvancedOpen: { type: 'boolean', default: false },
};

const DEFAULTS = Object.fromEntries(Object.entries(SETTINGS_SCHEMA).map(([k, v]) => [k, v.default]));

// ─── Validation ───────────────────────────────────────────────────────────────

function coerce(value, schema) {
    if (value === undefined || value === null) return schema.default;
    switch (schema.type) {
        case 'boolean': return typeof value === 'boolean' ? value : schema.default;
        case 'number': {
            const n = Number(value);
            if (isNaN(n)) return schema.default;
            return Math.max(schema.min ?? -Infinity, Math.min(schema.max ?? Infinity, n));
        }
        case 'string': {
            if (typeof value !== 'string') return schema.default;
            const s = value.trim();
            return (schema.enum && !schema.enum.includes(s)) ? schema.default : s;
        }
        default: return schema.default;
    }
}

const STAT_KEYS = new Set(['stats_totalSecondsSkipped','stats_totalSkips','stats_buttonSkips','stats_keyboardSkips']);
const SYNC_KEYS = new Set(Object.keys(SETTINGS_SCHEMA).filter(k => !STAT_KEYS.has(k)));

function validate(raw) {
    return Object.fromEntries(Object.entries(SETTINGS_SCHEMA).map(([k, schema]) => {
        if (STAT_KEYS.has(k)) {
            const n = Number(raw[k]);
            return [k, (raw[k] != null && !isNaN(n) && n >= 0) ? n : schema.default];
        }
        return [k, coerce(raw[k], schema)];
    }));
}

// ─── Migrations ───────────────────────────────────────────────────────────────

const MIGRATIONS = [
    (s) => { if (s.progressBarUpdateDelay === 10 || s.progressBarUpdateDelay === 100) s.progressBarUpdateDelay = 150; return s; },
];

function applyMigrations(stored) {
    return MIGRATIONS.reduce((s, fn) => fn(s), { ...stored });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function initSettings(reason) {
    try {
        const [synced, local] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(null)]);
        let stored = { ...local, ...synced };
        if (reason === 'update') stored = applyMigrations(stored);
        const validated = validate(stored);
        const syncData  = Object.fromEntries(Object.entries(validated).filter(([k]) =>  SYNC_KEYS.has(k)));
        const localData = Object.fromEntries(Object.entries(validated).filter(([k]) => !SYNC_KEYS.has(k)));
        await Promise.all([chrome.storage.sync.set(syncData), chrome.storage.local.set(localData)]);
        console.log(`[FFRW] Settings initialized (${reason})`);
    } catch (err) {
        console.error('[FFRW] Failed to initialize settings, writing defaults:', err);
        try {
            const syncDefaults  = Object.fromEntries(Object.entries(DEFAULTS).filter(([k]) =>  SYNC_KEYS.has(k)));
            const localDefaults = Object.fromEntries(Object.entries(DEFAULTS).filter(([k]) => !SYNC_KEYS.has(k)));
            await Promise.all([chrome.storage.sync.set(syncDefaults), chrome.storage.local.set(localDefaults)]);
        } catch (e) { console.error('[FFRW] Critical: could not write defaults:', e); }
    }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason === 'install' || reason === 'update') await initSettings(reason);
    if (reason === 'install') {
        try { await chrome.tabs.create({ url: 'https://laskco.github.io/YouTube-FF-RW-Changelogs/' }); } catch (e) { console.error('[FFRW] Failed to open changelog:', e); }
    }
});

// ─── Popup port (live stats) ──────────────────────────────────────────────────
// Persistent port per tab so the background can push live stat updates to the
// popup without polling. Port opens when the popup opens, closes when it closes.

const popupPorts = {};

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'ffrw-popup') return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (!tabId) return;
        popupPorts[tabId] = port;
        chrome.storage.local.get(['stats_totalSecondsSkipped','stats_totalSkips','stats_buttonSkips','stats_keyboardSkips','recentErrors'], (data) => {
            try {
                port.postMessage({
                    action: 'statsSnapshot',
                    stats: {
                        totalSecondsSkipped: data.stats_totalSecondsSkipped ?? 0,
                        totalSkips:          data.stats_totalSkips          ?? 0,
                        buttonSkips:         data.stats_buttonSkips         ?? 0,
                        keyboardSkips:       data.stats_keyboardSkips       ?? 0,
                    },
                    errorCount: (data.recentErrors ?? []).length,
                });
            } catch (_) {}
        });
        port.onDisconnect.addListener(() => { delete popupPorts[tabId]; });
    });
});

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.action === 'getDefaultSettings') {
        respond({ ok: true, settings: DEFAULTS });
        return false;
    }

    if (msg.action === 'statsUpdated' && sender.tab?.id) {
        const port = popupPorts[sender.tab.id];
        if (port) try { port.postMessage({ action: 'statsUpdated', stats: msg.stats }); } catch (_) {}
        return false;
    }

    if (msg.action === 'getRecentErrors') {
        chrome.storage.local.get('recentErrors', (data) => respond({ ok: true, errors: data.recentErrors ?? [] }));
        return true;
    }

    respond({ ok: false, error: `Unknown action: ${msg.action}` });
    return false;
});

// ─── Sync → tab broadcast ─────────────────────────────────────────────────────

chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'sync') return;
    // _uiAdvancedOpen is popup UI state only — never broadcast to content scripts
    const relevantKeys = Object.keys(changes).filter(k => SYNC_KEYS.has(k) && k !== '_uiAdvancedOpen');
    if (!relevantKeys.length) return;
    try {
        const [synced, local] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(null)]);
        const settings = { ...local, ...synced };
        const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
        for (const tab of tabs) {
            if (tab.id) chrome.tabs.sendMessage(tab.id, { action: 'updateSettings', settings }).catch(() => {});
        }
    } catch (e) { console.error('[FFRW] Failed to broadcast sync change:', e); }
});

// ─── Global error guard ───────────────────────────────────────────────────────

self.addEventListener('unhandledrejection', (e) => { console.error('[FFRW] Unhandled rejection in background:', e.reason); });
