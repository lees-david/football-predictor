import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import {
  Server,
  Database,
  Users,
  Trophy,
  Calendar,
  Target,
  Cpu,
  Clock,
  GitCommit,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Mail,
  Activity,
  Globe,
  XCircle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CeleryTaskInfo {
  name: string;
  schedule: string;
  last_run_at: string | null;
  next_run_at: string | null;
}

interface ScraperStats {
  inserted: number;
  updated: number;
  skipped: number;
  total: number;
  wiki_fixtures_scraped: number;
  score_updates: number;
  merged: number;
}

interface GradingOrphan {
  fixture_id: number;
  fixture_label: string;
  ungraded_predictions: number;
}

interface BuildInfoData {
  git_commit: string | null;
  build_number: string | null;
  build_date: string | null;
  uptime_seconds: number;
  user_count: number;
  active_user_count: number;
  league_count: number;
  tournament_count: number;
  fixture_count: number;
  completed_fixture_count: number;
  prediction_count: number;
  redis_connected: boolean;
  redis_memory_used_mb: number | null;
  celery_last_heartbeat: string | null;
  celery_tasks: CeleryTaskInfo[];
  last_fixture_sync: string | null;
  last_live_poll: string | null;
  grading_orphans: GradingOrphan[];
  last_digest_sent: string | null;
  digest_recipients_last_run: number | null;
  scraper_last_run_at: string | null;
  scraper_last_outcome: 'success' | 'fallback_only' | 'error' | null;
  scraper_last_stats: ScraperStats | null;
  scraper_last_error: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatAbsolute(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
}> = ({ icon, label, value, sub }) => (
  <div className="flex items-start gap-3 p-4 rounded-lg bg-white/5 border border-white/10">
    <div className="text-primary mt-0.5">{icon}</div>
    <div className="min-w-0">
      <p className="text-xs text-textMuted uppercase tracking-wider">{label}</p>
      <p className="text-xl font-bold text-textMain mt-0.5">{value}</p>
      {sub && <p className="text-xs text-textMuted mt-0.5">{sub}</p>}
    </div>
  </div>
);

const SectionTitle: React.FC<{ icon: React.ReactNode; title: string }> = ({ icon, title }) => (
  <div className="flex items-center gap-2 mb-3">
    <span className="text-primary">{icon}</span>
    <h2 className="text-sm font-semibold text-textMuted uppercase tracking-wider">{title}</h2>
  </div>
);

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export const BuildInfo: React.FC = () => {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<BuildInfoData>({
    queryKey: ['admin', 'build-info'],
    queryFn: async () => {
      const res = await apiClient.get('/admin/build-info');
      return res.data;
    },
    staleTime: 30_000,
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-textMain flex items-center gap-2">
            <Server size={24} className="text-primary" />
            Build &amp; System Info
          </h1>
          <p className="text-sm text-textMuted mt-1">Live snapshot of app health and statistics</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-textMuted transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {isLoading && (
        <div className="text-textMuted text-sm">Loading system info…</div>
      )}

      {isError && (
        <div className="text-red-400 text-sm">Failed to load build info.</div>
      )}

      {data && (
        <>
          {/* Build metadata */}
          <Card>
            <div className="p-5">
              <SectionTitle icon={<GitCommit size={16} />} title="Build" />
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                <StatCard
                  icon={<Server size={18} />}
                  label="Build"
                  value={data.build_number ? `#${data.build_number}` : '—'}
                />
                <StatCard
                  icon={<GitCommit size={18} />}
                  label="Commit"
                  value={
                    data.git_commit
                      ? <span className="font-mono text-base">{data.git_commit.slice(0, 8)}</span>
                      : <span className="text-textMuted text-sm">—</span>
                  }
                />
                <StatCard
                  icon={<Calendar size={18} />}
                  label="Build Date"
                  value={data.build_date ? formatAbsolute(data.build_date) : '—'}
                />
                <StatCard
                  icon={<Clock size={18} />}
                  label="Uptime"
                  value={formatUptime(data.uptime_seconds)}
                />
                <StatCard
                  icon={<Activity size={18} />}
                  label="Redis"
                  value={
                    data.redis_connected
                      ? <span className="flex items-center gap-1 text-green-400"><Wifi size={16} /> Connected</span>
                      : <span className="flex items-center gap-1 text-red-400"><WifiOff size={16} /> Down</span>
                  }
                  sub={data.redis_memory_used_mb != null ? `${data.redis_memory_used_mb} MB used` : undefined}
                />
              </div>
            </div>
          </Card>

          {/* Database stats */}
          <Card>
            <div className="p-5">
              <SectionTitle icon={<Database size={16} />} title="Database" />
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard
                  icon={<Users size={18} />}
                  label="Users"
                  value={data.user_count}
                  sub={`${data.active_user_count} active`}
                />
                <StatCard
                  icon={<Trophy size={18} />}
                  label="Leagues"
                  value={data.league_count}
                />
                <StatCard
                  icon={<Trophy size={18} />}
                  label="Tournaments"
                  value={data.tournament_count}
                />
                <StatCard
                  icon={<Calendar size={18} />}
                  label="Fixtures"
                  value={data.fixture_count}
                  sub={`${data.completed_fixture_count} completed`}
                />
                <StatCard
                  icon={<Target size={18} />}
                  label="Predictions"
                  value={data.prediction_count.toLocaleString()}
                />
                <StatCard
                  icon={<Mail size={18} />}
                  label="Last Digest"
                  value={formatRelative(data.last_digest_sent)}
                  sub={
                    data.digest_recipients_last_run != null
                      ? `${data.digest_recipients_last_run} recipients`
                      : undefined
                  }
                />
              </div>
            </div>
          </Card>

          {/* Fixture sync status */}
          <Card>
            <div className="p-5">
              <SectionTitle icon={<RefreshCw size={16} />} title="Fixture Sync" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <StatCard
                  icon={<RefreshCw size={18} />}
                  label="Last Daily Sync"
                  value={formatRelative(data.last_fixture_sync)}
                  sub={formatAbsolute(data.last_fixture_sync)}
                />
                <StatCard
                  icon={<Activity size={18} />}
                  label="Last Live Poll"
                  value={formatRelative(data.last_live_poll)}
                  sub={formatAbsolute(data.last_live_poll)}
                />
              </div>
            </div>
          </Card>

          {/* Celery tasks */}
          <Card>
            <div className="p-5">
              <SectionTitle icon={<Cpu size={16} />} title="Celery Beat Schedule" />
              {data.celery_last_heartbeat && (
                <p className="text-xs text-textMuted mb-3">
                  Worker last heartbeat: <span className="text-textMain">{formatRelative(data.celery_last_heartbeat)}</span>
                  {' '}({formatAbsolute(data.celery_last_heartbeat)})
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-textMuted uppercase tracking-wider border-b border-white/10">
                      <th className="pb-2 pr-4">Task</th>
                      <th className="pb-2 pr-4">Schedule</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.celery_tasks.map((t) => (
                      <tr key={t.name}>
                        <td className="py-2 pr-4 font-mono text-xs text-textMain">{t.name}</td>
                        <td className="py-2 pr-4 text-textMuted">{t.schedule}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          {/* Wikipedia scraper */}
          <Card>
            <div className="p-5">
              <SectionTitle icon={<Globe size={16} />} title="Wikipedia Scraper" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <StatCard
                  icon={<Clock size={18} />}
                  label="Last Run"
                  value={formatRelative(data.scraper_last_run_at)}
                  sub={formatAbsolute(data.scraper_last_run_at)}
                />
                <StatCard
                  icon={
                    data.scraper_last_outcome === 'success' ? <CheckCircle size={18} /> :
                    data.scraper_last_outcome === 'error' ? <XCircle size={18} /> :
                    data.scraper_last_outcome === 'fallback_only' ? <AlertTriangle size={18} /> :
                    <Globe size={18} />
                  }
                  label="Outcome"
                  value={
                    data.scraper_last_outcome === 'success'
                      ? <span className="text-green-400">Wikipedia OK</span>
                      : data.scraper_last_outcome === 'fallback_only'
                      ? <span className="text-amber-400">Fallback catalog</span>
                      : data.scraper_last_outcome === 'error'
                      ? <span className="text-red-400">Scrape error</span>
                      : <span className="text-textMuted">Never run</span>
                  }
                />
                {data.scraper_last_stats && (
                  <StatCard
                    icon={<Activity size={18} />}
                    label="Wikipedia fixtures"
                    value={data.scraper_last_stats.wiki_fixtures_scraped}
                    sub={`${data.scraper_last_stats.score_updates} scores found`}
                  />
                )}
              </div>
              {data.scraper_last_stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard icon={<Target size={18} />} label="Total fixtures" value={data.scraper_last_stats.total} />
                  <StatCard icon={<CheckCircle size={18} />} label="Inserted" value={data.scraper_last_stats.inserted} />
                  <StatCard icon={<RefreshCw size={18} />} label="Updated" value={data.scraper_last_stats.updated} />
                  <StatCard icon={<AlertTriangle size={18} />} label="Skipped (errors)" value={data.scraper_last_stats.skipped} />
                </div>
              )}
              {data.scraper_last_error && (
                <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-xs text-red-400 font-mono break-all">{data.scraper_last_error}</p>
                </div>
              )}
              {!data.scraper_last_run_at && (
                <p className="text-sm text-textMuted">No scrape has run since container start. Trigger a reset/reseed from Manage Tournaments to populate this.</p>
              )}
            </div>
          </Card>

          {/* Grading health */}
          <Card>
            <div className="p-5">
              <SectionTitle icon={<AlertTriangle size={16} />} title="Grading Pipeline Health" />
              {data.grading_orphans.length === 0 ? (
                <div className="flex items-center gap-2 text-green-400 text-sm">
                  <CheckCircle size={16} />
                  All completed fixtures are graded. No orphaned predictions.
                </div>
              ) : (
                <>
                  <p className="text-xs text-amber-400 mb-3">
                    {data.grading_orphans.length} fixture(s) are marked completed but have predictions with 0 points — grading may have stalled.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-textMuted uppercase tracking-wider border-b border-white/10">
                          <th className="pb-2 pr-4">Fixture ID</th>
                          <th className="pb-2 pr-4">Match</th>
                          <th className="pb-2">Ungraded Predictions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {data.grading_orphans.map((o) => (
                          <tr key={o.fixture_id}>
                            <td className="py-2 pr-4 font-mono text-xs text-textMuted">#{o.fixture_id}</td>
                            <td className="py-2 pr-4 text-textMain">{o.fixture_label}</td>
                            <td className="py-2">
                              <Badge variant="scheduled">{o.ungraded_predictions}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
