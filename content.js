const CONFIG = {
  SELECTORS: {
    MOVIE_PLAYER: '#movie_player',
    VIDEO_TAG: 'video.html5-main-video',
    CONTROLS_WRAPPER: '.ytp-chrome-bottom',
    LEFT_CONTROLS: '.ytp-left-controls',
    TIME_DISPLAY: '.ytp-time-display.notranslate',
    AUTOHIDE_CLASS_TARGET: '#movie_player',
    AUTOHIDE_CLASS: 'ytp-autohide'
  },
  RETRY: {
    INTERVAL: 350,
    MAX_ATTEMPTS: 25
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
  lastUrl: null,
  settings: { ...CONFIG.DEFAULT_SETTINGS },
  playerElementCache: null,
  isBuffering: false,
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

function isWatchPage(url = window.location.href) {
  try {
    if (!url) return false;
    const currentUrl = new URL(url);
    return currentUrl.pathname === '/watch';
  } catch (e) {
    return false;
  }
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
  try {
      const player = moviePlayer.querySelector(CONFIG.SELECTORS.VIDEO_TAG);
      if (player && player.tagName === 'VIDEO' && typeof player.currentTime === 'number') {
          return player;
      }
  } catch(e) { console.error("YT FF/RW: Error finding video player:", e); }
  return null;
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

function keepControlsVisible() {
    state.isHoveringOverCustomButtons = true;
    const player = document.querySelector(CONFIG.SELECTORS.AUTOHIDE_CLASS_TARGET);
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

function performDirectSeek(direction) {
    const moviePlayer = findMoviePlayer();
    const videoPlayer = state.lastVideoElement || findVideoPlayer(moviePlayer);

    if (!videoPlayer || videoPlayer.readyState < 3 || videoPlayer.seeking || state.isBuffering || videoPlayer.ended) {
         if (state.isBuffering) {
             console.log("YT FF/RW: Seek blocked by buffering state.");
         } else if (videoPlayer && videoPlayer.ended) {
             console.log("YT FF/RW: Seek blocked, video ended.");
         } else if (videoPlayer && videoPlayer.seeking) {
              console.log("YT FF/RW: Seek blocked, player already seeking.");
         } else if (videoPlayer && videoPlayer.readyState < 3) {
              console.log(`YT FF/RW: Seek blocked, readyState=${videoPlayer.readyState}`);
         }
        return;
    }

    try {
        let skipTime = 0;
        let newTime;
        let currentTargetTime = videoPlayer.currentTime;

        if (direction === 'forward') {
            skipTime = state.settings.forwardSkipTime || CONFIG.DEFAULT_SETTINGS.forwardSkipTime;
            newTime = Math.min(videoPlayer.duration || Infinity, currentTargetTime + skipTime);
        } else if (direction === 'backward') {
            skipTime = -(state.settings.backwardSkipTime || CONFIG.DEFAULT_SETTINGS.backwardSkipTime);
            newTime = Math.max(0, currentTargetTime + skipTime);
        } else if (direction === 'forward_key') {
            skipTime = state.settings.keyboardForward || CONFIG.DEFAULT_SETTINGS.keyboardForward;
            newTime = Math.min(videoPlayer.duration || Infinity, currentTargetTime + skipTime);
        } else if (direction === 'backward_key') {
            skipTime = -(state.settings.keyboardBackward || CONFIG.DEFAULT_SETTINGS.keyboardBackward);
            newTime = Math.max(0, currentTargetTime + skipTime);
        }

        if (newTime !== undefined && !isNaN(newTime) && Math.abs(videoPlayer.currentTime - newTime) > 0.01) {
            videoPlayer.currentTime = newTime;
        }
    } catch (e) {
        console.error(`YT FF/RW: Error setting currentTime during ${direction} seek:`, e);
    }
}

function handleButtonClick(event) {
    if (!state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) return;

    const button = event.target.closest('button');
    if (!button) return;

    event.stopPropagation();
    event.preventDefault();

    if (button.id === CONFIG.IDS.FORWARD_BUTTON) {
        performDirectSeek('forward');
    } else if (button.id === CONFIG.IDS.REWIND_BUTTON) {
        performDirectSeek('backward');
    }
}

function setupVideoControls() {
  const container = document.getElementById(CONFIG.IDS.CONTAINER);
  if (!container) return;

  container.removeEventListener('click', handleButtonClick, { capture: true });
  container.addEventListener('click', handleButtonClick, { capture: true });
}


function injectButtons() {
    if (!isWatchPage() || !state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) {
      removeButtons();
      return false;
    }

    const moviePlayer = findMoviePlayer();
     if(!moviePlayer || moviePlayer.classList.contains('ad-showing')){
        removeButtons();
        return false;
     }

    const videoPlayer = findVideoPlayer(moviePlayer);
    const controlsWrapper = moviePlayer.querySelector(CONFIG.SELECTORS.CONTROLS_WRAPPER);
    const controlsContainer = controlsWrapper ? controlsWrapper.querySelector(CONFIG.SELECTORS.LEFT_CONTROLS) : null;

    if (!videoPlayer || !controlsWrapper || !controlsContainer) {
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

    let existingContainer = document.getElementById(CONFIG.IDS.CONTAINER);

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

    try {
      const buttonsContainer = createButtonsContainer();
      const timeDisplay = controlsContainer.querySelector(CONFIG.SELECTORS.TIME_DISPLAY);

      if (timeDisplay && timeDisplay.parentNode === controlsContainer) {
          controlsContainer.insertBefore(buttonsContainer, timeDisplay.nextSibling);
      } else {
          controlsContainer.appendChild(buttonsContainer);
          console.warn("YT FF/RW: Time display not found relative to left controls. Appending buttons to end.");
      }

      buttonsContainer.addEventListener('mouseenter', keepControlsVisible);
      buttonsContainer.addEventListener('mouseleave', handleMouseLeaveCustomButtons);

      setupVideoControls();
      updateButtonCounters();
      state.buttonsInjected = true;
      return true;
    } catch (e) {
       console.error("YT FF/RW: Error injecting buttons:", e);
       removeButtons();
       return false;
    }
}


function handleKeyDown(event) {
  if (!isWatchPage() || !state.settings.extensionEnabled || !state.settings.keyboardShortcutsEnabled) return;
  if (isEditable(document.activeElement)) return;

  const isLeft = event.key === 'ArrowLeft';
  const isRight = event.key === 'ArrowRight';
  const shouldOverride = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;

  if ((isRight || isLeft) && shouldOverride) {
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();

    if (isRight) {
        performDirectSeek('forward_key');
    } else {
        performDirectSeek('backward_key');
    }
  }
}

function cleanup() {
  if (retryTimeout) clearTimeout(retryTimeout); retryTimeout = null;
  state.isHoveringOverCustomButtons = false;
  removeButtons();
  removeBufferingListeners(state.lastVideoElement);
  if (state.navigationObserver) state.navigationObserver.disconnect(); state.navigationObserver = null;
  if (state.playerObserver) state.playerObserver.disconnect(); state.playerObserver = null;
  document.removeEventListener('keydown', handleKeyDown, true);
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  window.removeEventListener('resize', debouncedResizeCheck);
  state.buttonsInjected = false;
  state.retryAttempts = 0;
  state.lastVideoElement = null;
  state.playerElementCache = null;
  state.isBuffering = false;
}

function removeButtons() {
  const container = document.getElementById(CONFIG.IDS.CONTAINER);
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
  state.buttonsInjected = false;
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
            mutation.target.matches(CONFIG.SELECTORS.AUTOHIDE_CLASS_TARGET))
        {
            const targetElement = mutation.target;
            if (targetElement.classList.contains(CONFIG.SELECTORS.AUTOHIDE_CLASS)) {
                if (state.isHoveringOverCustomButtons) {
                    autohideAddedWhileHovering = true;
                }
            }
            relevantChange = true;
        }

         if (mutation.type === 'childList' || (mutation.type === 'attributes' && mutation.attributeName === 'src')) {
            let videoChanged = false;
            if (mutation.type === 'attributes' && mutation.target.matches && mutation.target.matches(CONFIG.SELECTORS.VIDEO_TAG)) {
                videoChanged = true;
            } else if (mutation.type === 'childList') {
                 for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
                     if (node.nodeType === Node.ELEMENT_NODE && node.matches && node.matches(CONFIG.SELECTORS.VIDEO_TAG)) {
                         videoChanged = true;
                         break;
                     }
                 }
            }
             if (videoChanged) {
                 relevantChange = true;
                 setTimeout(() => tryInjectButtons(0), 50);
             }
         }


         if (mutation.type === 'childList' || (mutation.type === 'attributes' && mutation.attributeName === 'class')) {
             if (mutation.target && typeof mutation.target.matches === 'function') {
                 if (mutation.target.matches(CONFIG.SELECTORS.CONTROLS_WRAPPER) ||
                     mutation.target.matches(CONFIG.SELECTORS.LEFT_CONTROLS) ||
                     mutation.target.closest(CONFIG.SELECTORS.CONTROLS_WRAPPER)) {
                    relevantChange = true;
                 }
             }
             if (!relevantChange && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
                  relevantChange = true;
             }
        }
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
  if (!isWatchPage() || !state.settings.extensionEnabled) return;

  if (state.playerObserver) state.playerObserver.disconnect();

  const moviePlayer = findMoviePlayer();
  if (!moviePlayer) {
      console.warn("YT FF/RW: Could not find movie player element to observe. Will retry on navigation/mutation.");
      return;
  };

 try {
    state.playerObserver = new MutationObserver(playerMutationCallback);
    state.playerObserver.observe(moviePlayer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'src']
    });
 } catch (e) {
    console.error("YT FF/RW: Failed to set up player observer:", e);
 }
}

const debouncedNavigationHandler = debounce(() => {
  const currentUrl = window.location.href;
  if (currentUrl !== state.lastUrl) {
      const wasWatch = isWatchPage(state.lastUrl);
      const isNowWatch = isWatchPage(currentUrl);
      state.lastUrl = currentUrl;
      state.playerElementCache = null;

      if (wasWatch && !isNowWatch) {
          cleanup();
      } else if (isNowWatch) {
          handleNavigation();
      } else {
         cleanup();
      }
  }
}, CONFIG.DEBOUNCE.NAVIGATION);


function handleNavigation() {
    if (!state.settings.extensionEnabled || !isWatchPage()) {
        cleanup();
        return;
    }

    if (retryTimeout) clearTimeout(retryTimeout); retryTimeout = null;

    removeButtons();
    removeBufferingListeners(state.lastVideoElement);
    state.retryAttempts = 0;
    state.lastVideoElement = null;
    state.playerElementCache = null;
    state.isBuffering = false;
    state.isHoveringOverCustomButtons = false;

    setTimeout(() => {
        if (state.settings.extensionEnabled && isWatchPage(window.location.href)) {
            observePlayerChanges();
            tryInjectButtons(0);
        } else {
            cleanup();
        }
    }, 500);
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
        const stored = await browser.storage.local.get(Object.values(CONFIG.STORAGE_KEYS));
        state.settings = { ...CONFIG.DEFAULT_SETTINGS, ...stored };

        if (!state.settings.extensionEnabled) {
          console.log("YT FF/RW: Extension is disabled in settings.");
          return;
        }

        state.lastUrl = window.location.href;

        const setupWatchPageListenersAndAttemptInject = () => {
            document.removeEventListener('keydown', handleKeyDown, true);
            document.addEventListener('keydown', handleKeyDown, true);
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.addEventListener('fullscreenchange', handleFullscreenChange);
            window.removeEventListener('resize', debouncedResizeCheck);
            window.addEventListener('resize', debouncedResizeCheck);
            observePlayerChanges();
             setTimeout(() => {
                if (state.settings.extensionEnabled && isWatchPage(window.location.href)) {
                     tryInjectButtons(0);
                }
            }, 250);
        };

        if (isWatchPage()) {
            setupWatchPageListenersAndAttemptInject();
        } else {
            console.log("YT FF/RW: Not a watch page, initialization deferred.");
        }

        if (!state.navigationObserver) {
            state.navigationObserver = new MutationObserver(debouncedNavigationHandler);
            state.navigationObserver.observe(document.body, { childList: true, subtree: false });
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
    const wasEnabled = oldSettings.extensionEnabled;
    const isEnabled = state.settings.extensionEnabled;
    const isOnWatchPage = isWatchPage();

    if (!isEnabled && wasEnabled) {
      cleanup();
    }
    else if (isEnabled && !wasEnabled) {
      initializeExtension();
    }
    else if (isEnabled && isOnWatchPage) {
       const buttonsWereEnabled = oldSettings.buttonSkipEnabled;
       const buttonsAreEnabled = state.settings.buttonSkipEnabled;

       if (buttonsAreEnabled && !buttonsWereEnabled) {
          tryInjectButtons(0);
          document.removeEventListener('fullscreenchange', handleFullscreenChange);
          document.addEventListener('fullscreenchange', handleFullscreenChange);
          window.removeEventListener('resize', debouncedResizeCheck);
          window.addEventListener('resize', debouncedResizeCheck);
       } else if (!buttonsAreEnabled && buttonsWereEnabled) {
          removeButtons();
          document.removeEventListener('fullscreenchange', handleFullscreenChange);
          window.removeEventListener('resize', debouncedResizeCheck);
       } else if (state.buttonsInjected) {
           updateButtonCounters();
       }

       const keyboardWasEnabled = oldSettings.keyboardShortcutsEnabled;
       const keyboardIsEnabled = state.settings.keyboardShortcutsEnabled;
       document.removeEventListener('keydown', handleKeyDown, true);
       if(keyboardIsEnabled){
           document.addEventListener('keydown', handleKeyDown, true);
       }
    } else if (isEnabled && !isOnWatchPage) {
        cleanup();
         if (!state.navigationObserver) {
             try {
                state.navigationObserver = new MutationObserver(debouncedNavigationHandler);
                state.navigationObserver.observe(document.body, { childList: true, subtree: false });
             } catch (e) {
                 console.error("YT FF/RW: Failed to re-attach navigation observer", e);
             }
         }
         document.removeEventListener('keydown', handleKeyDown, true);
         document.addEventListener('keydown', handleKeyDown, true);
         document.removeEventListener('fullscreenchange', handleFullscreenChange);
         document.addEventListener('fullscreenchange', handleFullscreenChange);
         window.removeEventListener('resize', debouncedResizeCheck);
         window.addEventListener('resize', debouncedResizeCheck);
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