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
    MOVIE_PLAYER: '#movie_player'
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
  settings: { ...CONFIG.DEFAULT_SETTINGS }
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

function isMoviePage() {
  return window.location.href.includes('/watch') &&
         document.querySelector('ytd-watch-flexy[is-two-columns_]') === null;
}

function findVideoPlayer() {
  for (const selector of CONFIG.SELECTORS.VIDEO_PLAYERS) {
    try {
        const player = document.querySelector(selector);
        if (player && player.tagName === 'VIDEO' && typeof player.currentTime === 'number') {
            return player;
        }
    } catch(e) { }
  }
  return null;
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

    if (forwardCounter) {
        forwardCounter.textContent = showCounters ? (state.settings.forwardSkipTime || CONFIG.DEFAULT_SETTINGS.forwardSkipTime) : '';
    }
    if (backwardCounter) {
        backwardCounter.textContent = showCounters ? (state.settings.backwardSkipTime || CONFIG.DEFAULT_SETTINGS.backwardSkipTime) : '';
    }
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

  return container;
}

function setupVideoControls() {
  const container = document.getElementById(CONFIG.IDS.CONTAINER);
  if (!container) return;

  container.onclick = null;

  container.onclick = (event) => {
    if (!state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) return;

    const currentVideoPlayer = state.lastVideoElement || findVideoPlayer();
    if (!currentVideoPlayer || currentVideoPlayer.readyState === 0) return;

    const button = event.target.closest('button');
    if (!button) return;

    try {
        let skipTime = 0;
        let newTime;
        if (button.id === CONFIG.IDS.FORWARD_BUTTON) {
            skipTime = state.settings.forwardSkipTime;
            newTime = Math.min(currentVideoPlayer.duration || Infinity, currentVideoPlayer.currentTime + skipTime);
        } else if (button.id === CONFIG.IDS.REWIND_BUTTON) {
            skipTime = -state.settings.backwardSkipTime;
            newTime = Math.max(0, currentVideoPlayer.currentTime + skipTime);
        }
         if (newTime !== undefined && currentVideoPlayer.currentTime !== newTime) {
            currentVideoPlayer.currentTime = newTime;
         }
    } catch (e) {
        console.error("YT FF/RW: Error setting currentTime on button click:", e);
    }
  };
}

function injectButtons() {
    if (!state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) {
      removeButtons();
      return false;
    }

    const moviePlayer = document.querySelector(CONFIG.SELECTORS.MOVIE_PLAYER);
    if (moviePlayer && moviePlayer.classList.contains('ad-showing')) {
         removeButtons();
         return false;
    }

    const videoPlayer = findVideoPlayer();
    const controlsContainer = document.querySelector(CONFIG.SELECTORS.CONTROLS);

    if (!videoPlayer || !controlsContainer) {
      if (state.buttonsInjected) removeButtons();
      return false;
    }

    let existingContainer = document.getElementById(CONFIG.IDS.CONTAINER);

    if (existingContainer && existingContainer.parentNode === controlsContainer) {
        state.lastVideoElement = videoPlayer;
        setupVideoControls();
        updateButtonCounters();
        state.buttonsInjected = true;
        return true;
    }

    removeButtons();

    const buttonsContainer = createButtonsContainer();
    const timeDisplay = controlsContainer.querySelector(CONFIG.SELECTORS.TIME_DISPLAY);

    if (timeDisplay && timeDisplay.parentNode === controlsContainer) {
        controlsContainer.insertBefore(buttonsContainer, timeDisplay.nextSibling);
    } else {
        controlsContainer.appendChild(buttonsContainer);
    }

    state.lastVideoElement = videoPlayer;
    setupVideoControls();
    updateButtonCounters();
    state.buttonsInjected = true;
    return true;
}


function handleKeyDown(event) {
  if (!state.settings.extensionEnabled || !state.settings.keyboardShortcutsEnabled) return;
  if (isEditable(document.activeElement)) return;

  const videoPlayer = state.lastVideoElement || findVideoPlayer();
  if (!videoPlayer || videoPlayer.readyState === 0) return;

  const isLeft = event.key === 'ArrowLeft';
  const isRight = event.key === 'ArrowRight';
  const shouldOverride = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;

  if ((isRight || isLeft) && shouldOverride) {
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    try {
        const skipTime = isRight ? state.settings.keyboardForward : -state.settings.keyboardBackward;
        const newTime = Math.max(0, Math.min(videoPlayer.duration || Infinity, videoPlayer.currentTime + skipTime));
        if (videoPlayer.currentTime !== newTime) {
            videoPlayer.currentTime = newTime;
        }
    } catch (e) { console.error("YT FF/RW: Error setting currentTime:", e); }
  }
}

function cleanup() {
  removeButtons();
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
}

function removeButtons() {
  const container = document.getElementById(CONFIG.IDS.CONTAINER);
  if (container) {
    container.remove();
  }
  state.buttonsInjected = false;
}


function tryInjectButtons(attempt = 0) {
    if (!state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) {
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
    const maxAttempts = isMoviePage() ? 30 : CONFIG.RETRY.MAX_ATTEMPTS;
    if (state.retryAttempts < maxAttempts) {
        retryTimeout = setTimeout(() => tryInjectButtons(state.retryAttempts), CONFIG.RETRY.INTERVAL);
    } else {
        console.warn("YT FF/RW: Max retry attempts reached. Failed to inject buttons.");
        state.retryAttempts = 0;
    }
}


const debouncedTryInjectCheck = debounce(() => {
    if (!state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) {
        removeButtons();
        return;
    }
    tryInjectButtons(0);
}, CONFIG.DEBOUNCE.MUTATION);


function playerMutationCallback(mutationsList, observer) {
  let relevantChange = false;
  for (const mutation of mutationsList) {
    if (mutation.type === 'childList') {
       if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
         relevantChange = true;
         break;
       }
    }
  }
  if (relevantChange) {
    debouncedTryInjectCheck();
  }
}

function observePlayerChanges() {
  if (!state.settings.extensionEnabled) return;

  if (state.playerObserver) state.playerObserver.disconnect();

  const moviePlayer = document.querySelector(CONFIG.SELECTORS.MOVIE_PLAYER) || document.body;
  if (!moviePlayer) {
      console.warn("YT FF/RW: Could not find movie player element to observe.");
      return;
  };

  state.playerObserver = new MutationObserver(playerMutationCallback);
  state.playerObserver.observe(moviePlayer, {
      childList: true,
      subtree: true
  });
}

const debouncedNavigationHandler = debounce(() => {
    if (window.location.href !== state.lastUrl) {
        state.lastUrl = window.location.href;
        handleNavigation();
    }
}, CONFIG.DEBOUNCE.NAVIGATION);


function handleNavigation() {
    if (!state.settings.extensionEnabled) return;

    removeButtons();
    state.retryAttempts = 0;
    if (retryTimeout) clearTimeout(retryTimeout);
    state.lastVideoElement = null;

    setTimeout(() => {
        if (!state.settings.extensionEnabled) return;
        observePlayerChanges();
        tryInjectButtons(0);
    }, 500);
}

const debouncedFullscreenCheck = debounce(() => {
  if (state.settings.extensionEnabled && state.settings.buttonSkipEnabled) {
      tryInjectButtons(0);
  }
}, CONFIG.DEBOUNCE.FULLSCREEN);

function handleFullscreenChange() {
  if (!state.settings.extensionEnabled) return;
  debouncedFullscreenCheck();
}

const debouncedResizeCheck = debounce(() => {
  if (state.settings.extensionEnabled && state.settings.buttonSkipEnabled) {
      tryInjectButtons(0);
  }
}, CONFIG.DEBOUNCE.RESIZE);


async function initializeExtension() {
    cleanup();

    try {
        const stored = await browser.storage.local.get(CONFIG.DEFAULT_SETTINGS);
        state.settings = { ...CONFIG.DEFAULT_SETTINGS, ...stored };

        if (!state.settings.extensionEnabled) {
          console.log("YT FF/RW: Extension is disabled in settings.");
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
        observePlayerChanges();

        setTimeout(() => {
            if (state.settings.extensionEnabled) {
                 tryInjectButtons(0);
            }
        }, 100);

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
      if (state.settings.buttonSkipEnabled && !oldSettings.buttonSkipEnabled) {
          tryInjectButtons(0);
      } else if (!state.settings.buttonSkipEnabled && oldSettings.buttonSkipEnabled) {
          removeButtons();
      } else if (state.buttonsInjected) {
           updateButtonCounters();
      }

      document.removeEventListener('keydown', handleKeyDown, true);
      document.addEventListener('keydown', handleKeyDown, true);
    }

    sendResponse({ status: "Settings updated successfully" });
    return true;
  }
  return false;
});

initializeExtension();