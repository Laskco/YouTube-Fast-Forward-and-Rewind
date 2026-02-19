// ─── Settings Schema ──────────────────────────────────────────────────────────

const SETTINGS_SCHEMA = {
    // Core toggles
    extensionEnabled:          { type: 'boolean', default: true },
    buttonSkipEnabled:         { type: 'boolean', default: true },
    keyboardShortcutsEnabled:  { type: 'boolean', default: true },

    // Skip amounts
    forwardSkipTime:           { type: 'number',  default: 10,   min: 1,  max: 99 },
    backwardSkipTime:          { type: 'number',  default: 10,   min: 1,  max: 99 },
    keyboardForward:           { type: 'number',  default: 5,    min: 1,  max: 99 },
    keyboardBackward:          { type: 'number',  default: 5,    min: 1,  max: 99 },

    // Key bindings
    keyboardForwardKey:        { type: 'string',  default: 'ArrowRight' },
    keyboardBackwardKey:       { type: 'string',  default: 'ArrowLeft'  },

    // Timing / advanced
    controlsVisibleDuration:   { type: 'number',  default: 2500, min: 0,  max: 10000 },
    seekInterval:              { type: 'number',  default: 150,  min: 0,  max: 2000  },
    progressBarUpdateDelay:    { type: 'number',  default: 150,  min: 0,  max: 2000  },
    navigationInitDelay:       { type: 'number',  default: 250,  min: 0,  max: 5000  },
    ignoreBufferingProtection: { type: 'boolean', default: false },

    // UI
    buttonPosition:            { type: 'string',  default: 'left', enum: ['left', 'right'] },
    theme:                     { type: 'string',  default: 'dark', enum: ['dark', 'light']  },

    // Button presets
    btnFwdPreset1Value: { type: 'number', default: 5,  min: 1, max: 99 },
    btnFwdPreset2Value: { type: 'number', default: 10, min: 1, max: 99 },
    btnFwdPreset3Value: { type: 'number', default: 15, min: 1, max: 99 },
    btnFwdPreset4Value: { type: 'number', default: 30, min: 1, max: 99 },
    btnBwdPreset1Value: { type: 'number', default: 5,  min: 1, max: 99 },
    btnBwdPreset2Value: { type: 'number', default: 10, min: 1, max: 99 },
    btnBwdPreset3Value: { type: 'number', default: 15, min: 1, max: 99 },
    btnBwdPreset4Value: { type: 'number', default: 30, min: 1, max: 99 },

    // Keyboard presets
    kbdFwdPreset1Value: { type: 'number', default: 5,  min: 1, max: 99 },
    kbdFwdPreset2Value: { type: 'number', default: 10, min: 1, max: 99 },
    kbdFwdPreset3Value: { type: 'number', default: 15, min: 1, max: 99 },
    kbdFwdPreset4Value: { type: 'number', default: 30, min: 1, max: 99 },
    kbdBwdPreset1Value: { type: 'number', default: 5,  min: 1, max: 99 },
    kbdBwdPreset2Value: { type: 'number', default: 10, min: 1, max: 99 },
    kbdBwdPreset3Value: { type: 'number', default: 15, min: 1, max: 99 },
    kbdBwdPreset4Value: { type: 'number', default: 30, min: 1, max: 99 },

    // Stats
    stats_totalSecondsSkipped: { type: 'number', default: 0 },
    stats_totalSkips:          { type: 'number', default: 0 },
    stats_buttonSkips:         { type: 'number', default: 0 },
    stats_keyboardSkips:       { type: 'number', default: 0 },
};

const DEFAULTS = Object.fromEntries(
    Object.entries(SETTINGS_SCHEMA).map(([k, v]) => [k, v.default])
);

// ─── Validation ───────────────────────────────────────────────────────────────

function coerce(value, schema) {
    if (value === undefined || value === null) return schema.default;

    switch (schema.type) {
        case 'boolean':
            return typeof value === 'boolean' ? value : schema.default;

        case 'number': {
            const n = Number(value);
            if (isNaN(n)) return schema.default;
            const lo = schema.min ?? -Infinity;
            const hi = schema.max ??  Infinity;
            return Math.max(lo, Math.min(hi, n));
        }

        case 'string': {
            if (typeof value !== 'string') return schema.default;
            const s = value.trim();
            if (schema.enum && !schema.enum.includes(s)) return schema.default;
            return s;
        }

        default:
            return schema.default;
    }
}

function validate(raw) {
    return Object.fromEntries(
        Object.entries(SETTINGS_SCHEMA).map(([k, schema]) => [k, coerce(raw[k], schema)])
    );
}

// ─── Migrations ───────────────────────────────────────────────────────────────

const MIGRATIONS = [
    // Fix progressBarUpdateDelay values that were saved with old defaults
    (s) => {
        if (s.progressBarUpdateDelay === 10 || s.progressBarUpdateDelay === 100) {
            s.progressBarUpdateDelay = 150;
        }
        return s;
    },
];

function applyMigrations(stored) {
    return MIGRATIONS.reduce((s, fn) => fn(s), { ...stored });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function initSettings(reason) {
    try {
        let stored = await chrome.storage.local.get(null);

        if (reason === 'update') {
            stored = applyMigrations(stored);
        }

        const validated = validate(stored);
        await chrome.storage.local.set(validated);
        console.log(`[FFRW] Settings initialized (${reason})`);
    } catch (err) {
        console.error('[FFRW] Failed to initialize settings, writing defaults:', err);
        try {
            await chrome.storage.local.set(DEFAULTS);
        } catch (e) {
            console.error('[FFRW] Critical: could not write defaults:', e);
        }
    }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason === 'install' || reason === 'update') {
        await initSettings(reason);
    }
    if (reason === 'install') {
        try {
            await chrome.tabs.create({ url: 'https://laskco.github.io/YouTube-FF-RW-Changelogs/' });
        } catch (e) {
            console.error('[FFRW] Failed to open changelog:', e);
        }
    }
});

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    switch (msg.action) {
        case 'getDefaultSettings':
            respond({ ok: true, settings: DEFAULTS });
            return false;

        default:
            respond({ ok: false, error: `Unknown action: ${msg.action}` });
    }
});

// ─── Global error guard ───────────────────────────────────────────────────────

self.addEventListener('unhandledrejection', (e) => {
    console.error('[FFRW] Unhandled rejection in background:', e.reason);
});
