import { NodeWorkspace } from './node-workspace.js';
import { WorkStore } from './work-store.js';
import { KnowledgeWorkflow } from './workflow.js';
import type { ToolPort, ResultPort } from './ports.js';
export async function createLocalAdapter(input: {
  privateWorkRoot: string;
  protectedRoots?: string[];
  tools: ToolPort;
  results: ResultPort;
}) {
  return {
    workflow: new KnowledgeWorkflow(input.tools, input.results),
    store: new WorkStore(
      await NodeWorkspace.open(input.privateWorkRoot, input.protectedRoots),
    ),
  };
}
