import { createHash } from 'node:crypto';
import { fail } from './errors.js';
export function canonical(value: unknown): string {
  let nodes = 0;
  const normalize = (item: unknown, depth: number): unknown => {
    if (++nodes > 500000 || depth > 64)
      fail('STATE_TOO_COMPLEX', '工作状态超出结构限制。');
    if (item === null || typeof item === 'string' || typeof item === 'boolean')
      return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item))
      return item.map((child) => normalize(child, depth + 1));
    if (
      item &&
      typeof item === 'object' &&
      Object.getPrototypeOf(item) === Object.prototype
    ) {
      const entries = Object.entries(item).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      );
      if (
        entries.some(([key]) =>
          ['__proto__', 'prototype', 'constructor'].includes(key),
        )
      )
        fail('INVALID_STATE_KEY', '工作状态含不支持的对象键。');
      return Object.fromEntries(
        entries.map(([key, child]) => [key, normalize(child, depth + 1)]),
      );
    }
    return fail('NON_JSON_STATE', '工作状态只能包含完整JSON值。');
  };
  return JSON.stringify(normalize(value, 0));
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
