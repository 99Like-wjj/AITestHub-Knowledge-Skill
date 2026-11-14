import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function inventory(root, { allowHardlinks = false } = {}) {
  const result = [];
  async function visit(path) {
    const info = await lstat(path);
    if (
      info.isSymbolicLink() ||
      (!allowHardlinks && !info.isDirectory() && info.nlink > 1)
    )
      throw Error('Linked distribution file refused.');
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort())
        await visit(resolve(path, name));
    } else {
      if (!info.isFile()) throw Error('Unexpected distribution entry.');
      const name = relative(root, path).replaceAll('\\', '/');
      if (name !== 'integrity.json') {
        const bytes = await readFile(path);
        result.push({
          path: name,
          bytes: String(bytes.length),
          sha256: hash(bytes),
        });
      }
    }
  }
  await visit(root);
  return result.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}
export async function verifyPackage(root, expectedInventoryHash) {
  root = resolve(root);
  const bytes = await readFile(resolve(root, 'integrity.json'));
  if (expectedInventoryHash && hash(bytes) !== expectedInventoryHash)
    throw Error('Inventory digest mismatch.');
  const declared = JSON.parse(bytes),
    actual = await inventory(root);
  if (
    declared.schemaVersion !== 'aitesthub.skill-integrity.v1' ||
    JSON.stringify(declared.files) !== JSON.stringify(actual)
  )
    throw Error('Distribution has missing, changed or undeclared files.');
  for (const file of actual) {
    const path = relative(root, resolve(root, file.path));
    if (
      isAbsolute(path) ||
      path.startsWith('..') ||
      /(^|\/)(?:\.env(?:\..*)?|secrets|local|test-results|tests|knowledge-work)(?:\/|$)/i.test(
        file.path,
      )
    )
      throw Error('Forbidden distribution path.');
  }
  const manifest = JSON.parse(
      await readFile(resolve(root, 'manifest.json'), 'utf8'),
    ),
    toolInfo = JSON.parse(
      await readFile(resolve(root, 'tool-info.json'), 'utf8'),
    ),
    runtime = JSON.parse(
      await readFile(resolve(root, 'runtime/package.json'), 'utf8'),
    );
  if (
    manifest.skillId !== 'ath-project-knowledge' ||
    manifest.version !== toolInfo.version ||
    manifest.version !== runtime.version ||
    manifest.ruleVersion !== toolInfo.ruleVersion ||
    manifest.version !== manifest.ruleVersion
  )
    throw Error('Version mismatch.');
  const skill = await readFile(resolve(root, 'SKILL.md'), 'utf8');
  if (
    !skill.startsWith('---\nname: ath-project-knowledge\n') ||
    !skill.includes(`version: "${manifest.version}"`)
  )
    throw Error('Skill metadata mismatch.');
  for (const file of [
    'references/runtime.md',
    'references/platform-workflow.md',
    'references/content-and-sources.md',
  ]) {
    if (
      !(await readFile(resolve(root, file), 'utf8')).includes(
        `（${manifest.ruleVersion}）`,
      )
    )
      throw Error('Rule reference version mismatch.');
  }
  const contract = await readFile(
    resolve(root, manifest.officialContract.snapshot),
  );
  if (hash(contract) !== manifest.officialContract.snapshotSha256)
    throw Error('Contract snapshot mismatch.');
  const zod = JSON.parse(
    await readFile(
      resolve(root, 'runtime/node_modules/zod/package.json'),
      'utf8',
    ),
  );
  if (zod.version !== '4.6.7' || zod.license !== 'MIT')
    throw Error('Dependency identity mismatch.');
  for (const file of [
    'LICENSE',
    'NOTICE',
    'runtime/node_modules/zod/LICENSE',
    manifest.runtime.localEntry,
    manifest.runtime.platformEntry,
    manifest.runtime.localCommand,
  ])
    await readFile(resolve(root, file));
  return {
    skillId: manifest.skillId,
    version: manifest.version,
    fileCount: actual.length,
    inventorySha256: hash(bytes),
    contractSha256: hash(contract),
    releaseStatus: manifest.releaseStatus,
  };
}
