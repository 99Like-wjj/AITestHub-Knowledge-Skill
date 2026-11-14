import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeWorkspace } from './node-workspace.js';
import { WorkStore, type WorkSnapshot } from './work-store.js';
import { addSource, putDraft } from './workflow.js';
import { canonical } from './canonical.js';
import { KnowledgeWorkError, fail } from './errors.js';
import { draftSchema, draftSourceSchema, id, sha } from './schemas.js';

/** Local-only command runner. No MCP transport, key, model, network or auto replay. */
export async function runLocalCommand(argv: string[]): Promise<unknown> {
  const [command, ...tokens] = argv;
  const allowed: Record<string, string[]> = {
    create: ['workspace', 'project-id', 'space-id'],
    summary: ['workspace', 'work-id'],
    'add-source': ['workspace', 'work-id', 'expected-digest', 'input-key'],
    'put-draft': ['workspace', 'work-id', 'expected-digest', 'input-key'],
    'inspect-recovery': ['workspace', 'work-id'],
    recover: ['workspace', 'work-id', 'transaction-id', 'expected-digest'],
    'inspect-lock': ['workspace', 'work-id'],
    'release-lock': ['workspace', 'work-id', 'lock-id'],
  };
  const keys = command ? allowed[command] : undefined;
  if (!keys || tokens.length !== keys.length * 2)
    return fail(
      'LOCAL_ARGUMENTS_INVALID',
      '命令或必需参数不符，请核对references/runtime.md。',
    );
  const values = new Map<string, string>();
  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index]?.slice(2),
      value = tokens[index + 1];
    if (
      !tokens[index]?.startsWith('--') ||
      !key ||
      !keys.includes(key) ||
      values.has(key) ||
      !value
    )
      return fail(
        'LOCAL_ARGUMENTS_INVALID',
        '本地命令不接受缺失、重复或额外参数。',
      );
    values.set(key, value);
  }
  const value = (key: string) => values.get(key)!;
  const workspace = await NodeWorkspace.open(value('workspace')),
    store = new WorkStore(workspace);
  if (command === 'create')
    return summarize(
      await store.create(
        id.parse(value('project-id')),
        id.parse(value('space-id')),
      ),
    );
  const workId = id.parse(value('work-id')),
    lockKey = `knowledge-work/${workId}/write`;
  if (command === 'inspect-lock')
    return { workId, lock: await workspace.inspectLock(lockKey) };
  if (command === 'release-lock') {
    await workspace.releaseAbandonedLock(lockKey, id.parse(value('lock-id')));
    return { workId, released: true };
  }
  if (command === 'inspect-recovery')
    return { workId, recovery: await store.inspectRecovery(workId) };
  if (command === 'recover')
    return summarize(
      await store.recover(
        workId,
        id.parse(value('transaction-id')),
        sha.parse(value('expected-digest')),
      ),
    );
  if (command === 'summary') return summarize(await store.read(workId));
  const text = await workspace.readText(value('input-key'));
  if (text === null)
    return fail(
      'LOCAL_INPUT_NOT_FOUND',
      '指定工作目录内输入不存在；不搜索其他路径。',
    );
  if (Buffer.byteLength(text) > 1024 * 1024)
    return fail('LOCAL_INPUT_TOO_LARGE', '单个来源或条目输入不得超过1MiB。');
  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch {
    return fail('LOCAL_INPUT_INVALID', '输入不是有效JSON，不回显正文。');
  }
  // Exact canonical bytes reject overwritten duplicate keys and ambiguous hand edits.
  if (text !== canonical(input) && text !== canonical(input) + '\n')
    return fail(
      'LOCAL_INPUT_NOT_CANONICAL',
      '输入需由导出的canonical函数生成；不会解释重复属性或隐式升级旧库。',
    );
  const expected = sha.parse(value('expected-digest'));
  if (command === 'add-source') {
    const source = draftSourceSchema.parse(input);
    return summarize(
      await store.update(workId, expected, (work) => addSource(work, source)),
    );
  }
  const draft = draftSchema.parse(input);
  return summarize(
    await store.update(workId, expected, (work) => putDraft(work, draft)),
  );
}

function summarize({ work, digest }: WorkSnapshot) {
  return {
    workId: work.workId,
    projectId: work.projectId,
    spaceId: work.spaceId,
    revision: work.revision,
    digest,
    sourceCount: work.sources.length,
    drafts: work.drafts.map((draft) => ({
      localId: draft.localId,
      operation: draft.operation,
      platform: draft.platform,
      resolvedBySelectionId: draft.resolvedBySelectionId,
    })),
    intents: work.intents.map((intent) => ({
      intentId: intent.intentId,
      commandId: intent.commandId,
      state: intent.state,
      failureCode: intent.failureCode,
      comparisonId: intent.comparisonId,
    })),
    mappingCount: work.mappings.length,
    selectionCount: work.selectionReceipts.length,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    process.stdout.write(
      JSON.stringify({ ok: true, data: await runLocalCommand(argv) }) + '\n',
    );
  } catch (error) {
    const code =
      error instanceof KnowledgeWorkError
        ? error.code
        : 'LOCAL_COMMAND_REJECTED';
    process.stderr.write(JSON.stringify({ ok: false, error: { code } }) + '\n');
    process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
