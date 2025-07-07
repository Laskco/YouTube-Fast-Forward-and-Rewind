browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === "install" || details.reason === "update") {
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
          actionDelay: 20,
          buttonPosition: 'left',
          advancedWarningAcknowledged: false,
          btnFwdPreset1Value: 5, btnFwdPreset2Value: 10, btnFwdPreset3Value: 15, btnFwdPreset4Value: 30,
          btnBwdPreset1Value: 5, btnBwdPreset2Value: 10, btnBwdPreset3Value: 15, btnBwdPreset4Value: 30,
          kbdFwdPreset1Value: 5, kbdFwdPreset2Value: 10, kbdFwdPreset3Value: 15, kbdFwdPreset4Value: 30,
          kbdBwdPreset1Value: 5, kbdBwdPreset2Value: 10, kbdBwdPreset3Value: 15, kbdBwdPreset4Value: 30,
          theme: 'dark',
          stats_totalSecondsSkipped: 0,
          stats_totalSkips: 0,
          stats_buttonSkips: 0,
          stats_keyboardSkips: 0
        };

        const storedSettings = await browser.storage.local.get(null);

        const newSettings = { ...defaultSettings, ...storedSettings };

        newSettings.stats_totalSecondsSkipped = storedSettings.stats_totalSecondsSkipped || 0;
        newSettings.stats_totalSkips = storedSettings.stats_totalSkips || 0;
        newSettings.stats_buttonSkips = storedSettings.stats_buttonSkips || 0;
        newSettings.stats_keyboardSkips = storedSettings.stats_keyboardSkips || 0;

        await browser.storage.local.set(newSettings);
    }
});