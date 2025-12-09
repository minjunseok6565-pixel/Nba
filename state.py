from __future__ import annotations

import random
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from config import (
    HARD_CAP,
    ALL_TEAM_IDS,
    TEAM_TO_CONF_DIV,
    SEASON_START_MONTH,
    SEASON_START_DAY,
    SEASON_LENGTH_DAYS,
    MAX_GAMES_PER_DAY,
)

# -------------------------------------------------------------------------
# 1. 전역 GAME_STATE 및 스케줄/리그 상태 유틸
# -------------------------------------------------------------------------
GAME_STATE: Dict[str, Any] = {
    "schema_version": "1.1",
    "turn": 0,
    "games": [],  # 각 경기의 메타 데이터
    "cached_views": {
        "scores": {
            "latest_date": None,
            "games": []  # 최근 경기일자 기준 경기 리스트
        },
        "schedule": {
            "teams": {}  # team_id -> {past_games: [], upcoming_games: []}
        },
        "news": {
            "items": []  # 간단 뉴스 피드
        },
    },
    "league": {
        "season_year": None,
        "season_start": None,  # YYYY-MM-DD
        "current_date": None,  # 마지막으로 리그를 진행한 인게임 날짜
        "master_schedule": {
            "games": [],   # 전체 리그 경기 리스트
            "by_team": {},  # team_id -> [game_id, ...]
            "by_date": {},  # date_str -> [game_id, ...]
        },
        "trade_rules": {
            "hard_cap": HARD_CAP,
            "trade_deadline": None,  # YYYY-MM-DD
        },
        "last_gm_tick_date": None,  # 마지막 AI GM 트레이드 시도 날짜
    },
    "teams": {},      # 팀 성향 / 메타 정보
    "players": {},    # 선수 메타 정보
    "transactions": [],  # 트레이드 등 기록
}


def _ensure_schedule_team(team_id: str) -> Dict[str, Any]:
    """GAME_STATE.cached_views.schedule에 팀 엔트리가 없으면 생성."""
    schedule = GAME_STATE["cached_views"]["schedule"]
    teams = schedule.setdefault("teams", {})
    if team_id not in teams:
        teams[team_id] = {
            "past_games": [],
            "upcoming_games": [],
        }
    return teams[team_id]


def _ensure_league_state() -> Dict[str, Any]:
    """GAME_STATE 안에 league 상태 블록을 보장한다."""
    league = GAME_STATE.setdefault("league", {})
    master_schedule = league.setdefault("master_schedule", {})
    master_schedule.setdefault("games", [])
    master_schedule.setdefault("by_team", {})
    master_schedule.setdefault("by_date", {})
    trade_rules = league.setdefault("trade_rules", {})
    trade_rules.setdefault("hard_cap", HARD_CAP)
    trade_rules.setdefault("trade_deadline", None)
    league.setdefault("season_year", None)
    league.setdefault("season_start", None)
    league.setdefault("current_date", None)
    league.setdefault("last_gm_tick_date", None)
    return league


def _build_master_schedule(season_year: int) -> None:
    """30개 팀 전체에 대한 마스터 스케줄(정규시즌)을 생성한다.

    - DIVISIONS / 컨퍼런스 정보를 사용해
      * 같은 디비전: 4경기
      * 같은 컨퍼런스 다른 디비전: 3~4경기 (랜덤, 평균적으로 NBA 규칙 근사)
      * 다른 컨퍼런스: 2경기
    - 각 경기마다 홈/원정을 나누고
    - 시즌 기간(SEASON_LENGTH_DAYS) 동안 날짜를 랜덤 배정하되
      * 하루 최대 MAX_GAMES_PER_DAY 경기
      * 한 팀은 하루에 최대 1경기
    """
    league = _ensure_league_state()

    # 시즌 시작일 (프론트 JS와 동일하게 10월 19일 기준)
    season_start = date(season_year, SEASON_START_MONTH, SEASON_START_DAY)
    teams = list(ALL_TEAM_IDS)

    # 팀별 컨퍼런스/디비전 정보
    team_info: Dict[str, Dict[str, Optional[str]]] = {}
    for tid in teams:
        info = TEAM_TO_CONF_DIV.get(tid, {"conference": None, "division": None})
        team_info[tid] = {
            "conference": info.get("conference"),
            "division": info.get("division"),
        }

    # 1) 팀 쌍별로 경기 수 결정 + 홈/원정 분배
    pair_games: List[Dict[str, Any]] = []

    for i in range(len(teams)):
        for j in range(i + 1, len(teams)):
            t1 = teams[i]
            t2 = teams[j]
            info1 = team_info[t1]
            info2 = team_info[t2]

            conf1, div1 = info1["conference"], info1["division"]
            conf2, div2 = info2["conference"], info2["division"]

            if conf1 is None or conf2 is None:
                # 디비전 정보가 없으면 안전하게 2경기(홈/원정)만 배정
                num_games = 2
            elif conf1 == conf2:
                if div1 == div2:
                    # 같은 디비전: 4경기
                    num_games = 4
                else:
                    # 같은 컨퍼런스 다른 디비전: 3 또는 4경기 (확률적으로 4가 더 많게)
                    num_games = 4 if random.random() < 0.6 else 3
            else:
                # 다른 컨퍼런스: 2경기 (홈/원정)
                num_games = 2

            # 홈/원정 분배
            if num_games % 2 == 0:
                home_for_t1 = num_games // 2
                home_for_t2 = num_games // 2
            else:
                # 3경기인 경우 한 팀은 2홈 1원, 다른 팀은 1홈 2원
                if random.random() < 0.5:
                    home_for_t1 = num_games // 2 + 1
                    home_for_t2 = num_games // 2
                else:
                    home_for_t1 = num_games // 2
                    home_for_t2 = num_games // 2 + 1

            for _ in range(home_for_t1):
                pair_games.append({
                    "home_team_id": t1,
                    "away_team_id": t2,
                })
            for _ in range(home_for_t2):
                pair_games.append({
                    "home_team_id": t2,
                    "away_team_id": t1,
                })

    # 2) 날짜 배정
    random.shuffle(pair_games)

    by_date: Dict[str, List[str]] = {}
    teams_per_date: Dict[str, set] = {}
    scheduled_games: List[Dict[str, Any]] = []

    for game in pair_games:
        home_id = game["home_team_id"]
        away_id = game["away_team_id"]

        assigned = False
        for _ in range(100):
            day_index = random.randint(0, SEASON_LENGTH_DAYS - 1)
            game_date = season_start + timedelta(days=day_index)
            date_str = game_date.isoformat()

            teams_today = teams_per_date.setdefault(date_str, set())
            games_today = by_date.setdefault(date_str, [])

            if len(games_today) >= MAX_GAMES_PER_DAY:
                continue
            if home_id in teams_today or away_id in teams_today:
                continue

            # 이 날짜에 배정
            teams_today.add(home_id)
            teams_today.add(away_id)

            game_id = f"{date_str}_{home_id}_{away_id}"
            scheduled_games.append({
                "game_id": game_id,
                "date": date_str,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "status": "scheduled",
                "home_score": None,
                "away_score": None,
            })
            games_today.append(game_id)
            assigned = True
            break

        if not assigned:
            # 제약을 맞추기 어려운 경우, 제약을 완화해서 넣는다.
            day_index = random.randint(0, SEASON_LENGTH_DAYS - 1)
            game_date = season_start + timedelta(days=day_index)
            date_str = game_date.isoformat()
            teams_today = teams_per_date.setdefault(date_str, set())
            games_today = by_date.setdefault(date_str, [])
            teams_today.add(home_id)
            teams_today.add(away_id)
            game_id = f"{date_str}_{home_id}_{away_id}"
            scheduled_games.append({
                "game_id": game_id,
                "date": date_str,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "status": "scheduled",
                "home_score": None,
                "away_score": None,
            })
            games_today.append(game_id)

    # 3) by_team 인덱스 생성
    by_team: Dict[str, List[str]] = {tid: [] for tid in teams}
    for g in scheduled_games:
        by_team[g["home_team_id"]].append(g["game_id"])
        by_team[g["away_team_id"]].append(g["game_id"])

    master_schedule = league["master_schedule"]
    master_schedule["games"] = scheduled_games
    master_schedule["by_team"] = by_team
    master_schedule["by_date"] = by_date

    # 시즌/트레이드 데드라인 정보 설정
    league["season_year"] = season_year
    league["season_start"] = season_start.isoformat()
    # 트레이드 데드라인: 이듬해 2월 5일
    trade_deadline_date = date(season_year + 1, 2, 5)
    league["trade_rules"]["trade_deadline"] = trade_deadline_date.isoformat()
    league["current_date"] = None
    league["last_gm_tick_date"] = None


def initialize_master_schedule_if_needed() -> None:
    """master_schedule이 비어 있으면 현재 연도를 기준으로 한 번 생성한다."""
    league = _ensure_league_state()
    master_schedule = league["master_schedule"]
    if master_schedule.get("games"):
        return

    today = date.today()
    season_year = today.year
    _build_master_schedule(season_year)


def _mark_master_schedule_game_final(
    game_id: str,
    game_date_str: str,
    home_id: str,
    away_id: str,
    home_score: int,
    away_score: int,
) -> None:
    """마스터 스케줄에 동일한 game_id가 있으면 결과를 반영한다."""
    league = GAME_STATE.get("league")
    if not league:
        return
    master_schedule = (league.get("master_schedule") or {})
    games = master_schedule.get("games") or []

    for g in games:
        if g.get("game_id") == game_id:
            g["status"] = "final"
            g["date"] = game_date_str
            g["home_score"] = home_score
            g["away_score"] = away_score
            return


# -------------------------------------------------------------------------
# 2. 경기를 상태에 반영 / STATE 업데이트 유틸
# -------------------------------------------------------------------------
def update_state_with_game(
    home_id: str,
    away_id: str,
    score: Dict[str, int],
    game_date: Optional[str] = None,
) -> Dict[str, Any]:
    """매치엔진 결과를 GAME_STATE와 cached_views에 반영.

    - game_date 가 주어지면 그 값을 사용, 없으면 서버 기준 오늘 날짜 사용.
    """
    game_date_str = str(game_date) if game_date else date.today().isoformat()
    game_id = f"{game_date_str}_{home_id}_{away_id}"

    home_score = int(score.get(home_id, 0))
    away_score = int(score.get(away_id, 0))

    game_obj = {
        "game_id": game_id,
        "date": game_date_str,
        "home_team_id": home_id,
        "away_team_id": away_id,
        "home_score": home_score,
        "away_score": away_score,
        "status": "final",
        "is_overtime": False,
    }

    # turn 카운트 증가
    GAME_STATE["turn"] += 1

    # games 리스트에 추가
    GAME_STATE["games"].append(game_obj)

    # scores 캐시 업데이트 (가장 최근 일자 기준)
    scores_view = GAME_STATE["cached_views"]["scores"]
    scores_view["latest_date"] = game_date_str
    scores_view.setdefault("games", [])
    scores_view["games"].insert(0, game_obj)

    # schedule 캐시 (양 팀 모두 과거 경기로 추가)
    for team_id, my_score, opp_score in [
        (home_id, home_score, away_score),
        (away_id, away_score, home_score),
    ]:
        schedule_entry = _ensure_schedule_team(team_id)
        result = "W" if my_score > opp_score else "L"
        schedule_entry["past_games"].insert(0, {
            "game_id": game_id,
            "date": game_date_str,
            "home_team_id": home_id,
            "away_team_id": away_id,
            "home_score": home_score,
            "away_score": away_score,
            "result_for_user_team": result,
        })

    # 간단 뉴스 항목 추가
    news_items = GAME_STATE["cached_views"]["news"]["items"]
    news_items.insert(0, {
        "news_id": f"news_{game_id}",
        "date": game_date_str,
        "importance": "normal",
        "tags": ["game_result"],
        "title": f"{home_id} {home_score} - {away_id} {away_score}",
        "summary": "파이썬 매치 엔진 결과를 바탕으로 생성된 간단한 경기 결과입니다.",
        "related_team_ids": [home_id, away_id],
        "related_player_ids": [],
    })

    # 마스터 스케줄에 해당 경기가 존재한다면 결과도 반영
    _mark_master_schedule_game_final(
        game_id=game_id,
        game_date_str=game_date_str,
        home_id=home_id,
        away_id=away_id,
        home_score=home_score,
        away_score=away_score,
    )

    return game_obj


def apply_state_update(update: Dict[str, Any]) -> None:
    """보조 LLM이 만든 STATE_UPDATE JSON을 GAME_STATE에 병합."""
    if not isinstance(update, dict):
        return

    if "schema_version" in update:
        GAME_STATE["schema_version"] = update["schema_version"]

    for key in ("games", "teams", "players", "transactions"):
        if key in update and update[key] is not None:
            GAME_STATE[key] = update[key]

    if "cached_views" in update and update["cached_views"] is not None:
        GAME_STATE["cached_views"] = update["cached_views"]
