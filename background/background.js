const SETTING_DEFINITIONS = {
    extensionEnabled: { type: 'boolean', default: true },
    buttonSkipEnabled: { type: 'boolean', default: true },
    keyboardShortcutsEnabled: { type: 'boolean', default: true },
    forwardSkipTime: { type: 'number', default: 10, min: 1, max: 99 },
    backwardSkipTime: { type: 'number', default: 10, min: 1, max: 99 },
    keyboardForward: { type: 'number', default: 5, min: 1, max: 99 },
    keyboardBackward: { type: 'number', default: 5, min: 1, max: 99 },
    keyboardForwardKey: { type: 'string', default: 'ArrowRight' },
    keyboardBackwardKey: { type: 'string', default: 'ArrowLeft' },
    actionTimingEnabled: { type: 'boolean', default: true },
    actionDelay: { type: 'number', default: 20, min: 0, max: 2000 },
    seekThrottle: { type: 'number', default: 100, min: 0, max: 2000 },
    controlsVisibleDuration: { type: 'number', default: 2500, min: 0, max: 10000 },
    seekInterval: { type: 'number', default: 150, min: 0, max: 2000 },
    progressBarUpdateDelay: { type: 'number', default: 10, min: 0, max: 2000 },
    navigationInitDelay: { type: 'number', default: 250, min: 0, max: 5000 },
    buttonPosition: { type: 'string', default: 'left', enum: ['left', 'right'] },
    enhancedAdSkipEnabled: { type: 'boolean', default: true },
    advancedWarningAcknowledged: { type: 'boolean', default: false },
    btnFwdPreset1Value: { type: 'number', default: 5, min: 1, max: 99 },
    btnFwdPreset2Value: { type: 'number', default: 10, min: 1, max: 99 },
    btnFwdPreset3Value: { type: 'number', default: 15, min: 1, max: 99 },
    btnFwdPreset4Value: { type: 'number', default: 30, min: 1, max: 99 },
    btnBwdPreset1Value: { type: 'number', default: 5, min: 1, max: 99 },
    btnBwdPreset2Value: { type: 'number', default: 10, min: 1, max: 99 },
    btnBwdPreset3Value: { type: 'number', default: 15, min: 1, max: 99 },
    btnBwdPreset4Value: { type: 'number', default: 30, min: 1, max: 99 },
    kbdFwdPreset1Value: { type: 'number', default: 5, min: 1, max: 99 },
    kbdFwdPreset2Value: { type: 'number', default: 10, min: 1, max: 99 },
    kbdFwdPreset3Value: { type: 'number', default: 15, min: 1, max: 99 },
    kbdFwdPreset4Value: { type: 'number', default: 30, min: 1, max: 99 },
    kbdBwdPreset1Value: { type: 'number', default: 5, min: 1, max: 99 },
    kbdBwdPreset2Value: { type: 'number', default: 10, min: 1, max: 99 },
    kbdBwdPreset3Value: { type: 'number', default: 15, min: 1, max: 99 },
    kbdBwdPreset4Value: { type: 'number', default: 30, min: 1, max: 99 },
    theme: { type: 'string', default: 'dark', enum: ['dark', 'light'] },
    stats_totalSecondsSkipped: { type: 'number', default: 0 },
    stats_totalSkips: { type: 'number', default: 0 },
    stats_buttonSkips: { type: 'number', default: 0 },
    stats_keyboardSkips: { type: 'number', default: 0 }
};

const DEFAULT_SETTINGS = Object.fromEntries(
    Object.entries(SETTING_DEFINITIONS).map(([key, { default: def }]) => [key, def])
);

function validateSettingValue(value, definition) {
    if (value === undefined || value === null) {
        return definition.default;
    }

    switch (definition.type) {
        case 'boolean':
            return typeof value === 'boolean' ? value : definition.default;
        case 'number':
            let num = Number(value);
            if (isNaN(num)) return definition.default;
            if (definition.min !== undefined) num = Math.max(definition.min, num);
            if (definition.max !== undefined) num = Math.min(definition.max, num);
            return num;
        case 'string':
            if (typeof value !== 'string') return definition.default;
            if (definition.enum && !definition.enum.includes(value)) return definition.default;
            return value.trim();
        default:
            return definition.default;
    }
}

function validateSettings(settings) {
    const newSettings = {};
    for (const [key, definition] of Object.entries(SETTING_DEFINITIONS)) {
        const storedValue = settings[key];
        newSettings[key] = validateSettingValue(storedValue, definition);
    }
    return newSettings;
}


async function initializeSettings(details) {
    let storedSettings = {};
    try {
        storedSettings = await browser.storage.local.get(null);
        const newSettings = validateSettings(storedSettings);

        await browser.storage.local.set(newSettings);
        console.log(`Extension ${details.reason}: Settings initialized successfully`);

    } catch (error) {
        console.error('Failed to initialize settings:', error);
        try {
            await browser.storage.local.set(DEFAULT_SETTINGS);
            console.log('Fallback: Default settings saved');
        } catch (fallbackError) {
            console.error('Critical error: Could not save any settings:', fallbackError);
        }
    }
}

async function openChangelogPage(reason) {
    try {
        const url = "https://laskco.github.io/YouTube-FF-RW-Changelogs/";
        await browser.tabs.create({ url });
        console.log(`Opened changelog for ${reason}`);
    } catch (error) {
        console.error('Failed to open changelog:', error);
    }
}

browser.runtime.onInstalled.addListener(async (details) => {
    try {
        if (details.reason === "install" || details.reason === "update") {
            await initializeSettings(details);
        }
        if (details.reason === "install") {
            await openChangelogPage(details.reason);
        }
    } catch (error) {
        console.error('Error during extension installation or update:', error);
    }
});

self.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection in background script:', event.reason);
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'getSettings':
            browser.storage.local.get(null)
                .then(settings => sendResponse({ success: true, settings }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
        
        case 'getDefaultSettings':
            sendResponse({ success: true, settings: DEFAULT_SETTINGS });
            return false;

        case 'saveSettings':
            if (message.settings && typeof message.settings === 'object') {
                browser.storage.local.set(message.settings)
                    .then(() => sendResponse({ success: true }))
                    .catch(error => sendResponse({ success: false, error: error.message }));
            } else {
                sendResponse({ success: false, error: 'Invalid settings object' });
            }
            return true;

        default:
            sendResponse({ success: false, error: 'Unknown action' });
    }
});