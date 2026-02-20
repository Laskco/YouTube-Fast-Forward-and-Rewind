/**
 * YouTube Fast Forward & Rewind – content script
 *
 * Architecture:
 *  - cfg        : immutable constants
 *  - state      : single mutable object; never spread/copied, only mutated
 *  - VideoWatcher  : finds & caches the video element, tracks buffering
 *  - PlayerUI      : injects / removes control buttons
 *  - SkipIndicator : the translucent seek overlay
 *  - KeyHandler    : keyboard continuous-seek logic
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
        video:          '#movie_player video',
        moviePlayer:    '#movie_player',
        leftControls:   '.ytp-left-controls',
        rightControls:  '.ytp-right-controls',
        chromeControls: '.ytp-chrome-controls',
        timeDisplay:    '.ytp-time-display.notranslate',
    },
    cls: {
        fwdBtn:        'ffBtnFfrw',
        rwdBtn:        'rwBtnFfrw',
        container:     'buttonsContainer',
        adClass:       'ad-showing',
    },
    indicatorId: 'yt-ffrw-skip-indicator',
    retry: { interval: 150, maxAttempts: 25 },
    timing: {
        holdThreshold:       400,   // ms before a held key becomes "continuous"
        indicatorHideDelay:  500,
        observerInitDelay:   250,
    },
    debounce: {
        mutation:    400,
        navigation:  200,
        fullscreen:  100,
        resize:      150,
    },
    maxErrors: 10,
});

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
    settings: {},
    lastUrl: '',

    // DOM lifecycle
    buttonsInjected: false,
    retryTimeout: null,
    retryAttempts: 0,

    // Observers
    navObserver: null,
    playerObserver: null,

    // Video element
    videoEl: null,
    isBuffering: false,
    videoListeners: null,

    // Keyboard seek
    keysAttached: false,
    activeSeekKey: null,
    seekInterval: null,
    holdTimeout: null,
    isHolding: false,

    // Skip indicator
    indicatorTimeout: null,

    // Hold-button seek (click & hold on injected buttons)
    btnHoldTimeout: null,
    btnHoldInterval: null,
    btnIsHolding: false,
    btnHoldActiveBtn: null,
    btnHoldDidSeek: false,

    // Misc
    cachedMoviePlayer: null,
};

// ─── Logging ──────────────────────────────────────────────────────────────────

function logError(ctx, err) {
    console.error('[FFRW]', ctx, err);
    if (!chrome.runtime?.id) return;
    (async () => {
        try {
            const entry = {
                ts:      new Date().toISOString(),
                context: ctx,
                message: err instanceof Error ? err.message : String(err),
                stack:   err instanceof Error ? err.stack : undefined,
            };
            const { recentErrors = [] } = await chrome.storage.local.get('recentErrors');
            recentErrors.push(entry);
            if (recentErrors.length > cfg.maxErrors) recentErrors.splice(0, recentErrors.length - cfg.maxErrors);
            await chrome.storage.local.set({ recentErrors });
        } catch (_) { /* storage unavailable – swallow */ }
    })();
}

// ─── Debounce ─────────────────────────────────────────────────────────────────

function debounce(fn, wait) {
    let t;
    const debounced = (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
    };
    debounced.cancel = () => { clearTimeout(t); t = null; };
    return debounced;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isWatchPage() {
    return window.location.pathname === '/watch';
}

function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName?.toUpperCase();
    return el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function getMoviePlayer() {
    if (state.cachedMoviePlayer?.isConnected) return state.cachedMoviePlayer;
    state.cachedMoviePlayer = document.querySelector(cfg.sel.moviePlayer);
    return state.cachedMoviePlayer;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

// Batch stat updates to avoid read-modify-write races during rapid keyboard holds
const _statQueue = { totalSecondsSkipped: 0, totalSkips: 0, buttonSkips: 0, keyboardSkips: 0 };
let _statFlushTimer = null;

async function _flushStats() {
    _statFlushTimer = null;
    if (!chrome.runtime?.id) return;
    const delta = { ..._statQueue };
    try {
        const keys = ['stats_totalSecondsSkipped', 'stats_totalSkips', 'stats_buttonSkips', 'stats_keyboardSkips'];
        const d = await chrome.storage.local.get(keys);
        await chrome.storage.local.set({
            stats_totalSecondsSkipped: (d.stats_totalSecondsSkipped || 0) + delta.totalSecondsSkipped,
            stats_totalSkips:          (d.stats_totalSkips          || 0) + delta.totalSkips,
            stats_buttonSkips:         (d.stats_buttonSkips         || 0) + delta.buttonSkips,
            stats_keyboardSkips:       (d.stats_keyboardSkips       || 0) + delta.keyboardSkips,
        });
        _statQueue.totalSecondsSkipped -= delta.totalSecondsSkipped;
        _statQueue.totalSkips          -= delta.totalSkips;
        _statQueue.buttonSkips         -= delta.buttonSkips;
        _statQueue.keyboardSkips       -= delta.keyboardSkips;
    } catch (e) {
        logError('trackSkip', e);
    }
}

function trackSkip(delta, source) {
    _statQueue.totalSecondsSkipped += Math.abs(delta);
    _statQueue.totalSkips          += 1;
    _statQueue.buttonSkips         += source === 'button'   ? 1 : 0;
    _statQueue.keyboardSkips       += source === 'keyboard' ? 1 : 0;
    clearTimeout(_statFlushTimer);
    _statFlushTimer = setTimeout(_flushStats, 500);
}

// ─── VideoWatcher ─────────────────────────────────────────────────────────────

const VideoWatcher = {
    _ref: null, // WeakRef<HTMLVideoElement>

    get() {
        // validate cached element via WeakRef
        const cached = this._ref?.deref();
        if (cached) {
            const ok = cached.isConnected && typeof cached.currentTime === 'number'
                    && cached.videoWidth > 0 && cached.videoHeight > 0 && !cached.ended;
            if (ok) return cached;
            this._detach(cached);
        }

        // scan for a valid element, prefer one not inside an ad
        let best = null;
        for (const v of document.querySelectorAll(cfg.sel.video)) {
            if (!v.isConnected || typeof v.currentTime !== 'number') continue;
            if (v.videoWidth <= 0 || v.videoHeight <= 0 || v.readyState < 1) continue;
            const mp = v.closest('#movie_player');
            if (!mp) continue;
            if (!best) { best = v; }
            // prefer non-ad element — if we find one, use it immediately
            if (!mp.classList.contains(cfg.cls.adClass)) { best = v; break; }
        }
        if (best) { this._attach(best); return best; }
        return null;
    },

    _attach(v) {
        this._detach(this._ref?.deref());
        const listeners = {
            waiting:   () => { state.isBuffering = true; },
            stalled:   () => { state.isBuffering = true; },
            loadstart: () => { state.isBuffering = true; },
            playing:   () => { state.isBuffering = false; },
            canplay:   () => { state.isBuffering = false; },
            error:     (e) => logError('video error', e),
        };
        for (const [ev, fn] of Object.entries(listeners)) v.addEventListener(ev, fn);
        this._ref = new WeakRef(v);
        state.videoEl = v; // keep for compatibility with existing state references
        state.videoListeners = listeners;
        state.isBuffering = v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
    },

    _detach(v) {
        if (!v || !state.videoListeners) return;
        for (const [ev, fn] of Object.entries(state.videoListeners)) {
            try { v.removeEventListener(ev, fn); } catch (_) {}
        }
        this._ref = null;
        state.videoEl = null;
        state.videoListeners = null;
    },

    release() { this._detach(this._ref?.deref()); },
};

// ─── Seek ─────────────────────────────────────────────────────────────────────

function seek(delta, { source, amount, direction } = {}) {
    const v = VideoWatcher.get();
    if (!v) return false;
    if (!state.settings.ignoreBufferingProtection && (v.seeking || state.isBuffering)) {
        return false;
    }

    const clamped = Math.max(0, Math.min(isFinite(v.duration) ? v.duration : Infinity, v.currentTime + delta));
    try { v.currentTime = clamped; } catch (e) { logError('seek', e); return false; }

    nudgeProgressBar();
    return true;
}

let _lastPBUpdate = 0;
function nudgeProgressBar() {
    const now = Date.now();
    const delay = state.settings.progressBarUpdateDelay ?? 150;
    if (now - _lastPBUpdate < delay) return;
    _lastPBUpdate = now;

    const mp = getMoviePlayer();
    if (!mp) return;
    for (const sel of ['.ytp-progress-bar', '.ytp-scrubber-container', '.ytp-chrome-controls']) {
        const el = mp.querySelector(sel);
        if (el) el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
    }
}

function nudgePlayer() {
    const mp = getMoviePlayer();
    if (!mp) return;
    mp.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true,
        clientX: mp.offsetWidth / 2, clientY: mp.offsetHeight / 2 }));
    nudgeProgressBar();
}

// ─── Skip Indicator ───────────────────────────────────────────────────────────

const SkipIndicator = {
    _el: null,

    get el() {
        if (this._el?.isConnected) return this._el;
        const mp = getMoviePlayer();
        if (!mp) return null;

        const el = document.createElement('div');
        el.id = cfg.indicatorId;
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

        el.classList.remove('position-left', 'position-right', 'holding', 'anim-forward', 'anim-backward', 'buffering-blocked');
        el.classList.add(direction === 'forward' ? 'position-right' : 'position-left');

        if (holding) {
            el.classList.add('holding', direction === 'forward' ? 'anim-forward' : 'anim-backward');
        } else {
            // Trigger CSS animation restart
            void el.offsetWidth;
            el.classList.add(direction === 'forward' ? 'anim-forward' : 'anim-backward');
        }

        el.classList.add('visible');
        clearTimeout(state.indicatorTimeout);
    },

    showBlocked(amount, direction) {
        const el = this.el;
        if (!el) return;

        el.querySelector('#yt-ffrw-skip-indicator-text').textContent = `${amount}s`;
        el.classList.remove('position-left', 'position-right', 'anim-forward', 'anim-backward', 'holding', 'buffering-blocked');
        el.classList.add(direction === 'forward' ? 'position-right' : 'position-left');

        // Force animation restart so repeated blocked flashes always re-trigger
        void el.offsetWidth;
        el.classList.add('buffering-blocked', 'visible');

        clearTimeout(state.indicatorTimeout);
        state.indicatorTimeout = setTimeout(() => {
            el.classList.remove('visible', 'buffering-blocked');
        }, 600);
    },

    scheduleHide() {
        clearTimeout(state.indicatorTimeout);
        state.indicatorTimeout = setTimeout(() => {
            this._el?.classList.remove('visible', 'holding');
        }, cfg.timing.indicatorHideDelay);
    },

    remove() {
        clearTimeout(state.indicatorTimeout);
        this._el?.remove();
        this._el = null;
    },
};

// ─── PlayerUI (button injection) ─────────────────────────────────────────────

const PlayerUI = {
    _holdListeners: [], // tracks document-level mouseup/contextmenu listeners for cleanup
    /** Build an SVG icon for the skip button.
     *
     * The entire SVG is rotated 180° so the arrow shape points the right way
     * without needing a mirrored path. As a side-effect that rotation also flips
     * the embedded text, so the text element itself counter-rotates 180° around
     * its own centre to stay readable. This means:
     *   - fwd button: text sits on the right half of the unrotated coordinate space
     *                 but appears on the left after the outer 180° flip — which is
     *                 correct for a forward-skip icon.
     *   - rwd button: mirror image of the above.
     *
     * @param {number} seconds  - The skip amount shown inside the icon.
     * @param {'fwd'|'rwd'} type
     */
    _buildSVG(seconds, type) {
        const isFwd = type === 'fwd';

        // Text horizontal position in the pre-rotation coordinate space.
        // After the outer 180° flip these land visually where expected.
        const textX      = isFwd ? (seconds < 10 ? '58%' : '68%') : (seconds < 10 ? '38%' : '28%');
        const textAnchor = isFwd ? 'end' : 'start';

        const pathD  = isFwd
            ? 'M21.43,7.61V0L0,10.72,21.43,21.43v-7.6H74.19V51.56H66.55V58H80.87V7.61Z'
            : 'M60.88.72,59.44,0V7.61H0V58H14.32V51.56H6.68V13.83H59.44v7.6L80.87,10.72Z';

        // Chevron arrow points for the hold-seek animation overlay
        const seekPts = isFwd
            ? ['59,26.5 47,39 59,51.5', '44,26.5 32,39 44,51.5', '29,26.5 17,39 29,51.5']
            : ['22,26.5 34,39 22,51.5', '37,26.5 49,39 37,51.5', '52,26.5 64,39 52,51.5'];

        const textClass = isFwd ? 'f-icon-text' : 'b-icon-text';
        const seekClass = isFwd ? 'f-seek'      : 'b-seek';

        return `<svg style="margin:auto;padding:0;transform:rotate(180deg);" height="36" width="36" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80.87 58.01"><text class="${textClass}" x="${textX}" y="45%" text-anchor="${textAnchor}" dominant-baseline="middle" fill="white" style="font-size: 28pt; font-weight: bold; font-family: 'Roboto', 'Arial', sans-serif; user-select:none;transform:rotate(180deg);transform-origin:center;">${seconds}</text><g class="${seekClass} hidden">${seekPts.map(p => `<polyline fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" points="${p}"/>`).join('')}</g><path fill="#fff" d="${pathD}"/></svg>`;
    },

    _makeBtn(classes, seconds, type, extraCss = '') {
        const btn = document.createElement('div');
        btn.classList.add('ytp-button', 'ytp-autohide-fade-transition', ...classes);
        btn.style.cssText = `display:flex;width:auto;padding:0 7px;${extraCss}`;
        btn.innerHTML = this._buildSVG(seconds, type);
        return btn;
    },

    _attachHoldSeek(btn, delta, iconSel, textSel) {
        const startHold = () => {
            clearTimeout(state.btnHoldTimeout);
            clearInterval(state.btnHoldInterval);
            state.btnHoldDidSeek = false;

            state.btnHoldTimeout = setTimeout(() => {
                state.btnIsHolding = true;
                state.btnHoldDidSeek = true;
                state.btnHoldActiveBtn = btn;

                const icon = btn.querySelector(iconSel);
                const text = btn.querySelector(textSel);
                requestAnimationFrame(() => {
                    icon?.classList.remove('hidden');
                    text?.classList.add('hidden');
                });

                state.btnHoldInterval = setInterval(() => {
                    const seeked = seek(delta, { source: 'button', amount: Math.abs(delta), direction: delta > 0 ? 'forward' : 'backward' });
                    if (seeked) trackSkip(delta, 'button');
                    nudgePlayer();
                }, state.settings.seekInterval ?? 150);
            }, cfg.timing.holdThreshold);
        };

        const stopHold = () => {
            clearTimeout(state.btnHoldTimeout);
            clearInterval(state.btnHoldInterval);

            // Only restore icons for the button that was actually being held
            if (state.btnIsHolding && state.btnHoldActiveBtn === btn) {
                const icon = btn.querySelector(iconSel);
                const text = btn.querySelector(textSel);
                requestAnimationFrame(() => {
                    icon?.classList.add('hidden');
                    text?.classList.remove('hidden');
                });
                state.btnIsHolding = false;
                state.btnHoldActiveBtn = null;
            }
        };

        btn.addEventListener('mousedown', startHold);
        document.addEventListener('mouseup',       stopHold);
        document.addEventListener('contextmenu',   stopHold);
        document.addEventListener('pointerup',     stopHold);
        document.addEventListener('pointercancel', stopHold);

        // Register for cleanup so these don't accumulate across re-injections
        this._holdListeners.push({ stopHold });
    },

    // Called by remove() to detach all accumulated document-level hold listeners
    _removeHoldListeners() {
        for (const { stopHold } of this._holdListeners) {
            document.removeEventListener('mouseup',       stopHold);
            document.removeEventListener('contextmenu',   stopHold);
            document.removeEventListener('pointerup',     stopHold);
            document.removeEventListener('pointercancel', stopHold);
        }
        this._holdListeners = [];
    },

    _isPlaced(position) {
        const rwd = document.querySelector(`.${cfg.cls.rwdBtn}`);
        const fwd = document.querySelector(`.${cfg.cls.fwdBtn}`);
        if (!rwd || !fwd) return false;

        if (position === 'left') {
            const container = document.querySelector(`.${cfg.cls.container}`);
            const left = document.querySelector(cfg.sel.leftControls);
            return !!(container && left?.contains(container) && container.contains(rwd) && container.contains(fwd));
        }

        // right
        const delhiRow = document.querySelector('.ytp-right-controls-left');
        if (delhiRow) return delhiRow.contains(rwd) && delhiRow.contains(fwd);

        const container = document.querySelector(`.${cfg.cls.container}`);
        const chrome = document.querySelector(cfg.sel.chromeControls);
        const right  = document.querySelector(cfg.sel.rightControls);
        return !!(container && chrome?.contains(container) && container.nextElementSibling === right
               && container.contains(rwd) && container.contains(fwd));
    },

    inject() {
        try {
            const { extensionEnabled, buttonSkipEnabled, buttonPosition: pos = 'left',
                    forwardSkipTime: fwd = 10, backwardSkipTime: bwd = 10 } = state.settings;

            if (!extensionEnabled || !buttonSkipEnabled || !isWatchPage()) {
                this.remove(); return false;
            }
            if (!VideoWatcher.get()) return false;
            if (this._isPlaced(pos)) { state.buttonsInjected = true; return true; }

            this.remove();

            const fwdBtn = this._makeBtn([cfg.cls.fwdBtn], fwd, 'fwd');
            const rwdBtn = this._makeBtn([cfg.cls.rwdBtn], bwd, 'rwd');

            // Click handlers (single tap) — suppressed if hold already fired seeks
            fwdBtn.addEventListener('click', () => { if (state.btnHoldDidSeek) { state.btnHoldDidSeek = false; return; } if (seek(fwd, { source: 'button', amount: fwd, direction: 'forward' }))  { trackSkip(fwd,  'button'); nudgePlayer(); } });
            rwdBtn.addEventListener('click', () => { if (state.btnHoldDidSeek) { state.btnHoldDidSeek = false; return; } if (seek(-bwd, { source: 'button', amount: bwd, direction: 'backward' })) { trackSkip(bwd,  'button'); nudgePlayer(); } });

            // Hold handlers
            this._attachHoldSeek(fwdBtn,  fwd, '.f-seek', '.f-icon-text');
            this._attachHoldSeek(rwdBtn, -bwd, '.b-seek', '.b-icon-text');

            if (pos === 'right') {
                fwdBtn.style.margin = rwdBtn.style.margin = '0';
                const delhiRow = document.querySelector('.ytp-right-controls-left');
                if (delhiRow) {
                    delhiRow.prepend(fwdBtn);
                    delhiRow.prepend(rwdBtn);
                } else {
                    const container = this._wrapPair(rwdBtn, fwdBtn, 'display:flex;padding:0;margin:auto 0;');
                    const chrome = document.querySelector(cfg.sel.chromeControls);
                    const right  = document.querySelector(cfg.sel.rightControls);
                    if (chrome && right) chrome.insertBefore(container, right);
                }
            } else {
                fwdBtn.classList.add('ytp-next-button', 'ytp-playlist-ui');
                rwdBtn.classList.add('ytp-prev-button');
                fwdBtn.style.cssText += 'border-top-left-radius:0;border-bottom-left-radius:0;margin:0;';
                rwdBtn.style.cssText += 'border-top-right-radius:0;border-bottom-right-radius:0;margin:0;';

                const container = this._wrapPair(rwdBtn, fwdBtn, 'display:flex;padding:0;margin:auto 7px auto -1px;');
                const left = document.querySelector(cfg.sel.leftControls);
                if (!left) { this.remove(); return false; }
                const time = left.querySelector(cfg.sel.timeDisplay);
                left.insertBefore(container, time ? time.nextSibling : null);
            }

            state.buttonsInjected = true;
            return true;
        } catch (e) {
            logError('inject buttons', e);
            this.remove();
            return false;
        }
    },

    _wrapPair(a, b, css) {
        const w = document.createElement('div');
        w.classList.add(cfg.cls.container);
        w.style.cssText = css;
        w.append(a, b);
        return w;
    },

    remove() {
        this._removeHoldListeners();
        document.querySelector(`.${cfg.cls.container}`)?.remove();
        document.querySelectorAll(`.${cfg.cls.fwdBtn},.${cfg.cls.rwdBtn}`)
                .forEach(el => el.remove());
        state.buttonsInjected = false;
    },
};

// ─── Retry injection ──────────────────────────────────────────────────────────

function tryInject(attempt = 0) {
    clearTimeout(state.retryTimeout);

    if (!isWatchPage() || !state.settings.extensionEnabled || !state.settings.buttonSkipEnabled) {
        PlayerUI.remove();
        state.retryAttempts = 0;
        return;
    }

    if (PlayerUI.inject()) { state.retryAttempts = 0; return; }

    state.retryAttempts = attempt + 1;
    if (state.retryAttempts >= cfg.retry.maxAttempts) { state.retryAttempts = 0; return; }

    const delay = attempt < 2 ? 30 : attempt < 5 ? 100 : cfg.retry.interval;
    state.retryTimeout = setTimeout(() => tryInject(state.retryAttempts), delay);
}

// ─── Keyboard Handler ─────────────────────────────────────────────────────────

const KeyHandler = (() => {
    const _onKeyDown = (e) => {
        if (!state.settings.extensionEnabled || !state.settings.keyboardShortcutsEnabled) return;
        if (isEditable(document.activeElement) || e.target?.closest?.('[contenteditable="true"]')) {
            _stop();
            return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

        const isFwd = e.key === state.settings.keyboardForwardKey;
        const isBwd = e.key === state.settings.keyboardBackwardKey;
        if (!isFwd && !isBwd) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        const dir    = isFwd ? 'forward' : 'backward';
        const amount = isFwd ? (state.settings.keyboardForward  ?? 5)
                             : (state.settings.keyboardBackward ?? 5);
        const delta  = isFwd ? amount : -amount;

        _start(e.key, delta, amount, dir);
    };

    const _onKeyUp = (e) => {
        if (e.key === state.activeSeekKey) _stop();
    };

    const _onVisibility = () => { if (document.hidden) _stop(); };

    const _stop = () => {
        if (!state.activeSeekKey) return;

        clearTimeout(state.holdTimeout);
        clearInterval(state.seekInterval);
        state.holdTimeout   = null;
        state.seekInterval  = null;
        state.activeSeekKey = null;
        state.isHolding     = false;

        SkipIndicator.scheduleHide();
    };

    const _start = (key, delta, amount, dir) => {
        if (state.activeSeekKey === key) return;   // already running
        _stop();
        state.activeSeekKey = key;

        // immediate single skip
        const seeked = seek(delta, { source: 'keyboard', amount, direction: dir });
        if (seeked) trackSkip(delta, 'keyboard');
        SkipIndicator.show(amount, dir, false);

        // transition to hold mode after threshold
        state.holdTimeout = setTimeout(() => {
            state.isHolding = true;
            SkipIndicator.show(amount, dir, true);
        }, cfg.timing.holdThreshold);

        // continuous seek — seek() returns true only if the seek actually fired
        state.seekInterval = setInterval(() => {
            const seeked = seek(delta, { source: 'keyboard', amount, direction: dir });
            if (seeked) trackSkip(delta, 'keyboard');
            nudgePlayer();
        }, state.settings.seekInterval ?? 150);
    };

    return {
        _stop, // exposed for cleanup() and window blur handler
        attach() {
            if (state.keysAttached) return;
            document.addEventListener('keydown',          _onKeyDown,    true);
            document.addEventListener('keyup',            _onKeyUp,      true);
            window.addEventListener('blur',               _stop);
            document.addEventListener('visibilitychange', _onVisibility);
            state.keysAttached = true;
        },
        detach() {
            if (!state.keysAttached) return;
            document.removeEventListener('keydown',          _onKeyDown,    true);
            document.removeEventListener('keyup',            _onKeyUp,      true);
            window.removeEventListener('blur',               _stop);
            document.removeEventListener('visibilitychange', _onVisibility);
            _stop();
            state.keysAttached = false;
        },
    };
})();

// ─── Player MutationObserver ──────────────────────────────────────────────────

const debouncedTryInject = debounce(() => {
    if (state.settings.extensionEnabled) tryInject(0);
}, cfg.debounce.mutation);

function playerMutationCb(mutations) {
    const mp = getMoviePlayer();
    let needsReinject = false;

    for (const m of mutations) {
        if (!needsReinject) {
            if (m.type === 'attributes' && m.attributeName === 'class') {
                const t = m.target;
                needsReinject = t === mp
                    || t.matches?.(cfg.sel.leftControls)
                    || t.matches?.(cfg.sel.rightControls)
                    || t.matches?.(cfg.sel.chromeControls);
            } else if (m.type === 'childList') {
                const changed = [...m.addedNodes, ...m.removedNodes];
                needsReinject = changed.some(n =>
                    n.nodeType === 1 && (n.matches(cfg.sel.chromeControls) || n.querySelector?.(cfg.sel.chromeControls))
                );
            }
        }
    }

    if (needsReinject) debouncedTryInject();
}

function observePlayer() {
    state.playerObserver?.disconnect();
    state.playerObserver = null;

    if (!state.settings.extensionEnabled || !isWatchPage()) return;

    const mp = getMoviePlayer();
    if (!mp) {
        setTimeout(observePlayer, cfg.timing.observerInitDelay);
        return;
    }

    state.playerObserver = new MutationObserver(playerMutationCb);
    state.playerObserver.observe(mp, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['class'],
    });

    tryInject(0);
}

// ─── Navigation ───────────────────────────────────────────────────────────────

const debouncedNav = debounce(onNavigation, cfg.debounce.navigation);

function onNavigation() {
    const url = window.location.href;
    const urlChanged = url !== state.lastUrl;

    // On non-watch pages, only re-run if the URL actually changed.
    // On watch pages, also re-run if buttons are missing (e.g. settings toggled on).
    if (!urlChanged && (!isWatchPage() || state.buttonsInjected)) return;

    state.lastUrl = url;
    handleNavigation();
}

function handleNavigation() {
    state.playerObserver?.disconnect();
    state.playerObserver = null;
    clearTimeout(state.retryTimeout);
    state.retryAttempts = 0;
    state.cachedMoviePlayer = null;
    VideoWatcher.release();
    state.isBuffering = false;

    if (!state.settings.extensionEnabled) { cleanup(); return; }

    // Sync key listeners
    if (state.settings.keyboardShortcutsEnabled) KeyHandler.attach();
    else KeyHandler.detach();

    if (!isWatchPage()) {
        PlayerUI.remove();
        return;
    }

    const delay = state.settings.navigationInitDelay ?? 250;
    setTimeout(() => {
        if (!state.settings.extensionEnabled || window.location.href !== state.lastUrl || !isWatchPage()) {
            if (!isWatchPage() || !state.settings.extensionEnabled) PlayerUI.remove();
            return;
        }

        const v = VideoWatcher.get();
        if (v) state.isBuffering = v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;

        observePlayer();

        if (state.settings.buttonSkipEnabled) tryInject(0);
        else PlayerUI.remove();
    }, delay);
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function cleanup() {
    PlayerUI.remove();
    VideoWatcher.release();
    KeyHandler.detach();
    SkipIndicator.remove();

    clearTimeout(state.retryTimeout);
    clearTimeout(state.indicatorTimeout);
    clearTimeout(state.holdTimeout);
    clearTimeout(state.btnHoldTimeout);
    clearInterval(state.seekInterval);
    clearInterval(state.btnHoldInterval);

    document.removeEventListener('fullscreenchange', onFullscreen);
    window.removeEventListener('resize', debouncedResize);
    window.removeEventListener('yt-navigate-finish', debouncedNav);
    window.removeEventListener('popstate',           debouncedNav);

    debouncedNav.cancel();
    debouncedTryInject.cancel();
    debouncedFullscreen.cancel();
    debouncedResize.cancel();

    state.navObserver?.disconnect();
    state.playerObserver?.disconnect();
    state.navObserver    = null;
    state.playerObserver = null;

    state.buttonsInjected  = false;
    state.retryAttempts    = 0;
    state.isBuffering      = false;
    state.isHolding        = false;
    state.btnIsHolding     = false;
    state.btnHoldActiveBtn = null;
    state.btnHoldDidSeek   = false;
    state.cachedMoviePlayer = null;
    state.lastUrl          = '';
    _lastPBUpdate          = 0;

    // Flush any pending stat writes before clearing the queue
    clearTimeout(_statFlushTimer);
    _statFlushTimer = null;
    if (_statQueue.totalSkips > 0) {
        _flushStats(); // fire-and-forget; best-effort before unload
    }
    _statQueue.totalSecondsSkipped = 0;
    _statQueue.totalSkips          = 0;
    _statQueue.buttonSkips         = 0;
    _statQueue.keyboardSkips       = 0;
}

// ─── Fullscreen / resize ──────────────────────────────────────────────────────

const debouncedFullscreen = debounce(() => {
    if (state.settings.extensionEnabled && isWatchPage() && state.settings.buttonSkipEnabled) tryInject(0);
}, cfg.debounce.fullscreen);

const debouncedResize = debounce(() => {
    if (state.settings.extensionEnabled && isWatchPage() && state.settings.buttonSkipEnabled) tryInject(0);
}, cfg.debounce.resize);

function onFullscreen() { debouncedFullscreen(); }

// ─── Initialize ───────────────────────────────────────────────────────────────

async function init() {
    cleanup();
    try {
        state.settings = await chrome.storage.local.get(null);

        if (!state.settings.extensionEnabled) return;

        state.lastUrl = window.location.href;

        if (state.settings.keyboardShortcutsEnabled) KeyHandler.attach();
        document.addEventListener('fullscreenchange', onFullscreen);
        window.addEventListener('resize', debouncedResize);

        window.addEventListener('yt-navigate-finish', debouncedNav);
        window.addEventListener('popstate',           debouncedNav);

        state.navObserver = new MutationObserver(debouncedNav);
        state.navObserver.observe(document.querySelector('title') ?? document.head, {
            childList: true, characterData: true, subtree: true,
        });

        handleNavigation();
    } catch (e) {
        logError('init', e);
        cleanup();
    }
}

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg.action !== 'updateSettings') return false;

    const old = state.settings;
    state.settings = msg.settings;

    if (!state.settings.extensionEnabled && old.extensionEnabled) {
        cleanup();
        respond({ status: 'disabled' });
        return true;
    }

    if (state.settings.extensionEnabled && !old.extensionEnabled) {
        init();
        respond({ status: 'initialized' });
        return true;
    }

    if (state.settings.extensionEnabled) {
        // Sync key listeners
        if (state.settings.keyboardShortcutsEnabled  && !old.keyboardShortcutsEnabled) KeyHandler.attach();
        if (!state.settings.keyboardShortcutsEnabled && old.keyboardShortcutsEnabled)  KeyHandler.detach();

        // Re-inject buttons if relevant settings changed
        const btnChanged =
            old.buttonSkipEnabled  !== state.settings.buttonSkipEnabled  ||
            old.buttonPosition     !== state.settings.buttonPosition     ||
            old.forwardSkipTime    !== state.settings.forwardSkipTime    ||
            old.backwardSkipTime   !== state.settings.backwardSkipTime;

        if (isWatchPage()) {
            if (btnChanged) { PlayerUI.remove(); tryInject(0); }
        } else {
            PlayerUI.remove();
        }
    }

    respond({ status: 'applied' });
    return true;
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
