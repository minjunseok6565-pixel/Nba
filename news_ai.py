from __future__ import annotations

import json
from datetime import date
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


def build_recent_games_context(batch_size: int = 5) -> str:
    current_date = _get_current_date()

    games_sorted = sorted(
        GAME_STATE.get("games", []), key=lambda x: x.get("date") or ""
    )
    recent_games = games_sorted[-batch_size:]

    lines: List[str] = []
    lines.append(f"Current league date: {current_date.isoformat()}")
    if recent_games:
        start_date = recent_games[0].get("date")
        end_date = recent_games[-1].get("date")
        lines.append(f"Coverage window: {start_date} ~ {end_date}")
    else:
        lines.append("Coverage window: no games played yet")

    lines.append("\n[Last 5 Games]")
    if not recent_games:
        lines.append("No games have been completed.")
    else:
        for g in recent_games:
            lines.append(
                f"{g.get('date')}: {g.get('home_team_id')} {g.get('home_score')} - "
                f"{g.get('away_team_id')} {g.get('away_score')}"
            )

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


def generate_weekly_news(api_key: str, batch_size: int = 5) -> List[Dict[str, Any]]:
    if not api_key:
        raise ValueError("apiKey is required")

    context = build_recent_games_context(batch_size=batch_size)
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-3-pro-preview")

    prompt = (
        "You are an NBA beat writer. Summarize the last set of games into 3-6 news articles. "
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
    games_played = len(GAME_STATE.get("games", []))
    cache = GAME_STATE.setdefault("cached_views", {}).setdefault("weekly_news", {})

    last_generated_count = cache.get("last_generated_game_count") or 0
    if games_played < 5 and not cache.get("items"):
        return {"current_date": current_date.isoformat(), "items": []}

    last_batch = last_generated_count // 5
    current_batch = games_played // 5
    if cache.get("items") and last_batch >= current_batch:
        return {"current_date": current_date.isoformat(), "items": cache.get("items", [])}

    items = generate_weekly_news(api_key, batch_size=5)
    cache["last_generated_week_start"] = None
    cache["last_generated_game_count"] = games_played
    cache["items"] = items

    return {"current_date": current_date.isoformat(), "items": items}
