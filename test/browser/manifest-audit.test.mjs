/** Regression tests for extension privilege and license policies. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {checkManifest,inventoryLicenses,EXPECTED_HOSTS} from '../../scripts/audit-extension.mjs';

const safe={manifest_version:3,permissions:['storage'],background:{type:'module'},
  content_scripts:[{world:'MAIN',matches:EXPECTED_HOSTS},{world:'ISOLATED',matches:EXPECTED_HOSTS}]};

test('MV3 host and permission baseline is accepted',()=>{
  assert.equal(checkManifest(safe).permissions[0],'storage');
});
test('permission, injected host and external messaging expansion is blocked',()=>{
  assert.throws(()=>checkManifest({...safe,permissions:['storage','tabs']}));
  assert.throws(()=>checkManifest({...safe,host_permissions:['<all_urls>']}));
  assert.throws(()=>checkManifest({...safe,externally_connectable:{matches:['*://*/*']}}));
  assert.throws(()=>checkManifest({...safe,content_scripts:[{world:'MAIN',matches:['https://example.com/*']},safe.content_scripts[1]]}));
});
test('unknown and copyleft licenses stay visible',()=>{
  const x=inventoryLicenses({lockfileVersion:3,packages:{
    '':{},'node_modules/mit':{version:'1',license:'MIT',integrity:'sha512-test'},
    'node_modules/unknown':{version:'2',integrity:'sha512-test'},
    'node_modules/gpl':{version:'3',license:'GPL-3.0',integrity:'sha512-test'}
  }});
  assert.equal(x.total,3);
  assert.equal(x.requiresReview.length,2);
  assert.equal(x.missingIntegrity.length,0);
});

test('shadcn CLI can be removed only when its pinned CSS is locally available',()=>{
  const source=readFileSync('src/styles/tailwind.css','utf8');
  const vendor=readFileSync('src/styles/shadcn-utilities.css','utf8');
  const packageJson=JSON.parse(readFileSync('package.json','utf8'));
  assert.match(source,/\@import ['"]\.\/shadcn-utilities\.css['"]/);
  assert.doesNotMatch(source,/shadcn\/tailwind\.css/);
  assert.match(vendor,/@custom-variant data-open/);
  assert.match(vendor,/@utility no-scrollbar/);
  assert.match(vendor,/@utility shimmer/);
  assert.equal(packageJson.dependencies?.shadcn,undefined);
});
