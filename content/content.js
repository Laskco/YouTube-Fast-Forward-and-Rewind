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
        video:            '#movie_player video',
        leftControls:     '.ytp-left-controls',
        rightControls:    '.ytp-right-controls',
        chromeControls:   '.ytp-chrome-controls',
        timeDisplay:      '.ytp-time-display.notranslate',
        chapterContainer: '.ytp-chapter-container',
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
    rafRetry: { maxFrames: 600, fallbackMs: 16 },
    timing: {
        holdThreshold:      400,
        indicatorHideDelay: 500,
        observerInitDelay:  250,
    },
    debounce: {
        mutation:   400,
        navigation: 200,
        fullscreen: 100,
        resize:     150,
    },
    maxErrors: 10,
});

// ─── Player DOM helpers ───────────────────────────────────────────────────────

function isInPreviewPlayer(element) {
    return !!element?.closest(cfg.sel.previewPlayer);
}

function getRightControls() {
    for (const sel of cfg.sel.rightControlsFallbacks) {
        const candidates = Array.from(document.querySelectorAll(sel)).filter(el => !isInPreviewPlayer(el));
        if (candidates.length) return candidates[candidates.length - 1];
    }
    return null;
}

function getLeftControls() {
    for (const sel of cfg.sel.leftControlsFallbacks) {
        const candidates = Array.from(document.querySelectorAll(sel)).filter(el => !isInPreviewPlayer(el));
        if (candidates.length) return candidates[candidates.length - 1];
    }
    return null;
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

function getMoviePlayer() {
    if (state.cachedMoviePlayer?.isConnected) return state.cachedMoviePlayer;
    for (const sel of PLAYER_CONTAINER_SELECTORS) {
        const el = document.querySelector(sel);
        if (el?.isConnected) { state.cachedMoviePlayer = el; return el; }
    }
    state.cachedMoviePlayer = null;
    return null;
}

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
    settings: {},
    lastUrl:  '',

    buttonsInjected:      false,
    retryAttempts:        0,
    observerInitTimeout:  null,
    waitGeneration:       0,
    rafRetryHandle:       null,

    navObserver:    null,
    playerObserver: null,

    isBuffering:    false,
    videoListeners: null,
    playbackRate:   1,

    keysAttached:  false,
    activeSeekKey: null,
    seekInterval:  null,
    holdTimeout:   null,
    isHolding:     false,

    indicatorTimeout: null,

    btnHoldTimeout:   null,
    btnHoldInterval:  null,
    btnIsHolding:     false,
    btnHoldActiveBtn: null,
    btnHoldDidSeek:   false,

    cachedMoviePlayer: null,
};

// ─── Logging ──────────────────────────────────────────────────────────────────

function logError(ctx, err) {
    console.error('[FFRW]', ctx, err);
    if (!chrome.runtime?.id || ctx === 'stats') return;
    (async () => {
        try {
            const entry = {
                ts:      new Date().toISOString(),
                context: ctx,
                message: err instanceof Error ? err.message : String(err),
                stack:   err instanceof Error ? err.stack   : undefined,
            };
            const { recentErrors = [] } = await chrome.storage.local.get('recentErrors');
            recentErrors.push(entry);
            if (recentErrors.length > cfg.maxErrors) recentErrors.splice(0, recentErrors.length - cfg.maxErrors);
            await chrome.storage.local.set({ recentErrors });
        } catch (_) {}
    })();
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function debounce(fn, wait) {
    let t;
    const debounced = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
    debounced.cancel = () => { clearTimeout(t); t = null; };
    return debounced;
}

function isWatchPage() {
    const url = document.URL;
    return url.includes('youtube.com/watch') && !url.includes('/embed/');
}

function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName?.toUpperCase();
    return el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

const isFirefox = (() => { const r = navigator.userAgent.includes('Firefox'); return () => r; })();

// ─── RAF helpers ──────────────────────────────────────────────────────────────

function scheduleFrame(fn) {
    return typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(fn)
        : setTimeout(fn, cfg.rafRetry.fallbackMs);
}

function cancelFrame(handle) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
    else clearTimeout(handle);
}

// ─── Stats ────────────────────────────────────────────────────────────────────

const Stats = (() => {
    const queue = { totalSecondsSkipped: 0, totalSkips: 0, buttonSkips: 0, keyboardSkips: 0 };
    let flushTimer = null;

    async function flush() {
        flushTimer = null;
        if (!chrome.runtime?.id) return;
        const delta = { ...queue };
        queue.totalSecondsSkipped = queue.totalSkips = queue.buttonSkips = queue.keyboardSkips = 0;
        try {
            const d = await chrome.storage.local.get(['stats_totalSecondsSkipped','stats_totalSkips','stats_buttonSkips','stats_keyboardSkips']);
            const updated = {
                stats_totalSecondsSkipped: (d.stats_totalSecondsSkipped || 0) + delta.totalSecondsSkipped,
                stats_totalSkips:          (d.stats_totalSkips          || 0) + delta.totalSkips,
                stats_buttonSkips:         (d.stats_buttonSkips         || 0) + delta.buttonSkips,
                stats_keyboardSkips:       (d.stats_keyboardSkips       || 0) + delta.keyboardSkips,
            };
            await chrome.storage.local.set(updated);
            chrome.runtime.sendMessage({ action: 'statsUpdated', stats: {
                totalSecondsSkipped: updated.stats_totalSecondsSkipped,
                totalSkips:          updated.stats_totalSkips,
                buttonSkips:         updated.stats_buttonSkips,
                keyboardSkips:       updated.stats_keyboardSkips,
            }}).catch(() => {});
        } catch (e) {
            queue.totalSecondsSkipped += delta.totalSecondsSkipped;
            queue.totalSkips          += delta.totalSkips;
            queue.buttonSkips         += delta.buttonSkips;
            queue.keyboardSkips       += delta.keyboardSkips;
            logError('stats', e);
        }
    }

    return {
        track(delta, source) {
            queue.totalSecondsSkipped += Math.abs(delta);
            queue.totalSkips          += 1;
            queue.buttonSkips         += source === 'button'   ? 1 : 0;
            queue.keyboardSkips       += source === 'keyboard' ? 1 : 0;
            clearTimeout(flushTimer);
            flushTimer = setTimeout(flush, 500);
        },
        flushNow() { clearTimeout(flushTimer); if (queue.totalSkips > 0 || queue.totalSecondsSkipped > 0) flush(); },
    };
})();

// ─── VideoWatcher ─────────────────────────────────────────────────────────────

const VideoWatcher = {
    _ref: null,

    get() {
        const cached = this._ref?.deref();
        if (cached) {
            if (cached.isConnected && typeof cached.currentTime === 'number' && !cached.ended) return cached;
            this._detach(cached);
        }

        let best = null;
        for (const v of document.querySelectorAll(cfg.sel.video)) {
            if (!v.isConnected || typeof v.currentTime !== 'number') continue;
            if (v.readyState < HTMLMediaElement.HAVE_METADATA) continue;
            const mp = v.closest('#movie_player');
            if (!mp) continue;
            if (!best) best = v;
            if (!mp.classList.contains(cfg.cls.adClass)) { best = v; break; }
        }
        if (best) { this._attach(best); return best; }
        return null;
    },

    _attach(v) {
        this._detach(this._ref?.deref());

        // Only mark as buffering when the video genuinely has no data ahead.
        // HAVE_FUTURE_DATA (3) means at least one frame ahead is decoded —
        // if readyState is below that, the player is truly stalled.
        // Using a readyState check rather than trusting the event alone prevents
        // 4K decode-pressure `waiting` events from blocking seeks when the video
        // actually has data buffered and ready.
        const checkBuffering = () => {
            state.isBuffering = v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
        };
        let vscPollInterval  = null;
        const syncRate       = () => { state.playbackRate = v.playbackRate || 1; };

        const onRateChange = () => {
            syncRate();
            if (state.seekInterval) { clearInterval(state.seekInterval); state.seekInterval = null; }
        };

        const startVscPoll = () => {
            if (vscPollInterval) return;
            vscPollInterval = setInterval(() => {
                if (!v.isConnected || v.paused) { clearInterval(vscPollInterval); vscPollInterval = null; return; }
                if (v.playbackRate !== state.playbackRate) onRateChange();
            }, 2000);
        };

        const onPlaying = () => {
            checkBuffering(); syncRate();
            if (document.body.classList.contains('vsc-initialized')) startVscPoll();
        };

        const onSeeking = () => {
            // Only cancel an active hold if the seek was user-initiated (scrubbing
            // the progress bar). If btnHoldInterval is running, the seeking event
            // was fired by our own seek() call — don't cancel it.
            if (state.btnIsHolding && !state.btnHoldInterval) {
                clearTimeout(state.btnHoldTimeout);
                state.btnIsHolding = false;
                state.btnHoldActiveBtn = null;
                document.querySelectorAll(`.${cfg.cls.fwdBtn},.${cfg.cls.rwdBtn}`).forEach(btn => {
                    btn.querySelectorAll('.f-seek,.b-seek').forEach(el => el.classList.add('hidden'));
                    btn.querySelectorAll('.f-icon-text,.b-icon-text').forEach(el => el.classList.remove('hidden'));
                });
            }
        };

        const onSeeked   = () => { state.isBuffering = false; _intendedTime = null; };
        const onEnded    = () => {
            state.isBuffering = false; _intendedTime = null;
            if (state.btnIsHolding) {
                clearTimeout(state.btnHoldTimeout); clearInterval(state.btnHoldInterval);
                state.btnIsHolding = false; state.btnHoldActiveBtn = null;
            }
        };
        const onPause    = () => {
            Promise.resolve().then(() => { if (v.paused && !v.seeking) { state.isBuffering = false; _intendedTime = null; } });
            if (vscPollInterval) { clearInterval(vscPollInterval); vscPollInterval = null; }
        };
        const onDurationChange = () => {
            if (!v.isConnected || v.ended) return;
            if (this._ref?.deref() === v) syncRate(); else VideoWatcher.get();
        };

        const listeners = {
            waiting: checkBuffering, stalled: checkBuffering, loadstart: checkBuffering,
            playing: onPlaying, canplay: checkBuffering,
            seeking: onSeeking, seeked: onSeeked, ended: onEnded, pause: onPause,
            ratechange: onRateChange, videoSpeed_ratechange: onRateChange,
            durationchange: onDurationChange,
            error: (e) => logError('video error', e),
        };

        for (const [ev, fn] of Object.entries(listeners)) v.addEventListener(ev, fn);
        this._ref            = new WeakRef(v);
        state.videoListeners = { ...listeners, _vscPollCleanup: () => { clearInterval(vscPollInterval); vscPollInterval = null; } };
        state.isBuffering    = v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
        syncRate();
    },

    _detach(v) {
        if (!v) return;
        if (state.videoListeners) {
            const { _vscPollCleanup, ...listeners } = state.videoListeners;
            _vscPollCleanup?.();
            for (const [ev, fn] of Object.entries(listeners)) try { v.removeEventListener(ev, fn); } catch (_) {}
            state.videoListeners = null;
        }
        this._ref = null;
    },

    release() { this._detach(this._ref?.deref()); },
};

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

function seek(delta) {
    const v = VideoWatcher.get();
    if (!v) return false;
    if (!state.settings.ignoreBufferingProtection && state.isBuffering) return false;

    const base = (isFirefox() && _intendedTime !== null && Math.abs(_intendedTime - v.currentTime) < 2)
        ? _intendedTime : v.currentTime;

    // currentTime can be NaN briefly during ad transitions or video element
    // reuse. Math.max(0, NaN) returns NaN, and setting currentTime = NaN
    // silently snaps the video to the beginning — so guard explicitly.
    if (!isFinite(base)) return false;

    const clamped = Math.max(0, Math.min(isFinite(v.duration) ? v.duration : Infinity, base + delta));

    try { v.currentTime = clamped; } catch (e) { logError('seek', e); return false; }

    _intendedTime = clamped;
    nudgeProgressBar();
    return true;
}

let _lastPBUpdate = 0;

const PROGRESS_SELECTORS = ['.ytp-progress-bar', '.ytp-scrubber-container', '.vjs-progress-holder', '.shaka-seek-bar'];

function nudgeProgressBar() {
    const now = Date.now();
    const delay = state.settings.progressBarUpdateDelay ?? 150;
    if (now - _lastPBUpdate < delay) return;
    _lastPBUpdate = now;
    const mp = getMoviePlayer();
    if (!mp) return;
    for (const sel of PROGRESS_SELECTORS) {
        const el = mp.querySelector(sel);
        if (el) el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
    }
}

function nudgePlayer() {
    const mp = getMoviePlayer();
    if (!mp) return;
    mp.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true,
        clientX: mp.offsetWidth / 2, clientY: mp.offsetHeight / 2,
    }));
    nudgeProgressBar();
}

// ─── SkipIndicator ────────────────────────────────────────────────────────────

const SkipIndicator = {
    _el: null,

    get el() {
        if (this._el?.isConnected) return this._el;
        const mp = getMoviePlayer();
        if (!mp) return null;
        const el = document.createElement('div');
        el.id        = cfg.indicatorId;
        el.innerHTML = `
            <svg id="yt-ffrw-skip-indicator-arrows" viewBox="0 0 32 24">
                <polyline class="yt-ffrw-arrow-chevron" points="6,0 12,6 6,12"/>
                <polyline class="yt-ffrw-arrow-chevron" points="14,0 20,6 14,12"/>
                <polyline class="yt-ffrw-arrow-chevron" points="22,0 28,6 22,12"/>
            </svg>
            <span id="yt-ffrw-skip-indicator-text"></span>
        `;
        mp.appendChild(el);
        this._el = el;
        return el;
    },

    show(seconds, direction, holding) {
        const el = this.el;
        if (!el) return;
        el.querySelector('#yt-ffrw-skip-indicator-text').textContent = `${seconds}s`;
        el.classList.remove('position-left', 'position-right', 'holding', 'anim-forward', 'anim-backward');
        el.classList.add(direction === 'forward' ? 'position-right' : 'position-left');
        if (holding) {
            el.classList.add('holding', direction === 'forward' ? 'anim-forward' : 'anim-backward');
        } else {
            void el.offsetWidth;
            el.classList.add(direction === 'forward' ? 'anim-forward' : 'anim-backward');
        }
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

// ─── PlayerUI ─────────────────────────────────────────────────────────────────

const PlayerUI = {
    _holdListeners: [],
    _btnListeners:  [],

    _buildSVG(seconds, type) {
        const isFwd  = type === 'fwd';
        const textX  = isFwd ? (seconds < 10 ? '58%' : '68%') : (seconds < 10 ? '38%' : '28%');
        const anchor = isFwd ? 'end' : 'start';
        const pathD  = isFwd
            ? 'M21.43,7.61V0L0,10.72,21.43,21.43v-7.6H74.19V51.56H66.55V58H80.87V7.61Z'
            : 'M60.88.72,59.44,0V7.61H0V58H14.32V51.56H6.68V13.83H59.44v7.6L80.87,10.72Z';
        const seekPts = isFwd
            ? ['59,26.5 47,39 59,51.5','44,26.5 32,39 44,51.5','29,26.5 17,39 29,51.5']
            : ['22,26.5 34,39 22,51.5','37,26.5 49,39 37,51.5','52,26.5 64,39 52,51.5'];
        const textCls = isFwd ? 'f-icon-text' : 'b-icon-text';
        const seekCls = isFwd ? 'f-seek'      : 'b-seek';
        const chevrons = seekPts.map(p => `<polyline fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" points="${p}"/>`).join('');
        return `<svg style="margin:auto;padding:0;transform:rotate(180deg);" height="36" width="36" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80.87 58.01">`
             + `<text class="${textCls}" x="${textX}" y="45%" text-anchor="${anchor}" dominant-baseline="middle" fill="white" style="font-size:28pt;font-weight:bold;font-family:'Roboto','Arial',sans-serif;user-select:none;transform:rotate(180deg);transform-origin:center;">${seconds}</text>`
             + `<g class="${seekCls} hidden">${chevrons}</g>`
             + `<path fill="#fff" d="${pathD}"/></svg>`;
    },

    _addBtnListener(btn, type, fn) { btn.addEventListener(type, fn); this._btnListeners.push({ btn, type, fn }); },

    _removeBtnListeners() {
        for (const { btn, type, fn } of this._btnListeners) try { btn.removeEventListener(type, fn); } catch (_) {}
        this._btnListeners = [];
    },

    _makeBtn(classes, seconds, type) {
        const btn = document.createElement('div');
        btn.classList.add('ytp-button', 'ytp-autohide-fade-transition', ...classes);
        btn.style.cssText = 'display:flex;width:auto;padding:0 7px;';
        btn.innerHTML     = this._buildSVG(seconds, type);
        return btn;
    },

    _attachHoldSeek(btn, delta, iconSel, textSel) {
        const startHold = () => {
            clearTimeout(state.btnHoldTimeout);
            clearInterval(state.btnHoldInterval);
            state.btnHoldDidSeek = false;
            state.btnHoldTimeout = setTimeout(() => {
                state.btnIsHolding     = true;
                state.btnHoldDidSeek   = true;
                state.btnHoldActiveBtn = btn;
                requestAnimationFrame(() => {
                    btn.querySelector(iconSel)?.classList.remove('hidden');
                    btn.querySelector(textSel)?.classList.add('hidden');
                });
                state.btnHoldInterval = setInterval(() => {
                    if (!isWatchPage()) { clearInterval(state.btnHoldInterval); state.btnIsHolding = false; return; }
                    if (seek(delta)) Stats.track(delta, 'button');
                    nudgePlayer();
                }, state.settings.seekInterval ?? 150);
            }, cfg.timing.holdThreshold);
        };

        const stopHold = () => {
            clearTimeout(state.btnHoldTimeout);
            clearInterval(state.btnHoldInterval);

            if (state.btnIsHolding && state.btnHoldActiveBtn === btn) {
                requestAnimationFrame(() => {
                    btn.querySelector(iconSel)?.classList.add('hidden');
                    btn.querySelector(textSel)?.classList.remove('hidden');
                });
                state.btnIsHolding     = false;
                state.btnHoldActiveBtn = null;
            }
        };

        btn.addEventListener('mousedown', startHold);
        document.addEventListener('mouseup',       stopHold);
        document.addEventListener('contextmenu',   stopHold);
        document.addEventListener('pointercancel', stopHold);

        this._holdListeners.push({ stopHold });
    },

    _removeHoldListeners() {
        for (const { stopHold } of this._holdListeners) {
            document.removeEventListener('mouseup',       stopHold);
            document.removeEventListener('contextmenu',   stopHold);
            document.removeEventListener('pointercancel', stopHold);
        }
        this._holdListeners = [];
    },

    _isPlaced(pos) {
        const rwd = document.querySelector(`.${cfg.cls.rwdBtn}`);
        const fwd = document.querySelector(`.${cfg.cls.fwdBtn}`);
        if (!rwd || !fwd) return false;
        if (pos === 'left') {
            const container = document.querySelector(`.${cfg.cls.container}`);
            const left      = getLeftControls();
            return !!(container && left?.contains(container) && container.contains(rwd) && container.contains(fwd));
        }
        const rightBar = getRightControls();
        if (rightBar) return rightBar.contains(rwd) && rightBar.contains(fwd);
        const container = document.querySelector(`.${cfg.cls.container}`);
        const chrome    = document.querySelector(cfg.sel.chromeControls);
        const right     = document.querySelector(cfg.sel.rightControls);
        return !!(container && chrome?.contains(container) && container.nextElementSibling === right && container.contains(rwd) && container.contains(fwd));
    },

    inject() {
        try {
            const { extensionEnabled, buttonSkipEnabled, buttonPosition: pos = 'left', forwardSkipTime: fwd = 10, backwardSkipTime: bwd = 10 } = state.settings;
            if (!extensionEnabled || !buttonSkipEnabled || !isWatchPage()) { this.remove(); return false; }
            if (!VideoWatcher.get()) return false;
            if (this._isPlaced(pos)) { state.buttonsInjected = true; return true; }
            this.remove();

            const fwdBtn = this._makeBtn([cfg.cls.fwdBtn], fwd, 'fwd');
            const rwdBtn = this._makeBtn([cfg.cls.rwdBtn], bwd, 'rwd');

            this._addBtnListener(fwdBtn, 'click', () => { if (state.btnHoldDidSeek) { state.btnHoldDidSeek = false; return; } if (seek(fwd))  { Stats.track(fwd,  'button'); nudgePlayer(); } });
            this._addBtnListener(rwdBtn, 'click', () => { if (state.btnHoldDidSeek) { state.btnHoldDidSeek = false; return; } if (seek(-bwd)) { Stats.track(bwd,  'button'); nudgePlayer(); } });
            this._attachHoldSeek(fwdBtn,  fwd, '.f-seek', '.f-icon-text');
            this._attachHoldSeek(rwdBtn, -bwd, '.b-seek', '.b-icon-text');

            if (pos === 'right') {
                fwdBtn.style.margin = rwdBtn.style.margin = '0';
                const rightBar = getRightControls();
                if (!rightBar) { this.remove(); return false; }
                rightBar.prepend(fwdBtn); rightBar.prepend(rwdBtn);
            } else {
                fwdBtn.classList.add('ytp-next-button', 'ytp-playlist-ui');
                rwdBtn.classList.add('ytp-prev-button');
                fwdBtn.style.cssText += 'border-top-left-radius:0;border-bottom-left-radius:0;margin:0;';
                rwdBtn.style.cssText += 'border-top-right-radius:0;border-bottom-right-radius:0;margin:0;';
                const container = this._wrapPair(rwdBtn, fwdBtn, 'display:flex;padding:0;margin:auto 7px auto -1px;');
                const left = getLeftControls();
                if (!left) { this.remove(); return false; }
                const time = left.querySelector(cfg.sel.timeDisplay);
                left.insertBefore(container, time ? time.nextSibling : null);
            }

            state.buttonsInjected = true;
            observeVideoSrc();
            return true;
        } catch (e) { logError('inject buttons', e); this.remove(); return false; }
    },

    _wrapPair(a, b, css) {
        const w = document.createElement('div');
        w.classList.add(cfg.cls.container, 'ytp-autohide-fade-transition');
        w.style.cssText = css;
        w.append(a, b);
        return w;
    },

    remove() {
        this._removeHoldListeners();
        this._removeBtnListeners();
        document.querySelector(`.${cfg.cls.container}`)?.remove();
        document.querySelectorAll(`.${cfg.cls.fwdBtn},.${cfg.cls.rwdBtn}`).forEach(el => el.remove());
        state.buttonsInjected = false;
    },
};

// ─── Retry injection ──────────────────────────────────────────────────────────

function tryInject(attempt = 0) {
    if (state.rafRetryHandle !== null) { cancelFrame(state.rafRetryHandle); state.rafRetryHandle = null; }
    if (!isWatchPage() || !state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) {
        PlayerUI.remove(); state.retryAttempts = 0; return;
    }
    if (PlayerUI.inject()) { state.retryAttempts = 0; return; }
    state.retryAttempts = attempt + 1;
    if (state.retryAttempts >= cfg.rafRetry.maxFrames) { state.retryAttempts = 0; return; }
    const myGen = state.waitGeneration;
    state.rafRetryHandle = scheduleFrame(() => {
        state.rafRetryHandle = null;
        if (state.waitGeneration !== myGen) return;
        tryInject(state.retryAttempts);
    });
}

// ─── Media Keys ───────────────────────────────────────────────────────────────

const MEDIA_KEYS = new Set(['MediaPlayPause','MediaPlay','MediaPause','MediaStop','MediaTrackNext','MediaTrackPrevious','MediaFastForward','MediaRewind']);

// ─── KeyHandler ───────────────────────────────────────────────────────────────

const KeyHandler = (() => {
    const _handleKey = (e) => {
        if (!state.settings.extensionEnabled || !state.settings.keyboardShortcutsEnabled) return;
        if (isEditable(document.activeElement) || e.target?.closest?.('[contenteditable="true"]')) { _stop(); return; }

        const isFwd = e.key === state.settings.keyboardForwardKey;
        const isBwd = e.key === state.settings.keyboardBackwardKey;
        if (!isFwd && !isBwd) return;

        // Block modifier combos for regular keys only — media keys bypass this
        if (!MEDIA_KEYS.has(e.key) && (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)) return;

        e.preventDefault(); e.stopImmediatePropagation();
        const dir    = isFwd ? 'forward' : 'backward';
        const amount = isFwd ? (state.settings.keyboardForward ?? 5) : (state.settings.keyboardBackward ?? 5);
        const delta  = isFwd ? amount : -amount;

        // Media keys fire once per press — no hold mode
        if (MEDIA_KEYS.has(e.key)) {
            _stop();
            if (seek(delta)) Stats.track(delta, 'keyboard');
            SkipIndicator.show(amount, dir, false);
            SkipIndicator.scheduleHide();
            return;
        }

        _start(e.key, delta, amount, dir);
    };

    const _onKeyDown    = (e) => { if (!MEDIA_KEYS.has(e.key)) _handleKey(e); };
    const _onKeyUp      = (e) => { if (MEDIA_KEYS.has(e.key)) { _handleKey(e); return; } if (e.key === state.activeSeekKey) _stop(); };
    const _onVisibility = () => { if (document.hidden) _stop(); };

    const _stop = () => {
        if (!state.activeSeekKey) return;
        clearTimeout(state.holdTimeout); clearInterval(state.seekInterval);
        state.holdTimeout = state.seekInterval = state.activeSeekKey = null;
        state.isHolding = false;
        SkipIndicator.scheduleHide();
    };

    const _start = (key, delta, amount, dir) => {
        if (state.activeSeekKey === key) return;
        _stop(); state.activeSeekKey = key;
        if (seek(delta)) Stats.track(delta, 'keyboard');
        SkipIndicator.show(amount, dir, false);
        state.holdTimeout = setTimeout(() => { state.isHolding = true; SkipIndicator.show(amount, dir, true); }, cfg.timing.holdThreshold);
        state.seekInterval = setInterval(() => { if (seek(delta)) Stats.track(delta, 'keyboard'); nudgePlayer(); }, state.settings.seekInterval ?? 150);
    };

    return {
        _stop,
        attach() {
            if (state.keysAttached) return;
            document.addEventListener('keydown', _onKeyDown, true);
            document.addEventListener('keyup',   _onKeyUp,   true);
            window.addEventListener('blur', _stop);
            document.addEventListener('visibilitychange', _onVisibility);
            state.keysAttached = true;
        },
        detach() {
            if (!state.keysAttached) return;
            document.removeEventListener('keydown', _onKeyDown, true);
            document.removeEventListener('keyup',   _onKeyUp,   true);
            window.removeEventListener('blur', _stop);
            document.removeEventListener('visibilitychange', _onVisibility);
            _stop(); state.keysAttached = false;
        },
    };
})();

// ─── Player MutationObserver ──────────────────────────────────────────────────

const debouncedTryInject = debounce(() => { if (state.settings.extensionEnabled) tryInject(0); }, cfg.debounce.mutation);

// Pre-compute the combined control-bar selector list used in childList checks
// so it isn't re-allocated on every mutation callback invocation.
const ALL_CONTROL_FALLBACKS = [...cfg.sel.rightControlsFallbacks, ...cfg.sel.leftControlsFallbacks];

function playerMutationCb(mutations) {
    const mp = getMoviePlayer();
    for (const m of mutations) {
        let needsReinject = false;
        if (m.type === 'attributes' && m.attributeName === 'class') {
            const t = m.target;
            needsReinject = t === mp
                || t.matches?.(cfg.sel.leftControls) || t.matches?.(cfg.sel.rightControls) || t.matches?.(cfg.sel.chromeControls)
                || t.matches?.('.ytp-right-controls-left') || t.matches?.('.vjs-control-bar')
                || t.matches?.('.shaka-bottom-controls') || t.matches?.('.ypcs-control-buttons-right') || t.matches?.('.ypcs-control-buttons-left');
        } else if (m.type === 'childList') {
            const changed = [...m.addedNodes, ...m.removedNodes];
            needsReinject = changed.some(n => {
                if (n.nodeType !== 1) return false;
                if (n.matches(cfg.sel.chromeControls) || n.querySelector?.(cfg.sel.chromeControls)) return true;
                for (const sel of ALL_CONTROL_FALLBACKS)
                    if (n.matches(sel) || n.querySelector?.(sel)) return true;
                return false;
            });
        }
        if (needsReinject) { debouncedTryInject(); break; }
    }
}

function observePlayer() {
    state.playerObserver?.disconnect(); state.playerObserver = null;
    if (!state.settings.extensionEnabled || !isWatchPage()) return;
    const mp = getMoviePlayer();
    if (!mp) { state.observerInitTimeout = setTimeout(observePlayer, cfg.timing.observerInitDelay); return; }
    state.playerObserver = new MutationObserver(playerMutationCb);
    state.playerObserver.observe(mp, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    tryInject(0);
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function onNavigation() {
    const url = document.URL;
    if (url === state.lastUrl && (!isWatchPage() || !!document.querySelector(`.${cfg.cls.fwdBtn}`))) return;
    state.lastUrl = url;
    handleNavigation();
}

const debouncedNav = debounce(onNavigation, cfg.debounce.navigation);

function handleNavigation() {
    state.playerObserver?.disconnect(); state.playerObserver = null;
    state.cachedMoviePlayer = null; state.retryAttempts = 0;
    teardownVideoSrcObserver();
    state.waitGeneration++;
    if (state.rafRetryHandle !== null) { cancelFrame(state.rafRetryHandle); state.rafRetryHandle = null; }
    clearTimeout(state.observerInitTimeout); state.observerInitTimeout = null;
    VideoWatcher.release();
    state.isBuffering = false; _intendedTime = null; _lastPBUpdate = 0;

    if (!state.settings.extensionEnabled) { cleanup(); return; }
    if (state.settings.keyboardShortcutsEnabled) KeyHandler.attach(); else KeyHandler.detach();
    if (!isWatchPage()) { PlayerUI.remove(); return; }

    const delay = state.settings.navigationInitDelay ?? 250;
    setTimeout(() => {
        if (!state.settings.extensionEnabled || document.URL !== state.lastUrl || !isWatchPage()) { PlayerUI.remove(); return; }
        const v = VideoWatcher.get();
        if (v) state.isBuffering = v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
        observePlayer();
        if (state.settings.buttonSkipEnabled) tryInject(0); else PlayerUI.remove();
    }, delay);
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function cleanup() {
    PlayerUI.remove(); VideoWatcher.release(); teardownVideoSrcObserver(); KeyHandler.detach(); SkipIndicator.remove();
    clearTimeout(state.observerInitTimeout); state.observerInitTimeout = null;
    clearTimeout(state.holdTimeout); clearTimeout(state.btnHoldTimeout);
    clearInterval(state.seekInterval); clearInterval(state.btnHoldInterval);
    if (state.rafRetryHandle !== null) { cancelFrame(state.rafRetryHandle); state.rafRetryHandle = null; }
    state.waitGeneration++;
    document.removeEventListener('fullscreenchange',    debouncedFullscreen);
    window.removeEventListener('resize',               debouncedResize);
    window.removeEventListener('yt-navigate-finish',   debouncedNav);
    window.removeEventListener('yt-page-data-updated', debouncedNav);
    window.removeEventListener('popstate',             debouncedNav);
    debouncedNav.cancel(); debouncedTryInject.cancel(); debouncedFullscreen.cancel(); debouncedResize.cancel();
    state.navObserver?.disconnect(); state.playerObserver?.disconnect();
    state.navObserver = state.playerObserver = null;
    state.buttonsInjected = false; state.retryAttempts = 0; state.rafRetryHandle = null; state.observerInitTimeout = null;
    state.isBuffering = false; state.isHolding = false; state.activeSeekKey = null;
    state.btnIsHolding = false; state.btnHoldActiveBtn = null; state.btnHoldDidSeek = false;
    state.cachedMoviePlayer = null; state.lastUrl = '';
    _lastPBUpdate = 0; _intendedTime = null;
    Stats.flushNow();
}

// ─── Fullscreen / resize ──────────────────────────────────────────────────────

const debouncedFullscreen = debounce(() => { if (state.settings.extensionEnabled && isWatchPage() && state.settings.buttonSkipEnabled) tryInject(0); }, cfg.debounce.fullscreen);
const debouncedResize     = debounce(() => { if (state.settings.extensionEnabled && isWatchPage() && state.settings.buttonSkipEnabled) tryInject(0); }, cfg.debounce.resize);

// ─── Initialize ───────────────────────────────────────────────────────────────

async function init() {
    cleanup();
    try {
        const [synced, local] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(null)]);
        state.settings = { ...local, ...synced };
        if (!state.settings.extensionEnabled) return;
        state.lastUrl = document.URL;
        if (state.settings.keyboardShortcutsEnabled) KeyHandler.attach();
        document.addEventListener('fullscreenchange',    debouncedFullscreen);
        window.addEventListener('resize',               debouncedResize);
        window.addEventListener('yt-navigate-finish',   debouncedNav);
        window.addEventListener('yt-page-data-updated', debouncedNav);
        window.addEventListener('popstate',             debouncedNav);
        state.navObserver = new MutationObserver(debouncedNav);
        state.navObserver.observe(document.querySelector('title') ?? document.head, { childList: true, characterData: true, subtree: true });
        handleNavigation();
    } catch (e) { logError('init', e); cleanup(); }
}

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg.action === 'injectButtons') {
        if (state.settings.extensionEnabled && isWatchPage()) { PlayerUI.remove(); tryInject(0); respond({ status: 'ok' }); }
        else respond({ status: 'not_on_watch_page' });
        return true;
    }
    if (msg.action !== 'updateSettings') return false;
    const old = state.settings;
    state.settings = msg.settings;
    if (!state.settings.extensionEnabled && old.extensionEnabled) { cleanup(); respond({ status: 'disabled' }); return true; }
    if (state.settings.extensionEnabled && !old.extensionEnabled) { init();    respond({ status: 'initialized' }); return true; }
    if (state.settings.extensionEnabled) {
        if ( state.settings.keyboardShortcutsEnabled && !old.keyboardShortcutsEnabled) KeyHandler.attach();
        if (!state.settings.keyboardShortcutsEnabled &&  old.keyboardShortcutsEnabled) KeyHandler.detach();
        const btnChanged = old.buttonSkipEnabled !== state.settings.buttonSkipEnabled || old.buttonPosition !== state.settings.buttonPosition || old.forwardSkipTime !== state.settings.forwardSkipTime || old.backwardSkipTime !== state.settings.backwardSkipTime;
        if (isWatchPage()) { if (btnChanged) { PlayerUI.remove(); tryInject(0); } } else { PlayerUI.remove(); }
    }
    respond({ status: 'applied' }); return true;
});

// ─── Storage change listener ──────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const LIVE_KEYS = new Set(['extensionEnabled','buttonSkipEnabled','buttonPosition','forwardSkipTime','backwardSkipTime','keyboardShortcutsEnabled','keyboardForwardKey','keyboardBackwardKey','seekInterval','ignoreBufferingProtection']);
    if (!Object.keys(changes).some(k => LIVE_KEYS.has(k))) return;
    Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(null)]).then(([synced, local]) => {
        const newSettings = { ...local, ...synced };
        const old = state.settings;
        state.settings = newSettings;
        if (!newSettings.extensionEnabled && old.extensionEnabled) { cleanup(); return; }
        if (newSettings.extensionEnabled  && !old.extensionEnabled) { init();    return; }
        if (!newSettings.extensionEnabled) return;
        if ( newSettings.keyboardShortcutsEnabled && !old.keyboardShortcutsEnabled) KeyHandler.attach();
        if (!newSettings.keyboardShortcutsEnabled &&  old.keyboardShortcutsEnabled) KeyHandler.detach();
        const btnChanged = old.buttonSkipEnabled !== newSettings.buttonSkipEnabled || old.buttonPosition !== newSettings.buttonPosition || old.forwardSkipTime !== newSettings.forwardSkipTime || old.backwardSkipTime !== newSettings.backwardSkipTime;
        if (isWatchPage() && btnChanged) { PlayerUI.remove(); tryInject(0); } else if (!isWatchPage()) { PlayerUI.remove(); }
    }).catch(e => logError('storage.onChanged', e));
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

window.addEventListener('pagehide',     () => cleanup());
window.addEventListener('beforeunload', () => Stats.flushNow());
if (chrome.runtime?.onSuspend) chrome.runtime.onSuspend.addListener(() => cleanup());
