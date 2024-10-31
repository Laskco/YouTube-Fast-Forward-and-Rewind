// background.js
// Firefox-specific installation handler
browser.runtime.onInstalled.addListener(function (details) {
    if (details.reason === "update") {
        // Handle update-specific logic if needed
    }
});

// Listen for messages from content scripts
browser.runtime.onMessage.addListener(function (message, sendResponse) {
    // Handle settings storage
    if (message.BskipTime !== undefined || message.FskipTime !== undefined ||
        message.triggerFFDelay !== undefined || message.throttleFFDelay !== undefined) {
       
        // Store the received values in local storage
        browser.storage.local.set(message).then(() => {
            sendResponse({ status: "success" });
        }).catch((error) => {
            console.error("Error storing values:", error);
            sendResponse({ status: "error", message: error });
        });
        return true;
    }
});

// Handle tab updates for extension initialization
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.includes('youtube.com')) {
        browser.tabs.sendMessage(tabId, { action: 'initializeExtension' })
            .catch(error => console.log('Tab not ready yet:', error));
    }
});

// content.js
let isInitialized = false;

function initializeExtension() {
    if (isInitialized) return;
    
    // Load stored settings first
    browser.storage.local.get([
        'BskipTime',
        'FskipTime',
        'triggerFFDelay',
        'throttleFFDelay'
    ]).then(settings => {
        setupFastForwardControls(settings);
        console.log('Fast Forward controls initialized with settings:', settings);
        isInitialized = true;
    }).catch(error => {
        console.error('Error loading settings:', error);
    });
}

function setupFastForwardControls(settings) {
    // Your existing setup code here
}

// Listen for background script messages
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'initializeExtension') {
        initializeExtension();
    }
});

// Handle YouTube's SPA navigation
let lastUrl = location.href;
const observer = new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        // Reset initialization flag when URL changes
        isInitialized = false;
        initializeExtension();
    }
});

// Start observing page changes
observer.observe(document, { subtree: true, childList: true });

// Initial page load handlers
if (document.readyState === 'complete') {
    initializeExtension();
} else {
    document.addEventListener('DOMContentLoaded', initializeExtension);
    // Backup initialization
    window.addEventListener('load', initializeExtension);
}