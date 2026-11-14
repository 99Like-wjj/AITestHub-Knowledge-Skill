import { WorkStore } from './work-store.js';
import { KnowledgeWorkflow } from './workflow.js';
import type { ToolPort, ResultPort, WorkspacePort } from './ports.js';
export function createPlatformAdapter(input: {
  workspace: WorkspacePort;
  tools: ToolPort;
  results: ResultPort;
}) {
  return {
    workflow: new KnowledgeWorkflow(input.tools, input.results),
    store: new WorkStore(input.workspace),
  };
}
