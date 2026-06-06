export interface User {
  id: number;
  email: string;
  display_name: string;
  team_name: string;
  role: 'admin' | 'player';
  total_points: number;
  current_rank: number | null;
  can_manage_leagues: boolean;
  can_invite_users: boolean;
  can_manage_tournaments: boolean;
}

export interface League {
  id: number;
  name: string;
  invite_token: string;
  created_by: number;
  logo_url?: string | null;
  member_count?: number;
  my_rank?: number;
}

export interface Fixture {
  id: number;
  external_id: string | null;
  stage: 'group' | 'round_32' | 'round_16' | 'quarter_final' | 'semi_final' | 'third_place' | 'final';
  group_code: string | null;
  matchday: number | null;
  home_team: string;
  home_logo: string | null;
  away_team: string;
  away_logo: string | null;
  kickoff_time: string;
  home_score: number | null;
  away_score: number | null;
  home_score_aet: number | null;
  away_score_aet: number | null;
  knockout_winner: string | null;
  status: 'scheduled' | 'live' | 'completed' | 'postponed';
  venue: string | null;
}

export interface MatchPrediction {
  id: number;
  user_id: number;
  fixture_id: number;
  predicted_home: number;
  predicted_away: number;
  points_awarded: number;
  is_locked: boolean;
}

export interface HistoricalRankEntry {
  user_id: number;
  display_name: string;
  matchday_id: string;
  rank_at_time: number;
  points_at_time: number;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: number;
  display_name: string;
  team_name?: string | null;
  total_points: number;
  delta?: number;
}

export interface Tournament {
  id: number;
  name: string;
  is_active: boolean;
  has_bracket: boolean;
  created_at: string;
  api_league_id: number | null;
  api_season: number | null;
}

export interface StageCompletion {
  predicted: number;
  total: number;
}

export interface UserCompletion {
  user_id: number;
  display_name: string;
  email: string;
  group: StageCompletion;
  round_32: StageCompletion;
  round_16: StageCompletion;
  quarter_final: StageCompletion;
  semi_final: StageCompletion;
  third_place: StageCompletion;
  final: StageCompletion;
  group_bracket_picks: StageCompletion;
  ko_bracket_picks: StageCompletion;
}

export interface TournamentCompletionResponse {
  tournament_id: number;
  has_bracket: boolean;
  users: UserCompletion[];
}
