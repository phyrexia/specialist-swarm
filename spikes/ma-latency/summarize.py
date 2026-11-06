"""Summarize spike runs: per-turn timing table (client ms since send) with min/median/max.

Usage: python3 spikes/ma-latency/summarize.py [run-*.json ...]   (defaults to out/run-*.json)
"""

from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TURNS = [("turn1", "turn1_stats"), ("turn2", "turn2_stats"), ("session2_turn1", "session2_stats")]
COLS = [
    ("first event", "first_event"),
    ("memory tool", "first_memory_tool_use"),
    ("1st thread_created", "first_thread_created"),
    ("delegate weather", "delegate_to:weather-scout"),
    ("delegate insider", "delegate_to:insider"),
    ("weather done", "reply_from:weather-scout"),
    ("insider done", "reply_from:insider"),
    ("present_result", "present_result"),
    ("end_turn", "end_turn"),
]


def subagent_end_server_ms(stats: dict, agent_suffix: str) -> int | None:
    """Last end-of-thread idle for a subagent in this turn, server clock, ms since send."""
    idles = [e["server_ms_since_send"]
             for th in stats["threads"] if (th.get("agent") or "").endswith(agent_suffix)
             for e in th["timeline"]
             if e.get("type") == "session.thread_status_idle" and (e.get("server_ms_since_send") or -1) >= 0]
    return max(idles) if idles else None


def fmt(v) -> str:
    return "-" if v is None else f"{v / 1000:.1f}"


def main() -> None:
    paths = [Path(p) for p in sys.argv[1:]] or sorted((HERE / "out").glob("run-*.json"))
    runs = [(p.stem.removeprefix("run-"), json.loads(p.read_text())) for p in paths]
    for turn, stats_key in TURNS:
        print(f"\n### {turn} (seconds since user.message send, client clock)\n")
        header = ["run"] + [c for c, _ in COLS] + ["weather end (srv)", "insider end (srv)", "cost (cum)", "out tok (cum)"]
        print("| " + " | ".join(header) + " |")
        print("|" + "---|" * len(header))
        series: dict[str, list[int]] = {k: [] for _, k in COLS}
        for run_id, r in runs:
            t = r.get(turn)
            if not t:
                continue
            marks = t["marks"]
            stats = r.get(stats_key) or {"threads": [], "session": {"usage": {}}}
            usage = stats["session"]["usage"] or {}
            cost = (usage.get("list_cost") or {}).get("amount")
            row = [run_id] + [fmt(marks.get(k)) for _, k in COLS]
            row += [fmt(subagent_end_server_ms(stats, "weather-scout")), fmt(subagent_end_server_ms(stats, "insider"))]
            row += [f"${int(cost) / 100:.2f}" if cost is not None else "-", str(usage.get("output_tokens", "-"))]
            print("| " + " | ".join(row) + " |")
            for _, k in COLS:
                if marks.get(k) is not None:
                    series[k].append(marks[k])
        for name, fn in (("min", min), ("median", statistics.median), ("max", max)):
            row = [f"**{name}**"] + [fmt(fn(series[k])) if series[k] else "-" for _, k in COLS] + ["", "", "", ""]
            print("| " + " | ".join(row) + " |")


if __name__ == "__main__":
    main()
