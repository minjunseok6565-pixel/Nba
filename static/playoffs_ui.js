// 신규 플레이오프 테스트 전용 UI 스크립트

const PLAYOFF_HOME_TEAM_ID = 'DEN'; // 랜덤 선정된 A팀 (하드코딩)
const PLAYOFF_AWAY_TEAM_ID = 'MIA'; // 랜덤 선정된 B팀 (하드코딩)

const tabButtons = document.querySelectorAll('.nav-tab');
const tabScreens = {
  home: document.getElementById('tab-home'),
  bracket: document.getElementById('tab-bracket'),
  stats: document.getElementById('tab-stats'),
  news: document.getElementById('tab-news'),
};

const homeTeamNameEl = document.getElementById('homeTeamName');
const awayTeamNameEl = document.getElementById('awayTeamName');
const seriesLabel = document.getElementById('seriesLabel');
const roundLabel = document.getElementById('roundLabel');
const matchSeriesStatus = document.getElementById('matchSeriesStatus');
const playoffLog = document.getElementById('playoffLog');
const bracketContainer = document.getElementById('bracketContainer');
const playoffStatsTable = document.getElementById('playoffStatsTable');
const playoffNewsList = document.getElementById('playoffNewsList');

const tacticsModal = document.getElementById('tacticsModal');
const tacticsClose = document.getElementById('tacticsClose');
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

let tacticsPlayers = [];

function getTeamName(teamId) {
  const entry = TEAMS.find(t => t.id === teamId);
  return entry ? entry.name : teamId;
}

function setTab(tabKey) {
  tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabKey));
  Object.entries(tabScreens).forEach(([key, el]) => {
    if (!el) return;
    el.classList.toggle('active', key === tabKey);
    el.style.display = key === tabKey ? 'block' : 'none';
  });
}

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => setTab(btn.dataset.tab));
});

function updateTeamLabels() {
  if (homeTeamNameEl) homeTeamNameEl.textContent = getTeamName(PLAYOFF_HOME_TEAM_ID);
  if (awayTeamNameEl) awayTeamNameEl.textContent = getTeamName(PLAYOFF_AWAY_TEAM_ID);
}

async function initializePostseason() {
  try {
    const res = await fetch('/api/postseason/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ my_team_id: PLAYOFF_HOME_TEAM_ID }),
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    await refreshPostseasonState();
  } catch (err) {
    console.error('플레이오프 초기화 오류', err);
    matchSeriesStatus.textContent = '플레이오프 세팅 중 오류가 발생했습니다.';
  }
}

function formatSeriesScore(series, myTeamId) {
  const wins = series.wins || {};
  const homeId = series.home_court;
  const roadId = series.road;
  const homeWins = wins[homeId] ?? 0;
  const roadWins = wins[roadId] ?? 0;
  const label = `${getTeamName(homeId)} ${homeWins} - ${roadWins} ${getTeamName(roadId)}`;
  const isMySeries = [homeId, roadId].includes(myTeamId);
  return isMySeries ? `${label} (내 시리즈)` : label;
}

function renderBracket(playoffs) {
  if (!bracketContainer) return;
  if (!playoffs || !playoffs.bracket) {
    bracketContainer.textContent = '플레이오프 브라켓을 불러올 수 없습니다.';
    return;
  }
  const { bracket, current_round: currentRound } = playoffs;
  bracketContainer.classList.remove('muted');
  bracketContainer.innerHTML = '';

  const rounds = [
    { key: 'quarterfinals', label: '1라운드' },
    { key: 'semifinals', label: '2라운드' },
    { key: 'finals', label: '컨퍼런스 파이널' },
  ];

  rounds.forEach(r => {
    const col = document.createElement('div');
    col.className = 'bracket-column';
    const title = document.createElement('h4');
    title.textContent = `${r.label}`;
    col.appendChild(title);

    ['east', 'west'].forEach(conf => {
      const seriesList = (bracket[conf] && bracket[conf][r.key]) || [];
      if (!Array.isArray(seriesList)) return;
      seriesList.forEach(series => {
        const card = document.createElement('div');
        card.className = 'bracket-card';
        card.innerHTML = `
          <div class="muted" style="font-size:0.75rem;">${conf.toUpperCase()}</div>
          <div>${formatSeriesScore(series, PLAYOFF_HOME_TEAM_ID)}</div>
          <div class="muted" style="font-size:0.8rem;">${series.round || ''}</div>
        `;
        col.appendChild(card);
      });
    });

    if (r.key === 'finals' && bracket.finals) {
      const fin = bracket.finals;
      const card = document.createElement('div');
      card.className = 'bracket-card finals-card';
      card.innerHTML = `
        <div class="muted" style="font-size:0.75rem;">FINALS</div>
        <div>${formatSeriesScore(fin, PLAYOFF_HOME_TEAM_ID)}</div>
        <div class="muted" style="font-size:0.8rem;">${fin.round || ''}</div>
      `;
      col.appendChild(card);
    }

    bracketContainer.appendChild(col);
  });

  roundLabel.textContent = currentRound || '-';
}

async function refreshPostseasonState() {
  try {
    const res = await fetch('/api/postseason/state');
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const playoffs = data.playoffs;
    renderBracket(playoffs);
    if (playoffs?.current_round) {
      roundLabel.textContent = playoffs.current_round;
    }
    const mySeries = findMySeries(playoffs, PLAYOFF_HOME_TEAM_ID);
    if (mySeries) {
      seriesLabel.textContent = `${getTeamName(mySeries.home_court)} vs ${getTeamName(mySeries.road)}`;
      matchSeriesStatus.textContent = formatSeriesScore(mySeries, PLAYOFF_HOME_TEAM_ID);
    } else {
      seriesLabel.textContent = '-';
      matchSeriesStatus.textContent = '아직 시리즈가 결정되지 않았습니다.';
    }
  } catch (err) {
    console.error('포스트시즌 상태 로드 실패', err);
    matchSeriesStatus.textContent = '포스트시즌 상태를 불러오는 데 실패했습니다.';
  }
}

function findMySeries(playoffs, teamId) {
  if (!playoffs) return null;
  const round = playoffs.current_round;
  const bracket = playoffs.bracket || {};
  const candidates = [];
  if (round === 'Conference Quarterfinals') {
    candidates.push(...(bracket.east?.quarterfinals || []), ...(bracket.west?.quarterfinals || []));
  } else if (round === 'Conference Semifinals') {
    candidates.push(...(bracket.east?.semifinals || []), ...(bracket.west?.semifinals || []));
  } else if (round === 'Conference Finals') {
    if (bracket.east?.finals) candidates.push(bracket.east.finals);
    if (bracket.west?.finals) candidates.push(bracket.west.finals);
  } else if (round === 'NBA Finals' && bracket.finals) {
    candidates.push(bracket.finals);
  }
  return candidates.find(s => [s.home_court, s.road].includes(teamId)) || null;
}

async function playMySeriesGame() {
  const btn = document.getElementById('btnPlayoffGame');
  if (btn) btn.disabled = true;
  matchSeriesStatus.textContent = '플레이오프 경기를 진행 중입니다...';
  try {
    const res = await fetch('/api/postseason/playoffs/advance-my-team-game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    appendPlayoffLog(data);
    await refreshPostseasonState();
  } catch (err) {
    console.error('경기 진행 실패', err);
    matchSeriesStatus.textContent = '경기 진행에 실패했습니다.';
  } finally {
    if (btn) btn.disabled = false;
  }
}

function appendPlayoffLog(data) {
  if (!playoffLog) return;
  const playoffs = data.playoffs || data;
  const mySeries = findMySeries(playoffs, PLAYOFF_HOME_TEAM_ID);
  const log = document.createElement('div');
  if (mySeries?.games?.length) {
    const lastGame = mySeries.games[mySeries.games.length - 1];
    const homeName = getTeamName(lastGame.home_team_id);
    const awayName = getTeamName(lastGame.away_team_id);
    log.textContent = `${lastGame.date}: ${homeName} ${lastGame.home_score} - ${lastGame.away_score} ${awayName}`;
  } else {
    log.textContent = '시리즈 결과가 업데이트되었습니다.';
  }
  playoffLog.prepend(log);
}

async function loadPlayoffStats() {
  try {
    const res = await fetch('/api/stats/playoffs/leaders');
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const leaders = data.leaders || {};
    playoffStatsTable.innerHTML = '';
    Object.entries(leaders).forEach(([stat, rows]) => {
      const header = document.createElement('tr');
      header.innerHTML = `<th colspan="3">${stat}</th>`;
      playoffStatsTable.appendChild(header);
      rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.player}</td><td>${r.team}</td><td>${r.value}</td>`;
        playoffStatsTable.appendChild(tr);
      });
    });
  } catch (err) {
    console.error('플레이오프 스탯 로드 실패', err);
    playoffStatsTable.innerHTML = '<tr><td>스탯을 불러올 수 없습니다.</td></tr>';
  }
}

async function loadPlayoffNews() {
  try {
    const res = await fetch('/api/news/playoffs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const items = data.items || [];
    playoffNewsList.innerHTML = '';
    if (!items.length) {
      playoffNewsList.innerHTML = '<div class="muted">표시할 뉴스가 없습니다.</div>';
      return;
    }
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'news-card';
      div.innerHTML = `<div class="news-headline">${item.headline || '무제'}</div><div class="news-body">${item.summary || ''}</div>`;
      playoffNewsList.appendChild(div);
    });
  } catch (err) {
    console.error('플레이오프 뉴스 로드 실패', err);
    playoffNewsList.innerHTML = '<div class="muted">뉴스를 불러오지 못했습니다.</div>';
  }
}

function renderTacticsPanel() {
  const team = TEAMS.find(t => t.id === PLAYOFF_HOME_TEAM_ID);
  if (!team) return;
  const tactics = getOrCreateTacticsForTeam(team.id);
  if (tacticsTeamLabel) tacticsTeamLabel.textContent = `${team.name} (${team.id})`;
  if (tacticsPaceInput && tacticsPaceLabel) {
    tacticsPaceInput.value = tactics.pace ?? 0;
    updatePaceLabel(tactics.pace ?? 0);
  }
  if (tacticsOffenseSelect) tacticsOffenseSelect.value = tactics.offenseScheme || 'pace_space';
  if (tacticsOffenseSecondarySelect) tacticsOffenseSecondarySelect.value = tactics.offenseSecondaryScheme || 'none';
  if (tacticsDefenseSelect) tacticsDefenseSelect.value = tactics.defenseScheme || 'drop_coverage';
  if (tacticsDefenseSecondarySelect) tacticsDefenseSecondarySelect.value = tactics.defenseSecondaryScheme || 'none';
  updateOffenseShareLabel(tactics);
  updateDefenseShareLabel(tactics);
  if (tacticsRotationSelect) tacticsRotationSelect.value = String(tactics.rotationSize || 9);
  renderTacticsLineup(tactics);
}

function updatePaceLabel(v) {
  const text = v === 0 ? '보통' : v > 0 ? `+${v}` : `${v}`;
  if (tacticsPaceLabel) tacticsPaceLabel.textContent = `${v} (${text})`;
}

function updateOffenseShareLabel(tactics) {
  if (!tacticsOffenseShareInput || !tacticsOffenseShareLabel) return;
  const secondary = Number(tactics.offenseSecondaryWeight ?? 5);
  const primary = 10 - secondary;
  tactics.offensePrimaryWeight = primary;
  tactics.offenseSecondaryWeight = secondary;
  tacticsOffenseShareInput.value = String(secondary);
  tacticsOffenseShareLabel.textContent = `메인 ${primary} : 보조 ${secondary}`;
}

function updateDefenseShareLabel(tactics) {
  if (!tacticsDefenseShareInput || !tacticsDefenseShareLabel) return;
  const secondary = Number(tactics.defenseSecondaryWeight ?? 5);
  const primary = 10 - secondary;
  tactics.defensePrimaryWeight = primary;
  tactics.defenseSecondaryWeight = secondary;
  tacticsDefenseShareInput.value = String(secondary);
  tacticsDefenseShareLabel.textContent = `메인 ${primary} : 보조 ${secondary}`;
}

function normalizeLineup(tactics) {
  const starterSet = new Set(tactics.starters || []);
  const benchSet = new Set(tactics.bench || []);
  tacticsPlayers.forEach(p => {
    if (starterSet.size < 5 && !starterSet.has(p.player_id)) {
      starterSet.add(p.player_id);
    } else if (!starterSet.has(p.player_id)) {
      benchSet.add(p.player_id);
    }
  });
  tactics.starters = Array.from(starterSet).slice(0, 5);
  tactics.bench = Array.from(benchSet);
}

function renderTacticsLineup(tactics) {
  if (!tacticsStartersContainer || !tacticsBenchContainer || !tacticsRosterList) return;
  normalizeLineup(tactics);
  const starterSet = new Set(tactics.starters || []);
  const benchSet = new Set(tactics.bench || []);
  tacticsStartersContainer.innerHTML = '';
  tacticsBenchContainer.innerHTML = '';

  const startersList = tacticsPlayers.filter(p => starterSet.has(p.player_id));
  const benchList = tacticsPlayers.filter(p => benchSet.has(p.player_id));

  const makeTag = player => {
    const div = document.createElement('div');
    div.className = 'tactics-player-tag';
    div.textContent = `${player.name} (${player.pos})`;
    return div;
  };
  startersList.forEach(p => tacticsStartersContainer.appendChild(makeTag(p)));
  benchList.forEach(p => tacticsBenchContainer.appendChild(makeTag(p)));

  tacticsRosterList.innerHTML = '';
  tacticsPlayers.forEach(player => {
    const row = document.createElement('div');
    row.className = 'tactics-roster-row';
    const info = document.createElement('div');
    info.className = 'tactics-roster-info';
    info.textContent = `${player.name} (${player.pos}) · OVR ${player.overall}`;
    const actions = document.createElement('div');
    actions.className = 'tactics-roster-actions';
    const btnStarter = document.createElement('button');
    btnStarter.className = 'tactics-role-button';
    btnStarter.textContent = '스타터';
    btnStarter.onclick = () => {
      const set = new Set(tactics.starters || []);
      set.add(player.player_id);
      tactics.starters = Array.from(set).slice(0, 5);
      tactics.bench = tactics.bench.filter(id => id !== player.player_id);
      renderTacticsLineup(tactics);
    };
    const btnBench = document.createElement('button');
    btnBench.className = 'tactics-role-button';
    btnBench.textContent = '벤치';
    btnBench.onclick = () => {
      const set = new Set(tactics.bench || []);
      set.add(player.player_id);
      tactics.bench = Array.from(set);
      tactics.starters = tactics.starters.filter(id => id !== player.player_id);
      renderTacticsLineup(tactics);
    };
    actions.appendChild(btnStarter);
    actions.appendChild(btnBench);
    row.appendChild(info);
    row.appendChild(actions);
    tacticsRosterList.appendChild(row);
  });

  if (tacticsLineupSummary) {
    tacticsLineupSummary.textContent = `스타터 ${tactics.starters.length}명 / 벤치 ${tactics.bench.length}명`;
  }
}

async function loadTacticsRoster() {
  try {
    const res = await fetch(`/api/roster-summary/${PLAYOFF_HOME_TEAM_ID}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    tacticsPlayers = data.players || [];
    renderTacticsPanel();
  } catch (err) {
    console.error('로스터 로드 실패', err);
    tacticsPlayers = [];
    if (tacticsRosterList) tacticsRosterList.innerHTML = '<div class="muted">로스터를 불러오지 못했습니다.</div>';
  }
}

function wireTacticInputs() {
  const team = TEAMS.find(t => t.id === PLAYOFF_HOME_TEAM_ID);
  if (!team) return;
  tacticsPaceInput?.addEventListener('input', () => {
    const tactics = getOrCreateTacticsForTeam(team.id);
    tactics.pace = Number(tacticsPaceInput.value || 0);
    updatePaceLabel(tactics.pace);
  });
  tacticsOffenseSelect?.addEventListener('change', () => {
    const tactics = getOrCreateTacticsForTeam(team.id);
    tactics.offenseScheme = tacticsOffenseSelect.value;
  });
  tacticsOffenseSecondarySelect?.addEventListener('change', () => {
    const tactics = getOrCreateTacticsForTeam(team.id);
    tactics.offenseSecondaryScheme = tacticsOffenseSecondarySelect.value;
    if (tactics.offenseSecondaryScheme === 'none') {
      tactics.offenseSecondaryWeight = 0;
    }
    updateOffenseShareLabel(tactics);
  });
  tacticsOffenseShareInput?.addEventListener('input', () => {
    const tactics = getOrCreateTacticsForTeam(team.id);
    const val = Math.max(0, Math.min(5, Number(tacticsOffenseShareInput.value)));
    tactics.offenseSecondaryWeight = val;
    updateOffenseShareLabel(tactics);
  });
  tacticsDefenseSelect?.addEventListener('change', () => {
    const tactics = getOrCreateTacticsForTeam(team.id);
    tactics.defenseScheme = tacticsDefenseSelect.value;
  });
  tacticsDefenseSecondarySelect?.addEventListener('change', () => {
    const tactics = getOrCreateTacticsForTeam(team.id);
    tactics.defenseSecondaryScheme = tacticsDefenseSecondarySelect.value;
    if (tactics.defenseSecondaryScheme === 'none') {
      tactics.defenseSecondaryWeight = 0;
    }
    updateDefenseShareLabel(tactics);
  });
  tacticsDefenseShareInput?.addEventListener('input', () => {
    const tactics = getOrCreateTacticsForTeam(team.id);
    const val = Math.max(0, Math.min(5, Number(tacticsDefenseShareInput.value)));
    tactics.defenseSecondaryWeight = val;
    updateDefenseShareLabel(tactics);
  });
  tacticsRotationSelect?.addEventListener('change', () => {
    const tactics = getOrCreateTacticsForTeam(team.id);
    tactics.rotationSize = Number(tacticsRotationSelect.value || 9);
    renderTacticsLineup(tactics);
  });
}

document.getElementById('btnOpenTactics')?.addEventListener('click', () => {
  tacticsModal?.classList.add('active');
  renderTacticsPanel();
});

tacticsClose?.addEventListener('click', () => tacticsModal?.classList.remove('active'));

document.getElementById('btnPlayoffGame')?.addEventListener('click', playMySeriesGame);

// 초기 실행
setTab('home');
updateTeamLabels();
wireTacticInputs();
loadTacticsRoster();
initializePostseason().then(() => {
  loadPlayoffStats();
  loadPlayoffNews();
});
