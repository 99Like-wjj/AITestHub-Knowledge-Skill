import { readFile, mkdtemp, rm, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, basename, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { verifyPackage } from './package-lib.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  release = JSON.parse(
    await readFile(resolve(root, '.build/latest-package.json'), 'utf8'),
  );
const bundle = resolve(
  dirname(release.directory),
  'archive-readback/ath-project-knowledge',
);
const privateRoot = await mkdtemp(
  join(tmpdir(), 'ath-knowledge-package-smoke-'),
);
function run(script) {
  return new Promise((yes, no) => {
    const child = spawn(process.execPath, script, {
      cwd: privateRoot,
      windowsHide: true,
      shell: false,
      env: { SystemRoot: process.env.SystemRoot ?? '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      error = '';
    child.stdout.on('data', (b) => {
      out += String(b);
    });
    child.stderr.on('data', (b) => {
      error += String(b);
    });
    child.once('error', no);
    child.once('exit', (code) =>
      code === 0
        ? yes(JSON.parse(out))
        : no(
            Error(
              'Packaged runtime rejected with exit ' +
                code +
                '; ' +
                error.slice(0, 100),
            ),
          ),
    );
  });
}
try {
  const helper = resolve(bundle, 'scripts/work.mjs'),
    projectId = randomUUID(),
    spaceId = randomUUID();
  const created = await run([
    helper,
    'create',
    '--workspace',
    privateRoot,
    '--project-id',
    projectId,
    '--space-id',
    spaceId,
  ]);
  assert.equal(created.ok, true);
  assert.equal(created.data.projectId, projectId);
  const summary = await run([
    helper,
    'summary',
    '--workspace',
    privateRoot,
    '--work-id',
    created.data.workId,
  ]);
  assert.equal(summary.data.digest, created.data.digest);
  const entry = pathToFileURL(resolve(bundle, 'runtime/src/platform.js')).href,
    anchor = pathToFileURL(resolve(bundle, 'runtime/src/index.js')).href;
  const code = `import {createPlatformAdapter} from ${JSON.stringify(entry)};import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(anchor)});const resolved=require.resolve('zod');if(!resolved.startsWith(${JSON.stringify(resolve(bundle, 'runtime/node_modules/zod'))}))throw Error('External dependency leakage');let calls=0;const workspace={async readText(){return null},async writeTextAtomic(){},async withExclusive(k,f){return f()}};const tools={async callTool(name,args){calls++;if(name!=='ath_knowledge'||args.op!=='list-index')throw Error('Wrong tool');return {structuredContent:{data:{entries:[],hasMore:false,nextCursor:null,searchMethod:'case-insensitive-substring'},meta:{requestId:'synthetic'}}}}};const results={read(raw){return raw.structuredContent.data},assertSafe(){}};const {workflow}=createPlatformAdapter({workspace,tools,results});const page=await workflow.listIndex(${JSON.stringify(projectId)},{limit:1});if(page.data.entries.length!==0||calls!==1)throw Error('Unexpected tool count');console.log(JSON.stringify({bundledDependency:true,syntheticToolCalls:calls,platformRequests:0,modelRequests:0}));`;
  const adapted = await run(['--input-type=module', '-e', code]);
  const tampered = resolve(privateRoot, 'tampered-copy');
  await cp(bundle, tampered, { recursive: true });
  const helperBytes = await readFile(resolve(tampered, 'scripts/work.mjs'));
  await writeFile(
    resolve(tampered, 'scripts/work.mjs'),
    Buffer.concat([
      helperBytes,
      Buffer.from('\n// synthetic changed payload\n'),
    ]),
  );
  await assert.rejects(
    verifyPackage(tampered, release.inventorySha256),
    /changed or undeclared/,
  );
  await writeFile(resolve(tampered, 'scripts/work.mjs'), helperBytes);
  await writeFile(
    resolve(tampered, 'extra.txt'),
    'synthetic undeclared payload',
  );
  await assert.rejects(
    verifyPackage(tampered, release.inventorySha256),
    /changed or undeclared/,
  );
  process.stdout.write(
    JSON.stringify({
      releaseId: release.releaseId,
      localCommandProcesses: 2,
      packagedPlatformAdapter: adapted,
      modifiedFileRejected: true,
      undeclaredFileRejected: true,
      installationPerformed: false,
      hostLoadVerified: false,
    }) + '\n',
  );
} finally {
  const safe = resolve(privateRoot);
  if (
    dirname(safe) !== resolve(tmpdir()) ||
    !basename(safe).startsWith('ath-knowledge-package-smoke-')
  )
    throw Error('Unsafe smoke cleanup');
  await rm(safe, { recursive: true, force: true });
}
