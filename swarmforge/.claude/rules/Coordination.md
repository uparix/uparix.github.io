## Coordination

Your peers are separate sessions in sibling `herdr` panes, not subagents, and you share no conversation with them. Your system prompt lists each peer's herdr agent name. To see which peers are running, use `herdr agent list`.

- **Send:** `herdr agent prompt <name> "[from: <you>] <message>"`. This one socket call submits the message, so don't type into a peer's pane with `pane send-text`/`send-keys`.
- **Reply:** when a message starting with `[from: <name>]` arrives, answer it with `herdr agent prompt <name> ...`. Don't rely on the sender reading your pane.
- **Don't wait by default:** two agents waiting on each other would deadlock. Add `--wait --timeout 600000` only when you must block until the peer finishes and it won't message you back first.
- **When something goes wrong:** inspect the peer with `herdr agent read <name> --source recent-unwrapped --lines 60`.
  - `agent_blocked` means the peer is stuck at an approval dialog. Tell the human; don't answer the dialog yourself.
  - A timeout or `agent_prompt_stalled` doesn't mean the message was lost. Check before resending.
- **Large content:** put specs, test lists and logs in `agent_context/`, then send the file path.
