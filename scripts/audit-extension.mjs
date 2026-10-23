/** Enforce extension privilege limits and inventory locked third-party licenses. */
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const EXPECTED_HOSTS=['https://chatgpt.com/*','https://chat.openai.com/*'];

/** Reject unexpectedly expanded origin, API or extension exposure privileges. */
export function checkManifest(m){
  assert.equal(m.manifest_version,3,'MV3 required');
  assert.deepEqual(m.permissions??[],['storage'],'new permissions require review');
  assert.deepEqual(m.host_permissions??[],[],'host permissions require review');
  assert.equal(m.externally_connectable,undefined,'external messaging requires review');
  assert.equal(m.content_security_policy,undefined,'custom CSP requires review');
  // CRXJS may generate scoped web-accessible chunks for MAIN-world injection.
  for(const entry of m.web_accessible_resources??[]){
    assert.deepEqual([...entry.matches].sort(),[...EXPECTED_HOSTS].sort(),
      'web-accessible resources exposed outside ChatGPT');
    assert.ok(Array.isArray(entry.resources)&&entry.resources.length>0);
    for(const file of entry.resources){
      assert.match(file,/^[a-zA-Z0-9_./-]+$/,'invalid resource name');
      assert.ok(!file.split('/').includes('..')&&!file.startsWith('/'),
        'absolute or traversing resource path');
    }
  }
  assert.equal(m.background?.type,'module');
  assert.equal(m.content_scripts?.length,2,'MAIN and ISOLATED scripts expected');
  assert.deepEqual(m.content_scripts.map(s=>s.world).sort(),['ISOLATED','MAIN']);
  for(const s of m.content_scripts){
    assert.deepEqual([...s.matches].sort(),[...EXPECTED_HOSTS].sort(),'host scope changed');
    assert.equal(s.all_frames??false,false,'all-frames injection requires review');
  }
  return {permissions:m.permissions,hosts:EXPECTED_HOSTS};
}

/** Surface missing and reciprocal/copyleft licenses; no silent legal approvals. */
export function inventoryLicenses(lock){
  assert.equal(lock.lockfileVersion,3,'npm lockfile v3 required');
  const packages=Object.entries(lock.packages??{}).filter(([p])=>p.startsWith('node_modules/'))
    .map(([p,v])=>({
      name:p.slice('node_modules/'.length),version:v.version??'unknown',
      license:typeof v.license==='string'?v.license:'UNKNOWN',
      scope:v.dev?'dev':'runtime-or-build',integrity:typeof v.integrity==='string',
      review:!v.license||/\b(?:AGPL|GPL|LGPL|SSPL|BUSL|UNLICENSED|SEE LICENSE)\b/i.test(v.license)
    })).sort((a,b)=>a.name.localeCompare(b.name));
  assert.ok(packages.length>0,'lockfile has no dependencies');
  return {total:packages.length,
    requiresReview:packages.filter(p=>p.review),
    missingIntegrity:packages.filter(p=>!p.integrity),packages};
}

/** Verify both source and packaged manifests and preserve a JSON audit trail. */
export function audit(){
  const source=checkManifest(JSON.parse(readFileSync('manifest.json','utf8')));
  const built=checkManifest(JSON.parse(readFileSync('dist/manifest.json','utf8')));
  const licenses=inventoryLicenses(JSON.parse(readFileSync('package-lock.json','utf8')));
  const path=resolve('artifacts/security/extension-audit.json');
  mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,JSON.stringify({source,built,...licenses},null,2)+'\n');
  console.log('License inventory:',licenses.total,'packages;',licenses.requiresReview.length,
    'requiring review;',licenses.missingIntegrity.length,'without integrity.');
  assert.equal(licenses.requiresReview.length,0,'license exceptions require review');
  assert.equal(licenses.missingIntegrity.length,0,'package integrity metadata absent');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))audit();
