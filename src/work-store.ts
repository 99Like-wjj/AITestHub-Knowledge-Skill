import { randomUUID } from 'node:crypto';
import type { WorkspacePort } from './ports.js';
import { canonical, digest } from './canonical.js';
import { fail } from './errors.js';
import { id, workSchema, type Work } from './schemas.js';
import { z } from 'zod';
const transactionSchema = z.strictObject({
  transactionId: id,
  workId: id,
  baseDigest: z.string().nullable(),
  nextDigest: z.string(),
  next: workSchema,
});
export interface WorkSnapshot {
  work: Work;
  digest: string;
}
export interface PreparedObservation {
  transactionId: string;
  workId: string;
  baseDigest: string | null;
  nextDigest: string;
}
export class WorkStore {
  constructor(
    readonly workspace: WorkspacePort,
    readonly onPrepared?: (observation: PreparedObservation) => Promise<void>,
  ) {}
  private path(workId: string, tail: string) {
    id.parse(workId);
    return `knowledge-work/${workId}/${tail}`;
  }
  private parse(text: string): WorkSnapshot {
    if (Buffer.byteLength(text) > 16 * 1024 * 1024)
      fail('WORK_TOO_LARGE', '工作稿超出16MiB限制，请明确另建任务范围。');
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      return fail('WORK_INVALID', '工作稿无法解析，不会重建或覆盖。');
    }
    const work = workSchema.parse(value);
    if (text !== canonical(work) + '\n')
      fail(
        'WORK_CHANGED_EXTERNALLY',
        '工作稿字节不是原规范形式，请先核实外部修改。',
      );
    return { work, digest: digest(work) };
  }
  async read(workId: string): Promise<WorkSnapshot> {
    const text = await this.workspace.readText(this.path(workId, 'state.json'));
    if (text === null) return fail('WORK_NOT_FOUND', '未找到此任务工作稿。');
    const value = this.parse(text);
    if (value.work.workId !== workId)
      fail('WORK_ID_MISMATCH', '工作稿身份不符。');
    return value;
  }
  async create(projectId: string, spaceId: string): Promise<WorkSnapshot> {
    const work = workSchema.parse({
      schemaVersion: 'ath.knowledge-work.v1',
      workId: randomUUID(),
      projectId,
      spaceId,
      revision: 0,
      sources: [],
      drafts: [],
      intents: [],
      comparisons: [],
      selectionReceipts: [],
      mappings: [],
    });
    return this.workspace.withExclusive(
      this.path(work.workId, 'write'),
      async () => {
        if (
          (await this.workspace.readText(
            this.path(work.workId, 'state.json'),
          )) !== null
        )
          return fail('WORK_EXISTS', '已有工作稿，未覆盖。');
        await this.workspace.writeTextAtomic(
          this.path(work.workId, 'state.json'),
          canonical(work) + '\n',
        );
        return { work, digest: digest(work) };
      },
    );
  }
  async update(
    workId: string,
    expectedDigest: string,
    mutate: (work: Work) => void,
  ): Promise<WorkSnapshot> {
    return this.workspace.withExclusive(
      this.path(workId, 'write'),
      async () => {
        const pending = await this.workspace.readText(
          this.path(workId, 'pending.json'),
        );
        if (pending !== null && pending !== 'null\n')
          return fail(
            'RECOVERY_REQUIRED',
            '已有准备事务，先按原transactionId只读核对。',
          );
        const before = await this.read(workId);
        if (before.digest !== expectedDigest)
          return fail('WORK_CAS_CONFLICT', '工作稿基准已变化，未覆盖。');
        const candidate = structuredClone(before.work);
        mutate(candidate);
        if (
          candidate.workId !== workId ||
          candidate.projectId !== before.work.projectId ||
          candidate.spaceId !== before.work.spaceId ||
          candidate.revision !== before.work.revision
        )
          return fail(
            'WORK_SCOPE_CHANGED',
            '工作稿更新不能改变身份、项目、子库或并发版本。',
          );
        candidate.revision++;
        const next = workSchema.parse(candidate),
          nextDigest = digest(next),
          transactionId = randomUUID();
        if (Buffer.byteLength(canonical(next)) > 16 * 1024 * 1024)
          return fail('WORK_TOO_LARGE', '工作稿超限，未写入。');
        const transaction = transactionSchema.parse({
          transactionId,
          workId,
          baseDigest: before.digest,
          nextDigest,
          next,
        });
        await this.workspace.writeTextAtomic(
          this.path(workId, `transactions/${transactionId}.json`),
          canonical(transaction) + '\n',
        );
        await this.workspace.writeTextAtomic(
          this.path(workId, 'pending.json'),
          canonical({ transactionId }) + '\n',
        );
        await this.onPrepared?.({
          transactionId,
          workId,
          baseDigest: before.digest,
          nextDigest,
        });
        await this.workspace.writeTextAtomic(
          this.path(workId, 'state.json'),
          canonical(next) + '\n',
        );
        await this.workspace.writeTextAtomic(
          this.path(workId, 'pending.json'),
          'null\n',
        );
        return { work: next, digest: nextDigest };
      },
    );
  }
  async inspectRecovery(workId: string) {
    const pointer = await this.workspace.readText(
      this.path(workId, 'pending.json'),
    );
    if (pointer === null || pointer === 'null\n') return null;
    const parsed = z
      .strictObject({ transactionId: id })
      .parse(JSON.parse(pointer));
    const text = await this.workspace.readText(
      this.path(workId, `transactions/${parsed.transactionId}.json`),
    );
    if (!text)
      return fail(
        'PREPARED_TRANSACTION_MISSING',
        '准备记录缺失，不覆盖工作稿。',
      );
    const transaction = transactionSchema.parse(JSON.parse(text));
    if (
      transaction.workId !== workId ||
      transaction.transactionId !== parsed.transactionId ||
      digest(transaction.next) !== transaction.nextDigest
    )
      return fail('PREPARED_TRANSACTION_INVALID', '准备事务身份或摘要不符。');
    const current = await this.read(workId);
    return {
      transactionId: transaction.transactionId,
      workId,
      baseDigest: transaction.baseDigest,
      nextDigest: transaction.nextDigest,
      currentDigest: current.digest,
      canComplete:
        current.digest === transaction.baseDigest ||
        current.digest === transaction.nextDigest,
    };
  }
  async recover(
    workId: string,
    transactionId: string,
    expectedCurrentDigest: string,
  ): Promise<WorkSnapshot> {
    id.parse(transactionId);
    return this.workspace.withExclusive(
      this.path(workId, 'write'),
      async () => {
        const inspection = await this.inspectRecovery(workId);
        if (
          !inspection ||
          inspection.transactionId !== transactionId ||
          inspection.currentDigest !== expectedCurrentDigest ||
          !inspection.canComplete
        )
          return fail(
            'RECOVERY_CONFLICT',
            '原事务/基准不符或存在外部修改，未覆盖。',
          );
        const text = await this.workspace.readText(
          this.path(workId, `transactions/${transactionId}.json`),
        );
        const transaction = transactionSchema.parse(JSON.parse(text!));
        if (inspection.currentDigest !== inspection.nextDigest)
          await this.workspace.writeTextAtomic(
            this.path(workId, 'state.json'),
            canonical(transaction.next) + '\n',
          );
        await this.workspace.writeTextAtomic(
          this.path(workId, 'pending.json'),
          'null\n',
        );
        return this.read(workId);
      },
    );
  }
}
