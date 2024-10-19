let buttonsInjected = false;

// Function to inject buttons into the video player
function injectButtons() {
  const videoPlayer = document.querySelector("video.html5-main-video");
  if (!videoPlayer) {
    console.log("Video player not found.");
    return;
  }

  // Create container for custom buttons
  const customButtonsContainer = document.createElement("div");
  customButtonsContainer.id = "customButtonsContainer";
  customButtonsContainer.style.position = "relative";
  customButtonsContainer.style.left = "0";
  customButtonsContainer.style.top = "0";
  customButtonsContainer.style.display = "flex";
  customButtonsContainer.style.alignItems = "center";
  customButtonsContainer.style.height = "100%";
  customButtonsContainer.style.zIndex = "1000";

  // Create fast forward button
  const fastForwardButton = document.createElement("button");
  fastForwardButton.id = "fastForwardButton";
  fastForwardButton.style.backgroundImage = `url(${browser.runtime.getURL("icons/forward.png")})`;
  fastForwardButton.style.width = "50px"; // Set width
  fastForwardButton.style.height = "50px"; // Set height
  fastForwardButton.style.backgroundSize = "contain";
  fastForwardButton.style.backgroundColor = "transparent"; // Remove default background
  fastForwardButton.style.border = "none"; // Remove border
  fastForwardButton.style.cursor = "pointer";
  fastForwardButton.style.padding = "0"; // Remove padding
  fastForwardButton.style.marginTop = "0px"; // Adjust vertical position
  fastForwardButton.style.marginLeft = "-5px"; // Adjust to bring closer together
  fastForwardButton.onclick = () => {
    videoPlayer.currentTime += 10; // Fast forward 10 seconds
  };

  // Create rewind button
  const rewindButton = document.createElement("button");
  rewindButton.id = "rewindButton";
  rewindButton.style.backgroundImage = `url(${browser.runtime.getURL("icons/rewind.png")})`;
  rewindButton.style.width = "50px"; // Set width
  rewindButton.style.height = "50px"; // Set height
  rewindButton.style.backgroundSize = "contain";
  rewindButton.style.backgroundColor = "transparent"; // Remove default background
  rewindButton.style.border = "none"; // Remove border
  rewindButton.style.cursor = "pointer";
  rewindButton.style.padding = "0"; // Remove padding
  rewindButton.style.marginTop = "0px"; // Adjust vertical position
  rewindButton.style.marginRight = "-5px"; // Adjust to bring closer together
  rewindButton.onclick = () => {
    videoPlayer.currentTime -= 10; // Rewind 10 seconds
  };

  customButtonsContainer.appendChild(rewindButton);
  customButtonsContainer.appendChild(fastForwardButton);

  // Append buttons to the video player's controls container
  const controlsContainer = document.querySelector(".ytp-left-controls");
  if (controlsContainer) {
    const timeDisplay = controlsContainer.querySelector(".ytp-time-display.notranslate");
    if (timeDisplay) {
      controlsContainer.insertBefore(customButtonsContainer, timeDisplay.nextSibling);
    } else {
      controlsContainer.appendChild(customButtonsContainer);
    }
    console.log("Buttons injected successfully!");
  } else {
    console.log("Controls container not found.");
  }

  // Add keyboard event listener
  // document.addEventListener("keydown", handleKeyDown);

  buttonsInjected = true; // Set to true to avoid multiple injections
}

// Function to handle keydown events
// function handleKeyDown(event) {
//   const videoPlayer = document.querySelector("video.html5-main-video");
//   if (!videoPlayer) return;

//   switch (event.key) {
//     case "ArrowRight":
//       event.preventDefault();
//       videoPlayer.currentTime += 5;
//       break;
//     case "ArrowLeft":
//       event.preventDefault();
//       videoPlayer.currentTime -= 5;
//       break;
//   }
// }

// Function to remove buttons from the video player
function removeButtons() {
  const fastForwardButton = document.getElementById("fastForwardButton");
  const rewindButton = document.getElementById("rewindButton");

  if (fastForwardButton) fastForwardButton.remove();
  if (rewindButton) rewindButton.remove();

  buttonsInjected = false; // Reset flag
  console.log("Buttons removed successfully!");
}

// Function to check if the extension is enabled
function checkExtensionState() {
  return browser.storage.local.get("isEnabled").then(data => {
    return data.isEnabled !== undefined ? data.isEnabled : true; // Default to enabled
  });
}

// Observe changes in the DOM to inject buttons when the video player is loaded
const observer = new MutationObserver(() => {
  checkExtensionState().then(isEnabled => {
    if (isEnabled && document.querySelector("video.html5-main-video") && !buttonsInjected) {
      injectButtons();
    } else if (!isEnabled && buttonsInjected) {
      removeButtons(); // Remove buttons if the extension is disabled
    }
  });
});

// Start observing the body for changes
observer.observe(document.body, { childList: true, subtree: true });

// Listen for messages to update the extension state
browser.runtime.onMessage.addListener((message) => {
  if (message.action === "updateState") {
    if (message.isEnabled) {
      injectButtons(); // Re-inject buttons if enabled
    } else {
      removeButtons(); // Remove buttons if disabled
    }
  }
});
