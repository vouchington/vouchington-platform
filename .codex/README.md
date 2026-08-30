# Codex configuration

Install the upstream Agent Blackboard plugin once in the Codex environment. It provides the
session skill and MCP server without copying provider-specific files into this repository:

```sh
codex plugin marketplace add jonathanong/agent-blackboard
codex plugin add agent-blackboard@agent-blackboard
```

Set `AGENT_BLACKBOARD_URL` and `AGENT_BLACKBOARD_TOKEN` before starting Codex. The tracked
`.codex/config.toml` enables the plugin and auto-approves only the eight current tools. The
project-scoped Claude registration remains separately pinned to `agent-blackboard@0.5.0`.
