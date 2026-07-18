## Coordination

- Your peers are separate Claude Code sessions running in sibling `herdr` panes — not subagents. There is no shared conversation between you.
- To message a peer directly by name: `herdr agent send <Name> "<message>"` then `herdr pane send-keys <Name> Enter` to submit it. This types into their pane exactly as if a human had typed and pressed Enter.
- To wait for their reply and then read it: `herdr agent wait <Name> --status idle --timeout 120000`, then `herdr pane read <Name> --source recent --lines 60`.
- `<Name>` works as long as it's unique. If multiple herdr workspaces are running at once (check with `herdr agent list`), names can collide — target the specific pane id instead (e.g. `wQ:p3`).
- Prefix messages you send with something like `[Architect]` so the recipient can tell it's an inter-agent message rather than a human prompt.
- Shared files in agent_context/ can be used for passing larger artifacts between agents.