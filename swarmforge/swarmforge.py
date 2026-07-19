#!/usr/bin/env python3
"""Open a herdr workspace with one pane per claude agent.

Each pane starts `claude` with an initial prompt that points it at the
matching agent definition in .claude/agents/ via an @-file reference, plus
a briefing on how to reach its peers directly via `herdr agent`.
"""

import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

try:
    import termios
    import tty
except ImportError:  # pragma: no cover - non-POSIX platforms
    termios = None
    tty = None

REPO_ROOT = Path(__file__).resolve().parent
CLAUDE_AGENTS_DIR = REPO_ROOT / ".claude" / "agents"
OPENCODE_AGENTS_DIR = REPO_ROOT / ".opencode" / "agents"
WORKSPACE_LABEL = "swarmforge"
CLI_TOOLS = ["claude", "opencode"]

BANNER = r"""
╔═══════════════════════════════════════════════╗
║           SwarmForge v1.0 Starting            ║
║   Disciplined agents build better software    ║
╚═══════════════════════════════════════════════╝
"""

def print_banner(print_func=print) -> None:
    print_func(BANNER)


def discover_agents(agents_dir: Path) -> list:
    return sorted(
        ((path.stem, path) for path in agents_dir.glob("*.md")),
        key=lambda item: item[0],
    )


def _menu_lines(agents: list, selected: set, cursor: int) -> list:
    lines = ["Select agents to launch  (↑/↓ move · space toggle · enter confirm):"]
    for i, (name, _) in enumerate(agents):
        pointer = "➡️" if i == cursor else " "
        mark = "✅" if name in selected else "❌"
        lines.append(f"{pointer} {mark} {name}")
    return lines


def _read_key(stream=None) -> str:
    stream = stream or sys.stdin
    fd = stream.fileno()
    old_settings = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        ch = stream.read(1)
        if ch == "\x03":
            raise KeyboardInterrupt
        if ch == "\x1b":
            rest = stream.read(2)
            if rest == "[A":
                return "up"
            if rest == "[B":
                return "down"
            return ""
        if ch == " ":
            return "space"
        if ch in ("\r", "\n"):
            return "enter"
        return ch
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)


def _clear_lines(count: int) -> None:
    if count:
        sys.stdout.write(f"\x1b[{count}A\x1b[J")
        sys.stdout.flush()


def prompt_agent_selection(
    agents: list,
    key_func=_read_key,
    print_func=print,
    clear_func=None,
) -> list:
    selected = {name for name, _ in agents}
    cursor = 0
    prev_line_count = 0

    def render():
        nonlocal prev_line_count
        lines = _menu_lines(agents, selected, cursor)
        if clear_func:
            clear_func(prev_line_count)
        for line in lines:
            print_func(line)
        prev_line_count = len(lines)

    render()
    while True:
        key = key_func()
        if key == "up":
            cursor = (cursor - 1) % len(agents)
            render()
        elif key == "down":
            cursor = (cursor + 1) % len(agents)
            render()
        elif key == "space":
            name = agents[cursor][0]
            selected.symmetric_difference_update({name})
            render()
        elif key == "enter":
            if selected:
                return [pair for pair in agents if pair[0] in selected]
            print_func("At least one agent must be selected.")
            render()


def prompt_cli_tool_selection(
    tools: list = CLI_TOOLS,
    key_func=_read_key,
    print_func=print,
    clear_func=None,
) -> str:
    cursor = 0
    prev_line_count = 0

    def render():
        nonlocal prev_line_count
        lines = ["Select coding agent CLI  (↑/↓ move · enter confirm):"]
        for i, name in enumerate(tools):
            mark = "🟢" if i == cursor else "🔴"
            lines.append(f"{mark} {name}")
        if clear_func:
            clear_func(prev_line_count)
        for line in lines:
            print_func(line)
        prev_line_count = len(lines)

    render()
    while True:
        key = key_func()
        if key == "up":
            cursor = (cursor - 1) % len(tools)
            render()
        elif key == "down":
            cursor = (cursor + 1) % len(tools)
            render()
        elif key == "enter":
            return tools[cursor]


def ensure_herdr_installed() -> None:
    if shutil.which("herdr") is None:
        sys.exit("herdr is not installed. Download it from https://herdr.dev")


def herdr_json(*args: str) -> dict:
    result = subprocess.run(["herdr", *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"herdr {' '.join(args)} failed: {result.stderr.strip()}")
    return json.loads(result.stdout)["result"]


def herdr(*args: str) -> None:
    result = subprocess.run(["herdr", *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"herdr {' '.join(args)} failed: {result.stderr.strip()}")


def server_running() -> bool:
    result = subprocess.run(["herdr", "status"], capture_output=True, text=True)
    return result.returncode == 0 and "status: running" in result.stdout


def ensure_server_running() -> None:
    if server_running():
        return
    subprocess.Popen(
        ["herdr", "server"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    for _ in range(50):
        if server_running():
            return
        time.sleep(0.2)
    sys.exit("Timed out waiting for herdr server to start.")


def close_existing_herdr_workspaces() -> None:
    """Close any workspace left running from a previous launch of this script.

    Matches on a label prefix rather than exact equality so stale workspaces
    from earlier label conventions (e.g. "herdr-agents") are cleaned up too.
    """
    for workspace in herdr_json("workspace", "list")["workspaces"]:
        if workspace["label"].startswith(WORKSPACE_LABEL):
            herdr("workspace", "close", workspace["workspace_id"])


def peer_briefing(self_name: str, agents: list) -> str:
    peers = [name for name, _ in agents if name != self_name]
    return (
        f"Your peers this run: {', '.join(peers)} — separate Claude Code "
        f"sessions in sibling `herdr` panes, not subagents of yours. To "
        f"message one: `herdr agent send <Name> \"<message>\"` then `herdr "
        f"pane send-keys <Name> Enter` to submit it. To wait for their reply: "
        f"`herdr agent wait <Name> --status idle --timeout 120000`, then read "
        f"it with `herdr pane read <Name> --source recent --lines 60`. If "
        f"multiple herdr workspaces are running at once, plain names may be "
        f"ambiguous — use `herdr agent list` to find the right pane id and "
        f"target that instead."
    )


def build_system_prompt(name: str, path: Path, agents: list) -> str:
    """Combine an agent's definition file with its peer briefing.

    Passed whole to `claude --append-system-prompt` so the agent's role is
    established invisibly, instead of as a visible first user message.
    `--append-system-prompt` and `--append-system-prompt-file` are mutually
    exclusive, and the briefing is generated per-agent, so both pieces are
    concatenated in Python rather than passed as separate flags.
    """
    role_definition = path.read_text().rstrip("\n")
    return f"{role_definition}\n\n{peer_briefing(name, agents)}"


def write_opencode_agent(name: str, system_prompt: str) -> None:
    """Write `system_prompt` as a project-local opencode agent definition.

    opencode has no `--append-system-prompt` flag. Its equivalent is a
    named agent file under `.opencode/agents/<name>.md` (YAML frontmatter
    + prompt body), auto-discovered from the project it's run in and
    selected with `--agent <name>` — so it carries the same role as a
    system prompt, rather than just an initial chat message.
    """
    OPENCODE_AGENTS_DIR.mkdir(parents=True, exist_ok=True)
    frontmatter = f"---\ndescription: SwarmForge {name} agent.\nmode: primary\n---\n"
    (OPENCODE_AGENTS_DIR / f"{name}.md").write_text(frontmatter + system_prompt)


def main() -> None:
    print_banner()
    ensure_herdr_installed()

    agents = discover_agents(CLAUDE_AGENTS_DIR)
    if not agents:
        sys.exit(f"No agent definition files found in {CLAUDE_AGENTS_DIR}")

    cli_tool = prompt_cli_tool_selection(clear_func=_clear_lines)
    selected = prompt_agent_selection(agents, clear_func=_clear_lines)

    ensure_server_running()
    close_existing_herdr_workspaces()

    created = herdr_json(
        "workspace", "create",
        "--cwd", str(REPO_ROOT),
        "--label", WORKSPACE_LABEL,
        "--no-focus",
    )
    workspace_id = created["workspace"]["workspace_id"]
    pane_ids = [created["root_pane"]["pane_id"]]

    for _ in selected[1:]:
        split = herdr_json(
            "pane", "split", pane_ids[-1],
            "--direction", "right",
            "--cwd", str(REPO_ROOT),
            "--no-focus",
        )
        pane_ids.append(split["pane"]["pane_id"])

    prompts_dir = Path(tempfile.mkdtemp(prefix="swarmforge-prompts-"))

    for pane_id, (name, path) in zip(pane_ids, selected):
        herdr("pane", "rename", pane_id, name)
        system_prompt = build_system_prompt(name, path, selected)
        if cli_tool == "opencode":
            write_opencode_agent(name, system_prompt)
            cmd = f"opencode --agent {shlex.quote(name)} "
        else:
            prompt_file = prompts_dir / f"{name}.txt"
            prompt_file.write_text(system_prompt)
            cmd = f"claude --append-system-prompt-file {shlex.quote(str(prompt_file))} "
        herdr("pane", "run", pane_id, cmd)

    herdr("workspace", "focus", workspace_id)

    os.execvp("herdr", ["herdr"])


if __name__ == "__main__":
    main()
