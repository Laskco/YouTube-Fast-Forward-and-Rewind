browser.runtime.onInstalled.addListener(function (details) {
    if (details.reason === "update") {
    }
});

browser.runtime.onMessage.addListener(function (message, sendResponse) {
    if (message.BskipTime !== undefined || message.FskipTime !== undefined ||
        message.triggerFFDelay !== undefined || message.throttleFFDelay !== undefined) {
       
        browser.storage.local.set(message).then(() => {
            sendResponse({ status: "success" });
        }).catch((error) => {
            console.error("Error storing values:", error);
            sendResponse({ status: "error", message: error });
        });
        return true;
    }
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.includes('youtube.com')) {
        browser.tabs.sendMessage(tabId, { action: 'initializeExtension' })
            .catch(error => console.log('Tab not ready yet:', error));
    }
});