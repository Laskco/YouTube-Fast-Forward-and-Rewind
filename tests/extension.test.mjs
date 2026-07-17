import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = process.cwd();

async function source(path) {
    return readFile(join(root, path), 'utf8');
}

function json(value) {
    return JSON.parse(JSON.stringify(value));
}

function eventTarget() {
    return {
        addListener() {},
        removeListener() {},
    };
}

function nextTask() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function storageArea(initial = {}, delay = 0) {
    const data = { ...initial };
    const wait = () => delay ? new Promise(resolve => setTimeout(resolve, delay)) : Promise.resolve();
    return {
        data,
        async get(keys) {
            await wait();
            const list = typeof keys === 'string' ? [keys] : keys;
            if (!list) return { ...data };
            return Object.fromEntries(list.filter(key => key in data).map(key => [key, data[key]]));
        },
        async set(values) {
            await wait();
            Object.assign(data, values);
        },
        async remove(keys) {
            await wait();
            for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key];
        },
    };
}

async function backgroundContext({ sync = {}, local = {}, delay = 0 } = {}) {
    const syncArea = storageArea(sync, delay);
    const localArea = storageArea(local, delay);
    const context = vm.createContext({
        chrome: {
            runtime: { onInstalled: eventTarget(), onMessage: eventTarget() },
            storage: { sync: syncArea, local: localArea },
            tabs: {
                async create() {},
                async query() { return []; },
                async sendMessage() { return { ok: true }; },
            },
        },
        console: { error() {}, info() {} },
        self: { addEventListener() {} },
        setTimeout,
        clearTimeout,
    });
    vm.runInContext(await source('background/background.js'), context);
    return { context, syncArea, localArea };
}

function contentContext() {
    const document = {
        URL: 'https://www.youtube.com/watch?v=test',
        readyState: 'loading',
        activeElement: null,
        hidden: false,
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
    };
    const window = { addEventListener() {}, removeEventListener() {} };
    return vm.createContext({
        chrome: {
            runtime: { id: 'test', onMessage: eventTarget(), sendMessage: async () => ({ ok: true }) },
            storage: { sync: storageArea(), onChanged: eventTarget() },
        },
        console: { error() {} },
        document,
        window,
        navigator: { userAgent: 'Test Browser' },
        performance,
        URL,
        WeakRef,
        MutationObserver: class { observe() {} disconnect() {} },
        HTMLMediaElement: { HAVE_METADATA: 1, HAVE_FUTURE_DATA: 3 },
        MouseEvent: class {},
        queueMicrotask,
        requestAnimationFrame: callback => callback(),
        clearInterval,
        clearTimeout,
        setInterval,
        setTimeout,
    });
}

function popupContext() {
    const document = {
        readyState: 'loading',
        addEventListener() {},
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
    };
    return vm.createContext({
        console,
        document,
        window: { addEventListener() {}, removeEventListener() {} },
        navigator: {},
        URL,
        Event: class {},
        requestAnimationFrame: callback => callback(),
        clearInterval,
        clearTimeout,
        setInterval,
        setTimeout,
    });
}

test('background validation clamps corrupt settings', async () => {
    const { context } = await backgroundContext();
    context.raw = {
        extensionEnabled: 'yes',
        forwardSkipTime: 999,
        seekInterval: 0,
        buttonPosition: 'middle',
        theme: 'neon',
        keyboardForwardKey: ' ',
        keyboardBackwardKey: ' ',
    };
    const settings = json(vm.runInContext('validate(raw)', context));
    assert.equal(settings.extensionEnabled, true);
    assert.equal(settings.forwardSkipTime, 99);
    assert.equal(settings.seekInterval, 50);
    assert.equal(settings.buttonPosition, 'left');
    assert.equal(settings.theme, 'dark');
    assert.equal(settings.keyboardForwardKey, ' ');
    assert.equal(settings.keyboardBackwardKey, 'ArrowLeft');
});

test('stat updates are serialized across concurrent senders', async () => {
    const { context, localArea } = await backgroundContext({ delay: 2 });
    context.delta = { totalSecondsSkipped: 2.5, totalSkips: 1, buttonSkips: 1 };
    const writes = Array.from({ length: 20 }, () => vm.runInContext(
        'queueStatsWork(() => applyStatsDelta(delta))',
        context,
    ));
    await Promise.all(writes);
    assert.equal(localArea.data.stats_totalSecondsSkipped, 50);
    assert.equal(localArea.data.stats_totalSkips, 20);
    assert.equal(localArea.data.stats_buttonSkips, 20);
    assert.equal(localArea.data.stats_keyboardSkips, 0);
});

test('initialization separates synchronized settings from local statistics', async () => {
    const { context, syncArea, localArea } = await backgroundContext({
        sync: { forwardSkipTime: 25, stats_totalSkips: 7, controlsVisibleDuration: 2 },
        local: { forwardSkipTime: 9, stats_totalSkips: 12, _uiAdvancedOpen: true },
    });
    await vm.runInContext("initSettings('update')", context);
    assert.equal(syncArea.data.forwardSkipTime, 25);
    assert.equal(localArea.data.stats_totalSkips, 12);
    assert.equal(localArea.data._uiAdvancedOpen, true);
    assert.equal('stats_totalSkips' in syncArea.data, false);
    assert.equal('forwardSkipTime' in localArea.data, false);
    assert.equal('controlsVisibleDuration' in syncArea.data, false);
});

test('extension updates preserve valid custom progress delays', async () => {
    for (const progressBarUpdateDelay of [10, 100]) {
        const { context, syncArea } = await backgroundContext({ sync: { progressBarUpdateDelay } });
        await vm.runInContext("initSettings('update')", context);
        assert.equal(syncArea.data.progressBarUpdateDelay, progressBarUpdateDelay);
    }
});

test('statistics reset flushes pending tab batches first and aborts on a failed flush', async () => {
    const { context, localArea } = await backgroundContext({
        local: { stats_totalSecondsSkipped: 20, stats_totalSkips: 2, stats_buttonSkips: 2 },
    });
    context.pendingDelta = { totalSecondsSkipped: 5, totalSkips: 1, keyboardSkips: 1 };
    context.chrome.tabs.query = async () => [{ id: 7 }];
    context.chrome.tabs.sendMessage = async () => {
        await vm.runInContext('queueStatsWork(() => applyStatsDelta(pendingDelta))', context);
        return { ok: true };
    };
    const responsePromise = new Promise(resolve => { context.testRespond = resolve; });
    vm.runInContext('handleResetStats({}, {}, testRespond)', context);
    const response = await responsePromise;
    assert.equal(response.ok, true);
    assert.equal(localArea.data.stats_totalSecondsSkipped, 0);
    assert.equal(localArea.data.stats_totalSkips, 0);
    assert.equal(localArea.data.stats_buttonSkips, 0);
    assert.equal(localArea.data.stats_keyboardSkips, 0);

    const failed = await backgroundContext({ local: { stats_totalSkips: 9 } });
    failed.context.chrome.tabs.query = async () => [{ id: 8 }];
    failed.context.chrome.tabs.sendMessage = async () => ({ ok: false, error: 'flush failed' });
    const failedResponsePromise = new Promise(resolve => { failed.context.testRespond = resolve; });
    vm.runInContext('handleResetStats({}, {}, testRespond)', failed.context);
    const failedResponse = await failedResponsePromise;
    assert.equal(failedResponse.ok, false);
    assert.equal(failed.localArea.data.stats_totalSkips, 9);

    const rejected = await backgroundContext({ local: { stats_totalSkips: 6 } });
    rejected.context.chrome.tabs.query = async () => [{ id: 9 }];
    rejected.context.chrome.tabs.sendMessage = async () => { throw new Error('The message port closed'); };
    const rejectedResponsePromise = new Promise(resolve => { rejected.context.testRespond = resolve; });
    vm.runInContext('handleResetStats({}, {}, testRespond)', rejected.context);
    assert.equal((await rejectedResponsePromise).ok, false);
    assert.equal(rejected.localArea.data.stats_totalSkips, 6);

    const noReceiver = await backgroundContext({ local: { stats_totalSkips: 4 } });
    noReceiver.context.chrome.tabs.query = async () => [{ id: 10 }];
    noReceiver.context.chrome.tabs.sendMessage = async () => {
        throw new Error('Could not establish connection. Receiving end does not exist.');
    };
    const noReceiverResponsePromise = new Promise(resolve => { noReceiver.context.testRespond = resolve; });
    vm.runInContext('handleResetStats({}, {}, testRespond)', noReceiver.context);
    assert.equal((await noReceiverResponsePromise).ok, true);
    assert.equal(noReceiver.localArea.data.stats_totalSkips, 0);
});

test('legacy generic video events are removed from diagnostics', async () => {
    const meaningful = {
        ts: '2026-07-09T23:53:55.245Z',
        context: 'inject buttons',
        message: 'Controls were not found',
    };
    const { context, localArea } = await backgroundContext({
        local: {
            recentErrors: [
                { ts: '2026-07-04T00:10:29.450Z', context: 'video error', message: '[object Event]' },
                meaningful,
            ],
        },
    });
    const errors = json(await vm.runInContext('readRecentErrors()', context));
    assert.deepEqual(errors, [meaningful]);
    assert.deepEqual(localArea.data.recentErrors, [meaningful]);
});

test('content settings and seeks are bounded safely', async () => {
    const context = contentContext();
    vm.runInContext(await source('content/content.js'), context);
    context.raw = { seekInterval: 1, forwardSkipTime: 500, extensionEnabled: false };
    const settings = json(vm.runInContext('normalizeContentSettings(raw)', context));
    assert.equal(settings.seekInterval, 50);
    assert.equal(settings.forwardSkipTime, 99);
    assert.equal(settings.extensionEnabled, false);

    context.testVideo = { currentTime: 98, duration: 100, readyState: 4, paused: false, isConnected: true };
    const actualDelta = vm.runInContext(`
        state.settings = { ...CONTENT_DEFAULTS, ignoreBufferingProtection: true };
        VideoWatcher.get = () => testVideo;
        seek(10);
    `, context);
    assert.equal(actualDelta, 2);
    assert.equal(context.testVideo.currentTime, 100);
});

test('content statistics flush waits for an in-flight batch and persists the next batch', async () => {
    const context = contentContext();
    const sent = [];
    let releaseFirst;
    context.chrome.runtime.sendMessage = message => {
        sent.push(json(message));
        if (sent.length === 1) {
            return new Promise(resolve => { releaseFirst = () => resolve({ ok: true }); });
        }
        return Promise.resolve({ ok: true });
    };
    vm.runInContext(await source('content/content.js'), context);

    const first = vm.runInContext("Stats.track(5, 'button'); Stats.flushNow()", context);
    const second = vm.runInContext("Stats.track(3, 'keyboard'); Stats.flushNow()", context);
    releaseFirst();
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.deepEqual(sent.map(message => message.delta), [
        { totalSecondsSkipped: 5, totalSkips: 1, buttonSkips: 1, keyboardSkips: 0 },
        { totalSecondsSkipped: 3, totalSkips: 1, buttonSkips: 0, keyboardSkips: 1 },
    ]);
});

test('keyboard shortcuts never consume keys outside a video watch page', async () => {
    const context = contentContext();
    vm.runInContext(await source('content/content.js'), context);
    context.document.URL = 'https://www.youtube.com/results?search_query=test';
    context.keyEvent = {
        key: 'ArrowRight',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        target: null,
        prevented: false,
        stopped: false,
        preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; },
    };
    vm.runInContext('state.settings = { ...CONTENT_DEFAULTS }; state.keysAttached = true; handleKey(keyEvent); syncKeyboardAttachment()', context);
    assert.equal(context.keyEvent.prevented, false);
    assert.equal(context.keyEvent.stopped, false);
    assert.equal(vm.runInContext('state.keysAttached', context), false);
});

test('keyboard shortcuts do not override focused interactive controls', async () => {
    const context = contentContext();
    vm.runInContext(await source('content/content.js'), context);
    context.keyEvent = {
        key: ' ',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        target: { closest() { return {}; } },
        prevented: false,
        stopped: false,
        preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; },
    };
    vm.runInContext(`
        state.settings = { ...CONTENT_DEFAULTS, keyboardForwardKey: ' ' };
        handleKey(keyEvent);
    `, context);
    assert.equal(context.keyEvent.prevented, false);
    assert.equal(context.keyEvent.stopped, false);
});

test('same-URL navigation is stable when player buttons are intentionally disabled', async () => {
    const context = contentContext();
    vm.runInContext(await source('content/content.js'), context);
    vm.runInContext(`
        state.settings = { ...CONTENT_DEFAULTS, buttonSkipEnabled: false };
        state.lastUrl = document.URL;
        navigationCalls = 0;
        handleNavigation = () => { navigationCalls += 1; };
        onNavigation();
    `, context);
    assert.equal(vm.runInContext('navigationCalls', context), 0);
    vm.runInContext('state.settings.buttonSkipEnabled = true; onNavigation()', context);
    assert.equal(vm.runInContext('navigationCalls', context), 1);
});

test('button-disabled mode disconnects player mutation observation', async () => {
    const context = contentContext();
    vm.runInContext(await source('content/content.js'), context);
    context.disconnects = 0;
    vm.runInContext(`
        state.settings = { ...CONTENT_DEFAULTS, buttonSkipEnabled: false };
        state.playerObserver = { disconnect() { disconnects += 1; } };
        state.observerInitTimeout = setTimeout(() => {}, 10000);
        syncButtonRuntime();
    `, context);
    assert.equal(context.disconnects, 1);
    assert.equal(vm.runInContext('state.playerObserver', context), null);
    assert.equal(vm.runInContext('state.observerInitTimeout', context), null);
});

test('player cleanup removes only extension-owned legacy containers', async () => {
    const context = contentContext();
    vm.runInContext(await source('content/content.js'), context);
    context.removed = [];
    const container = (name, owned, containsButton) => ({
        hasAttribute(attribute) { return owned && attribute === 'data-ffrw-controls'; },
        querySelector() { return containsButton ? {} : null; },
        remove() { context.removed.push(name); },
    });
    context.ownedContainer = container('owned', true, false);
    context.legacyContainer = container('legacy', false, true);
    context.foreignContainer = container('foreign', false, false);
    context.document.querySelectorAll = selector => selector === '.buttonsContainer'
        ? [context.ownedContainer, context.legacyContainer, context.foreignContainer]
        : [];
    vm.runInContext('PlayerUI.remove()', context);
    assert.deepEqual(context.removed, ['owned', 'legacy']);
});

test('manual button reinjection reports disabled and not-ready states truthfully', async () => {
    const context = contentContext();
    vm.runInContext(await source('content/content.js'), context);
    const buttonDisabled = json(vm.runInContext(`
        state.settings = { ...CONTENT_DEFAULTS, buttonSkipEnabled: false };
        response = null;
        forceInjectButtons(value => { response = value; });
        response;
    `, context));
    assert.deepEqual(buttonDisabled, { status: 'button_disabled' });

    const playerNotReady = json(vm.runInContext(`
        state.settings.buttonSkipEnabled = true;
        tryInject = () => false;
        response = null;
        forceInjectButtons(value => { response = value; });
        response;
    `, context));
    assert.deepEqual(playerNotReady, { status: 'player_not_ready' });
});

test('out-of-order storage reads cannot overwrite newer content settings', async () => {
    const context = contentContext();
    vm.runInContext(await source('content/content.js'), context);
    const resolvers = [];
    context.chrome.storage.sync.get = () => new Promise(resolve => resolvers.push(resolve));
    vm.runInContext(`
        state.settings = { ...CONTENT_DEFAULTS };
        onStorageChanged({ ignoreBufferingProtection: { newValue: false } }, 'sync');
        onStorageChanged({ ignoreBufferingProtection: { newValue: true } }, 'sync');
    `, context);
    assert.equal(resolvers.length, 2);
    resolvers[1]({ ignoreBufferingProtection: true });
    await nextTask();
    resolvers[0]({ ignoreBufferingProtection: false });
    await nextTask();
    assert.equal(vm.runInContext('state.settings.ignoreBufferingProtection', context), true);
});

test('player controls activate with Enter and Space without repeating', async () => {
    const context = contentContext();
    const listeners = {};
    context.testButton = {
        addEventListener(type, listener) { listeners[type] = listener; },
        removeEventListener() {},
        querySelector() { return null; },
    };
    context.seekCalls = [];
    vm.runInContext(await source('content/content.js'), context);
    vm.runInContext(`
        runButtonSeek = delta => { seekCalls.push(delta); return delta; };
        PlayerUI._wireButton(testButton, 10, '.seek', '.text');
    `, context);
    const keyEvent = (key, repeat = false) => ({
        key,
        repeat,
        prevented: false,
        stopped: false,
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; },
    });
    const enter = keyEvent('Enter');
    const space = keyEvent(' ');
    const repeat = keyEvent('Enter', true);
    listeners.keydown(enter);
    listeners.keydown(space);
    listeners.keydown(repeat);
    assert.deepEqual(json(context.seekCalls), [10, 10]);
    assert.equal(enter.prevented, true);
    assert.equal(space.stopped, true);
    assert.equal(repeat.prevented, false);
});

test('popup normalization repairs invalid values and duplicate hotkeys', async () => {
    const context = popupContext();
    vm.runInContext(await source('popup/popup.js'), context);
    context.raw = {
        seekInterval: -5,
        navigationInitDelay: 9000,
        keyboardForwardKey: 'Q',
        keyboardBackwardKey: 'q',
        stats_totalSkips: 2.9,
        theme: 'purple',
    };
    const settings = json(vm.runInContext('normalizePopupSettings(raw)', context));
    assert.equal(settings.seekInterval, 50);
    assert.equal(settings.navigationInitDelay, 5000);
    assert.equal(settings.keyboardForwardKey, 'q');
    assert.equal(settings.keyboardBackwardKey, 'ArrowLeft');
    assert.equal(settings.stats_totalSkips, 2);
    assert.equal(settings.theme, 'dark');
    assert.equal(vm.runInContext('formatTime(3661)', context), '1h 1m 1s');
    context.validTab = { id: 1, url: 'https://www.youtube.com/watch?v=test' };
    context.invalidTab = { id: 2, url: 'https://example.com/' };
    assert.equal(vm.runInContext('isYouTubeTab(validTab)', context), true);
    assert.equal(vm.runInContext('isYouTubeTab(invalidTab)', context), false);
});

test('browser builds contain only supported background declarations', async () => {
    const [sourceManifest, chromeManifest, firefoxManifest, packageJson] = await Promise.all([
        source('manifest.json').then(JSON.parse),
        source('dist/chrome/manifest.json').then(JSON.parse),
        source('dist/firefox/manifest.json').then(JSON.parse),
        source('package.json').then(JSON.parse),
    ]);
    assert.equal(sourceManifest.version, packageJson.version);
    assert.equal(sourceManifest.minimum_chrome_version, '111');
    assert.equal(sourceManifest.browser_specific_settings.gecko.strict_min_version, '140.0');
    assert.equal(sourceManifest.browser_specific_settings.gecko_android.strict_min_version, '142.0');
    assert.equal(chromeManifest.background.service_worker, 'background/background.js');
    assert.equal('scripts' in chromeManifest.background, false);
    assert.equal('browser_specific_settings' in chromeManifest, false);
    assert.deepEqual(firefoxManifest.background.scripts, ['background/background.js']);
    assert.equal('service_worker' in firefoxManifest.background, false);
    assert.deepEqual(
        firefoxManifest.browser_specific_settings.gecko.data_collection_permissions.required,
        ['none'],
    );
    assert.deepEqual(sourceManifest.content_scripts[0].css, [
        'content/css/player.css',
        'content/css/indicator.css',
    ]);
    assert.match(await source('popup/popup.html'), new RegExp(`v${packageJson.version.replaceAll('.', '\\.')}`));
});

test('popup controls retain keyboard access, contextual labels, and scoped disabled semantics', async () => {
    const [html, css, script, readme] = await Promise.all([
        source('popup/popup.html'),
        source('popup/popup.css'),
        source('popup/popup.js'),
        source('README.md'),
    ]);
    assert.match(html, /id="love-heart"[^>]*aria-label="Celebrate"/);
    assert.match(html, /class="setting-label">Re-inject Buttons:/);
    assert.doesNotMatch(css, /\.toggle-switch input\s*\{[^}]*display:\s*none/s);
    assert.match(css, /\.toggle-switch input:focus-visible \+ \.slider/);
    assert.match(script, /function setRegionDisabled\(/);
    assert.doesNotMatch(script, /card\?\.setAttribute\('aria-disabled'/);
    assert.match(script, /btnFwd: 'Forward Button'/);
    assert.match(script, /spinnerAccessibleLabel\(input\)/);
    assert.doesNotMatch(script, /editing \? 'Save Presets' : 'Edit Presets'/);
    assert.doesNotMatch(html, /Action Delay/);
    for (const galleryImage of [
        'Seamless.PNG',
        'SkipTimes.PNG',
        'CustomizablePresets.PNG',
        'FineTune.PNG',
    ]) {
        assert.match(readme, new RegExp(`assets/${galleryImage.replace('.', '\\.')}`));
        await access(join(root, `assets/${galleryImage}`));
    }
});

test('every runtime file referenced by the manifest exists', async () => {
    const manifest = JSON.parse(await source('manifest.json'));
    const paths = new Set([
        ...Object.values(manifest.icons),
        manifest.action.default_popup,
        ...Object.values(manifest.action.default_icon),
        ...manifest.background.scripts,
        manifest.background.service_worker,
        ...manifest.content_scripts.flatMap(entry => [...entry.js, ...entry.css]),
    ]);
    await Promise.all([...paths].map(path => access(join(root, path))));
});

test('player buttons retain the exact pre-refactor YouTube layout contract', async () => {
    const contentScript = await source('content/content.js');
    const playerStyles = await source('content/css/player.css');
    assert.match(contentScript, /container:\s*'buttonsContainer'/);
    assert.match(contentScript, /OWNED_CONTAINER_ATTRIBUTE = 'data-ffrw-controls'/);
    assert.match(contentScript, /document\.createElement\('div'\)/);
    assert.match(contentScript, /'display:flex;width:auto;padding:0 7px;'/);
    assert.match(contentScript, /btn\.setAttribute\('role', 'button'\)/);
    assert.match(contentScript, /btn\.tabIndex = 0/);
    assert.match(contentScript, /this\._addBtnListener\(btn, 'keydown'/);
    assert.match(contentScript, /height:\s*36,\s*\n\s*width:\s*36,/);
    assert.match(contentScript, /'margin:auto;padding:0;transform:rotate\(180deg\);'/);
    assert.match(contentScript, /rwdBtn\.classList\.add\('ytp-prev-button'/);
    assert.match(contentScript, /fwdBtn\.classList\.add\('ytp-next-button', 'ytp-playlist-ui'/);
    assert.match(contentScript, /'display:flex;padding:0;margin:auto 7px auto -1px;'/);
    assert.match(contentScript, /rightBar\.prepend\(fwdBtn\);\s*rightBar\.prepend\(rwdBtn\);/);
    assert.doesNotMatch(playerStyles, /\.ytp-button/);
    assert.match(playerStyles, /#movie_player\.ytp-fullscreen \.buttonsContainer/);
});
