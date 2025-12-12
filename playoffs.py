from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from config import ROSTER_DF
from match_engine import MatchEngine, Team
from state import GAME_STATE, _update_playoff_player_stats_from_boxscore
from team_utils import get_conference_standings

HomePattern = [True, True, False, False, True, False, True]


# ---------------------------------------------------------------------------
# 상태 helpers
# ---------------------------------------------------------------------------

def _ensure_postseason_state() -> Dict[str, Any]:
    postseason = GAME_STATE.setdefault("postseason", {})
    postseason.setdefault("field", None)
    postseason.setdefault("play_in", None)
    postseason.setdefault("playoffs", None)
    postseason.setdefault("champion", None)
    postseason.setdefault("my_team_id", None)
    postseason.setdefault("playoff_player_stats", {})
    return postseason


def reset_postseason_state() -> Dict[str, Any]:
    GAME_STATE["postseason"] = {
        "field": None,
        "play_in": None,
        "playoffs": None,
        "champion": None,
        "my_team_id": None,
        "playoff_player_stats": {},
    }
    cached_views = GAME_STATE.setdefault("cached_views", {})
    playoff_news = cached_views.setdefault("playoff_news", {})
    playoff_news["series_game_counts"] = {}
    playoff_news["items"] = []
    cached_views.setdefault("stats", {}).pop("playoff_leaders", None)
    return GAME_STATE["postseason"]


# ---------------------------------------------------------------------------
# 로스터 / 경기 헬퍼
# ---------------------------------------------------------------------------

def _seed_entry(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "team_id": row.get("team_id"),
        "seed": row.get("rank"),
        "conference": row.get("conference"),
        "division": row.get("division"),
        "wins": row.get("wins"),
        "losses": row.get("losses"),
        "win_pct": row.get("win_pct"),
        "point_diff": row.get("point_diff"),
    }


def _find_team_df(team_id: str):
    df = ROSTER_DF[ROSTER_DF["Team"] == team_id]
    if df.empty:
        raise ValueError(f"Team '{team_id}' not found in roster data")
    return df


def _simulate_postseason_game(home_team_id: str, away_team_id: str) -> Dict[str, Any]:
    home_df = _find_team_df(home_team_id)
    away_df = _find_team_df(away_team_id)

    home_team = Team(home_team_id, home_df)
    away_team = Team(away_team_id, away_df)
    engine = MatchEngine(home_team, away_team)
    result = engine.simulate_game()
    score = result.get("final_score", {})

    home_score = int(score.get(home_team_id, 0))
    away_score = int(score.get(away_team_id, 0))
    winner = home_team_id if home_score > away_score else away_team_id

    _update_playoff_player_stats_from_boxscore(result.get("boxscore"))

    return {
        "home_team_id": home_team_id,
        "away_team_id": away_team_id,
        "home_score": home_score,
        "away_score": away_score,
        "winner": winner,
        "final_score": score,
        "boxscore": result.get("boxscore"),
    }


def _pick_home_advantage(entry_a: Dict[str, Any], entry_b: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    seed_a, seed_b = entry_a.get("seed"), entry_b.get("seed")
    if isinstance(seed_a, int) and isinstance(seed_b, int):
        if seed_a != seed_b:
            return (entry_a, entry_b) if seed_a < seed_b else (entry_b, entry_a)

    win_pct_a = entry_a.get("win_pct") or 0
    win_pct_b = entry_b.get("win_pct") or 0
    if win_pct_a != win_pct_b:
        return (entry_a, entry_b) if win_pct_a > win_pct_b else (entry_b, entry_a)

    pd_a = entry_a.get("point_diff") or 0
    pd_b = entry_b.get("point_diff") or 0
    if pd_a != pd_b:
        return (entry_a, entry_b) if pd_a > pd_b else (entry_b, entry_a)

    return (entry_a, entry_b) if (entry_a.get("team_id") or "") < (entry_b.get("team_id") or "") else (entry_b, entry_a)


# ---------------------------------------------------------------------------
# 필드 구축 / 플레이-인
# ---------------------------------------------------------------------------

def build_postseason_field() -> Dict[str, Any]:
    standings = get_conference_standings()
    field: Dict[str, Any] = {}

    for conf_key in ("east", "west"):
        conf_rows = standings.get(conf_key, [])
        seeds = [_seed_entry(r) for r in conf_rows]
        auto_bids = [s for s in seeds if isinstance(s.get("seed"), int) and s["seed"] <= 6]
        play_in = [s for s in seeds if isinstance(s.get("seed"), int) and 7 <= s["seed"] <= 10]
        eliminated = [s for s in seeds if isinstance(s.get("seed"), int) and s["seed"] > 10]
        field[conf_key] = {
            "auto_bids": auto_bids,
            "play_in": play_in,
            "eliminated": eliminated,
        }

    ps = _ensure_postseason_state()
    ps["field"] = field
    return field


def _conference_play_in_template(conf_key: str, field: Dict[str, Any]) -> Dict[str, Any]:
    seeds = {entry["seed"]: entry for entry in field.get(conf_key, {}).get("play_in", []) if entry.get("seed")}
    matchups = {
        "seven_vs_eight": {
            "home": seeds.get(7),
            "away": seeds.get(8),
            "result": None,
        },
        "nine_vs_ten": {
            "home": seeds.get(9),
            "away": seeds.get(10),
            "result": None,
        },
        "final": {
            "home": None,
            "away": None,
            "result": None,
        },
    }
    return {
        "conference": conf_key,
        "participants": seeds,
        "matchups": matchups,
        "seed7": None,
        "seed8": None,
        "eliminated": [],
    }


def _apply_play_in_results(conf_state: Dict[str, Any]) -> None:
    matchups = conf_state.get("matchups", {})
    conf_state["seed7"] = None
    conf_state["seed8"] = None
    eliminated: List[str] = []

    seven_res = (matchups.get("seven_vs_eight") or {}).get("result")
    nine_res = (matchups.get("nine_vs_ten") or {}).get("result")
    final_res = (matchups.get("final") or {}).get("result")

    main_loser = None
    lower_winner = None

    if seven_res:
        winner = seven_res.get("winner")
        home = seven_res.get("home_team_id")
        away = seven_res.get("away_team_id")
        if winner and home and away:
            conf_state["seed7"] = conf_state["participants"].get(7) if winner == conf_state["participants"].get(7, {}).get("team_id") else conf_state["participants"].get(8)
            main_loser = conf_state["participants"].get(8) if conf_state["seed7"] is conf_state["participants"].get(7) else conf_state["participants"].get(7)

    if nine_res:
        winner = nine_res.get("winner")
        home_entry = conf_state["participants"].get(9)
        away_entry = conf_state["participants"].get(10)
        if winner and home_entry and away_entry:
            lower_winner = home_entry if winner == home_entry.get("team_id") else away_entry
            lower_loser = away_entry if lower_winner is home_entry else home_entry
            if lower_loser and lower_loser.get("team_id"):
                eliminated.append(lower_loser.get("team_id"))

    if final_res:
        winner = final_res.get("winner")
        home_team_id = final_res.get("home_team_id")
        away_team_id = final_res.get("away_team_id")
        home_entry = None
        away_entry = None
        for entry in conf_state["participants"].values():
            if entry.get("team_id") == home_team_id:
                home_entry = entry
            if entry.get("team_id") == away_team_id:
                away_entry = entry
        if winner and home_entry and away_entry:
            conf_state["seed8"] = home_entry if winner == home_entry.get("team_id") else away_entry
            loser_entry = away_entry if conf_state["seed8"] is home_entry else home_entry
            if loser_entry.get("team_id"):
                eliminated.append(loser_entry.get("team_id"))

    conf_state["eliminated"] = eliminated

    if not final_res and main_loser and lower_winner:
        matchups["final"]["home"], matchups["final"]["away"] = _pick_home_advantage(main_loser, lower_winner)


def _simulate_play_in_game(home_entry: Optional[Dict[str, Any]], away_entry: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not home_entry or not away_entry:
        return None
    return _simulate_postseason_game(home_entry["team_id"], away_entry["team_id"])


def _auto_play_in_conf(conf_state: Dict[str, Any], my_team_id: Optional[str]) -> None:
    matchups = conf_state.get("matchups", {})

    for key in ("seven_vs_eight", "nine_vs_ten"):
        matchup = matchups.get(key)
        if matchup and not matchup.get("result"):
            home = matchup.get("home")
            away = matchup.get("away")
            if not home or not away:
                continue
            if my_team_id in {home.get("team_id"), away.get("team_id")}:
                continue
            matchup["result"] = _simulate_play_in_game(home, away)

    _apply_play_in_results(conf_state)

    final_matchup = matchups.get("final")
    if final_matchup:
        home = final_matchup.get("home")
        away = final_matchup.get("away")
        if home and away and not final_matchup.get("result"):
            if my_team_id not in {home.get("team_id"), away.get("team_id")}:
                final_matchup["result"] = _simulate_play_in_game(home, away)
        _apply_play_in_results(conf_state)


def play_my_team_play_in_game() -> Dict[str, Any]:
    postseason = _ensure_postseason_state()
    my_team_id = postseason.get("my_team_id")
    play_in = postseason.get("play_in")
    if not my_team_id or not play_in:
        raise ValueError("Play-in state is not initialized with a user team")

    target_conf = None
    for conf_key, conf_state in play_in.items():
        participants = conf_state.get("participants", {})
        if any(p.get("team_id") == my_team_id for p in participants.values()):
            target_conf = conf_key
            break
    if target_conf is None:
        raise ValueError("User team is not part of the play-in field")

    conf_state = play_in[target_conf]
    matchups = conf_state.get("matchups", {})

    for key in ("seven_vs_eight", "nine_vs_ten", "final"):
        matchup = matchups.get(key)
        if not matchup or matchup.get("result"):
            continue
        home = matchup.get("home")
        away = matchup.get("away")
        if home and away and my_team_id in {home.get("team_id"), away.get("team_id")}:
            matchup["result"] = _simulate_play_in_game(home, away)
            _apply_play_in_results(conf_state)
            _auto_play_in_conf(conf_state, my_team_id)
            postseason["play_in"] = play_in
            _maybe_start_playoffs_from_play_in()
            return postseason

    raise ValueError("No pending play-in game for the user team")


# ---------------------------------------------------------------------------
# 플레이오프 시리즈
# ---------------------------------------------------------------------------

def _series_template(home_adv: Dict[str, Any], road: Dict[str, Any], round_name: str, matchup_label: str, best_of: int = 7) -> Dict[str, Any]:
    return {
        "round": round_name,
        "matchup": matchup_label,
        "home_court": home_adv.get("team_id"),
        "road": road.get("team_id"),
        "home_entry": home_adv,
        "road_entry": road,
        "games": [],
        "wins": {home_adv.get("team_id"): 0, road.get("team_id"): 0},
        "best_of": best_of,
        "winner": None,
    }


def _is_series_finished(series: Dict[str, Any]) -> bool:
    winner = series.get("winner")
    if winner:
        return True
    wins = series.get("wins") or {}
    best_of = series.get("best_of", 7)
    needed = best_of // 2 + 1
    return any(v >= needed for v in wins.values())


def _simulate_one_series_game(series: Dict[str, Any]) -> Dict[str, Any]:
    if _is_series_finished(series):
        return series

    game_idx = len(series.get("games", []))
    best_of = series.get("best_of", 7)
    if game_idx >= best_of:
        return series

    higher_is_home = HomePattern[game_idx]
    home_id = series["home_court"] if higher_is_home else series["road"]
    away_id = series["road"] if higher_is_home else series["home_court"]

    game_result = _simulate_postseason_game(home_id, away_id)
    series.setdefault("games", []).append(game_result)

    wins = series.setdefault("wins", {})
    wins[game_result["winner"]] = wins.get(game_result["winner"], 0) + 1

    needed = best_of // 2 + 1
    if wins[game_result["winner"]] >= needed:
        series["winner"] = series["home_entry"] if series["home_entry"].get("team_id") == game_result["winner"] else series["road_entry"]
    return series


def _round_series(bracket: Dict[str, Any], round_name: str) -> List[Dict[str, Any]]:
    if round_name == "Conference Quarterfinals":
        return (bracket.get("east", {}).get("quarterfinals") or []) + (bracket.get("west", {}).get("quarterfinals") or [])
    if round_name == "Conference Semifinals":
        return (bracket.get("east", {}).get("semifinals") or []) + (bracket.get("west", {}).get("semifinals") or [])
    if round_name == "Conference Finals":
        finals = []
        if bracket.get("east", {}).get("finals"):
            finals.append(bracket["east"]["finals"])
        if bracket.get("west", {}).get("finals"):
            finals.append(bracket["west"]["finals"])
        return finals
    if round_name == "NBA Finals":
        return [bracket.get("finals")]
    return []


# ---------------------------------------------------------------------------
# 플레이오프 브래킷 생성
# ---------------------------------------------------------------------------

def _conference_quarterfinals(seeds: Dict[int, Dict[str, Any]]) -> List[Dict[str, Any]]:
    qf_pairs = [(1, 8), (4, 5), (3, 6), (2, 7)]
    results = []
    for high, low in qf_pairs:
        team_high = seeds.get(high)
        team_low = seeds.get(low)
        if not team_high or not team_low:
            continue
        home, road = _pick_home_advantage(team_high, team_low)
        results.append(
            _series_template(home, road, "Conference Quarterfinals", f"{high} vs {low}")
        )
    return results


def _conference_semifinals_from_qf(qf_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    def _find_winner(matchup_prefix: str) -> Optional[Dict[str, Any]]:
        for s in qf_list:
            if s.get("matchup", "").startswith(matchup_prefix):
                return s.get("winner")
        return None

    inputs = [(_find_winner("1 vs 8"), _find_winner("4 vs 5")), (_find_winner("2 vs 7"), _find_winner("3 vs 6"))]
    results = []
    for idx, (a, b) in enumerate(inputs, start=1):
        if not a or not b:
            continue
        home, road = _pick_home_advantage(a, b)
        results.append(
            _series_template(home, road, "Conference Semifinals", f"SF{idx}")
        )
    return results


def _conference_finals_from_sf(sf_list: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if len(sf_list) < 2:
        return None
    if not all(s.get("winner") for s in sf_list):
        return None
    home, road = _pick_home_advantage(sf_list[0]["winner"], sf_list[1]["winner"])
    return _series_template(home, road, "Conference Finals", "CF")


def _finals_from_conf(east: Optional[Dict[str, Any]], west: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not east or not west:
        return None
    if not east.get("winner") or not west.get("winner"):
        return None
    home, road = _pick_home_advantage(east["winner"], west["winner"])
    return _series_template(home, road, "NBA Finals", "FINALS")


def _initialize_playoffs(seeds_by_conf: Dict[str, Dict[int, Dict[str, Any]]]) -> None:
    postseason = _ensure_postseason_state()
    bracket = {
        "east": {
            "quarterfinals": _conference_quarterfinals(seeds_by_conf.get("east", {})),
            "semifinals": [],
            "finals": None,
        },
        "west": {
            "quarterfinals": _conference_quarterfinals(seeds_by_conf.get("west", {})),
            "semifinals": [],
            "finals": None,
        },
        "finals": None,
    }

    postseason["playoffs"] = {
        "seeds": seeds_by_conf,
        "bracket": bracket,
        "current_round": "Conference Quarterfinals",
    }


def _advance_round_if_ready() -> None:
    postseason = _ensure_postseason_state()
    playoffs = postseason.get("playoffs")
    if not playoffs:
        return

    bracket = playoffs.get("bracket", {})
    current_round = playoffs.get("current_round", "Conference Quarterfinals")

    if current_round == "Conference Quarterfinals":
        qf_series = _round_series(bracket, current_round)
        if qf_series and all(_is_series_finished(s) for s in qf_series):
            bracket["east"]["semifinals"] = _conference_semifinals_from_qf(bracket["east"].get("quarterfinals", []))
            bracket["west"]["semifinals"] = _conference_semifinals_from_qf(bracket["west"].get("quarterfinals", []))
            playoffs["current_round"] = "Conference Semifinals"
            postseason["playoffs"] = playoffs
            return

    if current_round == "Conference Semifinals":
        sf_series = _round_series(bracket, current_round)
        if sf_series and all(_is_series_finished(s) for s in sf_series):
            bracket["east"]["finals"] = _conference_finals_from_sf(bracket["east"].get("semifinals", []))
            bracket["west"]["finals"] = _conference_finals_from_sf(bracket["west"].get("semifinals", []))
            playoffs["current_round"] = "Conference Finals"
            postseason["playoffs"] = playoffs
            return

    if current_round == "Conference Finals":
        cf_series = _round_series(bracket, current_round)
        if cf_series and all(_is_series_finished(s) for s in cf_series):
            bracket["finals"] = _finals_from_conf(bracket.get("east", {}).get("finals"), bracket.get("west", {}).get("finals"))
            playoffs["current_round"] = "NBA Finals"
            postseason["playoffs"] = playoffs
            return

    if current_round == "NBA Finals":
        finals = bracket.get("finals")
        if finals and _is_series_finished(finals):
            postseason["champion"] = finals.get("winner")


# ---------------------------------------------------------------------------
# 사용자 팀 기준 진행
# ---------------------------------------------------------------------------

def _find_my_series(playoffs: Dict[str, Any], my_team_id: str) -> Optional[Dict[str, Any]]:
    bracket = playoffs.get("bracket", {})
    round_name = playoffs.get("current_round", "Conference Quarterfinals")
    for series in _round_series(bracket, round_name):
        if not series:
            continue
        if my_team_id in {series.get("home_court"), series.get("road")}:
            return series
    return None


def advance_my_team_one_game() -> Dict[str, Any]:
    postseason = _ensure_postseason_state()
    my_team_id = postseason.get("my_team_id")
    playoffs = postseason.get("playoffs")
    if not my_team_id or not playoffs:
        raise ValueError("Playoffs are not initialized with a user team")

    bracket = playoffs.get("bracket", {})
    round_name = playoffs.get("current_round", "Conference Quarterfinals")
    my_series = _find_my_series(playoffs, my_team_id)
    if not my_series:
        raise ValueError("User team is not in an active playoff series")
    if _is_series_finished(my_series):
        raise ValueError("User team series has already finished")

    _simulate_one_series_game(my_series)

    for series in _round_series(bracket, round_name):
        if not series or series is my_series:
            continue
        if _is_series_finished(series):
            continue
        _simulate_one_series_game(series)

    _advance_round_if_ready()
    return postseason


def auto_advance_current_round() -> Dict[str, Any]:
    postseason = _ensure_postseason_state()
    playoffs = postseason.get("playoffs")
    if not playoffs:
        raise ValueError("Playoffs are not initialized")

    bracket = playoffs.get("bracket", {})
    round_name = playoffs.get("current_round", "Conference Quarterfinals")
    for series in _round_series(bracket, round_name):
        if not series:
            continue
        while not _is_series_finished(series):
            _simulate_one_series_game(series)

    _advance_round_if_ready()
    return postseason


# ---------------------------------------------------------------------------
# 초기화 흐름
# ---------------------------------------------------------------------------

def _build_playoff_seeds(field: Dict[str, Any], play_in: Dict[str, Any]) -> Dict[str, Dict[int, Dict[str, Any]]]:
    seeds_for_bracket: Dict[str, Dict[int, Dict[str, Any]]] = {"east": {}, "west": {}}
    for conf_key in ("east", "west"):
        conf_field = field.get(conf_key, {})
        conf_seeds = {entry["seed"]: entry for entry in conf_field.get("auto_bids", []) if entry.get("seed")}
        play_in_conf = play_in.get(conf_key) or {}
        seed7 = play_in_conf.get("seed7")
        seed8 = play_in_conf.get("seed8")
        if seed7:
            conf_seeds[seed7.get("seed") or 7] = seed7
        if seed8:
            conf_seeds[seed8.get("seed") or 8] = seed8
        seeds_for_bracket[conf_key] = conf_seeds
    return seeds_for_bracket


def _maybe_start_playoffs_from_play_in() -> None:
    postseason = _ensure_postseason_state()
    field = postseason.get("field")
    play_in = postseason.get("play_in")
    if not field or not play_in:
        return

    for conf_state in play_in.values():
        if not conf_state.get("seed7") or not conf_state.get("seed8"):
            return

    seeds = _build_playoff_seeds(field, play_in)
    _initialize_playoffs(seeds)


def _prepare_play_in(field: Dict[str, Any], my_team_id: Optional[str]) -> Dict[str, Any]:
    play_in_state: Dict[str, Any] = {}
    for conf_key in ("east", "west"):
        conf_state = _conference_play_in_template(conf_key, field)
        play_in_state[conf_key] = conf_state

    postseason = _ensure_postseason_state()
    postseason["play_in"] = play_in_state

    my_conf = None
    my_seed = None
    for conf_key, conf_field in field.items():
        for entry in conf_field.get("auto_bids", []) + conf_field.get("play_in", []):
            if entry.get("team_id") == my_team_id:
                my_conf = conf_key
                my_seed = entry.get("seed")
                break

    for conf_key, conf_state in play_in_state.items():
        if my_seed and my_seed <= 6:
            _auto_play_in_conf(conf_state, None)
        elif my_conf == conf_key:
            _auto_play_in_conf(conf_state, my_team_id)
        else:
            _auto_play_in_conf(conf_state, None)

    for conf_state in play_in_state.values():
        _apply_play_in_results(conf_state)

    postseason["play_in"] = play_in_state
    if my_seed and my_seed <= 6:
        _maybe_start_playoffs_from_play_in()

    return play_in_state


def initialize_postseason(my_team_id: str) -> Dict[str, Any]:
    reset_postseason_state()
    postseason = _ensure_postseason_state()
    postseason["my_team_id"] = my_team_id
    field = build_postseason_field()

    play_in_state = _prepare_play_in(field, my_team_id)

    # 사용자가 플레이인을 건너뛴 경우 이미 플레이오프가 세팅됨
    if not postseason.get("playoffs"):
        _maybe_start_playoffs_from_play_in()

    return postseason


__all__ = [
    "build_postseason_field",
    "reset_postseason_state",
    "initialize_postseason",
    "play_my_team_play_in_game",
    "advance_my_team_one_game",
    "auto_advance_current_round",
]
