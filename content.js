const CONFIG = {
  SELECTORS: {
    VIDEO_PLAYERS: [
      'video.html5-main-video',
      '.html5-video-player video',
      '.html5-video-player .html5-main-video',
      '#movie_player video'
    ],
    CONTROLS: '.ytp-left-controls',
    TIME_DISPLAY: '.ytp-time-display.notranslate',
    MOVIE_PLAYER: '#movie_player',
    AUTOHIDE_CLASS_TARGET: '#movie_player',
    AUTOHIDE_CLASS: 'ytp-autohide'
  },
  RETRY: {
    INTERVAL: 250,
    MAX_ATTEMPTS: 20
  },
  DEBOUNCE: {
    NAVIGATION: 300,
    MUTATION: 750,
    FULLSCREEN: 150,
    RESIZE: 250
  },
  STORAGE_KEYS: {
    ENABLED_STATE: 'extensionEnabled',
    BUTTON_SKIP_ENABLED_STATE: 'buttonSkipEnabled',
    KEYBOARD_ENABLED_STATE: 'keyboardShortcutsEnabled',
    FORWARD_SKIP_TIME: 'forwardSkipTime',
    BACKWARD_SKIP_TIME: 'backwardSkipTime',
    KEYBOARD_FORWARD: 'keyboardForward',
    KEYBOARD_BACKWARD: 'keyboardBackward'
  },
  DEFAULT_SETTINGS: {
    extensionEnabled: true,
    buttonSkipEnabled: true,
    keyboardShortcutsEnabled: true,
    forwardSkipTime: 10,
    backwardSkipTime: 10,
    keyboardForward: 5,
    keyboardBackward: 5
  },
  ICONS: {
    FORWARD: 'icons/alt-forward.png',
    REWIND: 'icons/alt-rewind.png'
  },
  IDS: {
    FORWARD_BUTTON: 'fastForwardButton',
    REWIND_BUTTON: 'rewindButton',
    CONTAINER: 'customButtonsContainer'
  }
};

const state = {
  buttonsInjected: false,
  retryAttempts: 0,
  navigationObserver: null,
  playerObserver: null,
  lastVideoElement: null,
  lastUrl: window.location.href,
  settings: { ...CONFIG.DEFAULT_SETTINGS },
  isBuffering: false,
  keyListenersAttached: false,
  isHoveringOverCustomButtons: false
};

let retryTimeout = null;

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function isEditable(element) {
    if (!element) return false;
    const tagName = element.tagName ? element.tagName.toUpperCase() : '';
    return element.isContentEditable ||
           tagName === 'INPUT' ||
           tagName === 'TEXTAREA' ||
           tagName === 'SELECT';
}

function isWatchPage() {
   try {
    return window.location.pathname === '/watch';
  } catch(e) { return false; }
}

function findMoviePlayerElement() {
    return document.querySelector(CONFIG.SELECTORS.MOVIE_PLAYER);
}

function findVideoPlayerElement() {
  if (state.lastVideoElement && document.body.contains(state.lastVideoElement) && typeof state.lastVideoElement.currentTime === 'number') {
      return state.lastVideoElement;
  }
  for (const selector of CONFIG.SELECTORS.VIDEO_PLAYERS) {
    try {
        const player = document.querySelector(selector);
        if (player && player.tagName === 'VIDEO' && typeof player.currentTime === 'number') {
            state.lastVideoElement = player;
            addBufferingListeners(player);
            return player;
        }
    } catch(e) { }
  }
  if (state.lastVideoElement) {
      removeBufferingListeners(state.lastVideoElement);
      state.lastVideoElement = null;
  }
  return null;
}

function findControlsContainerElement() {
    const moviePlayer = findMoviePlayerElement();
    if (moviePlayer) {
        return moviePlayer.querySelector(CONFIG.SELECTORS.CONTROLS);
    }
    return document.querySelector(CONFIG.SELECTORS.CONTROLS);
}

function keepControlsVisible() {
    state.isHoveringOverCustomButtons = true;
    const player = findMoviePlayerElement();
    if (player && player.classList.contains(CONFIG.SELECTORS.AUTOHIDE_CLASS)) {
        player.classList.remove(CONFIG.SELECTORS.AUTOHIDE_CLASS);
    }
}

function handleMouseLeaveCustomButtons() {
    state.isHoveringOverCustomButtons = false;
}

function createButton(id, iconPath) {
  const button = document.createElement('button');
  button.id = id;
  button.style.cssText = `
    width: 40px;
    height: 50px;
    background-image: url(${browser.runtime.getURL(iconPath)});
    background-size: 80%;
    background-color: transparent;
    background-repeat: no-repeat;
    background-position: center 15px;
    border: none;
    cursor: pointer;
    padding: 0;
    margin-top: -3px;
    transition: opacity 0.2s;
    opacity: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    z-index: 999;
    flex-shrink: 0;
  `;

  const counter = document.createElement('div');
  counter.id = `${id}-counter`;
  counter.style.cssText = `
    position: absolute;
    bottom: 16px;
    left: ${id === CONFIG.IDS.FORWARD_BUTTON ? 'calc(50% - 2px)' : '50%'};
    transform: translate(-50%, 0);
    width: 100%;
    text-align: center;
    color: white;
    pointer-events: none;
    font-size: 15px;
    font-family: 'Roboto', 'Arial', sans-serif;
    font-weight: 500;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.7);
  `;

  button.appendChild(counter);
  button.addEventListener('mouseover', () => button.style.opacity = '0.8');
  button.addEventListener('mouseout', () => button.style.opacity = '1');
  return button;
}

function updateButtonCounters() {
    const container = document.getElementById(CONFIG.IDS.CONTAINER);
    if (!container || !state.settings) return;
    const forwardCounter = container.querySelector(`#${CONFIG.IDS.FORWARD_BUTTON}-counter`);
    const backwardCounter = container.querySelector(`#${CONFIG.IDS.REWIND_BUTTON}-counter`);
    const showCounters = state.settings.extensionEnabled && state.settings.buttonSkipEnabled;
    const forwardTime = state.settings.forwardSkipTime || CONFIG.DEFAULT_SETTINGS.forwardSkipTime;
    const backwardTime = state.settings.backwardSkipTime || CONFIG.DEFAULT_SETTINGS.backwardSkipTime;
    if (forwardCounter) forwardCounter.textContent = showCounters ? forwardTime : '';
    if (backwardCounter) backwardCounter.textContent = showCounters ? backwardTime : '';
}

function createButtonsContainer() {
  const container = document.createElement('div');
  container.id = CONFIG.IDS.CONTAINER;
  container.style.cssText = `
    position: relative;
    left: 0;
    top: 0;
    display: flex;
    align-items: center;
    height: 100%;
    z-index: 1000;
    transition: opacity 0.1s linear;
  `;
  const rewindButton = createButton(CONFIG.IDS.REWIND_BUTTON, CONFIG.ICONS.REWIND);
  const forwardButton = createButton(CONFIG.IDS.FORWARD_BUTTON, CONFIG.ICONS.FORWARD);
  rewindButton.style.marginRight = '2px';
  forwardButton.style.marginLeft = '2px';
  container.appendChild(rewindButton);
  container.appendChild(forwardButton);
  container.addEventListener('click', handleButtonClick, { capture: true });
  container.addEventListener('mouseenter', keepControlsVisible);
  container.addEventListener('mouseleave', handleMouseLeaveCustomButtons);
  return container;
}

function handleButtonClick(event) {
    if (!state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) return;
    const button = event.target.closest('button');
    if (!button || button.parentElement?.id !== CONFIG.IDS.CONTAINER) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const currentVideoPlayer = findVideoPlayerElement();
    if (!currentVideoPlayer || currentVideoPlayer.readyState < 1 || currentVideoPlayer.seeking || state.isBuffering) return;
    try {
        let skipTime = 0; let newTime;
        if (button.id === CONFIG.IDS.FORWARD_BUTTON) {
            skipTime = state.settings.forwardSkipTime || CONFIG.DEFAULT_SETTINGS.forwardSkipTime;
            newTime = Math.min(currentVideoPlayer.duration || Infinity, currentVideoPlayer.currentTime + skipTime);
        } else if (button.id === CONFIG.IDS.REWIND_BUTTON) {
            skipTime = -(state.settings.backwardSkipTime || CONFIG.DEFAULT_SETTINGS.backwardSkipTime);
            newTime = Math.max(0, currentVideoPlayer.currentTime + skipTime);
        }
         if (newTime !== undefined && !isNaN(newTime) && Math.abs(currentVideoPlayer.currentTime - newTime) > 0.01) {
            currentVideoPlayer.currentTime = newTime;
         }
    } catch (e) { console.error("YT FF/RW: Error setting currentTime on button click:", e); }
}

function injectButtons() {
    if (!state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) {
      removeButtons(); return false;
    }
    const moviePlayer = findMoviePlayerElement();
    if (moviePlayer && moviePlayer.classList.contains('ad-showing')) {
         removeButtons(); return false;
    }
    const videoPlayer = findVideoPlayerElement();
    const controlsContainer = findControlsContainerElement();
    if (!videoPlayer || !controlsContainer) {
      if (state.buttonsInjected) removeButtons(); return false;
    }
    let existingContainer = document.getElementById(CONFIG.IDS.CONTAINER);
    if (existingContainer && existingContainer.parentNode === controlsContainer) {
        updateButtonCounters(); state.buttonsInjected = true; return true;
    }
    removeButtons();
    const buttonsContainer = createButtonsContainer();
    const timeDisplay = controlsContainer.querySelector(CONFIG.SELECTORS.TIME_DISPLAY);
    try {
        if (timeDisplay && timeDisplay.parentNode === controlsContainer) {
            controlsContainer.insertBefore(buttonsContainer, timeDisplay.nextSibling);
        } else { controlsContainer.appendChild(buttonsContainer); }
        updateButtonCounters(); state.buttonsInjected = true; return true;
    } catch (e) { console.error("YT FF/RW: Error injecting buttons:", e); removeButtons(); return false; }
}

function removeButtons() {
  const container = document.getElementById(CONFIG.IDS.CONTAINER);
  if (container) {
    try {
        container.removeEventListener('click', handleButtonClick, { capture: true });
        container.removeEventListener('mouseenter', keepControlsVisible);
        container.removeEventListener('mouseleave', handleMouseLeaveCustomButtons);
        if (container.parentNode) container.remove();
    } catch(e) { console.error("YT FF/RW: Error removing buttons container:", e); }
  }
  state.buttonsInjected = false;
  if (state.isHoveringOverCustomButtons) state.isHoveringOverCustomButtons = false;
}

function handleVideoWaiting() { state.isBuffering = true; }
function handleVideoPlaying() { state.isBuffering = false; }
function addBufferingListeners(videoElement) {
    if (!videoElement) return;
    removeBufferingListeners(videoElement);
    videoElement.addEventListener('waiting', handleVideoWaiting);
    videoElement.addEventListener('playing', handleVideoPlaying);
    videoElement.addEventListener('stalled', handleVideoWaiting);
    videoElement.addEventListener('canplay', handleVideoPlaying);
    state.isBuffering = videoElement.readyState < 3 || (!videoElement.paused && videoElement.seeking);
}
function removeBufferingListeners(videoElement) {
    if (!videoElement) return;
    videoElement.removeEventListener('waiting', handleVideoWaiting);
    videoElement.removeEventListener('playing', handleVideoPlaying);
    videoElement.removeEventListener('stalled', handleVideoWaiting);
    videoElement.removeEventListener('canplay', handleVideoPlaying);
}

function sanitizeSkipTimeSettings(settingsObject) {
    const numericKeys = [
        'forwardSkipTime', 'backwardSkipTime',
        'keyboardForward', 'keyboardBackward'
    ];
    const newSettings = { ...settingsObject };
    for (const key of numericKeys) {
        let value = newSettings[key];
        let defaultValue = CONFIG.DEFAULT_SETTINGS[key];
        if (typeof value === 'string') {
            const parsedValue = parseInt(value, 10);
            if (!isNaN(parsedValue)) {
                newSettings[key] = parsedValue;
            } else {
                newSettings[key] = defaultValue;
            }
        } else if (typeof value !== 'number' || isNaN(value)) {
            newSettings[key] = defaultValue;
        }
        if (key.includes('Forward') || key.includes('forwardSkipTime')) {
            if (newSettings[key] < 1) newSettings[key] = defaultValue > 0 ? defaultValue : 1;
        }
        if (key.includes('Backward') || key.includes('backwardSkipTime')) {
             if (newSettings[key] < 1) newSettings[key] = defaultValue > 0 ? defaultValue : 1;
        }
    }
    return newSettings;
}

function handleKeyDown(event) {
  if (!state.settings.extensionEnabled || !state.settings.keyboardShortcutsEnabled) return;
  if (isEditable(document.activeElement)) return;
  const isLeft = event.key === 'ArrowLeft'; const isRight = event.key === 'ArrowRight';
  if (!isLeft && !isRight) return;
  const shouldOverride = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;

  if (shouldOverride) {
    const videoPlayer = findVideoPlayerElement();

    console.log("--- YT FF/RW KeyDown ---");
    console.log("Raw state.settings.keyboardForward:", state.settings.keyboardForward, typeof state.settings.keyboardForward);
    console.log("Raw state.settings.keyboardBackward:", state.settings.keyboardBackward, typeof state.settings.keyboardBackward);

    if (!videoPlayer || videoPlayer.readyState < 1 || state.isBuffering || videoPlayer.seeking) {
        console.log("Video not ready or buffering/seeking.");
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); return;
    }
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    try {
        const skipTimeSettingForward = state.settings.keyboardForward || CONFIG.DEFAULT_SETTINGS.keyboardForward;
        const skipTimeSettingBackward = state.settings.keyboardBackward || CONFIG.DEFAULT_SETTINGS.keyboardBackward;

        console.log("Using forward setting:", skipTimeSettingForward);
        console.log("Using backward setting:", skipTimeSettingBackward);

        const skipTime = isRight ? skipTimeSettingForward : -skipTimeSettingBackward;

        console.log("Calculated skipTime:", skipTime);
        console.log("Current time before seek:", videoPlayer.currentTime);

        const newTime = Math.max(0, Math.min(videoPlayer.duration || Infinity, videoPlayer.currentTime + skipTime));
        if (!isNaN(newTime) && Math.abs(videoPlayer.currentTime - newTime) > 0.01) {
             console.log("Seeking to newTime:", newTime);
             videoPlayer.currentTime = newTime;
        } else {
            console.log("Not seeking, newTime is too close or NaN:", newTime);
        }
    } catch (e) { console.error("YT FF/RW: Error setting currentTime:", e); }
  }
}
function addKeyListeners() {
    if (state.keyListenersAttached) return;
    try { document.addEventListener('keydown', handleKeyDown, true); state.keyListenersAttached = true; }
    catch (e) { console.error("YT FF/RW: Failed to attach key listeners:", e); }
}
function removeKeyListeners() {
    if (!state.keyListenersAttached) return;
    try { document.removeEventListener('keydown', handleKeyDown, true); state.keyListenersAttached = false; }
    catch(e) { console.error("YT FF/RW: Failed to remove key listeners:", e); }
}

function tryInjectButtons(attempt = 0) {
    if (!isWatchPage() || !state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) {
        removeButtons(); if (retryTimeout) clearTimeout(retryTimeout); state.retryAttempts = 0; return;
    }
    if (retryTimeout) clearTimeout(retryTimeout);
    if (injectButtons()) { state.retryAttempts = 0; return; }
    state.retryAttempts = attempt + 1;
    if (state.retryAttempts < CONFIG.RETRY.MAX_ATTEMPTS) {
        retryTimeout = setTimeout(() => tryInjectButtons(state.retryAttempts), CONFIG.RETRY.INTERVAL);
    } else { state.retryAttempts = 0; }
}

const debouncedTryInjectCheck = debounce(() => { tryInjectButtons(0); }, CONFIG.DEBOUNCE.MUTATION);

function playerMutationCallback(mutationsList, observer) {
  let relevantChange = false;
  let autohideAddedWhileHovering = false;
  const moviePlayer = findMoviePlayerElement();

  for (const mutation of mutationsList) {
      if (mutation.type === 'attributes' &&
          mutation.attributeName === 'class' &&
          mutation.target === moviePlayer &&
          moviePlayer.classList.contains(CONFIG.SELECTORS.AUTOHIDE_CLASS))
      {
          if (state.isHoveringOverCustomButtons) {
              autohideAddedWhileHovering = true;
          }
          relevantChange = true;
      }
      else if (mutation.type === 'childList' && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
         relevantChange = true;
      }
      if (relevantChange) break;
  }

  if (autohideAddedWhileHovering) {
        requestAnimationFrame(() => {
             if (state.isHoveringOverCustomButtons && moviePlayer && moviePlayer.classList.contains(CONFIG.SELECTORS.AUTOHIDE_CLASS)) {
                  moviePlayer.classList.remove(CONFIG.SELECTORS.AUTOHIDE_CLASS);
             }
        });
        return;
   }

  if (relevantChange) {
    debouncedTryInjectCheck();
  }
}

function observePlayerChanges() {
  if (!state.settings.extensionEnabled || !isWatchPage()) {
      if (state.playerObserver) state.playerObserver.disconnect(); state.playerObserver = null; return;
  }
  const moviePlayer = findMoviePlayerElement();
  if (!moviePlayer) { return; }
  if (state.playerObserver) state.playerObserver.disconnect();
  try {
    state.playerObserver = new MutationObserver(playerMutationCallback);
    state.playerObserver.observe(moviePlayer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });
  } catch(e) { console.error("YT FF/RW: Error setting up player observer:", e); state.playerObserver = null; }
}

const debouncedNavigationHandler = debounce(() => {
    const currentUrl = window.location.href;
    const oldPath = state.lastUrl ? new URL(state.lastUrl).pathname + new URL(state.lastUrl).search : null;
    const newPath = window.location.pathname + window.location.search;
    if (newPath !== oldPath) {
        state.lastUrl = currentUrl; handleNavigation();
    }
}, CONFIG.DEBOUNCE.NAVIGATION);

function handleNavigation() {
    removeButtons(); removeBufferingListeners(state.lastVideoElement);
    state.lastVideoElement = null; state.isBuffering = false;
    state.isHoveringOverCustomButtons = false;
    if (state.playerObserver) { state.playerObserver.disconnect(); state.playerObserver = null; }
    state.retryAttempts = 0; if (retryTimeout) clearTimeout(retryTimeout);
    if (!state.settings.extensionEnabled) { removeKeyListeners(); return; }
    if(state.settings.keyboardShortcutsEnabled) addKeyListeners(); else removeKeyListeners();
    if (isWatchPage()) {
         setTimeout(() => {
            if (!state.settings.extensionEnabled || window.location.href !== state.lastUrl) return;
             observePlayerChanges();
             if (state.settings.buttonSkipEnabled) tryInjectButtons(0);
             const video = findVideoPlayerElement(); if(video) addBufferingListeners(video);
         }, 500);
    }
}

const debouncedFullscreenCheck = debounce(() => { if(isWatchPage() && state.settings.buttonSkipEnabled) tryInjectButtons(0); }, CONFIG.DEBOUNCE.FULLSCREEN);
function handleFullscreenChange() { if (!state.settings.extensionEnabled) return; debouncedFullscreenCheck(); }
const debouncedResizeCheck = debounce(() => { if(isWatchPage() && state.settings.buttonSkipEnabled) tryInjectButtons(0); }, CONFIG.DEBOUNCE.RESIZE);

function cleanup() {
  removeButtons(); removeBufferingListeners(state.lastVideoElement); removeKeyListeners();
  if (state.navigationObserver) state.navigationObserver.disconnect(); state.navigationObserver = null;
  if (state.playerObserver) state.playerObserver.disconnect(); state.playerObserver = null;
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  window.removeEventListener('resize', debouncedResizeCheck);
  if (retryTimeout) clearTimeout(retryTimeout); retryTimeout = null;
  state.buttonsInjected = false; state.retryAttempts = 0; state.lastVideoElement = null;
  state.lastUrl = null; state.isBuffering = false; state.keyListenersAttached = false;
  state.isHoveringOverCustomButtons = false;
}

async function initializeExtension() {
    cleanup();
    try {
        const settingKeys = Object.keys(CONFIG.DEFAULT_SETTINGS);
        const stored = await browser.storage.local.get(settingKeys);
        let mergedSettings = { ...CONFIG.DEFAULT_SETTINGS, ...stored };
        state.settings = sanitizeSkipTimeSettings(mergedSettings);

        if (!state.settings.extensionEnabled) return;
        state.lastUrl = window.location.href;
        if (state.settings.keyboardShortcutsEnabled) addKeyListeners();
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        window.addEventListener('resize', debouncedResizeCheck);
        if (!state.navigationObserver) {
            state.navigationObserver = new MutationObserver(debouncedNavigationHandler);
            state.navigationObserver.observe(document.body, { childList: true, subtree: true });
        }
        if (isWatchPage()) {
             setTimeout(() => {
                 if (state.settings.extensionEnabled && isWatchPage() && window.location.href === state.lastUrl) {
                      observePlayerChanges();
                      if (state.settings.buttonSkipEnabled) tryInjectButtons(0);
                       const video = findVideoPlayerElement(); if(video) addBufferingListeners(video);
                 }
             }, 300);
        }
    } catch (error) { console.error('YT FF/RW: Error initializing extension:', error); cleanup(); }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateSettings') {
    const oldSettings = { ...state.settings };
    const sanitizedNewSettings = sanitizeSkipTimeSettings(message.settings);
    state.settings = { ...CONFIG.DEFAULT_SETTINGS, ...sanitizedNewSettings };

    if (!state.settings.extensionEnabled && oldSettings.extensionEnabled) { cleanup(); sendResponse({ status: "Extension disabled" }); return true; }
    if (state.settings.extensionEnabled && !oldSettings.extensionEnabled) { initializeExtension(); sendResponse({ status: "Extension enabled" }); return true; }
    if (state.settings.extensionEnabled) {
        removeKeyListeners(); if (state.settings.keyboardShortcutsEnabled) addKeyListeners();
        if (state.settings.buttonSkipEnabled) { if (isWatchPage()) tryInjectButtons(0); else removeButtons(); }
        else { removeButtons(); }
        if (state.buttonsInjected && state.settings.buttonSkipEnabled) {
            updateButtonCounters();
        }
    }
    sendResponse({ status: "Settings updated" }); return true;
  }
  return false;
});

if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", initializeExtension); }
else { initializeExtension(); }