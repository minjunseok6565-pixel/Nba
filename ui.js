// DOM 요소 캐시
const screenApiKey = document.getElementById('screen-api-key');
const screenTeamSelect = document.getElementById('screen-team-select');
const screenMain = document.getElementById('screen-main');

const apiKeyInput = document.getElementById('apiKeyInput');
const btnApiKeyNext = document.getElementById('btnApiKeyNext');

const teamGrid = document.getElementById('teamGrid');
const btnTeamContinue = document.getElementById('btnTeamContinue');
const currentTeamLabel = document.getElementById('currentTeamLabel');

const navTabs = document.querySelectorAll('.tab-button');
const tabScreens = {
  home: document.getElementById('tab-home'),
  scores: document.getElementById('tab-scores'),
  schedule: document.getElementById('tab-schedule'),
  stats: document.getElementById('tab-stats'),
  teams: document.getElementById('tab-teams'),
  news: document.getElementById('tab-news')
};

const tabTitle = document.getElementById('tabTitle');

// 메인 탭 요소
const homeLog = document.getElementById('homeLog');
const homeUserInput = document.getElementById('homeUserInput');
const btnSendToLLM = document.getElementById('btnSendToLLM');
const homeLLMOutput = document.getElementById('homeLLMOutput');
const mainPromptTextarea = document.getElementById('mainPromptTextarea');
const llmStatus = document.getElementById('llmStatus');

// Scores / Schedule 탭
const scoresTable = document.getElementById('scoresTable');
const scheduleTable = document.getElementById('scheduleTable');

// Stats / Teams / News 탭 (지금은 더미/간단)
const statsTable = document.getElementById('statsTable');
const teamsTable = document.getElementById('teamsTable');
const newsList = document.getElementById('newsList');

// 사이드바 최근 경기 영역
const sidebarLastGame = document.getElementById('sidebarLastGame');

// 시즌 날짜/진행 턴 라벨
const seasonDateLabel = document.getElementById('seasonDateLabel');
const progressLabel = document.getElementById('progressLabel');

function showScreen(name) {
  screenApiKey.style.display = name === 'apiKey' ? 'block' : 'none';
  screenTeamSelect.style.display = name === 'teamSelect' ? 'block' : 'none';
  screenMain.style.display = name === 'main' ? 'block' : 'none';
}

// API 키 입력 단계 버튼
btnApiKeyNext.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    alert('Gemini API 키를 입력해주세요.');
    return;
  }
  appState.apiKey = key;
  showScreen('teamSelect');
});

// 팀 선택 UI 렌더링
function renderTeamCards() {
  teamGrid.innerHTML = '';
  TEAMS.forEach(team => {
    const card = document.createElement('div');
    card.className = 'team-card';
    card.innerHTML = `
      <h3>${team.name}</h3>
      <p>캡 상황: ${team.cap}</p>
      <p>전력: ${team.overall}</p>
      <p>난이도: ${team.difficulty}</p>
    `;
    card.addEventListener('click', () => selectTeam(team.id));
    teamGrid.appendChild(card);
  });
}

// 팀 선택
function selectTeam(teamId) {
  const team = TEAMS.find(t => t.id === teamId);
  if (!team) return;

  appState.selectedTeam = team;
  currentTeamLabel.textContent = `선택된 팀: ${team.name}`;
  btnTeamContinue.disabled = false;

  // 팀을 선택하면 초기 시즌 스케줄 / 상태를 비워두거나 재설정할 수도 있음
  appState.progressTurns = 0;
  appState.cachedViews = {
    last_progress_turn_id: null,
    scores: { latest_date: null, games: [] },
    schedule: { teamId: team.id, games: [], currentIndex: 0 },
    news: []
  };
  appState.rosters = {};
  appState.chatHistory = [];
  appState.firstMessageShownTeams = appState.firstMessageShownTeams || {};

  // 선택 시점에 로스터 요약을 미리 불러오기(서버에서)
  loadRosterForTeam(team.id);
}

// 팀 선택 완료 버튼
btnTeamContinue.addEventListener('click', () => {
  if (!appState.selectedTeam) {
    alert('팀을 먼저 선택하세요.');
    return;
  }
  showScreen('main');
  initializeMainState();
  showFirstMessageForSelectedTeam();
});

// 메인 탭 초기화
function initializeMainState() {
  if (!appState.selectedTeam) return;
  tabTitle.textContent = `${appState.selectedTeam.name} - 구단 운영`;

  // 먼저 서버에서 시즌 스케줄을 가져와서,
  // 진행된 경기/앞으로의 경기 정보를 가져오고,
  // 그다음에 탭을 전체 렌더링한다.
  generateSeasonSchedule(appState.selectedTeam.id)
    .then(() => {
      renderAllTabs();
      renderSidebarRecentGames();
    })
    .catch(err => {
      console.error('스케줄 로딩 중 오류:', err);
      alert('시즌 스케줄을 불러오는 중 오류가 발생했습니다.');
    });
}

// 탭 전환
navTabs.forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    switchTab(tab);
  });
});

function switchTab(tab) {
  Object.keys(tabScreens).forEach(key => {
    tabScreens[key].style.display = key === tab ? 'block' : 'none';
  });

  navTabs.forEach(btn => {
    if (btn.dataset.tab === tab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  let title = '구단 운영';
  switch (tab) {
    case 'home':
      title = '구단 운영';
      break;
    case 'scores':
      title = '경기 결과';
      break;
    case 'schedule':
      title = '시즌 일정';
      break;
    case 'stats':
      title = '리그 스탯(더미)';
      break;
    case 'teams':
      title = '리그 팀 정보(더미)';
      break;
    case 'news':
      title = '리그 뉴스(더미)';
      break;
  }
  tabTitle.textContent = title;

  if (tab === 'scores') {
    renderScores();
  } else if (tab === 'schedule') {
    renderSchedule();
  } else if (tab === 'stats') {
    renderStats();
  } else if (tab === 'teams') {
    renderTeams();
  } else if (tab === 'news') {
    renderNews();
  }
}

function renderAllTabs() {
  renderScores();
  renderSchedule();
  renderStats();
  renderTeams();
  renderNews();
}

// Scores 탭 렌더링
function renderScores() {
  const scores = appState.cachedViews.scores;
  const games = scores.games || [];

  let html = `
    <thead>
      <tr><th>날짜</th><th>홈</th><th>원정</th><th>스코어</th></tr>
    </thead>
    <tbody>
  `;
  if (games.length === 0) {
    html += `<tr><td colspan="4">아직 치러진 경기가 없습니다.</td></tr>`;
  } else {
    games.slice(0, 20).forEach(g => {
      const homeName =
        TEAMS.find(t => t.id === g.home_team_id)?.name || g.home_team_id;
      const awayName =
        TEAMS.find(t => t.id === g.away_team_id)?.name || g.away_team_id;
      const scoreText =
        g.home_score != null && g.away_score != null
          ? `${g.home_score} - ${g.away_score}`
          : '-';
      html += `
        <tr>
          <td>${g.date}</td>
          <td>${homeName}</td>
          <td>${awayName}</td>
          <td>${scoreText}</td>
        </tr>
      `;
    });
  }
  html += '</tbody>';
  scoresTable.innerHTML = html;
}

// Schedule 탭 렌더링
function renderSchedule() {
  const schedule = appState.cachedViews.schedule;
  const games = schedule.games || [];

  let html = `
    <thead>
      <tr><th>날짜</th><th>홈</th><th>원정</th><th>스코어</th></tr>
    </thead>
    <tbody>
  `;

  if (games.length === 0) {
    html += `<tr><td colspan="4">아직 시즌 스케줄이 없습니다.</td></tr>`;
  } else {
    games.forEach((g, idx) => {
      const homeName =
        TEAMS.find(t => t.id === g.home_team_id)?.name || g.home_team_id;
      const awayName =
        TEAMS.find(t => t.id === g.away_team_id)?.name || g.away_team_id;
      const scoreText =
        g.home_score != null && g.away_score != null
          ? `${g.home_score} - ${g.away_score}`
          : '-';

      const isCurrent = idx === appState.cachedViews.schedule.currentIndex;
      html += `
        <tr class="${isCurrent ? 'current-game-row' : ''}">
          <td>${g.date}</td>
          <td>${homeName}</td>
          <td>${awayName}</td>
          <td>${scoreText}</td>
        </tr>
      `;
    });
  }

  html += '</tbody>';
  scheduleTable.innerHTML = html;
}

// Stats 탭 (간단한 더미)
function renderStats() {
  statsTable.innerHTML = `
    <thead>
      <tr><th>지표</th><th>값</th></tr>
    </thead>
    <tbody>
      <tr><td>아직 구현 안 됨</td><td>-</td></tr>
    </tbody>
  `;
}

// Teams 탭 (간단한 팀 리스트)
function renderTeams() {
  let html = `
    <thead>
      <tr><th>팀</th><th>컨퍼런스/디비전</th><th>전력</th><th>난이도</th></tr>
    </thead>
    <tbody>
  `;
  TEAMS.forEach(team => {
    const { conference, division } = getTeamConfAndDiv(team.id);
    html += `
      <tr>
        <td>${team.name}</td>
        <td>${conference || '-'} / ${division || '-'}</td>
        <td>${team.overall}</td>
        <td>${team.difficulty}</td>
      </tr>
    `;
  });
  html += '</tbody>';
  teamsTable.innerHTML = html;
}

// News 탭 (간단한 더미: 서버에서 받은 뉴스 목록을 표시한다고 가정)
function renderNews() {
  const news = appState.cachedViews.news || [];
  newsList.innerHTML = '';

  if (news.length === 0) {
    const li = document.createElement('li');
    li.textContent = '아직 뉴스가 없습니다.';
    newsList.appendChild(li);
    return;
  }

  news.forEach(item => {
    const li = document.createElement('li');
    li.textContent = `[${item.date}] ${item.title}`;
    newsList.appendChild(li);
  });
}

// 사이드바 최근 경기 렌더링
function renderSidebarRecentGames() {
  sidebarLastGame.innerHTML = '';

  const scores = appState.cachedViews.scores;
  const games = scores.games || [];
  if (games.length === 0) {
    const div = document.createElement('div');
    div.textContent = '아직 경기 기록이 없습니다.';
    sidebarLastGame.appendChild(div);
    return;
  }

  const lastGames = games.slice(0, 3);
  lastGames.forEach(g => {
    const homeName =
      TEAMS.find(t => t.id === g.home_team_id)?.name || g.home_team_id;
    const awayName =
      TEAMS.find(t => t.id === g.away_team_id)?.name || g.away_team_id;
    const scoreText =
      g.home_score != null && g.away_score != null
        ? `${g.home_score} - ${g.away_score}`
        : '-';
    const date = g.date;

    const item = document.createElement('div');
    item.className = 'recent-game-item';
    item.innerHTML = `
      <div class="recent-game-main">
        <span class="recent-game-date">${date}</span>
        <span class="recent-game-teams">${homeName} vs ${awayName}</span>
      </div>
      <div class="recent-game-score">${scoreText}</div>
    `;

    sidebarLastGame.appendChild(item);
  });
}


// 초기화
renderTeamCards();
showScreen('apiKey');
