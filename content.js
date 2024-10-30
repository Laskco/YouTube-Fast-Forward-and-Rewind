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
    MOVIE_MAX_ATTEMPTS: 30 // More attempts for movie pages
  },
  DEBOUNCE: {
    NAVIGATION: 150,
    MUTATION: 100
  }
};

// State management
const state = {
  buttonsInjected: false,
  retryAttempts: 0,
  isMoviePage: false,
  navigationObserver: null,
  playerObserver: null,
  lastVideoElement: null
};

// Utility functions
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
  return window.location.pathname.includes('/watch') && 
         document.querySelector('ytd-watch-flexy[is-two-columns_]') === null;
};

// Enhanced video player detection
function findVideoPlayer() {
  for (const selector of CONFIG.SELECTORS.VIDEO_PLAYERS) {
    const player = document.querySelector(selector);
    if (player && player.tagName === 'VIDEO') {
      return player;
    }
  }
  return null;
}

// Create and cache button elements
const createButton = (id, iconPath) => {
  const button = document.createElement('button');
  button.id = id;
  Object.assign(button.style, {
    width: '50px',
    height: '50px',
    backgroundImage: `url(${browser.runtime.getURL(iconPath)})`,
    backgroundSize: 'contain',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '0',
    marginTop: '0px',
    transition: 'opacity 0.2s',
    opacity: '1'
  });
  
  button.addEventListener('mouseover', () => button.style.opacity = '0.8');
  button.addEventListener('mouseout', () => button.style.opacity = '1');
  
  return button;
};

// Create buttons container with cached elements
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
    zIndex: '1000'
  });

  const rewindButton = createButton('rewindButton', 'icons/rewind.png');
  const forwardButton = createButton('fastForwardButton', 'icons/forward.png');
  
  rewindButton.style.marginRight = '-5px';
  forwardButton.style.marginLeft = '-5px';
  
  container.appendChild(rewindButton);
  container.appendChild(forwardButton);
  
  return container;
}

// Optimized button injection
function injectButtons() {
  if (state.buttonsInjected) return;

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

// Optimized event handling
function setupVideoControls(videoPlayer) {
  const container = document.getElementById('customButtonsContainer');
  if (!container) return;

  // Use event delegation for buttons
  container.addEventListener('click', (event) => {
    if (!videoPlayer.paused) { // Only process if video is playing
      const timeChange = event.target.id === 'fastForwardButton' ? 10 : 
                        event.target.id === 'rewindButton' ? -10 : 0;
      if (timeChange) {
        videoPlayer.currentTime += timeChange;
      }
    }
  });
}

// Enhanced keyboard controls
const handleKeyDown = (event) => {
  const videoPlayer = state.lastVideoElement || findVideoPlayer();
  if (!videoPlayer || videoPlayer.paused) return;

  if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

  switch (event.key) {
    case 'ArrowRight':
      event.preventDefault();
      videoPlayer.currentTime += 5;
      break;
    case 'ArrowLeft':
      event.preventDefault();
      videoPlayer.currentTime -= 5;
      break;
  }
};

// Cleanup function
function removeButtons() {
  const container = document.getElementById('customButtonsContainer');
  if (container) {
    container.remove();
  }
  state.buttonsInjected = false;
}

// Optimized initialization retry logic
const tryInjectButtons = debounce(() => {
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

// Enhanced mutation observer for player changes
function observePlayerChanges() {
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
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style']
  });
}

// Navigation handling
function handleNavigation() {
  removeButtons();
  state.retryAttempts = 0;
  state.isMoviePage = isMoviePage();
  
  // Wait for player to be ready
  setTimeout(() => {
    observePlayerChanges();
    tryInjectButtons();
  }, 500);
}

// Initialize extension
function initializeExtension() {
  state.isMoviePage = isMoviePage();
  
  // Set up navigation observer
  if (!state.navigationObserver) {
    state.navigationObserver = new MutationObserver(debounce(() => {
      if (window.location.href !== state.lastUrl) {
        state.lastUrl = window.location.href;
        handleNavigation();
      }
    }, CONFIG.DEBOUNCE.NAVIGATION));

    state.navigationObserver.observe(document.querySelector('head'), {
      childList: true,
      subtree: true
    });
  }

  // Set up keyboard controls
  document.addEventListener('keydown', handleKeyDown);
  
  // Initial setup
  observePlayerChanges();
  tryInjectButtons();
}

// Fullscreen handling
document.addEventListener('fullscreenchange', debounce(() => {
  if (document.fullscreenElement) {
    if (!state.buttonsInjected) {
      state.retryAttempts = 0;
      tryInjectButtons();
    }
  } else {
    removeButtons();
    // Reinject after short delay
    setTimeout(() => {
      state.retryAttempts = 0;
      tryInjectButtons();
    }, 300);
  }
}, 150));

// Extension state management
browser.runtime.onMessage.addListener((message) => {
  if (message.action === 'updateState') {
    if (message.isEnabled) {
      initializeExtension();
    } else {
      removeButtons();
    }
  }
});

// Start the extension
initializeExtension();