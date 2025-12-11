# 플레이오프/포스트시즌 데이터 가용성 메모

프론트엔드(예: `po.html`)에서 어떤 정보를 바로 그릴 수 있고, 어떤 것은 추가 작업이 필요한지 정리한 메모입니다. 현재 코드 기준으로 `playoffs.py`, `server.py`, `state.py`가 제공하거나 저장하는 데이터만을 대상으로 합니다.

## 1. 바로 제공 가능한 정보

### 시드 및 플레이-인 필드
- `playoffs.build_postseason_field()`는 컨퍼런스별로 자동 진출(1~6위), 플레이-인(7~10위), 탈락(11위 이하) 리스트를 만들어 `team_id`, `seed`, `conference`, `division`, `wins`, `losses`, `win_pct`, `point_diff`를 포함합니다.
- `/api/postseason/field`에서 동일 구조를 그대로 반환하므로, 프론트는 시드표/플레이-인 참가팀 목록, 승률·득실차 등의 요약을 바로 렌더링할 수 있습니다.

### 플레이-인 진행 상태
- `initialize_postseason()`가 만든 플레이-인 상태(`postseason.play_in`)에는 컨퍼런스별로 `participants`(시드 맵), `matchups`(7vs8, 9vs10, 최종전), 각 매치업의 `result`(홈/어웨이 팀 ID, 점수, 승자), 확정된 `seed7`, `seed8`, `eliminated`가 포함됩니다.
- `/api/postseason/state`는 `GAME_STATE.postseason` 전체를 그대로 반환하므로, 플레이-인 중계 화면(대진, 결과, 탈락팀 표시 등)에 필요한 값은 이미 노출됩니다.

### 플레이오프 브래킷
- 플레이-인이 끝나면 `postseason.playoffs`에 `seeds`(컨퍼런스별 시드→팀 매핑), `bracket`(라운드별 시리즈 배열/객체), `current_round`가 채워집니다. 각 시리즈는 `round`, `matchup` 라벨, 홈코트 팀 ID/엔트리, 원정 팀 ID/엔트리, `games`(개별 경기 결과), 팀별 `wins`, `best_of`, `winner`를 담습니다.
- `/api/postseason/state`에서 그대로 조회 가능하므로, 라운드별 시리즈 박스, 승패 카운트, 개별 경기 스코어를 프론트에서 즉시 사용할 수 있습니다.

### 진행/시뮬레이션 트리거
- 서버는 다음 조작용 API를 이미 노출합니다:
  - `/api/postseason/reset` → 상태 초기화
  - `/api/postseason/setup` → 유저 팀을 받아 필드/플레이-인/플레이오프 초기화
  - `/api/postseason/play-in/my-team-game` → 유저 팀이 포함된 플레이-인 경기만 진행
  - `/api/postseason/playoffs/advance-my-team-game` → 유저 팀 시리즈만 1경기 진행
  - `/api/postseason/playoffs/auto-advance-round` → 현재 라운드 전체를 끝날 때까지 진행
- 위 API는 모두 `GAME_STATE.postseason`을 갱신하고 곧바로 결과를 반환하므로, 버튼 액션 후 새 상태를 다시 그릴 수 있습니다.

### 스코어/박스 점수 기본 정보
- 각 플레이-인/플레이오프 경기 결과 객체에는 홈·원정 팀 ID, 각 점수, `winner`, 전체 `final_score` 맵, `boxscore`가 포함되어 전달됩니다. 박스 점수 구조는 `MatchEngine` 결과에 의존하지만, 값 자체는 상태 및 API 응답에 포함됩니다.

## 2. 바로 제공하기 어려운 정보 (추가 구현 필요)

- **팀 메타데이터(이름, 로고, 색상)**: 상태와 API는 팀 ID만 노출합니다. 로고/닉네임 등 UI용 메타는 별도 매핑(예: 정적 자원 또는 추가 API) 없이 바로 렌더링할 수 없습니다.
- **시리즈/경기 일정 정보**: 플레이-오프 상태는 날짜/시간을 저장하지 않습니다. 경기 일정 타임라인을 보여주려면 스케줄 생성 또는 날짜 필드 추가가 필요합니다.
- **선수별 상세 스탯 라인**: `boxscore` 필드는 포함되지만 구체 스키마가 명시되지 않았고, 전송/렌더링 포맷이 확정되지 않았습니다. UI에 선수별 라인을 안정적으로 그리려면 스키마 합의와 직렬화 로직이 필요합니다.
- **뉴스/스토리라인**: 포스트시즌과 직접 연결된 뉴스/요약 텍스트는 생성하지 않습니다. 별도 LLM 호출이나 하이라이트 생성 로직이 필요합니다.
- **유저 컨텍스트(프론트 탭 상태 등)**: 서버는 단순 시뮬레이션 상태만 관리하며, 프론트 탭/필터/정렬 상태는 저장하지 않습니다. 클라이언트 측 상태 관리가 필요합니다.

## 3. 활용 팁
- 포스트시즌 화면은 `/api/postseason/state` 1회 호출만으로 필드·플레이-인·브래킷 정보를 모두 얻을 수 있습니다. 초기 렌더는 `build_postseason_field`를 별도로 호출하지 않아도 됩니다(`setup`이 내부에서 호출).
- 경기 진행 버튼을 누른 뒤에도 동일한 `/api/postseason/state` 응답을 재사용하면 되며, 프론트의 데이터 파싱 포인트는 `postseason.play_in`과 `postseason.playoffs.bracket`입니다.
- 팀 디스플레이용 메타데이터는 `team_utils.get_team_cards` 또는 정적 리소스를 조합해 별도로 로드해야 합니다.
