import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
const targetName = process.argv[3] ?? 'knowledge.snapshot.json';
if (!/^knowledge(?:\.[a-z0-9-]+)?\.snapshot\.json$/.test(targetName))
  throw Error('Invalid immutable snapshot name.');
if (!source)
  throw Error('Explicit exported contract artifact directory required.');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(
  await readFile(resolve(source, 'manifest.json'), 'utf8'),
);
const catalogBytes = await readFile(resolve(source, 'catalog.json')),
  componentsBytes = await readFile(resolve(source, 'components.json'));
if (
  hash(catalogBytes) !== manifest.files['catalog.json'] ||
  hash(componentsBytes) !== manifest.files['components.json']
)
  throw Error('Source artifact hash mismatch.');
const catalog = JSON.parse(catalogBytes),
  components = JSON.parse(componentsBytes);
const toolNames = [
  'ath_knowledge',
  'ath_knowledge_changes',
  'ath_operation_status',
];
const tools = Object.fromEntries(
  toolNames.map((name) => {
    const tool = catalog.tools.find((tool) => tool.name === name);
    if (!tool) throw Error('Missing required tool');
    return [name, tool.inputSchema];
  }),
);
const schemas = Object.fromEntries(
  Object.entries(components.schemas).filter(([name]) =>
    name.startsWith('knowledge.'),
  ),
);
const snapshot = {
  artifactVersion: manifest.artifactVersion,
  protocolVersion: manifest.protocolVersion,
  structuralValidationOnly: true,
  serverRemainsBusinessAuthority: true,
  sourceHashes: manifest.sourceHashes,
  sourceFiles: manifest.files,
  tools,
  schemas,
};
await mkdir(resolve(root, 'src/contracts'), { recursive: true });
await writeFile(
  resolve(root, 'src/contracts', targetName),
  JSON.stringify(snapshot, null, 2) + '\n',
  { flag: 'wx' },
);
process.stdout.write(
  JSON.stringify({
    toolCount: toolNames.length,
    componentCount: Object.keys(schemas).length,
    snapshotSha256: hash(JSON.stringify(snapshot, null, 2) + '\n'),
  }) + '\n',
);
