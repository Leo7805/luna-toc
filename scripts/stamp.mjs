/**
 * Development Version Stamp Utility
 *
 * This script manages a local development identifier for a Chrome extension.
 *
 * Main commands:
 *
 *     node scripts/stamp.mjs
 *     npm run stamp
 *
 * These commands add or update `version_name` in manifest.json:
 *
 *     "version": "1.10.7",
 *     "version_name": "1.10.7-d3"
 *
 * Clean command:
 *
 *     npm run stamp -- clean
 *
 * The clean command:
 *
 *     1. Removes `version_name` from manifest.json.
 *     2. Deletes `.dev-stamp.json`.
 *
 * The script also configures the project automatically:
 *
 *     1. Adds the `stamp` npm script when missing.
 *     2. Adds the stamp clean command to `preversion` when missing.
 *     3. Adds `.dev-stamp.json` to `.gitignore`.
 *
 * No separate setup command is required.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Resolve the project root based on the location of this script.
 *
 * Expected structure:
 *
 *     project/
 *     ├── package.json
 *     ├── manifest.json
 *     └── scripts/
 *         └── stamp.mjs
 */
const scriptFilePath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptFilePath);
const rootDirectory = path.resolve(scriptDirectory, '..');

const packagePath = path.join(rootDirectory, 'package.json');
const manifestPath = path.join(rootDirectory, 'manifest.json');
const stampStatePath = path.join(rootDirectory, '.dev-stamp.json');
const gitignorePath = path.join(rootDirectory, '.gitignore');

const command = process.argv[2] ?? 'stamp';

const STAMP_SCRIPT_NAME = 'stamp';
const STAMP_SCRIPT_COMMAND = 'node scripts/stamp.mjs';
const CLEAN_COMMAND = 'npm run stamp -- clean';
const STAMP_STATE_ENTRY = '.dev-stamp.json';

/**
 * Prints an error message and terminates the process.
 *
 * @param {string} message Error message to display.
 * @returns {never}
 */
function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/**
 * Reads and parses a JSON file.
 *
 * @param {string} filePath Absolute path to the JSON file.
 * @returns {Record<string, unknown>} Parsed JSON object.
 */
function readJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    fail(`Could not read JSON file "${filePath}": ${error.message}`);
  }
}

/**
 * Writes an object to a JSON file using four-space indentation.
 *
 * @param {string} filePath Absolute path to the JSON file.
 * @param {Record<string, unknown>} value Object to write.
 */
function writeJson(filePath, value) {
  try {
    const content = `${JSON.stringify(value, null, 4)}\n`;
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (error) {
    fail(`Could not write JSON file "${filePath}": ${error.message}`);
  }
}

/**
 * Verifies that package.json and manifest.json exist.
 */
function ensureRequiredFiles() {
  if (!fs.existsSync(packagePath)) {
    fail(`package.json was not found in "${rootDirectory}".`);
  }

  if (!fs.existsSync(manifestPath)) {
    fail(`manifest.json was not found in "${rootDirectory}".`);
  }
}

/**
 * Adds the required npm scripts to package.json when necessary.
 *
 * The resulting scripts are normally:
 *
 *     "stamp": "node scripts/stamp.mjs",
 *     "preversion": "npm run stamp -- clean"
 *
 * If a preversion script already exists, the clean command is added before
 * the existing command instead of replacing it.
 */
function ensurePackageScripts() {
  const packageJson = readJson(packagePath);

  if (
    packageJson.scripts === undefined ||
    packageJson.scripts === null ||
    typeof packageJson.scripts !== 'object' ||
    Array.isArray(packageJson.scripts)
  ) {
    packageJson.scripts = {};
  }

  let changed = false;

  const existingStampScript = packageJson.scripts[STAMP_SCRIPT_NAME];

  if (!existingStampScript) {
    packageJson.scripts[STAMP_SCRIPT_NAME] = STAMP_SCRIPT_COMMAND;
    changed = true;

    console.log(
      `Added npm script: "${STAMP_SCRIPT_NAME}": "${STAMP_SCRIPT_COMMAND}"`
    );
  } else if (existingStampScript !== STAMP_SCRIPT_COMMAND) {
    /*
     * Do not overwrite an existing script with the same name.
     * The existing project configuration may be intentional.
     */
    console.warn(
      `Warning: The existing "${STAMP_SCRIPT_NAME}" script was preserved.`
    );
  }

  const existingPreversion = packageJson.scripts.preversion;

  if (!existingPreversion) {
    packageJson.scripts.preversion = CLEAN_COMMAND;
    changed = true;

    console.log(`Added npm script: "preversion": "${CLEAN_COMMAND}"`);
  } else if (!existingPreversion.includes(CLEAN_COMMAND)) {
    /*
     * Run the clean command first while preserving the existing
     * preversion workflow.
     */
    packageJson.scripts.preversion = `${CLEAN_COMMAND} && ${existingPreversion}`;

    changed = true;

    console.log(
      `Updated npm script: "preversion": ` +
        `"${packageJson.scripts.preversion}"`
    );
  }

  if (changed) {
    writeJson(packagePath, packageJson);
  }
}

/**
 * Adds `.dev-stamp.json` to .gitignore when it is not already present.
 *
 * The file stores local development state and should not be committed.
 */
function ensureGitignoreEntry() {
  let content = '';

  if (fs.existsSync(gitignorePath)) {
    try {
      content = fs.readFileSync(gitignorePath, 'utf8');
    } catch (error) {
      fail(`Could not read .gitignore: ${error.message}`);
    }
  }

  const entries = content.split(/\r?\n/).map((entry) => entry.trim());

  if (entries.includes(STAMP_STATE_ENTRY)) {
    return;
  }

  if (content.length > 0 && !content.endsWith('\n')) {
    content += '\n';
  }

  content += `${STAMP_STATE_ENTRY}\n`;

  try {
    fs.writeFileSync(gitignorePath, content, 'utf8');
  } catch (error) {
    fail(`Could not update .gitignore: ${error.message}`);
  }

  console.log(`Added ${STAMP_STATE_ENTRY} to .gitignore.`);
}

/**
 * Reads and validates the official extension version from manifest.json.
 *
 * @param {Record<string, unknown>} manifest Parsed manifest object.
 * @returns {string} Official extension version.
 */
function getManifestVersion(manifest) {
  const version = manifest.version;

  if (typeof version !== 'string' || version.trim() === '') {
    fail('manifest.json does not contain a valid version.');
  }

  return version.trim();
}

/**
 * Loads the local development stamp state.
 *
 * If the state file does not exist, a new initial state is returned.
 * If the file is invalid, the development counter is reset safely.
 *
 * @param {string} currentVersion Current manifest version.
 * @returns {{version: string, count: number}} Stamp state.
 */
function loadStampState(currentVersion) {
  if (!fs.existsSync(stampStatePath)) {
    return {
      version: currentVersion,
      count: 0,
    };
  }

  try {
    const state = readJson(stampStatePath);

    const isValid =
      typeof state.version === 'string' &&
      Number.isInteger(state.count) &&
      state.count >= 0;

    if (!isValid) {
      throw new Error('Invalid stamp state structure.');
    }

    return {
      version: state.version,
      count: state.count,
    };
  } catch {
    console.warn(
      `Warning: ${STAMP_STATE_ENTRY} is invalid. ` +
        'The development counter will be reset.'
    );

    return {
      version: currentVersion,
      count: 0,
    };
  }
}

/**
 * Creates or increments the development version stamp.
 *
 * Example:
 *
 *     version:      1.10.7
 *     version_name: 1.10.7-d1
 *
 * If the official version changes, the development counter restarts at 1.
 */
function runStamp() {
  const manifest = readJson(manifestPath);
  const currentVersion = getManifestVersion(manifest);
  const state = loadStampState(currentVersion);

  if (state.version === currentVersion) {
    state.count += 1;
  } else {
    /*
     * A new official version starts a new development stamp sequence.
     */
    state.version = currentVersion;
    state.count = 1;
  }

  manifest.version_name = `${currentVersion}-d${state.count}`;

  writeJson(manifestPath, manifest);
  writeJson(stampStatePath, state);

  console.log('');
  console.log(`Updated: ${manifestPath}`);
  console.log(`Version: ${currentVersion}`);
  console.log(`Version name: ${manifest.version_name}`);
}

/**
 * Removes all local development stamp information.
 *
 * This function:
 *
 *     1. Removes `version_name` from manifest.json.
 *     2. Deletes `.dev-stamp.json`.
 *
 * The state file will be created again automatically the next time
 * the stamp command runs.
 */
function runClean() {
  const manifest = readJson(manifestPath);
  let changed = false;

  if (Object.hasOwn(manifest, 'version_name')) {
    const removedVersionName = manifest.version_name;

    delete manifest.version_name;
    writeJson(manifestPath, manifest);

    console.log(`Removed version_name: ${removedVersionName}`);

    changed = true;
  }

  if (fs.existsSync(stampStatePath)) {
    try {
      fs.unlinkSync(stampStatePath);
    } catch (error) {
      fail(`Could not delete ${STAMP_STATE_ENTRY}: ${error.message}`);
    }

    console.log(`Deleted ${STAMP_STATE_ENTRY}.`);
    changed = true;
  }

  if (!changed) {
    console.log('Nothing to clean.');
    return;
  }

  console.log('Development stamp state was cleaned successfully.');
}

/**
 * Configures the project automatically and runs the requested command.
 */
function main() {
  ensureRequiredFiles();

  /*
   * Self-configuration is idempotent:
   * existing correct configuration is left unchanged.
   */
  ensurePackageScripts();
  ensureGitignoreEntry();

  switch (command) {
    case 'stamp':
      runStamp();
      break;

    case 'clean':
      runClean();
      break;

    default:
      fail(`Unknown command "${command}". ` + 'Use "stamp" or "clean".');
  }
}

main();
