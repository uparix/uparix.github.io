#!/usr/bin/env python3
"""Open a herdr workspace with one pane per agent.

Each pane starts the chosen coding CLI (claude or opencode) with the
matching agent definition from .claude/agents/ as its system prompt, plus
a briefing on how to reach its peers over herdr's socket API via
`herdr agent prompt`.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import Sequence
from pathlib import Path
from typing import NamedTuple

try:
    import termios
    import tty
except ImportError:  # pragma: no cover - non-POSIX platforms
    termios = None
    tty = None

REPO_ROOT = Path(__file__).resolve().parent
CLAUDE_AGENTS_DIR = REPO_ROOT / ".claude" / "agents"
OPENCODE_AGENTS_DIR = REPO_ROOT / ".opencode" / "agents"
OPENCODE_AGENT_PREFIX = "swarmforge-"
PROMPT_DIR = Path(tempfile.gettempdir()) / "swarmforge"
# Short, stable id for this project, so swarms launched from different
# projects on the same herdr server keep their workspaces and agent names
# apart — herdr agent names must be unique among all live agents.
PROJECT_TAG = hashlib.sha1(str(REPO_ROOT).encode()).hexdigest()[:6]
WORKSPACE_LABEL = f"swarmforge-{REPO_ROOT.name}-{PROJECT_TAG}"
HERDR_NAME_MAX_LEN = 32
CLI_TOOLS = ["claude", "opencode"]

AGENT_START_TIMEOUT_S = 10
AGENT_START_RETRY_S = 0.3
SERVER_START_TIMEOUT_S = 10
SERVER_POLL_S = 0.2

ESCAPE_KEYS = {"\x1b[A": "up", "\x1b[B": "down"}

BANNER = r"""
╔═══════════════════════════════════════════════╗
║           SwarmForge v1.0 Starting            ║
║   Disciplined agents build better software    ║
╚═══════════════════════════════════════════════╝
"""


class Agent(NamedTuple):
    name: str
    path: Path
    slug: str


def print_banner(print_func=print) -> None:
    print_func(BANNER)


def discover_agents(agents_dir: Path) -> list[Agent]:
    return sorted(
        (Agent(path.stem, path, herdr_agent_slug(path.stem)) for path in agents_dir.glob("*.md")),
        key=lambda agent: agent.name,
    )


def _menu_lines(title: str, labels: list[str], cursor: int, checked: set[int] | None) -> list[str]:
    lines = [title]
    for i, label in enumerate(labels):
        pointer = "➡️" if i == cursor else " "
        mark = "" if checked is None else ("✅ " if i in checked else "❌ ")
        lines.append(f"{pointer} {mark}{label}")
    return lines


def _read_key(stream=None) -> str:
    """Read one keypress from the terminal in raw mode.

    Reads up to 3 bytes at once instead of one at a time, so an arrow key's
    escape sequence arrives whole and a lone Esc returns right away rather
    than blocking until two more characters are typed.
    """
    stream = stream or sys.stdin
    fd = stream.fileno()
    old_settings = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        data = os.read(fd, 3).decode(errors="ignore")
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)
    if data == "\x03":
        raise KeyboardInterrupt
    if data.startswith("\x1b"):
        return ESCAPE_KEYS.get(data, "")
    ch = data[:1]
    if ch == " ":
        return "space"
    if ch in ("\r", "\n"):
        return "enter"
    return ch


def _clear_lines(count: int) -> None:
    if count:
        sys.stdout.write(f"\x1b[{count}A\x1b[J")
        sys.stdout.flush()


def _run_menu(
    title: str,
    labels: list[str],
    checked: set[int] | None,
    key_func,
    print_func,
    clear_func,
) -> int:
    """Show an arrow-key menu of `labels` and return the cursor index on enter.

    With `checked` (a set of label indices), the menu is multi-select:
    space toggles the item under the cursor, `checked` is updated in place,
    and enter is refused while nothing is checked.
    """
    cursor = 0
    prev_line_count = 0

    def render():
        nonlocal prev_line_count
        lines = _menu_lines(title, labels, cursor, checked)
        if clear_func:
            clear_func(prev_line_count)
        for line in lines:
            print_func(line)
        prev_line_count = len(lines)

    render()
    while True:
        key = key_func()
        if key in ("up", "down"):
            cursor = (cursor + (1 if key == "down" else -1)) % len(labels)
        elif key == "space" and checked is not None:
            checked.symmetric_difference_update({cursor})
        elif key == "enter":
            if checked is None or checked:
                return cursor
            print_func("Select at least one item.")
        else:
            continue
        render()


def prompt_agent_selection(
    agents: list[Agent],
    key_func=_read_key,
    print_func=print,
    clear_func=None,
) -> list[Agent]:
    checked = set(range(len(agents)))
    _run_menu(
        "Select agents to launch  (↑/↓ move · space toggle · enter confirm):",
        [agent.name for agent in agents],
        checked,
        key_func, print_func, clear_func,
    )
    return [agent for i, agent in enumerate(agents) if i in checked]


def prompt_cli_tool_selection(
    tools: list[str] = CLI_TOOLS,
    key_func=_read_key,
    print_func=print,
    clear_func=None,
) -> str:
    cursor = _run_menu(
        "Select coding agent CLI  (↑/↓ move · enter confirm):",
        tools,
        None,
        key_func, print_func, clear_func,
    )
    return tools[cursor]


def ensure_herdr_installed() -> None:
    if shutil.which("herdr") is None:
        sys.exit("herdr is not installed. Download it from https://herdr.dev")


def herdr(*args: str) -> str:
    """Run a herdr command and return its stdout, raising if it fails."""
    result = subprocess.run(["herdr", *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"herdr {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def herdr_json(*args: str) -> dict:
    return json.loads(herdr(*args))["result"]


def start_agent(slug: str, cli_tool: str, pane_id: str, agent_args: list[str]) -> None:
    """Start `cli_tool` in `pane_id`, retrying briefly on `agent_pane_busy`.

    A pane fresh out of `workspace create`/`pane split` can take a moment
    before herdr recognizes its shell as available — `agent start` fails
    instantly with `agent_pane_busy` during that window rather than waiting
    it out, so poll past it here instead of surfacing a spurious crash.
    """
    deadline = time.monotonic() + AGENT_START_TIMEOUT_S
    while True:
        try:
            herdr(
                "agent", "start", slug,
                "--kind", cli_tool,
                "--pane", pane_id,
                "--",
                *agent_args,
            )
            return
        except RuntimeError as exc:
            if "agent_pane_busy" in str(exc) and time.monotonic() < deadline:
                time.sleep(AGENT_START_RETRY_S)
                continue
            raise


def herdr_agent_slug(name: str) -> str:
    """Sanitize a display name into herdr's required agent-name format.

    herdr's `agent start` NAME must match `[a-z][a-z0-9_-]{0,31}`, but
    agent definition file stems (e.g. "Architect", "E2E-Interpreter")
    are mixed-case, so the herdr-facing identity is derived separately
    from the display name used everywhere else in this script. It ends
    in PROJECT_TAG (e.g. "architect-1a2b3c") because names must also be
    unique across every swarm on the herdr server.
    """
    slug = re.sub(r"[^a-z0-9_-]", "-", name.lower()).strip("-_")
    if not slug or not slug[0].isalpha():
        slug = f"a-{slug}" if slug else "agent"
    suffix = f"-{PROJECT_TAG}"
    return slug[:HERDR_NAME_MAX_LEN - len(suffix)] + suffix


def ensure_unique_slugs(agents: list[Agent]) -> None:
    """Exit if two agent files map to the same herdr agent name.

    Sanitizing can merge distinct file names ("E2E Interpreter.md" and
    "E2E-Interpreter.md" both become "e2e-interpreter"). herdr would
    refuse the second `agent start`, and the two would share one system
    prompt file, so stop before anything is started.
    """
    seen = {}
    for agent in agents:
        if agent.slug in seen:
            sys.exit(
                f"{seen[agent.slug].path.name} and {agent.path.name} both map to "
                f"the herdr agent name `{agent.slug}`. Rename one of them."
            )
        seen[agent.slug] = agent


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
    deadline = time.monotonic() + SERVER_START_TIMEOUT_S
    while time.monotonic() < deadline:
        if server_running():
            return
        time.sleep(SERVER_POLL_S)
    sys.exit("Timed out waiting for herdr server to start.")


def close_existing_herdr_workspaces() -> None:
    """Close the workspace left running by a previous launch in this project.

    Matches the exact per-project label, so swarms of other projects and
    the user's own workspaces are left alone.
    """
    for workspace in herdr_json("workspace", "list")["workspaces"]:
        if workspace["label"] == WORKSPACE_LABEL:
            herdr("workspace", "close", workspace["workspace_id"])


def peer_briefing(self_agent: Agent, agents: list[Agent]) -> str:
    peers = [
        f"{agent.name} (`{agent.slug}`)"
        for agent in agents
        if agent.name != self_agent.name
    ]
    return (
        f"You are registered in herdr as `{self_agent.slug}`. Your peers this run: "
        f"{', '.join(peers)} — separate sessions in sibling `herdr` panes, "
        f"not subagents of yours. Talk to them only over herdr's socket API: "
        f"`herdr agent prompt <peer> \"[from: {self_agent.slug}] <message>\"` "
        f"submits the message in one call (no separate Enter needed). Peers "
        f"reply the same way, so their answer arrives as a new prompt "
        f"starting with `[from: <peer>]` — answer such messages with `herdr "
        f"agent prompt` back to the sender. Add `--wait --timeout 600000` "
        f"only when you must block until the peer finishes; use `herdr agent "
        f"read <peer> --source recent-unwrapped --lines 60` only to diagnose."
    )


def build_system_prompt(agent: Agent, agents: list[Agent]) -> str:
    """Combine an agent's definition file with its peer briefing.

    Passed whole to `claude --append-system-prompt-file` so the agent's role
    is established invisibly, instead of as a visible first user message.
    """
    role_definition = agent.path.read_text().rstrip("\n")
    return f"{role_definition}\n\n{peer_briefing(agent, agents)}"


def write_system_prompt_file(agent: Agent, system_prompt: str) -> Path:
    """Write `system_prompt` to a file for `claude --append-system-prompt-file`.

    `herdr agent start` works by typing a constructed command line into the
    target pane's shell, which requires escaping the argument for an unknown
    shell dialect. A multi-line value (every role definition is a whole
    markdown file) can't always be escaped that way, so `herdr` refuses with
    "agent arguments cannot be encoded safely for the target shell". Passing
    a file path instead sidesteps the problem entirely since the argument
    itself has no newlines to escape.

    The path is fixed per agent, so each run overwrites the previous run's
    file instead of leaving a new temp file behind — cleanup on exit isn't
    possible since this script ends by exec'ing into herdr.
    """
    PROMPT_DIR.mkdir(parents=True, exist_ok=True)
    path = PROMPT_DIR / f"{agent.slug}.md"
    path.write_text(system_prompt)
    return path


def trust_claude_folder(folder: Path) -> None:
    """Pre-accept claude's "Do you trust this folder?" dialog for `folder`.

    claude asks once per directory and records the answer in its global
    config as `projects[<path>].hasTrustDialogAccepted`. The dialog blocks
    the first pane before herdr sees the agent as ready, so `agent start`
    fails with `agent_not_ready` — setting the flag up front skips it.
    The config is replaced atomically since running claude sessions also
    rewrite it.
    """
    config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
    config_path = Path(config_dir) / ".claude.json" if config_dir else Path.home() / ".claude.json"
    config = json.loads(config_path.read_text()) if config_path.exists() else {}
    project = config.setdefault("projects", {}).setdefault(str(folder), {})
    if project.get("hasTrustDialogAccepted"):
        return
    project["hasTrustDialogAccepted"] = True
    fd, tmp_path = tempfile.mkstemp(prefix=".claude.json-", dir=config_path.parent)
    with os.fdopen(fd, "w") as f:
        json.dump(config, f, indent=2)
    os.replace(tmp_path, config_path)
    print(f"Marked {folder} as trusted for claude.")


def write_opencode_agent(agent: Agent, system_prompt: str) -> str:
    """Write `system_prompt` as a project-local opencode agent; return its name.

    opencode has no `--append-system-prompt` flag. Its equivalent is a
    named agent file under `.opencode/agents/<name>.md` (YAML frontmatter
    + prompt body), auto-discovered from the project it's run in and
    selected via `opencode_pane_env` — so it carries the same role as a
    system prompt, rather than just an initial chat message.

    The OPENCODE_AGENT_PREFIX keeps these files from overwriting the
    project's own opencode agents, and a `.gitignore` (created only if the
    folder has none) keeps them out of the project's git status.
    """
    OPENCODE_AGENTS_DIR.mkdir(parents=True, exist_ok=True)
    gitignore = OPENCODE_AGENTS_DIR / ".gitignore"
    if not gitignore.exists():
        gitignore.write_text(f"{OPENCODE_AGENT_PREFIX}*.md\n.gitignore\n")
    opencode_name = OPENCODE_AGENT_PREFIX + agent.name
    frontmatter = f"---\ndescription: SwarmForge {agent.name} agent.\nmode: primary\n---\n"
    (OPENCODE_AGENTS_DIR / f"{opencode_name}.md").write_text(frontmatter + system_prompt)
    return opencode_name


def opencode_pane_env(name: str) -> list[str]:
    """herdr `--env` args that make opencode in a pane start as agent `name`.

    opencode's TUI has no `--agent` flag, so the agent is picked via
    `default_agent` in OPENCODE_CONFIG_CONTENT. That only takes effect
    with `--standalone` — the shared background service ignores the
    client's environment.
    """
    return ["--env", "OPENCODE_CONFIG_CONTENT=" + json.dumps({"default_agent": name})]


def prepare_cli(cli_tool: str, agent: Agent, agents: list[Agent]) -> tuple[list[str], list[str]]:
    """Hand `agent`'s system prompt to `cli_tool` the way that tool expects.

    Returns `(pane_env_args, agent_args)`: the herdr `--env` args for the
    agent's pane, and the args `cli_tool` itself is started with.
    """
    system_prompt = build_system_prompt(agent, agents)
    if cli_tool == "opencode":
        opencode_name = write_opencode_agent(agent, system_prompt)
        return opencode_pane_env(opencode_name), ["--standalone"]
    prompt_file = write_system_prompt_file(agent, system_prompt)
    return [], ["--append-system-prompt-file", str(prompt_file)]


def create_panes(pane_envs: Sequence[list[str]]) -> tuple[str, list[str]]:
    """Create the swarmforge workspace with one pane per entry in `pane_envs`.

    Panes are laid out left to right. Returns `(workspace_id, pane_ids)`.
    """
    created = herdr_json(
        "workspace", "create",
        "--cwd", str(REPO_ROOT),
        "--label", WORKSPACE_LABEL,
        "--no-focus",
        *pane_envs[0],
    )
    pane_ids = [created["root_pane"]["pane_id"]]
    for env_args in pane_envs[1:]:
        split = herdr_json(
            "pane", "split", pane_ids[-1],
            "--direction", "right",
            "--cwd", str(REPO_ROOT),
            "--no-focus",
            *env_args,
        )
        pane_ids.append(split["pane"]["pane_id"])
    return created["workspace"]["workspace_id"], pane_ids


def launch_agent(agent: Agent, cli_tool: str, pane_id: str, agent_args: list[str]) -> None:
    """Start `agent` in `pane_id`, exiting with a hint if it gets stuck."""
    try:
        start_agent(agent.slug, cli_tool, pane_id, agent_args)
    except RuntimeError as exc:
        if "agent_not_ready" not in str(exc):
            raise
        sys.exit(
            f"{agent.name} didn't become ready in pane {pane_id}: {cli_tool} "
            f"is probably waiting at a startup prompt.\n"
            f"Run `herdr pane read {pane_id}` to see it, answer it with "
            f"`herdr pane send-keys {pane_id} <key>`, then re-run this script."
        )


def cli_tool_from_args(args: list[str]) -> str:
    """Return the CLI tool named on the command line, or ask for one."""
    if not args:
        return prompt_cli_tool_selection(clear_func=_clear_lines)
    if len(args) > 1 or args[0] not in CLI_TOOLS:
        sys.exit(f"usage: swarmforge.py [{'|'.join(CLI_TOOLS)}]")
    return args[0]


def main() -> None:
    print_banner()
    ensure_herdr_installed()

    agents = discover_agents(CLAUDE_AGENTS_DIR)
    if not agents:
        sys.exit(f"No agent definition files found in {CLAUDE_AGENTS_DIR}")
    ensure_unique_slugs(agents)

    cli_tool = cli_tool_from_args(sys.argv[1:])
    selected = prompt_agent_selection(agents, clear_func=_clear_lines)

    if cli_tool == "claude":
        trust_claude_folder(REPO_ROOT)
    pane_envs, agent_args = zip(*(prepare_cli(cli_tool, agent, selected) for agent in selected))

    ensure_server_running()
    close_existing_herdr_workspaces()

    workspace_id, pane_ids = create_panes(pane_envs)
    for agent, pane_id, args in zip(selected, pane_ids, agent_args):
        launch_agent(agent, cli_tool, pane_id, args)

    herdr("workspace", "focus", workspace_id)

    os.execvp("herdr", ["herdr"])


if __name__ == "__main__":
    main()
