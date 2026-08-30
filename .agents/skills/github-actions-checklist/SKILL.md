---
name: github-actions-checklist
description: Platform adapter for the portable GitHub Actions checklist.
---

# Vouchington platform GitHub Actions checklist

Read and apply `node_modules/vouchington-tooling/skills/github-actions-checklist/SKILL.md`.

This public repository uses GitHub-hosted runners. `pull_request_target` is limited to base-owned
orchestration: lifecycle cleanup, labeler, and narrowly scoped dependency-bot automation. Do not
check out or execute pull-request content in those workflows. Required checks remain stable through
bounded fan-in jobs or the selected-head `Code Reviewed` synthetic check.
