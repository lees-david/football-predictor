import React, { useState, useEffect, useRef } from 'react';
import { useMyBracket, useSubmitBracket, useClearBracket, useActualBracketResults } from '../api/hooks/useBracket';
import { useFixtures } from '../api/hooks/useFixtures';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SkeletonCard } from '../components/ui/Skeleton';
import { Trash2, Trophy, ChevronDown, ChevronUp, Save, Medal, Users, GitBranch, Lock } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { useTournamentContext } from '../api/TournamentContext';
import { useSearchParams } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Team name aliases — mirrors backend _TEAM_NAME_ALIASES in football_data.py
// Maps seed/Wikipedia names ↔ football-data.org API names bidirectionally
// so that logos resolve regardless of which name variant is stored in the DB.
// ---------------------------------------------------------------------------
const TEAM_NAME_ALIASES: Record<string, string> = {
  // seed/Wikipedia → API canonical (football-data.org uses hyphen for Bosnia)
  'czech republic':          'czechia',
  'bosnia and herzegovina':  'bosnia-herzegovina',
  'cape verde':              'cape verde islands',
  'dr congo':                'congo dr',
  'democratic republic of congo': 'congo dr',
  'republic of ireland':     'ireland',
  'north macedonia':         'macedonia',
  // API canonical → seed/Wikipedia (reverse direction)
  'czechia':                 'czech republic',
  'bosnia-herzegovina':      'bosnia and herzegovina',
  'bosnia & herzegovina':    'bosnia and herzegovina',  // extra variant just in case
  'cape verde islands':      'cape verde',
  'congo dr':                'dr congo',
};

// ---------------------------------------------------------------------------
// Fallback group data
// ---------------------------------------------------------------------------
const fallbackGroups: Record<string, string[]> = {
  A: ['Canada', 'Honduras', 'Cameroon', 'Sweden'],
  B: ['USA', 'Costa Rica', 'Ghana', 'Ukraine'],
  C: ['Mexico', 'Jamaica', 'Nigeria', 'Poland'],
  D: ['France', 'Australia', 'Denmark', 'Tunisia'],
  E: ['England', 'Iran', 'Belgium', 'Wales'],
  F: ['Argentina', 'Saudi Arabia', 'Ecuador', 'Croatia'],
  G: ['Spain', 'Germany', 'Japan', 'Senegal'],
  H: ['Brazil', 'Serbia', 'Switzerland', 'Portugal'],
  I: ['Netherlands', 'Uruguay', 'South Korea', 'Qatar'],
  J: ['Morocco', 'Colombia', 'Chile', 'Peru'],
  K: ['Ivory Coast', 'Algeria', 'Egypt', 'Tunisia'],
  L: ['Japan', 'Australia', 'Saudi Arabia', 'China'],
};

// ---------------------------------------------------------------------------
// Bracket seeding
// ---------------------------------------------------------------------------

// R32 seeding for the 8 "certain" winner-vs-runner-up (or runner-up-vs-runner-up) matches.
// These correspond to the ODD-numbered R32 slots (1,3,5,7,9,11,13,15).
// Groups whose winners face a 3rd-place team (A,B,D,E,G,I,K,L) are absent here.
// R32 certain (non-3rd-place) seeding matchups (Match 73 to 88) mapped by slot name.
const R32_CERTAIN_SEEDING: Record<string, [string, number, string, number]> = {
  'R32-1':  ['A', 2, 'B', 2],  // Match 73: Runner-up A vs Runner-up B
  'R32-2':  ['C', 1, 'F', 2],  // Match 74: Winner C vs Runner-up F
  'R32-4':  ['F', 1, 'C', 2],  // Match 76: Winner F vs Runner-up C
  'R32-5':  ['E', 2, 'I', 2],  // Match 77: Runner-up E vs Runner-up I
  'R32-11': ['H', 1, 'J', 2],  // Match 83: Winner H vs Runner-up J
  'R32-12': ['K', 2, 'L', 2],  // Match 84: Runner-up K vs Runner-up L
  'R32-14': ['D', 2, 'G', 2],  // Match 86: Runner-up D vs Runner-up G
  'R32-15': ['J', 1, 'H', 2],  // Match 87: Winner J vs Runner-up H
};

// R32 slots where a group winner faces a 3rd-place team.
// eligibleGroups: the pool of groups from which FIFA will assign the 3rd-place team.
const R32_THIRD_PLACE_SLOTS: { slot: string; winnerGroup: string; eligibleGroups: string[] }[] = [
  { slot: 'R32-3',  winnerGroup: 'E', eligibleGroups: ['A','B','C','D','F'] },  // Match 75
  { slot: 'R32-6',  winnerGroup: 'I', eligibleGroups: ['C','D','F','G','H'] },  // Match 78
  { slot: 'R32-7',  winnerGroup: 'A', eligibleGroups: ['C','E','F','H','I'] },  // Match 79
  { slot: 'R32-8',  winnerGroup: 'L', eligibleGroups: ['E','H','I','J','K'] },  // Match 80
  { slot: 'R32-9',  winnerGroup: 'G', eligibleGroups: ['A','E','H','I','J'] },  // Match 81
  { slot: 'R32-10', winnerGroup: 'D', eligibleGroups: ['B','E','F','I','J'] },  // Match 82
  { slot: 'R32-13', winnerGroup: 'B', eligibleGroups: ['E','F','G','I','J'] },  // Match 85
  { slot: 'R32-16', winnerGroup: 'K', eligibleGroups: ['D','E','I','J','L'] },  // Match 88
];

// KO bracket: each slot's two feeder slots
const MATCH_FEED: Record<string, [string, string]> = {
  // R16 feeds from R32 (based on official FIFA World Cup 2026 bracket paths)
  'R16-1': ['R32-1',  'R32-3'],
  'R16-2': ['R32-2',  'R32-5'],
  'R16-3': ['R32-4',  'R32-6'],
  'R16-4': ['R32-7',  'R32-8'],
  'R16-5': ['R32-11', 'R32-12'],
  'R16-6': ['R32-9',  'R32-10'],
  'R16-7': ['R32-14', 'R32-16'],
  'R16-8': ['R32-13', 'R32-15'],
  // QF feeds from R16
  'QF-1': ['R16-1', 'R16-2'], 'QF-2': ['R16-3', 'R16-4'],
  'QF-3': ['R16-5', 'R16-6'], 'QF-4': ['R16-7', 'R16-8'],
  // SF feeds from QF
  'SF-1': ['QF-1', 'QF-2'], 'SF-2': ['QF-3', 'QF-4'],
  // Final and 3rd place from SF
  'FINAL':   ['SF-1', 'SF-2'],
  '3RD':     ['SF-1', 'SF-2'],  // losers
};

const slotToRound = (slot: string): string => {
  if (slot.startsWith('R32-'))  return 'round_32';
  if (slot.startsWith('R16-'))  return 'round_16';
  if (slot.startsWith('QF-'))   return 'quarter_final';
  if (slot.startsWith('SF-'))   return 'semi_final';
  if (slot === '3RD')           return 'third_place';
  if (slot === 'FINAL')         return 'final';
  if (slot === 'CHAMP')         return 'champion';
  return '';
};


// ---------------------------------------------------------------------------
// Logo resolution — module-level so all components can use it
// ---------------------------------------------------------------------------
const resolveLogo = (logos: Record<string, string>, team: string | null | undefined): string | undefined => {
  if (!team) return undefined;
  if (logos[team]) return logos[team];
  const lower = team.toLowerCase();
  const key = Object.keys(logos).find(k => k.toLowerCase() === lower);
  return key ? logos[key] : undefined;
};

// ---------------------------------------------------------------------------
// MatchCard
// ---------------------------------------------------------------------------
interface MatchCardProps {
  slot: string;
  teamA: string | null;
  teamB: string | null;
  winner: string | null;
  logos: Record<string, string>;
  onPick: (team: string) => void;
  locked: boolean;
  compact?: boolean;
  correctPick?: boolean;
}

const MatchCard: React.FC<MatchCardProps> = ({ slot, teamA, teamB, winner, logos: cardLogos, onPick, locked, compact = false, correctPick = false }) => {
  const w = compact ? 'w-28' : 'w-36';

  const renderTeam = (team: string | null, isWinner: boolean) => {
    const isLoser = winner !== null && !isWinner;
    return (
      <button
        onClick={() => !locked && team && onPick(team)}
        disabled={locked || !team}
        className={`
          w-full flex items-center gap-1 px-1.5 py-1 rounded transition-all text-left
          ${isWinner && correctPick
            ? 'bg-green-500/25 border border-green-500/50 text-green-300 font-bold'
            : isWinner
            ? 'bg-amber-500/25 border border-amber-500/50 text-amber-300 font-bold'
            : isLoser
            ? 'opacity-30 text-textMuted'
            : team
            ? 'hover:bg-white/10 text-textMain border border-transparent'
            : 'text-white/20 border border-transparent cursor-default'
          }
          ${locked ? 'cursor-default' : team ? 'cursor-pointer' : ''}
        `}
      >
        {resolveLogo(cardLogos, team) ? (
          <img src={resolveLogo(cardLogos, team)} alt="" className="w-4 h-3 object-cover rounded-sm border border-white/10 shrink-0"
            onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
        ) : (
          <span className="w-4 text-[9px] shrink-0 text-center">{team ? '🏳️' : '?'}</span>
        )}
        <span className={`${compact ? 'text-[10px]' : 'text-xs'} truncate`}>{team ?? '—'}</span>
        {isWinner && <span className={`ml-auto text-[9px] ${correctPick ? 'text-green-400' : 'text-amber-400'}`}>▶</span>}
      </button>
    );
  };

  return (
    <div className={`
      rounded-lg border bg-slate-900/60 backdrop-blur-sm p-1 ${w} shrink-0
      ${winner && correctPick ? 'border-green-500/30' : winner ? 'border-amber-500/30' : 'border-white/10'}
    `}>
      <div className="text-[8px] text-white/20 font-mono uppercase mb-0.5 px-1">{slot}</div>
      {renderTeam(teamA, winner === teamA)}
      <div className="my-0.5 border-t border-white/5" />
      {renderTeam(teamB, winner === teamB)}
    </div>
  );
};

// ---------------------------------------------------------------------------
// ChampionCard / ThirdPlaceCard
// ---------------------------------------------------------------------------
const ChampionCard: React.FC<{ team: string | null; logo: string | undefined; correct?: boolean }> = ({ team, logo, correct = false }) => (
  <div className={`flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl border backdrop-blur-sm min-w-[100px] ${
    correct
      ? 'border-green-500/40 bg-green-500/10 shadow-[0_0_20px_rgba(34,197,94,0.15)]'
      : 'border-amber-500/40 bg-amber-500/10 shadow-[0_0_20px_rgba(245,158,11,0.15)]'
  }`}>
    <Trophy size={16} className={correct ? 'text-green-400' : 'text-amber-400'} />
    <div className={`text-[9px] uppercase font-bold tracking-wider ${correct ? 'text-green-400/70' : 'text-amber-400/70'}`}>Champion</div>
    {logo && <img src={logo} alt="" className={`w-8 h-5 object-cover rounded border ${correct ? 'border-green-500/30' : 'border-amber-500/30'}`} onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />}
    <div className={`text-xs font-bold text-center truncate max-w-[90px] ${correct ? 'text-green-300' : 'text-amber-300'}`}>{team ?? '?'}</div>
  </div>
);

const ThirdPlaceCard: React.FC<{ team: string | null; logo: string | undefined; correct?: boolean }> = ({ team, logo, correct = false }) => (
  <div className={`flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg border min-w-[90px] ${
    correct ? 'border-green-700/30 bg-green-700/10' : 'border-amber-700/30 bg-amber-700/10'
  }`}>
    <Medal size={13} className={correct ? 'text-green-500' : 'text-amber-600'} />
    <div className={`text-[8px] uppercase font-bold tracking-wider ${correct ? 'text-green-500/70' : 'text-amber-600/70'}`}>3rd Place</div>
    {logo && <img src={logo} alt="" className="w-6 h-4 object-cover rounded" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />}
    <div className={`text-[10px] font-bold text-center truncate max-w-[80px] ${correct ? 'text-green-400' : 'text-amber-600'}`}>{team ?? '?'}</div>
  </div>
);

// Inline selector shown beneath a "group winner vs 3rd place" R32 match card
// to let the user pick which 3rd-place team fills that slot.
interface ThirdPlaceSelectorProps {
  slot: string;
  eligibleGroups: string[];
  groupPicks: Record<string, string[]>;
  logos: Record<string, string>;
  selected: string | null;
  alreadyUsed: string[];
  onSelect: (team: string) => void;
  locked: boolean;
}
const ThirdPlaceSelector: React.FC<ThirdPlaceSelectorProps> = ({
  eligibleGroups, groupPicks, logos: selectorLogos, selected, alreadyUsed, onSelect, locked,
}) => {
  const eligible = eligibleGroups
    .map(g => groupPicks[g]?.[2])   // index 2 = predicted 3rd-place finisher
    .filter((t): t is string => !!t && (t === selected || !alreadyUsed.includes(t)));

  if (eligible.length === 0) return (
    <div className="mt-0.5 px-1 text-[8px] text-white/20 text-center">Save group picks first</div>
  );

  if (locked) return null;

  return (
    <div className="mt-1">
      <div className="text-[8px] text-white/30 px-1 mb-0.5">3rd place from:</div>
      <div className="flex flex-wrap gap-0.5 px-0.5">
        {eligible.map(team => (
          <button
            key={team}
            onClick={() => onSelect(team)}
            className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] transition-all border ${
              selected === team
                ? 'bg-sky-500/30 border-sky-400/60 text-sky-300 font-bold'
                : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80'
            }`}
          >
            {resolveLogo(selectorLogos, team) && (
              <img src={resolveLogo(selectorLogos, team)} alt="" className="w-3 h-2 object-cover rounded-sm"
                onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
            )}
            {team}
          </button>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// KoScoreTable
// ---------------------------------------------------------------------------
interface KoStageDetail {
  stage: string;
  label: string;
  completed: boolean;
  predicted_teams: string[];
  actual_teams: string[];
  matched_teams: string[];
  points: number;
  pts_per_team: number | null;
  total_slots: number;
}

const KoScoreTable: React.FC<{ details: KoStageDetail[]; logos: Record<string, string> }> = ({ details, logos: tableLogos }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const completedDetails = details.filter(d => d.completed);
  if (completedDetails.length === 0) return null;

  return (
    <div className="glass-card rounded-2xl border border-white/5 overflow-hidden">
      <div className="flex items-center gap-3 p-4 bg-white/5 border-b border-white/5">
        <Trophy size={18} className="text-amber-400" />
        <h2 className="text-lg font-bold text-white">KO Stage Results</h2>
        <span className="text-xs text-textMuted">prediction vs actual</span>
      </div>
      <div className="divide-y divide-white/5">
        {completedDetails.map(d => {
          const isOpen = expanded === d.stage;
          const matchedSet = new Set(d.matched_teams);
          const missedPredictions = d.predicted_teams.filter(t => !matchedSet.has(t));
          const actualNotPredicted = d.actual_teams.filter(t => !matchedSet.has(t));

          return (
            <div key={d.stage}>
              <button
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors text-left"
                onClick={() => setExpanded(isOpen ? null : d.stage)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm font-semibold text-white w-32 shrink-0">{d.label}</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      d.matched_teams.length === d.total_slots
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : d.matched_teams.length > 0
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-white/5 text-textMuted border border-white/10'
                    }`}>
                      {d.matched_teams.length}/{d.total_slots} correct
                    </span>
                    {d.pts_per_team && (
                      <span className="text-[10px] text-textMuted">× {d.pts_per_team} pts each</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-sm font-bold ${d.points > 0 ? 'text-amber-400' : 'text-textMuted'}`}>
                    {d.points > 0 ? `+${d.points}` : '0'} pts
                  </span>
                  {isOpen ? <ChevronUp size={14} className="text-textMuted" /> : <ChevronDown size={14} className="text-textMuted" />}
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Correct picks */}
                  <div>
                    <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-2">
                      ✓ Correct ({d.matched_teams.length})
                    </div>
                    {d.matched_teams.length === 0
                      ? <p className="text-xs text-textMuted italic">None</p>
                      : d.matched_teams.map(t => (
                        <div key={t} className="flex items-center gap-1.5 py-0.5">
                          {resolveLogo(tableLogos, t) && <img src={resolveLogo(tableLogos, t)} alt="" className="w-4 h-3 object-cover rounded-sm" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />}
                          <span className="text-xs text-emerald-300">{t}</span>
                        </div>
                      ))
                    }
                  </div>

                  {/* Missed picks */}
                  <div>
                    <div className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-2">
                      ✗ Predicted but not correct ({missedPredictions.length})
                    </div>
                    {missedPredictions.length === 0
                      ? <p className="text-xs text-textMuted italic">None</p>
                      : missedPredictions.map(t => (
                        <div key={t} className="flex items-center gap-1.5 py-0.5">
                          {resolveLogo(tableLogos, t) && <img src={resolveLogo(tableLogos, t)} alt="" className="w-4 h-3 object-cover rounded-sm" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />}
                          <span className="text-xs text-red-300/70">{t}</span>
                        </div>
                      ))
                    }
                  </div>

                  {/* Actual teams you didn't predict */}
                  <div>
                    <div className="text-[10px] font-bold text-textMuted uppercase tracking-wider mb-2">
                      Actual not predicted ({actualNotPredicted.length})
                    </div>
                    {actualNotPredicted.length === 0
                      ? <p className="text-xs text-textMuted italic">None</p>
                      : actualNotPredicted.map(t => (
                        <div key={t} className="flex items-center gap-1.5 py-0.5">
                          {resolveLogo(tableLogos, t) && <img src={resolveLogo(tableLogos, t)} alt="" className="w-4 h-3 object-cover rounded-sm" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />}
                          <span className="text-xs text-textMuted">{t}</span>
                        </div>
                      ))
                    }
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// BracketBuilder
// ---------------------------------------------------------------------------
export const BracketBuilder: React.FC = () => {
  const { selectedTournamentId } = useTournamentContext();
  const { data: bracket, isLoading: isLoadingBracket, isError: isBracketError } = useMyBracket(selectedTournamentId);
  const { data: fixtures, isLoading: isLoadingFixtures } = useFixtures(selectedTournamentId);
  const { data: actualResults } = useActualBracketResults(selectedTournamentId);
  const submitBracket = useSubmitBracket(selectedTournamentId);
  const clearBracket = useClearBracket(selectedTournamentId);

  const [bracketView, setBracketView] = useState<'my-picks' | 'actual'>('my-picks');
  const [groupView, setGroupView] = useState<'my-picks' | 'actual'>('my-picks');
  const [groupPicks, setGroupPicks] = useState<Record<string, string[]>>({});
  const [koPicks, setKoPicks] = useState<Record<string, string>>({});
  const [koWizardRound, setKoWizardRound] = useState<'3rd_place' | 'round_32' | 'round_16' | 'quarter_final' | 'semi_final' | 'finals'>('3rd_place');

  const WIZARD_ROUNDS = [
    { key: '3rd_place', label: '3rd Place Seeds' },
    { key: 'round_32', label: 'Round of 32' },
    { key: 'round_16', label: 'Round of 16' },
    { key: 'quarter_final', label: 'Quarter-Finals' },
    { key: 'semi_final', label: 'Semi-Finals' },
    { key: 'finals', label: 'Finals' },
  ] as const;

  useEffect(() => {
    if (bracketView === 'actual' && koWizardRound === '3rd_place') {
      setKoWizardRound('round_32');
    }
  }, [bracketView, koWizardRound]);
  // Maps R32 slot (e.g. 'R32-2') → the 3rd-place team the user thinks fills that slot.
  // Persisted as KO picks with slot suffix '-3P' (round_32).
  const [thirdPlaceSelections, setThirdPlaceSelections] = useState<Record<string, string>>({});
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'ko' ? 'ko' : 'groups';

  const [showClearModal, setShowClearModal] = useState(false);
  const [clearType, setClearType] = useState<'all' | 'group' | 'knockout'>('all');
  const [clearSuccessMsg, setClearSuccessMsg] = useState<string | null>(null);
  const [clearErrorMsg, setClearErrorMsg] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [savingGroups, setSavingGroups] = useState(false);
  const [savingKo, setSavingKo] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs so the auto-save timer callback always uses the latest payload builders,
  // avoiding stale-closure bugs when groupPicks changes between effect run and timer fire.
  const buildGroupPayloadRef = useRef<() => any[]>(() => []);
  const buildKoPayloadRef = useRef<() => any[]>(() => []);

  useEffect(() => { setHasLoaded(false); }, [selectedTournamentId]);

  // When the bracket is deleted (e.g. admin reset), useMyBracket resolves to null. Clear local
  // state and re-arm `hasLoaded` so the load effect re-enters edit mode with default picks.
  useEffect(() => {
    if (isLoadingBracket) return;
    if (bracket && !isBracketError) return;
    setGroupPicks({});
    setKoPicks({});
    setThirdPlaceSelections({});
    setHasLoaded(false);
  }, [bracket, isBracketError, isLoadingBracket]);

  // Derive groups, logos, and sorted R32 fixtures from fixture data
  const { groups: fixtureGroups, logos } = React.useMemo(() => {
    const grps: Record<string, string[]> = {};
    const lgos: Record<string, string> = {};
    if (fixtures) {
      fixtures.forEach(f => {
        if (f.home_logo) lgos[f.home_team] = f.home_logo;
        if (f.away_logo) lgos[f.away_team] = f.away_logo;

        if (f.stage === 'group' && f.group_code) {
          const g = f.group_code.toUpperCase();
          if (!grps[g]) grps[g] = [];
          if (!grps[g].includes(f.home_team)) grps[g].push(f.home_team);
          if (!grps[g].includes(f.away_team)) grps[g].push(f.away_team);
        }
      });
      Object.keys(grps).forEach(g => grps[g].sort());

      // Expand aliases bidirectionally: also index each logo under its alias
      // name (all lowercase) so resolveLogo() can find it regardless of the
      // casing stored in bracket picks vs the DB canonical name.
      Object.entries({ ...lgos }).forEach(([name, url]) => {
        const alias = TEAM_NAME_ALIASES[name.toLowerCase()];
        if (alias) {
          // Store under the lowercase alias — resolveLogo does case-insensitive lookup
          if (!lgos[alias]) lgos[alias] = url;
        }
      });
    }
    return { groups: grps, logos: lgos };
  }, [fixtures]);

  // resolveLogo is defined at module level; used as resolveLogo(logos, team)

  const activeGroups = Object.keys(fixtureGroups).length > 0 ? fixtureGroups : fallbackGroups;

  // Compute actual group standings from completed fixture results
  interface TeamStanding { p: number; w: number; d: number; l: number; gf: number; ga: number; }
  const actualGroupStandings = React.useMemo(() => {
    const standings: Record<string, Record<string, TeamStanding>> = {};
    if (!fixtures) return standings;
    fixtures.forEach(f => {
      if (f.stage !== 'group' || f.status !== 'completed' || f.home_score == null || f.away_score == null || !f.group_code) return;
      const g = f.group_code.toUpperCase();
      if (!standings[g]) standings[g] = {};
      const init = (): TeamStanding => ({ p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
      if (!standings[g][f.home_team]) standings[g][f.home_team] = init();
      if (!standings[g][f.away_team]) standings[g][f.away_team] = init();
      const hs = f.home_score, as_ = f.away_score;
      standings[g][f.home_team].p++;
      standings[g][f.away_team].p++;
      standings[g][f.home_team].gf += hs; standings[g][f.home_team].ga += as_;
      standings[g][f.away_team].gf += as_; standings[g][f.away_team].ga += hs;
      if (hs > as_) { standings[g][f.home_team].w++; standings[g][f.away_team].l++; }
      else if (hs < as_) { standings[g][f.away_team].w++; standings[g][f.home_team].l++; }
      else { standings[g][f.home_team].d++; standings[g][f.away_team].d++; }
    });
    // Sort each group: pts desc, then GD desc, then GF desc
    Object.keys(standings).forEach(g => {
      standings[g] = Object.fromEntries(
        Object.entries(standings[g]).sort(([, a], [, b]) => {
          const ptsDiff = (b.w * 3 + b.d) - (a.w * 3 + a.d);
          if (ptsDiff !== 0) return ptsDiff;
          const gdDiff = (b.gf - b.ga) - (a.gf - a.ga);
          if (gdDiff !== 0) return gdDiff;
          return b.gf - a.gf;
        })
      );
    });
    return standings;
  }, [fixtures]);

  const fmtDate = (ms: number | null) =>
    ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';

  const { firstGroupKickoffMs, firstKoKickoffMs } = React.useMemo(() => {
    if (!fixtures) return { firstGroupKickoffMs: null, firstKoKickoffMs: null };
    const groupTimes = fixtures.filter(f => f.stage === 'group' && f.kickoff_time).map(f => new Date(f.kickoff_time).getTime());
    const koTimes = fixtures.filter(f => f.stage !== 'group' && f.kickoff_time).map(f => new Date(f.kickoff_time).getTime());
    return {
      firstGroupKickoffMs: groupTimes.length ? Math.min(...groupTimes) : null,
      firstKoKickoffMs: koTimes.length ? Math.min(...koTimes) : null,
    };
  }, [fixtures]);

  // Bracket is read-only once the first group fixture kicks off OR any group fixture
  // has been completed (e.g. via simulation), whichever comes first.
  const tournamentStarted = React.useMemo(() => {
    if (!fixtures) return false;
    const groupFixtures = fixtures.filter(f => f.stage === 'group');
    if (groupFixtures.some(f => f.status === 'completed')) return true;
    const kickoffs = groupFixtures
      .filter(f => f.kickoff_time)
      .map(f => new Date(f.kickoff_time).getTime());
    if (kickoffs.length === 0) return false;
    return Date.now() >= Math.min(...kickoffs);
  }, [fixtures]);

  // Load saved bracket
  useEffect(() => {
    if (isLoadingBracket) return;
    const defaultPicks: Record<string, string[]> = {};
    Object.entries(activeGroups).forEach(([g, teams]) => { defaultPicks[g] = [...teams]; });

    if (isBracketError || !bracket?.group_picks || bracket.group_picks.length === 0) {
      if (!hasLoaded) {
        setGroupPicks(defaultPicks);
        setIsEditing(true);
        setHasLoaded(true);
      }
    } else {
      const loaded: Record<string, string[]> = {};
      bracket.group_picks.forEach((p: any) => {
        const gc = p.group_code.toUpperCase();
        if (!loaded[gc]) loaded[gc] = [];
        loaded[gc][p.position - 1] = p.predicted_team;
      });
      Object.entries(activeGroups).forEach(([g, teams]) => {
        if (!loaded[g] || loaded[g].length === 0) loaded[g] = [...teams];
      });
      if (!hasLoaded) {
        setGroupPicks(loaded);
        const hasKoPicks = bracket?.ko_picks && bracket.ko_picks.length > 0;
        setIsEditing(!hasKoPicks);
        setHasLoaded(true);
      }
    }

    const ko: Record<string, string> = {};
    const tps: Record<string, string> = {};
    (isBracketError ? [] : bracket?.ko_picks ?? []).forEach((p: any) => {
      if (p.slot.endsWith('-3P')) {
        tps[p.slot.replace('-3P', '')] = p.predicted_team;
      } else {
        ko[p.slot] = p.predicted_team;
      }
    });
    setKoPicks(ko);
    setThirdPlaceSelections(tps);
  }, [bracket, hasLoaded, isLoadingBracket, isBracketError]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── KO pick derivation ────────────────────────────────────────────────
  const getR32Teams = (slotIdx: number): [string | null, string | null] => {
    const slotName = `R32-${slotIdx + 1}`;
    const tpConfig = R32_THIRD_PLACE_SLOTS.find(s => s.slot === slotName);
    if (tpConfig) {
      const winner = groupPicks[tpConfig.winnerGroup]?.[0] ?? null;
      const thirdPlace = thirdPlaceSelections[slotName] ?? null;
      return [winner, thirdPlace];
    }
    const certainSeed = R32_CERTAIN_SEEDING[slotName];
    if (certainSeed) {
      const [g1, p1, g2, p2] = certainSeed;
      return [groupPicks[g1]?.[p1 - 1] ?? null, groupPicks[g2]?.[p2 - 1] ?? null];
    }
    return [null, null];
  };

  const getMatchTeams = (slot: string): [string | null, string | null] => {
    if (slot.startsWith('R32-')) {
      const idx = parseInt(slot.replace('R32-', '')) - 1;
      return getR32Teams(idx);
    }
    if (slot === '3RD') {
      return [getSlotLoser('SF-1'), getSlotLoser('SF-2')];
    }
    const [slotA, slotB] = MATCH_FEED[slot] ?? [];
    if (!slotA) return [null, null];
    return [getSlotWinner(slotA), getSlotWinner(slotB)];
  };

  const getSlotWinner = (slot: string): string | null => {
    const w = koPicks[slot];
    if (!w) return null;
    const [t1, t2] = getMatchTeams(slot);
    return (w === t1 || w === t2) ? w : null;
  };

  const getSlotLoser = (slot: string): string | null => {
    const winner = getSlotWinner(slot);
    if (!winner) return null;
    const [t1, t2] = getMatchTeams(slot);
    return winner === t1 ? t2 : t1;
  };

  // ── Actual bracket helpers ─────────────────────────────────────────────
  const getActualMatchTeams = (slot: string): [string | null, string | null] => {
    const r = actualResults?.slots[slot];
    return [r?.team_a ?? null, r?.team_b ?? null];
  };
  const getActualSlotWinner = (slot: string): string | null => {
    const s = actualResults?.slots[slot];
    if (!s || s.status !== 'completed' || !s.winner) return null;
    // Guard against orphaned knockout_winner values set on fixtures whose teams are still placeholders
    if (s.team_a && s.team_b && s.winner !== s.team_a && s.winner !== s.team_b) return null;
    return s.winner;
  };

  const renderActualMatchCard = (slot: string, compact = false) => {
    const [teamA, teamB] = getActualMatchTeams(slot);
    const winner = getActualSlotWinner(slot);
    return (
      <MatchCard
        key={slot}
        slot={slot}
        teamA={teamA}
        teamB={teamB}
        winner={winner}
        logos={logos}
        onPick={() => {}}
        locked={true}
        compact={compact}
      />
    );
  };

  const getActualChampion = () => getActualSlotWinner('FINAL');
  const getActualThirdPlace = () => getActualSlotWinner('3RD');

  const pickWinner = (slot: string, team: string) => {
    if (!isEditing || bracket?.is_locked) return;
    setKoPicks(prev => ({ ...prev, [slot]: team }));
  };

  const moveTeam = (group: string, fromIdx: number, toIdx: number) => {
    if (bracket?.is_locked || !isEditing) return;
    setGroupPicks(prev => {
      const arr = [...prev[group]];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return { ...prev, [group]: arr };
    });
  };

  // ── Save handlers ──────────────────────────────────────────────────────
  const notify = (type: 'success' | 'error', text: string) => {
    setSaveMsg({ type, text });
    setTimeout(() => setSaveMsg(null), type === 'error' ? 6000 : 4000);
  };

  const buildGroupPayload = () => {
    const payload: any[] = [];
    Object.entries(groupPicks).forEach(([code, teams]) => {
      teams.forEach((team, idx) => {
        payload.push({ group_code: code, position: idx + 1, predicted_team: team });
      });
    });
    return payload;
  };
  buildGroupPayloadRef.current = buildGroupPayload;

  const extractErrorMsg = (err: any): string => {
    return err?.response?.data?.detail ?? err?.message ?? 'Unknown error';
  };

  const handleSaveGroups = async () => {
    setSavingGroups(true);
    try {
      await submitBracket.mutateAsync({ group_picks: buildGroupPayload(), ko_picks: buildKoPayload() });
      notify('success', 'Group standings saved');
    } catch (err) {
      notify('error', `Failed to save group standings: ${extractErrorMsg(err)}`);
    } finally {
      setSavingGroups(false);
    }
  };

  const handleSaveKo = async () => {
    setSavingKo(true);
    try {
      await submitBracket.mutateAsync({ group_picks: buildGroupPayload(), ko_picks: buildKoPayload() });
      notify('success', 'Knockout picks saved ✓');
      setIsEditing(false);
    } catch (err) {
      notify('error', `Failed to save knockout picks: ${extractErrorMsg(err)}`);
    } finally {
      setSavingKo(false);
    }
  };

  const buildKoPayload = () => {
    const picks = Object.entries(koPicks)
      .filter(([slot, team]) => {
        const [t1, t2] = getMatchTeams(slot);
        return team && (team === t1 || team === t2);
      })
      .map(([slot, team]) => ({ round: slotToRound(slot), slot, predicted_team: team }));

    // Persist 3rd-place team selections as KO picks with '-3P' suffix
    const tpPicks = Object.entries(thirdPlaceSelections)
      .filter(([, team]) => !!team)
      .map(([slot, team]) => ({ round: 'round_32', slot: `${slot}-3P`, predicted_team: team }));

    return [...picks, ...tpPicks];
  };
  buildKoPayloadRef.current = buildKoPayload;

  // Auto-save KO picks 1.5 s after the last change while editing
  useEffect(() => {
    if (!isEditing || tournamentStarted || bracket?.is_locked) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      try {
        await submitBracket.mutateAsync({ group_picks: buildGroupPayloadRef.current(), ko_picks: buildKoPayloadRef.current() });
      } catch { /* silent — user can still save manually */ }
    }, 1500);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [koPicks, thirdPlaceSelections]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCancelEdit = () => {
    if (bracket?.group_picks) {
      const loaded: Record<string, string[]> = {};
      bracket.group_picks.forEach((p: any) => {
        const gc = p.group_code.toUpperCase();
        if (!loaded[gc]) loaded[gc] = [];
        loaded[gc][p.position - 1] = p.predicted_team;
      });
      Object.entries(activeGroups).forEach(([g, teams]) => {
        if (!loaded[g] || loaded[g].length === 0) loaded[g] = [...teams];
      });
      setGroupPicks(loaded);
    }
    const ko: Record<string, string> = {};
    const tps: Record<string, string> = {};
    (bracket?.ko_picks ?? []).forEach((p: any) => {
      if (p.slot.endsWith('-3P')) {
        tps[p.slot.replace('-3P', '')] = p.predicted_team;
      } else {
        ko[p.slot] = p.predicted_team;
      }
    });
    setKoPicks(ko);
    setThirdPlaceSelections(tps);
    setIsEditing(false);
  };

  const handleClearBracket = async () => {
    setClearErrorMsg(null);
    // Cancel any pending auto-save so it doesn't re-submit the cleared data
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    try {
      await clearBracket.mutateAsync({ type: clearType });
      setHasLoaded(false);
      if (clearType === 'all' || clearType === 'knockout' || clearType === 'group') { setKoPicks({}); setThirdPlaceSelections({}); }
      if (clearType === 'all' || clearType === 'group') {
        const defaultPicks: Record<string, string[]> = {};
        Object.entries(activeGroups).forEach(([g, teams]) => { defaultPicks[g] = [...teams]; });
        setGroupPicks(defaultPicks);
      }
      setClearSuccessMsg('Cleared successfully!');
      setTimeout(() => { setClearSuccessMsg(null); setShowClearModal(false); }, 1500);
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? err?.message ?? 'Failed to clear bracket';
      setClearErrorMsg(msg);
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────────
  const renderMatchCard = (slot: string, compact = false, showThirdPlaceSelector = true) => {
    const [teamA, teamB] = getMatchTeams(slot);
    const winner = slot === '3RD' ? getSlotWinner('3RD') : getSlotWinner(slot);
    const tpConfig = slot.startsWith('R32-') ? R32_THIRD_PLACE_SLOTS.find(s => s.slot === slot) : undefined;
    const locked = tournamentStarted || !isEditing || !!bracket?.is_locked;
    const actualWinner = actualResults?.slots[slot]?.winner ?? null;
    const correctPick = !!winner && !!actualWinner && winner === actualWinner;
    return (
      <div key={slot} className="flex flex-col">
        <MatchCard
          slot={slot}
          teamA={teamA}
          teamB={teamB}
          winner={winner}
          logos={logos}
          onPick={(team) => pickWinner(slot, team)}
          locked={locked}
          compact={compact}
          correctPick={correctPick}
        />
        {showThirdPlaceSelector && tpConfig && (
          <ThirdPlaceSelector
            slot={slot}
            eligibleGroups={tpConfig.eligibleGroups}
            groupPicks={groupPicks}
            logos={logos}
            selected={thirdPlaceSelections[slot] ?? null}
            alreadyUsed={Object.entries(thirdPlaceSelections)
              .filter(([s]) => s !== slot)
              .map(([, t]) => t)}
            onSelect={(team) => setThirdPlaceSelections(prev => {
              const next: Record<string, string> = {};
              Object.entries(prev).forEach(([s, t]) => { if (t !== team) next[s] = t; });
              next[slot] = team;
              return next;
            })}
            locked={locked}
          />
        )}
      </div>
    );
  };


  const champion = getSlotWinner('FINAL');
  const thirdPlace = getSlotWinner('3RD');

  const ALL_KO_SLOTS = [
    ...Array.from({ length: 16 }, (_, i) => `R32-${i + 1}`),
    ...Array.from({ length: 8 },  (_, i) => `R16-${i + 1}`),
    'QF-1','QF-2','QF-3','QF-4',
    'SF-1','SF-2',
    'FINAL','3RD',
  ];
  const koPickCount = ALL_KO_SLOTS.filter(s => !!getSlotWinner(s)).length
    + Object.keys(thirdPlaceSelections).filter(k => !!thirdPlaceSelections[k]).length;

  if (isLoadingBracket || isLoadingFixtures) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <SkeletonCard key={i} rows={4} />)}
        </div>
      </div>
    );
  }

  const hasGroupPicks = bracket?.group_picks && bracket.group_picks.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-1">
            {activeTab === 'groups' ? 'Group Stage Picks' : 'Knockout Bracket'}
          </h1>
          <p className="text-textMuted text-sm">
            {activeTab === 'groups'
              ? 'Predict the final standings for each group.'
              : 'Click-to-advance teams through the knockout rounds.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(tournamentStarted || bracket?.is_locked) ? (
            <span className="bg-red-500/10 text-red-400 border border-red-500/20 px-3 py-1.5 rounded-xl text-xs font-bold">
              🔒 {tournamentStarted ? 'Tournament started — picks locked' : 'Bracket Locked'}
            </span>
          ) : (
            <>
              {isEditing ? (
                <>
                  {hasGroupPicks && (
                    <Button variant="secondary" size="sm" onClick={handleCancelEdit}>Cancel</Button>
                  )}
                </>
              ) : (
                <Button size="sm" onClick={() => setIsEditing(true)} className="animate-pulse">Edit Picks</Button>
              )}
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setClearType(activeTab === 'ko' ? 'knockout' : 'all');
                  setClearErrorMsg(null);
                  setClearSuccessMsg(null);
                  setShowClearModal(true);
                }}
                className="flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/30 rounded-xl"
              >
                <Trash2 size={14} /> Clear Bracket
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex bg-black/40 p-1 rounded-xl w-fit gap-1">
        <button
          onClick={() => setSearchParams({})}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            activeTab === 'groups' ? 'bg-primary text-black' : 'text-textMuted hover:text-white'
          }`}
        >
          <Users size={15} /> Groups
        </button>
        <button
          onClick={() => setSearchParams({ tab: 'ko' })}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            activeTab === 'ko' ? 'bg-primary text-black' : 'text-textMuted hover:text-white'
          }`}
        >
          <GitBranch size={15} /> Knockout
          {!hasGroupPicks && <Lock size={12} className="opacity-60" />}
        </button>
      </div>

      {/* Notification */}
      {saveMsg && (
        <div className={`px-4 py-2.5 rounded-lg text-sm font-medium ${saveMsg.type === 'success' ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'}`}>
          {saveMsg.text}
        </div>
      )}

      {/* Clear modal */}
      <Modal isOpen={showClearModal} onClose={() => setShowClearModal(false)} title="Clear Bracket Picks">
        <div className="space-y-4">
          <p className="text-sm text-textMuted">
            Select which part of your bracket to clear. Only open prediction stages can be cleared.
          </p>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-textMuted uppercase tracking-wider block">Picks to Clear</label>
            <select
              value={clearType}
              onChange={(e) => setClearType(e.target.value as any)}
              className="w-full px-3 py-2 bg-black/60 border border-white/10 rounded-xl text-white outline-none focus:border-amber-500 transition-all text-sm"
            >
              <option value="all">All Picks (Groups & Knockout)</option>
              <option value="group">Group Standings (+ Knockout Picks)</option>
              <option value="knockout">Knockout Picks Only</option>
            </select>
          </div>
          {clearSuccessMsg && <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs text-center font-semibold animate-pulse">{clearSuccessMsg}</div>}
          {clearErrorMsg && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs text-center font-semibold">{clearErrorMsg}</div>}
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" size="sm" onClick={() => setShowClearModal(false)}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={handleClearBracket} isLoading={clearBracket.isPending} disabled={clearBracket.isPending || !!clearSuccessMsg} className="flex items-center gap-1.5">
              <Trash2 size={13} /> Clear Picks
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Group Stage Tab ─── */}
      {activeTab === 'groups' && (
        <div className="glass-card rounded-2xl border border-white/5 overflow-hidden">
          <div className="flex items-center justify-between p-4 bg-white/5 border-b border-white/5">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-white">Group Stage Picks</h2>
                <Badge variant={bracket?.group_picks?.length === Object.keys(activeGroups).length * 4 ? 'success' : 'warning'}>
                  {bracket?.group_picks?.length === Object.keys(activeGroups).length * 4 ? 'Teams & Matches Confirmed' : 'Teams & Matches Confirmed - Predictions Needed'}
                </Badge>
              </div>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4 text-[10px] text-textMuted font-semibold uppercase tracking-wider mt-1.5">
                {tournamentStarted ? (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-500/15 text-red-400 font-bold tracking-widest text-[9px]">
                      CLOSED
                    </span>
                    <span className="text-textMuted normal-case tracking-normal">Tournament started — picks locked</span>
                  </span>
                ) : (
                  <>
                    <span className="flex items-center gap-1">
                      <span className="text-emerald-400">🔓 Opens:</span> Concluded &amp; Confirmed
                    </span>
                    <span className="hidden sm:inline text-white/10">•</span>
                    <span className="flex items-center gap-1">
                      <span className="text-amber-500">🔒 Closes:</span> {fmtDate(firstGroupKickoffMs)}
                    </span>
                  </>
                )}
              </div>
            </div>
            {isEditing && !bracket?.is_locked && !tournamentStarted && (
              <div className="flex items-center gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setClearType('group');
                    setClearErrorMsg(null);
                    setClearSuccessMsg(null);
                    setShowClearModal(true);
                  }}
                  className="flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs px-3 py-1.5 rounded-xl font-bold"
                >
                  <Trash2 size={12} /> Clear Group Picks
                </Button>
                <Button size="sm" onClick={handleSaveGroups} isLoading={savingGroups} className="flex items-center gap-1.5 text-xs">
                  <Save size={12} /> Save Groups
                </Button>
              </div>
            )}
          </div>

          <div className="p-4 space-y-4">
            {/* View toggle — only shown after tournament starts */}
            {tournamentStarted && (
              <div className="flex justify-center">
                <div className="flex bg-black/40 p-1 rounded-xl gap-1">
                  <button
                    onClick={() => setGroupView('my-picks')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      groupView === 'my-picks' ? 'bg-primary text-black' : 'text-textMuted hover:text-white'
                    }`}
                  >
                    My Picks
                  </button>
                  <button
                    onClick={() => setGroupView('actual')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      groupView === 'actual' ? 'bg-sky-500 text-white' : 'text-textMuted hover:text-white'
                    }`}
                  >
                    Actual Groups
                  </button>
                </div>
              </div>
            )}

            {/* ─── Actual Groups standings ─── */}
            {groupView === 'actual' && tournamentStarted && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {Object.entries(activeGroups).sort(([a], [b]) => a.localeCompare(b)).map(([group, allTeams]) => {
                  const standings = actualGroupStandings[group] ?? {};
                  // Teams with results first (sorted), then remaining teams alphabetically
                  const rankedTeams = Object.keys(standings);
                  const unplayed = allTeams.filter(t => !standings[t]).sort();
                  const rows = [...rankedTeams, ...unplayed];
                  return (
                    <Card key={group} title={`Group ${group}`} className="p-4 bg-[#161B22]/60 border border-white/5 shadow-xl">
                      <div className="w-full">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-textMuted uppercase tracking-wider border-b border-white/10">
                              <th className="text-left pb-2 font-semibold w-full">Team</th>
                              <th className="text-center pb-2 font-semibold px-1.5 w-6">P</th>
                              <th className="text-center pb-2 font-semibold px-1.5 w-6">W</th>
                              <th className="text-center pb-2 font-semibold px-1.5 w-6">D</th>
                              <th className="text-center pb-2 font-semibold px-1.5 w-6">L</th>
                              <th className="text-center pb-2 font-semibold px-1.5 w-6">GF</th>
                              <th className="text-center pb-2 font-semibold px-1.5 w-6">GA</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((team, idx) => {
                              const s = standings[team];
                              return (
                                <tr key={team} className={`border-b border-white/5 last:border-0 ${idx < 2 ? 'text-white' : 'text-textMuted'}`}>
                                  <td className="py-2 flex items-center gap-2">
                                    <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0 ${idx < 2 ? 'bg-success/20 text-success' : 'bg-white/5 text-textMuted'}`}>{idx + 1}</span>
                                    {resolveLogo(logos, team) ? (
                                      <img src={resolveLogo(logos, team)} alt="" className="w-6 h-4 object-cover rounded shadow-sm border border-white/10 shrink-0" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
                                    ) : <span className="text-sm shrink-0">🏳️</span>}
                                    <span className="font-medium truncate max-w-[130px]">{team}</span>
                                  </td>
                                  <td className="text-center py-2 tabular-nums px-1.5">{s?.p ?? 0}</td>
                                  <td className="text-center py-2 tabular-nums px-1.5">{s?.w ?? 0}</td>
                                  <td className="text-center py-2 tabular-nums px-1.5">{s?.d ?? 0}</td>
                                  <td className="text-center py-2 tabular-nums px-1.5">{s?.l ?? 0}</td>
                                  <td className="text-center py-2 tabular-nums px-1.5">{s?.gf ?? 0}</td>
                                  <td className="text-center py-2 tabular-nums px-1.5">{s?.ga ?? 0}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* ─── My Picks grid ─── */}
            {(!tournamentStarted || groupView === 'my-picks') && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
              {Object.entries(groupPicks).sort(([a], [b]) => a.localeCompare(b)).map(([group, teams]) => {
                const groupPts = bracket?.points_breakdown?.groups?.[group];
                return (
                <Card key={group} title={`Group ${group}`} className="p-4 bg-[#161B22]/60 border border-white/5 shadow-xl"
                  headerExtra={groupPts != null ? (
                    <div className="relative group/pts">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 tabular-nums cursor-default">+{groupPts} pts</span>
                      <div className="pointer-events-none absolute right-0 top-full mt-1.5 z-50 w-52 rounded-lg bg-[#1C2128] border border-white/10 shadow-xl p-2.5 text-[11px] text-white/70 leading-relaxed opacity-0 group-hover/pts:opacity-100 transition-opacity duration-150">
                        <p className="font-semibold text-amber-400 mb-1.5">How points are awarded</p>
                        <div className="space-y-1">
                          <div className="flex items-start gap-1.5"><span className="text-amber-400 font-bold shrink-0">5 pts</span><span>exact finish position</span></div>
                          <div className="flex items-start gap-1.5"><span className="text-amber-400 font-bold shrink-0">2 pts</span><span>predicted to qualify (top 2) but wrong order</span></div>
                          <div className="flex items-start gap-1.5"><span className="text-white/30 font-bold shrink-0">0 pts</span><span>all other picks</span></div>
                          <div className="border-t border-white/10 pt-1 mt-1 flex items-start gap-1.5"><span className="text-amber-400 font-bold shrink-0">+10</span><span>bonus for perfect sweep (all 4 exact)</span></div>
                        </div>
                      </div>
                    </div>
                  ) : undefined}
                >
                  <div className="space-y-2">
                    {teams.map((team, idx) => (
                      <div key={team} className={`flex items-center justify-between p-2.5 rounded-lg bg-black/40 border border-white/5 transition-all hover:border-primary/20 ${bracket?.is_locked || !isEditing ? 'opacity-85 select-none' : ''}`}>
                        <div className="flex items-center gap-2">
                          <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${idx < 2 ? 'bg-success/20 text-success' : 'bg-white/5 text-textMuted'}`}>{idx + 1}</span>
                          {resolveLogo(logos, team) ? (
                            <img src={resolveLogo(logos, team)} alt="" className="w-6 h-4 object-cover rounded shadow-sm border border-white/10" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
                          ) : <span className="text-sm">🏳️</span>}
                          <span className="font-medium text-white text-sm truncate max-w-[130px]">{team}</span>
                        </div>
                        {!bracket?.is_locked && isEditing && (
                          <div className="flex flex-col gap-0.5">
                            <button type="button" onPointerDown={(e) => { e.preventDefault(); if (idx > 0) moveTeam(group, idx, idx - 1); }} disabled={idx === 0} className="text-textMuted hover:text-primary transition-colors disabled:opacity-20 text-xs">▲</button>
                            <button type="button" onPointerDown={(e) => { e.preventDefault(); if (idx < 3) moveTeam(group, idx, idx + 1); }} disabled={idx === 3} className="text-textMuted hover:text-primary transition-colors disabled:opacity-20 text-xs">▼</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
                );
              })}
            </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Knockout Tab ─── */}
      {activeTab === 'ko' && (
        !hasGroupPicks ? (
          <div className="glass-card rounded-2xl border border-white/5 p-12 flex flex-col items-center justify-center gap-4 text-center">
            <Lock size={40} className="text-textMuted opacity-40" />
            <h3 className="text-lg font-bold text-white">Complete Group Picks First</h3>
            <p className="text-textMuted text-sm max-w-sm">
              Save your Group Stage picks before building the Knockout Bracket — the R32 seeding depends on your group standings.
            </p>
            <button
              onClick={() => setSearchParams({})}
              className="mt-2 px-4 py-2 bg-primary text-black rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Go to Groups
            </button>
          </div>
        ) : (
          <div className="glass-card rounded-2xl border border-white/5 overflow-hidden">
            <div className="flex items-center justify-between p-4 bg-white/5 border-b border-white/5">
              <div>
                <div className="flex items-center gap-3">
                  <Trophy size={18} className="text-amber-400" />
                  <h2 className="text-lg font-bold text-white">Knockout Bracket</h2>
                  <Badge variant={koPickCount === 40 ? 'success' : 'warning'}>
                    {koPickCount === 40 ? 'Teams & Matches Confirmed' : 'Teams & Matches Confirmed - Predictions Needed'}
                  </Badge>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-bold border tabular-nums ${koPickCount === 40 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-textMuted border-white/10'}`}>
                    {koPickCount}/40
                  </span>
                  {champion && <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold">🏆 {champion}</span>}
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4 text-[10px] text-textMuted font-semibold uppercase tracking-wider mt-1.5">
                  {tournamentStarted ? (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-500/15 text-red-400 font-bold tracking-widest text-[9px]">
                        CLOSED
                      </span>
                      <span className="text-textMuted normal-case tracking-normal">Tournament started — picks locked</span>
                    </span>
                  ) : (
                    <>
                      <span className="flex items-center gap-1">
                        <span className="text-emerald-400">🔓 Opens:</span> Once group picks are saved
                      </span>
                      <span className="hidden sm:inline text-white/10">•</span>
                      <span className="flex items-center gap-1">
                        <span className="text-amber-500">🔒 Closes:</span> {fmtDate(firstKoKickoffMs ?? firstGroupKickoffMs)}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {isEditing && !bracket?.is_locked && !tournamentStarted && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      setClearType('knockout');
                      setClearErrorMsg(null);
                      setClearSuccessMsg(null);
                      setShowClearModal(true);
                    }}
                    className="flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs px-3 py-1.5 rounded-xl font-bold"
                  >
                    <Trash2 size={12} /> Clear Knockout Picks
                  </Button>
                  <Button size="sm" onClick={handleSaveKo} isLoading={savingKo} className="flex items-center gap-1.5 text-xs">
                    <Save size={12} /> Save Knockout Picks
                  </Button>
                </div>
              )}
            </div>

            <div className="p-4 space-y-3">
              {/* View toggle — only shown after tournament starts */}
              {tournamentStarted && (
                <div className="flex justify-center">
                  <div className="flex bg-black/40 p-1 rounded-xl gap-1">
                    <button
                      onClick={() => setBracketView('my-picks')}
                      className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        bracketView === 'my-picks' ? 'bg-primary text-black' : 'text-textMuted hover:text-white'
                      }`}
                    >
                      My Picks
                    </button>
                    <button
                      onClick={() => setBracketView('actual')}
                      className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        bracketView === 'actual' ? 'bg-sky-500 text-white' : 'text-textMuted hover:text-white'
                      }`}
                    >
                      Actual
                    </button>
                  </div>
                </div>
              )}

              {isEditing && !bracket?.is_locked && !tournamentStarted && (
                <p className="text-xs text-amber-400/60 text-center">Click a team to advance them. Odd R32 slots seed from your group picks. Even R32 slots pair a group winner vs a 3rd-place team — use the outer "3rd pick" columns to assign which 3rd-place team fills each slot, then pick the winner.</p>
              )}

              {/* Mobile Round-by-Round Wizard */}
              <div className="space-y-6">
                {/* Round Selector Tabs */}
                <div className="flex overflow-x-auto bg-black/40 p-1 rounded-xl gap-1 no-scrollbar select-none">
                  {WIZARD_ROUNDS
                    .filter(r => bracketView === 'my-picks' || r.key !== '3rd_place')
                    .map(r => (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => setKoWizardRound(r.key as any)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex-1 ${
                          koWizardRound === r.key ? 'bg-amber-500 text-black shadow-md' : 'text-textMuted hover:text-white'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                </div>

                {/* Wizard Round Content */}
                {bracketView === 'my-picks' && koWizardRound === '3rd_place' && (
                  <div className="space-y-4">
                    <p className="text-xs text-amber-400/60 text-center">
                      Select which 3rd-place team fills each knockout slot.
                    </p>
                    <div className="grid grid-cols-1 gap-3">
                      {R32_THIRD_PLACE_SLOTS.map(tp => {
                        const winner = groupPicks[tp.winnerGroup]?.[0] ?? 'Winner Group ' + tp.winnerGroup;
                        const selectedTeam = thirdPlaceSelections[tp.slot] ?? null;
                        const locked = tournamentStarted || !isEditing || !!bracket?.is_locked;
                        return (
                          <div key={tp.slot} className="bg-slate-900/40 border border-white/5 rounded-xl p-3 space-y-2">
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-mono text-amber-500 font-bold">{tp.slot}</span>
                              <span className="text-textMuted">vs {winner}</span>
                            </div>
                            <ThirdPlaceSelector
                              slot={tp.slot}
                              eligibleGroups={tp.eligibleGroups}
                              groupPicks={groupPicks}
                              logos={logos}
                              selected={selectedTeam}
                              alreadyUsed={Object.entries(thirdPlaceSelections)
                                .filter(([s]) => s !== tp.slot)
                                .map(([, t]) => t)}
                              onSelect={(team) => setThirdPlaceSelections(prev => {
                                const next: Record<string, string> = {};
                                Object.entries(prev).forEach(([s, t]) => { if (t !== team) next[s] = t; });
                                next[tp.slot] = team;
                                return next;
                              })}
                              locked={locked}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* R32 Round */}
                {koWizardRound === 'round_32' && (
                  <div className="grid grid-cols-1 gap-3">
                    {Array.from({ length: 16 }, (_, i) => `R32-${i + 1}`).map(slot => (
                      <div key={slot} className="flex justify-center">
                        {bracketView === 'my-picks' ? renderMatchCard(slot, false, true) : renderActualMatchCard(slot, false)}
                      </div>
                    ))}
                  </div>
                )}

                {/* R16 Round */}
                {koWizardRound === 'round_16' && (
                  <div className="grid grid-cols-1 gap-3">
                    {Array.from({ length: 8 }, (_, i) => `R16-${i + 1}`).map(slot => (
                      <div key={slot} className="flex justify-center">
                        {bracketView === 'my-picks' ? renderMatchCard(slot, false, false) : renderActualMatchCard(slot, false)}
                      </div>
                    ))}
                  </div>
                )}

                {/* QF Round */}
                {koWizardRound === 'quarter_final' && (
                  <div className="grid grid-cols-1 gap-3">
                    {['QF-1', 'QF-2', 'QF-3', 'QF-4'].map(slot => (
                      <div key={slot} className="flex justify-center">
                        {bracketView === 'my-picks' ? renderMatchCard(slot, false, false) : renderActualMatchCard(slot, false)}
                      </div>
                    ))}
                  </div>
                )}

                {/* SF Round */}
                {koWizardRound === 'semi_final' && (
                  <div className="grid grid-cols-1 gap-3">
                    {['SF-1', 'SF-2'].map(slot => (
                      <div key={slot} className="flex justify-center">
                        {bracketView === 'my-picks' ? renderMatchCard(slot, false, false) : renderActualMatchCard(slot, false)}
                      </div>
                    ))}
                  </div>
                )}

                {/* Finals Round */}
                {koWizardRound === 'finals' && (
                  <div className="flex flex-col items-center gap-6">
                    <div className="w-full max-w-sm space-y-4">
                      <div className="text-center text-xs font-bold uppercase tracking-wider text-textMuted">Third Place Playoff</div>
                      <div className="flex flex-col items-center gap-2">
                        {bracketView === 'my-picks' ? renderMatchCard('3RD', false, false) : renderActualMatchCard('3RD', false)}
                        {bracketView === 'my-picks' ? (
                          thirdPlace && <ThirdPlaceCard team={thirdPlace} logo={resolveLogo(logos, thirdPlace)} correct={!!thirdPlace && thirdPlace === getActualThirdPlace()} />
                        ) : (
                          getActualThirdPlace() && <ThirdPlaceCard team={getActualThirdPlace()} logo={resolveLogo(logos, getActualThirdPlace())} />
                        )}
                      </div>
                    </div>

                    <div className="w-full max-w-sm space-y-4 border-t border-white/5 pt-6">
                      <div className="text-center text-xs font-bold uppercase tracking-wider text-textMuted">The Final Match</div>
                      <div className="flex flex-col items-center gap-3">
                        {bracketView === 'my-picks' ? renderMatchCard('FINAL', false, false) : renderActualMatchCard('FINAL', false)}
                        {bracketView === 'my-picks' ? (
                          <ChampionCard team={champion} logo={resolveLogo(logos, champion)} correct={!!champion && champion === getActualChampion()} />
                        ) : (
                          <ChampionCard team={getActualChampion()} logo={resolveLogo(logos, getActualChampion())} />
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      )}

      {/* ─── KO Stage Score Breakdown ─── */}
      {activeTab === 'ko' && bracket?.points_breakdown?.ko_stage_details && (
        <KoScoreTable
          details={bracket.points_breakdown.ko_stage_details}
          logos={logos}
        />
      )}
    </div>
  );
};
