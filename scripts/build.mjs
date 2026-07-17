import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = join(root, 'dist');
const runtimeEntries = ['assets/FFRWIcons', 'background', 'content', 'popup'];
const sourceManifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));

function chromeManifest() {
    const manifest = structuredClone(sourceManifest);
    delete manifest.background.scripts;
    delete manifest.browser_specific_settings;
    return manifest;
}

function firefoxManifest() {
    const manifest = structuredClone(sourceManifest);
    delete manifest.background.service_worker;
    delete manifest.minimum_chrome_version;
    return manifest;
}

async function writeBuild(browser, manifest) {
    const target = join(distRoot, browser);
    await mkdir(target, { recursive: true });
    await Promise.all(runtimeEntries.map(async entry => {
        const destination = join(target, entry);
        await mkdir(dirname(destination), { recursive: true });
        await cp(join(root, entry), destination, { recursive: true });
    }));
    await writeFile(join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

await rm(distRoot, { recursive: true, force: true });
await Promise.all([
    writeBuild('chrome', chromeManifest()),
    writeBuild('firefox', firefoxManifest()),
]);

console.log(`Built Chrome and Firefox extension folders for v${sourceManifest.version}.`);
