import {
  open,
  readFile,
  rename,
  mkdir,
  lstat,
  unlink,
  readdir,
} from 'node:fs/promises';
import { dirname, isAbsolute, parse, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { WorkspacePort } from './ports.js';
import { fail } from './errors.js';

const absent = (error: unknown) =>
  Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT',
  );
function inside(root: string, target: string) {
  const path = relative(root, target);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}
function ownRoot() {
  let path = dirname(fileURLToPath(import.meta.url));
  while (dirname(path) !== path) {
    if (
      existsSync(resolve(path, 'SKILL.md')) ||
      existsSync(resolve(path, 'package.json'))
    )
      return path;
    path = dirname(path);
  }
  return dirname(fileURLToPath(import.meta.url));
}
export class NodeWorkspace implements WorkspacePort {
  private constructor(readonly root: string) {}
  static async open(
    root: string,
    protectedRoots: string[] = [],
  ): Promise<NodeWorkspace> {
    if (!isAbsolute(root))
      return fail(
        'ABSOLUTE_WORKSPACE_REQUIRED',
        '工作目录必须是显式库外绝对路径。',
      );
    const resolved = resolve(root),
      self = ownRoot();
    if (
      resolved === parse(resolved).root ||
      [self, ...protectedRoots.map((path) => resolve(path))].some((path) =>
        inside(path, resolved),
      )
    )
      return fail(
        'PROTECTED_WORKSPACE',
        '工作稿不能写入Skill/源码/受保护目录。',
      );
    await NodeWorkspace.noLinks(resolved);
    await mkdir(resolved, { recursive: true, mode: 0o700 });
    await NodeWorkspace.noLinks(resolved);
    const marker = resolve(resolved, '.ath-knowledge-workspace.json'),
      entries = await readdir(resolved);
    if (!entries.includes('.ath-knowledge-workspace.json')) {
      if (entries.length)
        return fail(
          'UNMANAGED_WORKSPACE',
          '未知非空目录或旧库不能初始化为工作目录，原文件未动。',
        );
      const handle = await open(marker, 'wx', 0o600);
      try {
        await handle.writeFile(
          JSON.stringify({
            schemaVersion: 'ath.knowledge-workspace.v1',
            workspaceId: randomUUID(),
          }),
          'utf8',
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
    } else {
      await NodeWorkspace.noLinks(marker);
      let current: { schemaVersion?: string; workspaceId?: string };
      try {
        current = JSON.parse(await readFile(marker, 'utf8')) as typeof current;
      } catch {
        return fail(
          'INVALID_WORKSPACE_MARKER',
          '工作目录标记损坏，不重建或回显内容。',
        );
      }
      if (
        current.schemaVersion !== 'ath.knowledge-workspace.v1' ||
        typeof current.workspaceId !== 'string'
      )
        return fail('INVALID_WORKSPACE_MARKER', '工作目录标记不符，未重建。');
    }
    return new NodeWorkspace(resolved);
  }
  private static async noLinks(path: string): Promise<void> {
    const root = parse(path).root;
    let cursor = path;
    while (cursor !== root) {
      try {
        const info = await lstat(cursor);
        if (info.isSymbolicLink() || (!info.isDirectory() && info.nlink > 1))
          return fail(
            'LINKED_WORKSPACE_PATH',
            '工作路径不接受符号链接或硬链接绕行。',
          );
      } catch (error) {
        if (!absent(error)) throw error;
      }
      cursor = dirname(cursor);
    }
  }
  private async path(key: string) {
    if (
      !/^[A-Za-z0-9._/-]{1,240}$/.test(key) ||
      key.split('/').some((part) => !part || part === '..' || part === '.') ||
      isAbsolute(key)
    )
      return fail('INVALID_WORKSPACE_KEY', '工作文件只接受根内相对键。');
    const target = resolve(this.root, key);
    if (!inside(this.root, target))
      return fail('WORKSPACE_ESCAPE', '工作文件越过指定目录。');
    await NodeWorkspace.noLinks(target);
    return target;
  }
  async readText(key: string): Promise<string | null> {
    const path = await this.path(key);
    try {
      const info = await lstat(path);
      if (info.size > 32 * 1024 * 1024)
        return fail('WORK_FILE_TOO_LARGE', '工作文件超限，未读取正文。');
      return await readFile(path, 'utf8');
    } catch (error) {
      if (absent(error)) return null;
      throw error;
    }
  }
  async writeTextAtomic(key: string, text: string): Promise<void> {
    if (Buffer.byteLength(text) > 32 * 1024 * 1024)
      return fail('WORK_FILE_TOO_LARGE', '工作文件超限，未保存。');
    const target = await this.path(key);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await NodeWorkspace.noLinks(target);
    const temporary = target + '.part-' + randomUUID(),
      handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await NodeWorkspace.noLinks(target);
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }
  private lockKey(key: string) {
    return 'locks/' + createHash('sha256').update(key).digest('hex') + '.json';
  }
  async withExclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    const lockKey = this.lockKey(key),
      lockPath = await this.path(lockKey);
    await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
    const lockId = randomUUID();
    let handle;
    try {
      handle = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'EEXIST'
      )
        return fail('WORKSPACE_BUSY', '已有本地写入者，未自动重试或删除其锁。');
      throw error;
    }
    try {
      await handle.writeFile(
        JSON.stringify({ lockId, pid: process.pid }),
        'utf8',
      );
      await handle.sync();
      return await work();
    } finally {
      await handle.close();
      const current = await this.readText(lockKey);
      if (
        current &&
        (JSON.parse(current) as { lockId?: string }).lockId === lockId
      )
        await unlink(lockPath);
    }
  }
  async inspectLock(
    key: string,
  ): Promise<{ lockId: string; pid: number; ownerAlive: boolean } | null> {
    const text = await this.readText(this.lockKey(key));
    if (!text) return null;
    const record = JSON.parse(text) as { lockId: string; pid: number };
    if (
      !Number.isSafeInteger(record.pid) ||
      record.pid <= 0 ||
      typeof record.lockId !== 'string'
    )
      return fail('INVALID_WORKSPACE_LOCK', '锁元数据无效，未删除。');
    let ownerAlive = true;
    try {
      process.kill(record.pid, 0);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ESRCH'
      )
        ownerAlive = false;
    }
    return { ...record, ownerAlive };
  }
  async releaseAbandonedLock(
    key: string,
    expectedLockId: string,
  ): Promise<void> {
    const record = await this.inspectLock(key);
    if (!record || record.lockId !== expectedLockId || record.ownerAlive)
      return fail(
        'LOCK_RECOVERY_REFUSED',
        '锁身份不符或进程仍在，未强行解锁。',
      );
    await unlink(await this.path(this.lockKey(key)));
  }
}
