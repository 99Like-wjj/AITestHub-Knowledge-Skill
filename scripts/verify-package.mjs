import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPackage, hash } from './package-lib.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const receipt = JSON.parse(
  await readFile(resolve(root, '.build/latest-package.json'), 'utf8'),
);
if (hash(await readFile(receipt.archivePath)) !== receipt.archiveSha256)
  throw Error('Archive hash mismatch.');
process.stdout.write(
  JSON.stringify({
    ...(await verifyPackage(receipt.directory, receipt.inventorySha256)),
    archiveSha256: receipt.archiveSha256,
    archiveReadbackVerified: receipt.archiveReadbackVerified,
  }) + '\n',
);
