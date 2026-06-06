import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { Card } from '../../components/ui/Card';
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ShieldCheck,
  Users,
  Target,
  BarChart2,
  GitBranch,
  Database,
  ClipboardList,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScoreMismatch {
  pred_id: number;
  fixture_id: number;
  fixture: string;
  result: string;
  knockout_winner: string | null;
  display_name: string;
  prediction: string;
  stored_pts: number;
  expected_pts: number;
  delta: number;
}

interface GradingOrphan {
  fixture_id: number;
  fixture: string;
  stage: string;
  result: string;
  ungraded_predictions: number;
}

interface TotalPointsDrift {
  user_id: number;
  display_name: string;
  stored_total: number;
  ledger_sum: number;
  drift: number;
}

interface DoubleGrading {
  user_id: number;
  display_name: string;
  source_type: string;
  source_id: string;
  entry_count: number;
  total_pts_in_dupes: number;
}

interface FixtureLedgerMismatch {
  fixture_id: number;
  fixture: string;
  stage: string;
  prediction_table_pts: number;
  ledger_pts: number;
  delta: number;
}

interface UserBreakdown {
  user_id: number;
  display_name: string;
  stored_total: number;
  match_pts: number;
  group_bracket_pts: number;
  ko_bracket_pts: number;
  ledger_total: number;
}

interface KoCoverage {
  stage: string;
  tournament_id: number;
  completed_fixtures: number;
  users_with_bracket: number;
  users_with_ko_ledger_entry: number;
  bracket_graded: boolean;
}

interface GroupCoverage {
  tournament_id: number;
  group_code: string;
  total_fixtures: number;
  completed: number;
  bracket_graded: boolean;
}

interface NullScoreFixture {
  fixture_id: number;
  fixture: string;
  stage: string;
  status: string;
}

interface AuditSummary {
  completed_fixtures: number;
  graded_predictions: number;
  ungraded_predictions_on_completed: number;
  match_ledger_rows: number;
  group_bracket_ledger_rows: number;
  ko_bracket_ledger_rows: number;
  active_users: number;
  total_pts_across_all_users: number;
}

interface AuditReport {
  tournament_id: number;
  summary: AuditSummary;
  score_mismatches: ScoreMismatch[];
  grading_orphans: GradingOrphan[];
  total_points_drift: TotalPointsDrift[];
  double_grading: DoubleGrading[];
  fixture_ledger_mismatch: FixtureLedgerMismatch[];
  user_breakdown: UserBreakdown[];
  ko_coverage: KoCoverage[];
  group_coverage: GroupCoverage[];
  null_score_completed: NullScoreFixture[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PassBadge: React.FC<{ count: number; label?: string }> = ({ count, label }) =>
  count === 0 ? (
    <span className="inline-flex items-center gap-1 text-green-400 text-xs font-semibold">
      <CheckCircle size={13} /> {label ?? 'OK'}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-red-400 text-xs font-semibold">
      <XCircle size={13} /> {count} issue{count !== 1 ? 's' : ''}
    </span>
  );

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  issueCount: number;
  children?: React.ReactNode;
}> = ({ icon, title, issueCount, children }) => (
  <div className="flex items-center justify-between mb-3">
    <div className="flex items-center gap-2">
      <span className="text-primary">{icon}</span>
      <h2 className="text-sm font-semibold text-textMuted uppercase tracking-wider">{title}</h2>
    </div>
    <div className="flex items-center gap-3">
      {children}
      <PassBadge count={issueCount} />
    </div>
  </div>
);

function stageLabel(s: string) {
  const map: Record<string, string> = {
    group: 'Group',
    round_32: 'R32',
    round_16: 'R16',
    quarter_final: 'QF',
    semi_final: 'SF',
    third_place: '3rd',
    final: 'Final',
  };
  return map[s] ?? s;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export const AuditPage: React.FC = () => {
  const [tournamentId, setTournamentId] = useState(1);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<AuditReport>({
    queryKey: ['admin', 'audit', tournamentId],
    queryFn: async () => {
      const res = await apiClient.get('/admin/audit', { params: { tournament_id: tournamentId } });
      return res.data;
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const totalIssues = data
    ? data.score_mismatches.length +
      data.grading_orphans.length +
      data.total_points_drift.length +
      data.double_grading.length +
      data.fixture_ledger_mismatch.length +
      data.null_score_completed.length +
      data.ko_coverage.filter(r => r.users_with_bracket > 0 && !r.bracket_graded).length +
      data.group_coverage.filter(r => !r.bracket_graded).length
    : 0;

  const regradeGroup = useMutation({
    mutationFn: (groupCode: string) =>
      apiClient.post('/admin/audit/regrade/group/' + groupCode, null, {
        params: { tournament_id: tournamentId },
      }),
    onSuccess: () => refetch(),
  });

  const regradeKo = useMutation({
    mutationFn: (stage: string) =>
      apiClient.post('/admin/audit/regrade/ko', null, {
        params: { tournament_id: tournamentId, stage },
      }),
    onSuccess: () => refetch(),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-textMain flex items-center gap-2">
            <ShieldCheck size={24} className="text-primary" />
            Score Integrity Audit
          </h1>
          <p className="text-sm text-textMuted mt-1">
            Read-only checks — verifies every graded score against the expected formula
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-textMuted">Tournament ID</label>
          <input
            type="number"
            min={1}
            value={tournamentId}
            onChange={e => setTournamentId(Number(e.target.value))}
            className="w-16 px-2 py-1 rounded bg-white/5 border border-white/10 text-sm text-textMain text-center"
          />
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-textMuted transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            Run Audit
          </button>
        </div>
      </div>

      {isLoading && <div className="text-textMuted text-sm">Running audit…</div>}
      {isError && <div className="text-red-400 text-sm">Failed to load audit data.</div>}

      {data && (
        <>
          {/* Overall status banner */}
          <div className={`flex items-center gap-3 p-4 rounded-xl border ${
            totalIssues === 0
              ? 'bg-green-500/10 border-green-500/20 text-green-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            {totalIssues === 0
              ? <CheckCircle size={20} />
              : <AlertTriangle size={20} />}
            <span className="font-semibold">
              {totalIssues === 0
                ? 'All checks passed — scoring data is consistent.'
                : `${totalIssues} issue${totalIssues !== 1 ? 's' : ''} found across scoring checks.`}
            </span>
          </div>

          {/* Summary stats */}
          <Card>
            <div className="p-5">
              <SectionHeader icon={<Database size={16} />} title="Summary" issueCount={0} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Completed Fixtures', value: data.summary.completed_fixtures },
                  { label: 'Graded Predictions', value: data.summary.graded_predictions.toLocaleString() },
                  { label: 'Ungraded on Completed', value: data.summary.ungraded_predictions_on_completed },
                  { label: 'Active Users', value: data.summary.active_users },
                  { label: 'Match Ledger Rows', value: data.summary.match_ledger_rows.toLocaleString() },
                  { label: 'Group Bracket Rows', value: data.summary.group_bracket_ledger_rows },
                  { label: 'KO Bracket Rows', value: data.summary.ko_bracket_ledger_rows },
                  { label: 'Total Pts (all users)', value: data.summary.total_pts_across_all_users.toLocaleString() },
                ].map(({ label, value }) => (
                  <div key={label} className="p-3 rounded-lg bg-white/5 border border-white/10">
                    <p className="text-xs text-textMuted uppercase tracking-wider">{label}</p>
                    <p className="text-xl font-bold text-textMain mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* 1. Score mismatches */}
          <Card>
            <div className="p-5">
              <SectionHeader
                icon={<Target size={16} />}
                title="Score Mismatches"
                issueCount={data.score_mismatches.length}
              />
              <p className="text-xs text-textMuted mb-3">
                Predictions where stored <code className="bg-white/10 px-1 rounded">points_awarded</code> differs
                from the expected formula (5=exact, 3=correct GD, 2=correct outcome, 0=wrong).
              </p>
              {data.score_mismatches.length === 0 ? (
                <p className="text-sm text-green-400 flex items-center gap-1"><CheckCircle size={14} /> No mismatches found.</p>
              ) : (
                <div className="space-y-3">
                  {data.score_mismatches.map(r => (
                    <div key={r.pred_id} className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2 text-xs">
                      <div className="flex justify-between items-center font-semibold text-white">
                        <span>{r.fixture}</span>
                        <span className="font-mono text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
                          Delta: {r.delta > 0 ? '+' : ''}{r.delta}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-textMuted">
                        <div>User: <span className="text-white font-medium">{r.display_name}</span></div>
                        <div>Result: <span className="font-mono text-white">{r.result}</span></div>
                        <div>Pred: <span className="font-mono text-white">{r.prediction}</span></div>
                        <div>KO Winner: <span className="text-white">{r.knockout_winner ?? '—'}</span></div>
                        <div>Stored Pts: <span className="text-white font-bold">{r.stored_pts}</span></div>
                        <div>Expected Pts: <span className="text-white font-bold">{r.expected_pts}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* 2. Grading orphans */}
          <Card>
            <div className="p-5">
              <SectionHeader
                icon={<AlertTriangle size={16} />}
                title="Grading Orphans"
                issueCount={data.grading_orphans.length}
              />
              <p className="text-xs text-textMuted mb-3">
                Completed fixtures with at least one prediction still at 0 pts and <code className="bg-white/10 px-1 rounded">is_locked=false</code>.
              </p>
              {data.grading_orphans.length === 0 ? (
                <p className="text-sm text-green-400 flex items-center gap-1"><CheckCircle size={14} /> All completed fixtures are graded.</p>
              ) : (
                <div className="space-y-3">
                  {data.grading_orphans.map(r => (
                    <div key={r.fixture_id} className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-1.5 text-xs">
                      <div className="flex justify-between items-center font-semibold text-white">
                        <span>{r.fixture}</span>
                        <span className="text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full border border-red-400/20 font-semibold">
                          {r.ungraded_predictions} Ungraded
                        </span>
                      </div>
                      <div className="flex justify-between text-textMuted">
                        <span>Stage: {stageLabel(r.stage)} (ID: #{r.fixture_id})</span>
                        <span>Result: <strong className="font-mono text-white">{r.result}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* 3. User total_points drift */}
          <Card>
            <div className="p-5">
              <SectionHeader
                icon={<Users size={16} />}
                title="User Total Points Drift"
                issueCount={data.total_points_drift.length}
              />
              <p className="text-xs text-textMuted mb-3">
                Users where <code className="bg-white/10 px-1 rounded">users.total_points</code> doesn't match
                the sum of their ledger entries. Use <em>Admin → Points Recalculate</em> to fix.
              </p>
              {data.total_points_drift.length === 0 ? (
                <p className="text-sm text-green-400 flex items-center gap-1"><CheckCircle size={14} /> No drift detected.</p>
              ) : (
                <div className="space-y-3">
                  {data.total_points_drift.map(r => (
                    <div key={r.user_id} className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2 text-xs">
                      <div className="flex justify-between items-center font-semibold text-white">
                        <span>{r.display_name}</span>
                        <span className={`px-2 py-0.5 rounded font-mono font-bold ${r.drift > 0 ? 'text-amber-400 bg-amber-500/10' : 'text-red-400 bg-red-500/10'}`}>
                          Drift: {r.drift > 0 ? '+' : ''}{r.drift}
                        </span>
                      </div>
                      <div className="flex justify-between text-textMuted">
                        <span>Stored Total: <strong className="text-white">{r.stored_total}</strong></span>
                        <span>Ledger Sum: <strong className="text-white">{r.ledger_sum}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* 4. Double grading */}
          <Card>
            <div className="p-5">
              <SectionHeader
                icon={<ClipboardList size={16} />}
                title="Double Grading (Duplicate Ledger Entries)"
                issueCount={data.double_grading.length}
              />
              <p className="text-xs text-textMuted mb-3">
                Each <code className="bg-white/10 px-1 rounded">(user, source_type, source_id)</code> should appear once.
                Duplicates mean a fixture or group was graded twice.
              </p>
              {data.double_grading.length === 0 ? (
                <p className="text-sm text-green-400 flex items-center gap-1"><CheckCircle size={14} /> No duplicate entries found.</p>
              ) : (
                <div className="space-y-3">
                  {data.double_grading.map((r, i) => (
                    <div key={i} className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2 text-xs">
                      <div className="flex justify-between items-center font-semibold text-white">
                        <span>{r.display_name}</span>
                        <span className="text-red-400 bg-red-400/10 px-2 py-0.5 rounded font-bold border border-red-500/20">
                          {r.entry_count} Dupes
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-textMuted">
                        <div>Type: <span className="font-mono text-white">{r.source_type}</span></div>
                        <div>Source ID: <span className="font-mono text-white">{r.source_id}</span></div>
                        <div>Total Points in Dupes: <span className="text-white font-bold">{r.total_pts_in_dupes}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* 5. Fixture ledger mismatch */}
          <Card>
            <div className="p-5">
              <SectionHeader
                icon={<Database size={16} />}
                title="Fixture ↔ Ledger Sum Mismatch"
                issueCount={data.fixture_ledger_mismatch.length}
              />
              <p className="text-xs text-textMuted mb-3">
                Per completed fixture: sum of <code className="bg-white/10 px-1 rounded">match_predictions.points_awarded</code> vs
                sum of matching <code className="bg-white/10 px-1 rounded">user_points_ledger</code> rows.
              </p>
              {data.fixture_ledger_mismatch.length === 0 ? (
                <p className="text-sm text-green-400 flex items-center gap-1"><CheckCircle size={14} /> Prediction table and ledger are in sync.</p>
              ) : (
                <div className="space-y-3">
                  {data.fixture_ledger_mismatch.map(r => (
                    <div key={r.fixture_id} className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2 text-xs">
                      <div className="flex justify-between items-center font-semibold text-white">
                        <span>{r.fixture}</span>
                        <span className={`px-2 py-0.5 rounded font-mono font-bold ${r.delta > 0 ? 'text-amber-400 bg-amber-500/10' : 'text-red-400 bg-red-500/10'}`}>
                          Delta: {r.delta > 0 ? '+' : ''}{r.delta}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-textMuted">
                        <div>Stage: <span className="text-white">{stageLabel(r.stage)}</span></div>
                        <div>Fixture Pts: <span className="text-white font-bold">{r.prediction_table_pts}</span></div>
                        <div>Ledger Pts: <span className="text-white font-bold">{r.ledger_pts}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* 6. KO coverage */}
          {data.ko_coverage.length > 0 && (
            <Card>
              <div className="p-5">
                <SectionHeader
                  icon={<GitBranch size={16} />}
                  title="KO Bracket Grading Coverage"
                  issueCount={data.ko_coverage.filter(r => r.users_with_bracket > 0 && !r.bracket_graded).length}
                />
                <p className="text-xs text-textMuted mb-3">
                  For each completed KO stage: how many users with bracket picks received KO bracket points.
                </p>
                <div className="space-y-3">
                  {data.ko_coverage.map((r, i) => {
                    const ok = r.users_with_bracket === 0 || r.bracket_graded;
                    const busy = regradeKo.isPending && regradeKo.variables === r.stage;
                    return (
                      <div key={i} className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-3 text-xs">
                        <div className="flex justify-between items-center font-semibold text-white">
                          <span>{stageLabel(r.stage)} Stage</span>
                          {ok ? (
                            <span className="text-green-400 flex items-center gap-1 text-[11px] font-bold">
                              <CheckCircle size={12} /> OK
                            </span>
                          ) : (
                            <span className="text-red-400 flex items-center gap-1 text-[11px] font-bold">
                              <XCircle size={12} /> Not graded
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-textMuted">
                          <div>Completed Matches: <span className="text-white font-semibold">{r.completed_fixtures}</span></div>
                          <div>Users with Bracket: <span className="text-white font-semibold">{r.users_with_bracket}</span></div>
                          <div>Users Graded: <span className="text-white font-semibold">{r.users_with_ko_ledger_entry}</span></div>
                        </div>
                        {!ok && (
                          <div className="pt-2 border-t border-white/5 flex justify-end">
                            <button
                              disabled={busy}
                              onClick={() => regradeKo.mutate(r.stage)}
                              className="px-3 py-1 rounded bg-primary/20 hover:bg-primary/30 text-primary text-xs font-semibold disabled:opacity-50 transition-colors"
                            >
                              {busy ? 'Running…' : 'Re-grade Stage'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          )}

          {/* 7. Group coverage */}
          {data.group_coverage.length > 0 && (
            <Card>
              <div className="p-5">
                <SectionHeader
                  icon={<BarChart2 size={16} />}
                  title="Group Bracket Grading Coverage"
                  issueCount={data.group_coverage.filter(r => !r.bracket_graded).length}
                />
                <p className="text-xs text-textMuted mb-3">
                  Fully completed groups — were bracket picks graded?
                </p>
                <div className="space-y-3">
                  {data.group_coverage.map(r => {
                    const busy = regradeGroup.isPending && regradeGroup.variables === r.group_code;
                    return (
                      <div key={r.group_code} className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-3 text-xs">
                        <div className="flex justify-between items-center font-semibold text-white">
                          <span>Group {r.group_code}</span>
                          {r.bracket_graded ? (
                            <span className="text-green-400 flex items-center gap-1 text-[11px] font-bold">
                              <CheckCircle size={12} /> Yes
                            </span>
                          ) : (
                            <span className="text-red-400 flex items-center gap-1 text-[11px] font-bold">
                              <XCircle size={12} /> No (Miss)
                            </span>
                          )}
                        </div>
                        <div className="text-textMuted">
                          Completed Matches: <span className="text-white font-semibold">{r.completed}/{r.total_fixtures}</span>
                        </div>
                        {!r.bracket_graded && (
                          <div className="pt-2 border-t border-white/5 flex justify-end">
                            <button
                              disabled={busy}
                              onClick={() => regradeGroup.mutate(r.group_code)}
                              className="px-3 py-1 rounded bg-primary/20 hover:bg-primary/30 text-primary text-xs font-semibold disabled:opacity-50 transition-colors"
                            >
                              {busy ? 'Running…' : 'Re-grade Group'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          )}

          {/* 8. Null score completed */}
          <Card>
            <div className="p-5">
              <SectionHeader
                icon={<AlertTriangle size={16} />}
                title="Completed Fixtures with Missing Scores"
                issueCount={data.null_score_completed.length}
              />
              <p className="text-xs text-textMuted mb-3">
                Fixtures marked <code className="bg-white/10 px-1 rounded">completed</code> but with no home/away score — ungradeable.
              </p>
              {data.null_score_completed.length === 0 ? (
                <p className="text-sm text-green-400 flex items-center gap-1"><CheckCircle size={14} /> No score gaps found.</p>
              ) : (
                <div className="space-y-3">
                  {data.null_score_completed.map(r => (
                    <div key={r.fixture_id} className="p-3 rounded-lg bg-white/5 border border-white/10 flex justify-between items-center text-xs">
                      <div>
                        <div className="font-semibold text-white">{r.fixture}</div>
                        <div className="text-[10px] text-textMuted mt-0.5">Stage: {stageLabel(r.stage)}</div>
                      </div>
                      <span className="font-mono text-red-400 bg-red-400/10 px-2 py-0.5 rounded border border-red-400/20 font-bold">
                        ID #{r.fixture_id}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* 9. Per-user breakdown */}
          <Card>
            <div className="p-5">
              <SectionHeader icon={<Users size={16} />} title="Per-User Score Breakdown" issueCount={0} />
              <p className="text-xs text-textMuted mb-3">
                Points split by source type for all active users.
                <span className="ml-2 text-amber-400 font-semibold">Amber</span> = stored total doesn't match ledger sum.
              </p>
              <div className="space-y-3">
                {data.user_breakdown.map(r => {
                  const drifted = r.stored_total !== r.ledger_total;
                  return (
                    <div
                      key={r.user_id}
                      className={`p-3 rounded-lg border border-white/5 bg-black/35 space-y-2.5 text-xs ${
                        drifted ? 'bg-amber-500/5 border-amber-500/20' : ''
                      }`}
                    >
                      <div className="flex justify-between items-center font-bold text-white">
                        <span>{r.display_name}</span>
                        <span className={`px-2 py-0.5 rounded font-mono font-bold ${drifted ? 'text-amber-400 bg-amber-500/10' : 'text-textMain bg-white/5'}`}>
                          Stored Total: {r.stored_total}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-textMuted border-t border-white/5 pt-2">
                        <div>Matches: <span className="text-white font-semibold">{r.match_pts} pts</span></div>
                        <div>Group Brackets: <span className="text-white font-semibold">{r.group_bracket_pts} pts</span></div>
                        <div>KO Brackets: <span className="text-white font-semibold">{r.ko_bracket_pts} pts</span></div>
                        <div>Ledger Total: <span className="text-white font-semibold">{r.ledger_total} pts</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
