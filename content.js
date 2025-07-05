const CONFIG = {
  SELECTORS: {
    VIDEO_PLAYERS: [
      'video.html5-main-video',
      '.html5-video-player video',
      '.html5-video-player .html5-main-video',
      '#movie_player video'
    ],
    CONTROLS: '.ytp-left-controls',
    CONTROLS_RIGHT: '.ytp-right-controls',
    CHROME_CONTROLS: '.ytp-chrome-controls',
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
  DEFAULT_DEBOUNCE: {
    NAVIGATION: 200,
    MUTATION: 400,
    FULLSCREEN: 100,
    RESIZE: 150
  },
  DEFAULT_SETTINGS: {
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
    actionDelay: 0,
    buttonPosition: 'left'
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
  MAX_STORED_ERRORS: 10,
  SEEK_INTERVAL_DELAY: 150
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
  actionTimeout: null,
  cachedMoviePlayer: null,
  seekIntervalId: null,
  activeSeekKey: null,
  skipIndicatorElement: null,
  skipIndicatorTimeout: null,
  preventAutoHide: false,
  autoHideGuardTimeout: null,
  isHolding: false,
  holdTransitionTimeout: null,
};

let retryTimeout = null;
const debouncedTryInjectCheck = debounce(() => tryInjectButtons(0), CONFIG.DEFAULT_DEBOUNCE.MUTATION);
const debouncedNavigationHandler = debounce(onNavigation, CONFIG.DEFAULT_DEBOUNCE.NAVIGATION);
const debouncedFullscreenCheck = debounce(() => {
    if(isWatchPage() && state.settings.buttonSkipEnabled) tryInjectButtons(0);
}, CONFIG.DEFAULT_DEBOUNCE.FULLSCREEN);
const debouncedResizeCheck = debounce(() => {
    if(isWatchPage() && state.settings.buttonSkipEnabled) tryInjectButtons(0);
}, CONFIG.DEFAULT_DEBOUNCE.RESIZE);

async function trackSkip(amount, type) {
    try {
        const data = await browser.storage.local.get([
            'stats_totalSecondsSkipped',
            'stats_totalSkips',
            'stats_buttonSkips',
            'stats_keyboardSkips'
        ]);
        const stats = {
            stats_totalSecondsSkipped: (data.stats_totalSecondsSkipped || 0) + Math.abs(amount),
            stats_totalSkips: (data.stats_totalSkips || 0) + 1,
            stats_buttonSkips: (data.stats_buttonSkips || 0) + (type === 'button' ? 1 : 0),
            stats_keyboardSkips: (data.stats_keyboardSkips || 0) + (type === 'keyboard' ? 1 : 0)
        };
        await browser.storage.local.set(stats);
    } catch(e) {
        logErrorToStorage('Failed to track skip', e);
    }
}

function performSeek(skipTime) {
    if (state.actionTimeout) clearTimeout(state.actionTimeout);
    const currentVideoPlayer = findVideoPlayerElement();
    if (!currentVideoPlayer || currentVideoPlayer.seeking || state.isBuffering) {
        return;
    }
    const delay = state.settings.actionTimingEnabled ? (state.settings.actionDelay || 0) : 0;
    const newTime = Math.max(0, Math.min(currentVideoPlayer.duration || Infinity, currentVideoPlayer.currentTime + skipTime));
    if (delay > 0 && !state.seekIntervalId) {
        state.actionTimeout = setTimeout(() => {
            currentVideoPlayer.currentTime = newTime;
        }, delay);
    } else {
        currentVideoPlayer.currentTime = newTime;
    }
}

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
        let { recentErrors = [] } = await browser.storage.local.get('recentErrors');
        recentErrors.push(errorData);
        if (recentErrors.length > CONFIG.MAX_STORED_ERRORS) {
            recentErrors = recentErrors.slice(recentErrors.length - CONFIG.MAX_STORED_ERRORS);
        }
        await browser.storage.local.set({ recentErrors: recentErrors });
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
    if (state.cachedMoviePlayer && state.cachedMoviePlayer.isConnected) {
        return state.cachedMoviePlayer;
    }
    state.cachedMoviePlayer = document.querySelector(CONFIG.SELECTORS.MOVIE_PLAYER);
    return state.cachedMoviePlayer;
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

function showPlayerControlsAndSetGuard() {
    const moviePlayer = findMoviePlayerContainerElement();
    if (moviePlayer) {
        moviePlayer.classList.remove(CONFIG.SELECTORS.AUTOHIDE_CLASS);
        state.preventAutoHide = true;
        if (state.autoHideGuardTimeout) {
            clearTimeout(state.autoHideGuardTimeout);
        }
        state.autoHideGuardTimeout = setTimeout(() => {
            state.preventAutoHide = false;
        }, 2500);
    }
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
    button.style.backgroundColor = 'transparent';
  } catch (e) {
    logErrorToStorage("Failed to set background image for button", id, iconPath, e);
  }
  const counter = document.createElement('div');
  counter.id = `${id}-counter`;
  counter.classList.add('ytp-custom-button-counter');
  button.appendChild(counter);
  return button;
}

function updateButtonCounters(container) {
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
    const moviePlayerContainer = findMoviePlayerContainerElement();
    const isAdShowing = moviePlayerContainer && moviePlayerContainer.classList.contains(CONFIG.SELECTORS.AD_SHOWING_CLASS);
    let skipTimeValue = 0;
    if (isAdShowing && button.id === CONFIG.IDS.FORWARD_BUTTON) {
        if (clickYouTubeSkipButton()) return;
        const currentVideoPlayer = findVideoPlayerElement();
        if (currentVideoPlayer && currentVideoPlayer.duration && isFinite(currentVideoPlayer.duration)) {
             currentVideoPlayer.currentTime = currentVideoPlayer.duration;
             return;
        }
    }
    if (button.id === CONFIG.IDS.FORWARD_BUTTON) {
        skipTimeValue = state.settings.forwardSkipTime || CONFIG.DEFAULT_SETTINGS.forwardSkipTime;
    } else if (button.id === CONFIG.IDS.REWIND_BUTTON) {
        skipTimeValue = -(state.settings.backwardSkipTime || CONFIG.DEFAULT_SETTINGS.backwardSkipTime);
    }
    if (skipTimeValue !== 0) {
        showPlayerControlsAndSetGuard();
        performSeek(skipTimeValue);
        trackSkip(skipTimeValue, 'button');
    }
}

function injectButtons() {
    try {
        if (!state.settings.buttonSkipEnabled || !isWatchPage()) {
            removeButtons();
            return false;
        }
        const moviePlayer = findMoviePlayerContainerElement();
        if (!moviePlayer) {
            removeButtons();
            return false;
        }
        let buttonsContainer = document.getElementById(CONFIG.IDS.CONTAINER);
        if (!buttonsContainer) {
            buttonsContainer = createButtonsContainer();
        }
        const position = state.settings.buttonPosition || 'left';
        buttonsContainer.classList.toggle('position-right', position === 'right');
        updateButtonCounters(buttonsContainer);
        let correctParent;
        let anchorElement;
        if (position === 'right') {
            correctParent = moviePlayer.querySelector(CONFIG.SELECTORS.CHROME_CONTROLS);
            anchorElement = correctParent ? correctParent.querySelector(CONFIG.SELECTORS.CONTROLS_RIGHT) : null;
        } else {
            correctParent = moviePlayer.querySelector(CONFIG.SELECTORS.CONTROLS);
            anchorElement = correctParent ? correctParent.querySelector(CONFIG.SELECTORS.TIME_DISPLAY)?.nextSibling : null;
        }
        if (!correctParent) {
            removeButtons();
            return false;
        }
        if (buttonsContainer.parentElement !== correctParent) {
            if (anchorElement) {
                correctParent.insertBefore(buttonsContainer, anchorElement);
            } else {
                correctParent.appendChild(buttonsContainer);
            }
        }
        requestAnimationFrame(() => buttonsContainer.classList.add('visible'));
        state.buttonsInjected = true;
        return true;
    } catch (e) {
        logErrorToStorage("Error in injectButtons", e);
        return false;
    }
}

function removeButtons() {
  const container = document.getElementById(CONFIG.IDS.CONTAINER);
  if (container) {
    container.remove();
  }
  state.buttonsInjected = false;
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

function sanitizeSettings(settingsObject) {
    const newSettings = { ...settingsObject };
    for (const key in CONFIG.DEFAULT_SETTINGS) {
        if (newSettings[key] === undefined || typeof newSettings[key] !== typeof CONFIG.DEFAULT_SETTINGS[key]) {
            newSettings[key] = CONFIG.DEFAULT_SETTINGS[key];
        }
    }
    return newSettings;
}

function stopContinuousSeek() {
    if (state.seekIntervalId) {
        clearInterval(state.seekIntervalId);
        state.seekIntervalId = null;
    }
    if (state.holdTransitionTimeout) {
        clearTimeout(state.holdTransitionTimeout);
        state.holdTransitionTimeout = null;
    }
    state.isHolding = false;
    if (state.skipIndicatorElement) {
        state.skipIndicatorElement.classList.remove('holding');
        if (state.skipIndicatorTimeout) clearTimeout(state.skipIndicatorTimeout);
        state.skipIndicatorTimeout = setTimeout(() => {
            if (state.skipIndicatorElement) {
                state.skipIndicatorElement.classList.remove('visible');
            }
        }, 500);
    }
    state.activeSeekKey = null;
}

function showSkipIndicator(seconds, direction = 'forward') {
  const moviePlayer = findMoviePlayerContainerElement();
  if (!moviePlayer) return;

  if (!state.skipIndicatorElement || !state.skipIndicatorElement.isConnected) {
    state.skipIndicatorElement = document.createElement('div');
    state.skipIndicatorElement.id = 'yt-ffrw-skip-indicator';
    state.skipIndicatorElement.innerHTML = `
      <svg id="yt-ffrw-skip-indicator-arrows" viewBox="0 0 32 24">
        <polyline class="yt-ffrw-arrow-chevron" points="6,0 12,6 6,12" />
        <polyline class="yt-ffrw-arrow-chevron" points="14,0 20,6 14,12" />
        <polyline class="yt-ffrw-arrow-chevron" points="22,0 28,6 22,12" />
      </svg>
      <span id="yt-ffrw-skip-indicator-text"></span>
    `;
    moviePlayer.appendChild(state.skipIndicatorElement);
  }

  const textContainer = state.skipIndicatorElement.querySelector('#yt-ffrw-skip-indicator-text');
  if (!textContainer) return;
  textContainer.textContent = `${seconds}s`;

  state.skipIndicatorElement.classList.remove('position-left', 'position-right');
  if (direction === 'forward') {
    state.skipIndicatorElement.classList.add('position-right');
  } else {
    state.skipIndicatorElement.classList.add('position-left');
  }

  if (state.isHolding) {
    state.skipIndicatorElement.classList.add('holding');
  } else {
    state.skipIndicatorElement.classList.remove('holding');
    state.skipIndicatorElement.classList.remove('anim-forward', 'anim-backward');
    void state.skipIndicatorElement.offsetWidth;
    state.skipIndicatorElement.classList.add(direction === 'forward' ? 'anim-forward' : 'anim-backward');
  }
  
  state.skipIndicatorElement.classList.add('visible');

  if (state.skipIndicatorTimeout) {
    clearTimeout(state.skipIndicatorTimeout);
    state.skipIndicatorTimeout = null;
  }
}

function handleKeyUp(event) {
    if (event.key === state.settings.keyboardBackwardKey || event.key === state.settings.keyboardForwardKey) {
        if (state.activeSeekKey === event.key) {
            stopContinuousSeek();
        }
    }
}

function handleKeyDown(event) {
    if (!state.settings.extensionEnabled || !state.settings.keyboardShortcutsEnabled) return;
    if (isEditable(document.activeElement) || event.target.closest('[contenteditable="true"]')) {
        stopContinuousSeek();
        return;
    }
    const isForward = event.key === state.settings.keyboardForwardKey;
    const isBackward = event.key === state.settings.keyboardBackwardKey;
    if (!isForward && !isBackward) return;
    const shouldOverride = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    if (shouldOverride) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        
        if (state.activeSeekKey === event.key) {
            return;
        }
        stopContinuousSeek();
        state.activeSeekKey = event.key;

        const skipAmount = isForward
            ? (state.settings.keyboardForward || CONFIG.DEFAULT_SETTINGS.keyboardForward)
            : (state.settings.keyboardBackward || CONFIG.DEFAULT_SETTINGS.keyboardBackward);

        const skipTimeValue = isForward ? skipAmount : -skipAmount;
        const direction = isForward ? 'forward' : 'backward';

        showPlayerControlsAndSetGuard();
        
        state.isHolding = false;
        performSeek(skipTimeValue);
        trackSkip(skipTimeValue, 'keyboard');
        showSkipIndicator(skipAmount, direction);

        state.holdTransitionTimeout = setTimeout(() => {
            state.isHolding = true;
            showSkipIndicator(skipAmount, direction);
        }, 400);

        state.seekIntervalId = setInterval(() => {
            performSeek(skipTimeValue);
            trackSkip(skipTimeValue, 'keyboard');
        }, CONFIG.SEEK_INTERVAL_DELAY);
    }
}

function addKeyListeners() {
    if (state.keyListenersAttached) return;
    try {
        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keyup', handleKeyUp, true);
        window.addEventListener('blur', stopContinuousSeek);
        state.keyListenersAttached = true;
    } catch (e) {
        logErrorToStorage("Failed to attach key listeners:", e);
    }
}

function removeKeyListeners() {
    if (!state.keyListenersAttached) return;
    try {
        document.removeEventListener('keydown', handleKeyDown, true);
        document.removeEventListener('keyup', handleKeyUp, true);
        window.removeEventListener('blur', stopContinuousSeek);
        state.keyListenersAttached = false;
        stopContinuousSeek();
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

function playerMutationCallback(mutationsList, observer) {
  const moviePlayerContainer = findMoviePlayerContainerElement();
  let hasRelevantChange = false;

  for (const mutation of mutationsList) {
    if (
        state.preventAutoHide &&
        mutation.type === 'attributes' &&
        mutation.attributeName === 'class' &&
        mutation.target === moviePlayerContainer &&
        moviePlayerContainer.classList.contains(CONFIG.SELECTORS.AUTOHIDE_CLASS)
    ) {
        moviePlayerContainer.classList.remove(CONFIG.SELECTORS.AUTOHIDE_CLASS);
    }

    if (!hasRelevantChange) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        hasRelevantChange = true;
      } else if (mutation.type === 'childList') {
        hasRelevantChange = true;
      }
    }
  }
  
  if (hasRelevantChange) {
    debouncedTryInjectCheck();
  }
}

function observePlayerChanges() {
  if (state.playerObserver) {
      state.playerObserver.disconnect();
      state.playerObserver = null;
  }
  if (!state.settings.extensionEnabled || !isWatchPage()) {
      return;
  }
  const moviePlayerContainerToObserve = findMoviePlayerContainerElement();
  if (!moviePlayerContainerToObserve) {
      setTimeout(observePlayerChanges, 250);
      return;
  }
  state.playerObserver = new MutationObserver(playerMutationCallback);
  state.playerObserver.observe(moviePlayerContainerToObserve, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
  });
  tryInjectButtons(0);
}

function onNavigation() {
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
}

function handleNavigation() {
    if (state.playerObserver) {
        state.playerObserver.disconnect();
        state.playerObserver = null;
    }
    state.retryAttempts = 0;
    if (retryTimeout) clearTimeout(retryTimeout);
    state.cachedMoviePlayer = null;
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

function handleFullscreenChange() {
    if (!state.settings.extensionEnabled) return;
    debouncedFullscreenCheck();
}

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
  if (state.actionTimeout) clearTimeout(state.actionTimeout);
  state.actionTimeout = null;
  if (state.skipIndicatorElement) {
    state.skipIndicatorElement.remove();
    state.skipIndicatorElement = null;
  }
  if (state.skipIndicatorTimeout) {
    clearTimeout(state.skipIndicatorTimeout);
    state.skipIndicatorTimeout = null;
  }
  if (state.autoHideGuardTimeout) {
    clearTimeout(state.autoHideGuardTimeout);
    state.autoHideGuardTimeout = null;
  }
  if (state.holdTransitionTimeout) {
      clearTimeout(state.holdTransitionTimeout);
      state.holdTransitionTimeout = null;
  }
  state.buttonsInjected = false;
  state.retryAttempts = 0;
  state.isBuffering = false;
  state.keyListenersAttached = false;
  state.isHoveringOverCustomButtons = false;
  state.preventAutoHide = false;
  state.isHolding = false;
}

async function initializeExtension() {
    cleanup();
    try {
        const stored = await browser.storage.local.get(Object.keys(CONFIG.DEFAULT_SETTINGS));
        state.settings = sanitizeSettings({ ...CONFIG.DEFAULT_SETTINGS, ...stored });
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
    state.settings = sanitizeSettings({ ...CONFIG.DEFAULT_SETTINGS, ...message.settings });
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
        if (isWatchPage()) {
            tryInjectButtons(0);
        } else {
            removeButtons();
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