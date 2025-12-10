from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional, List

import google.generativeai as genai
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from config import BASE_DIR, ROSTER_DF, ALL_TEAM_IDS
from state import (
    GAME_STATE,
    _ensure_league_state,
    initialize_master_schedule_if_needed,
    apply_state_update,
    get_schedule_summary,
)
from league_sim import simulate_single_game, advance_league_until
from news_ai import refresh_weekly_news
from stats_util import compute_league_leaders
from team_utils import (
    get_conference_standings,
    get_team_cards,
    get_team_detail,
)


# -------------------------------------------------------------------------
# FastAPI 앱 생성 및 기본 설정
# -------------------------------------------------------------------------
app = FastAPI(title="느바 시뮬 GM 서버")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# static/NBA.html 서빙
static_dir = os.path.join(BASE_DIR, "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def root():
    """간단한 헬스체크 및 NBA.html 링크 안내."""
    index_path = os.path.join(static_dir, "NBA.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "느바 시뮬 GM 서버입니다. /static/NBA.html 을 확인하세요."}


# -------------------------------------------------------------------------
# Pydantic 모델 정의
# -------------------------------------------------------------------------
class SimGameRequest(BaseModel):
    home_team_id: str
    away_team_id: str
    home_tactics: Optional[Dict[str, Any]] = None
    away_tactics: Optional[Dict[str, Any]] = None
    game_date: Optional[str] = None  # 인게임 날짜 (YYYY-MM-DD)


class ChatMainRequest(BaseModel):
    apiKey: str
    # JS 쪽에서 userMessage라는 필드명을 사용하는 경우도 받아줄 수 있게 alias 지정
    userInput: str = Field(..., alias="userMessage")
    mainPrompt: Optional[str] = ""
    context: Any = ""

    class Config:
        allow_population_by_field_name = True
        allow_population_by_alias = True
        fields = {"userInput": "userMessage"}


class StateUpdateRequest(BaseModel):
    apiKey: str
    subPrompt: Optional[str] = ""
    engineOutput: Dict[str, Any]
    currentState: Optional[Dict[str, Any]] = None


class AdvanceLeagueRequest(BaseModel):
    target_date: str  # YYYY-MM-DD, 이 날짜까지 리그를 자동 진행
    user_team_id: Optional[str] = None


class WeeklyNewsRequest(BaseModel):
    apiKey: str


class ApiKeyRequest(BaseModel):
    apiKey: str


# -------------------------------------------------------------------------
# 유틸: Gemini 응답 텍스트 추출
# -------------------------------------------------------------------------
def extract_text_from_gemini_response(resp: Any) -> str:
    """google-generativeai 응답 객체에서 텍스트만 안전하게 뽑아낸다."""
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


# -------------------------------------------------------------------------
# 경기 시뮬레이션 API
# -------------------------------------------------------------------------
@app.post("/api/simulate-game")
async def api_simulate_game(req: SimGameRequest):
    """match_engine.MatchEngine을 사용해 한 경기를 시뮬레이션한다."""
    try:
        result = simulate_single_game(
            home_team_id=req.home_team_id,
            away_team_id=req.away_team_id,
            game_date=req.game_date,
            home_tactics=req.home_tactics,
            away_tactics=req.away_tactics,
        )
        return result
    except ValueError as e:
        # 팀을 찾지 못한 경우 등
        raise HTTPException(status_code=404, detail=str(e))


# -------------------------------------------------------------------------
# 리그 자동 진행 API (다른 팀 경기 일괄 시뮬레이션)
# -------------------------------------------------------------------------
@app.post("/api/advance-league")
async def api_advance_league(req: AdvanceLeagueRequest):
    """target_date까지 (유저 팀 경기를 제외한) 리그 전체 경기를 자동 시뮬레이션."""
    try:
        simulated = advance_league_until(
            target_date_str=req.target_date,
            user_team_id=req.user_team_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "target_date": req.target_date,
        "simulated_count": len(simulated),
        "simulated_games": simulated,
    }


# -------------------------------------------------------------------------
# 리그 리더 / 스탠딩 / 팀 API
# -------------------------------------------------------------------------


@app.get("/api/stats/leaders")
async def api_stats_leaders():
    return compute_league_leaders()


@app.get("/api/standings")
async def api_standings():
    return get_conference_standings()


@app.get("/api/teams")
async def api_teams():
    return get_team_cards()


@app.get("/api/team-detail/{team_id}")
async def api_team_detail(team_id: str):
    try:
        return get_team_detail(team_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# -------------------------------------------------------------------------
# 주간 뉴스 (LLM 요약)
# -------------------------------------------------------------------------


@app.post("/api/news/week")
async def api_news_week(req: WeeklyNewsRequest):
    if not req.apiKey:
        raise HTTPException(status_code=400, detail="apiKey is required")
    try:
        return refresh_weekly_news(req.apiKey)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Weekly news generation failed: {e}")


@app.post("/api/validate-key")
async def api_validate_key(req: ApiKeyRequest):
    """주어진 Gemini API 키를 간단히 검증한다."""
    if not req.apiKey:
        raise HTTPException(status_code=400, detail="apiKey is required")

    try:
        genai.configure(api_key=req.apiKey)
        # 최소 호출로 키 유효성 확인 (토큰 카운트 호출)
        model = genai.GenerativeModel("gemini-3-pro-preview")
        model.count_tokens("ping")
        return {"valid": True}
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid API key: {e}")


# -------------------------------------------------------------------------
# 메인 LLM (Home 대화) API
# -------------------------------------------------------------------------
@app.post("/api/chat-main")
async def chat_main(req: ChatMainRequest):
    """메인 프롬프트 + 컨텍스트 + 유저 입력을 가지고 Gemini를 호출."""
    if not req.apiKey:
        raise HTTPException(status_code=400, detail="apiKey is required")

    try:
        genai.configure(api_key=req.apiKey)
        model = genai.GenerativeModel(
            model_name="gemini-3-pro-preview",
            system_instruction=req.mainPrompt or "",
        )

        context_text = req.context
        if isinstance(req.context, (dict, list)):
            context_text = json.dumps(req.context, ensure_ascii=False)

        prompt = f"{context_text}\n\n[USER]\n{req.userInput}"
        resp = model.generate_content(prompt)
        text = extract_text_from_gemini_response(resp)
        return {"reply": text, "answer": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini main chat error: {e}")


@app.post("/api/main-llm")
async def chat_main_legacy(req: ChatMainRequest):
    """프론트 JS가 /api/main-llm, userMessage 필드로 호출하던 버전을 위한 호환 엔드포인트."""
    return await chat_main(req)


# -------------------------------------------------------------------------
# 서브 LLM (STATE_UPDATE 생성용) API
# -------------------------------------------------------------------------
@app.post("/api/state-update")
async def state_update(req: StateUpdateRequest):
    """파이썬 매치엔진 결과 + 현재 STATE로 Gemini가 STATE_UPDATE JSON을 생성하게 한다."""
    if not req.apiKey:
        raise HTTPException(status_code=400, detail="apiKey is required")

    try:
        genai.configure(api_key=req.apiKey)
        model = genai.GenerativeModel(
            model_name="gemini-3-pro-preview",
            system_instruction=req.subPrompt or "",
        )

        payload = {
            "engine_output": req.engineOutput,
            "current_state": req.currentState or GAME_STATE,
        }
        prompt = json.dumps(payload, ensure_ascii=False, indent=2)
        resp = model.generate_content(prompt)
        raw_text = extract_text_from_gemini_response(resp)

        # JSON 파싱 시도
        cleaned = raw_text
        # ```json ... ``` 형태로 wrapping 되어 있다면 제거
        if cleaned.strip().startswith("```"):
            parts = cleaned.split("```")
            if len(parts) >= 3:
                cleaned = parts[1]
        cleaned = cleaned.strip()

        try:
            parsed = json.loads(cleaned)
        except Exception:
            parsed = None

        if parsed:
            apply_state_update(parsed)

        return {
            "raw": raw_text,
            "parsed": parsed,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini sub/state-update error: {e}")


@app.post("/api/state-update-llm")
async def state_update_legacy(req: StateUpdateRequest):
    """프론트 JS가 /api/state-update-llm 으로 호출하던 버전을 위한 호환 엔드포인트."""
    return await state_update(req)


# -------------------------------------------------------------------------
# 로스터 요약 API (LLM 컨텍스트용)
# -------------------------------------------------------------------------
@app.get("/api/roster-summary/{team_id}")
async def roster_summary(team_id: str):
    """특정 팀의 로스터를 LLM이 보기 좋은 형태로 요약해서 돌려준다."""
    team_id = team_id.upper()
    team_df = ROSTER_DF[ROSTER_DF["Team"] == team_id]

    if team_df.empty:
        raise HTTPException(status_code=404, detail=f"Team '{team_id}' not found in roster excel")

    players: List[Dict[str, Any]] = []
    for idx, row in team_df.iterrows():
        try:
            player_id = int(idx)
        except (TypeError, ValueError):
            player_id = str(idx)

        players.append({
            "player_id": player_id,
            "name": row["Name"],
            "pos": str(row.get("POS", "")),
            "overall": float(row.get("OVR", 0.0)) if "OVR" in team_df.columns else 0.0,
        })

    return {
        "team_id": team_id,
        "players": players[:12],
    }


# -------------------------------------------------------------------------
# 팀별 시즌 스케줄 조회 API
# -------------------------------------------------------------------------
@app.get("/api/team-schedule/{team_id}")
async def team_schedule(team_id: str):
    """마스터 스케줄 기준으로 특정 팀의 전체 시즌 일정을 반환."""
    team_id = team_id.upper()
    if team_id not in ALL_TEAM_IDS:
        raise HTTPException(status_code=404, detail=f"Team '{team_id}' not found in roster excel")

    # 마스터 스케줄이 없다면 생성
    initialize_master_schedule_if_needed()
    league = _ensure_league_state()
    master_schedule = league["master_schedule"]
    games = master_schedule.get("games") or []

    team_games: List[Dict[str, Any]] = [
        g for g in games
        if g.get("home_team_id") == team_id or g.get("away_team_id") == team_id
    ]
    team_games.sort(key=lambda g: (g.get("date"), g.get("game_id")))

    formatted_games: List[Dict[str, Any]] = []
    for g in team_games:
        home_score = g.get("home_score")
        away_score = g.get("away_score")
        result_for_team = None
        if home_score is not None and away_score is not None:
            if team_id == g.get("home_team_id"):
                result_for_team = "W" if home_score > away_score else "L"
            else:
                result_for_team = "W" if away_score > home_score else "L"

        formatted_games.append({
            "game_id": g.get("game_id"),
            "date": g.get("date"),
            "home_team_id": g.get("home_team_id"),
            "away_team_id": g.get("away_team_id"),
            "home_score": home_score,
            "away_score": away_score,
            "result_for_user_team": result_for_team,
        })

    return {
        "team_id": team_id,
        "games": formatted_games,
    }


# -------------------------------------------------------------------------
# STATE 요약 조회 API (프론트/디버그용)
# -------------------------------------------------------------------------
@app.get("/api/state/summary")
async def state_summary():
    """현재 GAME_STATE를 그대로 반환."""
    return GAME_STATE


@app.get("/api/debug/schedule-summary")
async def debug_schedule_summary():
    """마스터 스케줄 생성/검증용 디버그 엔드포인트."""
    return get_schedule_summary()
