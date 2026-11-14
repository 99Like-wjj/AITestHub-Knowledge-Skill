import { z } from 'zod';
import snapshot from './contracts/knowledge.13a8a1d7.snapshot.json' with { type: 'json' };
import { fail } from './errors.js';

/** Generated official structural snapshots; refinements/current permissions remain server authority. */
export const contractProvenance = Object.freeze({
  protocolVersion: snapshot.protocolVersion,
  sourceHashes: snapshot.sourceHashes,
  sourceFiles: snapshot.sourceFiles,
});
type JsonSchemaInput = Parameters<typeof z.fromJSONSchema>[0];
type SchemaNode = { [key: string]: unknown };
function branches(raw: unknown, definitions: unknown): [string, z.ZodType][] {
  const node = raw as SchemaNode;
  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
    if (
      Object.keys(node).some(
        (key) => !['$schema', 'type', '$defs', 'anyOf', 'oneOf'].includes(key),
      ) ||
      (node.type !== undefined && node.type !== 'object')
    )
      return fail(
        'CONTRACT_WRAPPER_UNSUPPORTED',
        '未支持的工具契约wrapper，不猜测或宽松验证。',
      );
    const alternatives = (node.anyOf ?? node.oneOf) as unknown[];
    return alternatives.flatMap((child) =>
      branches(child, definitions ?? node.$defs),
    );
  }
  const op = (node.properties as SchemaNode | undefined)?.op as
    SchemaNode | undefined;
  if (
    typeof op?.const !== 'string' ||
    node.type !== 'object' ||
    node.additionalProperties !== false
  )
    return fail(
      'CONTRACT_BRANCH_UNSUPPORTED',
      '工具分支必须明确op并禁止额外属性。',
    );
  return [
    [
      op.const,
      z.fromJSONSchema({
        ...node,
        ...(definitions ? { $defs: definitions } : {}),
      } as JsonSchemaInput),
    ],
  ];
}
const tools = new Map(
  Object.entries(snapshot.tools).map(([name, schema]) => {
    const grouped = new Map<string, z.ZodType[]>();
    for (const [op, branch] of branches(schema, (schema as SchemaNode).$defs))
      grouped.set(op, [...(grouped.get(op) ?? []), branch]);
    return [
      name,
      new Map(
        [...grouped].map(([op, alternatives]) => [op, z.union(alternatives)]),
      ),
    ];
  }),
);
const components = new Map(
  Object.entries(snapshot.schemas).map(([name, schema]) => [
    name,
    z.fromJSONSchema(schema as JsonSchemaInput),
  ]),
);
export function officialSchema<T>(name: string): z.ZodType<T> {
  const schema = components.get(`knowledge.${name}`);
  if (!schema)
    return fail('CONTRACT_UNAVAILABLE', '此包未包含所需官方知识结构契约。');
  return schema as z.ZodType<T>;
}
export function validateOfficialArguments(name: string, args: unknown): void {
  const operations = tools.get(name);
  if (!operations)
    return fail('TOOL_NOT_ALLOWED', '此领域适配器未声明此工具。');
  const op =
    args && typeof args === 'object' && !Array.isArray(args) && 'op' in args
      ? args.op
      : undefined;
  const schema = typeof op === 'string' ? operations.get(op) : undefined;
  if (!schema?.safeParse(args).success)
    return fail(
      'OFFICIAL_ARGUMENTS_INVALID',
      '参数不符合包内固定官方工具分支契约，未发送。',
    );
}
