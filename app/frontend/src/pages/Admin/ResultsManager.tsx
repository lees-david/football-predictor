import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { CollapsibleSection } from '../../components/ui/CollapsibleSection';
import { apiClient } from '../../api/client';
import { useTournamentContext } from '../../api/TournamentContext';
import { ClipboardList, RotateCcw, Save, ArrowRight, RefreshCw } from 'lucide-react';

interface FixtureState {
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
  result_status: 'live' | 'completed';
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

// Stages where the "Advance" button (populate teams from prior stage) is relevant
const ADVANCE_FROM: Record<string, string> = {
  round_32: 'group',
  round_16: 'round_32',
  quarter_final: 'round_16',
  semi_final: 'quarter_final',
  final: 'semi_final',
  third_place: 'semi_final',
};

function statusVariant(status: string): 'success' | 'live' | 'scheduled' {
  if (status === 'completed') return 'success';
  if (status === 'live') return 'live';
  return 'scheduled';
}

const KO_STAGES = new Set(['round_32', 'round_16', 'quarter_final', 'semi_final', 'third_place', 'final']);

// ---------------------------------------------------------------------------
// FixtureRow
// ---------------------------------------------------------------------------

interface FixtureRowProps {
  fixture: FixtureState;
  onSetResult: (id: number, payload: SetResultPayload) => void;
  onSetTeams: (id: number, homeTeam: string, awayTeam: string) => void;
  onReset: (id: number) => void;
  isPending: boolean;
}

const FixtureRow: React.FC<FixtureRowProps> = ({ fixture, onSetResult, onSetTeams, onReset, isPending }) => {
  const [homeTeam, setHomeTeam] = useState(fixture.home_team);
  const [awayTeam, setAwayTeam] = useState(fixture.away_team);
  const [home, setHome] = useState<string>(fixture.home_score?.toString() ?? '');
  const [away, setAway] = useState<string>(fixture.away_score?.toString() ?? '');
  const [homeAet, setHomeAet] = useState<string>(fixture.home_score_aet?.toString() ?? '');
  const [awayAet, setAwayAet] = useState<string>(fixture.away_score_aet?.toString() ?? '');
  const [pensWinner, setPensWinner] = useState<'home' | 'away' | ''>(
    fixture.knockout_winner
      ? fixture.knockout_winner === fixture.home_team ? 'home' : 'away'
      : ''
  );
  const [resultStatus, setResultStatus] = useState<'live' | 'completed'>(
    fixture.status === 'completed' ? 'completed' : 'live'
  );

  useEffect(() => {
    setHomeTeam(fixture.home_team);
    setAwayTeam(fixture.away_team);
    setHome(fixture.home_score?.toString() ?? '');
    setAway(fixture.away_score?.toString() ?? '');
    setHomeAet(fixture.home_score_aet?.toString() ?? '');
    setAwayAet(fixture.away_score_aet?.toString() ?? '');
    setPensWinner(
      fixture.knockout_winner
        ? fixture.knockout_winner === fixture.home_team ? 'home' : 'away'
        : ''
    );
    setResultStatus(fixture.status === 'completed' ? 'completed' : 'live');
  }, [fixture.home_score, fixture.away_score, fixture.home_score_aet, fixture.away_score_aet,
    fixture.knockout_winner, fixture.home_team, fixture.away_team, fixture.status]);

  const isKo = KO_STAGES.has(fixture.stage);
  const homeFt = home !== '' ? parseInt(home) : null;
  const awayFt = away !== '' ? parseInt(away) : null;
  const ftDraw = homeFt !== null && awayFt !== null && homeFt === awayFt;
  const homeAetVal = homeAet !== '' ? parseInt(homeAet) : null;
  const awayAetVal = awayAet !== '' ? parseInt(awayAet) : null;
  const aetSet = homeAetVal !== null && awayAetVal !== null;
  const aetDraw = aetSet && homeAetVal === awayAetVal;

  const teamsChanged = homeTeam !== fixture.home_team || awayTeam !== fixture.away_team;
  const scoreChanged =
    home !== (fixture.home_score?.toString() ?? '') ||
    away !== (fixture.away_score?.toString() ?? '') ||
    homeAet !== (fixture.home_score_aet?.toString() ?? '') ||
    awayAet !== (fixture.away_score_aet?.toString() ?? '');

  const inputClass =
    'w-10 text-center bg-slate-800 border border-white/10 rounded px-1 py-1 text-white text-sm focus:outline-none focus:border-primary';
  const teamInputClass =
    'bg-slate-800 border border-white/10 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-primary w-24 text-right truncate';
  const teamInputClassAway =
    'bg-slate-800 border border-white/10 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-primary w-24 truncate';

  const handleSaveScore = () => {
    if (homeFt === null || awayFt === null) return;
    const payload: SetResultPayload = {
      home_score: homeFt,
      away_score: awayFt,
      result_status: resultStatus,
    };
    if (isKo && aetSet) {
      payload.home_score_aet = homeAetVal!;
      payload.away_score_aet = awayAetVal!;
    }
    if (isKo && aetDraw && pensWinner) {
      payload.knockout_winner = pensWinner === 'home' ? fixture.home_team : fixture.away_team;
    }
    onSetResult(fixture.id, payload);
  };

  const handleSaveTeams = () => {
    onSetTeams(fixture.id, homeTeam.trim(), awayTeam.trim());
  };

  return (
    <div className="py-2 px-3 rounded-lg hover:bg-white/5 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Home team */}
        {isKo ? (
          <input
            value={homeTeam}
            onChange={(e) => setHomeTeam(e.target.value)}
            className={teamInputClass}
            placeholder="Home team"
          />
        ) : (
          <span className="text-sm text-textMain truncate text-right w-24">{fixture.home_team}</span>
        )}

        {/* FT score */}
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[9px] text-textMuted uppercase tracking-wider">FT</span>
          <div className="flex items-center gap-1">
            <input type="number" min={0} max={20} value={home}
              onChange={(e) => setHome(e.target.value)}
              placeholder="–" className={inputClass} />
            <span className="text-textMuted text-xs">–</span>
            <input type="number" min={0} max={20} value={away}
              onChange={(e) => setAway(e.target.value)}
              placeholder="–" className={inputClass} />
          </div>
        </div>

        {/* AET — KO only, enabled when FT is a draw */}
        {isKo && (
          <div className="flex flex-col items-center gap-0.5 ml-1">
            <span className={`text-[9px] uppercase tracking-wider ${ftDraw ? 'text-amber-400/70' : 'text-textMuted/30'}`}>AET</span>
            <div className="flex items-center gap-1">
              <input type="number" min={0} max={20} value={homeAet}
                onChange={(e) => setHomeAet(e.target.value)}
                placeholder="–" className={inputClass} disabled={!ftDraw} />
              <span className="text-textMuted text-xs">–</span>
              <input type="number" min={0} max={20} value={awayAet}
                onChange={(e) => setAwayAet(e.target.value)}
                placeholder="–" className={inputClass} disabled={!ftDraw} />
            </div>
          </div>
        )}

        {/* Pens — KO only, enabled when AET is a draw */}
        {isKo && (
          <div className="flex flex-col items-center gap-0.5 ml-1">
            <span className={`text-[9px] uppercase tracking-wider ${aetDraw ? 'text-blue-400/70' : 'text-textMuted/30'}`}>Pens</span>
            <select
              value={pensWinner}
              onChange={(e) => setPensWinner(e.target.value as 'home' | 'away' | '')}
              disabled={!aetDraw}
              className="bg-slate-800 border border-white/10 rounded px-1.5 py-1 text-white text-xs focus:outline-none focus:border-primary disabled:opacity-30 w-20"
            >
              <option value="">–</option>
              <option value="home">{homeTeam.length > 12 ? homeTeam.slice(0, 11) + '…' : homeTeam}</option>
              <option value="away">{awayTeam.length > 12 ? awayTeam.slice(0, 11) + '…' : awayTeam}</option>
            </select>
          </div>
        )}

        {/* Away team */}
        {isKo ? (
          <input
            value={awayTeam}
            onChange={(e) => setAwayTeam(e.target.value)}
            className={teamInputClassAway}
            placeholder="Away team"
          />
        ) : (
          <span className="text-sm text-textMain w-24 ml-1">{fixture.away_team}</span>
        )}

        {/* Status selector */}
        <select
          value={resultStatus}
          onChange={(e) => setResultStatus(e.target.value as 'live' | 'completed')}
          className="bg-slate-800 border border-white/10 rounded px-1.5 py-1 text-white text-xs focus:outline-none focus:border-primary ml-1"
        >
          <option value="live">Live</option>
          <option value="completed">Completed</option>
        </select>

        <Badge variant={statusVariant(fixture.status)} className="w-24 justify-center text-xs shrink-0">
          {fixture.status}
        </Badge>

        {/* Actions */}
        <div className="flex gap-1.5 shrink-0 ml-auto">
          {isKo && teamsChanged && (
            <Button size="sm" variant="secondary" onClick={handleSaveTeams}
              disabled={isPending || !homeTeam.trim() || !awayTeam.trim()}
              className="flex items-center gap-1 text-xs text-amber-400 border-amber-500/30">
              <Save size={11} /> Teams
            </Button>
          )}
          {(home !== '' && away !== '') && (
            <Button size="sm" variant="primary" onClick={handleSaveScore}
              disabled={isPending}
              className={`flex items-center gap-1 text-xs ${scoreChanged ? 'ring-1 ring-primary/40' : ''}`}>
              <Save size={11} /> {fixture.status === 'completed' && scoreChanged ? 'Correct' : 'Save'}
            </Button>
          )}
          {fixture.status === 'completed' && (
            <Button size="sm" variant="secondary" onClick={() => onReset(fixture.id)}
              disabled={isPending}
              className="flex items-center gap-1 text-xs text-textMuted hover:text-white">
              <RotateCcw size={11} /> Reset
            </Button>
          )}
        </div>
      </div>

      {fixture.status === 'completed' && scoreChanged && (
        <div className="mt-1 ml-1 text-[10px] text-amber-400/80">
          Saving will reverse existing points and regrade with the new score.
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// GroupSection
// ---------------------------------------------------------------------------

interface GroupSectionProps {
  groupCode: string;
  fixtures: FixtureState[];
  onSetResult: (id: number, payload: SetResultPayload) => void;
  onSetTeams: (id: number, h: string, a: string) => void;
  onReset: (id: number) => void;
  isPending: boolean;
}

const GroupSection: React.FC<GroupSectionProps> = ({ groupCode, fixtures, onSetResult, onSetTeams, onReset, isPending }) => {
  const [open, setOpen] = useState(false);
  const doneCnt = fixtures.filter((f) => f.status === 'completed').length;
  const allDone = doneCnt === fixtures.length;

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
          <FixtureRow key={f.id} fixture={f} onSetResult={onSetResult} onSetTeams={onSetTeams} onReset={onReset} isPending={isPending} />
        ))}
      </CollapsibleSection>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ResultsManager page
// ---------------------------------------------------------------------------

function hasPlaceholders(fixtures: FixtureState[]) {
  return fixtures.some(f =>
    f.home_team.toLowerCase().includes('winner') ||
    f.home_team.toLowerCase().includes('tbd') ||
    f.home_team.toLowerCase().includes('placeholder')
  );
}

export const ResultsManager: React.FC = () => {
  const queryClient = useQueryClient();
  const { selectedTournament } = useTournamentContext();
  const tournamentId = selectedTournament?.id ?? 1;

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});

  const notify = (type: 'success' | 'error', msg: string) => {
    setNotification({ type, msg });
    setTimeout(() => setNotification(null), 6000);
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['result-fixtures', tournamentId] });

  const { data: fixtures = [], isLoading } = useQuery<FixtureState[]>({
    queryKey: ['result-fixtures', tournamentId],
    queryFn: () => apiClient.get(`/admin/results/fixtures?tournament_id=${tournamentId}`).then((r) => r.data),
  });

  const setResultMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: SetResultPayload }) =>
      apiClient.post(`/admin/results/fixture/${id}/result`, payload),
    onSuccess: (res) => {
      invalidate();
      const d = res.data;
      const correction = d.was_correction ? ' (points reversed and regraded)' : '';
      const grading = d.grading_dispatched ? ' — grading dispatched' : '';
      notify('success', `Result saved${correction}${grading}`);
    },
    onError: () => notify('error', 'Failed to save result'),
  });

  const setTeamsMutation = useMutation({
    mutationFn: ({ id, homeTeam, awayTeam }: { id: number; homeTeam: string; awayTeam: string }) =>
      apiClient.post(`/admin/results/fixture/${id}/teams`, { home_team: homeTeam, away_team: awayTeam }),
    onSuccess: (res) => {
      invalidate();
      const d = res.data;
      notify('success', d.was_correction ? 'Teams updated — points reversed and regraded' : 'Teams updated');
    },
    onError: () => notify('error', 'Failed to update teams'),
  });

  const resetMutation = useMutation({
    mutationFn: (id: number) => apiClient.post(`/admin/simulate/fixture/${id}/reset`),
    onSuccess: () => { invalidate(); notify('success', 'Fixture reset — points reversed'); },
    onError: () => notify('error', 'Failed to reset fixture'),
  });

  const advanceStageMutation = useMutation({
    mutationFn: (stage: string) =>
      apiClient.post(`/admin/simulate/stage/${stage}/advance?tournament_id=${tournamentId}`),
    onSuccess: (_, stage) => {
      invalidate();
      notify('success', `Teams populated from ${STAGE_LABELS[stage] ?? stage} results`);
    },
    onError: (err: any) =>
      notify('error', err?.response?.data?.detail ?? 'Failed to populate teams'),
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
    setResultMutation.isPending || setTeamsMutation.isPending ||
    resetMutation.isPending || advanceStageMutation.isPending || recalcMutation.isPending;

  const byStage: Record<string, FixtureState[]> = {};
  for (const f of fixtures) {
    if (!byStage[f.stage]) byStage[f.stage] = [];
    byStage[f.stage].push(f);
  }

  const toggleStage = (stage: string) =>
    setExpandedStages((s) => ({ ...s, [stage]: !s[stage] }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClipboardList size={24} className="text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-textMain">Results Manager</h1>
            <p className="text-sm text-textMuted">
              Manually enter or correct match scores when the scraper fails. Saving a completed
              fixture automatically reverses old points and regrades.
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
        const isKoStage = stage !== 'group';
        const teamsArePlaceholders = isKoStage && hasPlaceholders(stageFixtures);

        // "Populate Teams" button: show when this is a KO stage with placeholders
        // and the feeding stage (from ADVANCE_FROM) is fully completed
        const feedingStage = ADVANCE_FROM[stage];
        const feedingFixtures = feedingStage ? (byStage[feedingStage] ?? []) : [];
        // For final/third_place both feed from semi_final — avoid showing it twice
        const showPopulate =
          isKoStage && teamsArePlaceholders && feedingStage &&
          feedingFixtures.length > 0 &&
          feedingFixtures.every(f => f.status === 'completed') &&
          stage !== 'third_place'; // handled together with final via semi_final button

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
            {showPopulate && (
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => { e.stopPropagation(); advanceStageMutation.mutate(feedingStage); }}
                disabled={isPending}
                className="flex items-center gap-1.5 text-xs text-amber-400 border-amber-500/30 hover:border-amber-500/50"
              >
                <ArrowRight size={12} /> Populate {STAGE_LABELS[stage]} Teams
              </Button>
            )}

            {stage === 'semi_final' && allDone &&
              [...(byStage['final'] ?? []), ...(byStage['third_place'] ?? [])].some(f => hasPlaceholders([f])) && (
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
                    Teams not yet assigned — use the "Populate" button above once the previous stage is complete,
                    or edit team names directly in the rows below.
                  </div>
                )}

                {stage === 'group' ? (
                  (() => {
                    const byGroup: Record<string, FixtureState[]> = {};
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
                        onSetTeams={(id, h, a) => setTeamsMutation.mutate({ id, homeTeam: h, awayTeam: a })}
                        onReset={(id) => resetMutation.mutate(id)}
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
                      onSetTeams={(id, h, a) => setTeamsMutation.mutate({ id, homeTeam: h, awayTeam: a })}
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
