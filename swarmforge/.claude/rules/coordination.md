## Coordination

- Your peers are separate Claude Code sessions running in sibling `herdr` panes — not subagents. There is no shared conversation between you.
- At the start of each session (or before messaging), run `herdr agent list` to capture every peer's **pane_id** (e.g. `w1H:p2`). Store these IDs and reuse them — this is the most reliable targeting method.
- To message a peer: `herdr agent send <pane_id> "<message>"` then `herdr pane send-keys <pane_id> Enter` to submit. This types into their pane exactly as if a human had typed and pressed Enter.
- **Do NOT rely on `<Name>` alone** for `herdr pane send-keys` — it may succeed with `agent send` but fail on the submit step with `pane_not_found`. Use `<Name>` only for `agent send` when you've already captured the pane_id.
- To wait for their reply and then read it: `herdr agent wait <pane_id> --status idle --timeout 120000`, then `herdr pane read <pane_id> --source recent --lines 60`.
- If multiple herdr workspaces are running at once, names can collide — pane_id is always unique.
- Prefix messages you send with something like `[Architect]` so the recipient can tell it's an inter-agent message rather than a human prompt.
- Shared files in agent_context/ can be used for passing larger artifacts between agents.

### Quick reference: messaging a peer
```bash
# 1. Discover pane IDs (run once per session)
herdr agent list

# 2. Send a message to Coder (example pane_id: w1H:p2)
herdr agent send w1H:p2 "[Architect] Hello, please implement X" && herdr pane send-keys w1H:p2 Enter

# 3. Wait for reply
herdr agent wait w1H:p2 --status idle --timeout 120000

# 4. Read their response
herdr pane read w1H:p2 --source recent --lines 60
```