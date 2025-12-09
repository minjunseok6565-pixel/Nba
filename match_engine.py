import pandas as pd
import numpy as np
import random
import re

# -----------------------------------------------------------------------------
# 1. 유틸리티 함수 (데이터 파싱)
# -----------------------------------------------------------------------------
def parse_height(ht_str):
  """6' 5" 같은 문자열을 인치(inch) 단위 정수로 변환"""
  try:
      match = re.match(r"(\d+)'\s*(\d+)", str(ht_str))
      if match:
          return int(match.group(1)) * 12 + int(match.group(2))
      return 78  # 기본값 (6'6")
  except:
      return 78

def parse_weight(wt_str):
  """205 lbs 같은 문자열을 정수로 변환"""
  try:
      return int(re.search(r'\d+', str(wt_str)).group())
  except:
      return 220  # 기본값


# -----------------------------------------------------------------------------
# 2. Player 클래스
# -----------------------------------------------------------------------------
class Player:
  def __init__(self, row_data):
      self.name = row_data['Name']
      self.pos = row_data['POS']
      self.team = row_data['Team']

      self.height = parse_height(row_data['HT'])
      self.weight = parse_weight(row_data['WT'])

      stats = row_data.fillna(70)
      self.stats = stats

      self.usage_factor = (stats['Offensive Consistency'] * 0.4 +
                           stats['Shot IQ'] * 0.3 +
                           stats['Ball Handle'] * 0.3)

      self.finish_rating = (stats['Layup'] * 0.4 +
                            stats['Driving Dunk'] * 0.3 +
                            stats['Close Shot'] * 0.3)
      self.mid_rating = stats['Mid-Range Shot']
      self.three_rating = stats['Three-Point Shot']
      self.ft_rating = stats['Free Throw']

      self.playmaking_rating = (stats['Pass Accuracy'] * 0.4 +
                                stats['Pass Vision'] * 0.4 +
                                stats['Pass IQ'] * 0.2)

      self.peri_def_rating = stats['Perimeter Defense']
      self.interior_def_rating = (stats['Interior Defense'] * 0.7 +
                                  stats['Strength'] * 0.3)
      self.steal_rating = (stats['Steal'] * 0.6 +
                           stats['Pass Perception'] * 0.4)
      self.block_rating = (stats['Block'] * 0.6 +
                           stats['Vertical'] * 0.2 +
                           self.height * 0.2)

      self.reb_rating = (stats['Rebounding'] * 0.5 +
                         self.height * 2.0 +
                         stats['Vertical'] * 0.1 +
                         stats['Strength'] * 0.1)

      self.stamina = stats['Stamina']
      self.fatigue = 0

      self.boxscore = {
          'PTS': 0, 'REB': 0, 'AST': 0, 'STL': 0, 'BLK': 0,
          'FGM': 0, 'FGA': 0, '3PM': 0, '3PA': 0, 'TOV': 0
      }

  def reset_stats(self):
      self.fatigue = 0
      self.boxscore = {k: 0 for k in self.boxscore}


# -----------------------------------------------------------------------------
# 3. Team 클래스
# -----------------------------------------------------------------------------
class Team:
  def __init__(self, team_name, roster_df, tactics=None):
      self.name = team_name
      self.players = [Player(row) for _, row in roster_df.iterrows()]

      self.tactics = tactics if tactics else {
          'pace': 0, 'focus': 'balanced', 'aggression': 0
      }

      # 피로도 계수 (1.0이 기본, 1보다 작으면 피곤, 크면 상쾌)
      try:
          self.fatigue_factor = float(self.tactics.get('fatigue_factor', 1.0))
      except Exception:
          self.fatigue_factor = 1.0

      self.players.sort(key=lambda x: x.stats['OVR'], reverse=True)
      self.active_roster = self.players[:10]

      self.update_team_ratings()


  def update_team_ratings(self):
      starters = self.players[:5]
      self.team_off_rating = np.mean([p.usage_factor for p in starters])
      self.team_def_rating = np.mean(
          [p.peri_def_rating + p.interior_def_rating for p in starters]
      ) / 2
      self.team_reb_rating = np.mean([p.reb_rating for p in starters])

  def get_rotation_players(self):
      return self.players[:5]


# -----------------------------------------------------------------------------
# 4. MatchEngine 클래스
# -----------------------------------------------------------------------------
class MatchEngine:
  def __init__(self, team_home, team_away):
      self.home = team_home
      self.away = team_away
      self.quarter = 1
      self.time_remaining = 12.0 * 60
      self.score = {self.home.name: 0, self.away.name: 0}
      self.log = []

  def simulate_game(self):
      self.home.players[0].reset_stats()
      self.away.players[0].reset_stats()

      for q in range(1, 5):
          self.quarter = q
          self.simulate_quarter()

      return self.generate_result()

  def simulate_quarter(self):
      base_possessions = 25
      pace_factor = (
          1.0 +
          (self.home.tactics.get('pace', 0) * 0.05) +
          (self.away.tactics.get('pace', 0) * 0.05)
      )
      total_possessions = int(base_possessions * pace_factor)

      for _ in range(total_possessions):
          self.play_possession(self.home, self.away)
          self.play_possession(self.away, self.home)

  def play_possession(self, offense_team, defense_team):
      off_players = offense_team.get_rotation_players()
      def_players = defense_team.get_rotation_players()

      weights = [p.usage_factor for p in off_players]
      shooter = random.choices(off_players, weights=weights, k=1)[0]

      shot_tendency = [0.4, 0.3, 0.3]

      if offense_team.tactics['focus'] == 'outside':
          shot_tendency = [0.2, 0.3, 0.5]
      elif offense_team.tactics['focus'] == 'inside':
          shot_tendency = [0.6, 0.3, 0.1]

      shot_type = random.choices(
          ['paint', 'mid', '3pt'],
          weights=shot_tendency,
          k=1
      )[0]

      defender = random.choice(def_players)

      success_prob = 0.0
      if shot_type == 'paint':
          success_prob = (
              shooter.finish_rating * 0.6 -
              (defender.interior_def_rating * 0.4 + defender.block_rating * 0.1)
          )
          success_prob += 40
      elif shot_type == 'mid':
          success_prob = (
              shooter.mid_rating * 0.7 -
              defender.peri_def_rating * 0.3
          )
          success_prob += 20
      elif shot_type == '3pt':
          success_prob = (
              shooter.three_rating * 0.8 -
              defender.peri_def_rating * 0.2
          )
          success_prob += 10

      # 🔹 피로도 보정
      off_fatigue = getattr(offense_team, "fatigue_factor", 1.0)
      def_fatigue = getattr(defense_team, "fatigue_factor", 1.0)

      # 공격팀 컨디션 (±8%), 수비팀 컨디션 (±4%) 반영
      success_prob += (off_fatigue - 1.0) * 8.0
      success_prob -= (def_fatigue - 1.0) * 4.0

      success_prob = max(10, min(90, success_prob))
      is_made = random.uniform(0, 100) < success_prob


      if is_made:
          points = 2 if shot_type != '3pt' else 3
          self.score[offense_team.name] += points

          shooter.boxscore['PTS'] += points
          shooter.boxscore['FGM'] += 1
          shooter.boxscore['FGA'] += 1
          if shot_type == '3pt':
              shooter.boxscore['3PM'] += 1
              shooter.boxscore['3PA'] += 1

          if random.random() < 0.6:
              passer = random.choices(
                  off_players,
                  weights=[p.playmaking_rating for p in off_players],
                  k=1
              )[0]
              if passer != shooter:
                  passer.boxscore['AST'] += 1

          self.log.append(
              f"{shooter.name} ({offense_team.name}) {shot_type} shot MADE."
          )

      else:
          shooter.boxscore['FGA'] += 1
          if shot_type == '3pt':
              shooter.boxscore['3PA'] += 1

          reb_weights = [p.reb_rating for p in def_players] + \
                        [p.reb_rating * 0.4 for p in off_players]
          all_players_reb = def_players + off_players

          rebounder = random.choices(
              all_players_reb,
              weights=reb_weights,
              k=1
          )[0]
          rebounder.boxscore['REB'] += 1

          self.log.append(
              f"{shooter.name} ({offense_team.name}) missed. "
              f"Rebound by {rebounder.name}."
          )

  def generate_result(self):
      def get_boxscore_data(team):
          data = []
          for p in team.players:
              bs = p.boxscore
              if bs['FGA'] > 0 or bs['REB'] > 0 or bs['AST'] > 0:
                  stats = dict(bs)
                  stats['Name'] = p.name
                  data.append(stats)
          return data

      return {
          "final_score": self.score,
          "winner": (
              self.home.name
              if self.score[self.home.name] > self.score[self.away.name]
              else self.away.name
          ),
          "boxscore": {
              self.home.name: get_boxscore_data(self.home),
              self.away.name: get_boxscore_data(self.away)
          },
          "logs": self.log[-10:]
      }
