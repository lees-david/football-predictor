import React, { useState, useEffect } from 'react';
import { useFixtures } from '../api/hooks/useFixtures';
import { useMyPredictions, useSubmitPrediction, useClearPredictions } from '../api/hooks/usePredictions';
import { useTournamentContext } from '../api/TournamentContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { CollapsibleSection, StageSubtitle } from '../components/ui/CollapsibleSection';
import { Lock, HelpCircle, Trash2, Save, CheckCircle, Shuffle } from 'lucide-react';
import { formatDateTime } from '../utils/timezone';
import { getFifaRanking } from '../utils/fifaRankings';
import { cleanTeamName } from '../utils/teamNames';

export const MatchPredictions: React.FC = () => {
  const { selectedTournamentId } = useTournamentContext();
  const { data: fixtures, isLoading: isLoadingFixtures } = useFixtures(selectedTournamentId);
  const { data: predictions, isLoading: isLoadingPredictions } = useMyPredictions(selectedTournamentId);
  const submitPrediction = useSubmitPrediction();
  const clearPredictions = useClearPredictions(selectedTournamentId);

  const [localPicks, setLocalPicks] = useState<Record<number, {h: string, a: string}>>({});
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'live' | 'completed'>('all');
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearStage, setClearStage] = useState<string>('all');
  const [clearSuccessMsg, setClearSuccessMsg] = useState<string | null>(null);

  const getMatchNumber = (externalId: string | null) => {
    if (!externalId) return '';
    const match = externalId.match(/m(\d+)$/);
    return match ? `#${match[1]}` : externalId;
  };

  const isPlaceholderName = (name: string) => {
    const low = name.toLowerCase();
    return ['match', 'placeholder', 'winner', 'loser', 'runner', 'group'].some(x => low.includes(x));
  };

  const getPreviousStageLastKickoff = (stage: string) => {
    let prevStage = '';
    if (stage === 'round_32') prevStage = 'group';
    else if (stage === 'round_16') prevStage = 'round_32';
    else if (stage === 'quarter_final') prevStage = 'round_16';
    else if (stage === 'semi_final') prevStage = 'quarter_final';
    else if (stage === 'third_place' || stage === 'final') prevStage = 'semi_final';

    if (!prevStage) return null;
    const prevFixtures = (fixtures || []).filter(f => f.stage === prevStage);
    if (prevFixtures.length === 0) return null;
    const kickoffTimes = prevFixtures.map(f => new Date(f.kickoff_time).getTime());
    return Math.max(...kickoffTimes);
  };

  const [openStages, setOpenStages] = useState<Record<string, boolean>>({});
  const toggleStage = (stage: string) => {
    setOpenStages(prev => ({ ...prev, [stage]: !prev[stage] }));
  };

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (groupCode: string) => {
    setOpenGroups(prev => ({ ...prev, [groupCode]: !prev[groupCode] }));
  };

  const [savingStage, setSavingStage] = useState<string | null>(null);
  const [stageNotification, setStageNotification] = useState<{ stage: string; type: 'success' | 'error'; msg: string } | null>(null);
  const [savingCardId, setSavingCardId] = useState<number | null>(null);

  useEffect(() => {
    if (predictions) {
      const picks: Record<number, {h: string, a: string}> = {};
      predictions.forEach(p => {
        picks[p.fixture_id] = { h: String(p.predicted_home), a: String(p.predicted_away) };
      });
      setLocalPicks(picks);
    }
  }, [predictions]);

  if (isLoadingFixtures || isLoadingPredictions) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-textMuted text-sm animate-pulse">Loading predictions dashboard...</p>
        </div>
      </div>
    );
  }

  if (!fixtures) {
    return (
      <div className="text-center py-12 text-textMuted">
        No fixtures found for this tournament.
      </div>
    );
  }

  const sortedFixtures = fixtures.slice().sort((a, b) => {
    const dateA = new Date(a.kickoff_time).getTime();
    const dateB = new Date(b.kickoff_time).getTime();
    if (dateA !== dateB) return dateA - dateB;
    const groupA = a.group_code || '';
    const groupB = b.group_code || '';
    return groupA.localeCompare(groupB);
  });

  const getFixtureState = (fixture: typeof sortedFixtures[0]) => {
    const isCompleted = fixture.status === 'completed';
    const isLive = fixture.status === 'live';
    const kickoffMs = new Date(fixture.kickoff_time).getTime();
    const lockMs = kickoffMs - 15 * 60000;
    const isLocked = new Date().getTime() >= lockMs;

    if (isCompleted) return 'completed';
    if (isLive) return 'live';
    if (isLocked) return 'locked';
    return 'active';
  };

  const handleClearPredictions = async () => {
    try {
      await clearPredictions.mutateAsync({
        stage: clearStage === 'all' ? undefined : clearStage
      });
      setClearSuccessMsg('Scores cleared successfully!');
      setTimeout(() => {
        setClearSuccessMsg(null);
        setShowClearModal(false);
      }, 1500);
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleInputChange = (fixtureId: number, team: 'h'|'a', val: string) => {
    if (val !== '' && !/^\d+$/.test(val)) return;
    setLocalPicks(prev => ({
      ...prev,
      [fixtureId]: { ...(prev[fixtureId] || {h:'', a:''}), [team]: val }
    }));
  };

  const handleStep = (fixtureId: number, team: 'h'|'a', direction: 'up' | 'down') => {
    const currentVal = parseInt(localPicks[fixtureId]?.[team] || '0', 10);
    let newVal = direction === 'up' ? currentVal + 1 : currentVal - 1;
    if (newVal < 0) newVal = 0;
    if (newVal > 99) newVal = 99;
    
    setLocalPicks(prev => ({
      ...prev,
      [fixtureId]: { ...(prev[fixtureId] || {h:'0', a:'0'}), [team]: String(newVal) }
    }));
  };

  const STAGE_OPTIONS: { value: string; label: string }[] = [
    { value: 'group', label: 'Group Stage' },
    { value: 'round_32', label: 'Round of 32' },
    { value: 'round_16', label: 'Round of 16' },
    { value: 'quarter_final', label: 'Quarter-finals' },
    { value: 'semi_final', label: 'Semi-finals' },
    { value: 'third_place', label: 'Third-place Playoff' },
    { value: 'final', label: 'Final' },
  ];

  // A stage is clearable if it has at least one active (unlocked) fixture
  const clearableStages = new Set(
    STAGE_OPTIONS
      .filter(({ value }) =>
        sortedFixtures.some(f => f.stage === value && getFixtureState(f) === 'active')
      )
      .map(({ value }) => value)
  );
  const hasClearableFixtures = clearableStages.size > 0;

  const filteredFixtures = sortedFixtures.filter(f => {
    const state = getFixtureState(f);
    if (activeFilter === 'all') return true;
    if (activeFilter === 'active') return state === 'active' || state === 'locked';
    return state === activeFilter;
  });

  // Detect whether all currently open (active) fixtures have been predicted
  const openFixtures = sortedFixtures.filter(f => getFixtureState(f) === 'active');
  const predictedOpenCount = openFixtures.filter(f => predictions?.some(p => p.fixture_id === f.id)).length;
  const allOpenPredicted = openFixtures.length > 0 && predictedOpenCount === openFixtures.length;

  const stageGroups: Record<string, typeof fixtures> = {
    'group': [],
    'round_32': [],
    'round_16': [],
    'quarter_final': [],
    'semi_final': [],
    'third_place': [],
    'final': []
  };

  filteredFixtures.forEach(f => {
    if (stageGroups[f.stage]) {
      stageGroups[f.stage].push(f);
    }
  });

  Object.keys(stageGroups).forEach(stage => {
    if (stage === 'group') {
      stageGroups[stage].sort((a, b) => {
        const groupA = a.group_code || '';
        const groupB = b.group_code || '';
        const comp = groupA.localeCompare(groupB);
        if (comp !== 0) return comp;
        return new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime();
      });
    } else {
      stageGroups[stage].sort((a, b) => new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime());
    }
  });

  const activeStages = Object.entries(stageGroups).filter(([_key, list]) => list.length > 0);

  const notifyStage = (stage: string, type: 'success' | 'error', msg: string) => {
    setStageNotification({ stage, type, msg });
    setTimeout(() => setStageNotification(null), 4000);
  };

  const handlePickForMe = (stage: string) => {
    const list = stageGroups[stage] || [];
    const activeFixtures = list.filter(f => getFixtureState(f) === 'active');
    if (activeFixtures.length === 0) return;
    setLocalPicks(prev => {
      const next = { ...prev };
      for (const f of activeFixtures) {
        const existing = prev[f.id];
        if (existing && existing.h !== '' && existing.a !== '') continue;
        const h = Math.floor(Math.random() * 5);
        const a = Math.floor(Math.random() * 5);
        next[f.id] = { h: String(h), a: String(a) };
      }
      return next;
    });
  };

  const handleSaveStage = async (stage: string) => {
    const list = stageGroups[stage] || [];
    const modified = list.filter(f => {
      const state = getFixtureState(f);
      if (state !== 'active') return false;
      const pick = localPicks[f.id] || { h: '', a: '' };
      if (pick.h === '' || pick.a === '') return false;
      const savedPick = predictions?.find(p => p.fixture_id === f.id);
      return savedPick
        ? String(savedPick.predicted_home) !== pick.h || String(savedPick.predicted_away) !== pick.a
        : true;
    });

    if (modified.length === 0) {
      notifyStage(stage, 'error', 'No changes to save — enter scores first');
      return;
    }

    setSavingStage(stage);
    try {
      await Promise.all(
        modified.map(f => {
          const pick = localPicks[f.id];
          return submitPrediction.mutateAsync({
            fixture_id: f.id,
            predicted_home: parseInt(pick.h, 10),
            predicted_away: parseInt(pick.a, 10)
          });
        })
      );
      notifyStage(stage, 'success', `${modified.length} prediction${modified.length > 1 ? 's' : ''} saved`);
    } catch (err) {
      console.error("Stage save failed:", err);
      notifyStage(stage, 'error', 'Save failed — please try again');
    } finally {
      setSavingStage(null);
    }
  };

  const handleSaveCard = async (fixtureId: number) => {
    const pick = localPicks[fixtureId];
    if (!pick || pick.h === '' || pick.a === '') {
      return;
    }
    setSavingCardId(fixtureId);
    try {
      await submitPrediction.mutateAsync({
        fixture_id: fixtureId,
        predicted_home: parseInt(pick.h, 10),
        predicted_away: parseInt(pick.a, 10)
      });
    } catch (err) {
      console.error("Save card failed:", err);
    } finally {
      setSavingCardId(null);
    }
  };

  const renderFixtureCard = (fixture: typeof sortedFixtures[0]) => {
    const cleanHome = cleanTeamName(fixture.home_team);
    const cleanAway = cleanTeamName(fixture.away_team);
    const pick = localPicks[fixture.id] || {h:'', a:''};
    const state = getFixtureState(fixture);
    const savedPick = predictions?.find(p => p.fixture_id === fixture.id);
    const hasUnsavedChanges = savedPick
      ? String(savedPick.predicted_home) !== pick.h || String(savedPick.predicted_away) !== pick.a
      : pick.h !== '' && pick.a !== '';

    let cardClasses = 'hover:border-primary/20 border-white/5';
    let statusBadge = null;
    let inputsDisabled = false;

    if (state === 'completed') {
      cardClasses = 'opacity-85 bg-slate-900/40 border-white/5 saturate-[0.8]';
      inputsDisabled = true;
      const pts = savedPick?.points_awarded ?? 0;
      const hasPredicted = savedPick !== undefined;

      statusBadge = hasPredicted ? (
        pts === 5 ? (
          <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full text-xs font-bold shadow-[0_0_8px_rgba(16,185,129,0.2)]">
            🎯 +5 pts
          </span>
        ) : pts === 3 ? (
          <span className="bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2.5 py-1 rounded-full text-xs font-bold">
            📐 +3 pts
          </span>
        ) : pts === 2 ? (
          <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded-full text-xs font-bold">
            👍 +2 pts
          </span>
        ) : (
          <span className="bg-red-500/10 text-red-400 border border-red-500/20 px-2.5 py-1 rounded-full text-xs font-medium">
            ❌ 0 pts
          </span>
        )
      ) : (
        <span className="bg-white/5 text-textMuted border border-white/5 px-2.5 py-1 rounded-full text-xs font-medium">
          Missed
        </span>
      );
    } else if (state === 'live') {
      cardClasses = 'border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.15)] bg-emerald-950/10';
      inputsDisabled = true;
      statusBadge = (
        <span className="flex items-center gap-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full text-xs font-bold animate-pulse">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span> LIVE
        </span>
      );
    } else if (state === 'locked') {
      cardClasses = 'opacity-70 bg-black/40 border-white/5';
      inputsDisabled = true;
      statusBadge = (
        <span className="flex items-center gap-1 bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2.5 py-1 rounded-full text-xs font-bold">
          <Lock size={12} /> Locked
        </span>
      );
    } else {
      cardClasses = 'border-white/5 hover:border-amber-500/30 shadow-md shadow-black/20';
      statusBadge = (
        <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2.5 py-1 rounded-full text-xs font-medium">
          Open
        </span>
      );
    }

    return (
      <Card key={fixture.id} className={`relative flex flex-col justify-between p-4 min-h-[270px] transition-all duration-300 rounded-2xl glass-card ${cardClasses}`}>

        {/* Header Row */}
        <div className="flex justify-between items-center mb-4">
          <span className="text-xs text-textMuted uppercase tracking-wider font-semibold flex items-center gap-1.5">
            <span className="font-mono text-amber-500 font-bold">{getMatchNumber(fixture.external_id)}</span>
            <span>•</span>
            <span>{fixture.stage.replace('_', ' ')} {fixture.group_code ? `• ${fixture.group_code}` : ''}</span>
          </span>
          {statusBadge}
        </div>

        {/* Score / Teams Body Row (Fully Vertical Centered Layout for Mobile) */}
        <div className="flex flex-col items-center justify-center gap-3 my-auto py-2">

          {/* Home Team Flag & Name */}
          <div className="flex items-center gap-2">
            {fixture.home_logo ? (
              <img
                src={fixture.home_logo}
                alt={cleanHome}
                className="w-6 h-4 object-cover rounded shadow-sm border border-white/10"
              />
            ) : (
              <div className="w-6 h-4 rounded bg-white/5 flex items-center justify-center font-bold text-[8px] text-white">
                {cleanHome[0] || '?'}
              </div>
            )}
            <span className="text-sm font-bold text-white/90" title={cleanHome}>
              {cleanHome}
            </span>
            {getFifaRanking(cleanHome) && (
              <span className="text-[10px] text-textMuted font-mono font-normal opacity-70">
                #{getFifaRanking(cleanHome)?.rank}
              </span>
            )}
          </div>

          {/* Home Score Picker / Display */}
          <div className="w-full flex justify-center">
            {inputsDisabled ? (
              <div className="flex items-center gap-4">
                {(state === 'live' || state === 'completed') && (
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-textMuted uppercase font-bold tracking-wider">Result</span>
                    <span className="text-sm font-black text-white bg-white/5 px-2.5 py-0.5 rounded-lg border border-white/5 min-w-[24px] text-center">
                      {fixture.home_score}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <span className="text-[8px] text-textMuted uppercase font-bold tracking-wider">Your Pick</span>
                  {savedPick ? (
                    <span className="text-sm font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-lg min-w-[24px] text-center">
                      {savedPick.predicted_home}
                    </span>
                  ) : (
                    <span className="text-[10px] text-textMuted italic bg-white/5 px-2 py-0.5 rounded-lg">No pick</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1 bg-black/20 p-0.5 rounded-xl border border-white/5">
                <button
                  type="button"
                  onClick={() => handleStep(fixture.id, 'h', 'down')}
                  className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 active:bg-white/20 select-none text-sm font-bold"
                >
                  -
                </button>
                <input
                  type="text"
                  maxLength={2}
                  value={pick.h}
                  onChange={(e) => handleInputChange(fixture.id, 'h', e.target.value)}
                  className="w-10 h-8 text-center text-sm font-bold bg-black/40 border border-white/10 rounded-lg focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleStep(fixture.id, 'h', 'up')}
                  className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 active:bg-white/20 select-none text-sm font-bold"
                >
                  +
                </button>
              </div>
            )}
          </div>

          {/* VS Divider / Separator */}
          <div className="flex items-center justify-center gap-2 w-full py-0.5">
            <div className="h-[1px] bg-white/5 flex-1 max-w-[60px]"></div>
            <span className="text-textMuted text-[10px] uppercase font-bold tracking-widest">VS</span>
            <div className="h-[1px] bg-white/5 flex-1 max-w-[60px]"></div>
          </div>

          {/* Away Score Picker / Display */}
          <div className="w-full flex justify-center">
            {inputsDisabled ? (
              <div className="flex items-center gap-4">
                {(state === 'live' || state === 'completed') && (
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-textMuted uppercase font-bold tracking-wider">Result</span>
                    <span className="text-sm font-black text-white bg-white/5 px-2.5 py-0.5 rounded-lg border border-white/5 min-w-[24px] text-center">
                      {fixture.away_score}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <span className="text-[8px] text-textMuted uppercase font-bold tracking-wider">Your Pick</span>
                  {savedPick ? (
                    <span className="text-sm font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-lg min-w-[24px] text-center">
                      {savedPick.predicted_away}
                    </span>
                  ) : (
                    <span className="text-[10px] text-textMuted italic bg-white/5 px-2 py-0.5 rounded-lg">No pick</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1 bg-black/20 p-0.5 rounded-xl border border-white/5">
                <button
                  type="button"
                  onClick={() => handleStep(fixture.id, 'a', 'down')}
                  className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 active:bg-white/20 select-none text-sm font-bold"
                >
                  -
                </button>
                <input
                  type="text"
                  maxLength={2}
                  value={pick.a}
                  onChange={(e) => handleInputChange(fixture.id, 'a', e.target.value)}
                  className="w-10 h-8 text-center text-sm font-bold bg-black/40 border border-white/10 rounded-lg focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleStep(fixture.id, 'a', 'up')}
                  className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 active:bg-white/20 select-none text-sm font-bold"
                >
                  +
                </button>
              </div>
            )}
          </div>

          {/* Away Team Flag & Name */}
          <div className="flex items-center gap-2">
            {fixture.away_logo ? (
              <img
                src={fixture.away_logo}
                alt={cleanAway}
                className="w-6 h-4 object-cover rounded shadow-sm border border-white/10"
              />
            ) : (
              <div className="w-6 h-4 rounded bg-white/5 flex items-center justify-center font-bold text-[8px] text-white">
                {cleanAway[0] || '?'}
              </div>
            )}
            <span className="text-sm font-bold text-white/90" title={cleanAway}>
              {cleanAway}
            </span>
            {getFifaRanking(cleanAway) && (
              <span className="text-[10px] text-textMuted font-mono font-normal opacity-70">
                #{getFifaRanking(cleanAway)?.rank}
              </span>
            )}
          </div>

          {/* AET / Penalty details if any (for knockout games) */}
          {(state === 'live' || state === 'completed') && (
            (fixture.home_score_aet !== null && fixture.away_score_aet !== null) || fixture.knockout_winner
          ) && (
            <div className="flex flex-col gap-0.5 text-center bg-white/5 p-2 rounded-xl border border-white/5 text-[10px] mt-1 w-full max-w-[220px]">
              {fixture.home_score_aet !== null && fixture.away_score_aet !== null && (
                <span className="text-amber-400 font-semibold uppercase tracking-wide">
                  AET: {fixture.home_score_aet} - {fixture.away_score_aet}
                </span>
              )}
              {fixture.knockout_winner && fixture.home_score_aet === fixture.away_score_aet && (
                <span className="text-violet-400 font-semibold uppercase tracking-wide">
                  Pens · {fixture.knockout_winner} wins
                </span>
              )}
            </div>
          )}

        </div>

        {/* Footer / Status / Save Row */}
        <div className="flex justify-between items-center mt-3 pt-3 border-t border-t-white/5">
          <span className="text-[10px] text-textMuted font-semibold uppercase tracking-wider">
            {state === 'completed' ? (
              <span className="text-textMuted">Finished</span>
            ) : state === 'live' ? (
              <span className="text-emerald-400">Match active</span>
            ) : (
              formatDateTime(fixture.kickoff_time, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            )}
          </span>

          <div className="text-xs">
            {savedPick && !hasUnsavedChanges ? (
              <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                <CheckCircle size={12} /> Saved
              </span>
            ) : hasUnsavedChanges ? (
              <button
                type="button"
                disabled={savingCardId === fixture.id}
                onClick={async (e) => {
                  e.stopPropagation();
                  await handleSaveCard(fixture.id);
                }}
                className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-black text-[10px] font-extrabold uppercase tracking-wider rounded-lg transition-colors flex items-center gap-1 shadow-[0_0_10px_rgba(245,158,11,0.2)]"
              >
                {savingCardId === fixture.id ? (
                  <div className="w-2.5 h-2.5 border border-black border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <Save size={10} />
                )}
                <span>{savingCardId === fixture.id ? 'Saving...' : 'Save Now'}</span>
              </button>
            ) : null}
          </div>
        </div>

      </Card>
    );
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
            🎯 Match Scores
          </h1>
          <p className="text-textMuted text-sm mt-1">
            Predict match scores. Picks lock 15 minutes before kickoff.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 self-start md:self-center">
          <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
            {(['all', 'active', 'live', 'completed'] as const).map(filter => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${
                  activeFilter === filter
                    ? 'bg-amber-500 text-black shadow-md'
                    : 'text-textMuted hover:text-white'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>

          <Button
            variant="danger"
            size="sm"
            onClick={() => setShowClearModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold uppercase tracking-wider bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/30 rounded-xl"
          >
            <Trash2 size={14} /> Clear Scores
          </Button>
        </div>
      </div>

      <Modal isOpen={showClearModal} onClose={() => setShowClearModal(false)} title="Clear Match Predictions">
        <div className="space-y-4">
          {hasClearableFixtures ? (
            <>
              <p className="text-sm text-textMuted">
                Select which phase to clear. Only open (unlocked) stages are shown — locked or completed stages cannot be cleared.
              </p>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-textMuted uppercase tracking-wider block">Tournament Phase</label>
                <select
                  value={clearStage}
                  onChange={(e) => setClearStage(e.target.value)}
                  className="w-full px-3 py-2 bg-black/60 border border-white/10 rounded-xl text-white outline-none focus:border-amber-500 transition-all text-sm"
                >
                  <option value="all">All Open Stages</option>
                  {STAGE_OPTIONS.filter(o => clearableStages.has(o.value)).map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {clearSuccessMsg && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs text-center font-semibold animate-pulse">
                  {clearSuccessMsg}
                </div>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" size="sm" onClick={() => setShowClearModal(false)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleClearPredictions}
                  isLoading={clearPredictions.isPending}
                  disabled={clearPredictions.isPending || !!clearSuccessMsg}
                  className="flex items-center gap-1.5"
                >
                  <Trash2 size={14} /> Clear Predictions
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-textMuted">
                All stages are currently locked or completed. There are no open predictions to clear.
              </p>
              <div className="flex justify-end pt-2">
                <Button variant="secondary" size="sm" onClick={() => setShowClearModal(false)}>
                  Close
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* All-caught-up banner */}
      {allOpenPredicted && (
        <div className="flex items-center gap-3 px-5 py-4 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-400/5 to-transparent animate-fadeIn">
          <span className="text-2xl select-none">🎉</span>
          <div>
            <p className="text-sm font-bold text-amber-400">You're all caught up!</p>
            <p className="text-xs text-textMuted mt-0.5">
              All <span className="font-bold text-white">{openFixtures.length}</span> currently-available match{openFixtures.length !== 1 ? 'es' : ''} have been predicted.
              New predictions will unlock as each stage progresses.
            </p>
          </div>
        </div>
      )}

      {activeStages.length === 0 ? (
        <div className="glass-card text-center py-16 rounded-2xl border border-white/5">
          <HelpCircle size={48} className="mx-auto text-textMuted/40 mb-3" />
          <p className="text-textMuted font-medium">No matches found in this category.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {activeStages.map(([stageKey, list]) => {
            const isOpen = openStages[stageKey] ?? false;

            const isGroup = stageKey === 'group';
            const isConfirmed = isGroup || list.every(f => !isPlaceholderName(f.home_team) && !isPlaceholderName(f.away_team));

            const activeKickoffs = list
              .filter(f => getFixtureState(f) === 'active')
              .map(f => new Date(f.kickoff_time).getTime());
            const earliestActiveKickoffMs = activeKickoffs.length > 0 ? Math.min(...activeKickoffs) : null;
            const isCurrentlyOpen = isConfirmed && earliestActiveKickoffMs !== null;

            const closesAtStr = earliestActiveKickoffMs
              ? new Date(earliestActiveKickoffMs).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              : undefined;

            const prevStageLastKickoff = getPreviousStageLastKickoff(stageKey);
            const prevStageIsInPast = prevStageLastKickoff != null && prevStageLastKickoff < Date.now();
            const opensAtStr = isGroup
              ? undefined
              : prevStageLastKickoff
              ? (isConfirmed || prevStageIsInPast ? undefined : '~' + new Date(prevStageLastKickoff).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
              : isConfirmed
              ? undefined
              : 'Once previous round concludes';

            const savedCount = list.filter(f => predictions?.some(p => p.fixture_id === f.id)).length;
            const totalCount = list.length;
            const allSaved = savedCount === totalCount;

            const hasUnsavedInStage = list.some(fixture => {
              const state = getFixtureState(fixture);
              if (state !== 'active' || !isConfirmed) return false;
              const pick = localPicks[fixture.id] || { h: '', a: '' };
              if (pick.h === '' || pick.a === '') return false;
              const savedPick = predictions?.find(p => p.fixture_id === fixture.id);
              return savedPick
                ? String(savedPick.predicted_home) !== pick.h || String(savedPick.predicted_away) !== pick.a
                : true;
            });

            // Sub-group data for group stage
            const byGroup: Record<string, typeof list> = {};
            if (isGroup) {
              for (const f of list) {
                const g = f.group_code ?? '?';
                if (!byGroup[g]) byGroup[g] = [];
                byGroup[g].push(f);
              }
            }

            const stageBadges = (
              <>
                <Badge variant={isConfirmed && !allSaved ? 'warning' : isConfirmed ? 'live' : 'scheduled'}>
                  {isConfirmed && !allSaved ? 'Teams & Matches Confirmed - Predictions Needed' : isConfirmed ? 'Teams & Matches Confirmed' : 'Teams & Matches Not Yet Confirmed'}
                </Badge>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${allSaved ? 'bg-success/20 text-success' : 'bg-white/10 text-textMuted'}`}>
                  {savedCount}/{totalCount}
                </span>
              </>
            );

            const stageActions = (
              <>
                {stageNotification?.stage === stageKey && (
                  <span
                    onClick={(e) => e.stopPropagation()}
                    className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${stageNotification.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}
                  >
                    {stageNotification.msg}
                  </span>
                )}
                {isConfirmed && list.some(f => getFixtureState(f) === 'active') && (
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePickForMe(stageKey);
                    }}
                    className="flex items-center gap-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 font-bold px-3 py-1.5 rounded-xl text-xs"
                  >
                    <Shuffle size={13} /> Pick for me
                  </Button>
                )}
                {hasUnsavedInStage && (
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSaveStage(stageKey);
                    }}
                    isLoading={savingStage === stageKey}
                    className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-black font-bold px-3 py-1.5 rounded-xl text-xs shadow-[0_0_10px_rgba(245,158,11,0.2)]"
                  >
                    <Save size={13} /> Save Stage predictions
                  </Button>
                )}
              </>
            );

            return (
              <CollapsibleSection
                key={stageKey}
                title={stageKey.replace('_', ' ')}
                badges={stageBadges}
                subtitle={<StageSubtitle isCurrentlyOpen={isCurrentlyOpen} closesAt={closesAtStr} opensAt={opensAtStr} />}
                headerActions={stageActions}
                isOpen={isOpen}
                onToggle={() => toggleStage(stageKey)}
              >
                  <>
                    {!isConfirmed ? (
                      <div className="py-12 text-center text-textMuted space-y-2 flex flex-col items-center justify-center">
                        <Lock size={32} className="opacity-30 mb-1" />
                        <h4 className="font-bold text-white/80">Stage Closed</h4>
                        <p className="text-xs max-w-md">
                          Predictions for this stage will unlock automatically once all participants have been officially confirmed from the preceding round.
                        </p>
                      </div>
                    ) : isGroup ? (
                      /* Group stage: nested by group code */
                      <div className="space-y-4">
                        {Object.keys(byGroup).sort().map(gc => {
                          const groupFixtures = byGroup[gc];
                          const groupSaved = groupFixtures.filter(f => predictions?.some(p => p.fixture_id === f.id)).length;
                          const groupTotal = groupFixtures.length;
                          const groupAllSaved = groupSaved === groupTotal;
                          const isGroupOpen = openGroups[gc] ?? false;

                          // Collect unique teams with logos for the flag row
                          const teamLogos: { name: string; logo: string | null }[] = [];
                          const seenTeams = new Set<string>();
                          for (const f of groupFixtures) {
                            if (!seenTeams.has(f.home_team)) {
                              seenTeams.add(f.home_team);
                              teamLogos.push({ name: f.home_team, logo: f.home_logo ?? null });
                            }
                            if (!seenTeams.has(f.away_team)) {
                              seenTeams.add(f.away_team);
                              teamLogos.push({ name: f.away_team, logo: f.away_logo ?? null });
                            }
                          }

                          const groupBadges = (
                            <>
                              <div className="flex items-center gap-1">
                                {teamLogos.map(t => t.logo ? (
                                  <img
                                    key={t.name}
                                    src={t.logo}
                                    alt={t.name}
                                    title={t.name}
                                    className="h-[1em] w-auto rounded-sm object-cover"
                                    style={{ fontSize: 'inherit' }}
                                  />
                                ) : (
                                  <span key={t.name} className="text-xs text-textMuted font-bold">{t.name[0]}</span>
                                ))}
                              </div>
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${groupAllSaved ? 'bg-success/20 text-success' : 'bg-white/10 text-textMuted'}`}>
                                {groupSaved}/{groupTotal}
                              </span>
                            </>
                          );

                          return (
                            <CollapsibleSection
                              key={gc}
                              variant="group"
                              title={`Group ${gc}`}
                              badges={groupBadges}
                              isOpen={isGroupOpen}
                              onToggle={() => toggleGroup(gc)}
                              bodyClassName="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                            >
                              {groupFixtures.map(fixture => renderFixtureCard(fixture))}
                            </CollapsibleSection>
                          );
                        })}
                      </div>
                    ) : (
                      /* KO stages: flat grid */
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {list.map(fixture => renderFixtureCard(fixture))}
                      </div>
                    )}
                  </>
              </CollapsibleSection>
            );
          })}
        </div>
      )}
    </div>
  );
};
