"""Simulated booking built from the latest itinerary."""

from __future__ import annotations

import secrets
import string
from typing import Any


def _num(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def confirmation_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "EA-" + "".join(secrets.choice(alphabet) for _ in range(5))


def build_booking(itin: dict[str, Any]) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for f in itin.get("flights") or []:
        title = f"{f.get('from', '?')} → {f.get('to', '?')} · {f.get('carrier', '')}".strip(" ·")
        if f.get("depart"):
            title += f" · {f['depart']}"
        items.append({"kind": "flight", "title": title, "price_eur": round(_num(f.get("price_eur")))})
    stays: dict[str, dict[str, Any]] = {}
    days = itin.get("days") or []
    last: dict[str, Any] = {}
    for i, d in enumerate(days):
        s = d.get("stay") or (last if i < len(days) - 1 else {})
        last = s or last
        name = s.get("name")
        if not name:
            continue
        entry = stays.setdefault(name, {"nights": 0, "price": _num(s.get("price_per_night_eur")),
                                        "type": s.get("type", "")})
        entry["nights"] += 1
    for name, e in stays.items():
        n = e["nights"]
        items.append({"kind": "stay", "title": f"{name} · {n} night{'s' if n != 1 else ''}",
                      "price_eur": round(e["price"] * n)})
    for x in itin.get("experiences") or []:
        items.append({"kind": "experience", "title": x.get("title", "Experience"),
                      "price_eur": round(_num(x.get("price_eur")))})
    total = sum(i["price_eur"] for i in items)
    return {"confirmation": confirmation_code(), "status": "confirmed", "items": items,
            "total_eur": total, "title": itin.get("title", "")}
