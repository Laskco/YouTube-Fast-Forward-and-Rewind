const readonlyGlobals = names => Object.fromEntries(names.map(name => [name, 'readonly']));

const commonGlobals = readonlyGlobals([
    'AbortController', 'Array', 'Boolean', 'Date', 'Error', 'Infinity', 'JSON', 'Map', 'Math',
    'NaN', 'Number', 'Object', 'Promise', 'Reflect', 'RegExp', 'Set', 'String', 'Symbol',
    'URL', 'WeakMap', 'WeakRef', 'WeakSet', 'clearInterval', 'clearTimeout', 'console',
    'performance', 'process', 'queueMicrotask', 'setInterval', 'setTimeout', 'structuredClone',
]);

const browserGlobals = readonlyGlobals([
    'CustomEvent', 'Element', 'Event', 'HTMLButtonElement', 'HTMLInputElement',
    'HTMLMediaElement', 'HTMLTextAreaElement', 'KeyboardEvent', 'MouseEvent',
    'MutationObserver', 'PointerEvent', 'SVGElement', 'cancelAnimationFrame', 'chrome',
    'document', 'location', 'navigator', 'performance', 'requestAnimationFrame', 'self', 'window',
]);

export default [
    {
        ignores: ['dist/**', 'node_modules/**', '.fallow/**'],
    },
    {
        files: ['background/**/*.js', 'content/**/*.js', 'popup/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: { ...commonGlobals, ...browserGlobals },
        },
        rules: {
            eqeqeq: ['error', 'always'],
            'no-constant-condition': 'error',
            'no-dupe-keys': 'error',
            'no-implied-eval': 'error',
            'no-new-wrappers': 'error',
            'no-prototype-builtins': 'error',
            'no-redeclare': 'error',
            'no-throw-literal': 'error',
            'no-undef': 'error',
            'no-unreachable': 'error',
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'all' }],
            'no-useless-catch': 'error',
            'no-var': 'error',
            'prefer-const': 'error'
        },
    },
    {
        files: ['scripts/**/*.mjs', 'tests/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: commonGlobals,
        },
        rules: {
            eqeqeq: ['error', 'always'],
            'no-constant-condition': 'error',
            'no-dupe-keys': 'error',
            'no-implied-eval': 'error',
            'no-prototype-builtins': 'error',
            'no-redeclare': 'error',
            'no-throw-literal': 'error',
            'no-undef': 'error',
            'no-unreachable': 'error',
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'all' }],
            'no-useless-catch': 'error',
            'no-var': 'error',
            'prefer-const': 'error'
        },
    },
];
