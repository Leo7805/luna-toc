/** Install the isolated Playwright E2E runner without rewriting project node_modules. */
import {execFileSync} from 'node:child_process';
import {mkdtempSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const isolated=mkdtempSync(join(tmpdir(),'luna-playwright-'));
const version='1.64.1';

/** Keep npm's dependency resolution out of the application's lockfile tree. */
function run(command,args){
  execFileSync(command,args,{stdio:'inherit',env:{...process.env,npm_config_package_lock:'false'}});
}
run('npm',['install','--prefix',isolated,'--no-save','--package-lock=false','--ignore-scripts',
  'playwright@'+version]);
const playwrightPath=join(isolated,'node_modules','playwright');
if(!existsSync(playwrightPath))throw new Error('isolated Playwright installation missing');
const projectLink=resolve('node_modules/playwright');
if(existsSync(projectLink))throw new Error('playwright unexpectedly exists in application dependencies');
symlinkSync(playwrightPath,projectLink,'dir');
run(process.execPath,[join(playwrightPath,'cli.js'),'install','--with-deps','chromium']);
