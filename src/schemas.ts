import { z } from 'zod';
import { officialSchema } from './official-contracts.js';
export const id = z.uuid();
export const sha = z.string().regex(/^[a-f0-9]{64}$/);
const localId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
// Types describe the business projection; validators below are generated official snapshots.
export interface KnowledgeContent {
  title: string;
  summary: string;
  tags: string[];
  body: string;
  configurationRefs: { configurationId: string; description: string }[];
  sourceRefs: (
    | { kind: 'requirementVersion'; requirementVersionId: string; note: string }
    | { kind: 'file'; fileId: string; note: string }
    | { kind: 'url'; url: string; note: string }
  )[];
}
export interface KnowledgeIndex {
  id: string;
  projectId: string;
  spaceId: string;
  title: string;
  summary: string;
  tags: string[];
  revisionId: string;
  revisionNo: number;
  rowVersion: number;
  contentDigest: string;
  deleted: boolean;
  updatedAt: string;
}
export interface KnowledgeRevision {
  id: string;
  entryId: string;
  revisionNo: number;
  content: KnowledgeContent;
  contentDigest: string;
  deleted: boolean;
  restoredFromRevisionId: string | null;
  createdBy: string;
  createdAt: string;
}
export interface KnowledgeComparisonItem {
  changeId: string;
  localId: string | null;
  entryId: string | null;
  classification:
    'create' | 'update' | 'explicitDelete' | 'conflict' | 'unchanged';
  reason: string;
  localOperation: 'upsert' | 'explicitDelete' | null;
  localBaseRevisionId: string | null;
  remoteRevisionId: string | null;
  remoteRowVersion: number | null;
  remoteDeleted: boolean;
  localContent: KnowledgeContent | null;
  remoteContent: KnowledgeContent | null;
  remoteIndex: KnowledgeIndex | null;
  matchCandidates: KnowledgeIndex[];
}
export interface KnowledgeComparison {
  id: string;
  projectId: string;
  spaceId: string;
  scopeDigest: string;
  items: KnowledgeComparisonItem[];
  createdAt: string;
  omittedRemoteEntriesDeleted: false;
}
export interface SelectionReceipt {
  comparisonId: string;
  scopeDigest: string;
  selectionId: string;
  results: {
    changeId: string;
    status:
      | 'created'
      | 'updated'
      | 'deleted'
      | 'keptRemote'
      | 'unchanged'
      | 'conflict';
    entryId: string | null;
    revisionId: string | null;
    code: string | null;
    localContent: KnowledgeContent | null;
    remoteCurrent: KnowledgeIndex | null;
  }[];
}
export const contentSchema = officialSchema<KnowledgeContent>(
  'knowledgeContentSchema',
);
export const indexItemSchema = officialSchema<KnowledgeIndex>(
  'knowledgeIndexItemSchema',
);
export const indexReplySchema = officialSchema<{
  entries: KnowledgeIndex[];
  nextCursor: string | null;
  hasMore: boolean;
  searchMethod: 'case-insensitive-substring';
}>('knowledgeIndexResponseSchema');
export const entryReplySchema = officialSchema<{
  entry: KnowledgeIndex;
  revision: KnowledgeRevision;
}>('knowledgeEntryResponseSchema');
export const comparisonSchema = officialSchema<KnowledgeComparison>(
  'knowledgeComparisonSchema',
);
export const selectionReceiptSchema = officialSchema<SelectionReceipt>(
  'knowledgeSelectionReceiptSchema',
);
export interface SelectionPage {
  comparisonId: string;
  scopeDigest: string;
  selections: { createdAt: string; receipt: SelectionReceipt }[];
  hasMore: boolean;
  nextCursor: string | null;
}
export const selectionPageSchema = officialSchema<SelectionPage>(
  'knowledgeSelectionHistorySchema',
);
export const operationStatusSchema = officialSchema<{
  command: {
    id: string;
    operation: string;
    status: 'pending' | 'completed' | 'failed' | 'unknown';
    projectId: string | null;
    response: z.infer<ReturnType<typeof z.json>>;
    createdAt: string;
    updatedAt: string;
  };
}>('knowledgeOperationStatusSchema');
export const draftSourceSchema = z.strictObject({
  sourceId: id,
  kind: z.enum([
    'requirement',
    'prototype',
    'manual',
    'observation',
    'codeMap',
    'knowledge',
  ]),
  locator: z.string().min(1).max(2000),
  scope: z.string().max(2000),
  basis: z.enum(['pending', 'observed', 'confirmed']),
  limitations: z.string().max(4000),
  disclosure: z.enum(['notGranted', 'allowed']),
  permissionNote: z.string().max(4000),
});
export const draftSchema = z
  .strictObject({
    localId,
    sourceIds: z.array(id).max(100),
    operation: z.enum(['upsert', 'explicitDelete']),
    content: contentSchema.nullable(),
    platform: z.strictObject({ entryId: id, baseRevisionId: id }).nullable(),
    resolvedBySelectionId: id.nullable().default(null),
  })
  .superRefine((draft, context) => {
    if (draft.operation === 'upsert' && !draft.content)
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: '修改/新增需要正文',
      });
    if (draft.operation === 'explicitDelete' && !draft.platform)
      context.addIssue({
        code: 'custom',
        path: ['platform'],
        message: '删除必须有明确正式身份/基准',
      });
  });
export type Draft = z.infer<typeof draftSchema>;
const intent = z.strictObject({
  intentId: id,
  commandId: id,
  operation: z.literal('knowledge.compare'),
  args: z.record(z.string(), z.json()),
  argsDigest: sha,
  state: z.enum([
    'prepared',
    'dispatching',
    'completed',
    'rejected',
    'unknown',
  ]),
  failureCode: z.string().nullable(),
  comparisonId: id.nullable(),
});
export const workSchema = z
  .strictObject({
    schemaVersion: z.literal('ath.knowledge-work.v1'),
    workId: id,
    projectId: id,
    spaceId: id,
    revision: z.number().int().min(0),
    sources: z.array(draftSourceSchema).max(1000),
    drafts: z.array(draftSchema).max(100),
    intents: z.array(intent).max(500),
    comparisons: z.array(z.json()).max(100),
    selectionReceipts: z.array(z.json()).max(500),
    selectionPages: z
      .array(
        z.strictObject({
          comparisonId: id,
          scopeDigest: sha,
          afterSelectionId: id.nullable(),
          limit: z.number().int().min(1).max(50),
          selectionIds: z.array(id).max(50),
          hasMore: z.boolean(),
          nextCursor: id.nullable(),
        }),
      )
      .max(500)
      .optional(),
    mappings: z
      .array(
        z.strictObject({
          localId,
          entryId: id,
          baseRevisionId: id,
          deleted: z.boolean(),
          comparisonId: id,
          selectionId: id,
        }),
      )
      .max(1000),
  })
  .superRefine((work, context) => {
    const groups: [string, string[]][] = [
      ['sources', work.sources.map((value) => value.sourceId)],
      ['drafts', work.drafts.map((value) => value.localId)],
      ['intents', work.intents.map((value) => value.intentId)],
      ['commandIds', work.intents.map((value) => value.commandId)],
      ['mappings', work.mappings.map((value) => value.localId)],
    ];
    for (const [path, values] of groups)
      if (new Set(values).size !== values.length)
        context.addIssue({
          code: 'custom',
          path: [path],
          message: '工作身份不可重复或按位置重建',
        });
    for (const draft of work.drafts)
      if (
        new Set(draft.sourceIds).size !== draft.sourceIds.length ||
        draft.sourceIds.some(
          (sourceId) =>
            !work.sources.some((source) => source.sourceId === sourceId),
        )
      )
        context.addIssue({
          code: 'custom',
          path: ['drafts'],
          message: '提案来源需要已登记的精确身份，不重复或猜测来源',
        });
  });
export type Work = z.infer<typeof workSchema>;
