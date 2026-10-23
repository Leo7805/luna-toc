/** Fail CI if the release workflows regain automatic publishing or deletion. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const release = readFileSync('.github/workflows/release.yml', 'utf8');

for (const [name, content] of [['CI', ci], ['Release', release]]) {
  assert.doesNotMatch(content, /\bgh\s+release\s+delete\b/i, `${name} must preserve Releases`);
  assert.doesNotMatch(content, /\bgh\s+api\s+--method\s+DELETE\b/i, `${name} must not delete Git refs`);
  assert.doesNotMatch(content, /\bgit\s+push\s+(?:--delete|-d)\b/i, `${name} must not delete branches`);
}

assert.match(ci, /^  push:\s*$/m, 'main pushes must run CI');
assert.match(ci, /^  pull_request:\s*$/m, 'PRs must run CI');
assert.match(ci, /^  workflow_call:\s*$/m, 'manual release must reuse verification');
assert.match(ci, /actions\\/checkout@v7\\b/, 'CI must use a supported checkout runtime');
assert.match(ci, /actions\\/setup-node@v7\\b/, 'CI must use a supported setup-node runtime');
assert.match(ci, /actions\\/upload-artifact@v7\\b/, 'CI must use a supported artifact uploader');
assert.match(release, /actions\\/download-artifact@v8\\b/, 'release must use a supported artifact downloader');
assert.doesNotMatch(ci + release, /actions\\/(?:checkout|setup-node|upload-artifact|download-artifact)@v4\\b/,
  'deprecated Node.js 20-era actions must not be reintroduced');
assert.match(ci, /^permissions:\n  contents: read\s*$/m, 'CI must be read-only');
assert.doesNotMatch(ci, /\bgh\s+release\s+(?:create|upload|edit)\b/i, 'CI must not publish Releases');

assert.match(release, /^  workflow_dispatch:\s*$/m, 'release requires manual dispatch');
assert.doesNotMatch(release, /^  (?:push|pull_request|schedule):/m, 'release may not auto-trigger');
assert.match(release, /confirm_publish:\s*\n(?:.*\n)*?\s+default: false/m, 'approval defaults to false');
assert.match(release, /^permissions:\n  contents: read\s*$/m, 'release global permissions must be read-only');
// Scope safety checks to the actual jobs, not a guard elsewhere.
function jobSource(source, jobName) {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `missing ${jobName} job`);
  let end = start + 1;
  while (end < lines.length && !/^  [a-zA-Z0-9_-]+:\s*$/.test(lines[end])) end += 1;
  return lines.slice(start, end).join('\n');
}

const verifyJob = jobSource(release, 'verify');
const publishJob = jobSource(release, 'publish');
const requiredGate = /^    if: github\.ref == 'refs\/heads\/main' && inputs\.confirm_publish == true$/m;
assert.match(verifyJob, requiredGate, 'release verification must require main and approval');
assert.match(publishJob, requiredGate, 'publishing must independently require main and approval');
assert.match(verifyJob, /^    uses: \.\/\.github\/workflows\/ci\.yml$/m, 'release must reuse CI');
assert.match(verifyJob, /^    permissions:\n      contents: read$/m, 'verification must be read-only');
assert.match(publishJob, /^    needs: verify$/m, 'publishing must depend on passing verification');
assert.match(publishJob, /^    permissions:\n      contents: write$/m, 'only publishing may request write access');
assert.match(release, /gh release create/, 'manual release must still be available');
assert.doesNotMatch(release, /--clobber\b/, 'historical releases must not be overwritten');

console.log('Workflow safety policy: all checks passed.');
