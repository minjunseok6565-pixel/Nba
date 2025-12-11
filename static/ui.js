// DOM 요소 캐시
const screenApiKey = document.getElementById('screen-api-key');
const screenTeamSelect = document.getElementById('screen-team-select');
const screenMain = document.getElementById('screen-main');

const apiKeyInput = document.getElementById('apiKeyInput');
const btnApiKeyNext = document.getElementById('btnValidateKey');
const apiError = document.getElementById('apiError');
const apiSuccess = document.getElementById('apiSuccess');

const teamGrid = document.getElementById('teamGrid');
const btnTeamContinue = document.getElementById('btnTeamContinue');
const currentTeamLabel = document.getElementById('currentTeamLabel');

const navTabs = document.querySelectorAll('.nav-tab');
const tabScreens = {
  home: document.getElementById('tab-home'),
  tactics: document.getElementById('tab-tactics'),
  scores: document.getElementById('tab-scores'),
  schedule: document.getElementById('tab-schedule'),
  standings: document.getElementById('tab-standings'),
  stats: document.getElementById('tab-stats'),
  teams: document.getElementById('tab-teams'),
  news: document.getElementById('tab-news')
};

const tabTitle = document.getElementById('tabTitle');

// 메인 탭 요소
const homeLog = document.getElementById('homeLog');
const homeUserInput = document.getElementById('homeUserInput');
const btnSendToLLM = document.getElementById('btnSendToLLM');
const btnSimGame = document.getElementById('btnSimGame');
const homeLLMOutput = document.getElementById('homeLLMOutput');
const mainPromptTextarea = document.getElementById('mainPromptTextarea');
const llmStatus = document.getElementById('llmStatus');

// Scores / Schedule 탭
const scoresTable = document.getElementById('scoresTable');
const scheduleTable = document.getElementById('scheduleTable');
const standingsTable = document.getElementById('standingsTable');

// Stats / Teams / News 탭 (지금은 더미/간단)
const statsTable = document.getElementById('statsTable');
const teamsTable = document.getElementById('teamsTable');
const newsList = document.getElementById('newsList');
let teamDetailPanel = document.getElementById('teamDetailPanel');

// 사이드바 최근 경기 영역
const sidebarLastGame = document.getElementById('sidebarLastGame');

// 시즌 날짜/진행 턴 라벨
const seasonDateLabel = document.getElementById('seasonDateLabel');
const progressLabel = document.getElementById('progressLabel');

// 프롬프트 팝오버 요소
const promptToggle = document.getElementById('promptToggle');
const promptPopover = document.getElementById('promptPopover');
const promptTabButtons = document.querySelectorAll('.prompt-tab-btn');
const promptTabContents = document.querySelectorAll('.prompt-tab-content');
const lorebookFileInput = document.getElementById('lorebookFile');
const lorebookStatus = document.getElementById('lorebookStatus');

// Tactics 탭 요소
const tacticsPaceInput = document.getElementById('tactics-pace');
const tacticsPaceLabel = document.getElementById('tactics-pace-label');
const tacticsOffenseSelect = document.getElementById('tactics-offense-scheme');
const tacticsOffenseSecondarySelect = document.getElementById('tactics-offense-scheme-secondary');
const tacticsOffenseShareInput = document.getElementById('tactics-offense-share');
const tacticsOffenseShareLabel = document.getElementById('tactics-offense-share-label');
const tacticsDefenseSelect = document.getElementById('tactics-defense-scheme');
const tacticsDefenseSecondarySelect = document.getElementById('tactics-defense-scheme-secondary');
const tacticsDefenseShareInput = document.getElementById('tactics-defense-share');
const tacticsDefenseShareLabel = document.getElementById('tactics-defense-share-label');
const tacticsRotationSelect = document.getElementById('tactics-rotation-size');
const tacticsTeamLabel = document.getElementById('tactics-team-label');
const tacticsStartersContainer = document.getElementById('tactics-starters');
const tacticsBenchContainer = document.getElementById('tactics-bench');
const tacticsRosterList = document.getElementById('tactics-roster-list');
const tacticsLineupSummary = document.getElementById('tactics-lineup-summary');
const tacticsMinutesList = document.getElementById('tactics-minutes-list');
const tacticsMinutesSummary = document.getElementById('tactics-minutes-summary');

const ROTATION_MINUTE_DEFAULTS = {
  6: { starter: 41, bench: 35 },
  7: { starter: 36, bench: 30 },
  8: { starter: 33, bench: 25 },
  9: { starter: 28, bench: 25 },
  10: { starter: 25, bench: 23 }
};

function showScreen(name) {
  screenApiKey.style.display = name === 'apiKey' ? 'block' : 'none';
  screenTeamSelect.style.display = name === 'teamSelect' ? 'block' : 'none';
  screenMain.style.display = name === 'main' ? 'block' : 'none';
}

// API 키 입력 단계 버튼
btnApiKeyNext.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  apiError.textContent = '';
  apiSuccess.textContent = '';

  if (!key) {
    apiError.textContent = 'Gemini API 키를 입력해주세요.';
    return;
  }

  // 간단한 형식 검증 (AIza로 시작하는 키)
  if (!/^AIza[0-9A-Za-z\-_]{10,}$/.test(key)) {
    apiError.textContent = '키 형식이 올바르지 않습니다. AIza... 형태인지 확인하세요.';
    return;
  }

  btnApiKeyNext.disabled = true;
  const originalText = btnApiKeyNext.textContent;
  btnApiKeyNext.textContent = '검증 중...';

  try {
    const res = await fetch('/api/validate-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    });

    if (!res.ok) {
      let message = 'API 키 검증에 실패했습니다.';
      try {
        const data = await res.json();
        if (data?.detail) message = data.detail;
      } catch (_) {}
      throw new Error(message);
    }

    apiSuccess.textContent = 'API 키가 확인되었습니다!';
    appState.apiKey = key;
    showScreen('teamSelect');
  } catch (err) {
    apiError.textContent = err.message || 'API 키 검증 중 오류가 발생했습니다.';
  } finally {
    btnApiKeyNext.disabled = false;
    btnApiKeyNext.textContent = originalText;
  }
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
    news: [],
    stats: { leaders: null, lastLoaded: null },
    standings: { east: [], west: [], lastLoaded: null },
    teams: { list: [], detailById: {}, lastLoaded: null },
    weeklyNews: { items: [], lastLoaded: null }
  };
  appState.rosters = {};
  appState.chatHistory = [];
  appState.firstMessageShownTeams = appState.firstMessageShownTeams || {};

  // 팀별 전술 기본값 준비
  getOrCreateTacticsForTeam(team.id);

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

  let title = '';
  switch (tab) {
    case 'home':
      title = '구단 운영 / 홈';
      break;
    case 'tactics':
      title = '전술 설정 (Tactics)';
      break;
    case 'scores':
      title = '경기 결과';
      break;
    case 'schedule':
      title = '시즌 일정';
      break;
    case 'standings':
      title = '리그 순위';
      break;
    case 'stats':
      title = '리그 스탯';
      break;
    case 'teams':
      title = '리그 팀 정보';
      break;
    case 'news':
      title = '리그 뉴스';
      break;
  }
  tabTitle.textContent = title;

  if (tab === 'scores') {
    renderScores();
  } else if (tab === 'schedule') {
    renderSchedule();
  } else if (tab === 'standings') {
    renderStandings();
  } else if (tab === 'stats') {
    renderStats();
  } else if (tab === 'teams') {
    renderTeams();
  } else if (tab === 'news') {
    renderNews();
  } else if (tab === 'tactics') {
    renderTacticsTab();
  }
}

async function renderTacticsTab() {
  const team = appState.selectedTeam;
  if (!team) {
    if (tacticsTeamLabel) {
      tacticsTeamLabel.textContent = '먼저 팀 선택 화면에서 팀을 선택해주세요.';
    }
    if (tacticsRosterList) tacticsRosterList.innerHTML = '';
    if (tacticsStartersContainer) tacticsStartersContainer.innerHTML = '';
    if (tacticsBenchContainer) tacticsBenchContainer.innerHTML = '';
    if (tacticsLineupSummary) tacticsLineupSummary.textContent = '';
    return;
  }

  const teamId = team.id;
  const tactics = getOrCreateTacticsForTeam(teamId);

  if (tacticsTeamLabel) {
    tacticsTeamLabel.textContent = `${team.name} (${team.id})`;
  }

  if (tacticsPaceInput) {
    tacticsPaceInput.value = tactics.pace ?? 0;
    updateTacticsPaceLabel();
  }
  if (tacticsOffenseSelect) {
    tacticsOffenseSelect.value = tactics.offenseScheme || 'pace_space';
  }
  if (tacticsOffenseSecondarySelect) {
    tacticsOffenseSecondarySelect.value = tactics.offenseSecondaryScheme || 'pace_space';
  }
  if (tacticsOffenseShareInput) {
    updateOffenseShareLabel(tactics);
  }
  if (tacticsDefenseSelect) {
    tacticsDefenseSelect.value = tactics.defenseScheme || 'drop_coverage';
  }
  if (tacticsDefenseSecondarySelect) {
    tacticsDefenseSecondarySelect.value = tactics.defenseSecondaryScheme || 'drop_coverage';
  }
  if (tacticsDefenseShareInput) {
    updateDefenseShareLabel(tactics);
  }
  if (tacticsRotationSelect) {
    tacticsRotationSelect.value = String(tactics.rotationSize || 9);
  }

  await loadRosterForTeam(teamId);
  const rosterData = appState.rosters[teamId];
  const players = (rosterData && rosterData.players) || [];

  renderTacticsLineup(players, tactics);
}

function updateTacticsPaceLabel() {
  if (!tacticsPaceInput || !tacticsPaceLabel) return;
  const v = Number(tacticsPaceInput.value || 0);
  let text = '';
  if (v === -2) text = '매우 느림';
  else if (v === -1) text = '느림';
  else if (v === 0) text = '보통';
  else if (v === 1) text = '빠름';
  else if (v === 2) text = '매우 빠름';
  tacticsPaceLabel.textContent = `${v} (${text})`;
}

function getDefaultMinutesForRole(role, rotationSize) {
  const defaults = ROTATION_MINUTE_DEFAULTS[rotationSize] || { starter: 32, bench: 22 };
  return role === 'starter' ? defaults.starter : defaults.bench;
}

function updateOffenseShareLabel(tactics) {
  if (!tacticsOffenseShareInput || !tacticsOffenseShareLabel) return;
  const secondary = Number(tactics.offenseSecondaryWeight ?? 5);
  const primary = Math.max(secondary, 10 - secondary);
  tactics.offensePrimaryWeight = primary;
  tactics.offenseSecondaryWeight = secondary;
  tacticsOffenseShareInput.value = String(secondary);
  tacticsOffenseShareLabel.textContent = `메인 ${primary} : 보조 ${secondary}`;
}

function updateDefenseShareLabel(tactics) {
  if (!tacticsDefenseShareInput || !tacticsDefenseShareLabel) return;
  const secondary = Number(tactics.defenseSecondaryWeight ?? 5);
  const primary = Math.max(secondary, 10 - secondary);
  tactics.defensePrimaryWeight = primary;
  tactics.defenseSecondaryWeight = secondary;
  tacticsDefenseShareInput.value = String(secondary);
  tacticsDefenseShareLabel.textContent = `메인 ${primary} : 보조 ${secondary}`;
}

function ensureMinutesForLineup(startersList, benchList, tactics) {
  if (!tactics.minutes) tactics.minutes = {};
  const rotationSize = tactics.rotationSize || 9;
  const rotationIds = new Set([...startersList, ...benchList].map(p => p.player_id));

  startersList.forEach(p => {
    if (tactics.minutes[p.player_id] == null) {
      tactics.minutes[p.player_id] = getDefaultMinutesForRole('starter', rotationSize);
    }
  });

  benchList.forEach(p => {
    if (tactics.minutes[p.player_id] == null) {
      tactics.minutes[p.player_id] = getDefaultMinutesForRole('bench', rotationSize);
    }
  });

  Object.keys(tactics.minutes).forEach(pid => {
    if (!rotationIds.has(Number(pid))) {
      delete tactics.minutes[pid];
    }
  });
}

function renderMinutesEditor(startersList, benchList, tactics) {
  if (!tacticsMinutesList || !tacticsMinutesSummary) return;
  const rotationSize = tactics.rotationSize || 9;
  ensureMinutesForLineup(startersList, benchList, tactics);

  const minutes = tactics.minutes || {};
  const rows = [
    ...startersList.map(p => ({ player: p, role: '스타팅' })),
    ...benchList.map(p => ({ player: p, role: '벤치' }))
  ];

  tacticsMinutesList.innerHTML = '';
  let totalMinutes = 0;

  rows.forEach(({ player, role }) => {
    const row = document.createElement('div');
    row.className = 'tactics-minute-row';

    const name = document.createElement('div');
    name.className = 'player-name';
    name.textContent = `${player.name} (${player.pos})`;

    const roleLabel = document.createElement('div');
    roleLabel.className = 'player-role';
    roleLabel.textContent = role;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '48';
    input.step = '0.5';
    input.className = 'tactics-minute-input';
    input.value = minutes[player.player_id] ?? getDefaultMinutesForRole(role === '스타팅' ? 'starter' : 'bench', rotationSize);

    input.addEventListener('input', () => {
      const val = Math.max(0, Math.min(48, Number(input.value)));
      tactics.minutes[player.player_id] = val;
      input.value = String(val);
      renderMinutesEditor(startersList, benchList, tactics);
    });

    totalMinutes += Number(input.value) || 0;

    row.appendChild(name);
    row.appendChild(roleLabel);
    row.appendChild(input);
    tacticsMinutesList.appendChild(row);
  });

  tacticsMinutesSummary.textContent = `총 ${totalMinutes.toFixed(1)}분 (목표 240분, 비율 기준으로 환산)`;
}

function renderTacticsLineup(players, tactics) {
  if (!tacticsStartersContainer || !tacticsBenchContainer || !tacticsRosterList) return;

  const rotationSize = tactics.rotationSize || 9;
  const starterSet = new Set(tactics.starters || []);
  const benchSet = new Set(tactics.bench || []);

  let startersList = players.filter(p => starterSet.has(p.player_id)).slice(0, 5);
  let benchList = players.filter(p => benchSet.has(p.player_id));

  const maxBench = Math.max(0, rotationSize - startersList.length);
  if (benchList.length > maxBench) {
    benchList = benchList.slice(0, maxBench);
  }

  const normalizedStarters = new Set(startersList.map(p => p.player_id));
  const normalizedBench = new Set(benchList.map(p => p.player_id));

  tactics.starters = Array.from(normalizedStarters);
  tactics.bench = Array.from(normalizedBench);

  tacticsStartersContainer.innerHTML = '';
  tacticsBenchContainer.innerHTML = '';

  const makeTag = p => {
    const div = document.createElement('div');
    div.className = 'tactics-player-tag';
    div.textContent = `${p.name} (${p.pos}, OVR ${p.overall})`;
    return div;
  };

  startersList.forEach(p => tacticsStartersContainer.appendChild(makeTag(p)));
  benchList.forEach(p => tacticsBenchContainer.appendChild(makeTag(p)));

  tacticsRosterList.innerHTML = '';
  players.forEach(p => {
    const row = document.createElement('div');
    row.className = 'tactics-roster-row';

    const info = document.createElement('div');
    info.className = 'tactics-roster-info';
    info.textContent = `${p.name} (${p.pos}, OVR ${p.overall})`;

    const actions = document.createElement('div');
    actions.className = 'tactics-roster-actions';

    const btnStarter = document.createElement('button');
    btnStarter.type = 'button';
    btnStarter.textContent = '스타팅';
    btnStarter.className = 'tactics-role-button';

    const btnBench = document.createElement('button');
    btnBench.type = 'button';
    btnBench.textContent = '벤치';
    btnBench.className = 'tactics-role-button';

    const refreshButtonClasses = () => {
      btnStarter.classList.toggle('selected', normalizedStarters.has(p.player_id));
      btnBench.classList.toggle('selected', normalizedBench.has(p.player_id));
    };
    refreshButtonClasses();

    btnStarter.addEventListener('click', () => {
      if (normalizedStarters.has(p.player_id)) {
        normalizedStarters.delete(p.player_id);
      } else {
        if (normalizedStarters.size >= 5) {
          alert('스타팅은 최대 5명까지 설정할 수 있습니다.');
          return;
        }
        normalizedStarters.add(p.player_id);
        normalizedBench.delete(p.player_id);
      }

      if (normalizedStarters.size + normalizedBench.size > rotationSize) {
        alert(`로테이션 인원(${rotationSize}명)을 초과했습니다.`);
        normalizedStarters.delete(p.player_id);
      } else {
        tactics.starters = Array.from(normalizedStarters);
        tactics.bench = Array.from(normalizedBench);
        renderTacticsLineup(players, tactics);
      }
    });

    btnBench.addEventListener('click', () => {
      if (normalizedBench.has(p.player_id)) {
        normalizedBench.delete(p.player_id);
      } else {
        if (normalizedStarters.size + normalizedBench.size >= rotationSize) {
          alert(`로테이션 인원(${rotationSize}명)을 초과했습니다.`);
          return;
        }
        normalizedBench.add(p.player_id);
        normalizedStarters.delete(p.player_id);
      }

      tactics.starters = Array.from(normalizedStarters);
      tactics.bench = Array.from(normalizedBench);
      renderTacticsLineup(players, tactics);
    });

    actions.appendChild(btnStarter);
    actions.appendChild(btnBench);

    row.appendChild(info);
    row.appendChild(actions);
    tacticsRosterList.appendChild(row);
  });

  if (tacticsLineupSummary) {
    const total = normalizedStarters.size + normalizedBench.size;
    tacticsLineupSummary.textContent =
      `현재 로테이션: 스타팅 ${normalizedStarters.size}명 + 벤치 ${normalizedBench.size}명 = 총 ${total}명 (설정값: ${rotationSize}명)`;
  }

  renderMinutesEditor(startersList, benchList, tactics);
}

// 프롬프트 팝오버 토글
function togglePromptPopover(forceOpen) {
  if (!promptPopover) return;
  const willOpen =
    typeof forceOpen === 'boolean'
      ? forceOpen
      : !promptPopover.classList.contains('open');
  promptPopover.classList.toggle('open', willOpen);
  if (promptToggle) {
    promptToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  }
}

function activatePromptTab(tabName) {
  promptTabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ptab === tabName);
  });
  promptTabContents.forEach(content => {
    content.classList.toggle(
      'active',
      content.dataset.ptabContent === tabName
    );
  });
}

if (promptToggle && promptPopover) {
  promptToggle.addEventListener('click', e => {
    e.stopPropagation();
    togglePromptPopover();
  });

  document.addEventListener('click', e => {
    if (!promptPopover.classList.contains('open')) return;
    if (
      !promptPopover.contains(e.target) &&
      !promptToggle.contains(e.target)
    ) {
      togglePromptPopover(false);
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && promptPopover.classList.contains('open')) {
      togglePromptPopover(false);
    }
  });
}

promptTabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    activatePromptTab(btn.dataset.ptab);
  });
});

if (tacticsPaceInput) {
  tacticsPaceInput.addEventListener('input', () => {
    updateTacticsPaceLabel();
    const team = appState.selectedTeam;
    if (!team) return;
    const tactics = getOrCreateTacticsForTeam(team.id);
    tactics.pace = Number(tacticsPaceInput.value || 0);
  });
}

if (tacticsOffenseSelect) {
  tacticsOffenseSelect.addEventListener('change', () => {
    const team = appState.selectedTeam;
    if (!team) return;
    const tactics = getOrCreateTacticsForTeam(team.id);
    tactics.offenseScheme = tacticsOffenseSelect.value;
  });
}

if (tacticsOffenseSecondarySelect) {
  tacticsOffenseSecondarySelect.addEventListener('change', () => {
    const team = appState.selectedTeam;
    if (!team) return;
    const tactics = getOrCreateTacticsForTeam(team.id);
    tactics.offenseSecondaryScheme = tacticsOffenseSecondarySelect.value;
    if (tactics.offenseSecondaryScheme === 'none') {
      tactics.offenseSecondaryWeight = 0;
    }
    updateOffenseShareLabel(tactics);
  });
}

if (tacticsOffenseShareInput) {
  tacticsOffenseShareInput.addEventListener('input', () => {
    const team = appState.selectedTeam;
    if (!team) return;
    const tactics = getOrCreateTacticsForTeam(team.id);
    const val = Math.max(0, Math.min(5, Number(tacticsOffenseShareInput.value)));
    tactics.offenseSecondaryWeight = val;
    updateOffenseShareLabel(tactics);
  });
}

if (tacticsDefenseSelect) {
  tacticsDefenseSelect.addEventListener('change', () => {
    const team = appState.selectedTeam;
    if (!team) return;
    const tactics = getOrCreateTacticsForTeam(team.id);
    tactics.defenseScheme = tacticsDefenseSelect.value;
  });
}

if (tacticsDefenseSecondarySelect) {
  tacticsDefenseSecondarySelect.addEventListener('change', () => {
    const team = appState.selectedTeam;
    if (!team) return;
    const tactics = getOrCreateTacticsForTeam(team.id);
    tactics.defenseSecondaryScheme = tacticsDefenseSecondarySelect.value;
    if (tactics.defenseSecondaryScheme === 'none') {
      tactics.defenseSecondaryWeight = 0;
    }
    updateDefenseShareLabel(tactics);
  });
}

if (tacticsDefenseShareInput) {
  tacticsDefenseShareInput.addEventListener('input', () => {
    const team = appState.selectedTeam;
    if (!team) return;
    const tactics = getOrCreateTacticsForTeam(team.id);
    const val = Math.max(0, Math.min(5, Number(tacticsDefenseShareInput.value)));
    tactics.defenseSecondaryWeight = val;
    updateDefenseShareLabel(tactics);
  });
}

if (tacticsRotationSelect) {
  tacticsRotationSelect.addEventListener('change', () => {
    const team = appState.selectedTeam;
    if (!team) return;
    const tactics = getOrCreateTacticsForTeam(team.id);
    tactics.rotationSize = Number(tacticsRotationSelect.value || 9);

    const rosterData = appState.rosters[team.id];
    const players = (rosterData && rosterData.players) || [];
    renderTacticsLineup(players, tactics);
  });
}

if (lorebookFileInput && lorebookStatus) {
  lorebookFileInput.addEventListener('change', () => {
    const file = lorebookFileInput.files?.[0];
    if (file) {
      const sizeKb = (file.size / 1024).toFixed(1);
      lorebookStatus.textContent = `${file.name} (${sizeKb} KB) 업로드 준비됨`;
      lorebookStatus.classList.remove('muted');
    } else {
      lorebookStatus.textContent = '아직 업로드된 파일이 없습니다.';
      lorebookStatus.classList.add('muted');
    }
  });
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

async function loadStandingsIfNeeded(force = false) {
  const cv = appState.cachedViews.standings;
  if (!cv) return;
  if (!force && cv.lastLoaded) return;

  try {
    const res = await fetch('/api/standings');
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const data = await res.json();
    cv.east = data.east || [];
    cv.west = data.west || [];
    cv.lastLoaded = new Date().toISOString();
  } catch (err) {
    console.warn('standings 로드 실패:', err);
    standingsTable.innerHTML = '<tbody><tr><td>순위를 불러오는 중 오류가 발생했습니다.</td></tr></tbody>';
  }
}

async function renderStandings() {
  await loadStandingsIfNeeded();
  const cv = appState.cachedViews.standings;
  const east = cv.east || [];
  const west = cv.west || [];

  const renderConference = (rows, title) => {
    let html = `<thead><tr><th colspan="7">${title}</th></tr>`;
    html += '<tr><th>순위</th><th>팀</th><th>승-패</th><th>승률</th><th>GB</th><th>PF</th><th>PA</th></tr></thead><tbody>';
    if (!rows.length) {
      html += '<tr><td colspan="7">데이터가 없습니다.</td></tr>';
    } else {
      rows.forEach((team, idx) => {
        const teamName = TEAMS.find(t => t.id === team.team_id)?.name || team.team_id;
        const gb = team.gb != null ? Number(team.gb).toFixed(1) : '-';
        const winPct = team.win_pct != null ? Number(team.win_pct).toFixed(3) : '-';
        html += `
          <tr>
            <td>${idx + 1}</td>
            <td>${teamName}</td>
            <td>${team.wins}-${team.losses}</td>
            <td>${winPct}</td>
            <td>${gb}</td>
            <td>${team.pf ?? '-'}</td>
            <td>${team.pa ?? '-'}</td>
          </tr>
        `;
      });
    }
    html += '</tbody>';
    return html;
  };

  standingsTable.innerHTML = `${renderConference(east, '동부 컨퍼런스')}${renderConference(west, '서부 컨퍼런스')}`;
}

async function loadStatsLeadersIfNeeded(force = false) {
  const cv = appState.cachedViews.stats;
  if (!cv) return;
  if (!force && cv.lastLoaded) return;
  try {
    const res = await fetch('/api/stats/leaders');
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const data = await res.json();
    cv.leaders = data.leaders || null;
    cv.lastLoaded = data.updated_at || new Date().toISOString();
  } catch (err) {
    console.warn('stats leaders 로드 실패:', err);
    statsTable.innerHTML = '<tbody><tr><td>리더보드를 불러오는 중 오류가 발생했습니다.</td></tr></tbody>';
  }
}

async function renderStats() {
  await loadStatsLeadersIfNeeded();
  const leaders = appState.cachedViews.stats.leaders;

  if (!leaders) {
    statsTable.innerHTML = '<tbody><tr><td>표시할 리더보드 데이터가 없습니다.</td></tr></tbody>';
    return;
  }

  const categories = [
    { key: 'PTS', label: '득점 (PTS)' },
    { key: 'AST', label: '어시스트 (AST)' },
    { key: 'REB', label: '리바운드 (REB)' },
    { key: '3PM', label: '3점 성공 (3PM)' }
  ];

  let html = '<tbody><tr><td colspan="5" class="stats-header">리그 리더보드</td></tr>';
  categories.forEach(cat => {
    const items = leaders[cat.key] || [];
    html += `<tr class="stats-category-row"><td colspan="5">${cat.label}</td></tr>`;
    html += '<tr><th>순위</th><th>선수</th><th>팀</th><th>GP</th><th>평균</th></tr>';
    if (!items.length) {
      html += '<tr><td colspan="5">데이터 없음</td></tr>';
    } else {
      items.slice(0, 5).forEach((p, idx) => {
        const teamName = TEAMS.find(t => t.id === p.team_id)?.name || p.team_id;
        const gp = p.GP ?? p.games_played ?? '-';
        const val = p[cat.key] != null ? Number(p[cat.key]).toFixed(1) : '-';
        html += `
          <tr>
            <td>${idx + 1}</td>
            <td>${p.name}</td>
            <td>${teamName}</td>
            <td>${gp}</td>
            <td>${val}</td>
          </tr>
        `;
      });
    }
  });
  html += '</tbody>';
  statsTable.innerHTML = html;
}

async function loadTeamsListIfNeeded(force = false) {
  const cv = appState.cachedViews.teams;
  if (!cv) return;
  if (!force && cv.list.length > 0) return;

  try {
    const res = await fetch('/api/teams');
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const data = await res.json();
    cv.list = Array.isArray(data) ? data : [];
    cv.lastLoaded = new Date().toISOString();
  } catch (err) {
    console.warn('teams 리스트 로드 실패:', err);
    teamsTable.innerHTML = '<tbody><tr><td>팀 정보를 불러오는 중 오류가 발생했습니다.</td></tr></tbody>';
  }
}

async function renderTeams() {
  await loadTeamsListIfNeeded();
  const list = appState.cachedViews.teams.list || [];

  let html = `
    <thead>
      <tr><th>팀</th><th>컨퍼런스/디비전</th><th>전적</th><th>성향</th><th>페이롤 / 캡</th></tr>
    </thead>
    <tbody>
  `;

  if (!list.length) {
    html += '<tr><td colspan="5">표시할 팀 데이터가 없습니다.</td></tr>';
  } else {
    list.forEach(item => {
      const teamMeta = TEAMS.find(t => t.id === item.team_id);
      const teamName = teamMeta?.name || item.team_id;
      const confDiv = `${item.conference || '-'} / ${item.division || '-'}`;
      const record = `${item.wins ?? '-'}-${item.losses ?? '-'}`;
      const winPct = item.win_pct != null ? ` (${Number(item.win_pct).toFixed(3)})` : '';
      const payroll = item.payroll != null ? `${(item.payroll / 1_000_000).toFixed(1)}M` : '-';
      const capSpace = item.cap_space != null ? `${(item.cap_space / 1_000_000).toFixed(1)}M` : '-';
      html += `
        <tr class="team-row" data-team-id="${item.team_id}">
          <td>${teamName}</td>
          <td>${confDiv}</td>
          <td>${record}${winPct}</td>
          <td>${item.tendency || '-'}</td>
          <td>${payroll} / ${capSpace}</td>
        </tr>
      `;
    });
  }

  html += '</tbody>';
  teamsTable.innerHTML = html;

  if (!teamDetailPanel) {
    teamDetailPanel = document.createElement('div');
    teamDetailPanel.id = 'teamDetailPanel';
    const tabTeams = document.getElementById('tab-teams');
    tabTeams.appendChild(teamDetailPanel);
  }

  teamsTable.querySelectorAll('.team-row').forEach(row => {
    row.addEventListener('click', () => {
      const tid = row.dataset.teamId;
      openTeamDetail(tid);
    });
  });
}

async function openTeamDetail(teamId) {
  const cv = appState.cachedViews.teams;
  if (!cv) return;

  if (!cv.detailById[teamId]) {
    try {
      const res = await fetch(`/api/team-detail/${teamId}`);
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      cv.detailById[teamId] = data;
    } catch (err) {
      console.warn('team detail 로드 실패:', err);
      if (teamDetailPanel) {
        teamDetailPanel.innerHTML = '<div class="muted">팀 정보를 불러오는 중 오류가 발생했습니다.</div>';
      }
      return;
    }
  }

  const detail = cv.detailById[teamId];
  const summary = detail.summary || {};
  const teamMeta = TEAMS.find(t => t.id === teamId);
  const teamName = teamMeta?.name || teamId;
  const record = summary.wins != null && summary.losses != null ? `${summary.wins}-${summary.losses}` : '-';
  const winPct = summary.win_pct != null ? Number(summary.win_pct).toFixed(3) : '-';
  const pd = summary.point_diff != null ? Number(summary.point_diff).toFixed(1) : '-';
  const payroll = summary.payroll != null ? `${(summary.payroll / 1_000_000).toFixed(1)}M` : '-';
  const capSpace = summary.cap_space != null ? `${(summary.cap_space / 1_000_000).toFixed(1)}M` : '-';

  let rosterHtml = '<table class="roster-table"><thead><tr><th>선수</th><th>포지션</th><th>OVR</th><th>나이</th><th>샐러리</th><th>PTS</th><th>AST</th><th>REB</th><th>3PM</th></tr></thead><tbody>';
  if (!detail.roster || detail.roster.length === 0) {
    rosterHtml += '<tr><td colspan="9">로스터 정보가 없습니다.</td></tr>';
  } else {
    detail.roster.forEach(p => {
      const salary = p.salary != null ? `${(p.salary / 1_000_000).toFixed(1)}M` : '-';
      const pts = p.pts != null ? Number(p.pts).toFixed(1) : '-';
      const ast = p.ast != null ? Number(p.ast).toFixed(1) : '-';
      const reb = p.reb != null ? Number(p.reb).toFixed(1) : '-';
      const three = p.three_pm != null ? Number(p.three_pm).toFixed(1) : '-';
      rosterHtml += `
        <tr>
          <td>${p.name}</td>
          <td>${p.pos}</td>
          <td>${p.ovr ?? '-'}</td>
          <td>${p.age ?? '-'}</td>
          <td>${salary}</td>
          <td>${pts}</td>
          <td>${ast}</td>
          <td>${reb}</td>
          <td>${three}</td>
        </tr>
      `;
    });
  }
  rosterHtml += '</tbody></table>';

  teamDetailPanel.innerHTML = `
    <div class="team-detail">
      <h3>${teamName}</h3>
      <div class="team-summary">
        <div>컨퍼런스/디비전: ${summary.conference || '-'} / ${summary.division || '-'}</div>
        <div>전적: ${record} (승률 ${winPct})</div>
        <div>득실차: ${pd}</div>
        <div>성향: ${summary.tendency || '-'}</div>
        <div>페이롤: ${payroll}</div>
        <div>캡 스페이스: ${capSpace}</div>
        <div>컨퍼런스 순위: ${summary.conference_rank ?? '-'}</div>
      </div>
      <div class="team-roster">
        <h4>로스터</h4>
        ${rosterHtml}
      </div>
    </div>
  `;
}

async function loadWeeklyNewsIfNeeded(force = false) {
  const cv = appState.cachedViews.weeklyNews;
  if (!cv) return;
  if (!appState.apiKey) return;
  if (!force && cv.lastLoaded) return;

  try {
    const res = await fetch('/api/news/week', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: appState.apiKey })
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const data = await res.json();
    cv.items = data.items || [];
    cv.lastLoaded = data.current_date || new Date().toISOString();
  } catch (err) {
    console.warn('weekly news 로드 실패:', err);
    newsList.innerHTML = '<div class="muted">뉴스를 불러오는 중 오류가 발생했습니다.</div>';
  }
}

async function renderNews() {
  if (!appState.apiKey) {
    newsList.innerHTML = '<div>뉴스를 보려면 상단에서 Gemini API 키를 먼저 입력해주세요.</div>';
    return;
  }

  await loadWeeklyNewsIfNeeded();
  const items = appState.cachedViews.weeklyNews.items || [];
  newsList.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.textContent = '아직 생성된 뉴스가 없습니다. 5경기를 완료하면 첫 뉴스가 표시됩니다.';
    newsList.appendChild(empty);
    return;
  }

  items.forEach(item => {
    const li = document.createElement('div');
    const date = item.date || '';
    const tags = item.tags && item.tags.length ? ` [${item.tags.join(', ')}]` : '';
    li.innerHTML = `<strong>[${date}] ${item.title}</strong>${tags}<br>${item.summary || ''}`;
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
