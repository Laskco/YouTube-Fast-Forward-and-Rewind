// Listen for when the extension is installed or updated (For Firefox bug)
browser.runtime.onInstalled.addListener(function (details) {
    if (details.reason === "update") {
    }
});

// Listen for messages from content scripts
browser.runtime.onMessage.addListener(function (message, sendResponse) {
    // Check if any relevant message properties are present
    if (message.BskipTime !== undefined || message.FskipTime !== undefined || 
        message.triggerFFDelay !== undefined || message.throttleFFDelay !== undefined) {
        
        // Store the received values in local storage
        browser.storage.local.set(message).then(() => {
            // Storage operation successful
            sendResponse({ status: "success" });
        }).catch((error) => {
            console.error("Error storing values:", error);
            sendResponse({ status: "error", message: error });
        });
        return true; 
    }
});
