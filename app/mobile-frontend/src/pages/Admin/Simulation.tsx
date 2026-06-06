import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { CollapsibleSection } from '../../components/ui/CollapsibleSection';
import { apiClient } from '../../api/client';
import { useTournamentContext } from '../../api/TournamentContext';
import { FlaskConical, RotateCcw, Play, Zap, ArrowRight, Shuffle, Trash2, RefreshCw } from 'lucide-react';

interface FixtureSimState {
  id: number;
  stage: string;
  group_code: string | null;
  matchday: number | null;
  home_team: string;
  away_team: string;
  kickoff_time: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_score_aet: number | null;
  away_score_aet: number | null;
  knockout_winner: string | null;
}

interface SetResultPayload {
  home_score: number;
  away_score: number;
  home_score_aet?: number;
  away_score_aet?: number;
  knockout_winner?: string;
}

const STAGE_LABELS: Record<string, string> = {
  group: 'Group Stage',
  round_32: 'Round of 32',
  round_16: 'Round of 16',
  quarter_final: 'Quarter-Finals',
  semi_final: 'Semi-Finals',
  third_place: 'Third Place Play-off',
  final: 'Final',
};

const STAGE_ORDER = ['group', 'round_32', 'round_16', 'quarter_final', 'semi_final', 'third_place', 'final'];

// Stages that can be "advanced into" from the previous stage
const ADVANCE_TARGETS: Record<string, string> = {
  group: 'round_32',
  round_32: 'round_16',
  round_16: 'quarter_final',
  quarter_final: 'semi_final',
  semi_final: 'final',
};

function statusVariant(status: string): 'success' | 'live' | 'scheduled' {
  if (status === 'completed') return 'success';
  if (status === 'live') return 'live';
  return 'scheduled';
}

interface FixtureRowProps {
  fixture: FixtureSimState;
  onSetResult: (id: number, payload: SetResultPayload) => void;
  onReset: (id: number) => void;
  isPending: boolean;
}

const KO_STAGES = new Set(['round_32', 'round_16', 'quarter_final', 'semi_final', 'third_place', 'final']);

const FixtureRow: React.FC<FixtureRowProps> = ({ fixture, onSetResult, onReset, isPending }) => {
  const [home, setHome] = useState<string>(fixture.home_score?.toString() ?? '1');
  const [away, setAway] = useState<string>(fixture.away_score?.toString() ?? '0');
  const [homeAet, setHomeAet] = useState<string>(fixture.home_score_aet?.toString() ?? '');
  const [awayAet, setAwayAet] = useState<string>(fixture.away_score_aet?.toString() ?? '');
  const [pensWinner, setPensWinner] = useState<'home' | 'away' | ''>(
    fixture.knockout_winner
      ? fixture.knockout_winner === fixture.home_team ? 'home' : 'away'
      : ''
  );

  // Sync when fixture data changes (e.g. after "Complete All random")
  useEffect(() => {
    if (fixture.home_score != null) setHome(String(fixture.home_score));
    if (fixture.away_score != null) setAway(String(fixture.away_score));
    setHomeAet(fixture.home_score_aet != null ? String(fixture.home_score_aet) : '');
    setAwayAet(fixture.away_score_aet != null ? String(fixture.away_score_aet) : '');
    setPensWinner(
      fixture.knockout_winner
        ? fixture.knockout_winner === fixture.home_team ? 'home' : 'away'
        : ''
    );
  }, [fixture.home_score, fixture.away_score, fixture.home_score_aet, fixture.away_score_aet, fixture.knockout_winner, fixture.home_team]);

  const isKo = KO_STAGES.has(fixture.stage);
  const isCompleted = fixture.status === 'completed';
  const homeFt = parseInt(home) || 0;
  const awayFt = parseInt(away) || 0;
  const ftDraw = homeFt === awayFt;
  const homeAetVal = homeAet !== '' ? parseInt(homeAet) : null;
  const awayAetVal = awayAet !== '' ? parseInt(awayAet) : null;
  const aetSet = homeAetVal !== null && awayAetVal !== null;
  const aetDraw = aetSet && homeAetVal === awayAetVal;

  const handleSet = () => {
    const payload: SetResultPayload = { home_score: homeFt, away_score: awayFt };
    if (isKo && aetSet) {
      payload.home_score_aet = homeAetVal!;
      payload.away_score_aet = awayAetVal!;
    }
    if (isKo && aetDraw && pensWinner) {
      payload.knockout_winner = pensWinner === 'home' ? fixture.home_team : fixture.away_team;
    }
    onSetResult(fixture.id, payload);
  };

  return (
    <div className="p-3 mb-3 bg-black/40 border border-white/5 rounded-xl hover:border-white/10 transition-colors space-y-3">
      {/* Header Row: Status & Reset */}
      <div className="flex items-center justify-between text-xs border-b border-white/5 pb-2">
        <Badge variant={statusVariant(fixture.status)} className="text-[10px] px-1.5 py-0.5 font-semibold">
          {fixture.status}
        </Badge>
        {isCompleted && (
          <button
            onClick={() => onReset(fixture.id)}
            disabled={isPending}
            className="flex items-center gap-1 text-[11px] text-textMuted hover:text-white transition-colors"
          >
            <RotateCcw size={10} /> Reset
          </button>
        )}
      </div>

      {/* Teams & Scores Editor */}
      <div className="space-y-2">
        {/* Home Team */}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-textMain truncate flex-1">{fixture.home_team}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[9px] text-textMuted uppercase tracking-wider font-mono">FT</span>
            <input
              type="number"
              min={0}
              max={20}
              value={home}
              onChange={(e) => setHome(e.target.value)}
              className="w-10 text-center bg-slate-800 border border-white/10 rounded px-1 py-1 text-white text-xs font-bold focus:outline-none focus:border-primary disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={isCompleted}
            />
          </div>
        </div>

        {/* Away Team */}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-textMain truncate flex-1">{fixture.away_team}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[9px] text-textMuted opacity-0 pointer-events-none uppercase tracking-wider font-mono">FT</span>
            <input
              type="number"
              min={0}
              max={20}
              value={away}
              onChange={(e) => setAway(e.target.value)}
              className="w-10 text-center bg-slate-800 border border-white/10 rounded px-1 py-1 text-white text-xs font-bold focus:outline-none focus:border-primary disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={isCompleted}
            />
          </div>
        </div>
      </div>

      {/* AET and Pens (KO only, conditionally visible) */}
      {isKo && (ftDraw || isCompleted) && (
        <div className="pt-2 border-t border-white/5 flex gap-4 flex-wrap">
          {/* AET Score */}
          {(ftDraw || isCompleted) && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider font-mono">AET:</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={homeAet}
                  onChange={(e) => setHomeAet(e.target.value)}
                  placeholder="–"
                  className="w-9 text-center bg-slate-800 border border-white/10 rounded px-1 py-0.5 text-white text-xs focus:outline-none focus:border-primary disabled:opacity-30 disabled:cursor-not-allowed"
                  disabled={isCompleted || !ftDraw}
                />
                <span className="text-textMuted text-xs">-</span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={awayAet}
                  onChange={(e) => setAwayAet(e.target.value)}
                  placeholder="–"
                  className="w-9 text-center bg-slate-800 border border-white/10 rounded px-1 py-0.5 text-white text-xs focus:outline-none focus:border-primary disabled:opacity-30 disabled:cursor-not-allowed"
                  disabled={isCompleted || !ftDraw}
                />
              </div>
            </div>
          )}

          {/* Pens Winner */}
          {(aetDraw || isCompleted) && (
            <div className="flex items-center gap-2 flex-1 min-w-[120px]">
              <span className="text-[10px] text-blue-400 font-semibold uppercase tracking-wider font-mono">Pens:</span>
              <select
                value={pensWinner}
                onChange={(e) => setPensWinner(e.target.value as 'home' | 'away' | '')}
                disabled={isCompleted || !aetDraw}
                className="bg-slate-800 border border-white/10 rounded px-2 py-0.5 text-white text-xs focus:outline-none focus:border-primary disabled:opacity-30 disabled:cursor-not-allowed w-full max-w-[120px]"
              >
                <option value="">–</option>
                <option value="home">{fixture.home_team.split(' ').slice(-1)[0]}</option>
                <option value="away">{fixture.away_team.split(' ').slice(-1)[0]}</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* Action footer */}
      {!isCompleted && (
        <div className="flex items-center justify-end pt-2 border-t border-white/5">
          <Button
            size="sm"
            variant="primary"
            onClick={handleSet}
            disabled={isPending}
            className="flex items-center gap-1 text-[11px] py-1"
          >
            <Play size={10} /> Set Score
          </Button>
        </div>
      )}
    </div>
  );
};

interface GroupSectionProps {
  groupCode: string;
  fixtures: FixtureSimState[];
  onSetResult: (id: number, payload: SetResultPayload) => void;
  onReset: (id: number) => void;
  onCompleteGroup: (groupCode: string) => void;
  isPending: boolean;
}

const GroupSection: React.FC<GroupSectionProps> = ({ groupCode, fixtures, onSetResult, onReset, onCompleteGroup, isPending }) => {
  const [open, setOpen] = useState(false);
  const allDone = fixtures.every((f) => f.status === 'completed');
  const doneCnt = fixtures.filter((f) => f.status === 'completed').length;

  const badges = (
    <>
      <span className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${allDone ? 'bg-success/20 text-success' : 'bg-white/10 text-textMuted'}`}>
        {doneCnt}/{fixtures.length}
      </span>
      {allDone && <Badge variant="success" className="text-xs">Done</Badge>}
    </>
  );

  return (
    <div className="mb-3">
      <CollapsibleSection
        variant="group"
        title={`Group ${groupCode}`}
        badges={badges}
        isOpen={open}
        onToggle={() => setOpen((o) => !o)}
        bodyClassName="p-3 space-y-1"
      >
        {fixtures.map((f) => (
          <FixtureRow key={f.id} fixture={f} onSetResult={onSetResult} onReset={onReset} isPending={isPending} />
        ))}
        {!allDone && (
          <div className="mt-2 px-3">
            <Button size="sm" variant="secondary" onClick={() => onCompleteGroup(groupCode)} disabled={isPending}
              className="flex items-center gap-1 text-xs">
              <Zap size={11} /> Complete group (random scores)
            </Button>
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
};

export const Simulation: React.FC = () => {
  const queryClient = useQueryClient();
  const { selectedTournament } = useTournamentContext();
  const tournamentId = selectedTournament?.id ?? 1;

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});

  const notify = (type: 'success' | 'error', msg: string) => {
    setNotification({ type, msg });
    setTimeout(() => setNotification(null), 5000);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['sim-fixtures', tournamentId] });
    queryClient.invalidateQueries({ queryKey: ['bracket', 'actual-results', { tournamentId }] });
  };

  const { data: fixtures = [], isLoading } = useQuery<FixtureSimState[]>({
    queryKey: ['sim-fixtures', tournamentId],
    queryFn: () => apiClient.get(`/admin/simulate/fixtures?tournament_id=${tournamentId}`).then((r) => r.data),
  });

  const setResultMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: SetResultPayload }) =>
      apiClient.post(`/admin/simulate/fixture/${id}/result`, payload),
    onSuccess: () => { invalidate(); notify('success', 'Result set — grading dispatched'); },
    onError: () => notify('error', 'Failed to set result'),
  });

  const resetMutation = useMutation({
    mutationFn: (id: number) => apiClient.post(`/admin/simulate/fixture/${id}/reset`),
    onSuccess: () => { invalidate(); notify('success', 'Fixture reset — points reversed'); },
    onError: () => notify('error', 'Failed to reset fixture'),
  });

  const completeGroupMutation = useMutation({
    mutationFn: (groupCode: string) =>
      apiClient.post(`/admin/simulate/group/${groupCode}/complete`, { scores: [] }),
    onSuccess: (_, groupCode) => { invalidate(); notify('success', `Group ${groupCode} completed with random scores`); },
    onError: () => notify('error', 'Failed to complete group'),
  });

  const advanceStageMutation = useMutation({
    mutationFn: (stage: string) =>
      apiClient.post(`/admin/simulate/stage/${stage}/advance?tournament_id=${tournamentId}`),
    onSuccess: (_, stage) => {
      invalidate();
      const target = ADVANCE_TARGETS[stage] ?? 'next stage';
      notify('success', `Teams populated for ${STAGE_LABELS[target] ?? target}`);
    },
    onError: (err: any) =>
      notify('error', err?.response?.data?.detail ?? 'Failed to advance stage'),
  });

  const completeKoStageMutation = useMutation({
    mutationFn: (stage: string) =>
      apiClient.post(`/admin/simulate/stage/${stage}/complete?tournament_id=${tournamentId}`),
    onSuccess: (_, stage) => {
      invalidate();
      notify('success', `${STAGE_LABELS[stage] ?? stage} completed with random scores`);
    },
    onError: (err: any) =>
      notify('error', err?.response?.data?.detail ?? 'Failed to complete stage'),
  });

  const resetStageMutation = useMutation({
    mutationFn: (stage: string) =>
      apiClient.post(`/admin/simulate/stage/${stage}/reset?tournament_id=${tournamentId}`),
    onSuccess: (data: any, stage) => {
      invalidate();
      notify('success', `${STAGE_LABELS[stage] ?? stage} reset — ${data?.data?.fixtures_reset ?? 0} fixtures cleared`);
    },
    onError: (err: any) =>
      notify('error', err?.response?.data?.detail ?? 'Failed to reset stage'),
  });

  const recalcMutation = useMutation({
    mutationFn: () => apiClient.post('/admin/points/recalculate'),
    onSuccess: (res: any) => {
      const d = res.data;
      notify('success', `Points recalculated — ${d.users_drifted ?? 0} users fixed, ${d.brackets_fixed ?? 0} brackets fixed`);
    },
    onError: () => notify('error', 'Failed to recalculate points'),
  });

  const isPending =
    setResultMutation.isPending || resetMutation.isPending ||
    completeGroupMutation.isPending || advanceStageMutation.isPending ||
    completeKoStageMutation.isPending || resetStageMutation.isPending ||
    recalcMutation.isPending;

  // Group fixtures by stage then by group_code
  const byStage: Record<string, FixtureSimState[]> = {};
  for (const f of fixtures) {
    if (!byStage[f.stage]) byStage[f.stage] = [];
    byStage[f.stage].push(f);
  }

  const toggleStage = (stage: string) =>
    setExpandedStages((s) => ({ ...s, [stage]: !s[stage] }));

  // Check if a stage's fixtures are all placeholder names (teams not yet assigned)
  const hasPlaceholders = (stageFixtures: FixtureSimState[]) =>
    stageFixtures.some(f =>
      f.home_team.toLowerCase().includes('placeholder') ||
      f.home_team.toLowerCase().includes('winner') ||
      f.home_team.toLowerCase().includes('tbd') ||
      f.home_team.toLowerCase().includes('3rd place')
    );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <FlaskConical size={24} className="text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-textMain">Tournament Simulation</h1>
            <p className="text-sm text-textMuted">
              Simulate match results to test scoring, then advance teams through each stage.
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => recalcMutation.mutate()}
          isLoading={recalcMutation.isPending}
          disabled={recalcMutation.isPending}
          title="Recompute all user points from the ledger and sync leaderboards"
        >
          <RefreshCw size={14} />
          Recalculate Points
        </Button>
      </div>

      {notification && (
        <div className={`px-4 py-3 rounded-lg text-sm font-medium ${
          notification.type === 'success'
            ? 'bg-green-500/20 text-green-300 border border-green-500/30'
            : 'bg-red-500/20 text-red-300 border border-red-500/30'
        }`}>
          {notification.msg}
        </div>
      )}

      {isLoading && <Card className="p-8 text-center text-textMuted">Loading fixtures…</Card>}

      {!isLoading && STAGE_ORDER.filter((s) => byStage[s]?.length).map((stage) => {
        const stageFixtures = byStage[stage];
        const isOpen = expandedStages[stage] ?? false;
        const doneCnt = stageFixtures.filter((f) => f.status === 'completed').length;
        const allDone = doneCnt === stageFixtures.length;
        const isGroupStage = stage === 'group';
        const isKoStage = !isGroupStage;
        const teamsArePlaceholders = hasPlaceholders(stageFixtures);
        const prevStageKey = Object.keys(ADVANCE_TARGETS).find(k => ADVANCE_TARGETS[k] === stage);
        const prevStageDone = prevStageKey
          ? (byStage[prevStageKey] ?? []).every(f => f.status === 'completed')
          : true;

        // Reset stage: only allowed when this stage has completed fixtures and NO later stage does
        const stageIdx = STAGE_ORDER.indexOf(stage);
        const laterStagesHaveCompleted = STAGE_ORDER.slice(stageIdx + 1).some(
          s => (byStage[s] ?? []).some(f => f.status === 'completed')
        );
        const canResetStage = doneCnt > 0 && !laterStagesHaveCompleted;

        const stageBadges = (
          <>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${allDone ? 'bg-success/20 text-success' : 'bg-white/10 text-textMuted'}`}>
              {doneCnt}/{stageFixtures.length}
            </span>
            {allDone && <Badge variant="success" className="text-xs">Complete</Badge>}
          </>
        );

        const stageActions = (
          <>
            {canResetStage && (
              <Button
                size="sm"
                variant="danger"
                onClick={(e) => { e.stopPropagation(); resetStageMutation.mutate(stage); }}
                disabled={isPending}
                className="flex items-center gap-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20"
              >
                <Trash2 size={12} /> Reset Stage
              </Button>
            )}

            {isKoStage && prevStageKey && prevStageDone && teamsArePlaceholders && (
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => { e.stopPropagation(); advanceStageMutation.mutate(prevStageKey); }}
                disabled={isPending}
                className="flex items-center gap-1.5 text-xs text-amber-400 border-amber-500/30 hover:border-amber-500/50"
              >
                <ArrowRight size={12} /> Populate {STAGE_LABELS[stage]} Teams
              </Button>
            )}

            {!allDone && !teamsArePlaceholders && (stage !== 'third_place' || (byStage['semi_final'] ?? []).every(f => f.status === 'completed')) && (
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isGroupStage) {
                    Object.keys(
                      stageFixtures.reduce((acc, f) => ({ ...acc, [f.group_code ?? '?']: true }), {} as Record<string, boolean>)
                    ).forEach(gc => completeGroupMutation.mutate(gc));
                  } else {
                    completeKoStageMutation.mutate(stage);
                  }
                }}
                disabled={isPending}
                className="flex items-center gap-1.5 text-xs"
              >
                <Shuffle size={12} /> Complete All (random)
              </Button>
            )}

            {stage === 'semi_final' && allDone && [...(byStage['final'] ?? []), ...(byStage['third_place'] ?? [])].some(f => hasPlaceholders([f])) && (
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => { e.stopPropagation(); advanceStageMutation.mutate('semi_final'); }}
                disabled={isPending}
                className="flex items-center gap-1.5 text-xs text-amber-400 border-amber-500/30"
              >
                <ArrowRight size={12} /> Populate Final & 3rd Place
              </Button>
            )}
          </>
        );

        return (
          <CollapsibleSection
            key={stage}
            title={STAGE_LABELS[stage] ?? stage}
            badges={stageBadges}
            headerActions={stageActions}
            isOpen={isOpen}
            onToggle={() => toggleStage(stage)}
          >
              <>
                {isKoStage && teamsArePlaceholders && (
                  <div className="mb-3 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400">
                    ⚠️ Teams not yet assigned — click "Populate {STAGE_LABELS[stage]} Teams" above after completing the previous stage.
                  </div>
                )}

                {stage === 'group' ? (
                  (() => {
                    const byGroup: Record<string, FixtureSimState[]> = {};
                    for (const f of stageFixtures) {
                      const g = f.group_code ?? '?';
                      if (!byGroup[g]) byGroup[g] = [];
                      byGroup[g].push(f);
                    }
                    return Object.keys(byGroup).sort().map((gc) => (
                      <GroupSection
                        key={gc}
                        groupCode={gc}
                        fixtures={byGroup[gc]}
                        onSetResult={(id, payload) => setResultMutation.mutate({ id, payload })}
                        onReset={(id) => resetMutation.mutate(id)}
                        onCompleteGroup={(gc) => completeGroupMutation.mutate(gc)}
                        isPending={isPending}
                      />
                    ));
                  })()
                ) : (
                  stageFixtures.map((f) => (
                    <FixtureRow
                      key={f.id}
                      fixture={f}
                      onSetResult={(id, payload) => setResultMutation.mutate({ id, payload })}
                      onReset={(id) => resetMutation.mutate(id)}
                      isPending={isPending}
                    />
                  ))
                )}
              </>
          </CollapsibleSection>
        );
      })}
    </div>
  );
};
