'use strict';

// Settings that affect playback are synchronized by the browser. Statistics,
// diagnostic data, and transient popup state stay local to this profile.
const SETTINGS_SCHEMA = {
    extensionEnabled:          { type: 'boolean', default: true },
    buttonSkipEnabled:         { type: 'boolean', default: true },
    keyboardShortcutsEnabled:  { type: 'boolean', default: true },
    forwardSkipTime:           { type: 'number',  default: 10,  min: 1,  max: 99 },
    backwardSkipTime:          { type: 'number',  default: 10,  min: 1,  max: 99 },
    keyboardForward:           { type: 'number',  default: 5,   min: 1,  max: 99 },
    keyboardBackward:          { type: 'number',  default: 5,   min: 1,  max: 99 },
    keyboardForwardKey:        { type: 'string',  default: 'ArrowRight', preserveWhitespace: true, maxLength: 64 },
    keyboardBackwardKey:       { type: 'string',  default: 'ArrowLeft',  preserveWhitespace: true, maxLength: 64 },
    seekInterval:              { type: 'number',  default: 150, min: 50, max: 2000 },
    progressBarUpdateDelay:    { type: 'number',  default: 150, min: 0,  max: 2000 },
    navigationInitDelay:       { type: 'number',  default: 250, min: 0,  max: 5000 },
    ignoreBufferingProtection: { type: 'boolean', default: false },
    buttonPosition:            { type: 'string',  default: 'left', enum: ['left', 'right'] },
    theme:                     { type: 'string',  default: 'dark', enum: ['dark', 'light'] },
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
    stats_totalSecondsSkipped: { type: 'number', default: 0, min: 0, integer: false },
    stats_totalSkips:          { type: 'number', default: 0, min: 0 },
    stats_buttonSkips:         { type: 'number', default: 0, min: 0 },
    stats_keyboardSkips:       { type: 'number', default: 0, min: 0 },
    _uiAdvancedOpen:           { type: 'boolean', default: false },
};

const STAT_KEY_LIST = [
    'stats_totalSecondsSkipped',
    'stats_totalSkips',
    'stats_buttonSkips',
    'stats_keyboardSkips',
];
const UI_KEY_LIST = ['_uiAdvancedOpen'];
const LOCAL_KEY_LIST = [...STAT_KEY_LIST, ...UI_KEY_LIST];
const LOCAL_KEYS = new Set(LOCAL_KEY_LIST);
const SYNC_KEY_LIST = Object.keys(SETTINGS_SCHEMA).filter(key => !LOCAL_KEYS.has(key));
const SYNC_KEYS = new Set(SYNC_KEY_LIST);
const ALL_SETTING_KEYS = Object.keys(SETTINGS_SCHEMA);
const DEPRECATED_KEYS = ['controlsVisibleDuration'];
const DEFAULTS = Object.fromEntries(
    Object.entries(SETTINGS_SCHEMA).map(([key, schema]) => [key, schema.default]),
);

const COERCERS = {
    boolean(value, schema) {
        return typeof value === 'boolean' ? value : schema.default;
    },
    number(value, schema) {
        const number = Number(value);
        if (!Number.isFinite(number)) return schema.default;
        const bounded = Math.max(schema.min ?? -Infinity, Math.min(schema.max ?? Infinity, number));
        return schema.integer === false ? bounded : Math.round(bounded);
    },
    string(value, schema) {
        let string = typeof value === 'string' ? value : schema.default;
        if (!schema.preserveWhitespace) string = string.trim();
        if (!string || string.length > (schema.maxLength ?? 256)) return schema.default;
        return schema.enum?.includes(string) === false ? schema.default : string;
    },
};

function coerce(value, schema) {
    if (value === undefined || value === null) return schema.default;
    return (COERCERS[schema.type] ?? (() => schema.default))(value, schema);
}

function validate(raw = {}) {
    const settings = Object.fromEntries(
        Object.entries(SETTINGS_SCHEMA).map(([key, schema]) => [key, coerce(raw[key], schema)]),
    );
    settings.keyboardForwardKey = canonicalHotkey(settings.keyboardForwardKey);
    settings.keyboardBackwardKey = canonicalHotkey(settings.keyboardBackwardKey);
    if (settings.keyboardForwardKey === settings.keyboardBackwardKey) {
        settings.keyboardBackwardKey = settings.keyboardForwardKey === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
    }
    return settings;
}

function canonicalHotkey(key) {
    return key.length === 1 ? key.toLowerCase() : key;
}

function readAuthoritativeSettings(synced, local) {
    return Object.fromEntries(ALL_SETTING_KEYS.map(key => {
        const primary = SYNC_KEYS.has(key) ? synced : local;
        const legacy = SYNC_KEYS.has(key) ? local : synced;
        return [key, primary[key] ?? legacy[key]];
    }));
}

function selectKeys(source, keys) {
    return Object.fromEntries(keys.map(key => [key, source[key]]));
}

async function initSettings(reason) {
    try {
        const requestedKeys = [...ALL_SETTING_KEYS, ...DEPRECATED_KEYS];
        const [synced, local] = await Promise.all([
            chrome.storage.sync.get(requestedKeys),
            chrome.storage.local.get(requestedKeys),
        ]);
        const stored = readAuthoritativeSettings(synced, local);
        const validated = validate(stored);

        // Write the authoritative copy first. Only after both writes succeed do
        // we remove legacy keys from the wrong storage area.
        await Promise.all([
            chrome.storage.sync.set(selectKeys(validated, SYNC_KEY_LIST)),
            chrome.storage.local.set(selectKeys(validated, LOCAL_KEY_LIST)),
        ]);
        await Promise.all([
            chrome.storage.sync.remove([...LOCAL_KEY_LIST, ...DEPRECATED_KEYS]),
            chrome.storage.local.remove([...SYNC_KEY_LIST, ...DEPRECATED_KEYS]),
        ]);
        console.info(`[FFRW] Settings initialized (${reason})`);
    } catch (error) {
        // A failed read must never be followed by a blanket defaults write: that
        // could destroy valid statistics or synchronized preferences.
        reportBackgroundError('settings initialization', error);
    }
}

async function openChangelog() {
    try {
        await chrome.tabs.create({ url: 'https://laskco.github.io/YouTube-FF-RW-Changelogs/' });
    } catch (error) {
        reportBackgroundError('open changelog', error);
    }
}

async function onInstalled({ reason }) {
    if (reason === 'install' || reason === 'update') await initSettings(reason);
    if (reason === 'install') await openChangelog();
}

chrome.runtime.onInstalled.addListener(onInstalled);

// Serialize statistic writes through the background context so simultaneous
// YouTube tabs cannot overwrite each other's read-modify-write updates.
let statsWriteQueue = Promise.resolve();

function safeStatValue(value, integer = false) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return 0;
    return integer ? Math.floor(number) : number;
}

function normalizeStatsDelta(delta = {}) {
    return {
        totalSecondsSkipped: safeStatValue(delta.totalSecondsSkipped),
        totalSkips:          safeStatValue(delta.totalSkips, true),
        buttonSkips:         safeStatValue(delta.buttonSkips, true),
        keyboardSkips:       safeStatValue(delta.keyboardSkips, true),
    };
}

function statsSnapshot(data = {}) {
    return {
        totalSecondsSkipped: safeStatValue(data.stats_totalSecondsSkipped),
        totalSkips:          safeStatValue(data.stats_totalSkips, true),
        buttonSkips:         safeStatValue(data.stats_buttonSkips, true),
        keyboardSkips:       safeStatValue(data.stats_keyboardSkips, true),
    };
}

function queueStatsWork(work) {
    const next = statsWriteQueue.then(work, work);
    statsWriteQueue = next.catch(() => {});
    return next;
}

async function applyStatsDelta(rawDelta) {
    const delta = normalizeStatsDelta(rawDelta);
    const stored = await chrome.storage.local.get(STAT_KEY_LIST);
    const updated = {
        stats_totalSecondsSkipped: safeStatValue(stored.stats_totalSecondsSkipped) + delta.totalSecondsSkipped,
        stats_totalSkips:          safeStatValue(stored.stats_totalSkips, true)    + delta.totalSkips,
        stats_buttonSkips:         safeStatValue(stored.stats_buttonSkips, true)   + delta.buttonSkips,
        stats_keyboardSkips:       safeStatValue(stored.stats_keyboardSkips, true) + delta.keyboardSkips,
    };
    await chrome.storage.local.set(updated);
    return statsSnapshot(updated);
}

async function resetStats() {
    const reset = Object.fromEntries(STAT_KEY_LIST.map(key => [key, 0]));
    await chrome.storage.local.set(reset);
    return statsSnapshot(reset);
}

function isMissingMessageReceiver(reason) {
    return /receiving end does not exist|could not establish connection/i.test(serializeError(reason));
}

function tabStatsFlushFailed(result) {
    if (result.status === 'fulfilled') return result.value?.ok !== true;
    return !isMissingMessageReceiver(result.reason);
}

function tabStatsFlushError(result) {
    if (result.status === 'rejected') return serializeError(result.reason);
    return result.value?.error || 'A YouTube tab did not acknowledge the statistics flush';
}

async function flushPendingTabStats() {
    let tabs;
    try {
        tabs = await chrome.tabs.query({ url: 'https://*.youtube.com/*' });
    } catch (error) {
        reportBackgroundError('query tabs before statistics reset', error);
        throw error;
    }

    const results = await Promise.allSettled(
        tabs
            .filter(tab => Number.isInteger(tab.id))
            .map(tab => chrome.tabs.sendMessage(tab.id, { action: 'flushPendingStats' })),
    );
    const failedFlush = results.find(tabStatsFlushFailed);
    if (failedFlush) throw new Error(tabStatsFlushError(failedFlush));
}

function serializeError(error) {
    if (error instanceof Error) return error.message;
    return String(error ?? 'Unknown error');
}

function handleDefaultSettings(_message, _sender, respond) {
    respond({ ok: true, settings: { ...DEFAULTS } });
    return false;
}

function handleRecordStats(message, _sender, respond) {
    queueStatsWork(() => applyStatsDelta(message.delta)).then(
        stats => respond({ ok: true, stats }),
        error => respond({ ok: false, error: serializeError(error) }),
    );
    return true;
}

function handleResetStats(_message, _sender, respond) {
    flushPendingTabStats().then(() => queueStatsWork(resetStats)).then(
        stats => respond({ ok: true, stats }),
        error => respond({ ok: false, error: serializeError(error) }),
    );
    return true;
}

function isActionableErrorEntry(entry) {
    return !(entry?.context === 'video error' && entry?.message === '[object Event]');
}

async function readRecentErrors() {
    const data = await chrome.storage.local.get('recentErrors');
    const stored = Array.isArray(data.recentErrors) ? data.recentErrors : [];
    const errors = stored.filter(isActionableErrorEntry).slice(-10);
    if (errors.length !== stored.length) await chrome.storage.local.set({ recentErrors: errors });
    return errors;
}

function handleRecentErrors(_message, _sender, respond) {
    readRecentErrors().then(
        errors => respond({ ok: true, errors }),
        error => respond({ ok: false, error: serializeError(error), errors: [] }),
    );
    return true;
}

let errorWriteQueue = Promise.resolve();

function sanitizeErrorEntry(entry = {}) {
    const sanitized = {
        ts: typeof entry.ts === 'string' ? entry.ts.slice(0, 40) : new Date().toISOString(),
        context: String(entry.context ?? 'unknown').slice(0, 120),
        message: String(entry.message ?? 'Unknown error').slice(0, 1000),
    };
    if (typeof entry.stack === 'string') sanitized.stack = entry.stack.slice(0, 6000);
    return sanitized;
}

async function appendRecentError(entry) {
    const sanitized = sanitizeErrorEntry(entry);
    if (!isActionableErrorEntry(sanitized)) return;
    const data = await chrome.storage.local.get('recentErrors');
    const errors = Array.isArray(data.recentErrors)
        ? data.recentErrors.filter(isActionableErrorEntry).slice(-9)
        : [];
    errors.push(sanitized);
    await chrome.storage.local.set({ recentErrors: errors });
}

function queueRecentError(entry) {
    const next = errorWriteQueue.then(() => appendRecentError(entry), () => appendRecentError(entry));
    errorWriteQueue = next.catch(() => {});
    return next;
}

function handleLogError(message, _sender, respond) {
    queueRecentError(message.entry).then(
        () => respond({ ok: true }),
        error => respond({ ok: false, error: serializeError(error) }),
    );
    return true;
}

function handleUnknownAction(message, _sender, respond) {
    respond({ ok: false, error: `Unknown action: ${String(message?.action ?? '')}` });
    return false;
}

const MESSAGE_HANDLERS = {
    getDefaultSettings: handleDefaultSettings,
    getRecentErrors:    handleRecentErrors,
    logError:           handleLogError,
    recordStats:        handleRecordStats,
    resetStats:         handleResetStats,
};

function onRuntimeMessage(message, sender, respond) {
    if (!message || typeof message !== 'object') return handleUnknownAction(message, sender, respond);
    return (MESSAGE_HANDLERS[message.action] ?? handleUnknownAction)(message, sender, respond);
}

chrome.runtime.onMessage.addListener(onRuntimeMessage);

function createBackgroundErrorEntry(context, error) {
    return sanitizeErrorEntry({
        ts: new Date().toISOString(),
        context,
        message: serializeError(error),
        stack: error instanceof Error ? error.stack : undefined,
    });
}

function reportBackgroundError(context, error) {
    console.error('[FFRW]', context, error);
    queueRecentError(createBackgroundErrorEntry(context, error)).catch(() => {});
}

self.addEventListener('unhandledrejection', event => {
    reportBackgroundError('background unhandled rejection', event.reason);
});

self.addEventListener('error', event => {
    reportBackgroundError('background error', event.error ?? event.message);
});
