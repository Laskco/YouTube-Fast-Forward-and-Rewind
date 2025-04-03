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
    MAX_ATTEMPTS: 20,
    MOVIE_MAX_ATTEMPTS: 30
  },
  DEBOUNCE: {
    NAVIGATION: 300,
    MUTATION: 200
  },
  STORAGE_KEYS: {
    ENABLED_STATE: 'extensionEnabled',
    FORWARD_SKIP_TIME: 'forwardSkipTime',
    BACKWARD_SKIP_TIME: 'backwardSkipTime',
    KEYBOARD_FORWARD: 'keyboardForward',
    KEYBOARD_BACKWARD: 'keyboardBackward'
  },
  DEFAULT_SKIP_TIMES: {
    FORWARD: 10,
    BACKWARD: 10,
    KEYBOARD_FORWARD: 5,
    KEYBOARD_BACKWARD: 5
  }
};

const state = {
  buttonsInjected: false,
  retryAttempts: 0,
  isMoviePage: false,
  navigationObserver: null,
  playerObserver: null,
  lastVideoElement: null,
  lastUrl: null,
  isEnabled: true,
  keyboardTimes: {
    forward: 5,
    backward: 5
  }
};

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function isMoviePage() {
  return window.location.href.includes('/watch') && 
         document.querySelector('ytd-watch-flexy[is-two-columns_]') === null;
}

function findVideoPlayer() {
  for (const selector of CONFIG.SELECTORS.VIDEO_PLAYERS) {
    const player = document.querySelector(selector);
    if (player && player.tagName === 'VIDEO') {
      return player;
    }
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
    left: ${id === 'fastForwardButton' ? 'calc(50% - 2px)' : '50%'};
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
  browser.storage.local.get([
    CONFIG.STORAGE_KEYS.FORWARD_SKIP_TIME,
    CONFIG.STORAGE_KEYS.BACKWARD_SKIP_TIME
  ]).then(result => {
    const forwardCounter = document.getElementById('fastForwardButton-counter');
    const backwardCounter = document.getElementById('rewindButton-counter');
    
    if (forwardCounter) {
      forwardCounter.textContent = result[CONFIG.STORAGE_KEYS.FORWARD_SKIP_TIME] || CONFIG.DEFAULT_SKIP_TIMES.FORWARD;
    }
    if (backwardCounter) {
      backwardCounter.textContent = result[CONFIG.STORAGE_KEYS.BACKWARD_SKIP_TIME] || CONFIG.DEFAULT_SKIP_TIMES.BACKWARD;
    }
  });
}

function createButtonsContainer() {
  const container = document.createElement('div');
  container.id = 'customButtonsContainer';
  container.style.cssText = `
    position: relative;
    left: 0;
    top: 0;
    display: flex;
    align-items: center;
    height: 100%;
    z-index: 1000;
  `;

  const rewindButton = createButton('rewindButton', 'icons/alt-rewind.png');
  const forwardButton = createButton('fastForwardButton', 'icons/alt-forward.png');
  
  rewindButton.style.marginRight = '2px';
  forwardButton.style.marginLeft = '2px';
  
  container.appendChild(rewindButton);
  container.appendChild(forwardButton);

  updateButtonCounters();
  return container;
}

function setupVideoControls(videoPlayer) {
  const container = document.getElementById('customButtonsContainer');
  if (!container) return;

  container.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    
    const storage = await browser.storage.local.get([
      CONFIG.STORAGE_KEYS.FORWARD_SKIP_TIME,
      CONFIG.STORAGE_KEYS.BACKWARD_SKIP_TIME
    ]);
    
    const forwardSkipTime = parseInt(storage[CONFIG.STORAGE_KEYS.FORWARD_SKIP_TIME]) || CONFIG.DEFAULT_SKIP_TIMES.FORWARD;
    const backwardSkipTime = parseInt(storage[CONFIG.STORAGE_KEYS.BACKWARD_SKIP_TIME]) || CONFIG.DEFAULT_SKIP_TIMES.BACKWARD;

    if (button.id === 'fastForwardButton') {
      videoPlayer.currentTime += forwardSkipTime;
    } else if (button.id === 'rewindButton') {
      videoPlayer.currentTime -= backwardSkipTime;
    }
  });
}

function injectButtons() {
  if (state.buttonsInjected || !state.isEnabled) return false;

  const videoPlayer = findVideoPlayer();
  const controlsContainer = document.querySelector(CONFIG.SELECTORS.CONTROLS);
  
  if (!videoPlayer || !controlsContainer) return false;

  const buttonsContainer = createButtonsContainer();
  const timeDisplay = controlsContainer.querySelector(CONFIG.SELECTORS.TIME_DISPLAY);
  
  if (timeDisplay) {
    controlsContainer.insertBefore(buttonsContainer, timeDisplay.nextSibling);
  } else {
    controlsContainer.appendChild(buttonsContainer);
  }

  setupVideoControls(videoPlayer);
  state.buttonsInjected = true;
  state.lastVideoElement = videoPlayer;
  return true;
}

function handleKeyDown(event) {
  if (!state.isEnabled) return;
  
  const videoPlayer = state.lastVideoElement || findVideoPlayer();
  if (!videoPlayer) return;

  if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

  const shouldOverride = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;

  if (event.key === 'ArrowRight' && shouldOverride) {
    event.preventDefault();
    event.stopImmediatePropagation();
    videoPlayer.currentTime += state.keyboardTimes.forward;
  } else if (event.key === 'ArrowLeft' && shouldOverride) {
    event.preventDefault();
    event.stopImmediatePropagation();
    videoPlayer.currentTime -= state.keyboardTimes.backward;
  }
}

function cleanup() {
  removeButtons();
  
  if (state.navigationObserver) {
    state.navigationObserver.disconnect();
    state.navigationObserver = null;
  }
  
  if (state.playerObserver) {
    state.playerObserver.disconnect();
    state.playerObserver = null;
  }
  
  document.removeEventListener('keydown', handleKeyDown, true);
  document.removeEventListener('fullscreenchange', handleFullscreenChange);

  const container = document.getElementById('customButtonsContainer');
  if (container) container.remove();

  state.buttonsInjected = false;
  state.retryAttempts = 0;
  state.lastVideoElement = null;
}

function removeButtons() {
  const container = document.getElementById('customButtonsContainer');
  if (container) container.remove();
  state.buttonsInjected = false;
}

function tryInjectButtons() {
  if (!state.isEnabled) return;

  const maxAttempts = state.isMoviePage ? 
    CONFIG.RETRY.MOVIE_MAX_ATTEMPTS : 
    CONFIG.RETRY.MAX_ATTEMPTS;

  if (state.retryAttempts >= maxAttempts) {
    state.retryAttempts = 0;
    return;
  }

  if (!injectButtons()) {
    state.retryAttempts++;
    setTimeout(tryInjectButtons, CONFIG.RETRY.INTERVAL);
  } else {
    state.retryAttempts = 0;
  }
}

function observePlayerChanges() {
  if (!state.isEnabled) return;

  if (state.playerObserver) state.playerObserver.disconnect();

  const moviePlayer = document.querySelector(CONFIG.SELECTORS.MOVIE_PLAYER);
  if (!moviePlayer) return;

  state.playerObserver = new MutationObserver(debounce(() => {
    if (!state.buttonsInjected || 
        (state.lastVideoElement && !document.contains(state.lastVideoElement))) {
      tryInjectButtons();
    }
  }, CONFIG.DEBOUNCE.MUTATION));

  state.playerObserver.observe(moviePlayer, {
    childList: true,
    subtree: false,
    attributes: true,
    attributeFilter: ['class']
  });
}

function handleNavigation() {
  if (!state.isEnabled) return;
  
  removeButtons();
  state.retryAttempts = 0;
  state.isMoviePage = isMoviePage();
  
  setTimeout(() => {
    observePlayerChanges();
    tryInjectButtons();
  }, 500);
}

async function initializeExtension() {
  try {
    const stored = await browser.storage.local.get([
      CONFIG.STORAGE_KEYS.ENABLED_STATE,
      CONFIG.STORAGE_KEYS.KEYBOARD_FORWARD,
      CONFIG.STORAGE_KEYS.KEYBOARD_BACKWARD
    ]);
    
    state.isEnabled = stored[CONFIG.STORAGE_KEYS.ENABLED_STATE] ?? true;
    state.keyboardTimes = {
      forward: stored[CONFIG.STORAGE_KEYS.KEYBOARD_FORWARD] ?? CONFIG.DEFAULT_SKIP_TIMES.KEYBOARD_FORWARD,
      backward: stored[CONFIG.STORAGE_KEYS.KEYBOARD_BACKWARD] ?? CONFIG.DEFAULT_SKIP_TIMES.KEYBOARD_BACKWARD
    };
    
    if (!state.isEnabled) {
      cleanup();
      return;
    }
    
    state.isMoviePage = isMoviePage();
    
    if (!state.navigationObserver) {
      state.navigationObserver = new MutationObserver(debounce(() => {
        if (window.location.href !== state.lastUrl) {
          state.lastUrl = window.location.href;
          handleNavigation();
        }
      }, CONFIG.DEBOUNCE.NAVIGATION));

      state.navigationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }

    document.addEventListener('keydown', handleKeyDown, true);
    observePlayerChanges();
    tryInjectButtons();
    
    setTimeout(() => {
      if (!state.buttonsInjected) {
        observePlayerChanges();
        tryInjectButtons();
      }
    }, 1000);
    
  } catch (error) {
    console.error('Error initializing extension:', error);
  }
}

function handleFullscreenChange() {
  if (!state.isEnabled) return;
  
  if (document.fullscreenElement) {
    if (!state.buttonsInjected) {
      state.retryAttempts = 0;
      tryInjectButtons();
    }
  } else {
    removeButtons();
    setTimeout(() => {
      state.retryAttempts = 0;
      tryInjectButtons();
    }, 300);
  }
}

document.addEventListener('fullscreenchange', debounce(handleFullscreenChange, 150));

browser.runtime.onMessage.addListener((message) => {
  switch (message.action) {
    case 'updateSettings':
      state.isEnabled = message.settings.extensionEnabled !== false;
      state.keyboardTimes = {
        forward: message.settings.keyboardForward || CONFIG.DEFAULT_SKIP_TIMES.KEYBOARD_FORWARD,
        backward: message.settings.keyboardBackward || CONFIG.DEFAULT_SKIP_TIMES.KEYBOARD_BACKWARD
      };
      
      if (message.settings.forwardSkipTime !== undefined || 
          message.settings.backwardSkipTime !== undefined) {
        updateButtonCounters();
      }
      
      if (!state.isEnabled) {
        cleanup();
      } else if (!state.buttonsInjected) {
        removeButtons();
        tryInjectButtons();
      }
      break;
      
    case 'updateState':
      state.isEnabled = message.isEnabled;
      if (message.isEnabled) {
        initializeExtension();
      } else {
        cleanup();
      }
      break;
      
    case 'getState':
      return Promise.resolve({ 
        isEnabled: state.isEnabled,
        keyboardTimes: state.keyboardTimes
      });
      
    case 'initializeExtension':
      initializeExtension();
      break;
  }
});

initializeExtension();