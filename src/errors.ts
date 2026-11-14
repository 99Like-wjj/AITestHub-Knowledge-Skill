export class KnowledgeWorkError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'KnowledgeWorkError';
  }
}
export function fail(code: string, message: string): never {
  throw new KnowledgeWorkError(code, message);
}
export function safeFailure(error: unknown): {
  code: string;
  certainty: 'notDispatched' | 'knownFailed' | 'unknown';
} {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{1,80}$/.test(error.code) &&
    'certainty' in error &&
    ['notDispatched', 'knownFailed', 'unknown'].includes(
      String(error.certainty),
    )
  ) {
    return {
      code: error.code,
      certainty: error.certainty as 'notDispatched' | 'knownFailed' | 'unknown',
    };
  }
  return { code: 'TOOL_RESULT_UNKNOWN', certainty: 'unknown' };
}
