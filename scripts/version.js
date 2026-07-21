#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const packagePath = path.join(projectRoot, 'package.json');
const manifestPath = path.join(projectRoot, 'manifest.json');

/**
 * Exits with an error message.
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`Version update failed: ${message}`);
  process.exit(1);
}

const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const manifestSource = fs.readFileSync(manifestPath, 'utf8');
const versionMatch = manifestSource.match(/"version"\s*:\s*"([^"]+)"/);

if (!versionMatch) {
  fail('manifest.json does not contain a version field');
}

const currentVersion = versionMatch[1];
const nextVersion = packageData.version;

if (!/^\d+\.\d+\.\d+$/.test(nextVersion)) {
  fail(`package version "${nextVersion}" must use major.minor.patch`);
}

const nextManifestSource = manifestSource.replace(
  versionMatch[0],
  versionMatch[0].replace(currentVersion, nextVersion)
);

fs.writeFileSync(manifestPath, nextManifestSource);
console.log(`Updated manifest version: ${currentVersion} -> ${nextVersion}`);
