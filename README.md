# AITestHub-Knowledge-Skill

Skill ID: ath-project-knowledge. AI extracts project maps, rules and knowledge. Deterministic helpers maintain explicit scope, drafts, comparison identities, original receipts and CAS revisions; they do not call a model or merge silently.

The entry point and referenced content/workflow/runtime documentation are under skills/ath-project-knowledge/. Visual comparison and human choices stay in AITestHub.

    pnpm install --frozen-lockfile --ignore-scripts
    pnpm typecheck
    pnpm build
    pnpm package
    pnpm verify:package

Real material, workspaces and credentials stay outside Git. Native installation/loading and the live permission/file/recovery matrix require separate validation.

See SECURITY.md and SOURCE_PUBLICATION.md.

Test source and test-only scripts are retained separately in the private local workspace.

## Development standards

Read [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md) and the [current development standards](docs/development/README.md) before changing code, configuration or packaging.

Run pnpm quality:check for source/document formatting and strict type checks. Architecture, privacy and behavior still require the [review checklist](docs/development/review-checklist.md); this command does not establish deployment or live acceptance.

Private operational history remains in the ignored AGENTS.local.md when present. Generic engineering standards may be versioned; private product design, tests, instances and real evidence remain excluded.
