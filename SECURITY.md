# Repository data and publication boundary

Implementation source, necessary build/runtime/operations code, portable configuration templates, generic development standards, required licenses and referenced Skill rules may belong in Git.

Test directories, test-only code/runners/fixtures and private test-command manifests stay local. Necessary build, startup, migration, configuration and backup/recovery tools are not test runners merely because they are scripts.

Keep real instance profiles, AGENTS.local.md, credentials, environment files, passwords/tokens/cookies/private keys, backups, company project material, runtime data, evidence, private design/review/handoff records and historical release archives outside Git.

Credentials use restricted files or the configured broker. Instance metadata and secret values are separate. Templates contain placeholders, not edited copies of live profiles.

Review exact proposed paths and contents before committing. A private repository is still an external destination; ignore rules and pattern scans are supporting controls, not proof that every secret or private name has been detected.

Read [CONTRIBUTING.md](CONTRIBUTING.md), [configuration rules](docs/development/configuration.md) and [review checklist](docs/development/review-checklist.md) before changing these boundaries.
