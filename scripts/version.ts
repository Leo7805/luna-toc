#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const packagePath = path.join(projectRoot, 'package.json');
const manifestPath = path.join(projectRoot, 'manifest.json');

interface PackageData {
  version: string;
}

/**
 * Exits with an error message.
 * @param {string} message
 * @returns {never}
 */
function fail(message: string): never {
  console.error(`Version update failed: ${message}`);
  process.exit(1);
}

const packageData = JSON.parse(
  fs.readFileSync(packagePath, 'utf8')
) as PackageData;
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
