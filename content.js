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
    AUTOHIDE_CLASS: 'ytp-autohide',
    AD_SHOWING_CLASS: 'ad-showing',
    SKIP_AD_BUTTONS: [
        '.ytp-ad-skip-button-modern button',
        '.ytp-ad-skip-button-modern',
        '.ytp-ad-skip-button button',
        '.ytp-ad-skip-button',
        '.ytp-skip-ad-button'
    ]
  },
  RETRY: {
    INTERVAL: 150,
    MAX_ATTEMPTS: 25
  },
  DEBOUNCE: {
    NAVIGATION: 200,
    MUTATION: 400,
    FULLSCREEN: 100,
    RESIZE: 150
  },
  STORAGE_KEYS: {
    ENABLED_STATE: 'extensionEnabled',
    BUTTON_SKIP_ENABLED_STATE: 'buttonSkipEnabled',
    KEYBOARD_ENABLED_STATE: 'keyboardShortcutsEnabled',
    FORWARD_SKIP_TIME: 'forwardSkipTime',
    BACKWARD_SKIP_TIME: 'backwardSkipTime',
    KEYBOARD_FORWARD: 'keyboardForward',
    KEYBOARD_BACKWARD: 'keyboardBackward',
    RECENT_ERRORS: 'recentErrors'
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
  },
  MAX_STORED_ERRORS: 10
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
  isHoveringOverCustomButtons: false,
  visibilityTimer: null
};

let retryTimeout = null;

async function logErrorToStorage(context, ...args) {
    console.error("YT FF/RW:", context, ...args);
    try {
        const errorData = {
            timestamp: new Date().toISOString(),
            context: context,
            message: args.map(arg => {
                if (arg instanceof Error) return arg.message;
                try {
                    return JSON.stringify(arg);
                } catch {
                    return String(arg);
                }
            }).join(' '),
        };
         if (args.length > 0 && args[args.length-1] instanceof Error && args[args.length-1].stack) {
            errorData.stack = args[args.length-1].stack;
        }
        let { [CONFIG.STORAGE_KEYS.RECENT_ERRORS]: recentErrors = [] } = await browser.storage.local.get(CONFIG.STORAGE_KEYS.RECENT_ERRORS);
        recentErrors.push(errorData);
        if (recentErrors.length > CONFIG.MAX_STORED_ERRORS) {
            recentErrors = recentErrors.slice(recentErrors.length - CONFIG.MAX_STORED_ERRORS);
        }
        await browser.storage.local.set({ [CONFIG.STORAGE_KEYS.RECENT_ERRORS]: recentErrors });
    } catch (e) {
        console.warn("YT FF/RW: Could not store error log.", e);
    }
}

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

function findMoviePlayerContainerElement() {
    return document.querySelector(CONFIG.SELECTORS.MOVIE_PLAYER);
}

function findVideoPlayerElement() {
  if (state.lastVideoElement && state.lastVideoElement.isConnected && typeof state.lastVideoElement.currentTime === 'number' && state.lastVideoElement.videoWidth > 0) {
      return state.lastVideoElement;
  }
  for (const selector of CONFIG.SELECTORS.VIDEO_PLAYERS) {
    try {
        const player = document.querySelector(selector);
        if (player && player.tagName === 'VIDEO' && typeof player.currentTime === 'number' && player.videoWidth > 0) {
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
    const moviePlayerContainer = findMoviePlayerContainerElement();
    if (moviePlayerContainer) {
        return moviePlayerContainer.querySelector(CONFIG.SELECTORS.CONTROLS);
    }
    return document.querySelector(CONFIG.SELECTORS.CONTROLS);
}

function keepControlsVisible() {
    state.isHoveringOverCustomButtons = true;
    const playerContainer = document.querySelector(CONFIG.SELECTORS.AUTOHIDE_CLASS_TARGET);
    if (playerContainer && playerContainer.classList.contains(CONFIG.SELECTORS.AUTOHIDE_CLASS)) {
        playerContainer.classList.remove(CONFIG.SELECTORS.AUTOHIDE_CLASS);
    }
}

function handleMouseLeaveCustomButtons() {
    state.isHoveringOverCustomButtons = false;
}

function createButton(id, iconPath) {
  const button = document.createElement('button');
  button.id = id;
  button.classList.add('ytp-custom-button');
  try {
    button.style.backgroundImage = `url(${browser.runtime.getURL(iconPath)})`;
  } catch (e) {
    logErrorToStorage("Failed to set background image for button", id, iconPath, e);
  }
  const counter = document.createElement('div');
  counter.id = `${id}-counter`;
  counter.classList.add('ytp-custom-button-counter');
  button.appendChild(counter);
  return button;
}

function updateButtonCounters() {
    const container = document.getElementById(CONFIG.IDS.CONTAINER);
    if (!container || !state.settings) return;
    const forwardButton = container.querySelector(`#${CONFIG.IDS.FORWARD_BUTTON}`);
    const backwardButton = container.querySelector(`#${CONFIG.IDS.REWIND_BUTTON}`);
    const forwardCounter = forwardButton ? forwardButton.querySelector(`#${CONFIG.IDS.FORWARD_BUTTON}-counter`) : null;
    const backwardCounter = backwardButton ? backwardButton.querySelector(`#${CONFIG.IDS.REWIND_BUTTON}-counter`) : null;
    const showElements = state.settings.extensionEnabled && state.settings.buttonSkipEnabled;
    const forwardTime = state.settings.forwardSkipTime || CONFIG.DEFAULT_SETTINGS.forwardSkipTime;
    const backwardTime = state.settings.backwardSkipTime || CONFIG.DEFAULT_SETTINGS.backwardSkipTime;
    if (forwardCounter) forwardCounter.textContent = showElements ? forwardTime : '';
    if (backwardCounter) backwardCounter.textContent = showElements ? backwardTime : '';
    if (forwardButton) {
        const forwardAriaLabel = `Fast-forward ${forwardTime} seconds`;
        forwardButton.setAttribute('aria-label', forwardAriaLabel);
        forwardButton.removeAttribute('title');
    }
    if (backwardButton) {
        const backwardAriaLabel = `Rewind ${backwardTime} seconds`;
        backwardButton.setAttribute('aria-label', backwardAriaLabel);
        backwardButton.removeAttribute('title');
    }
}

function createButtonsContainer() {
  const container = document.createElement('div');
  container.id = CONFIG.IDS.CONTAINER;
  const rewindButton = createButton(CONFIG.IDS.REWIND_BUTTON, CONFIG.ICONS.REWIND);
  const forwardButton = createButton(CONFIG.IDS.FORWARD_BUTTON, CONFIG.ICONS.FORWARD);
  container.appendChild(rewindButton);
  container.appendChild(forwardButton);
  container.addEventListener('click', handleButtonClick, { capture: true });
  container.addEventListener('mouseenter', keepControlsVisible);
  container.addEventListener('mouseleave', handleMouseLeaveCustomButtons);
  return container;
}

function clickYouTubeSkipButton() {
    for (const selector of CONFIG.SELECTORS.SKIP_AD_BUTTONS) {
        const skipButton = document.querySelector(selector);
        if (skipButton && skipButton.offsetParent !== null) {
            console.log("YT FF/RW: Clicking YouTube skip ad button:", selector);
            skipButton.click();
            return true;
        }
    }
    return false;
}

function handleButtonClick(event) {
    if (!state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) return;
    const button = event.target.closest('button');
    if (!button || button.parentElement?.id !== CONFIG.IDS.CONTAINER) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const currentVideoPlayer = findVideoPlayerElement();
    if (!currentVideoPlayer || currentVideoPlayer.readyState < HTMLMediaElement.HAVE_METADATA || currentVideoPlayer.seeking || state.isBuffering) {
        console.warn("YT FF/RW: Button click: Player not ready or not found.");
        return;
    }

    try {
        const moviePlayerContainer = findMoviePlayerContainerElement();
        const isAdShowing = moviePlayerContainer && moviePlayerContainer.classList.contains(CONFIG.SELECTORS.AD_SHOWING_CLASS);
        let skipTimeValue = 0;
        let newTime;

        if (isAdShowing && button.id === CONFIG.IDS.FORWARD_BUTTON) {
            console.log("YT FF/RW: Ad detected. Forward button trying to skip ad.");
            if (clickYouTubeSkipButton()) {
                return;
            }
            if (currentVideoPlayer.duration && isFinite(currentVideoPlayer.duration) && currentVideoPlayer.currentTime < currentVideoPlayer.duration - 0.1) {
                console.log("YT FF/RW: No skip button, trying currentTime = duration for ad.");
                currentVideoPlayer.currentTime = currentVideoPlayer.duration;
                return;
            }
            console.log("YT FF/RW: Ad skip via button failed, proceeding with normal skip if applicable.");
        }

        if (button.id === CONFIG.IDS.FORWARD_BUTTON) {
            skipTimeValue = state.settings.forwardSkipTime || CONFIG.DEFAULT_SETTINGS.forwardSkipTime;
            newTime = Math.min(currentVideoPlayer.duration || Infinity, currentVideoPlayer.currentTime + skipTimeValue);
        } else if (button.id === CONFIG.IDS.REWIND_BUTTON) {
            skipTimeValue = -(state.settings.backwardSkipTime || CONFIG.DEFAULT_SETTINGS.backwardSkipTime);
            newTime = Math.max(0, currentVideoPlayer.currentTime + skipTimeValue);
        }
         if (newTime !== undefined && !isNaN(newTime) && Math.abs(currentVideoPlayer.currentTime - newTime) > 0.01) {
            currentVideoPlayer.currentTime = newTime;
         }
    } catch (e) { logErrorToStorage("Error setting currentTime on button click:", e); }
}

function injectButtons() {
    if (!state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) {
      removeButtons(); return false;
    }
    const videoPlayer = findVideoPlayerElement();
    const controlsContainer = findControlsContainerElement();
    if (!videoPlayer || !controlsContainer) {
      if (state.buttonsInjected) removeButtons();
      return false;
    }
    let buttonsContainer = document.getElementById(CONFIG.IDS.CONTAINER);
    let wasNewlyCreated = false;
    if (!buttonsContainer) {
        buttonsContainer = createButtonsContainer();
        wasNewlyCreated = true;
    }
    if (buttonsContainer.parentNode !== controlsContainer) {
        const timeDisplay = controlsContainer.querySelector(CONFIG.SELECTORS.TIME_DISPLAY);
        try {
            if (timeDisplay && timeDisplay.parentNode === controlsContainer) {
                controlsContainer.insertBefore(buttonsContainer, timeDisplay.nextSibling);
            } else {
                controlsContainer.appendChild(buttonsContainer);
            }
        } catch (e) {
            logErrorToStorage("Error injecting/moving buttons container:", e);
            if (wasNewlyCreated) buttonsContainer.remove();
            state.buttonsInjected = false;
            return false;
        }
    }
    updateButtonCounters();
    state.buttonsInjected = true;
    if (state.visibilityTimer) cancelAnimationFrame(state.visibilityTimer);
    state.visibilityTimer = requestAnimationFrame(() => {
        state.visibilityTimer = requestAnimationFrame(() => {
            const currentContainer = document.getElementById(CONFIG.IDS.CONTAINER);
            if (currentContainer) {
                 currentContainer.classList.add('visible');
            } else {
                state.buttonsInjected = false;
            }
        });
    });
    return true;
}

function removeButtons() {
  const container = document.getElementById(CONFIG.IDS.CONTAINER);
  if (state.visibilityTimer) cancelAnimationFrame(state.visibilityTimer);
  state.visibilityTimer = null;
  if (container) {
    container.classList.remove('visible');
    const transitionDuration = 200;
    setTimeout(() => {
        const currentContainer = document.getElementById(CONFIG.IDS.CONTAINER);
        if (currentContainer && currentContainer.parentNode) {
            try {
                currentContainer.removeEventListener('click', handleButtonClick, { capture: true });
                currentContainer.removeEventListener('mouseenter', keepControlsVisible);
                currentContainer.removeEventListener('mouseleave', handleMouseLeaveCustomButtons);
                currentContainer.remove();
            } catch(e) {}
        }
    }, transitionDuration);
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
    state.isBuffering = videoElement.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ||
                        (videoElement.seeking && !videoElement.paused);
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
            value = isNaN(parsedValue) ? defaultValue : parsedValue;
        } else if (typeof value !== 'number' || isNaN(value)) {
            value = defaultValue;
        }
        if (value < 1) {
            value = defaultValue > 0 ? defaultValue : 1;
        }
        newSettings[key] = value;
    }
    return newSettings;
}

function handleKeyDown(event) {
  if (!state.settings.extensionEnabled || !state.settings.keyboardShortcutsEnabled) return;
  if (isEditable(document.activeElement) || event.target.closest('[contenteditable="true"]')) return;
  const isLeft = event.key === 'ArrowLeft';
  const isRight = event.key === 'ArrowRight';
  if (!isLeft && !isRight) return;
  const shouldOverride = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;

  if (shouldOverride) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const videoPlayer = findVideoPlayerElement();
    if (!videoPlayer || videoPlayer.readyState < HTMLMediaElement.HAVE_METADATA || state.isBuffering || videoPlayer.seeking) {
        console.warn("YT FF/RW: Keyboard shortcut: Player not ready or not found, but default was prevented.");
        return;
    }

    try {
        const moviePlayerContainer = findMoviePlayerContainerElement();
        const isAdShowing = moviePlayerContainer && moviePlayerContainer.classList.contains(CONFIG.SELECTORS.AD_SHOWING_CLASS);

        if (isAdShowing && isRight) {
            console.log("YT FF/RW: Ad detected. Right arrow key trying to skip ad.");
            if (clickYouTubeSkipButton()) {
                return;
            }
            if (videoPlayer.duration && isFinite(videoPlayer.duration) && videoPlayer.currentTime < videoPlayer.duration - 0.1) {
                console.log("YT FF/RW: No skip button (keyboard), trying currentTime = duration for ad.");
                videoPlayer.currentTime = videoPlayer.duration;
                return;
            }
            console.log("YT FF/RW: Ad skip via keyboard failed, proceeding with normal skip if applicable.");
        }

        const skipTimeSettingForward = state.settings.keyboardForward || CONFIG.DEFAULT_SETTINGS.keyboardForward;
        const skipTimeSettingBackward = state.settings.keyboardBackward || CONFIG.DEFAULT_SETTINGS.keyboardBackward;
        const skipTime = isRight ? skipTimeSettingForward : -skipTimeSettingBackward;
        const newTime = Math.max(0, Math.min(videoPlayer.duration || Infinity, videoPlayer.currentTime + skipTime));
        if (!isNaN(newTime) && Math.abs(videoPlayer.currentTime - newTime) > 0.01) {
             videoPlayer.currentTime = newTime;
        }
    } catch (e) { logErrorToStorage("Error setting currentTime on keydown:", e); }
  }
}

function addKeyListeners() {
    if (state.keyListenersAttached) return;
    try {
        document.addEventListener('keydown', handleKeyDown, true);
        state.keyListenersAttached = true;
    } catch (e) {
        logErrorToStorage("Failed to attach key listeners:", e);
    }
}
function removeKeyListeners() {
    if (!state.keyListenersAttached) return;
    try {
        document.removeEventListener('keydown', handleKeyDown, true);
        state.keyListenersAttached = false;
    } catch(e) {
        logErrorToStorage("Failed to remove key listeners:", e);
    }
}

function tryInjectButtons(attempt = 0) {
    if (!isWatchPage() || !state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) {
        removeButtons();
        if (retryTimeout) clearTimeout(retryTimeout);
        state.retryAttempts = 0;
        return;
    }
    if (retryTimeout) clearTimeout(retryTimeout);
    if (injectButtons()) {
        state.retryAttempts = 0;
        return;
    }
    state.retryAttempts = attempt + 1;
    const interval = (attempt < 2) ? 30 : ((attempt < 5) ? 100 : CONFIG.RETRY.INTERVAL);
    if (state.retryAttempts < CONFIG.RETRY.MAX_ATTEMPTS) {
        retryTimeout = setTimeout(() => tryInjectButtons(state.retryAttempts), interval);
    } else {
        state.retryAttempts = 0;
    }
}

const debouncedTryInjectCheck = debounce(() => { tryInjectButtons(0); }, CONFIG.DEBOUNCE.MUTATION);

function playerMutationCallback(mutationsList, observer) {
  let relevantChange = false;
  let autohideAddedWhileHovering = false;
  const moviePlayerContainer = findMoviePlayerContainerElement();

  for (const mutation of mutationsList) {
      if (mutation.type === 'attributes' &&
          mutation.attributeName === 'class' &&
          mutation.target === moviePlayerContainer) {
          if (moviePlayerContainer && moviePlayerContainer.classList.contains(CONFIG.SELECTORS.AUTOHIDE_CLASS) && state.isHoveringOverCustomButtons) {
              autohideAddedWhileHovering = true;
          }
          relevantChange = true;
      }
      else if (mutation.type === 'childList') {
          const checkNodes = (nodes) => {
              for (const node of nodes) {
                  if (node.nodeType === Node.ELEMENT_NODE) {
                      if (node.matches(CONFIG.SELECTORS.CONTROLS) || node.querySelector(CONFIG.SELECTORS.CONTROLS) ||
                          node.matches(CONFIG.SELECTORS.TIME_DISPLAY) || node.querySelector(CONFIG.SELECTORS.TIME_DISPLAY) ||
                          CONFIG.SELECTORS.VIDEO_PLAYERS.some(sel => node.matches(sel) || node.querySelector(sel))
                      ) {
                          return true;
                      }
                  }
              }
              return false;
          };
          if (checkNodes(mutation.addedNodes) || checkNodes(mutation.removedNodes)) {
              relevantChange = true;
          }
      }
      if (relevantChange) break;
  }
  if (autohideAddedWhileHovering && moviePlayerContainer) {
        requestAnimationFrame(() => {
             if (state.isHoveringOverCustomButtons && moviePlayerContainer.classList.contains(CONFIG.SELECTORS.AUTOHIDE_CLASS)) {
                  moviePlayerContainer.classList.remove(CONFIG.SELECTORS.AUTOHIDE_CLASS);
             }
        });
   }
  if (relevantChange) {
    debouncedTryInjectCheck();
  }
}

function observePlayerChanges() {
  if (!state.settings.extensionEnabled || !isWatchPage()) {
      if (state.playerObserver) {
          state.playerObserver.disconnect();
          state.playerObserver = null;
      }
      return;
  }
  const moviePlayerContainerToObserve = findMoviePlayerContainerElement();
  if (!moviePlayerContainerToObserve) {
      console.warn("YT FF/RW: Movie player container not found for MutationObserver.");
      return;
  }
  if (state.playerObserver && state.playerObserver.target !== moviePlayerContainerToObserve) {
      state.playerObserver.disconnect();
      state.playerObserver = null;
  }

  if (!state.playerObserver) {
    try {
        state.playerObserver = new MutationObserver(playerMutationCallback);
        state.playerObserver.observe(moviePlayerContainerToObserve, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
        state.playerObserver.target = moviePlayerContainerToObserve;
    } catch(e) {
        logErrorToStorage("Error setting up player observer:", e);
        state.playerObserver = null;
    }
  }
}

const debouncedNavigationHandler = debounce(() => {
    const currentUrl = window.location.href;
    const oldPath = state.lastUrl ? (new URL(state.lastUrl).pathname + new URL(state.lastUrl).search) : null;
    const newPath = window.location.pathname + window.location.search;

    if (currentUrl !== state.lastUrl) {
        if (newPath !== oldPath || (isWatchPage() && currentUrl !== state.lastUrl) ) {
            state.lastUrl = currentUrl;
            handleNavigation();
        } else {
             state.lastUrl = currentUrl;
        }
    } else if (isWatchPage() && !state.buttonsInjected && state.settings.buttonSkipEnabled) {
        handleNavigation();
    }
}, CONFIG.DEBOUNCE.NAVIGATION);

function handleNavigation() {
    if (state.playerObserver) {
        state.playerObserver.disconnect();
        state.playerObserver = null;
    }
    state.retryAttempts = 0;
    if (retryTimeout) clearTimeout(retryTimeout);
    if (state.visibilityTimer) cancelAnimationFrame(state.visibilityTimer);
    state.visibilityTimer = null;

    state.lastVideoElement = null;

    if (!state.settings.extensionEnabled) {
        cleanup();
        return;
    }
    removeKeyListeners();
    if(state.settings.keyboardShortcutsEnabled) {
        addKeyListeners();
    }
    if (isWatchPage()) {
         setTimeout(() => {
            if (!state.settings.extensionEnabled || window.location.href !== state.lastUrl || !isWatchPage()) {
                if (!isWatchPage() || !state.settings.extensionEnabled) {
                    removeButtons();
                }
                return;
            }

            const newVideoElement = findVideoPlayerElement();
            if (newVideoElement) {
                addBufferingListeners(newVideoElement);
                state.isBuffering = newVideoElement.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || (newVideoElement.seeking && !newVideoElement.paused);
            } else {
                state.isBuffering = false;
            }

            observePlayerChanges();

            if (state.settings.buttonSkipEnabled) {
                tryInjectButtons(0);
            } else {
                removeButtons();
            }
         }, 250);
    } else {
        removeButtons();
        if(state.lastVideoElement) removeBufferingListeners(state.lastVideoElement);
        state.isBuffering = false;
    }
}

const debouncedFullscreenCheck = debounce(() => {
    if(isWatchPage() && state.settings.buttonSkipEnabled) tryInjectButtons(0);
}, CONFIG.DEBOUNCE.FULLSCREEN);

function handleFullscreenChange() {
    if (!state.settings.extensionEnabled) return;
    debouncedFullscreenCheck();
}

const debouncedResizeCheck = debounce(() => {
    if(isWatchPage() && state.settings.buttonSkipEnabled) tryInjectButtons(0);
}, CONFIG.DEBOUNCE.RESIZE);

function cleanup() {
  removeButtons();
  if(state.lastVideoElement) removeBufferingListeners(state.lastVideoElement);
  state.lastVideoElement = null;
  removeKeyListeners();
  if (state.navigationObserver) {state.navigationObserver.disconnect(); state.navigationObserver = null;}
  if (state.playerObserver) {state.playerObserver.disconnect(); state.playerObserver = null;}
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  window.removeEventListener('resize', debouncedResizeCheck);
  if (retryTimeout) clearTimeout(retryTimeout);
  retryTimeout = null;
  state.buttonsInjected = false;
  state.retryAttempts = 0;
  state.isBuffering = false;
  state.keyListenersAttached = false;
  state.isHoveringOverCustomButtons = false;
}

async function initializeExtension() {
    cleanup();
    try {
        const settingKeys = Object.keys(CONFIG.DEFAULT_SETTINGS).concat(Object.values(CONFIG.STORAGE_KEYS));
        const stored = await browser.storage.local.get(settingKeys);
        let mergedSettings = { ...CONFIG.DEFAULT_SETTINGS, ...stored };
        state.settings = sanitizeSkipTimeSettings(mergedSettings);
        if (!state.settings.extensionEnabled) {
            return;
        }
        state.lastUrl = window.location.href;
        if (state.settings.keyboardShortcutsEnabled) {
            addKeyListeners();
        }
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        window.addEventListener('resize', debouncedResizeCheck);
        if (!state.navigationObserver) {
            state.navigationObserver = new MutationObserver(debouncedNavigationHandler);
            state.navigationObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
        handleNavigation();
    } catch (error) {
        logErrorToStorage('Error initializing extension:', error);
        cleanup();
    }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateSettings') {
    const oldSettings = { ...state.settings };
    const sanitizedNewSettings = sanitizeSkipTimeSettings(message.settings);
    state.settings = { ...CONFIG.DEFAULT_SETTINGS, ...sanitizedNewSettings };
    if (!state.settings.extensionEnabled && oldSettings.extensionEnabled) {
        cleanup();
        sendResponse({ status: "Extension disabled and cleaned up" });
        return true;
    }
    if (state.settings.extensionEnabled && !oldSettings.extensionEnabled) {
        initializeExtension();
        sendResponse({ status: "Extension enabled and initialized" });
        return true;
    }
    if (state.settings.extensionEnabled) {
        if (state.settings.keyboardShortcutsEnabled && !oldSettings.keyboardShortcutsEnabled) {
            addKeyListeners();
        } else if (!state.settings.keyboardShortcutsEnabled && oldSettings.keyboardShortcutsEnabled) {
            removeKeyListeners();
        }
        if (state.settings.buttonSkipEnabled && !oldSettings.buttonSkipEnabled) {
            if (isWatchPage()) tryInjectButtons(0);
        } else if (!state.settings.buttonSkipEnabled && oldSettings.buttonSkipEnabled) {
            removeButtons();
        } else if (state.settings.buttonSkipEnabled && state.buttonsInjected) {
            updateButtonCounters();
            const container = document.getElementById(CONFIG.IDS.CONTAINER);
            if (container && !container.classList.contains('visible')) {
                if (state.visibilityTimer) cancelAnimationFrame(state.visibilityTimer);
                state.visibilityTimer = requestAnimationFrame(() => {
                    state.visibilityTimer = requestAnimationFrame(() => {
                        if(document.getElementById(CONFIG.IDS.CONTAINER)) {
                            container.classList.add('visible');
                        }
                    });
                });
            }
        } else if (state.settings.buttonSkipEnabled && isWatchPage() && !state.buttonsInjected) {
            tryInjectButtons(0);
        }
        if (isWatchPage() && !state.playerObserver && state.settings.extensionEnabled) {
            observePlayerChanges();
        }
    }
    sendResponse({ status: "Settings applied" });
    return true;
  }
  return false;
});

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeExtension);
} else {
    initializeExtension();
}