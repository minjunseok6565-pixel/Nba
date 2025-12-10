from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any, Dict, List

import google.generativeai as genai

from state import GAME_STATE, _ensure_league_state
from team_utils import get_conference_standings


def _extract_text_from_gemini_response(resp: Any) -> str:
    text = getattr(resp, "text", None)
    if text:
        return text

    try:
        parts = resp.candidates[0].content.parts
        texts = []
        for p in parts:
            t = getattr(p, "text", None)
            if t:
                texts.append(t)
        if texts:
            return "\n".join(texts)
    except Exception:
        pass

    return str(resp)


def _get_current_date() -> date:
    league = _ensure_league_state()
    cur = league.get("current_date") or date.today().isoformat()
    try:
        return date.fromisoformat(cur)
    except ValueError:
        return date.today()


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def build_week_summary_context() -> str:
    current_date = _get_current_date()
    week_start = current_date - timedelta(days=6)

    lines: List[str] = []
    lines.append(f"Current league date: {current_date.isoformat()}")
    lines.append(f"Coverage window: {week_start.isoformat()} ~ {current_date.isoformat()}")

    games = []
    for g in GAME_STATE.get("games", []):
        try:
            g_date = date.fromisoformat(g.get("date"))
        except Exception:
            continue
        if week_start <= g_date <= current_date:
            games.append(g)

    games_sorted = sorted(games, key=lambda x: x.get("date"))
    lines.append("\n[Games]")
    if not games_sorted:
        lines.append("No games played in this window.")
    else:
        for g in games_sorted:
            lines.append(
                f"{g.get('date')}: {g.get('home_team_id')} {g.get('home_score')} - "
                f"{g.get('away_team_id')} {g.get('away_score')}"
            )

    transactions = []
    for t in GAME_STATE.get("transactions", []):
        t_date = t.get("date") or t.get("created_at")
        if not t_date:
            continue
        try:
            t_d = date.fromisoformat(str(t_date))
        except Exception:
            continue
        if week_start <= t_d <= current_date:
            transactions.append(t)

    lines.append("\n[Transactions]")
    if not transactions:
        lines.append("No trades or transactions recorded.")
    else:
        for t in transactions:
            summary = t.get("summary") or t.get("title") or str(t)
            lines.append(f"{t.get('date', '')}: {summary}")

    standings = get_conference_standings()
    lines.append("\n[Top Teams]")
    for conf_key, teams in [("East", standings.get("east", [])), ("West", standings.get("west", []))]:
        top3 = teams[:3]
        if not top3:
            lines.append(f"{conf_key}: no games yet.")
            continue
        for t in top3:
            lines.append(
                f"{conf_key} #{t.get('rank')}: {t.get('team_id')} ({t.get('wins')}-{t.get('losses')})"
            )

    return "\n".join(lines)


def generate_weekly_news(api_key: str) -> List[Dict[str, Any]]:
    if not api_key:
        raise ValueError("apiKey is required")

    context = build_week_summary_context()
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-3-pro-preview")

    prompt = (
        "You are an NBA beat writer. Summarize the past week into 3-6 news articles. "
        "Return ONLY a JSON array. Each item must have keys: "
        "title, summary, tags (array of strings), related_team_ids (array of team IDs), "
        "related_player_names (array of strings)."
        "Keep summaries concise (<=60 words)."
        "Context:\n" + context
    )

    resp = model.generate_content(prompt)
    raw_text = _extract_text_from_gemini_response(resp)

    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        parts = cleaned.split("```")
        if len(parts) >= 3:
            cleaned = parts[1].strip()

    try:
        data = json.loads(cleaned)
    except Exception:
        return []

    if not isinstance(data, list):
        return []

    articles: List[Dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        articles.append(
            {
                "title": item.get("title"),
                "summary": item.get("summary"),
                "tags": item.get("tags") or [],
                "related_team_ids": item.get("related_team_ids") or [],
                "related_player_names": item.get("related_player_names") or [],
            }
        )

    return articles


def refresh_weekly_news(api_key: str) -> Dict[str, Any]:
    current_date = _get_current_date()
    week_key = _week_start(current_date).isoformat()
    cache = GAME_STATE.setdefault("cached_views", {}).setdefault("weekly_news", {})

    if cache.get("last_generated_week_start") == week_key and cache.get("items"):
        return {"current_date": current_date.isoformat(), "items": cache.get("items", [])}

    items = generate_weekly_news(api_key)
    cache["last_generated_week_start"] = week_key
    cache["items"] = items

    return {"current_date": current_date.isoformat(), "items": items}
