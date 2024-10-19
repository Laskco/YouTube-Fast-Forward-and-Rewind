// Function to toggle the extension on or off
function toggleExtension() {
    // Get the current state from storage
    browser.storage.local.get("isEnabled").then((data) => {
        const currentState = data.isEnabled !== undefined ? data.isEnabled : true; // Default to enabled
        const newState = !currentState;

        // Update the state in storage
        browser.storage.local.set({ isEnabled: newState }).then(() => {
            // Update the button text based on the new state
            document.getElementById("toggleButton").textContent = newState ? "Disable Extension" : "Enable Extension";
        });
    });
}

// Set up the button click event listener
document.getElementById("toggleButton").addEventListener("click", toggleExtension);

// Update the button text when the popup opens
document.addEventListener("DOMContentLoaded", () => {
    browser.storage.local.get("isEnabled").then((data) => {
        const isEnabled = data.isEnabled !== undefined ? data.isEnabled : true; // Default to enabled
        document.getElementById("toggleButton").textContent = isEnabled ? "Disable Extension" : "Enable Extension";
    });
});
