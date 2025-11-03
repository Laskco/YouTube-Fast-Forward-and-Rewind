const CONFIG = {
    SELECTORS: {
        VIDEO_PLAYER: '#movie_player video',
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
    IDS: {
        FORWARD_BUTTON_CLASS: 'ffBtnFfrw',
        REWIND_BUTTON_CLASS: 'rwBtnFfrw',
        CONTAINER_CLASS: 'buttonsContainer'
    },
    TIMING: {
        CONTROLS_REFRESH_INTERVAL: 500,
        HOLD_TRANSITION_DELAY: 400,
        INDICATOR_HIDE_DELAY: 500,
        AUTOHIDE_RESET_DELAY: 1000,
        OBSERVER_INIT_DELAY: 250,
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
    settings: {},
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
    lastSeekTime: 0,
    controlsRefreshInterval: null,
    continuousSeekInitialTime: 0,
    lastProgressBarUpdateTime: 0,
};

async function logError(context, ...args) {
    console.error("YT FF/RW:", context, ...args);
    
    try {
        if (!chrome.runtime?.id) {
            console.warn("YT FF/RW: Could not store error log, context invalidated.");
            return;
        }
        
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
        
        let { recentErrors = [] } = await chrome.storage.local.get('recentErrors');

        if (chrome.runtime.lastError) {
            console.warn(`YT FF/RW: Could not store error log. ${chrome.runtime.lastError.message}`);
            return;
        }

        recentErrors.push(errorData);
        if (recentErrors.length > CONFIG.MAX_STORED_ERRORS) {
            recentErrors = recentErrors.slice(recentErrors.length - CONFIG.MAX_STORED_ERRORS);
        }
        await chrome.storage.local.set({ recentErrors: recentErrors });
    } catch (e) {
        console.warn("YT FF/RW: Could not store error log in chrome.storage.", e.message);
    }
}

class PerformanceOptimizer {
    constructor() {
        this.debounceTimers = new Map();
        this.cachedElements = new Map();
        this.lastCleanup = Date.now();
        this.cleanupInterval = 30000;
    }

    debounce(key, func, wait, immediate = false) {
        const context = this;

        return function executedFunction(...args) {
            if (!state.settings.extensionEnabled && key !== 'navigation') {
                return;
            }
            
            const later = () => {
                context.debounceTimers.delete(key);
                if (!immediate) func.apply(this, args);
            };

            const callNow = immediate && !context.debounceTimers.has(key);

            if (context.debounceTimers.has(key)) {
                clearTimeout(context.debounceTimers.get(key));
            }

            context.debounceTimers.set(key, setTimeout(later, wait));

            if (callNow) func.apply(this, args);
        };
    }

    getCachedElement(selector, ttl = 5000) {
        const now = Date.now();
        const cached = this.cachedElements.get(selector);

        if (cached && (now - cached.timestamp < ttl) && cached.element?.isConnected) {
            return cached.element;
        }

        const element = document.querySelector(selector);
        if (element) {
            this.cachedElements.set(selector, {
                element,
                timestamp: now
            });
        } else {
            this.cachedElements.delete(selector);
        }

        if (now - this.lastCleanup > this.cleanupInterval) {
            this.cleanup(now, ttl);
        }

        return element;
    }

    cleanup(now = Date.now(), ttl = 5000) {
        for (const [selector, cached] of this.cachedElements.entries()) {
            if (now - cached.timestamp > ttl || !cached.element?.isConnected) {
                this.cachedElements.delete(selector);
            }
        }
        this.lastCleanup = now;
    }
}

const perfOptimizer = new PerformanceOptimizer();

let retryTimeout = null;
const debouncedTryInjectCheck = perfOptimizer.debounce('inject-check', () => {
    if (state.settings.extensionEnabled) tryInjectButtons(0);
}, CONFIG.DEFAULT_DEBOUNCE.MUTATION);

const debouncedNavigationHandler = perfOptimizer.debounce('navigation', onNavigation, CONFIG.DEFAULT_DEBOUNCE.NAVIGATION);

const debouncedFullscreenCheck = perfOptimizer.debounce('fullscreen', () => {
    if (state.settings.extensionEnabled && isWatchPage() && state.settings.buttonSkipEnabled) {
        tryInjectButtons(0);
    }
}, CONFIG.DEFAULT_DEBOUNCE.FULLSCREEN);

const debouncedResizeCheck = perfOptimizer.debounce('resize', () => {
    if (state.settings.extensionEnabled && isWatchPage() && state.settings.buttonSkipEnabled) {
        tryInjectButtons(0);
    }
}, CONFIG.DEFAULT_DEBOUNCE.RESIZE);

const videoListenerMap = new WeakMap();

async function trackSkip(amount, type) {
    try {
        if (!chrome.runtime?.id) return;

        const data = await chrome.storage.local.get([
            'stats_totalSecondsSkipped',
            'stats_totalSkips',
            'stats_buttonSkips',
            'stats_keyboardSkips'
        ]);

        if (chrome.runtime.lastError) {
            console.warn(`YT FF/RW: ${chrome.runtime.lastError.message}`);
            return;
        }

        const stats = {
            stats_totalSecondsSkipped: (data.stats_totalSecondsSkipped || 0) + Math.abs(amount),
            stats_totalSkips: (data.stats_totalSkips || 0) + 1,
            stats_buttonSkips: (data.stats_buttonSkips || 0) + (type === 'button' ? 1 : 0),
            stats_keyboardSkips: (data.stats_keyboardSkips || 0) + (type === 'keyboard' ? 1 : 0)
        };
        await chrome.storage.local.set(stats);

    } catch(e) {
        if (e.message.includes('context invalidated')) {
            console.warn('YT FF/RW: Failed to track skip due to extension reload. Please refresh the page.');
        } else {
            logError('Failed to track skip', e);
        }
    }
}

function forceProgressBarUpdate() {
    const moviePlayer = findMoviePlayerContainerElement();
    if (!moviePlayer) return;

    const progressSelectors = [
        '.ytp-progress-bar-container',
        '.ytp-progress-bar',
        '.ytp-scrubber-container',
        '.ytp-chrome-controls'
    ];

    progressSelectors.forEach(selector => {
        const element = moviePlayer.querySelector(selector);
        if (element) {
            element.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true,
                clientX: element.offsetWidth / 2,
                clientY: element.offsetHeight / 2
            }));
        }
    });
}

function performSeek(skipTime) {
    const currentVideoPlayer = findVideoPlayerElement();
    if (!currentVideoPlayer) {
        return;
    }

    if (!state.settings.ignoreBufferingProtection) {
        if (currentVideoPlayer.seeking || state.isBuffering) {
            return;
        }
    }
    
    const newTime = Math.max(0, Math.min(currentVideoPlayer.duration || Infinity, currentVideoPlayer.currentTime + skipTime));

    try {
        currentVideoPlayer.currentTime = newTime;
        
        const now = Date.now();
        const updateThrottle = state.settings.progressBarUpdateDelay || 100;
        
        if (now - state.lastProgressBarUpdateTime > updateThrottle) {
            state.lastProgressBarUpdateTime = now;
            forceProgressBarUpdate();
        }
        
    } catch (error) {
        logError('Seek operation failed', error);
    }
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
    } catch (e) {
        return false;
    }
}

function findMoviePlayerContainerElement() {
    if (state.cachedMoviePlayer?.isConnected) {
        return state.cachedMoviePlayer;
    }
    state.cachedMoviePlayer = document.querySelector(CONFIG.SELECTORS.MOVIE_PLAYER);
    return state.cachedMoviePlayer;
}

function findVideoPlayerElement() {
    if (state.lastVideoElement) {
        try {
            const isValid = state.lastVideoElement.isConnected &&
                state.lastVideoElement.tagName === 'VIDEO' &&
                typeof state.lastVideoElement.currentTime === 'number' &&
                state.lastVideoElement.videoWidth > 0 &&
                state.lastVideoElement.videoHeight > 0 &&
                !state.lastVideoElement.ended;

            if (isValid) {
                return state.lastVideoElement;
            } else {
                removeBufferingListeners(state.lastVideoElement);
                state.lastVideoElement = null;
            }
        } catch (error) {
            logError('Error validating cached video element', error);
            state.lastVideoElement = null;
        }
    }

    const candidates = document.querySelectorAll(CONFIG.SELECTORS.VIDEO_PLAYER);
    let bestCandidate = null;

    for (const player of candidates) {
        try {
            if (player &&
                player.tagName === 'VIDEO' &&
                typeof player.currentTime === 'number' &&
                player.videoWidth > 0 &&
                player.videoHeight > 0 &&
                player.readyState >= 1) {

                const moviePlayer = player.closest('#movie_player');
                if (moviePlayer && !moviePlayer.classList.contains('ad-showing')) {
                    bestCandidate = player;
                    break;
                } else if (!bestCandidate) {
                    bestCandidate = player;
                }
            }
        } catch (error) {
            logError('Error evaluating video candidate', error);
            continue;
        }
    }

    if (bestCandidate) {
        state.lastVideoElement = bestCandidate;
        addBufferingListeners(bestCandidate);
        return bestCandidate;
    }

    return null;
}

function buttonsAreInjectedAndCorrectlyPlaced(position) {
    const rewindButton = document.querySelector(`.${CONFIG.IDS.REWIND_BUTTON_CLASS}`);
    const forwardButton = document.querySelector(`.${CONFIG.IDS.FORWARD_BUTTON_CLASS}`);

    if (!rewindButton || !forwardButton) {
        return false;
    }

    if (position === 'left') {
        const container = document.querySelector(`.${CONFIG.IDS.CONTAINER_CLASS}`);
        const leftControls = document.querySelector(CONFIG.SELECTORS.CONTROLS);
        return !!(container &&
            leftControls &&
            leftControls.contains(container) &&
            container.contains(rewindButton) &&
            container.contains(forwardButton));
    }

    if (position === 'right') {
        const delhiContainer = document.querySelector('.ytp-right-controls-left');
        if (delhiContainer && delhiContainer.contains(rewindButton) && delhiContainer.contains(forwardButton)) {
            return !document.querySelector(`.${CONFIG.IDS.CONTAINER_CLASS}`);
        }

        const chromeControls = document.querySelector(CONFIG.SELECTORS.CHROME_CONTROLS);
        const rightControls = document.querySelector(CONFIG.SELECTORS.CONTROLS_RIGHT);
        const customContainer = document.querySelector(`.${CONFIG.IDS.CONTAINER_CLASS}`);
        if (chromeControls && rightControls && customContainer) {
            return customContainer.parentElement === chromeControls &&
                customContainer.nextElementSibling === rightControls &&
                customContainer.contains(rewindButton) &&
                customContainer.contains(forwardButton);
        }
    }

    return false;
}

function injectButtons() {
    try {
        if (!state.settings.extensionEnabled || !state.settings.buttonSkipEnabled || !isWatchPage()) {
            removeButtons();
            return false;
        }

        const videoPlayer = findVideoPlayerElement();
        if (!videoPlayer) {
            return false;
        }

        const position = state.settings.buttonPosition || 'left';

        if (buttonsAreInjectedAndCorrectlyPlaced(position)) {
            state.buttonsInjected = true;
            return true;
        }

        removeButtons();

        const backwardSkipTimeValue = state.settings.backwardSkipTime || 10;
        const forwardSkipTimeValue = state.settings.forwardSkipTime || 10;
        const triggerFFDelay = state.settings.holdDelay || 200;
        const throttleFFDelay = state.settings.seekInterval || 100;

        var forwardButtonTextX = forwardSkipTimeValue < 10 ? '38%' : '28%';
        var backwardButtonTextX = backwardSkipTimeValue < 10 ? '58%' : '68%';

        const fastForwardButton = document.createElement("div");
        fastForwardButton.classList.add("ytp-button", CONFIG.IDS.FORWARD_BUTTON_CLASS);
        fastForwardButton.style.cssText = "display: flex; width: auto; padding: 0 7px;";

        const svgIconForward = `
        <svg style="margin:auto;padding:0;transform:rotate(180deg);" height="36" width="36" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80.87 58.01"><defs><style>.cls-1{fill:#fff;}</style></defs><title>left-flipped</title><g id="Layer_2" data-name="Layer 2"><g id="Layer_2-2" data-name="Layer 2"> 
          <text class="f-icon-text" x="${backwardButtonTextX}" y="45%" text-anchor="end" dominant-baseline="middle" fill="white" style="font-size: 28pt; font-weight: bold; font-family: 'Roboto', 'Arial', sans-serif; user-select:none;transform:rotate(180deg);transform-origin:center;">${forwardSkipTimeValue}</text>
          <g class="f-seek hidden">
            <polyline fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" points="59,26.5 47,39 59,51.5" />
            <polyline fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" points="44,26.5 32,39 44,51.5" />
            <polyline fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" points="29,26.5 17,39 29,51.5" />
          </g>
          <path class="cls-1" d="M21.43,7.61V0L0,10.72,21.43,21.43v-7.6H74.19V51.56H66.55V58H80.87V7.61Z"></path></g></g>
        </svg>`;
        fastForwardButton.innerHTML = svgIconForward;

        const fastBackwardButton = document.createElement("div");
        fastBackwardButton.classList.add("ytp-button", CONFIG.IDS.REWIND_BUTTON_CLASS);
        fastBackwardButton.style.cssText = "display: flex; width: auto; padding: 0 7px;";

        const svgIconBackward = `
        <svg style="margin:auto;padding:0;transform:rotate(180deg);" height="36" width="36" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80.87 58.01"><defs><style>.cls-1{fill:#fff;}</style></defs><title>right-flipped</title><g id="Layer_2" data-name="Layer 2"><g id="Layer_2-2" data-name="Layer 2">
          <text class="b-icon-text" x="${forwardButtonTextX}" y="45%" dominant-baseline="middle" text-anchor="start" fill="white" style="font-size: 28pt; font-weight: bold; font-family: 'Roboto', 'Arial', sans-serif; user-select:none;transform:rotate(180deg);transform-origin:center;">${backwardSkipTimeValue}</text>
          <g class="b-seek hidden">
            <polyline fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" points="22,26.5 34,39 22,51.5" />
            <polyline fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" points="37,26.5 49,39 37,51.5" />
            <polyline fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" points="52,26.5 64,39 52,51.5" />
          </g>
          <path class="cls-1" d="M60.88.72,59.44,0V7.61H0V58H14.32V51.56H6.68V13.83H59.44v7.6L80.87,10.72Z"/></g></g>
        </svg>`;
        fastBackwardButton.innerHTML = svgIconBackward;

        if (position === 'right') {
            fastForwardButton.style.margin = "0";
            fastBackwardButton.style.margin = "0";
            const parentControl = document.querySelector(CONFIG.SELECTORS.CONTROLS_RIGHT);
            const delhiContainer = parentControl?.querySelector('.ytp-right-controls-left');

            if (delhiContainer) {
                delhiContainer.insertBefore(fastForwardButton, delhiContainer.firstChild);
                delhiContainer.insertBefore(fastBackwardButton, delhiContainer.firstChild);
            } else {
                const chromeControls = document.querySelector(CONFIG.SELECTORS.CHROME_CONTROLS);
                const rightControls = document.querySelector(CONFIG.SELECTORS.CONTROLS_RIGHT);

                const buttonsContainer = document.createElement("div");
                buttonsContainer.classList.add(CONFIG.IDS.CONTAINER_CLASS);
                buttonsContainer.style.cssText = "display: flex; padding: 0; margin: auto 0;";
                buttonsContainer.appendChild(fastBackwardButton);
                buttonsContainer.appendChild(fastForwardButton);

                if (chromeControls && rightControls) {
                    chromeControls.insertBefore(buttonsContainer, rightControls);
                }
            }
        } else {
            fastForwardButton.classList.add("ytp-next-button", "ytp-playlist-ui");
            fastBackwardButton.classList.add("ytp-prev-button");

            fastBackwardButton.style.borderTopRightRadius = "0";
            fastBackwardButton.style.borderBottomRightRadius = "0";
            fastBackwardButton.style.margin = "0";

            fastForwardButton.style.borderTopLeftRadius = "0";
            fastForwardButton.style.borderBottomLeftRadius = "0";
            fastForwardButton.style.margin = "0";

            const buttonsContainer = document.createElement("div");
            buttonsContainer.classList.add(CONFIG.IDS.CONTAINER_CLASS);
            buttonsContainer.style.cssText = "display: flex; padding: 0; margin: auto 7px;";
            buttonsContainer.appendChild(fastBackwardButton);
            buttonsContainer.appendChild(fastForwardButton);

            const parentControl = document.querySelector(CONFIG.SELECTORS.CONTROLS);
            if (parentControl) {
                const timeDisplay = parentControl.querySelector(CONFIG.SELECTORS.TIME_DISPLAY);
                if (timeDisplay) {
                    parentControl.insertBefore(buttonsContainer, timeDisplay.nextSibling);
                } else {
                    parentControl.appendChild(buttonsContainer);
                }
            }
        }

        fastForwardButton.addEventListener("click", function() {
            performSeek(forwardSkipTimeValue);
            trackSkip(forwardSkipTimeValue, 'button');
        });

        fastBackwardButton.addEventListener("click", function() {
            performSeek(-backwardSkipTimeValue);
            trackSkip(-backwardSkipTimeValue, 'button');
        });

        let mouseDownTimeoutTimer = null;
        let mouseDownIntervalTimer = null;
        let forwardSeekIcon, forwardTextIcon, backwardSeekIcon, backwardTextIcon;

        function startSeek(buttonType) {
            mouseDownTimeoutTimer = setTimeout(() => {
                state.isHolding = true;
                const videoPlayer = findVideoPlayerElement();
                if (videoPlayer) {
                    state.continuousSeekInitialTime = videoPlayer.currentTime;
                }

                mouseDownIntervalTimer = setInterval(() => {
                    if (videoPlayer?.isConnected) {
                        if (buttonType === 'forward') {
                            forwardSeekIcon = fastForwardButton.querySelector(".f-seek");
                            forwardTextIcon = fastForwardButton.querySelector(".f-icon-text");
                            requestAnimationFrame(() => {
                                if (forwardSeekIcon && forwardTextIcon) {
                                    forwardSeekIcon.classList.remove("hidden");
                                    forwardTextIcon.classList.add("hidden");
                                }
                            });
                            performSeek(forwardSkipTimeValue);
                        } else {
                            backwardSeekIcon = fastBackwardButton.querySelector(".b-seek");
                            backwardTextIcon = fastBackwardButton.querySelector(".b-icon-text");
                             requestAnimationFrame(() => {
                                if (backwardSeekIcon && backwardTextIcon) {
                                    backwardSeekIcon.classList.remove("hidden");
                                    backwardTextIcon.classList.add("hidden");
                                }
                            });
                            performSeek(-backwardSkipTimeValue);
                        }
                    }
                }, throttleFFDelay);
            }, triggerFFDelay);
        }

        function stopSeek() {
            if (state.isHolding) {
                const videoPlayer = findVideoPlayerElement();
                if (videoPlayer && state.continuousSeekInitialTime > 0) {
                    const totalSkipped = Math.abs(videoPlayer.currentTime - state.continuousSeekInitialTime);
                    if (totalSkipped > 0.5) {
                        trackSkip(totalSkipped, 'button');
                    }
                }
            }
            
            requestAnimationFrame(() => {
                if (forwardSeekIcon) forwardSeekIcon.classList.add("hidden");
                if (forwardTextIcon) forwardTextIcon.classList.remove("hidden");
                if (backwardSeekIcon) backwardSeekIcon.classList.add("hidden");
                if (backwardTextIcon) backwardTextIcon.classList.remove("hidden");
            });

            clearTimeout(mouseDownTimeoutTimer);
            clearInterval(mouseDownIntervalTimer);

            state.isHolding = false;
            state.continuousSeekInitialTime = 0;
        }

        fastForwardButton.addEventListener("mousedown", () => startSeek('forward'));
        fastBackwardButton.addEventListener("mousedown", () => startSeek('backward'));

        document.addEventListener("mouseup", stopSeek);
        document.addEventListener("contextmenu", stopSeek);

        state.buttonsInjected = true;
        return true;

    } catch (e) {
        logError("Error in injectButtons", e);
        removeButtons();
        return false;
    }
}

function removeButtons() {
    const container = document.querySelector(`.${CONFIG.IDS.CONTAINER_CLASS}`);
    if (container) {
        container.remove();
    }
    document.querySelectorAll(`.${CONFIG.IDS.FORWARD_BUTTON_CLASS}, .${CONFIG.IDS.REWIND_BUTTON_CLASS}`).forEach(btn => btn.remove());
    state.buttonsInjected = false;
}

function handleVideoWaiting() {
    state.isBuffering = true;
    if (state.actionTimeout) {
        clearTimeout(state.actionTimeout);
        state.actionTimeout = null;
    }
}

function handleVideoPlaying() {
    state.isBuffering = false;
}

function addBufferingListeners(videoElement) {
    if (!videoElement) return;

    removeBufferingListeners(videoElement);

    const listeners = {
        waiting: () => handleVideoWaiting(),
        playing: () => handleVideoPlaying(),
        stalled: () => handleVideoWaiting(),
        canplay: () => handleVideoPlaying(),
        loadstart: () => handleVideoWaiting(),
        error: (e) => logError('Video error event', e)
    };

    Object.entries(listeners).forEach(([event, handler]) => {
        try {
            videoElement.addEventListener(event, handler);
        } catch (error) {
            logError(`Failed to add ${event} listener`, error);
        }
    });

    videoListenerMap.set(videoElement, listeners);

    try {
        state.isBuffering = videoElement.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ||
            (videoElement.seeking && !videoElement.paused);
    } catch (error) {
        state.isBuffering = false;
    }
}

function removeBufferingListeners(videoElement) {
    if (!videoElement) return;

    const listeners = videoListenerMap.get(videoElement);
    if (listeners) {
        Object.entries(listeners).forEach(([event, handler]) => {
            try {
                videoElement.removeEventListener(event, handler);
            } catch (error) {}
        });
        videoListenerMap.delete(videoElement);
    }
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

    if (state.controlsRefreshInterval) {
        clearInterval(state.controlsRefreshInterval);
        state.controlsRefreshInterval = null;
    }

    state.isHolding = false;
    if (state.skipIndicatorElement) {
        state.skipIndicatorElement.classList.remove('holding');
        if (state.skipIndicatorTimeout) clearTimeout(state.skipIndicatorTimeout);
        state.skipIndicatorTimeout = setTimeout(() => {
            if (state.skipIndicatorElement) {
                state.skipIndicatorElement.classList.remove('visible');
            }
        }, CONFIG.TIMING.INDICATOR_HIDE_DELAY);
    }
    state.activeSeekKey = null;

    setTimeout(() => {
        state.preventAutoHide = false;
        const moviePlayer = findMoviePlayerContainerElement();
        if (moviePlayer) {
            moviePlayer.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true,
                clientX: moviePlayer.offsetWidth / 2,
                clientY: moviePlayer.offsetHeight / 2
            }));
        }
    }, CONFIG.TIMING.AUTOHIDE_RESET_DELAY);
}

function showPlayerControlsAndKeepVisible() {
    const moviePlayer = findMoviePlayerContainerElement();
    if (!moviePlayer) return;

    moviePlayer.classList.remove(CONFIG.SELECTORS.AUTOHIDE_CLASS);

    const keepVisible = () => {
        moviePlayer.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            clientX: moviePlayer.offsetWidth / 2,
            clientY: moviePlayer.offsetHeight / 2
        }));

        forceProgressBarUpdate();
    };

    keepVisible();

    state.preventAutoHide = true;

    if (state.autoHideGuardTimeout) {
        clearTimeout(state.autoHideGuardTimeout);
    }

    if (state.controlsRefreshInterval) {
        clearInterval(state.controlsRefreshInterval);
    }

    state.controlsRefreshInterval = setInterval(() => {
        if (state.isHolding || state.activeSeekKey) {
            keepVisible();
        } else {
            clearInterval(state.controlsRefreshInterval);
            state.controlsRefreshInterval = null;
        }
    }, CONFIG.TIMING.CONTROLS_REFRESH_INTERVAL);

    state.autoHideGuardTimeout = setTimeout(() => {
        state.preventAutoHide = false;
        if (state.controlsRefreshInterval) {
            clearInterval(state.controlsRefreshInterval);
            state.controlsRefreshInterval = null;
        }
        keepVisible();
    }, state.settings.controlsVisibleDuration || 3000);
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

function startContinuousSeek(key, skipTimeValue, skipAmount, direction) {
    if (state.activeSeekKey === key) return;

    stopContinuousSeek();
    state.activeSeekKey = key;

    showPlayerControlsAndKeepVisible();

    state.isHolding = false;
    performSeek(skipTimeValue);
    trackSkip(skipTimeValue, 'keyboard');
    showSkipIndicator(skipAmount, direction);

    state.holdTransitionTimeout = setTimeout(() => {
        state.isHolding = true;
        showSkipIndicator(skipAmount, direction);
    }, CONFIG.TIMING.HOLD_TRANSITION_DELAY);

    state.seekIntervalId = setInterval(() => {
        performSeek(skipTimeValue);
        trackSkip(skipTimeValue, 'keyboard');
        showPlayerControlsAndKeepVisible();
    }, state.settings.seekInterval);
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

        const skipAmount = isForward ?
            (state.settings.keyboardForward || 5) :
            (state.settings.keyboardBackward || 5);

        const skipTimeValue = isForward ? skipAmount : -skipAmount;
        const direction = isForward ? 'forward' : 'backward';

        startContinuousSeek(event.key, skipTimeValue, skipAmount, direction);
    }
}

function addKeyListeners() {
    if (state.keyListenersAttached) return;
    try {
        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keyup', handleKeyUp, true);
        window.addEventListener('blur', stopContinuousSeek);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                stopContinuousSeek();
            }
        });
        state.keyListenersAttached = true;
    } catch (e) {
        logError("Failed to attach key listeners:", e);
    }
}

function removeKeyListeners() {
    if (!state.keyListenersAttached) return;
    try {
        document.removeEventListener('keydown', handleKeyDown, true);
        document.removeEventListener('keyup', handleKeyUp, true);
        window.removeEventListener('blur', stopContinuousSeek);
        document.removeEventListener('visibilitychange', stopContinuousSeek);
        state.keyListenersAttached = false;
        stopContinuousSeek();
    } catch (e) {
        logError("Failed to remove key listeners:", e);
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
    if (!moviePlayerContainer) return;
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
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1 && (node.matches(CONFIG.SELECTORS.CHROME_CONTROLS) || node.querySelector(CONFIG.SELECTORS.CHROME_CONTROLS))) {
                        hasRelevantChange = true;
                        break;
                    }
                }
                if (!hasRelevantChange) {
                    for (const node of mutation.removedNodes) {
                        if (node.nodeType === 1 && (node.matches(CONFIG.SELECTORS.CHROME_CONTROLS) || node.querySelector(CONFIG.SELECTORS.CHROME_CONTROLS))) {
                            hasRelevantChange = true;
                            break;
                        }
                    }
                }
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
        setTimeout(observePlayerChanges, CONFIG.TIMING.OBSERVER_INIT_DELAY);
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
        if (newPath !== oldPath || (isWatchPage() && currentUrl !== state.lastUrl)) {
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
    if (state.settings.keyboardShortcutsEnabled) {
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
        }, state.settings.navigationInitDelay || 500);
    } else {
        removeButtons();
        if (state.lastVideoElement) removeBufferingListeners(state.lastVideoElement);
        state.isBuffering = false;
    }
}

function handleFullscreenChange() {
    if (!state.settings.extensionEnabled) return;
    debouncedFullscreenCheck();
}

function cleanup() {
    removeButtons();
    if (state.lastVideoElement) removeBufferingListeners(state.lastVideoElement);
    state.lastVideoElement = null;

    removeKeyListeners();
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    window.removeEventListener('resize', debouncedResizeCheck);

    if (state.navigationObserver) {
        state.navigationObserver.disconnect();
        state.navigationObserver = null;
    }
    if (state.playerObserver) {
        state.playerObserver.disconnect();
        state.playerObserver = null;
    }

    if (retryTimeout) clearTimeout(retryTimeout);
    retryTimeout = null;
    if (state.actionTimeout) clearTimeout(state.actionTimeout);
    state.actionTimeout = null;
    if (state.controlsRefreshInterval) {
        clearInterval(state.controlsRefreshInterval);
        state.controlsRefreshInterval = null;
    }

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
        const stored = await chrome.storage.local.get(null);
        state.settings = stored;

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
            state.navigationObserver.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
        }

        handleNavigation();
    } catch (error) {
        logError('Error initializing extension:', error);
        cleanup();
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateSettings') {
        const oldSettings = { ...state.settings
        };
        state.settings = message.settings;

        if (!state.settings.extensionEnabled && oldSettings.extensionEnabled) {
            cleanup();
            sendResponse({
                status: "Extension disabled and cleaned up"
            });
            return true;
        }

        if (state.settings.extensionEnabled && !oldSettings.extensionEnabled) {
            initializeExtension();
            sendResponse({
                status: "Extension enabled and initialized"
            });
            return true;
        }

        if (state.settings.extensionEnabled) {
            if (state.settings.keyboardShortcutsEnabled && !oldSettings.keyboardShortcutsEnabled) {
                addKeyListeners();
            } else if (!state.settings.keyboardShortcutsEnabled && oldSettings.keyboardShortcutsEnabled) {
                removeKeyListeners();
            }

            const buttonSettingsChanged =
                oldSettings.buttonSkipEnabled !== state.settings.buttonSkipEnabled ||
                oldSettings.buttonPosition !== state.settings.buttonPosition ||
                oldSettings.forwardSkipTime !== state.settings.forwardSkipTime ||
                oldSettings.backwardSkipTime !== state.settings.backwardSkipTime;

            if (isWatchPage()) {
                if (buttonSettingsChanged) {
                    removeButtons();
                    tryInjectButtons(0);
                }
            } else {
                removeButtons();
            }
        }
        sendResponse({
            status: "Settings applied"
        });
        return true;
    }
    return false;
});

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeExtension);
} else {
    initializeExtension();
}