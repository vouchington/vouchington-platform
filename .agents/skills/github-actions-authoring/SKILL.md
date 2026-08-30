---
name: github-actions-authoring
description: Platform adapter for portable event-driven GitHub Actions authoring.
---

# Vouchington platform GitHub Actions authoring

Read `node_modules/vouchington-tooling/skills/github-actions-checklist/SKILL.md` first, then apply
`node_modules/vouchington-tooling/skills/github-actions-authoring/SKILL.md`.

Use the platform's correlated `workflow_run` to `repository_dispatch` final-review graph for
cross-workflow CI completion. Every concrete platform job and phase is bounded to 30 minutes or
less, and repository-backed actions use immutable SHA pins with version comments.
