/**
 * Development Version Stamp Utility
 *
 * This utility manages local development version names for a Chrome
 * Extension without changing the official semantic version.
 *
 * Development example:
 *
 *     "version": "1.10.7",
 *     "version_name": "1.10.7-d3"
 *
 * Supported commands:
 *
 *     node scripts/stamp.mjs
 *     npm run stamp
 *     npm run stamp -- clean
 *
 * The stamp command:
 *
 *     1. Creates or increments the local development counter.
 *     2. Adds or updates `version_name` in manifest.json.
 *     3. Creates `.dev-stamp.json` when necessary.
 *
 * The clean command:
 *
 *     1. Removes `version_name` from manifest.json.
 *     2. Deletes `.dev-stamp.json`.
 *
 * The script automatically configures:
 *
 *     "stamp": "node scripts/stamp.mjs"
 *     "preversion": "npm run stamp -- clean"
 *
 * The script deliberately does not configure `prebuild`.
 * Development stamping and building must remain separate so that a final
 * release build does not accidentally restore `version_name`.
 *
 * Expected project structure:
 *
 *     project/
 *     ├── package.json
 *     ├── manifest.json
 *     ├── .gitignore
 *     └── scripts/
 *         └── stamp.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* -------------------------------------------------------------------------- */
/* Paths                                                                      */
/* -------------------------------------------------------------------------- */

const scriptFilePath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptFilePath);
const rootDirectory = path.resolve(scriptDirectory, '..');

const packagePath = path.join(rootDirectory, 'package.json');
const manifestPath = path.join(rootDirectory, 'manifest.json');
const gitignorePath = path.join(rootDirectory, '.gitignore');
const stampStatePath = path.join(rootDirectory, '.dev-stamp.json');

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const COMMAND_STAMP = 'stamp';
const COMMAND_CLEAN = 'clean';

const STAMP_STATE_FILENAME = '.dev-stamp.json';

const STAMP_SCRIPT_NAME = 'stamp';
const STAMP_SCRIPT_COMMAND = 'node scripts/stamp.mjs';

const PREVERSION_SCRIPT_NAME = 'preversion';
const PREVERSION_CLEAN_COMMAND = 'npm run stamp -- clean';

const command = process.argv[2] ?? COMMAND_STAMP;

/* -------------------------------------------------------------------------- */
/* General Utilities                                                          */
/* -------------------------------------------------------------------------- */

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
 * Converts an unknown error value into a readable message.
 *
 * @param {unknown} error Caught error value.
 * @returns {string} Readable error message.
 */
function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads and parses a JSON file.
 *
 * @param {string} filePath Absolute path to the JSON file.
 * @returns {Record<string, any>} Parsed JSON object.
 */
function readJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    fail(`Could not read JSON file "${filePath}": ` + getErrorMessage(error));
  }
}

/**
 * Writes an object to a JSON file using four-space indentation.
 *
 * @param {string} filePath Absolute path to the JSON file.
 * @param {Record<string, any>} value Object to write.
 */
function writeJson(filePath, value) {
  try {
    const content = `${JSON.stringify(value, null, 4)}\n`;
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (error) {
    fail(`Could not write JSON file "${filePath}": ` + getErrorMessage(error));
  }
}

/**
 * Checks whether an npm lifecycle script already contains a command.
 *
 * Commands joined with `&&` are compared separately so that the same command
 * is not added repeatedly.
 *
 * @param {string} script Existing npm script.
 * @param {string} requiredCommand Command to find.
 * @returns {boolean} True when the command is already present.
 */
function containsCommand(script, requiredCommand) {
  return script
    .split('&&')
    .map((part) => part.trim())
    .includes(requiredCommand);
}

/* -------------------------------------------------------------------------- */
/* Project Validation                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Verifies that the required project files exist.
 */
function ensureRequiredFiles() {
  if (!fs.existsSync(packagePath)) {
    fail(`package.json was not found in "${rootDirectory}".`);
  }

  if (!fs.existsSync(manifestPath)) {
    fail(`manifest.json was not found in "${rootDirectory}".`);
  }
}

/* -------------------------------------------------------------------------- */
/* package.json Configuration                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Ensures that package.json contains a valid scripts object.
 *
 * @param {Record<string, any>} packageJson Parsed package.json.
 * @returns {Record<string, string>} npm scripts object.
 */
function ensureScriptsObject(packageJson) {
  const scripts = packageJson.scripts;

  if (
    scripts === undefined ||
    scripts === null ||
    typeof scripts !== 'object' ||
    Array.isArray(scripts)
  ) {
    packageJson.scripts = {};
  }

  return packageJson.scripts;
}

/**
 * Ensures that the `stamp` npm script exists.
 *
 * An existing command with the same name is preserved because it may contain
 * intentional project-specific behaviour.
 *
 * @param {Record<string, string>} scripts npm scripts object.
 * @returns {boolean} True when package.json was modified.
 */
function ensureStampScript(scripts) {
  const existingScript = scripts[STAMP_SCRIPT_NAME];

  if (!existingScript) {
    scripts[STAMP_SCRIPT_NAME] = STAMP_SCRIPT_COMMAND;

    console.log(
      `Added npm script: "${STAMP_SCRIPT_NAME}": ` + `"${STAMP_SCRIPT_COMMAND}"`
    );

    return true;
  }

  if (existingScript !== STAMP_SCRIPT_COMMAND) {
    console.warn(
      `Warning: Existing "${STAMP_SCRIPT_NAME}" script was preserved: ` +
        `"${existingScript}"`
    );
  }

  return false;
}

/**
 * Ensures that the clean command runs before `npm version`.
 *
 * If `preversion` already contains other commands, the clean command is
 * prepended instead of replacing the existing workflow.
 *
 * @param {Record<string, string>} scripts npm scripts object.
 * @returns {boolean} True when package.json was modified.
 */
function ensurePreversionScript(scripts) {
  const existingScript = scripts[PREVERSION_SCRIPT_NAME];

  if (!existingScript) {
    scripts[PREVERSION_SCRIPT_NAME] = PREVERSION_CLEAN_COMMAND;

    console.log(
      `Added npm script: "${PREVERSION_SCRIPT_NAME}": ` +
        `"${PREVERSION_CLEAN_COMMAND}"`
    );

    return true;
  }

  if (containsCommand(existingScript, PREVERSION_CLEAN_COMMAND)) {
    return false;
  }

  scripts[PREVERSION_SCRIPT_NAME] =
    `${PREVERSION_CLEAN_COMMAND} && ${existingScript}`;

  console.log(
    `Updated npm script: "${PREVERSION_SCRIPT_NAME}": ` +
      `"${scripts[PREVERSION_SCRIPT_NAME]}"`
  );

  return true;
}

/**
 * Adds the required stamp-related scripts to package.json.
 *
 * This function intentionally configures only:
 *
 *     "stamp": "node scripts/stamp.mjs"
 *     "preversion": "npm run stamp -- clean"
 *
 * It does not add a `prebuild` script.
 */
function ensurePackageScripts() {
  const packageJson = readJson(packagePath);
  const scripts = ensureScriptsObject(packageJson);

  const stampChanged = ensureStampScript(scripts);
  const preversionChanged = ensurePreversionScript(scripts);

  if (stampChanged || preversionChanged) {
    writeJson(packagePath, packageJson);
  }
}

/* -------------------------------------------------------------------------- */
/* .gitignore Configuration                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Adds `.dev-stamp.json` to .gitignore when it is not already present.
 *
 * The state file contains local development information and should not be
 * committed to Git.
 */
function ensureGitignoreEntry() {
  let content = '';

  if (fs.existsSync(gitignorePath)) {
    try {
      content = fs.readFileSync(gitignorePath, 'utf8');
    } catch (error) {
      fail(`Could not read .gitignore: ${getErrorMessage(error)}`);
    }
  }

  const entries = content.split(/\r?\n/).map((entry) => entry.trim());

  if (entries.includes(STAMP_STATE_FILENAME)) {
    return;
  }

  if (content.length > 0 && !content.endsWith('\n')) {
    content += '\n';
  }

  content += `${STAMP_STATE_FILENAME}\n`;

  try {
    fs.writeFileSync(gitignorePath, content, 'utf8');
  } catch (error) {
    fail(`Could not update .gitignore: ${getErrorMessage(error)}`);
  }

  console.log(`Added ${STAMP_STATE_FILENAME} to .gitignore.`);
}

/* -------------------------------------------------------------------------- */
/* Manifest Version                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Reads and validates the official extension version from manifest.json.
 *
 * @param {Record<string, any>} manifest Parsed manifest object.
 * @returns {string} Official extension version.
 */
function getManifestVersion(manifest) {
  const version = manifest.version;

  if (typeof version !== 'string' || version.trim() === '') {
    fail('manifest.json does not contain a valid version.');
  }

  return version.trim();
}

/* -------------------------------------------------------------------------- */
/* Stamp State                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Creates an initial development stamp state.
 *
 * @param {string} version Current official extension version.
 * @returns {{version: string, count: number}} Initial state.
 */
function createInitialState(version) {
  return {
    version,
    count: 0,
  };
}

/**
 * Checks whether a parsed stamp state has the expected structure.
 *
 * @param {Record<string, any>} state Parsed state object.
 * @returns {boolean} True when the state is valid.
 */
function isValidStampState(state) {
  return (
    typeof state.version === 'string' &&
    Number.isInteger(state.count) &&
    state.count >= 0
  );
}

/**
 * Loads the local development stamp state.
 *
 * If the state file is missing or invalid, a new state is returned.
 *
 * @param {string} currentVersion Current official extension version.
 * @returns {{version: string, count: number}} Stamp state.
 */
function loadStampState(currentVersion) {
  if (!fs.existsSync(stampStatePath)) {
    return createInitialState(currentVersion);
  }

  try {
    const state = readJson(stampStatePath);

    if (!isValidStampState(state)) {
      throw new Error('Invalid stamp state structure.');
    }

    return {
      version: state.version,
      count: state.count,
    };
  } catch {
    console.warn(
      `Warning: ${STAMP_STATE_FILENAME} is invalid. ` +
        'The development counter will be reset.'
    );

    return createInitialState(currentVersion);
  }
}

/**
 * Calculates the next development stamp state.
 *
 * The counter increments when the official version is unchanged.
 * It restarts at 1 when the official version has changed.
 *
 * @param {{version: string, count: number}} currentState Current state.
 * @param {string} currentVersion Current official version.
 * @returns {{version: string, count: number}} Next state.
 */
function getNextStampState(currentState, currentVersion) {
  if (currentState.version !== currentVersion) {
    return {
      version: currentVersion,
      count: 1,
    };
  }

  return {
    version: currentVersion,
    count: currentState.count + 1,
  };
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Creates or increments the local development version name.
 *
 * Example:
 *
 *     "version": "1.10.7",
 *     "version_name": "1.10.7-d4"
 */
function runStamp() {
  const manifest = readJson(manifestPath);
  const currentVersion = getManifestVersion(manifest);

  const currentState = loadStampState(currentVersion);
  const nextState = getNextStampState(currentState, currentVersion);

  const versionName = `${currentVersion}-d${nextState.count}`;

  manifest.version_name = versionName;

  writeJson(manifestPath, manifest);
  writeJson(stampStatePath, nextState);

  console.log('');
  console.log(`Updated: ${manifestPath}`);
  console.log(`Version: ${currentVersion}`);
  console.log(`Version name: ${versionName}`);
}

/**
 * Removes all local development version information.
 *
 * This command:
 *
 *     1. Removes `version_name` from manifest.json.
 *     2. Deletes `.dev-stamp.json`.
 *
 * The state file will be recreated the next time `npm run stamp` is executed.
 * Running `npm run build` alone will not recreate the development state.
 */
function runClean() {
  const manifest = readJson(manifestPath);

  let manifestChanged = false;
  let stateDeleted = false;

  if (Object.hasOwn(manifest, 'version_name')) {
    const removedVersionName = manifest.version_name;

    delete manifest.version_name;
    writeJson(manifestPath, manifest);

    manifestChanged = true;

    console.log(`Removed version_name: ${removedVersionName}`);
  }

  if (fs.existsSync(stampStatePath)) {
    try {
      fs.unlinkSync(stampStatePath);
    } catch (error) {
      fail(
        `Could not delete ${STAMP_STATE_FILENAME}: ` + getErrorMessage(error)
      );
    }

    stateDeleted = true;

    console.log(`Deleted ${STAMP_STATE_FILENAME}.`);
  }

  if (!manifestChanged && !stateDeleted) {
    console.log('Nothing to clean.');
    return;
  }

  console.log('Development stamp state was cleaned successfully.');
}

/* -------------------------------------------------------------------------- */
/* Entry Point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Configures the project and runs the requested command.
 */
function main() {
  ensureRequiredFiles();

  /*
   * These operations are idempotent:
   * missing configuration is added, while existing valid configuration is
   * left unchanged.
   */
  ensurePackageScripts();
  ensureGitignoreEntry();

  switch (command) {
    case COMMAND_STAMP:
      runStamp();
      break;

    case COMMAND_CLEAN:
      runClean();
      break;

    default:
      fail(
        `Unknown command "${command}". ` +
          `Use "${COMMAND_STAMP}" or "${COMMAND_CLEAN}".`
      );
  }
}

main();
