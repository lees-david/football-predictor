import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { apiClient } from '../../api/client';
import { useMe } from '../../api/hooks/useAuth';
import {
  Mail, Settings, FileText, List, ChevronDown, ChevronRight,
  Send, ToggleLeft, ToggleRight, Eye, EyeOff, Users, Radio, BarChart2, RefreshCw,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TournamentInfo { id: number; name: string; email_mode: string; }
interface TournamentSettings {
  tournament_id: number; tournament_name: string;
  email_mode: string; types: Record<string, boolean>;
}
interface LeagueEmailInfo {
  id: number; name: string; tournament_id: number;
  tournament_name: string; emails_enabled: boolean;
}
interface EmailTemplate {
  email_type: string; subject: string; body_html: string; updated_at: string;
}
interface SendEstimate {
  tournament_id: number;
  counts: Record<string, number>;
  multipliers: { rounds: number; days: number };
}
interface LogEntry {
  id: number; created_at: string; email_type: string; to_address: string;
  display_name: string; subject: string; simulated: boolean; status: string;
  sent_at: string | null; body_html: string; tournament_id: number | null;
}

const EMAIL_TYPES = ['welcome', 'round_summary', 'daily_digest'];
const TYPE_LABELS: Record<string, string> = {
  welcome: 'Welcome',
  round_summary: 'Round Summary',
  daily_digest: 'Daily Digest',
};

const TABS = [
  { id: 'config', label: 'Config', icon: <Settings size={16} /> },
  { id: 'types', label: 'Email Types', icon: <ToggleRight size={16} /> },
  { id: 'templates', label: 'Templates', icon: <FileText size={16} /> },
  { id: 'broadcast', label: 'Broadcast', icon: <Radio size={16} /> },
  { id: 'log', label: 'Log', icon: <List size={16} /> },
  { id: 'users', label: 'User Opt-ins', icon: <Users size={16} /> },
];

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export const EmailManagement: React.FC = () => {
  const [activeTab, setActiveTab] = useState('config');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Mail size={24} className="text-primary" />
        <h1 className="text-2xl font-bold text-textMain">Email Management</h1>
      </div>

      <div className="flex gap-1 border-b border-white/10 overflow-x-auto flex-nowrap no-scrollbar">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-textMuted hover:text-textMain'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-2">
        {activeTab === 'config' && <ConfigTab />}
        {activeTab === 'types' && <EmailTypesTab />}
        {activeTab === 'templates' && <TemplatesTab />}
        {activeTab === 'broadcast' && <BroadcastTab />}
        {activeTab === 'log' && <LogTab />}
        {activeTab === 'users' && <UserOptInsTab />}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tab: Config
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Quota card (used inside ConfigTab)
// ---------------------------------------------------------------------------

interface QuotaData {
  available: boolean;
  used: number | null;
  limit: number;
  error?: string | null;
}

const QuotaCard: React.FC = () => {
  const qc = useQueryClient();
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitInput, setLimitInput] = useState('');

  const { data: quota, isLoading, refetch, isFetching } = useQuery<QuotaData>({
    queryKey: ['email-quota'],
    queryFn: () => apiClient.get('/admin/email/quota').then(r => r.data),
    staleTime: 60_000, // cache for 1 min
  });

  useEffect(() => {
    if (quota?.limit) setLimitInput(String(quota.limit));
  }, [quota?.limit]);

  const saveLimit = useMutation({
    mutationFn: (limit: number) => apiClient.put('/admin/email/monthly-limit', { limit }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-quota'] });
      setEditingLimit(false);
    },
  });

  if (isLoading) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-textMuted text-sm">
          <BarChart2 size={16} /> Loading quota…
        </div>
      </Card>
    );
  }

  if (!quota?.available) {
    return null; // no key set — don't show the card
  }

  const used = quota.used ?? 0;
  const limit = quota.limit;
  const remaining = Math.max(0, limit - used);
  const pct = Math.min(100, limit > 0 ? Math.round((used / limit) * 100) : 0);

  // Colour thresholds
  const barColor =
    pct >= 90 ? 'bg-red-500' :
    pct >= 70 ? 'bg-amber-400' :
    'bg-emerald-500';
  const textColor =
    pct >= 90 ? 'text-red-400' :
    pct >= 70 ? 'text-amber-400' :
    'text-emerald-400';

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 size={16} className="text-primary" />
          <h2 className="font-semibold text-textMain">Monthly send quota</h2>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-textMuted hover:text-textMain transition-colors"
          title="Refresh quota"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {quota.error && (
        <p className="text-xs text-amber-400">⚠ Quota probe failed: {quota.error}</p>
      )}

      {quota.used !== null ? (
        <>
          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-textMuted">Sent this month</span>
              <span className={`font-mono font-semibold ${textColor}`}>
                {used.toLocaleString()} / {limit.toLocaleString()}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-textMuted">
              <span>{pct}% used</span>
              <span className={remaining <= 100 ? 'text-red-400 font-semibold' : ''}>
                {remaining.toLocaleString()} remaining
              </span>
            </div>
          </div>
        </>
      ) : (
        <p className="text-xs text-textMuted italic">
          Quota data unavailable — header not returned by Resend.
        </p>
      )}

      {/* Configurable plan limit */}
      <div className="border-t border-white/10 pt-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-textMuted flex-1">
            Plan limit (emails/month):
          </span>
          {editingLimit ? (
            <>
              <input
                type="number"
                value={limitInput}
                onChange={e => setLimitInput(e.target.value)}
                className="w-24 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-textMain focus:outline-none focus:border-primary font-mono"
              />
              <Button
                size="sm"
                onClick={() => saveLimit.mutate(Number(limitInput))}
                disabled={saveLimit.isPending || !limitInput}
              >
                Save
              </Button>
              <button
                onClick={() => setEditingLimit(false)}
                className="text-xs text-textMuted hover:text-textMain"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="text-xs font-mono text-textMain font-semibold">
                {limit.toLocaleString()}
              </span>
              <button
                onClick={() => setEditingLimit(true)}
                className="text-xs text-primary hover:underline"
              >
                Change
              </button>
            </>
          )}
        </div>
        <p className="text-[11px] text-textMuted mt-1">
          Resend free plan: 3,000/month. Update this if you're on a paid plan.
        </p>
      </div>
    </Card>
  );
};

const ConfigTab: React.FC = () => {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [fromAddress, setFromAddress] = useState('');
  const [testType, setTestType] = useState('welcome');
  const [testToAddress, setTestToAddress] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);

  const { data: config, isLoading } = useQuery<{ resend_api_key_set: boolean; from_address: string; tournaments: TournamentInfo[] }>({
    queryKey: ['email-config'],
    queryFn: () => apiClient.get('/admin/email/config').then(r => r.data),
  });

  useEffect(() => {
    if (config?.from_address) setFromAddress(config.from_address);
  }, [config?.from_address]);

  useEffect(() => {
    if (me?.email && !testToAddress) setTestToAddress(me.email);
  }, [me?.email]);

  const saveConfig = useMutation({
    mutationFn: (payload: { from_address: string }) =>
      apiClient.put('/admin/email/config', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-config'] }),
  });

  const setMode = useMutation({
    mutationFn: ({ id, mode }: { id: number; mode: string }) =>
      apiClient.put(`/admin/email/tournaments/${id}/mode`, { email_mode: mode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-config'] }),
  });

  const sendTest = useMutation({
    mutationFn: ({ email_type, to_address }: { email_type: string; to_address: string }) =>
      apiClient.post('/admin/email/test-send', { email_type, to_address }).then(r => r.data),
    onSuccess: (d: { message: string; log_id: number }) =>
      setTestResult(`${d.message} (log #${d.log_id})`),
    onError: () => setTestResult('Test send failed'),
  });

  if (isLoading) return <div className="text-textMuted">Loading…</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <QuotaCard />

      <Card className="p-5 space-y-4">
        <h2 className="font-semibold text-textMain">Resend API</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-textMuted">API key:</span>
          <Badge variant={config?.resend_api_key_set ? 'success' : 'scheduled'}>
            {config?.resend_api_key_set ? 'Configured via .env' : 'Not set — add TRANS_EMAIL_API_KEY to .env'}
          </Badge>
        </div>
        <div>
          <label className="text-sm text-textMuted block mb-1">From address</label>
          <div className="flex gap-2">
            <input
              value={fromAddress}
              onChange={e => setFromAddress(e.target.value)}
              placeholder="noreply@yourdomain.com"
              className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-textMain focus:outline-none focus:border-primary"
            />
            <Button
              size="sm"
              onClick={() => saveConfig.mutate({ from_address: fromAddress })}
              disabled={saveConfig.isPending}
            >
              Save
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold text-textMain">Tournament email mode</h2>
        <p className="text-xs text-textMuted">
          Simulation — emails are logged but never sent. Live — emails go via Resend.
        </p>
        {config?.tournaments?.map((t: TournamentInfo) => (
          <div key={t.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
            <span className="text-sm text-textMain">{t.name}</span>
            <div className="flex gap-2">
              {['simulation', 'live'].map(mode => (
                <button
                  key={mode}
                  onClick={() => setMode.mutate({ id: t.id, mode })}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    t.email_mode === mode
                      ? mode === 'live'
                        ? 'bg-green-600 text-white'
                        : 'bg-indigo-600 text-white'
                      : 'bg-white/5 text-textMuted hover:bg-white/10'
                  }`}
                >
                  {mode === 'live' ? '🟢 Live' : '🔵 Simulation'}
                </button>
              ))}
            </div>
          </div>
        ))}
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold text-textMain">Test send</h2>
        <p className="text-xs text-textMuted">Sends a test email using dummy data.</p>
        <div className="flex gap-2 items-center">
          <select
            value={testType}
            onChange={e => setTestType(e.target.value)}
            className="bg-card border border-white/10 rounded px-3 py-2 text-sm text-textMain focus:outline-none focus:border-primary [&>option]:bg-card [&>option]:text-textMain"
          >
            {EMAIL_TYPES.map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
          <input
            type="email"
            value={testToAddress}
            onChange={e => setTestToAddress(e.target.value)}
            placeholder="recipient@example.com"
            className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-textMain focus:outline-none focus:border-primary"
          />
          <Button
            size="sm"
            onClick={() => sendTest.mutate({ email_type: testType, to_address: testToAddress })}
            disabled={sendTest.isPending || !testToAddress}
          >
            <Send size={14} className="mr-1" /> Send test
          </Button>
        </div>
        {testResult && <p className="text-xs text-green-400">{testResult}</p>}
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Shared: Toggle
// ---------------------------------------------------------------------------

const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({ value, onChange }) => (
  <button
    onClick={() => onChange(!value)}
    className={`transition-colors ${value ? 'text-green-400' : 'text-white/20'} hover:opacity-80`}
    aria-label={value ? 'Enabled' : 'Disabled'}
  >
    {value ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
  </button>
);

// ---------------------------------------------------------------------------
// Tab: Email Types
// ---------------------------------------------------------------------------

const EmailTypesTab: React.FC = () => {
  const qc = useQueryClient();

  const { data: settings = [], isLoading: loadingSettings } = useQuery<TournamentSettings[]>({
    queryKey: ['email-tournament-settings'],
    queryFn: () => apiClient.get('/admin/email/tournament-settings').then(r => r.data),
  });

  const { data: leagues = [], isLoading: loadingLeagues } = useQuery<LeagueEmailInfo[]>({
    queryKey: ['email-leagues'],
    queryFn: () => apiClient.get('/admin/email/leagues').then(r => r.data),
  });

  const { data: estimates = [] } = useQuery<SendEstimate[]>({
    queryKey: ['email-send-estimates'],
    queryFn: () => apiClient.get('/admin/email/send-estimates').then(r => r.data),
  });

  const updateTournamentSettings = useMutation({
    mutationFn: ({ id, types }: { id: number; types: Record<string, boolean> }) =>
      apiClient.put(`/admin/email/tournament-settings/${id}`, { types }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-tournament-settings'] }),
  });

  const toggleLeague = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiClient.put(`/admin/email/leagues/${id}`, { emails_enabled: enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-leagues'] });
      qc.invalidateQueries({ queryKey: ['email-send-estimates'] });
    },
  });

  const handleTypeToggle = (ts: TournamentSettings, typeKey: string, value: boolean) => {
    updateTournamentSettings.mutate({
      id: ts.tournament_id,
      types: { ...ts.types, [typeKey]: value },
    });
  };

  if (loadingSettings || loadingLeagues) return <div className="text-textMuted">Loading…</div>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-semibold text-textMain mb-3">Enabled email types per tournament</h2>
        <p className="text-xs text-textMuted mb-4">
          Transactional types (Welcome, Invite) bypass league and user opt-in checks.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-textMuted border-b border-white/10">
                <th className="text-left py-2 pr-6">Type</th>
                {settings.map(ts => (
                  <th key={ts.tournament_id} className="text-center py-2 px-3 min-w-[120px]">
                    {ts.tournament_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EMAIL_TYPES.map(typeKey => (
                <tr key={typeKey} className="border-b border-white/5">
                  <td className="py-3 pr-6 text-textMain font-medium">
                    {TYPE_LABELS[typeKey]}
                    {typeKey === 'welcome' && (
                      <span className="ml-2 text-xs text-indigo-400">(transactional)</span>
                    )}
                  </td>
                  {settings.map(ts => {
                    const est = estimates.find(e => e.tournament_id === ts.tournament_id);
                    const total = est?.counts[typeKey];
                    const mul = est?.multipliers;
                    let breakdown: string | null = null;
                    if (est && mul && total !== undefined) {
                      if (typeKey === 'round_summary') {
                        const users = mul.rounds > 0 ? Math.round(total / mul.rounds) : total;
                        breakdown = `${mul.rounds} rounds × ${users.toLocaleString()}`;
                      } else if (typeKey === 'daily_digest') {
                        const users = mul.days > 0 ? Math.round(total / mul.days) : total;
                        breakdown = `${mul.days} days × ${users.toLocaleString()}`;
                      }
                    }
                    return (
                      <td key={ts.tournament_id} className="py-3 px-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <Toggle
                            value={ts.types[typeKey] ?? false}
                            onChange={v => handleTypeToggle(ts, typeKey, v)}
                          />
                          {total !== undefined && (
                            <span className="text-[11px] text-textMuted tabular-nums leading-tight text-center">
                              {breakdown ? (
                                <>{breakdown}<br />= {total.toLocaleString()} emails</>
                              ) : (
                                <>{total.toLocaleString()} {total === 1 ? 'user' : 'users'}</>
                              )}
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="font-semibold text-textMain mb-3">League email settings</h2>
        <p className="text-xs text-textMuted mb-4">
          At least one of a user's leagues must have emails enabled for them to receive marketing emails.
        </p>
        <div className="space-y-1">
          {leagues.map(league => (
            <div key={league.id} className="flex items-center justify-between py-2 px-3 rounded bg-white/3 hover:bg-white/5">
              <div>
                <span className="text-sm text-textMain">{league.name}</span>
                <span className="text-xs text-textMuted ml-2">({league.tournament_name})</span>
              </div>
              <Toggle
                value={league.emails_enabled}
                onChange={v => toggleLeague.mutate({ id: league.id, enabled: v })}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tab: Templates
// ---------------------------------------------------------------------------

const TemplatesTab: React.FC = () => {
  const qc = useQueryClient();
  const [selectedType, setSelectedType] = useState('welcome');
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: templates = [] } = useQuery<EmailTemplate[]>({
    queryKey: ['email-templates'],
    queryFn: () => apiClient.get('/admin/email/templates').then(r => r.data),
  });

  useEffect(() => {
    const tpl = templates.find((t: EmailTemplate) => t.email_type === selectedType);
    if (tpl) { setEditSubject(tpl.subject); setEditBody(tpl.body_html); }
  }, [templates, selectedType]);

  const saveTemplate = useMutation({
    mutationFn: () =>
      apiClient.put(`/admin/email/templates/${selectedType}`, {
        subject: editSubject,
        body_html: editBody,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-templates'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSelectType = (type: string) => {
    setSelectedType(type);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <div className="flex gap-1">
          {EMAIL_TYPES.map(t => (
            <button
              key={t}
              onClick={() => handleSelectType(t)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                selectedType === t ? 'bg-primary text-white' : 'bg-white/5 text-textMuted hover:bg-white/10'
              }`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <button
          onClick={() => setPreview(p => !p)}
          className="ml-auto flex items-center gap-1 text-xs text-textMuted hover:text-textMain"
        >
          {preview ? <EyeOff size={14} /> : <Eye size={14} />}
          {preview ? 'Hide preview' : 'Show preview'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4" style={{ gridTemplateColumns: preview ? '1fr 1fr' : '1fr' }}>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-textMuted block mb-1">Subject (Jinja2 variables: {'{{ user_name }}'} etc.)</label>
            <input
              value={editSubject}
              onChange={e => setEditSubject(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-textMain font-mono focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs text-textMuted block mb-1">HTML body</label>
            <textarea
              value={editBody}
              onChange={e => setEditBody(e.target.value)}
              rows={24}
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs text-textMain font-mono focus:outline-none focus:border-primary resize-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => saveTemplate.mutate()} disabled={saveTemplate.isPending}>
              {saveTemplate.isPending ? 'Saving…' : 'Save template'}
            </Button>
            {saved && <span className="text-xs text-green-400">Saved ✓</span>}
          </div>
        </div>

        {preview && (
          <div className="border border-white/10 rounded overflow-hidden">
            <div className="bg-white/5 px-3 py-2 text-xs text-textMuted border-b border-white/10">
              Preview (raw HTML — Jinja2 variables shown as-is)
            </div>
            <iframe
              srcDoc={editBody}
              className="w-full bg-white"
              style={{ height: '600px', border: 'none' }}
              title="Email preview"
            />
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tab: Log
// ---------------------------------------------------------------------------

const LogTab: React.FC = () => {
  const qc = useQueryClient();
  const [filterType, setFilterType] = useState('');
  const [filterSimulated, setFilterSimulated] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const params = new URLSearchParams();
  if (filterType) params.set('email_type', filterType);
  if (filterSimulated) params.set('simulated', filterSimulated);
  if (filterStatus) params.set('status', filterStatus);

  const { data: log = [], isLoading, refetch } = useQuery<LogEntry[]>({
    queryKey: ['email-log', filterType, filterSimulated, filterStatus],
    queryFn: () => apiClient.get(`/admin/email/log?${params.toString()}`).then(r => r.data),
  });

  const sendNow = useMutation({
    mutationFn: (id: number) => apiClient.post(`/admin/email/log/${id}/send`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-log'] });
      refetch();
    },
  });

  const statusVariant = (status: string, simulated: boolean): 'success' | 'live' | 'scheduled' | 'danger' => {
    if (simulated) return 'scheduled';
    if (status === 'sent') return 'success';
    if (status === 'failed' || status === 'bounced') return 'danger';
    return 'scheduled';
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="bg-card border border-white/10 rounded px-3 py-1.5 text-sm text-textMain focus:outline-none focus:border-primary [&>option]:bg-card [&>option]:text-textMain"
        >
          <option value="">All types</option>
          {EMAIL_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
        <select
          value={filterSimulated}
          onChange={e => setFilterSimulated(e.target.value)}
          className="bg-card border border-white/10 rounded px-3 py-1.5 text-sm text-textMain focus:outline-none focus:border-primary [&>option]:bg-card [&>option]:text-textMain"
        >
          <option value="">Simulated & real</option>
          <option value="true">Simulated only</option>
          <option value="false">Real only</option>
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="bg-card border border-white/10 rounded px-3 py-1.5 text-sm text-textMain focus:outline-none focus:border-primary [&>option]:bg-card [&>option]:text-textMain"
        >
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="bounced">Bounced</option>
        </select>
        <Button size="sm" variant="secondary" onClick={() => refetch()}>Refresh</Button>
      </div>

      {isLoading ? (
        <div className="text-textMuted">Loading…</div>
      ) : log.length === 0 ? (
        <p className="text-textMuted text-sm">No log entries found.</p>
      ) : (
        <div className="space-y-1">
          {log.map(entry => (
            <div key={entry.id} className="border border-white/10 rounded overflow-hidden">
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/3"
                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              >
                {expandedId === entry.id ? <ChevronDown size={14} className="text-textMuted flex-shrink-0" /> : <ChevronRight size={14} className="text-textMuted flex-shrink-0" />}
                <span className="text-xs text-textMuted w-36 flex-shrink-0">
                  {new Date(entry.created_at).toLocaleString()}
                </span>
                <Badge variant={statusVariant(entry.status, entry.simulated)}>
                  {entry.simulated ? '🔵 sim' : '🟢 real'} · {entry.status}
                </Badge>
                <span className="text-xs font-medium text-indigo-400 w-28 flex-shrink-0">{TYPE_LABELS[entry.email_type] ?? entry.email_type}</span>
                <span className="text-sm text-textMain truncate">{entry.subject}</span>
                <span className="text-xs text-textMuted ml-auto flex-shrink-0">{entry.display_name}</span>
              </div>

              {expandedId === entry.id && (
                <div className="border-t border-white/10">
                  <div className="flex items-center gap-3 px-4 py-2 bg-white/3">
                    <span className="text-xs text-textMuted">To: {entry.to_address}</span>
                    {entry.simulated && (
                      <Button
                        size="sm"
                        onClick={() => sendNow.mutate(entry.id)}
                        disabled={sendNow.isPending}
                      >
                        <Send size={12} className="mr-1" /> Send now (real)
                      </Button>
                    )}
                  </div>
                  <iframe
                    srcDoc={entry.body_html}
                    className="w-full bg-white"
                    style={{ height: '400px', border: 'none' }}
                    title={`Email ${entry.id}`}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tab: User Opt-ins
// ---------------------------------------------------------------------------

interface UserPrefRow {
  user_id: number;
  display_name: string;
  email: string;
  is_active: boolean;
  preferences: Record<string, boolean>;
}

const UserOptInsTab: React.FC = () => {
  const [search, setSearch] = useState('');

  const { data: rows = [], isLoading } = useQuery<UserPrefRow[]>({
    queryKey: ['email-user-preferences'],
    queryFn: () => apiClient.get('/admin/email/user-preferences').then(r => r.data),
  });

  const optInTypes = EMAIL_TYPES.filter(t => t !== 'welcome');

  const filtered = rows.filter(r =>
    r.display_name.toLowerCase().includes(search.toLowerCase()) ||
    r.email.toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) return <div className="text-textMuted">Loading…</div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-textMuted">
        Read-only view of each user's email opt-in preferences. Users manage these from their Profile page.
      </p>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by name or email…"
        className="w-full max-w-sm bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-textMain focus:outline-none focus:border-primary"
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-textMuted border-b border-white/10">
              <th className="text-left py-2 pr-4">User</th>
              <th className="text-left py-2 pr-6 text-xs">Email</th>
              {optInTypes.map(t => (
                <th key={t} className="text-center py-2 px-3 min-w-[110px] text-xs">{TYPE_LABELS[t]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => (
              <tr key={row.user_id} className={`border-b border-white/5 ${!row.is_active ? 'opacity-40' : ''}`}>
                <td className="py-2.5 pr-4 font-medium text-textMain whitespace-nowrap">{row.display_name}</td>
                <td className="py-2.5 pr-6 text-textMuted text-xs whitespace-nowrap">{row.email}</td>
                {optInTypes.map(t => (
                  <td key={t} className="py-2.5 px-3 text-center">
                    {row.preferences[t]
                      ? <span className="text-green-400 text-xs font-semibold">Opted in</span>
                      : <span className="text-white/25 text-xs">—</span>
                    }
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={optInTypes.length + 2} className="py-6 text-center text-textMuted text-sm">No users found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tab: Broadcast
// ---------------------------------------------------------------------------

interface BroadcastRecipient {
  user_id: number;
  display_name: string;
  email: string;
  leagues: string[];
}

interface BroadcastPreview {
  recipients: BroadcastRecipient[];
  total: number;
  simulated: boolean;
}

const BroadcastTab: React.FC = () => {
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [allLeagues, setAllLeagues] = useState(true);
  const [selectedLeagueIds, setSelectedLeagueIds] = useState<number[]>([]);
  const [preview, setPreview] = useState<BroadcastPreview | null>(null);
  const [showHtmlPreview, setShowHtmlPreview] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; simulated: boolean } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [forceLive, setForceLive] = useState(false);

  const { data: leagues = [] } = useQuery<LeagueEmailInfo[]>({
    queryKey: ['email-leagues'],
    queryFn: () => apiClient.get('/admin/email/leagues').then(r => r.data),
  });

  const leagueIds = allLeagues ? null : (selectedLeagueIds.length > 0 ? selectedLeagueIds : null);

  const previewMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/admin/email/broadcast/preview', { league_ids: leagueIds }).then(r => r.data as BroadcastPreview),
    onSuccess: (data) => {
      setPreview(data);
      setSendResult(null);
    },
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/admin/email/broadcast/send', {
        subject,
        body_html: bodyHtml,
        league_ids: leagueIds,
        force_live: forceLive,
      }).then(r => r.data),
    onSuccess: (data) => {
      setSendResult(data);
      setConfirmOpen(false);
      setPreview(null);
    },
  });

  const toggleLeagueSelection = (id: number) => {
    setSelectedLeagueIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <p className="text-sm text-textMuted">
        Send a one-off email to all opted-in participants. Recipients must have opted in to at least one marketing
        email type and be in an emails-enabled league.
      </p>

      {/* League selector */}
      <Card className="p-5 space-y-3">
        <h2 className="font-semibold text-textMain">Audience</h2>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={allLeagues}
            onChange={e => setAllLeagues(e.target.checked)}
            className="accent-primary"
          />
          <span className="text-sm text-textMain">All eligible leagues</span>
        </label>
        {!allLeagues && (
          <div className="space-y-1 pl-5">
            <p className="text-xs text-textMuted mb-2">Select specific leagues:</p>
            {leagues.map(league => (
              <label key={league.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedLeagueIds.includes(league.id)}
                  onChange={() => toggleLeagueSelection(league.id)}
                  className="accent-primary"
                />
                <span className="text-sm text-textMain">{league.name}</span>
                <span className="text-xs text-textMuted">({league.tournament_name})</span>
                {!league.emails_enabled && (
                  <span className="text-xs text-amber-400">emails disabled</span>
                )}
              </label>
            ))}
            {selectedLeagueIds.length === 0 && (
              <p className="text-xs text-amber-400">No leagues selected — broadcast will have no recipients.</p>
            )}
          </div>
        )}
      </Card>

      {/* Compose */}
      <Card className="p-5 space-y-4">
        <h2 className="font-semibold text-textMain">Compose</h2>
        <div>
          <label className="text-xs text-textMuted block mb-1">Subject</label>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Your subject line…"
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-textMain focus:outline-none focus:border-primary"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-textMuted">HTML body</label>
            <button
              onClick={() => setShowHtmlPreview(p => !p)}
              className="flex items-center gap-1 text-xs text-textMuted hover:text-textMain"
            >
              {showHtmlPreview ? <EyeOff size={13} /> : <Eye size={13} />}
              {showHtmlPreview ? 'Hide preview' : 'Show preview'}
            </button>
          </div>
          <div className={`grid gap-4 ${showHtmlPreview ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <textarea
              value={bodyHtml}
              onChange={e => setBodyHtml(e.target.value)}
              rows={20}
              placeholder="<html>…paste your HTML here…</html>"
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs text-textMain font-mono focus:outline-none focus:border-primary resize-none"
            />
            {showHtmlPreview && (
              <div className="border border-white/10 rounded overflow-hidden">
                <div className="bg-white/5 px-3 py-2 text-xs text-textMuted border-b border-white/10">
                  Rendered preview
                </div>
                <iframe
                  srcDoc={bodyHtml}
                  className="w-full bg-white"
                  style={{ height: '480px', border: 'none' }}
                  title="Broadcast preview"
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 items-center pt-1">
          <Button
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending || !subject.trim() || !bodyHtml.trim()}
            variant="secondary"
          >
            <Users size={14} className="mr-1" />
            {previewMutation.isPending ? 'Checking…' : 'Preview recipients'}
          </Button>
        </div>
      </Card>

      {/* Recipient preview */}
      {preview && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-textMain">
              Recipients — {preview.total} {preview.total === 1 ? 'user' : 'users'}
            </h2>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-xs px-2 py-1 rounded font-medium ${(preview.simulated && !forceLive) ? 'bg-indigo-900 text-indigo-300' : 'bg-green-900 text-green-300'}`}>
                {(preview.simulated && !forceLive) ? '🔵 Will be simulated (no tournament in live mode)' : '🟢 Will send for real'}
              </span>
              {preview.simulated && (
                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-amber-400 select-none">
                  <input
                    type="checkbox"
                    checked={forceLive}
                    onChange={e => setForceLive(e.target.checked)}
                    className="accent-amber-400"
                  />
                  Send for real anyway
                </label>
              )}
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={preview.total === 0}
              >
                <Send size={14} className="mr-1" /> Send to {preview.total}
              </Button>
            </div>
          </div>

          {preview.total === 0 ? (
            <p className="text-sm text-textMuted">No opted-in users found for the selected audience.</p>
          ) : (
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-textMuted border-b border-white/10">
                    <th className="text-left py-2 pr-4">Name</th>
                    <th className="text-left py-2 pr-4 text-xs">Email</th>
                    <th className="text-left py-2 text-xs">Leagues</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.recipients.map(r => (
                    <tr key={r.user_id} className="border-b border-white/5">
                      <td className="py-2 pr-4 text-textMain whitespace-nowrap">{r.display_name}</td>
                      <td className="py-2 pr-4 text-textMuted text-xs whitespace-nowrap">{r.email}</td>
                      <td className="py-2 text-textMuted text-xs">{r.leagues.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Send result */}
      {sendResult && (
        <Card className="p-5">
          <p className="text-sm font-medium text-green-400">
            Broadcast complete — {sendResult.sent} {sendResult.simulated ? 'queued (simulated)' : 'sent'}
            {sendResult.failed > 0 && <span className="text-red-400"> · {sendResult.failed} failed</span>}
          </p>
        </Card>
      )}

      {/* Confirm modal */}
      {confirmOpen && preview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-card border border-white/10 rounded-lg p-6 max-w-md w-full mx-4 space-y-4">
            <h3 className="text-lg font-semibold text-textMain">Confirm broadcast</h3>
            <div className="space-y-2 text-sm text-textMuted">
              <p><span className="text-textMain font-medium">Subject:</span> {subject}</p>
              <p><span className="text-textMain font-medium">Recipients:</span> {preview.total} users</p>
              <p>
                <span className="text-textMain font-medium">Mode:</span>{' '}
                {(preview.simulated && !forceLive)
                  ? '🔵 Simulated — emails will be logged but not sent'
                  : '🟢 Live — emails will be delivered via Resend'}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending}
              >
                <Send size={14} className="mr-1" />
                {sendMutation.isPending ? 'Sending…' : 'Confirm & send'}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={sendMutation.isPending}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

