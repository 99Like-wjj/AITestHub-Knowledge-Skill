#!/usr/bin/env node
// Only local work transactions; MCP integration is injected by the host.
import { existsSync } from 'node:fs';
const packaged = new URL('../runtime/src/cli.js', import.meta.url);
const source = new URL('../../../dist/src/cli.js', import.meta.url);
const entry = existsSync(packaged) ? packaged : existsSync(source) ? source : null;
if (!entry) {
  process.stderr.write('{"ok":false,"error":{"code":"RUNTIME_NOT_BUILT"}}\n');
  process.exitCode = 1;
} else {
  const { main } = await import(entry.href);
  await main();
}
