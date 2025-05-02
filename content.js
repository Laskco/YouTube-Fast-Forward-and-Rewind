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
  isHoveringOverCustomButtons: false,
  isBuffering: false,
  playerElementCache: null,
  controlsContainerCache: null,
  buttonContainerCache: null
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
  return window.location.pathname === '/watch';
}

function findMoviePlayer() {
    if (state.playerElementCache && document.body.contains(state.playerElementCache)) {
        return state.playerElementCache;
    }
    state.playerElementCache = document.querySelector(CONFIG.SELECTORS.MOVIE_PLAYER);
    return state.playerElementCache;
}

function findVideoPlayer(moviePlayer) {
  if (!moviePlayer) return null;
  if (state.lastVideoElement && moviePlayer.contains(state.lastVideoElement)) {
      return state.lastVideoElement;
  }
  for (const selector of CONFIG.SELECTORS.VIDEO_PLAYERS) {
    try {
        const player = moviePlayer.querySelector(selector.replace('#movie_player ', ''));
        if (player && player.tagName === 'VIDEO' && typeof player.currentTime === 'number') {
            return player;
        }
    } catch(e) { }
  }
  return null;
}

function findControlsContainer(moviePlayer) {
    if (!moviePlayer) return null;
     if (state.controlsContainerCache && moviePlayer.contains(state.controlsContainerCache)) {
         return state.controlsContainerCache;
     }
     state.controlsContainerCache = moviePlayer.querySelector(CONFIG.SELECTORS.CONTROLS);
     return state.controlsContainerCache;
}

function keepControlsVisible() {
    state.isHoveringOverCustomButtons = true;
    const player = findMoviePlayer();
    if (player) {
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
    const container = state.buttonContainerCache || document.getElementById(CONFIG.IDS.CONTAINER);
    if (!container || !state.settings) return;

    const forwardCounter = container.querySelector(`#${CONFIG.IDS.FORWARD_BUTTON}-counter`);
    const backwardCounter = container.querySelector(`#${CONFIG.IDS.REWIND_BUTTON}-counter`);

    const showCounters = state.settings.extensionEnabled && state.settings.buttonSkipEnabled;
    const forwardTime = state.settings.forwardSkipTime || CONFIG.DEFAULT_SETTINGS.forwardSkipTime;
    const backwardTime = state.settings.backwardSkipTime || CONFIG.DEFAULT_SETTINGS.backwardSkipTime;

    if (forwardCounter) {
        forwardCounter.textContent = showCounters ? forwardTime : '';
    }
    if (backwardCounter) {
        backwardCounter.textContent = showCounters ? backwardTime : '';
    }
}

function createButtonsContainer() {
    if (state.buttonContainerCache) return state.buttonContainerCache;

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

  const rewindButton = createButton(
      CONFIG.IDS.REWIND_BUTTON,
      CONFIG.ICONS.REWIND
  );
  const forwardButton = createButton(
      CONFIG.IDS.FORWARD_BUTTON,
      CONFIG.ICONS.FORWARD
  );

  rewindButton.style.marginRight = '2px';
  forwardButton.style.marginLeft = '2px';

  container.appendChild(rewindButton);
  container.appendChild(forwardButton);

  container.addEventListener('mouseenter', keepControlsVisible);
  container.addEventListener('mouseleave', handleMouseLeaveCustomButtons);

  state.buttonContainerCache = container;
  return container;
}

function handleButtonClick(event) {
    if (!state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) return;

    const button = event.target.closest('button');
    if (!button) return;

    event.stopPropagation();
    event.preventDefault();

    const currentVideoPlayer = state.lastVideoElement;
    if (!currentVideoPlayer || currentVideoPlayer.readyState < 1 || currentVideoPlayer.seeking || state.isBuffering) {
        return;
    }

    try {
        let skipTime = 0;
        let newTime;
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
    } catch (e) {
        console.error("YT FF/RW: Error setting currentTime on button click:", e);
    }
}

function setupVideoControls() {
  const container = state.buttonContainerCache || document.getElementById(CONFIG.IDS.CONTAINER);
  if (!container) return;

  container.removeEventListener('click', handleButtonClick, { capture: true });
  container.addEventListener('click', handleButtonClick, { capture: true });
}

function handleVideoWaiting() {
    state.isBuffering = true;
}
function handleVideoPlaying() {
    state.isBuffering = false;
}
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

function injectButtons() {
    if (!state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) {
      removeButtons();
      return false;
    }

    const moviePlayer = findMoviePlayer();
    if (!moviePlayer || moviePlayer.classList.contains('ad-showing')) {
         removeButtons();
         return false;
    }

    const videoPlayer = findVideoPlayer(moviePlayer);
    const controlsContainer = findControlsContainer(moviePlayer);

    if (!videoPlayer || !controlsContainer) {
      if (state.buttonsInjected) removeButtons();
      return false;
    }

    if (state.lastVideoElement !== videoPlayer) {
        removeBufferingListeners(state.lastVideoElement);
        state.lastVideoElement = videoPlayer;
        addBufferingListeners(state.lastVideoElement);
    } else if (!state.lastVideoElement && videoPlayer) {
         state.lastVideoElement = videoPlayer;
         addBufferingListeners(state.lastVideoElement);
    }

    let existingContainer = state.buttonContainerCache || document.getElementById(CONFIG.IDS.CONTAINER);

    if (existingContainer && existingContainer.parentNode === controlsContainer) {
        setupVideoControls();
        updateButtonCounters();
        existingContainer.removeEventListener('mouseenter', keepControlsVisible);
        existingContainer.removeEventListener('mouseleave', handleMouseLeaveCustomButtons);
        existingContainer.addEventListener('mouseenter', keepControlsVisible);
        existingContainer.addEventListener('mouseleave', handleMouseLeaveCustomButtons);
        state.buttonsInjected = true;
        return true;
    }

    removeButtons();

    const buttonsContainer = createButtonsContainer();
    const timeDisplay = controlsContainer.querySelector(CONFIG.SELECTORS.TIME_DISPLAY);

    try {
        if (timeDisplay && timeDisplay.parentNode === controlsContainer) {
            controlsContainer.insertBefore(buttonsContainer, timeDisplay.nextSibling);
        } else {
            controlsContainer.appendChild(buttonsContainer);
        }

        setupVideoControls();
        updateButtonCounters();
        state.buttonsInjected = true;
        return true;

    } catch(e) {
        console.error("YT FF/RW: Error injecting buttons:", e);
        removeButtons();
        return false;
    }
}

function handleKeyDown(event) {
  if (!state.settings.extensionEnabled || !state.settings.keyboardShortcutsEnabled) return;
  if (isEditable(document.activeElement)) return;

  const videoPlayer = state.lastVideoElement;
  if (!videoPlayer || videoPlayer.readyState < 1 || videoPlayer.seeking || state.isBuffering) {
        return;
  }

  const isLeft = event.key === 'ArrowLeft';
  const isRight = event.key === 'ArrowRight';
  const shouldOverride = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;

  if ((isRight || isLeft) && shouldOverride) {
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    try {
        const skipTime = isRight ? (state.settings.keyboardForward || CONFIG.DEFAULT_SETTINGS.keyboardForward)
                                 : -(state.settings.keyboardBackward || CONFIG.DEFAULT_SETTINGS.keyboardBackward);
        const newTime = Math.max(0, Math.min(videoPlayer.duration || Infinity, videoPlayer.currentTime + skipTime));
        if (!isNaN(newTime) && Math.abs(videoPlayer.currentTime - newTime) > 0.01) {
            videoPlayer.currentTime = newTime;
        }
    } catch (e) { console.error("YT FF/RW: Error setting currentTime:", e); }
  }
}

function cleanup() {
  state.isHoveringOverCustomButtons = false;
  removeButtons();
  removeBufferingListeners(state.lastVideoElement);
  if (state.navigationObserver) state.navigationObserver.disconnect(); state.navigationObserver = null;
  if (state.playerObserver) state.playerObserver.disconnect(); state.playerObserver = null;
  document.removeEventListener('keydown', handleKeyDown, true);
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  window.removeEventListener('resize', debouncedResizeCheck);
  if (retryTimeout) clearTimeout(retryTimeout); retryTimeout = null;
  state.buttonsInjected = false;
  state.retryAttempts = 0;
  state.lastVideoElement = null;
  state.lastUrl = null;
  state.isBuffering = false;
  state.playerElementCache = null;
  state.controlsContainerCache = null;
  state.buttonContainerCache = null;
}

function removeButtons() {
  const container = state.buttonContainerCache || document.getElementById(CONFIG.IDS.CONTAINER);
  if (container) {
    try {
        container.removeEventListener('click', handleButtonClick, { capture: true });
        container.removeEventListener('mouseenter', keepControlsVisible);
        container.removeEventListener('mouseleave', handleMouseLeaveCustomButtons);
        container.remove();
    } catch (e) {
        console.error("YT FF/RW: Error removing buttons container:", e);
    }
  }
  state.buttonContainerCache = null;
  state.buttonsInjected = false;
}

function tryInjectButtons(attempt = 0) {
    if (!state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) {
        removeButtons();
        if (retryTimeout) clearTimeout(retryTimeout);
        state.retryAttempts = 0;
        return;
    }
    if (!isWatchPage()) {
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
    if (state.retryAttempts < CONFIG.RETRY.MAX_ATTEMPTS) {
        retryTimeout = setTimeout(() => tryInjectButtons(state.retryAttempts), CONFIG.RETRY.INTERVAL);
    } else {
        state.retryAttempts = 0;
    }
}

const debouncedTryInjectCheck = debounce(() => {
    if (!state.settings.extensionEnabled || !state.settings.buttonSkipEnabled || !isWatchPage()) {
        removeButtons();
        return;
    }
    tryInjectButtons(0);
}, CONFIG.DEBOUNCE.MUTATION);

function playerMutationCallback(mutationsList, observer) {
 try {
    let relevantChange = false;
    let autohideAddedWhileHovering = false;

    for (const mutation of mutationsList) {
        if (mutation.type === 'attributes' &&
            mutation.attributeName === 'class' &&
            mutation.target === state.playerElementCache)
        {
            if (mutation.target.classList.contains(CONFIG.SELECTORS.AUTOHIDE_CLASS)) {
                if (state.isHoveringOverCustomButtons) {
                    autohideAddedWhileHovering = true;
                }
            }
             relevantChange = true;
        } else if (mutation.type === 'childList') {
           if (mutation.target === state.controlsContainerCache ||
               (state.controlsContainerCache && mutation.target.contains(state.controlsContainerCache)) ||
               (state.controlsContainerCache && state.controlsContainerCache.contains(mutation.target))
              )
            {
                relevantChange = true;
            } else {
                 for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
                    if (node.nodeType === Node.ELEMENT_NODE && node.matches && node.matches(CONFIG.SELECTORS.CONTROLS)) {
                        relevantChange = true;
                        state.controlsContainerCache = null;
                        break;
                    }
                }
            }
        }

        if (relevantChange) break;
    }

    if (autohideAddedWhileHovering) {
        requestAnimationFrame(() => {
             keepControlsVisible();
        });
    }

    if (relevantChange && !autohideAddedWhileHovering) {
      debouncedTryInjectCheck();
    }
  } catch (e) {
       console.error("YT FF/RW: Error in playerMutationCallback:", e);
       debouncedTryInjectCheck();
  }
}

function observePlayerChanges() {
  if (!state.settings.extensionEnabled || !isWatchPage()) {
      if (state.playerObserver) state.playerObserver.disconnect();
      state.playerObserver = null;
      return;
  }

  const moviePlayer = findMoviePlayer();
  if (!moviePlayer) {
      return;
  };

  if (state.playerObserver) state.playerObserver.disconnect();

  try {
    state.playerObserver = new MutationObserver(playerMutationCallback);
    state.playerObserver.observe(moviePlayer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });
  } catch(e) {
      console.error("YT FF/RW: Error setting up player observer:", e);
  }
}

const debouncedNavigationHandler = debounce(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== state.lastUrl) {
        state.lastUrl = currentUrl;
        handleNavigation();
    }
}, CONFIG.DEBOUNCE.NAVIGATION);


function handleNavigation() {
    if (!state.settings.extensionEnabled) {
         cleanup();
         return;
    }

    removeButtons();
    removeBufferingListeners(state.lastVideoElement);
    state.retryAttempts = 0;
    if (retryTimeout) clearTimeout(retryTimeout);
    state.lastVideoElement = null;
    state.isHoveringOverCustomButtons = false;
    state.isBuffering = false;
    state.playerElementCache = null;
    state.controlsContainerCache = null;
    state.buttonContainerCache = null;

    if (isWatchPage()) {
         setTimeout(() => {
            if (!state.settings.extensionEnabled || window.location.href !== state.lastUrl) return;
             observePlayerChanges();
             tryInjectButtons(0);
         }, 300);
    } else {
        if (state.playerObserver) state.playerObserver.disconnect();
        state.playerObserver = null;
    }
}

const debouncedFullscreenCheck = debounce(() => {
  if (state.settings.extensionEnabled && state.settings.buttonSkipEnabled && isWatchPage()) {
      tryInjectButtons(0);
  }
}, CONFIG.DEBOUNCE.FULLSCREEN);

function handleFullscreenChange() {
  if (!state.settings.extensionEnabled) return;
  debouncedFullscreenCheck();
}

const debouncedResizeCheck = debounce(() => {
  if (state.settings.extensionEnabled && state.settings.buttonSkipEnabled && isWatchPage()) {
      tryInjectButtons(0);
  }
}, CONFIG.DEBOUNCE.RESIZE);


async function initializeExtension() {
    cleanup();

    try {
        const stored = await browser.storage.local.get(Object.keys(CONFIG.DEFAULT_SETTINGS));
        state.settings = { ...CONFIG.DEFAULT_SETTINGS, ...stored };

        if (!state.settings.extensionEnabled) {
          return;
        }

        state.lastUrl = window.location.href;

        if (!state.navigationObserver) {
            state.navigationObserver = new MutationObserver(debouncedNavigationHandler);
            state.navigationObserver.observe(document.body, { childList: true, subtree: false });
        }

        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        window.addEventListener('resize', debouncedResizeCheck);

        if (isWatchPage()) {
             observePlayerChanges();
             setTimeout(() => {
                 if (state.settings.extensionEnabled && isWatchPage() && window.location.href === state.lastUrl) {
                      tryInjectButtons(0);
                 }
             }, 300);
        }

    } catch (error) {
        console.error('YT FF/RW: Error initializing extension:', error);
        cleanup();
    }
}


browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateSettings') {
    const oldSettings = { ...state.settings };
    state.settings = { ...CONFIG.DEFAULT_SETTINGS, ...message.settings };

    if (!state.settings.extensionEnabled && oldSettings.extensionEnabled) {
      cleanup();
    }
    else if (state.settings.extensionEnabled && !oldSettings.extensionEnabled) {
      initializeExtension();
    }
    else if (state.settings.extensionEnabled) {
        if (isWatchPage()) {
            if (state.settings.buttonSkipEnabled && !oldSettings.buttonSkipEnabled) {
                tryInjectButtons(0);
            } else if (!state.settings.buttonSkipEnabled && oldSettings.buttonSkipEnabled) {
                removeButtons();
            } else if (state.buttonsInjected) {
                updateButtonCounters();
            }
        }
        document.removeEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keydown', handleKeyDown, true);
    }

    sendResponse({ status: "Settings updated successfully" });
    return true;
  }
  return false;
});

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeExtension);
} else {
    initializeExtension();
}