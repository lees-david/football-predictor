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

const TH: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <th className="pb-2 pr-4 text-left text-xs text-textMuted uppercase tracking-wider">{children}</th>
);

const TD: React.FC<{ children: React.ReactNode; mono?: boolean }> = ({ children, mono }) => (
  <td className={`py-2 pr-4 text-sm ${mono ? 'font-mono text-xs' : ''} text-textMain`}>{children}</td>
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
      <div className="flex items-center justify-between">
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
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-white/10">
                        <TH>Fixture</TH>
                        <TH>Result</TH>
                        <TH>KO Winner</TH>
                        <TH>User</TH>
                        <TH>Prediction</TH>
                        <TH>Stored Pts</TH>
                        <TH>Expected Pts</TH>
                        <TH>Delta</TH>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.score_mismatches.map(r => (
                        <tr key={r.pred_id}>
                          <TD>{r.fixture}</TD>
                          <TD mono>{r.result}</TD>
                          <TD>{r.knockout_winner ?? '—'}</TD>
                          <TD>{r.display_name}</TD>
                          <TD mono>{r.prediction}</TD>
                          <TD>{r.stored_pts}</TD>
                          <TD>{r.expected_pts}</TD>
                          <td className={`py-2 pr-4 text-sm font-bold ${r.delta > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                            {r.delta > 0 ? '+' : ''}{r.delta}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-white/10">
                        <TH>ID</TH><TH>Fixture</TH><TH>Stage</TH><TH>Result</TH><TH>Ungraded</TH>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.grading_orphans.map(r => (
                        <tr key={r.fixture_id}>
                          <TD mono>#{r.fixture_id}</TD>
                          <TD>{r.fixture}</TD>
                          <TD>{stageLabel(r.stage)}</TD>
                          <TD mono>{r.result}</TD>
                          <td className="py-2 pr-4 text-sm font-bold text-red-400">{r.ungraded_predictions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-white/10">
                        <TH>User</TH><TH>Stored Total</TH><TH>Ledger Sum</TH><TH>Drift</TH>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.total_points_drift.map(r => (
                        <tr key={r.user_id}>
                          <TD>{r.display_name}</TD>
                          <TD>{r.stored_total}</TD>
                          <TD>{r.ledger_sum}</TD>
                          <td className={`py-2 pr-4 text-sm font-bold ${r.drift > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                            {r.drift > 0 ? '+' : ''}{r.drift}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-white/10">
                        <TH>User</TH><TH>Source Type</TH><TH>Source ID</TH><TH>Occurrences</TH><TH>Total Pts</TH>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.double_grading.map((r, i) => (
                        <tr key={i}>
                          <TD>{r.display_name}</TD>
                          <TD mono>{r.source_type}</TD>
                          <TD mono>{r.source_id}</TD>
                          <td className="py-2 pr-4 text-sm font-bold text-red-400">{r.entry_count}</td>
                          <TD>{r.total_pts_in_dupes}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-white/10">
                        <TH>Fixture</TH><TH>Stage</TH><TH>Prediction Table Pts</TH><TH>Ledger Pts</TH><TH>Delta</TH>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.fixture_ledger_mismatch.map(r => (
                        <tr key={r.fixture_id}>
                          <TD>{r.fixture}</TD>
                          <TD>{stageLabel(r.stage)}</TD>
                          <TD>{r.prediction_table_pts}</TD>
                          <TD>{r.ledger_pts}</TD>
                          <td className={`py-2 pr-4 text-sm font-bold ${r.delta > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                            {r.delta > 0 ? '+' : ''}{r.delta}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-white/10">
                        <TH>Stage</TH><TH>Completed Fixtures</TH><TH>Users with Bracket</TH><TH>Users Graded</TH><TH>Status</TH><TH></TH>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.ko_coverage.map((r, i) => {
                        const ok = r.users_with_bracket === 0 || r.bracket_graded;
                        const busy = regradeKo.isPending && regradeKo.variables === r.stage;
                        return (
                          <tr key={i}>
                            <TD>{stageLabel(r.stage)}</TD>
                            <TD>{r.completed_fixtures}</TD>
                            <TD>{r.users_with_bracket}</TD>
                            <TD>{r.users_with_ko_ledger_entry}</TD>
                            <td className="py-2 text-sm">
                              {ok
                                ? <span className="text-green-400 flex items-center gap-1"><CheckCircle size={13} /> OK</span>
                                : <span className="text-red-400 flex items-center gap-1"><XCircle size={13} /> Not graded</span>}
                            </td>
                            <td className="py-2 text-sm">
                              {!ok && (
                                <button
                                  disabled={busy}
                                  onClick={() => regradeKo.mutate(r.stage)}
                                  className="px-2 py-1 rounded text-xs bg-primary/20 hover:bg-primary/30 text-primary disabled:opacity-50 transition-colors"
                                >
                                  {busy ? 'Running…' : 'Re-grade'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
                  Fully completed groups — were bracket picks graded? A "NO" here usually means the Redis idempotency
                  guard fired before grading ran.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-white/10">
                        <TH>Group</TH><TH>Fixtures</TH><TH>Bracket Graded</TH><TH></TH>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.group_coverage.map(r => {
                        const busy = regradeGroup.isPending && regradeGroup.variables === r.group_code;
                        return (
                        <tr key={r.group_code}>
                          <TD>Group {r.group_code}</TD>
                          <TD>{r.completed}/{r.total_fixtures}</TD>
                          <td className="py-2 text-sm">
                            {r.bracket_graded
                              ? <span className="text-green-400 flex items-center gap-1"><CheckCircle size={13} /> Yes</span>
                              : <span className="text-red-400 flex items-center gap-1"><XCircle size={13} /> No — possible miss</span>}
                          </td>
                          <td className="py-2 text-sm">
                            {!r.bracket_graded && (
                              <button
                                disabled={busy}
                                onClick={() => regradeGroup.mutate(r.group_code)}
                                className="px-2 py-1 rounded text-xs bg-primary/20 hover:bg-primary/30 text-primary disabled:opacity-50 transition-colors"
                              >
                                {busy ? 'Running…' : 'Re-grade'}
                              </button>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-white/10">
                        <TH>ID</TH><TH>Fixture</TH><TH>Stage</TH>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.null_score_completed.map(r => (
                        <tr key={r.fixture_id}>
                          <TD mono>#{r.fixture_id}</TD>
                          <TD>{r.fixture}</TD>
                          <TD>{stageLabel(r.stage)}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                <span className="ml-2 text-amber-400">Amber</span> = stored total doesn't match ledger sum.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-white/10">
                      <TH>User</TH>
                      <TH>Match Pts</TH>
                      <TH>Group Bracket</TH>
                      <TH>KO Bracket</TH>
                      <TH>Ledger Total</TH>
                      <TH>Stored Total</TH>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.user_breakdown.map(r => {
                      const drifted = r.stored_total !== r.ledger_total;
                      return (
                        <tr key={r.user_id} className={drifted ? 'bg-amber-500/5' : ''}>
                          <TD>{r.display_name}</TD>
                          <TD>{r.match_pts}</TD>
                          <TD>{r.group_bracket_pts}</TD>
                          <TD>{r.ko_bracket_pts}</TD>
                          <TD>{r.ledger_total}</TD>
                          <td className={`py-2 pr-4 text-sm font-bold ${drifted ? 'text-amber-400' : 'text-textMain'}`}>
                            {r.stored_total}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
