# Repository data boundary

Only implementation source, portable templates, synthetic tests and runtime Skill references belong in Git.
Keep instance profiles, environment files, passwords/tokens/cookies/private keys, backups, real project content, evidence and design/handoff material outside Git.
Credentials are read from restricted files or the configured broker; no credential values belong in configuration templates.
Review exact staged paths and contents before committing; private repositories remain external destinations.
