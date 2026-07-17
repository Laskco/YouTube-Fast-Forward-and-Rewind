/**
 * YouTube Fast Forward & Rewind – content script
 *
 * Architecture:
 *  - cfg           : immutable frozen constants
 *  - state         : single mutable object; mutated in place, never spread
 *  - Stats         : batched stat tracking to avoid storage read-write races
 *  - VideoWatcher  : finds & caches the video element, tracks buffering state
 *  - VideoSrc      : scoped MutationObserver for in-page video changes
 *  - PlayerUI      : injects / removes control buttons into the player DOM
 *  - SkipIndicator : the translucent seek-direction overlay
 *  - KeyHandler    : keyboard + media-key continuous-seek logic
 *  - init / cleanup: lifecycle wiring
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

function deepFreeze(obj) {
    Object.freeze(obj);
    Object.values(obj).forEach(v => { if (v && typeof v === 'object') deepFreeze(v); });
    return obj;
}

const cfg = deepFreeze({
    sel: {
        video:            '#movie_player video, video.html5-main-video, #player-container-id video, #id-tv-container video',
        rightControls:    '.ytp-right-controls',
        chromeControls:   '.ytp-chrome-controls',
        timeDisplay:      '.ytp-time-display.notranslate',
        rightControlsFallbacks: [
            '.ytp-right-controls-left',
            '.ytp-right-controls',
            '.vjs-control-bar',
            '.shaka-bottom-controls',
            '.ypcs-control-buttons-right',
        ],
        leftControlsFallbacks: [
            '.ytp-left-controls',
            '.ypcs-control-buttons-left',
        ],
        previewPlayer: '#inline-preview-player',
    },
    cls: {
        fwdBtn:    'ffBtnFfrw',
        rwdBtn:    'rwBtnFfrw',
        container: 'buttonsContainer',
        adClass:   'ad-showing',
    },
    indicatorId: 'yt-ffrw-skip-indicator',
    retry: { maxAttempts: 100, delayMs: 100 },
    observerRetry: { maxAttempts: 40, delayMs: 250 },
    timing: {
        holdThreshold:      400,
        indicatorHideDelay: 500,
    },
    debounce: {
        mutation:   400,
        navigation: 200,
        fullscreen: 100,
        resize:     150,
    },
});

const CONTENT_DEFAULTS = Object.freeze({
    extensionEnabled: true,
    buttonSkipEnabled: true,
    keyboardShortcutsEnabled: true,
    forwardSkipTime: 10,
    backwardSkipTime: 10,
    keyboardForward: 5,
    keyboardBackward: 5,
    keyboardForwardKey: 'ArrowRight',
    keyboardBackwardKey: 'ArrowLeft',
    seekInterval: 150,
    progressBarUpdateDelay: 150,
    navigationInitDelay: 250,
    ignoreBufferingProtection: false,
    buttonPosition: 'left',
});
const CONTENT_SETTING_KEYS = Object.keys(CONTENT_DEFAULTS);
const EXTENSION_BUTTON_QUERY = `.${cfg.cls.fwdBtn},.${cfg.cls.rwdBtn}`;
const OWNED_CONTAINER_ATTRIBUTE = 'data-ffrw-controls';

function boundedInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.round(Math.max(min, Math.min(max, number)));
}

function normalizeContentHotkey(value, fallback) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 64) return fallback;
    return value.length === 1 ? value.toLowerCase() : value;
}

function normalizeContentSettings(raw = {}) {
    const normalized = { ...CONTENT_DEFAULTS };
    ['extensionEnabled', 'buttonSkipEnabled', 'keyboardShortcutsEnabled', 'ignoreBufferingProtection']
        .forEach(key => { if (typeof raw[key] === 'boolean') normalized[key] = raw[key]; });
    normalized.forwardSkipTime = boundedInteger(raw.forwardSkipTime, 10, 1, 99);
    normalized.backwardSkipTime = boundedInteger(raw.backwardSkipTime, 10, 1, 99);
    normalized.keyboardForward = boundedInteger(raw.keyboardForward, 5, 1, 99);
    normalized.keyboardBackward = boundedInteger(raw.keyboardBackward, 5, 1, 99);
    normalized.seekInterval = boundedInteger(raw.seekInterval, 150, 50, 2000);
    normalized.progressBarUpdateDelay = boundedInteger(raw.progressBarUpdateDelay, 150, 0, 2000);
    normalized.navigationInitDelay = boundedInteger(raw.navigationInitDelay, 250, 0, 5000);
    normalized.keyboardForwardKey = normalizeContentHotkey(raw.keyboardForwardKey, 'ArrowRight');
    normalized.keyboardBackwardKey = normalizeContentHotkey(raw.keyboardBackwardKey, 'ArrowLeft');
    if (normalized.keyboardForwardKey === normalized.keyboardBackwardKey) {
        normalized.keyboardBackwardKey = normalized.keyboardForwardKey === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
    }
    normalized.buttonPosition = raw.buttonPosition === 'right' ? 'right' : 'left';
    return normalized;
}

// ─── Player DOM helpers ───────────────────────────────────────────────────────

function isInPreviewPlayer(element) {
    return !!element?.closest(cfg.sel.previewPlayer);
}

function findLastControl(selectors) {
    for (const sel of selectors) {
        const candidates = Array.from(document.querySelectorAll(sel))
            .filter(el => !isInPreviewPlayer(el));
        if (candidates.length) return candidates[candidates.length - 1];
    }
    return null;
}

function getRightControls() {
    return findLastControl(cfg.sel.rightControlsFallbacks);
}

function getLeftControls() {
    return findLastControl(cfg.sel.leftControlsFallbacks);
}

const PLAYER_CONTAINER_SELECTORS = [
    '#movie_player',
    '.html5-video-player',
    '#c4-player',
    '.shaka-video-container',
    '#player-container .video-js',
    '.main-video-section > .video-container',
    '#player-container-id',
    '#id-tv-container',
];
const PLAYER_CONTAINER_QUERY = PLAYER_CONTAINER_SELECTORS.join(',');

function getMoviePlayer() {
    if (state.cachedMoviePlayer?.isConnected) return state.cachedMoviePlayer;
    state.cachedMoviePlayer = findMoviePlayer();
    return state.cachedMoviePlayer;
}

function connectedElement(selector) {
    const el = document.querySelector(selector);
    return el?.isConnected ? el : null;
}

function findMoviePlayer() {
    return PLAYER_CONTAINER_SELECTORS
        .map(connectedElement)
        .find(element => element && !isInPreviewPlayer(element)) ?? null;
}

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
    settings: { ...CONTENT_DEFAULTS },
    lastUrl:  '',

    retryAttempts:        0,
    observerAttempts:     0,
    observerInitTimeout:  null,
    navigationInitTimeout: null,
    waitGeneration:       0,
    retryTimer:          null,

    navObserver:    null,
    playerObserver: null,

    isBuffering:    false,
    videoListeners: null,
    keysAttached:  false,
    activeSeekKey: null,
    seekInterval:  null,
    holdTimeout:   null,
    indicatorTimeout: null,

    btnHoldTimeout:   null,
    btnHoldInterval:  null,
    btnIsHolding:     false,
    btnHoldActiveBtn: null,
    btnHoldDidSeek:   false,
    btnHoldSuppressBtn: null,
    btnHoldSuppressTimer: null,

    cachedMoviePlayer: null,
    settingsReadGeneration: 0,
};

// ─── Logging ──────────────────────────────────────────────────────────────────

function createErrorEntry(ctx, err) {
    return {
        ts:      new Date().toISOString(),
        context: ctx,
        message: err instanceof Error ? err.message : String(err),
        stack:   err instanceof Error ? err.stack   : undefined,
    };
}

function logError(ctx, err) {
    console.error('[FFRW]', ctx, err);
    if (!chrome.runtime?.id) return;
    chrome.runtime.sendMessage({ action: 'logError', entry: createErrorEntry(ctx, err) }).catch(() => {});
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function debounce(fn, wait) {
    let t;
    const debounced = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
    debounced.cancel = () => { clearTimeout(t); t = null; };
    return debounced;
}

function isWatchPage() {
    try {
        const url = new URL(document.URL);
        const isYouTube = url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com');
        return isYouTube && url.pathname === '/watch';
    } catch {
        return false;
    }
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const INTERACTIVE_SELECTOR = [
    'button', 'a[href]', '[role="button"]', '[role="link"]', '[role="slider"]',
    '[role="spinbutton"]', '[role="textbox"]', '[role="menuitem"]',
    '[contenteditable]:not([contenteditable="false"])',
].join(', ');

function isEditable(el) {
    const tag = el?.tagName?.toUpperCase();
    return [Boolean(el?.isContentEditable), EDITABLE_TAGS.has(tag)].includes(true);
}

function isInteractive(el) {
    return isEditable(el) || Boolean(el?.closest?.(INTERACTIVE_SELECTOR));
}

const isFirefox = (() => { const r = navigator.userAgent.includes('Firefox'); return () => r; })();

// ─── Stats ────────────────────────────────────────────────────────────────────

const statsQueue = { totalSecondsSkipped: 0, totalSkips: 0, buttonSkips: 0, keyboardSkips: 0 };
let statsFlushTimer = null;
let statsFlushInFlight = null;

function resetStatsQueue() {
    const delta = { ...statsQueue };
    statsQueue.totalSecondsSkipped = statsQueue.totalSkips = statsQueue.buttonSkips = statsQueue.keyboardSkips = 0;
    return delta;
}

function restoreStatsQueue(delta) {
    statsQueue.totalSecondsSkipped += delta.totalSecondsSkipped;
    statsQueue.totalSkips          += delta.totalSkips;
    statsQueue.buttonSkips         += delta.buttonSkips;
    statsQueue.keyboardSkips       += delta.keyboardSkips;
}

async function persistStatsDelta(delta) {
    const response = await chrome.runtime.sendMessage({ action: 'recordStats', delta });
    if (!response?.ok) throw new Error(response?.error || 'Could not save statistics');
}

async function flushStats() {
    clearTimeout(statsFlushTimer);
    statsFlushTimer = null;
    if (statsFlushInFlight) {
        await statsFlushInFlight;
        return flushStats();
    }
    if (!chrome.runtime?.id) return false;
    if (statsQueue.totalSkips <= 0 && statsQueue.totalSecondsSkipped <= 0) return true;
    const delta = resetStatsQueue();
    const operation = (async () => {
        try {
            await persistStatsDelta(delta);
            return true;
        } catch (e) {
            restoreStatsQueue(delta);
            logError('stats', e);
            if (chrome.runtime?.id && statsFlushTimer === null) {
                statsFlushTimer = setTimeout(flushStats, 2000);
            }
            return false;
        }
    })();
    statsFlushInFlight = operation;
    try {
        return await operation;
    } finally {
        if (statsFlushInFlight === operation) statsFlushInFlight = null;
    }
}

const Stats = {
    track(delta, source) {
        statsQueue.totalSecondsSkipped += Math.abs(delta);
        statsQueue.totalSkips          += 1;
        statsQueue.buttonSkips         += source === 'button'   ? 1 : 0;
        statsQueue.keyboardSkips       += source === 'keyboard' ? 1 : 0;
        clearTimeout(statsFlushTimer);
        statsFlushTimer = setTimeout(flushStats, 500);
    },
    flushNow() {
        clearTimeout(statsFlushTimer);
        statsFlushTimer = null;
        return flushStats();
    },
};

// ─── VideoWatcher ─────────────────────────────────────────────────────────────

const VideoWatcher = {
    _ref: null,

    _usableCachedVideo() {
        const cached = this._ref?.deref();
        if (!cached) return null;
        if (isUsableCachedVideo(cached)) return cached;
        this._detach(cached);
        return null;
    },

    _videoCandidate(v) {
        const mp = v.closest(PLAYER_CONTAINER_QUERY);
        if (isInPreviewPlayer(v)) return null;
        return mp ? { video: v, moviePlayer: mp } : null;
    },

    _hasUsableState(v) {
        if (!v.isConnected) return false;
        if (typeof v.currentTime !== 'number') return false;
        return v.readyState >= HTMLMediaElement.HAVE_METADATA;
    },

    _bestVideo() {
        const candidates = Array.from(document.querySelectorAll(cfg.sel.video))
            .filter(v => this._hasUsableState(v))
            .map(v => this._videoCandidate(v))
            .filter(Boolean);
        const preferred = candidates.find(({ moviePlayer }) => !moviePlayer.classList.contains(cfg.cls.adClass));
        return videoFromCandidate(preferred ?? candidates[0]);
    },

    get() {
        const cached = this._usableCachedVideo();
        if (cached) return cached;
        const best = this._bestVideo();
        if (best) { this._attach(best); return best; }
        return null;
    },

    _attach(v) {
        this._detach(this._ref?.deref());
        const listeners = createVideoListeners(v, this);
        addVideoListeners(v, listeners);
        this._ref            = new WeakRef(v);
        state.videoListeners = listeners;
        state.isBuffering    = !v.paused && v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
    },

    _detach(v) {
        const activeListeners = state.videoListeners;
        state.videoListeners = null;
        this._ref = null;
        detachVideoListeners(v, activeListeners);
    },

    release() { this._detach(this._ref?.deref()); },
};

function isUsableCachedVideo(video) {
    return video.isConnected
        && Number.isFinite(video.currentTime)
        && video.readyState >= HTMLMediaElement.HAVE_METADATA;
}

function videoFromCandidate(candidate) {
    return candidate?.video ?? null;
}

function detachVideoListeners(video, activeListeners) {
    if (!video || !activeListeners) return;
    Object.entries(activeListeners).forEach(([ev, fn]) => removeVideoListener(video, ev, fn));
}

function removeVideoListener(video, eventName, listener) {
    video.removeEventListener(eventName, listener);
}

function addVideoListeners(video, listeners) {
    Object.entries(listeners).forEach(([eventName, listener]) => {
        video.addEventListener(eventName, listener);
    });
}

function createVideoListeners(video, watcher) {
    const refreshBuffering = () => {
        state.isBuffering = !video.paused && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
    };
    const clearBuffering = () => { state.isBuffering = false; };
    const onSeeking = () => {
        if (!isRecentExtensionSeek()) {
            stopKeySeek();
            PlayerUI.stopHold();
        }
    };
    const onSeeked = () => {
        clearBuffering();
        _intendedTime = null;
    };
    const onEnded = () => {
        clearBuffering();
        _intendedTime = null;
        stopKeySeek();
        PlayerUI.stopHold();
    };
    const onPause = () => {
        queueMicrotask(() => {
            if (video.paused && !video.seeking) clearBuffering();
        });
    };
    const onDurationChange = () => {
        if (!video.isConnected) return;
        if (watcher._ref?.deref() !== video) watcher.get();
        refreshBuffering();
    };

    return {
        waiting: refreshBuffering,
        stalled: refreshBuffering,
        loadstart: refreshBuffering,
        playing: refreshBuffering,
        canplay: refreshBuffering,
        seeking: onSeeking,
        seeked: onSeeked,
        ended: onEnded,
        pause: onPause,
        durationchange: onDurationChange,
    };
}

// ─── VideoSrc observer ────────────────────────────────────────────────────────

let _videoSrcObserver = null, _srcDebounceTimer = null;

function observeVideoSrc() {
    teardownVideoSrcObserver();
    const v = VideoWatcher._ref?.deref();
    if (!v?.isConnected) return;
    _videoSrcObserver = new MutationObserver(() => {
        clearTimeout(_srcDebounceTimer);
        _srcDebounceTimer = setTimeout(() => {
            _srcDebounceTimer = null;
            if (!isWatchPage() || !state.settings.extensionEnabled) return;
            VideoWatcher.get();
            if (state.settings.buttonSkipEnabled) tryInject(0);
        }, 150);
    });
    _videoSrcObserver.observe(v, { attributeFilter: ['src'] });
}

function teardownVideoSrcObserver() {
    _videoSrcObserver?.disconnect(); _videoSrcObserver = null;
    if (_srcDebounceTimer !== null) { clearTimeout(_srcDebounceTimer); _srcDebounceTimer = null; }
}

// ─── Seek ─────────────────────────────────────────────────────────────────────

let _intendedTime = null;
let _lastExtensionSeekAt = 0;

function monotonicNow() {
    return typeof performance?.now === 'function' ? performance.now() : Date.now();
}

function isRecentExtensionSeek() {
    return monotonicNow() - _lastExtensionSeekAt < 250;
}

function canSeek(v) {
    return Boolean(v)
        && Number.isFinite(v.currentTime)
        && v.readyState >= HTMLMediaElement.HAVE_METADATA
        && (state.settings.ignoreBufferingProtection || !state.isBuffering);
}

function seekBase(v) {
    const canReuseIntendedTime = isFirefox()
        && _intendedTime !== null
        && Math.abs(_intendedTime - v.currentTime) < 2;
    return canReuseIntendedTime ? _intendedTime : v.currentTime;
}

function clampedSeekTime(v, base, delta) {
    // currentTime can be NaN briefly during ad transitions or video element
    // reuse. Math.max(0, NaN) returns NaN, and setting currentTime = NaN
    // silently snaps the video to the beginning — so guard explicitly.
    if (!Number.isFinite(base)) return null;
    return Math.max(0, Math.min(Number.isFinite(v.duration) ? v.duration : Infinity, base + delta));
}

function seek(delta) {
    const v = VideoWatcher.get();
    if (!canSeek(v)) return 0;

    const base = seekBase(v);
    const clamped = clampedSeekTime(v, base, delta);
    if (clamped === null) return 0;
    const actualDelta = clamped - base;
    if (Math.abs(actualDelta) < 0.001) return 0;
    _lastExtensionSeekAt = monotonicNow();
    try { v.currentTime = clamped; } catch (e) { logError('seek', e); return 0; }

    _intendedTime = clamped;
    nudgeProgressBar();
    return actualDelta;
}

let _lastPBUpdate = 0;

const PROGRESS_SELECTORS = ['.ytp-progress-bar', '.ytp-scrubber-container', '.vjs-progress-holder', '.shaka-seek-bar'];

function nudgeProgressBar() {
    const now = Date.now();
    const delay = state.settings.progressBarUpdateDelay ?? 150;
    const mp = progressBarUpdateTarget(now, delay);
    if (!mp) return;
    for (const sel of PROGRESS_SELECTORS) dispatchMouseMove(mp.querySelector(sel));
}

function shouldNudgeProgressBar(now, delay) {
    return now - _lastPBUpdate >= delay;
}

function progressBarUpdateTarget(now, delay) {
    if (!shouldNudgeProgressBar(now, delay)) return null;
    _lastPBUpdate = now;
    return getMoviePlayer();
}

function dispatchMouseMove(el) {
    el?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
}

function nudgePlayer() {
    const mp = getMoviePlayer();
    if (!mp) return;
    const rect = mp.getBoundingClientRect();
    mp.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
    }));
    nudgeProgressBar();
}

// ─── SkipIndicator ────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgElement(tagName, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tagName);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
    return element;
}

function createSkipIndicatorElement() {
    const element = document.createElement('div');
    element.id = cfg.indicatorId;
    element.setAttribute('aria-hidden', 'true');

    const arrows = createSvgElement('svg', {
        id: 'yt-ffrw-skip-indicator-arrows',
        viewBox: '0 0 32 24',
    });
    ['6,0 12,6 6,12', '14,0 20,6 14,12', '22,0 28,6 22,12'].forEach(points => {
        arrows.appendChild(createSvgElement('polyline', {
            class: 'yt-ffrw-arrow-chevron',
            points,
        }));
    });

    const text = document.createElement('span');
    text.id = 'yt-ffrw-skip-indicator-text';
    element.append(arrows, text);
    return element;
}

const SkipIndicator = {
    _el: null,

    get el() {
        if (this._el?.isConnected) return this._el;
        const mp = getMoviePlayer();
        if (!mp) return null;
        const el = createSkipIndicatorElement();
        mp.appendChild(el);
        this._el = el;
        return el;
    },

    show(seconds, direction, holding) {
        const el = this.el;
        if (!el) return;
        el.querySelector('#yt-ffrw-skip-indicator-text').textContent = `${seconds}s`;
        el.classList.remove('position-left', 'position-right', 'holding', 'anim-forward', 'anim-backward');
        el.classList.add(indicatorPositionClass(direction));
        setIndicatorAnimation(el, direction, holding);
        el.classList.add('visible');
        clearTimeout(state.indicatorTimeout);
        state.indicatorTimeout = null;
    },

    scheduleHide() {
        clearTimeout(state.indicatorTimeout);
        state.indicatorTimeout = setTimeout(() => this._el?.classList.remove('visible', 'holding'), cfg.timing.indicatorHideDelay);
    },

    remove() {
        clearTimeout(state.indicatorTimeout);
        state.indicatorTimeout = null;
        this._el?.remove();
        this._el = null;
    },
};

function indicatorPositionClass(direction) {
    return direction === 'forward' ? 'position-right' : 'position-left';
}

function indicatorAnimationClass(direction) {
    return direction === 'forward' ? 'anim-forward' : 'anim-backward';
}

function setIndicatorAnimation(el, direction, holding) {
    if (holding) el.classList.add('holding');
    else void el.offsetWidth;
    el.classList.add(indicatorAnimationClass(direction));
}

// ─── PlayerUI ─────────────────────────────────────────────────────────────────

const BUTTON_SVG = {
    fwd: {
        textClass: 'f-icon-text',
        seekClass: 'f-seek',
        anchor: 'end',
        path: 'M21.43,7.61V0L0,10.72,21.43,21.43v-7.6H74.19V51.56H66.55V58H80.87V7.61Z',
        seekPoints: ['59,26.5 47,39 59,51.5','44,26.5 32,39 44,51.5','29,26.5 17,39 29,51.5'],
        textX: seconds => seconds < 10 ? '58%' : '68%',
    },
    rwd: {
        textClass: 'b-icon-text',
        seekClass: 'b-seek',
        anchor: 'start',
        path: 'M60.88.72,59.44,0V7.61H0V58H14.32V51.56H6.68V13.83H59.44v7.6L80.87,10.72Z',
        seekPoints: ['22,26.5 34,39 22,51.5','37,26.5 49,39 37,51.5','52,26.5 64,39 52,51.5'],
        textX: seconds => seconds < 10 ? '38%' : '28%',
    },
};

function appendSeekChevrons(group, points) {
    points.forEach(pointList => {
        group.appendChild(createSvgElement('polyline', {
            fill: 'none',
            stroke: 'white',
            'stroke-width': 5,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            points: pointList,
        }));
    });
}

function runButtonSeek(delta) {
    const actualDelta = seek(delta);
    if (!actualDelta) return 0;
    Stats.track(actualDelta, 'button');
    nudgePlayer();
    return actualDelta;
}

function canInjectButtons() {
    return [state.settings.extensionEnabled, state.settings.buttonSkipEnabled, isWatchPage(), Boolean(VideoWatcher.get())].every(Boolean);
}

const PlayerUI = {
    _holdListeners: [],
    _btnListeners:  [],

    _buildSVG(seconds, type) {
        const art = BUTTON_SVG[type];
        const svg = createSvgElement('svg', {
            height: 36,
            width: 36,
            viewBox: '0 0 80.87 58.01',
            'aria-hidden': 'true',
            focusable: 'false',
        });
        svg.style.cssText = 'margin:auto;padding:0;transform:rotate(180deg);';
        const text = createSvgElement('text', {
            class: art.textClass,
            x: art.textX(seconds),
            y: '45%',
            'text-anchor': art.anchor,
            'dominant-baseline': 'middle',
            fill: 'white',
        });
        text.style.cssText = "font-size:28pt;font-weight:bold;font-family:'Roboto','Arial',sans-serif;user-select:none;transform:rotate(180deg);transform-origin:center;";
        text.textContent = String(seconds);

        const seekGroup = createSvgElement('g', {
            class: `${art.seekClass} hidden`,
        });
        appendSeekChevrons(seekGroup, art.seekPoints);
        svg.append(text, seekGroup, createSvgElement('path', { fill: '#fff', d: art.path }));
        return svg;
    },

    _addBtnListener(btn, type, fn) { btn.addEventListener(type, fn); this._btnListeners.push({ btn, type, fn }); },

    _removeBtnListeners() {
        for (const { btn, type, fn } of this._btnListeners) {
            try { btn.removeEventListener(type, fn); } catch { /* Detached nodes are already harmless. */ }
        }
        this._btnListeners = [];
    },

    _makeBtn(classes, seconds, type) {
        const direction = type === 'fwd' ? 'Forward' : 'Rewind';
        const btn = document.createElement('div');
        btn.classList.add('ytp-button', 'ytp-autohide-fade-transition', ...classes);
        btn.style.cssText = 'display:flex;width:auto;padding:0 7px;';
        btn.setAttribute('role', 'button');
        btn.tabIndex = 0;
        btn.setAttribute('aria-label', `${direction} ${seconds} seconds`);
        btn.appendChild(this._buildSVG(seconds, type));
        return btn;
    },

    _attachHoldSeek(btn, delta, iconSel, textSel) {
        const toggleHoldVisual = (holding) => requestAnimationFrame(() => {
            btn.querySelector(iconSel)?.classList.toggle('hidden', !holding);
            btn.querySelector(textSel)?.classList.toggle('hidden', holding);
        });

        const clearHoldTimers = () => {
            clearTimeout(state.btnHoldTimeout);
            clearInterval(state.btnHoldInterval);
        };

        const performHeldSeek = () => {
            const actualDelta = runButtonSeek(delta);
            if (actualDelta) {
                state.btnHoldDidSeek = true;
                state.btnHoldSuppressBtn = btn;
            }
            return actualDelta;
        };

        const startHoldLoop = () => {
            state.btnHoldInterval = setInterval(() => {
                if (!isWatchPage()) { stopHold(); return; }
                performHeldSeek();
            }, state.settings.seekInterval ?? 150);
        };

        const startHold = event => {
            if (event.button !== 0 || !event.isPrimary) return;
            PlayerUI.stopHold(true);
            clearHoldTimers();
            clearTimeout(state.btnHoldSuppressTimer);
            state.btnHoldDidSeek = false;
            state.btnHoldSuppressBtn = null;
            state.btnHoldTimeout = setTimeout(() => {
                state.btnIsHolding     = true;
                state.btnHoldActiveBtn = btn;
                toggleHoldVisual(true);
                performHeldSeek();
                startHoldLoop();
            }, cfg.timing.holdThreshold);
        };

        const stopHold = (discardSuppression = false) => {
            clearHoldTimers();

            if (state.btnIsHolding && state.btnHoldActiveBtn === btn) {
                toggleHoldVisual(false);
                state.btnIsHolding     = false;
                state.btnHoldActiveBtn = null;
            }
            if (discardSuppression && state.btnHoldSuppressBtn === btn) {
                clearTimeout(state.btnHoldSuppressTimer);
                state.btnHoldDidSeek = false;
                state.btnHoldSuppressBtn = null;
            } else if (state.btnHoldSuppressBtn === btn) {
                clearTimeout(state.btnHoldSuppressTimer);
                state.btnHoldSuppressTimer = setTimeout(() => {
                    if (state.btnHoldSuppressBtn !== btn) return;
                    state.btnHoldDidSeek = false;
                    state.btnHoldSuppressBtn = null;
                }, 1000);
            }
        };

        const onPointerUp = () => stopHold(false);
        const onCancel = () => stopHold(true);
        btn.addEventListener('pointerdown', startHold);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onCancel);
        window.addEventListener('blur', onCancel);
        document.addEventListener('contextmenu', onCancel);

        this._holdListeners.push({ btn, startHold, stopHold, onPointerUp, onCancel });
    },

    _removeHoldListeners() {
        for (const { btn, startHold, stopHold, onPointerUp, onCancel } of this._holdListeners) {
            stopHold(true);
            btn.removeEventListener('pointerdown', startHold);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onCancel);
            window.removeEventListener('blur', onCancel);
            document.removeEventListener('contextmenu', onCancel);
        }
        this._holdListeners = [];
    },

    stopHold(discardSuppression = false) {
        this._holdListeners.forEach(({ stopHold }) => stopHold(discardSuppression));
    },

    _isPlaced(pos) {
        const rwd = document.querySelector(`.${cfg.cls.rwdBtn}`);
        const fwd = document.querySelector(`.${cfg.cls.fwdBtn}`);
        if (!rwd || !fwd) return false;
        return pos === 'left' ? isLeftButtonPlacement(rwd, fwd) : isRightButtonPlacement(rwd, fwd);
    },

    inject() {
        try { return this._inject(); }
        catch (e) { logError('inject buttons', e); this.remove(); return false; }
    },

    _inject() {
        const { buttonPosition: pos = 'left', forwardSkipTime: fwd = 10, backwardSkipTime: bwd = 10 } = state.settings;
        if (!canInjectButtons()) { this.remove(); return false; }
        if (this._isPlaced(pos)) { observeVideoSrc(); return true; }
        this.remove();
        const { fwdBtn, rwdBtn } = this._makeSkipButtons(fwd, bwd);
        if (!this._placeButtons(pos, rwdBtn, fwdBtn)) { this.remove(); return false; }
        observeVideoSrc();
        return true;
    },

    _wrapPair(a, b, css) {
        const w = document.createElement('div');
        w.classList.add(cfg.cls.container, 'ytp-autohide-fade-transition');
        w.setAttribute(OWNED_CONTAINER_ATTRIBUTE, '');
        w.style.cssText = css;
        w.append(a, b);
        return w;
    },

    _makeSkipButtons(fwd, bwd) {
        const fwdBtn = this._makeBtn([cfg.cls.fwdBtn], fwd, 'fwd');
        const rwdBtn = this._makeBtn([cfg.cls.rwdBtn], bwd, 'rwd');
        this._wireButton(fwdBtn, fwd, '.f-seek', '.f-icon-text');
        this._wireButton(rwdBtn, -bwd, '.b-seek', '.b-icon-text');
        return { fwdBtn, rwdBtn };
    },

    _wireButton(btn, delta, iconSel, textSel) {
        this._addBtnListener(btn, 'click', () => {
            if (state.btnHoldDidSeek && state.btnHoldSuppressBtn === btn) {
                clearTimeout(state.btnHoldSuppressTimer);
                state.btnHoldDidSeek = false;
                state.btnHoldSuppressBtn = null;
                return;
            }
            runButtonSeek(delta);
        });
        this._addBtnListener(btn, 'keydown', event => {
            if (!['Enter', ' '].includes(event.key) || event.repeat) return;
            event.preventDefault();
            event.stopPropagation();
            runButtonSeek(delta);
        });
        this._attachHoldSeek(btn, delta, iconSel, textSel);
    },

    _placeButtons(pos, rwdBtn, fwdBtn) {
        return pos === 'right'
            ? this._placeRightButtons(rwdBtn, fwdBtn)
            : this._placeLeftButtons(rwdBtn, fwdBtn);
    },

    _placeRightButtons(rwdBtn, fwdBtn) {
        fwdBtn.style.margin = rwdBtn.style.margin = '0';
        const rightBar = getRightControls();
        if (!rightBar) return false;
        rightBar.prepend(fwdBtn);
        rightBar.prepend(rwdBtn);
        return true;
    },

    _placeLeftButtons(rwdBtn, fwdBtn) {
        const left = getLeftControls();
        if (!left) return false;
        fwdBtn.classList.add('ytp-next-button', 'ytp-playlist-ui');
        rwdBtn.classList.add('ytp-prev-button');
        fwdBtn.style.cssText += 'border-top-left-radius:0;border-bottom-left-radius:0;margin:0;';
        rwdBtn.style.cssText += 'border-top-right-radius:0;border-bottom-right-radius:0;margin:0;';
        const container = this._wrapPair(rwdBtn, fwdBtn, 'display:flex;padding:0;margin:auto 7px auto -1px;');
        const time = left.querySelector(cfg.sel.timeDisplay);
        left.insertBefore(container, time ? time.nextSibling : null);
        return true;
    },

    remove() {
        this._removeHoldListeners();
        this._removeBtnListeners();
        document.querySelectorAll(`.${cfg.cls.container}`).forEach(container => {
            if (isOwnedButtonContainer(container)) container.remove();
        });
        document.querySelectorAll(EXTENSION_BUTTON_QUERY).forEach(el => el.remove());
    },
};

function isOwnedButtonContainer(container) {
    return container.hasAttribute(OWNED_CONTAINER_ATTRIBUTE)
        || Boolean(container.querySelector(EXTENSION_BUTTON_QUERY));
}

function getButtonContainer(button) {
    const container = button?.closest?.(`.${cfg.cls.container}`);
    return container && isOwnedButtonContainer(container) ? container : null;
}

function containerHasButtons(container, rwd, fwd) {
    return Boolean(container?.contains(rwd) && container.contains(fwd));
}

function isLeftButtonPlacement(rwd, fwd) {
    const container = getButtonContainer(rwd);
    const left      = getLeftControls();
    return Boolean(left?.contains(container) && containerHasButtons(container, rwd, fwd));
}

function isLegacyRightPlacement(rwd, fwd) {
    const container = getButtonContainer(rwd);
    const chrome    = document.querySelector(cfg.sel.chromeControls);
    const right     = document.querySelector(cfg.sel.rightControls);
    return Boolean(chrome?.contains(container) && container?.nextElementSibling === right && containerHasButtons(container, rwd, fwd));
}

function isRightButtonPlacement(rwd, fwd) {
    const rightBar = getRightControls();
    return rightBar ? rightBar.contains(rwd) && rightBar.contains(fwd) : isLegacyRightPlacement(rwd, fwd);
}

// ─── Retry injection ──────────────────────────────────────────────────────────

function clearRetryTimer() {
    if (state.retryTimer === null) return;
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
}

function injectionDisabled() {
    return [isWatchPage(), state.settings.extensionEnabled, state.settings.buttonSkipEnabled].includes(false);
}

function resetRetryState() {
    state.retryAttempts = 0;
}

function scheduleRetry() {
    const myGen = state.waitGeneration;
    state.retryTimer = setTimeout(() => {
        state.retryTimer = null;
        if (state.waitGeneration !== myGen) return;
        tryInject(state.retryAttempts);
    }, cfg.retry.delayMs);
}

function tryInject(attempt = 0) {
    clearRetryTimer();
    if (injectionDisabled()) { PlayerUI.remove(); resetRetryState(); return false; }
    if (PlayerUI.inject()) { resetRetryState(); return true; }
    state.retryAttempts = attempt + 1;
    if (state.retryAttempts >= cfg.retry.maxAttempts) { resetRetryState(); return false; }
    scheduleRetry();
    return false;
}

// ─── Media Keys ───────────────────────────────────────────────────────────────

const MEDIA_KEYS = new Set(['MediaPlayPause','MediaPlay','MediaPause','MediaStop','MediaTrackNext','MediaTrackPrevious','MediaFastForward','MediaRewind']);

// ─── KeyHandler ───────────────────────────────────────────────────────────────

function normalizeHotkey(key) {
    return typeof key === 'string' && key.length === 1 ? key.toLowerCase() : key;
}

function keyboardIntentFor(key) {
    const intents = [forwardKeyboardIntent(), backwardKeyboardIntent()];
    const normalizedKey = normalizeHotkey(key);
    const intent = intents.find(item => normalizeHotkey(item.key) === normalizedKey);
    return intent ?? null;
}

function forwardKeyboardIntent() {
    const amount = state.settings.keyboardForward ?? 5;
    return { key: state.settings.keyboardForwardKey, direction: 'forward', amount, delta: amount };
}

function backwardKeyboardIntent() {
    const amount = state.settings.keyboardBackward ?? 5;
    return { key: state.settings.keyboardBackwardKey, direction: 'backward', amount, delta: -amount };
}

function hasBlockedModifier(e) {
    return !MEDIA_KEYS.has(e.key) && [e.ctrlKey, e.metaKey, e.altKey, e.shiftKey].includes(true);
}

function isInteractiveEventTarget(e) {
    return isInteractive(document.activeElement) || isInteractive(e.target);
}

function consumeKeyboardEvent(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
}

function keyboardInputState(e) {
    return {
        enabled: state.settings.extensionEnabled && state.settings.keyboardShortcutsEnabled && isWatchPage(),
        interactive: isInteractiveEventTarget(e),
        intent: keyboardIntentFor(e.key),
        blocked: hasBlockedModifier(e),
    };
}

function shouldIgnoreKeyboardInput(input) {
    return [Boolean(input.intent), !input.blocked].includes(false);
}

function handleKey(e) {
    const input = keyboardInputState(e);
    if (!input.enabled) return;
    if (input.interactive) { stopKeySeek(); return; }
    if (shouldIgnoreKeyboardInput(input)) return;
    consumeKeyboardEvent(e);
    runKeyIntent(e, input.intent);
}

function onKeyDown(e) {
    if (!MEDIA_KEYS.has(e.key)) handleKey(e);
}

function onKeyUp(e) {
    if (MEDIA_KEYS.has(e.key)) { handleKey(e); return; }
    stopIfActiveKey(e.key);
}

function onKeyVisibility() {
    if (document.hidden) stopKeySeek();
}

function stopKeySeek() {
    if (!state.activeSeekKey) return;
    clearTimeout(state.holdTimeout); clearInterval(state.seekInterval);
    state.holdTimeout = state.seekInterval = state.activeSeekKey = null;
    SkipIndicator.scheduleHide();
}

function stopIfActiveKey(key) {
    if (normalizeHotkey(key) === state.activeSeekKey) stopKeySeek();
}

function runKeyIntent(e, intent) {
    if (MEDIA_KEYS.has(e.key)) {
        runMediaKeyIntent(intent);
        return;
    }
    startKeySeek(e.key, intent.delta, intent.amount, intent.direction);
}

function runMediaKeyIntent(intent) {
    stopKeySeek();
    const actualDelta = seek(intent.delta);
    if (actualDelta) Stats.track(actualDelta, 'keyboard');
    SkipIndicator.show(intent.amount, intent.direction, false);
    SkipIndicator.scheduleHide();
}

function startKeySeek(key, delta, amount, dir) {
    const normalizedKey = normalizeHotkey(key);
    if (state.activeSeekKey === normalizedKey) return;
    stopKeySeek(); state.activeSeekKey = normalizedKey;
    const actualDelta = seek(delta);
    if (actualDelta) Stats.track(actualDelta, 'keyboard');
    SkipIndicator.show(amount, dir, false);
    state.holdTimeout = setTimeout(() => {
        if (state.activeSeekKey !== normalizedKey) return;
        SkipIndicator.show(amount, dir, true);
        const repeatSeek = () => {
            const repeatedDelta = seek(delta);
            if (repeatedDelta) Stats.track(repeatedDelta, 'keyboard');
            nudgePlayer();
        };
        repeatSeek();
        state.seekInterval = setInterval(repeatSeek, state.settings.seekInterval ?? 150);
    }, cfg.timing.holdThreshold);
}

const KeyHandler = {
    attach() {
        if (state.keysAttached) return;
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('keyup',   onKeyUp,   true);
        window.addEventListener('blur', stopKeySeek);
        document.addEventListener('visibilitychange', onKeyVisibility);
        state.keysAttached = true;
    },
    detach() {
        if (!state.keysAttached) return;
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('keyup',   onKeyUp,   true);
        window.removeEventListener('blur', stopKeySeek);
        document.removeEventListener('visibilitychange', onKeyVisibility);
        stopKeySeek(); state.keysAttached = false;
    },
};

// ─── Player MutationObserver ──────────────────────────────────────────────────

const debouncedTryInject = debounce(() => { if (state.settings.extensionEnabled) tryInject(0); }, cfg.debounce.mutation);

// Pre-compute the combined control-bar selector list used in childList checks
// so it isn't re-allocated on every mutation callback invocation.
const ALL_CONTROL_FALLBACKS = [...cfg.sel.rightControlsFallbacks, ...cfg.sel.leftControlsFallbacks];
const OBSERVED_CONTROL_SELECTORS = [
    cfg.sel.chromeControls,
    ...ALL_CONTROL_FALLBACKS,
    `.${cfg.cls.fwdBtn}`,
    `.${cfg.cls.rwdBtn}`,
];
const EXTENSION_CONTROL_SELECTORS = [
    `.${cfg.cls.container}`,
    `.${cfg.cls.fwdBtn}`,
    `.${cfg.cls.rwdBtn}`,
];

function matchesAnySelector(node, selectors) {
    return selectors.some(sel => node.matches?.(sel) || node.querySelector?.(sel));
}

function isExtensionControlNode(node) {
    return matchesAnySelector(node, EXTENSION_CONTROL_SELECTORS);
}

function childListTouchesControls(mutation) {
    const added = [...mutation.addedNodes]
        .filter(node => node.nodeType === 1 && !isExtensionControlNode(node));
    const removed = [...mutation.removedNodes].filter(node => node.nodeType === 1);
    const changed = [...added, ...removed];
    return changed.some(node => matchesAnySelector(node, OBSERVED_CONTROL_SELECTORS));
}

function mutationNeedsReinject(mutation) {
    return mutation.type === 'childList' && childListTouchesControls(mutation);
}

function playerMutationCb(mutations) {
    if (mutations.some(mutationNeedsReinject)) debouncedTryInject();
}

function observePlayer(attempt = 0) {
    state.observerInitTimeout = null;
    state.playerObserver?.disconnect(); state.playerObserver = null;
    if (!state.settings.extensionEnabled || !state.settings.buttonSkipEnabled || !isWatchPage()) return;
    const mp = getMoviePlayer();
    if (!mp) {
        state.observerAttempts = attempt + 1;
        if (state.observerAttempts >= cfg.observerRetry.maxAttempts) return;
        state.observerInitTimeout = setTimeout(() => observePlayer(state.observerAttempts), cfg.observerRetry.delayMs);
        return;
    }
    state.observerAttempts = 0;
    state.playerObserver = new MutationObserver(playerMutationCb);
    state.playerObserver.observe(mp, { childList: true, subtree: true });
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function onNavigation() {
    const url = document.URL;
    const buttonsReady = !state.settings.buttonSkipEnabled
        || (document.querySelector(`.${cfg.cls.fwdBtn}`) && document.querySelector(`.${cfg.cls.rwdBtn}`));
    if (url === state.lastUrl && (!isWatchPage() || buttonsReady)) return;
    state.lastUrl = url;
    handleNavigation();
}

const debouncedNav = debounce(onNavigation, cfg.debounce.navigation);

function resetNavigationState() {
    stopKeySeek();
    PlayerUI.stopHold(true);
    state.playerObserver?.disconnect(); state.playerObserver = null;
    state.cachedMoviePlayer = null; state.retryAttempts = 0; state.observerAttempts = 0;
    teardownVideoSrcObserver();
    state.waitGeneration++;
    if (state.retryTimer !== null) { clearTimeout(state.retryTimer); state.retryTimer = null; }
    clearTimeout(state.observerInitTimeout); state.observerInitTimeout = null;
    clearTimeout(state.navigationInitTimeout); state.navigationInitTimeout = null;
    VideoWatcher.release();
    state.isBuffering = false; _intendedTime = null; _lastPBUpdate = 0;
}

function syncKeyboardAttachment() {
    if (state.settings.extensionEnabled && state.settings.keyboardShortcutsEnabled && isWatchPage()) KeyHandler.attach();
    else KeyHandler.detach();
}

function scheduledNavigationIsStale() {
    return [state.settings.extensionEnabled, document.URL === state.lastUrl, isWatchPage()].includes(false);
}

function refreshVideoBufferState() {
    const v = VideoWatcher.get();
    if (v) state.isBuffering = !v.paused && v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
}

function stopButtonObservation() {
    state.playerObserver?.disconnect();
    state.playerObserver = null;
    clearTimeout(state.observerInitTimeout);
    state.observerInitTimeout = null;
    state.observerAttempts = 0;
}

function syncButtonRuntime() {
    if (!state.settings.buttonSkipEnabled) {
        stopButtonObservation();
        PlayerUI.remove();
        return;
    }
    observePlayer();
    tryInject(0);
}

function finishNavigationInit() {
    state.navigationInitTimeout = null;
    if (scheduledNavigationIsStale()) { PlayerUI.remove(); return; }
    refreshVideoBufferState();
    syncButtonRuntime();
}

function handleNavigation() {
    resetNavigationState();

    if (!state.settings.extensionEnabled) { cleanup(); return; }
    syncKeyboardAttachment();
    if (!isWatchPage()) { PlayerUI.remove(); return; }

    const delay = state.settings.navigationInitDelay ?? 250;
    state.navigationInitTimeout = setTimeout(finishNavigationInit, delay);
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function cleanup() {
    state.settingsReadGeneration++;
    PlayerUI.remove(); VideoWatcher.release(); teardownVideoSrcObserver(); KeyHandler.detach(); SkipIndicator.remove();
    clearTimeout(state.observerInitTimeout); state.observerInitTimeout = null;
    clearTimeout(state.navigationInitTimeout); state.navigationInitTimeout = null;
    clearTimeout(state.holdTimeout); clearTimeout(state.btnHoldTimeout);
    clearTimeout(state.btnHoldSuppressTimer); state.btnHoldSuppressTimer = null;
    clearInterval(state.seekInterval); clearInterval(state.btnHoldInterval);
    if (state.retryTimer !== null) { clearTimeout(state.retryTimer); state.retryTimer = null; }
    state.waitGeneration++;
    document.removeEventListener('fullscreenchange',    debouncedFullscreen);
    window.removeEventListener('resize',               debouncedResize);
    window.removeEventListener('yt-navigate-finish',   debouncedNav);
    window.removeEventListener('yt-page-data-updated', debouncedNav);
    window.removeEventListener('popstate',             debouncedNav);
    debouncedNav.cancel(); debouncedTryInject.cancel(); debouncedFullscreen.cancel(); debouncedResize.cancel();
    state.navObserver?.disconnect(); state.playerObserver?.disconnect();
    state.navObserver = state.playerObserver = null;
    state.retryAttempts = 0; state.observerAttempts = 0; state.retryTimer = null; state.observerInitTimeout = null;
    state.isBuffering = false; state.activeSeekKey = null;
    state.btnIsHolding = false; state.btnHoldActiveBtn = null; state.btnHoldDidSeek = false;
    state.btnHoldSuppressBtn = null;
    state.cachedMoviePlayer = null; state.lastUrl = '';
    _lastPBUpdate = 0; _intendedTime = null;
    Stats.flushNow();
}

// ─── Fullscreen / resize ──────────────────────────────────────────────────────

const debouncedFullscreen = debounce(() => { if (state.settings.extensionEnabled && isWatchPage() && state.settings.buttonSkipEnabled) tryInject(0); }, cfg.debounce.fullscreen);
const debouncedResize     = debounce(() => { if (state.settings.extensionEnabled && isWatchPage() && state.settings.buttonSkipEnabled) tryInject(0); }, cfg.debounce.resize);

// ─── Initialize ───────────────────────────────────────────────────────────────

function attachLifecycleListeners() {
    document.addEventListener('fullscreenchange',    debouncedFullscreen);
    window.addEventListener('resize',               debouncedResize);
    window.addEventListener('yt-navigate-finish',   debouncedNav);
    window.addEventListener('yt-page-data-updated', debouncedNav);
    window.addEventListener('popstate',             debouncedNav);
}

function observeTitleNavigation() {
    state.navObserver = new MutationObserver(debouncedNav);
    state.navObserver.observe(document.querySelector('title') ?? document.head, { childList: true, characterData: true, subtree: true });
}

async function init() {
    cleanup();
    const readGeneration = ++state.settingsReadGeneration;
    try {
        const synced = await chrome.storage.sync.get(CONTENT_SETTING_KEYS);
        if (readGeneration !== state.settingsReadGeneration) return;
        state.settings = normalizeContentSettings(synced);
        if (!state.settings.extensionEnabled) return;
        state.lastUrl = document.URL;
        syncKeyboardAttachment();
        attachLifecycleListeners();
        observeTitleNavigation();
        handleNavigation();
    } catch (e) {
        if (readGeneration !== state.settingsReadGeneration) return;
        logError('init', e);
        cleanup();
    }
}

// ─── Message listener ─────────────────────────────────────────────────────────

function forceInjectButtons(respond) {
    if (!state.settings.extensionEnabled) { respond({ status: 'disabled' }); return true; }
    if (!isWatchPage()) { respond({ status: 'not_on_watch_page' }); return true; }
    if (!state.settings.buttonSkipEnabled) { respond({ status: 'button_disabled' }); return true; }
    PlayerUI.remove();
    const injected = tryInject(0);
    respond({ status: injected ? 'ok' : 'player_not_ready' });
    return true;
}

function buttonSettingsChanged(old, current) {
    const watchedKeys = ['buttonSkipEnabled', 'buttonPosition', 'forwardSkipTime', 'backwardSkipTime'];
    return watchedKeys.some(key => old[key] !== current[key]);
}

function settingsWereDisabled(old) {
    return !state.settings.extensionEnabled && old.extensionEnabled;
}

function settingsWereEnabled(old) {
    return state.settings.extensionEnabled && !old.extensionEnabled;
}

function applyLiveSettings(old) {
    const keyboardChanged = ['keyboardShortcutsEnabled', 'keyboardForwardKey', 'keyboardBackwardKey',
        'keyboardForward', 'keyboardBackward', 'seekInterval']
        .some(key => old[key] !== state.settings[key]);
    if (keyboardChanged) stopKeySeek();
    if (old.seekInterval !== state.settings.seekInterval) PlayerUI.stopHold(true);
    syncKeyboardAttachment();
    if (!isWatchPage()) { PlayerUI.remove(); return; }
    if (buttonSettingsChanged(old, state.settings)) { PlayerUI.remove(); syncButtonRuntime(); }
}

function flushPendingStats(respond) {
    Stats.flushNow().then(
        ok => respond({ ok, error: ok ? undefined : 'Could not flush pending statistics' }),
        error => respond({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
}

function onRuntimeMessage(msg, _sender, respond) {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.action === 'injectButtons') return forceInjectButtons(respond);
    return msg.action === 'flushPendingStats' ? flushPendingStats(respond) : false;
}

chrome.runtime.onMessage.addListener(onRuntimeMessage);

// ─── Storage change listener ──────────────────────────────────────────────────

const LIVE_KEYS = new Set(CONTENT_SETTING_KEYS);

function hasLiveSettingChange(changes) {
    return Object.keys(changes).some(k => LIVE_KEYS.has(k));
}

async function reloadSettingsFromStorage() {
    const synced = await chrome.storage.sync.get(CONTENT_SETTING_KEYS);
    return normalizeContentSettings(synced);
}

function applyStorageSettings(newSettings) {
    const old = state.settings;
    state.settings = newSettings;
    if (settingsWereDisabled(old)) { cleanup(); return; }
    if (settingsWereEnabled(old)) { init(); return; }
    if (newSettings.extensionEnabled) applyLiveSettings(old);
}

function onStorageChanged(changes, area) {
    if (area !== 'sync' || !hasLiveSettingChange(changes)) return;
    const readGeneration = ++state.settingsReadGeneration;
    reloadSettingsFromStorage()
        .then(newSettings => {
            if (readGeneration === state.settingsReadGeneration) applyStorageSettings(newSettings);
        })
        .catch(e => {
            if (readGeneration === state.settingsReadGeneration) logError('storage.onChanged', e);
        });
}

chrome.storage.onChanged.addListener(onStorageChanged);

// ─── Bootstrap ────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

window.addEventListener('pagehide', event => {
    Stats.flushNow();
    stopKeySeek();
    PlayerUI.stopHold(true);
    if (!event.persisted) cleanup();
});
window.addEventListener('pageshow', event => {
    if (event.persisted && !state.lastUrl) init();
});
window.addEventListener('beforeunload', () => Stats.flushNow());
