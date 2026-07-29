// fallow-ignore-file security-sink -- all paths and process arguments are local constants
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const firefoxManifestPath = path.join(projectRoot, 'dist', 'firefox', 'manifest.json');
const linterPath = path.join(projectRoot, 'node_modules', 'addons-linter', 'bin', 'addons-linter');

const buildResult = spawnSync(process.execPath, ['scripts/build.mjs'], {
  cwd: projectRoot,
  stdio: 'inherit',
});

if (buildResult.error) {
  throw buildResult.error;
}

if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

const lintResult = spawnSync(
  process.execPath,
  [linterPath, 'dist/firefox', '--output', 'json', '--boring'],
  {
    cwd: projectRoot,
    encoding: 'utf8',
  },
);

if (lintResult.error) {
  throw lintResult.error;
}

if (!lintResult.stdout) {
  process.stderr.write(lintResult.stderr);
  process.exit(lintResult.status ?? 1);
}

const report = JSON.parse(lintResult.stdout);
const firefoxManifest = JSON.parse(readFileSync(firefoxManifestPath, 'utf8'));
const androidIsOptedOut = !Object.hasOwn(
  firefoxManifest.browser_specific_settings,
  'gecko_android',
);

const ignoredWarnings = report.warnings.filter(
  (warning) =>
    androidIsOptedOut &&
    warning.code === 'KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION' &&
    warning.description.includes(
      'browser_specific_settings.gecko.data_collection_permissions',
    ),
);
const ignoredWarningSet = new Set(ignoredWarnings);
const unexpectedWarnings = report.warnings.filter(
  (warning) => !ignoredWarningSet.has(warning),
);

if (report.errors.length > 0 || unexpectedWarnings.length > 0) {
  process.stderr.write(
    `${JSON.stringify(
      {
        errors: report.errors,
        warnings: unexpectedWarnings,
        notices: report.notices,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(1);
}

console.log(
  `Firefox extension validation passed with ${report.errors.length} errors, ` +
    `${unexpectedWarnings.length} warnings, and ${report.notices.length} notices.`,
);

if (ignoredWarnings.length > 0) {
  console.log(
    'Ignored Mozilla validator Android compatibility warning because ' +
      'gecko_android is intentionally absent.',
  );
}
