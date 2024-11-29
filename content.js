// Performance-optimized configuration with debouncing and caching
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
    BACKWARD_SKIP_TIME: 'backwardSkipTime'
  },
  DEFAULT_SKIP_TIMES: {
    FORWARD: 10,
    BACKWARD: 10
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
  isEnabled: true
};

const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

const isMoviePage = () => {
  return window.location.href.includes('/watch') && 
         document.querySelector('ytd-watch-flexy[is-two-columns_]') === null;
};

function findVideoPlayer() {
  for (const selector of CONFIG.SELECTORS.VIDEO_PLAYERS) {
    const player = document.querySelector(selector);
    if (player && player.tagName === 'VIDEO') {
      return player;
    }
  }
  return null;
}

const createButton = (id, iconPath, skipTime) => {
  const button = document.createElement('button');
  button.id = id;
  Object.assign(button.style, {
    width: '40px',
    height: '50px',
    backgroundImage: `url(${browser.runtime.getURL(iconPath)})`,
    backgroundSize: '80%',
    backgroundColor: 'transparent',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center 15px',
    border: 'none',
    cursor: 'pointer',
    padding: '0',
    marginTop: '-3px', // Move the button up by 3px
    transition: 'opacity 0.2s',
    opacity: '1',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    zIndex: '999'
  });

  // Adjust the positioning of the number text
  button.innerHTML = `<div style="
    position: absolute;
    bottom: 16px; /* Move the number up by 5px (from 15px to 10px) */
    ${
      id === 'fastForwardButton' 
        ? 'left: calc(50% - 2px);' 
        : 'left: 50%;' 
    }
    transform: translate(-50%, 0); /* Center text horizontally */
    width: 100%;
    text-align: center;
    color: white;
    pointer-events: none;
    font-size: 15px;
    font-family: 'Roboto', 'Arial', sans-serif;
    font-weight: 500;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.7);
  ">${skipTime}</div>`;

  button.addEventListener('mouseover', () => button.style.opacity = '0.8');
  button.addEventListener('mouseout', () => button.style.opacity = '1');
  
  return button;
};



function createButtonsContainer() {
  const container = document.createElement('div');
  container.id = 'customButtonsContainer';
  Object.assign(container.style, {
    position: 'relative',
    left: '0',
    top: '0',
    display: 'flex',
    alignItems: 'center',
    height: '100%',
    zIndex: '1000',
  });
  browser.storage.local.get([
    CONFIG.STORAGE_KEYS.FORWARD_SKIP_TIME,
    CONFIG.STORAGE_KEYS.BACKWARD_SKIP_TIME
  ]).then(result => {
    const forwardSkipTime = result[CONFIG.STORAGE_KEYS.FORWARD_SKIP_TIME] || CONFIG.DEFAULT_SKIP_TIMES.FORWARD;
    const backwardSkipTime = result[CONFIG.STORAGE_KEYS.BACKWARD_SKIP_TIME] || CONFIG.DEFAULT_SKIP_TIMES.BACKWARD;

    const rewindButton = createButton('rewindButton', 'icons/alt-rewind.png', backwardSkipTime);
    const forwardButton = createButton('fastForwardButton', 'icons/alt-forward.png', forwardSkipTime);
    
    // Adjust spacing between buttons
    rewindButton.style.marginRight = '2px'; // Add space between buttons
    forwardButton.style.marginLeft = '2px'; // Add space between buttons
    
    container.appendChild(rewindButton);
    container.appendChild(forwardButton);
  });
  return container;
}

// In content.js, update setupVideoControls function
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

    if (event.target.id === 'fastForwardButton') {
      videoPlayer.currentTime = videoPlayer.currentTime + forwardSkipTime;
    } else if (event.target.id === 'rewindButton') {
      videoPlayer.currentTime = videoPlayer.currentTime - backwardSkipTime;
    }
  });
}

function injectButtons() {
  if (state.buttonsInjected || !state.isEnabled) return false;

  const videoPlayer = findVideoPlayer();
  const controlsContainer = document.querySelector(CONFIG.SELECTORS.CONTROLS);
  
  if (!videoPlayer || !controlsContainer) {
    return false;
  }

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

const handleKeyDown = (event) => {
  if (!state.isEnabled) return;
  
  const videoPlayer = state.lastVideoElement || findVideoPlayer();
  if (!videoPlayer || videoPlayer.paused) return;

  if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

  browser.storage.local.get([
    CONFIG.STORAGE_KEYS.FORWARD_SKIP_TIME,
    CONFIG.STORAGE_KEYS.BACKWARD_SKIP_TIME
  ]).then(result => {
    const forwardSkipTime = result[CONFIG.STORAGE_KEYS.FORWARD_SKIP_TIME] || CONFIG.DEFAULT_SKIP_TIMES.FORWARD;
    const backwardSkipTime = result[CONFIG.STORAGE_KEYS.BACKWARD_SKIP_TIME] || CONFIG.DEFAULT_SKIP_TIMES.BACKWARD;

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        videoPlayer.currentTime += forwardSkipTime;
        break;
      case 'ArrowLeft':
        event.preventDefault();
        videoPlayer.currentTime -= backwardSkipTime;
        break;
    }
  });
};

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
  
  document.removeEventListener('keydown', handleKeyDown);
  document.removeEventListener('fullscreenchange', handleFullscreenChange);

  // Remove all event listeners from container
  const container = document.getElementById('customButtonsContainer');
  if (container) {
    container.replaceWith(container.cloneNode(true));
  }

  state.buttonsInjected = false;
  state.retryAttempts = 0;
  state.lastVideoElement = null;
}

function removeButtons() {
  const container = document.getElementById('customButtonsContainer');
  if (container) {
    container.remove();
  }
  state.buttonsInjected = false;
}

async function enableExtension() {
  try {
    await browser.storage.local.set({
      [CONFIG.STORAGE_KEYS.ENABLED_STATE]: true
    });
    
    state.isEnabled = true;
    initializeExtension();
    
    const tabs = await browser.tabs.query({url: '*://*.youtube.com/*'});
    tabs.forEach(tab => {
      browser.tabs.sendMessage(tab.id, {
        action: 'updateState',
        isEnabled: true
      });
    });
    
    return true;
  } catch (error) {
    console.error('Error enabling extension:', error);
    return false;
  }
}

async function disableExtension() {
  try {
    await browser.storage.local.set({
      [CONFIG.STORAGE_KEYS.ENABLED_STATE]: false
    });
    
    state.isEnabled = false;
    cleanup();
    
    const tabs = await browser.tabs.query({url: '*://*.youtube.com/*'});
    tabs.forEach(tab => {
      browser.tabs.sendMessage(tab.id, {
        action: 'updateState',
        isEnabled: false
      });
    });
    
    return true;
  } catch (error) {
    console.error('Error disabling extension:', error);
    return false;
  }
}

const tryInjectButtons = debounce(() => {
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
}, CONFIG.DEBOUNCE.MUTATION);

function observePlayerChanges() {
  if (!state.isEnabled) return;

  if (state.playerObserver) {
    state.playerObserver.disconnect();
  }

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
    const stored = await browser.storage.local.get(CONFIG.STORAGE_KEYS.ENABLED_STATE);
    state.isEnabled = stored[CONFIG.STORAGE_KEYS.ENABLED_STATE] ?? true;
    
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

    document.removeEventListener('keydown', handleKeyDown);
    document.addEventListener('keydown', handleKeyDown);
    
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

const handleFullscreenChange = debounce(() => {
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
}, 150);

document.addEventListener('fullscreenchange', handleFullscreenChange);

browser.runtime.onMessage.addListener(async (message) => {
  switch (message.action) {
    case 'updateState':
      if (message.isEnabled) {
        await enableExtension();
      } else {
        await disableExtension();
      }
      break;
    case 'updateTimes':
      if (message.times) {
        if (message.times.forwardSkipTime) {
          await browser.storage.local.set({ forwardSkipTime: message.times.forwardSkipTime });
        }
        if (message.times.backwardSkipTime) {
          await browser.storage.local.set({ backwardSkipTime: message.times.backwardSkipTime });
        }
        // Force button recreation with new times
        removeButtons();
        tryInjectButtons();
      }
      break;
    case 'getState':
      return Promise.resolve({ isEnabled: state.isEnabled });
    case 'initializeExtension':
      await initializeExtension();
      break;
  }
});