import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { hash, inventory, verifyPackage } from './package-lib.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  metadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')),
  skillManifest = JSON.parse(
    await readFile(
      resolve(root, 'skills/ath-project-knowledge/manifest.json'),
      'utf8',
    ),
  );
const releaseId = randomUUID(),
  release = resolve(root, '.build/releases', releaseId),
  directory = resolve(release, 'ath-project-knowledge');
await mkdir(release, { recursive: true });
await inventory(resolve(root, 'skills/ath-project-knowledge')); // Refuse source symlinks before copying.
await cp(resolve(root, 'skills/ath-project-knowledge'), directory, {
  recursive: true,
  errorOnExist: true,
  force: false,
});
await mkdir(resolve(directory, 'runtime/node_modules'), { recursive: true });
await cp(resolve(root, 'dist/src'), resolve(directory, 'runtime/src'), {
  recursive: true,
  errorOnExist: true,
  force: false,
  filter: (source) =>
    !source.endsWith('.snapshot.json') ||
    source.endsWith(skillManifest.officialContract.snapshot.split('/').at(-1)),
});
// TypeScript may reformat imported JSON. Preserve the exact derived artifact bytes.
await cp(
  resolve(
    root,
    skillManifest.officialContract.snapshot.replace(/^runtime\//, ''),
  ),
  resolve(directory, skillManifest.officialContract.snapshot),
);
// pnpm's verified package store uses hardlinks. Copy its bytes into independent files;
// the final distribution remains subject to the strict no-link inventory.
const dependency = await realpath(resolve(root, 'node_modules/zod'));
await inventory(dependency, { allowHardlinks: true });
await cp(dependency, resolve(directory, 'runtime/node_modules/zod'), {
  recursive: true,
  errorOnExist: true,
  force: false,
  filter: (source) => relative(dependency, source).split(/[\\/]/)[0] !== 'src',
});
await writeFile(
  resolve(directory, 'runtime/package.json'),
  JSON.stringify({
    name: '@aitesthub/project-knowledge-skill-runtime',
    version: metadata.version,
    type: 'module',
    license: 'MIT',
    engines: metadata.engines,
  }) + '\n',
);
for (const file of ['LICENSE', 'NOTICE'])
  await cp(resolve(root, file), resolve(directory, file), {
    errorOnExist: true,
    force: false,
  });
const files = await inventory(directory),
  integrity =
    JSON.stringify(
      {
        schemaVersion: 'aitesthub.skill-integrity.v1',
        skillId: 'ath-project-knowledge',
        version: metadata.version,
        files,
      },
      null,
      2,
    ) + '\n';
await writeFile(resolve(directory, 'integrity.json'), integrity, {
  flag: 'wx',
});
const verified = await verifyPackage(directory, hash(integrity));
async function archive(action, source, destination) {
  await new Promise((yes, no) => {
    const child = spawn(
      'pwsh',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        resolve(root, 'scripts/archive.ps1'),
        '-Action',
        action,
        '-Source',
        source,
        '-Destination',
        destination,
      ],
      { windowsHide: true, shell: false, stdio: 'pipe' },
    );
    let stderr = '';
    child.stderr.on('data', (bytes) => {
      stderr += String(bytes);
    });
    child.once('error', no);
    child.once('exit', (code) =>
      code === 0
        ? yes()
        : no(
            Error(
              `Archive operation failed (${code}); ${stderr.slice(0, 200)}`,
            ),
          ),
    );
  });
}
const archivePath = resolve(
    release,
    `ath-project-knowledge-${metadata.version}.zip`,
  ),
  extracted = resolve(release, 'archive-readback');
await archive('create', directory, archivePath);
await archive('extract', archivePath, extracted);
await verifyPackage(
  resolve(extracted, 'ath-project-knowledge'),
  verified.inventorySha256,
);
const receipt = {
  releaseId,
  createdAt: new Date().toISOString(),
  ...verified,
  directory,
  archivePath,
  archiveSha256: hash(await readFile(archivePath)),
  archiveReadbackVerified: true,
};
await writeFile(
  resolve(release, 'release.json'),
  JSON.stringify(receipt, null, 2) + '\n',
  { flag: 'wx' },
);
await writeFile(
  resolve(root, '.build/latest-package.json'),
  JSON.stringify(receipt, null, 2) + '\n',
);
process.stdout.write(JSON.stringify(receipt) + '\n');
