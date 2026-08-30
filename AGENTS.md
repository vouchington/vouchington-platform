# Agent notes

See [CLAUDE.md](CLAUDE.md).

## Agent Blackboard

Use the upstream `agent-blackboard` plugin together with the `vouchington-workflow:blackboard`
skill for session journaling. Session ids, agent/version identities, and parent-session ids must
be explicit; never infer or generate them from host state. Use only the client credential supplied
by `AGENT_BLACKBOARD_TOKEN` with `AGENT_BLACKBOARD_URL`; fail closed when either credential is
missing, malformed, or unavailable, and never substitute an admin credential.
