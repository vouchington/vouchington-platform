# Claude Code configuration

Claude Code uses the project-scoped [`../.mcp.json`](../.mcp.json) registration, enabled by
`enabledMcpjsonServers`. It runs the published Agent Blackboard MCP server at the pinned
`agent-blackboard@0.5.0` version. Export
`AGENT_BLACKBOARD_URL` and `AGENT_BLACKBOARD_TOKEN` before starting Claude Code.

The project settings pre-authorize only the eight current Agent Blackboard tools. Session ids,
agent names, and parent-session ids remain explicit inputs; the server must not infer them.
