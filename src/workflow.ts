import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ToolPort, ResultPort } from './ports.js';
import { canonical, digest } from './canonical.js';
import { fail, safeFailure } from './errors.js';
import { WorkStore, type WorkSnapshot } from './work-store.js';
import { validateOfficialArguments } from './official-contracts.js';
import {
  contentSchema,
  indexReplySchema,
  entryReplySchema,
  comparisonSchema,
  selectionReceiptSchema,
  operationStatusSchema,
  selectionPageSchema,
  draftSchema,
  draftSourceSchema,
  id,
  type KnowledgeComparison,
  type SelectionReceipt,
  type Work,
} from './schemas.js';
type Json = z.infer<ReturnType<typeof z.json>>;
export interface VerifiedRead<T> {
  data: T;
  raw: Json;
}
function comparisonFrom(raw: unknown) {
  const response = z.object({ comparison: comparisonSchema }).parse(raw),
    original = z.object({ comparison: z.json() }).parse(raw).comparison;
  const signed = z.record(z.string(), z.json()).parse(original),
    { scopeDigest, ...payload } = signed;
  if (digest(payload) !== scopeDigest)
    return fail('COMPARISON_DIGEST_MISMATCH', '比较快照摘要不符，未采用。');
  return { data: response.comparison, raw: original };
}

export class KnowledgeWorkflow {
  constructor(
    readonly tools: ToolPort,
    readonly results: ResultPort,
  ) {}
  private async call<T>(
    name: string,
    args: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<VerifiedRead<T>> {
    validateOfficialArguments(name, args);
    this.results.assertSafe(args);
    const raw = this.results.read(await this.tools.callTool(name, args));
    this.results.assertSafe(raw);
    return { data: schema.parse(raw), raw: z.json().parse(raw) };
  }
  async listIndex(
    projectId: string,
    input: {
      spaceId?: string;
      query?: string;
      tag?: string;
      includeDeleted?: boolean;
      afterId?: string;
      limit?: number;
    } = {},
  ) {
    id.parse(projectId);
    const validated = z
      .strictObject({
        spaceId: id.optional(),
        query: z.string().max(200).optional(),
        tag: z.string().max(60).optional(),
        includeDeleted: z.boolean().optional(),
        afterId: id.optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .parse(input);
    const result = await this.call(
      'ath_knowledge',
      {
        op: validated.query ? 'search' : 'list-index',
        projectId,
        input: validated,
      },
      indexReplySchema,
    );
    if (
      result.data.entries.some(
        (entry) =>
          entry.projectId !== projectId ||
          (validated.spaceId && entry.spaceId !== validated.spaceId),
      ) ||
      (result.data.hasMore &&
        (!result.data.nextCursor ||
          result.data.nextCursor !== result.data.entries.at(-1)?.id))
    )
      return fail('INDEX_SCOPE_MISMATCH', '索引项目/子库或分页基准不符。');
    return result;
  }
  async getContent(projectId: string, entryId: string, revisionId?: string) {
    id.parse(projectId);
    id.parse(entryId);
    if (revisionId) id.parse(revisionId);
    const result = await this.call(
        'ath_knowledge',
        {
          op: 'get',
          projectId,
          entryId,
          ...(revisionId ? { revisionId } : {}),
        },
        entryReplySchema,
      ),
      { entry, revision } = result.data;
    if (
      entry.projectId !== projectId ||
      entry.id !== entryId ||
      revision.entryId !== entryId ||
      revision.id !== (revisionId ?? entry.revisionId) ||
      digest(revision.content) !== revision.contentDigest
    )
      return fail('ENTRY_SCOPE_MISMATCH', '正文身份/修订/摘要不符。');
    return result;
  }
  async getComparison(projectId: string, comparisonId: string) {
    const result = await this.call(
        'ath_knowledge_changes',
        {
          op: 'get-comparison',
          projectId: id.parse(projectId),
          comparisonId: id.parse(comparisonId),
        },
        z.json(),
      ),
      parsed = comparisonFrom(result.data);
    if (parsed.data.id !== comparisonId || parsed.data.projectId !== projectId)
      return fail(
        'COMPARISON_SCOPE_MISMATCH',
        '不是本人本项目所请求的原比较。',
      );
    return parsed;
  }
  async prepareComparison(
    store: WorkStore,
    snapshot: WorkSnapshot,
    scope: { localIds: string[]; remoteEntryIds?: string[] },
  ): Promise<WorkSnapshot> {
    const selected = new Set(scope.localIds);
    if (selected.size !== scope.localIds.length || scope.localIds.length > 100)
      return fail('INVALID_COMPARISON_SCOPE', '本地范围重复或超限。');
    const remote = scope.remoteEntryIds;
    if (
      remote &&
      (remote.length > 100 || new Set(remote).size !== remote.length)
    )
      return fail('INVALID_COMPARISON_SCOPE', '平台范围重复或超限。');
    remote?.forEach((value) => id.parse(value));
    if (
      snapshot.work.intents.some((intent) =>
        ['prepared', 'dispatching', 'unknown'].includes(intent.state),
      )
    )
      return fail(
        'UNRESOLVED_INTENT',
        '已有原意图需核对，不能用新key掩盖未定结果。',
      );
    const records = scope.localIds.map((localId) => {
      const record = snapshot.work.drafts.find(
        (draft) => draft.localId === localId,
      );
      if (!record)
        return fail('DRAFT_NOT_FOUND', '选中本地身份不属于此工作稿。');
      if (record.resolvedBySelectionId)
        return fail(
          'DRAFT_ALREADY_RESOLVED',
          '此提案已有人工作出选择，修改内容/明确开启新提案后再比较。',
        );
      return record;
    });
    const manifest = records.map((record) => {
      for (const sourceId of record.sourceIds) {
        const source = snapshot.work.sources.find(
          (item) => item.sourceId === sourceId,
        );
        if (!source || source.disclosure !== 'allowed')
          return fail(
            'DISCLOSURE_NOT_GRANTED',
            '资料范围尚未允许发送到本次平台目标。',
          );
      }
      if (record.operation === 'upsert' && record.sourceIds.length === 0)
        return fail(
          'SOURCE_UNSPECIFIED',
          '提案需要明确来源/局限，不自动捏造依据。',
        );
      if (
        remote &&
        record.platform &&
        !remote.includes(record.platform.entryId)
      )
        return fail(
          'INVALID_COMPARISON_SCOPE',
          '已映射身份不在明确平台范围内。',
        );
      if (record.operation === 'explicitDelete')
        return {
          operation: record.operation,
          localId: record.localId,
          entryId: record.platform!.entryId,
          baseRevisionId: record.platform!.baseRevisionId,
        };
      return {
        operation: record.operation,
        localId: record.localId,
        entryId: record.platform?.entryId ?? null,
        baseRevisionId: record.platform?.baseRevisionId ?? null,
        content: contentSchema.parse(record.content),
      };
    });
    const commandId = randomUUID(),
      args = {
        op: 'compare',
        projectId: snapshot.work.projectId,
        input: {
          commandId,
          spaceId: snapshot.work.spaceId,
          localManifest: manifest,
          ...(remote ? { remoteEntryIds: remote } : {}),
        },
      };
    validateOfficialArguments('ath_knowledge_changes', args);
    this.results.assertSafe(args);
    return store.update(snapshot.work.workId, snapshot.digest, (work) => {
      work.intents.push({
        intentId: randomUUID(),
        commandId,
        operation: 'knowledge.compare',
        args: z.record(z.string(), z.json()).parse(args),
        argsDigest: digest(args),
        state: 'prepared',
        failureCode: null,
        comparisonId: null,
      });
    });
  }
  async dispatchComparison(
    store: WorkStore,
    snapshot: WorkSnapshot,
    intentId: string,
  ): Promise<WorkSnapshot> {
    const before = snapshot.work.intents.find(
      (intent) => intent.intentId === intentId,
    );
    if (
      !before ||
      before.state !== 'prepared' ||
      digest(before.args) !== before.argsDigest
    )
      return fail(
        'INTENT_NOT_SENDABLE',
        '意图已发出或内容变化，只可查原状态。',
      );
    const sending = await store.update(
      snapshot.work.workId,
      snapshot.digest,
      (work) => {
        const intent = work.intents.find((item) => item.intentId === intentId)!;
        if (intent.state !== 'prepared')
          return fail('INTENT_NOT_SENDABLE', '原意图不能再次发送。');
        intent.state = 'dispatching';
      },
    );
    let comparison: ReturnType<typeof comparisonFrom>;
    try {
      const result = await this.call(
        'ath_knowledge_changes',
        before.args,
        z.json(),
      );
      comparison = comparisonFrom(result.data);
      this.assertComparison(sending.work, before.args, comparison.data);
    } catch (error) {
      const failure = safeFailure(error);
      return store.update(sending.work.workId, sending.digest, (work) => {
        const intent = work.intents.find((item) => item.intentId === intentId)!;
        intent.state = failure.certainty === 'unknown' ? 'unknown' : 'rejected';
        intent.failureCode = failure.code;
      });
    }
    // A failed local receipt save must leave dispatching/its prepared transaction for explicit recovery.
    return store.update(sending.work.workId, sending.digest, (work) => {
      const intent = work.intents.find((item) => item.intentId === intentId)!;
      intent.state = 'completed';
      intent.comparisonId = comparison.data.id;
      work.comparisons.push(comparison.raw);
    });
  }
  private assertComparison(
    work: Work,
    args: Record<string, unknown>,
    comparison: KnowledgeComparison,
  ) {
    const input = z
      .object({
        input: z.object({
          localManifest: z.array(
            z.object({
              localId: z.string(),
              operation: z.enum(['upsert', 'explicitDelete']),
              entryId: id.nullable(),
              baseRevisionId: id.nullable(),
              content: contentSchema.optional(),
            }),
          ),
          remoteEntryIds: z.array(id).optional(),
        }),
      })
      .parse(args).input;
    const expected = new Set(input.localManifest.map((item) => item.localId)),
      received = comparison.items.flatMap((item) =>
        item.localId === null ? [] : [item.localId],
      );
    if (
      comparison.projectId !== work.projectId ||
      comparison.spaceId !== work.spaceId ||
      new Set(received).size !== received.length ||
      received.length !== expected.size ||
      received.some((value) => !expected.has(value))
    )
      return fail(
        'COMPARISON_SCOPE_MISMATCH',
        '比较回执扩大/丢失了原明确范围。',
      );
    const actualRemoteIds = new Set<string>();
    for (const item of comparison.items) {
      if (item.entryId) actualRemoteIds.add(item.entryId);
      for (const entry of [
        ...item.matchCandidates,
        ...(item.remoteIndex ? [item.remoteIndex] : []),
      ]) {
        if (
          entry.projectId !== work.projectId ||
          entry.spaceId !== work.spaceId
        )
          return fail(
            'COMPARISON_SCOPE_MISMATCH',
            '匹配候选不属于本项目/子库。',
          );
        if (input.remoteEntryIds && !input.remoteEntryIds.includes(entry.id))
          return fail(
            'COMPARISON_SCOPE_MISMATCH',
            '匹配候选扩大了原明确平台范围。',
          );
      }
      if (item.localId === null) {
        if (
          item.localOperation !== null ||
          item.classification !== 'unchanged' ||
          item.localContent !== null
        )
          return fail(
            'COMPARISON_SCOPE_MISMATCH',
            '本地缺席不能解释成平台变更。',
          );
        continue;
      }
      const proposed = input.localManifest.find(
        (record) => record.localId === item.localId,
      )!;
      if (
        item.entryId !== proposed.entryId ||
        item.localBaseRevisionId !== proposed.baseRevisionId ||
        item.localOperation !== proposed.operation ||
        canonical(item.localContent) !==
          canonical(proposed.operation === 'upsert' ? proposed.content : null)
      )
        return fail(
          'COMPARISON_SCOPE_MISMATCH',
          '比较回执不是原精确身份/基准/内容提案。',
        );
    }
    if (
      input.remoteEntryIds &&
      (actualRemoteIds.size !== input.remoteEntryIds.length ||
        input.remoteEntryIds.some((value) => !actualRemoteIds.has(value)))
    )
      return fail(
        'COMPARISON_SCOPE_MISMATCH',
        '比较回执扩大/丢失了明确平台身份范围。',
      );
  }
  async recoverComparison(
    store: WorkStore,
    snapshot: WorkSnapshot,
    intentId: string,
  ): Promise<WorkSnapshot> {
    const intent = snapshot.work.intents.find(
      (item) => item.intentId === intentId,
    );
    if (!intent || !['dispatching', 'unknown'].includes(intent.state))
      return fail('INTENT_NOT_RECOVERABLE', '此意图无需远端状态恢复。');
    const response = await this.call(
      'ath_operation_status',
      { op: 'get', operation: 'knowledge.compare', key: intent.commandId },
      operationStatusSchema,
    );
    if (
      response.data.command.operation !== 'knowledge.compare' ||
      response.data.command.projectId !== snapshot.work.projectId ||
      response.data.command.status !== 'completed'
    )
      return fail(
        'ORIGINAL_RESULT_UNCONFIRMED',
        '原操作尚无确定完成回执，未重发。',
      );
    const comparison = comparisonFrom(response.data.command.response);
    this.assertComparison(snapshot.work, intent.args, comparison.data);
    return store.update(snapshot.work.workId, snapshot.digest, (work) => {
      const current = work.intents.find((item) => item.intentId === intentId)!;
      current.state = 'completed';
      current.failureCode = null;
      current.comparisonId = comparison.data.id;
      if (
        !work.comparisons.some(
          (item) => comparisonSchema.parse(item).id === comparison.data.id,
        )
      )
        work.comparisons.push(comparison.raw);
    });
  }
  async readSelectionByOriginalKey(
    store: WorkStore,
    snapshot: WorkSnapshot,
    comparisonId: string,
    originalKey: string,
  ): Promise<WorkSnapshot> {
    const current = await this.getComparison(
      snapshot.work.projectId,
      comparisonId,
    );
    const original = snapshot.work.comparisons.find(
      (item) => comparisonSchema.parse(item).id === comparisonId,
    );
    if (!original)
      return fail('COMPARISON_NOT_IN_WORK', '此工作稿没有原比较身份。');
    if (
      comparisonSchema.parse(original).scopeDigest !== current.data.scopeDigest
    )
      return fail(
        'COMPARISON_SCOPE_MISMATCH',
        '平台比较与原保存摘要不符，未采用收据。',
      );
    const reply = await this.call(
      'ath_operation_status',
      { op: 'get', operation: 'knowledge.commit-selection', key: originalKey },
      operationStatusSchema,
    );
    if (
      reply.data.command.operation !== 'knowledge.commit-selection' ||
      reply.data.command.projectId !== snapshot.work.projectId ||
      reply.data.command.status !== 'completed'
    )
      return fail(
        'ORIGINAL_RESULT_UNCONFIRMED',
        '没有本项目原提交的完成回执。',
      );
    const receipt = selectionReceiptSchema.parse(reply.data.command.response);
    return store.update(snapshot.work.workId, snapshot.digest, (work) =>
      applySelectionReceipt(work, current.data, receipt),
    );
  }
  /** One authorized page only. No automatic history walk or platform mutation. */
  async readSelectionPage(
    store: WorkStore,
    snapshot: WorkSnapshot,
    comparisonId: string,
    input: { limit?: number; afterSelectionId?: string } = {},
  ) {
    id.parse(comparisonId);
    const original = snapshot.work.comparisons.find(
      (item) => comparisonSchema.parse(item).id === comparisonId,
    );
    if (!original)
      return fail('COMPARISON_NOT_IN_WORK', '此工作稿没有原比较身份。');
    const comparison = comparisonFrom({ comparison: original }).data;
    const query = z
      .strictObject({
        limit: z.number().int().min(1).max(50).default(20),
        afterSelectionId: id.optional(),
      })
      .parse(input);
    const page = await this.call(
      'ath_knowledge_changes',
      {
        op: 'get-selection-receipts',
        projectId: snapshot.work.projectId,
        comparisonId,
        input: query,
      },
      selectionPageSchema,
    );
    const selectionIds = page.data.selections.map(
      (selection) => selection.receipt.selectionId,
    );
    if (
      page.data.comparisonId !== comparisonId ||
      page.data.scopeDigest !== comparison.scopeDigest ||
      new Set(selectionIds).size !== selectionIds.length ||
      page.data.selections.length > query.limit ||
      (page.data.hasMore
        ? !page.data.nextCursor || page.data.nextCursor !== selectionIds.at(-1)
        : page.data.nextCursor !== null)
    )
      return fail(
        'SELECTION_PAGE_SCOPE_MISMATCH',
        '回执分页身份/摘要/游标不符，未采用。',
      );
    const next = await store.update(
      snapshot.work.workId,
      snapshot.digest,
      (work) => {
        for (const selection of page.data.selections)
          applySelectionReceipt(work, comparison, selection.receipt);
        (work.selectionPages ??= []).push({
          comparisonId,
          scopeDigest: page.data.scopeDigest,
          afterSelectionId: query.afterSelectionId ?? null,
          limit: query.limit,
          selectionIds,
          hasMore: page.data.hasMore,
          nextCursor: page.data.nextCursor,
        });
      },
    );
    return { snapshot: next, page };
  }
}

export function addSource(
  work: Work,
  input: z.input<typeof draftSourceSchema>,
) {
  const source = draftSourceSchema.parse(input);
  if (work.sources.some((item) => item.sourceId === source.sourceId))
    return fail('SOURCE_ID_EXISTS', '来源身份已存在，不覆盖。');
  work.sources.push(source);
}
export function putDraft(work: Work, input: z.input<typeof draftSchema>) {
  const draft = draftSchema.parse(input),
    index = work.drafts.findIndex((item) => item.localId === draft.localId);
  if (index < 0) work.drafts.push(draft);
  else work.drafts[index] = draft;
}
export function applySelectionReceipt(
  work: Work,
  comparison: KnowledgeComparison,
  receipt: SelectionReceipt,
) {
  if (
    comparison.projectId !== work.projectId ||
    comparison.spaceId !== work.spaceId ||
    receipt.comparisonId !== comparison.id ||
    receipt.scopeDigest !== comparison.scopeDigest
  )
    return fail('RECEIPT_SCOPE_MISMATCH', '选择回执不属于此工作稿原比较。');
  if (
    new Set(receipt.results.map((result) => result.changeId)).size !==
    receipt.results.length
  )
    return fail('DUPLICATE_RECEIPT_CHANGE', '回执重复变更项，未采用。');
  const existing = work.selectionReceipts.find(
    (item) =>
      selectionReceiptSchema.parse(item).selectionId === receipt.selectionId,
  );
  if (existing) {
    if (canonical(existing) !== canonical(receipt))
      return fail('RECEIPT_ID_CONFLICT', '同选择身份已有不同原回执。');
    return;
  }
  const candidate = structuredClone(work);
  for (const result of receipt.results) {
    const item = comparison.items.find(
      (candidate) => candidate.changeId === result.changeId,
    );
    if (!item)
      return fail('RECEIPT_SCOPE_MISMATCH', '回执含原范围以外的变更。');
    if (result.status === 'conflict' || item.localId === null) continue;
    const draft = candidate.drafts.find(
      (value) => value.localId === item.localId,
    );
    if (draft) draft.resolvedBySelectionId = receipt.selectionId;
    if (!result.entryId || !result.revisionId) {
      if (result.status === 'keptRemote' && item.entryId === null) continue;
      return fail('RECEIPT_ID_MISSING', '成功回执缺正式身份，不猜测映射。');
    }
    if (item.entryId !== null && item.entryId !== result.entryId)
      return fail('RECEIPT_ID_CONFLICT', '回执不能改变已有条目身份。');
    const mapping = {
        localId: item.localId,
        entryId: result.entryId,
        baseRevisionId: result.revisionId,
        deleted:
          result.status === 'deleted' ||
          (['keptRemote', 'unchanged'].includes(result.status) &&
            (result.remoteCurrent?.deleted ?? false)),
        comparisonId: comparison.id,
        selectionId: receipt.selectionId,
      },
      prior = candidate.mappings.findIndex(
        (value) => value.localId === item.localId,
      );
    if (prior < 0) candidate.mappings.push(mapping);
    else candidate.mappings[prior] = mapping;
    if (draft)
      draft.platform = {
        entryId: result.entryId,
        baseRevisionId: result.revisionId,
      };
  }
  candidate.selectionReceipts.push(z.json().parse(receipt));
  work.mappings = candidate.mappings;
  work.drafts = candidate.drafts;
  work.selectionReceipts = candidate.selectionReceipts;
}
