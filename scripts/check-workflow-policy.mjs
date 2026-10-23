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
assert.match(ci, /^permissions:\n  contents: read\s*$/m, 'CI must be read-only');
assert.doesNotMatch(ci, /\bgh\s+release\s+(?:create|upload|edit)\b/i, 'CI must not publish Releases');

assert.match(release, /^  workflow_dispatch:\s*$/m, 'release requires manual dispatch');
assert.doesNotMatch(release, /^  (?:push|pull_request|schedule):/m, 'release may not auto-trigger');
assert.match(release, /confirm_publish:\s*\n(?:.*\n)*?\s+default: false/m, 'approval defaults to false');
assert.match(release, /^permissions:\n  contents: read\s*$/m, 'release global permissions must be read-only');
assert.match(release, /^    if: github\.ref == 'refs\/heads\/main' && inputs\.confirm_publish == true$/m, 'release must require main and approval');
assert.match(release, /^    needs: verify$/m, 'publishing must depend on passing verification');
assert.match(release, /^      contents: write$/m, 'only the publishing job may request write access');
assert.match(release, /gh release create/, 'manual release must still be available');
assert.doesNotMatch(release, /--clobber\b/, 'historical releases must not be overwritten');

console.log('Workflow safety policy: all checks passed.');
