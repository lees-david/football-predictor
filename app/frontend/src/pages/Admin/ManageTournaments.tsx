import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { apiClient } from '../../api/client';
import { useAdminTournaments } from '../../api/hooks/useTournaments';
import {
  Trophy,
  Plus,
  Edit,
  Activity,
  HelpCircle,
  Check,
  X,
  AlertCircle,
  Database,
  Trash2
} from 'lucide-react';

interface Tournament {
  id: number;
  name: string;
  is_active: boolean;
  has_bracket: boolean;
}

interface SyncResult {
  inserted: number;
  updated: number;
  skipped: number;
  total: number;
  api_calls_used: number;
}

interface TournamentCardProps {
  tournament: Tournament;
  syncingId: number | null;
  syncResults: Record<number, SyncResult>;
  syncErrors: Record<number, string>;
  resettingId: number | null;
  resetScope: string | null;
  resetSuccess: Record<number, string>;
  resetError: Record<number, string>;
  targetedResetMutation: any;
  resetMutation: any;
  openEditModal: (t: Tournament) => void;
  handleTargetedReset: (id: number, scope: string, label: string) => void;
  handleTriggerReset: (id: number) => void;
  handleTriggerSync: (id: number) => void;
}

const PREDICTION_RESET_OPTIONS = [
  {
    scope: 'pred_group_matches',
    label: 'Group Stage Game Scores',
    description: 'Delete user match predictions for the Group stage',
  },
  {
    scope: 'pred_group_standings',
    label: 'Group Standings',
    description: 'Delete user bracket predictions for the Group standings',
  },
  {
    scope: 'pred_ko_bracket',
    label: 'KO Tournament Bracket Predictions',
    description: 'Delete user bracket predictions for the Knockout rounds',
  },
  {
    scope: 'pred_r32_matches',
    label: 'R32 Game Scores',
    description: 'Delete user match predictions for the Round of 32',
  },
  {
    scope: 'pred_r16_matches',
    label: 'R16 Game Scores',
    description: 'Delete user match predictions for the Round of 16',
  },
  {
    scope: 'pred_qf_matches',
    label: 'Qtrs Game Scores',
    description: 'Delete user match predictions for Quarter Finals',
  },
  {
    scope: 'pred_sf_matches',
    label: 'Semis Game Scores',
    description: 'Delete user match predictions for Semi Finals',
  },
  {
    scope: 'pred_finals_matches',
    label: 'Finals Game Scores',
    description: 'Delete user match predictions for Finals & 3rd Place',
  },
];

const TournamentCard: React.FC<TournamentCardProps> = ({
  tournament,
  syncingId,
  syncResults,
  syncErrors,
  resettingId,
  resetScope,
  resetSuccess,
  resetError,
  targetedResetMutation,
  resetMutation,
  openEditModal,
  handleTargetedReset,
  handleTriggerReset,
  handleTriggerSync,
}) => {
  const isSyncing = syncingId === tournament.id;
  const result = syncResults[tournament.id];
  const error = syncErrors[tournament.id];

  const { data: resetStatus = {} } = useQuery({
    queryKey: ['admin', 'tournaments', tournament.id, 'reset-status'],
    queryFn: async () => {
      const { data } = await apiClient.get(`/admin/tournaments/${tournament.id}/reset/predictions/status`);
      return data as Record<string, 'open' | 'not_yet_opened' | 'closed'>;
    },
    enabled: !!tournament.id,
  });

  const RESET_OPTIONS = [
    {
      scope: 'all',
      label: 'All',
      description: 'Wipe results, predictions, and all awarded points',
    },
    {
      scope: 'predictions',
      label: 'Predictions',
      description: 'Delete all user match and bracket predictions',
    },
    {
      scope: 'results',
      label: 'Results',
      description: 'Blank all fixture scores and zero prediction points',
    },
    {
      scope: 'points',
      label: 'Points',
      description: 'Zero all awarded points; keep predictions and results',
    },
  ];

  return (
    <div
      className={`p-5 rounded-xl border transition-all duration-200 ${
        tournament.is_active
          ? 'bg-black/35 border-primary/20 hover:border-primary/45 shadow-sm hover:shadow-primary/5'
          : 'bg-black/10 border-white/5 opacity-70'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4 mb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-textMain text-lg">{tournament.name}</h3>
            <Badge variant={tournament.is_active ? 'live' : 'completed'}>
              {tournament.is_active ? 'Active' : 'Inactive'}
            </Badge>
            {tournament.has_bracket && (
              <Badge variant="admin">Bracket Builder Active 🏆</Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openEditModal(tournament)}
            className="text-xs"
          >
            <Edit size={14} className="mr-1.5" />
            Configure
          </Button>
        </div>
      </div>

      {/* Data Reset Widget */}
      <div className="bg-black/40 rounded-lg p-4 border border-white/5 mb-4">
        <div className="flex items-center gap-1.5 mb-3">
          <Trash2 size={15} className="text-danger/70" />
          <h4 className="text-sm font-semibold text-textMain">Data Reset</h4>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {RESET_OPTIONS.map(({ scope, label, description }) => {
            const isRunning = resettingId === tournament.id && resetScope === scope;
            return (
              <button
                key={scope}
                onClick={() => handleTargetedReset(tournament.id, scope, label)}
                disabled={targetedResetMutation.isPending || isSyncing}
                title={description}
                className={`flex flex-col items-center justify-center gap-1 px-2 py-2.5 rounded-lg border text-xs font-medium transition-all ${
                  scope === 'all'
                    ? 'bg-red-500/10 border-red-500/25 text-red-400 hover:bg-red-500/20 hover:border-red-500/40'
                    : 'bg-black/30 border-white/8 text-textMuted hover:bg-white/5 hover:text-white hover:border-white/15'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {isRunning ? (
                  <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
                {label}
              </button>
            );
          })}
        </div>
        {resetSuccess[tournament.id] && (
          <p className="mt-3 text-xs text-success flex items-center gap-1.5">
            <Check size={12} />
            {resetSuccess[tournament.id]}
          </p>
        )}
        {resetError[tournament.id] && (
          <p className="mt-3 text-xs text-danger flex items-center gap-1.5">
            <X size={12} />
            {resetError[tournament.id]}
          </p>
        )}
      </div>

      {/* Reset Predictions Widget */}
      <div className="bg-black/40 rounded-lg p-4 border border-white/5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <Trophy size={15} className="text-primary/70" />
            <h4 className="text-sm font-semibold text-textMain">Reset Predictions</h4>
          </div>
          <span className="text-[10px] text-textMuted uppercase tracking-wider font-semibold">
            Granular Scopes
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {PREDICTION_RESET_OPTIONS.map(({ scope, label, description }) => {
            const isRunning = resettingId === tournament.id && resetScope === scope;
            const status = resetStatus[scope] || 'not_yet_opened';
            const isOpen = status === 'open';
            const isClosed = status === 'closed';
            const isNotOpened = status === 'not_yet_opened';

            let colorClasses = '';
            if (isOpen) {
              colorClasses = 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/40';
            } else if (isClosed) {
              colorClasses = 'bg-red-500/5 border-red-500/20 text-red-400 hover:bg-red-500/10 hover:border-red-500/40';
            } else {
              colorClasses = 'bg-white/5 border-white/5 text-textMuted/45 opacity-40 cursor-not-allowed';
            }

            return (
              <button
                key={scope}
                onClick={() => handleTargetedReset(tournament.id, scope, label)}
                disabled={targetedResetMutation.isPending || isSyncing || isNotOpened}
                title={`${description} (${status.toUpperCase().replace(/_/g, ' ')})`}
                className={`flex flex-col items-center justify-center text-center gap-1 px-1 py-2.5 rounded-lg border text-[11px] font-medium transition-all ${colorClasses} disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {isRunning ? (
                  <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Trash2 size={11} />
                )}
                <span className="line-clamp-1">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sync Widget */}
      <div className="bg-black/40 rounded-lg p-4 border border-white/5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-textMain flex items-center gap-1.5">
              <Activity size={16} className={isSyncing ? 'text-primary animate-pulse' : 'text-primary/70'} />
              Match Fixture Sync
            </h4>
            <p className="text-xs text-textMuted">Syncs scores, venues, and kickoff parameters via football-data.org.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleTriggerReset(tournament.id)}
              disabled={isSyncing || resetMutation.isPending}
              isLoading={resetMutation.isPending && syncingId === tournament.id}
              className="text-xs whitespace-nowrap bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/30"
            >
              🚨 Reset & Re-Seed
            </Button>
            <Button
              variant={isSyncing ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => handleTriggerSync(tournament.id)}
              isLoading={isSyncing}
              className="text-xs whitespace-nowrap"
            >
              {isSyncing ? 'Syncing...' : '⚡ Trigger Live Sync'}
            </Button>
          </div>
        </div>

        {/* Sync Results display */}
        {result && (
          <div className="mt-4 p-3 bg-success/5 border border-success/15 rounded-lg space-y-2">
            <h5 className="text-xs font-bold text-success flex items-center gap-1.5">
              <Check size={14} /> Sync Finished Successfully
            </h5>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              {[
                ['Inserted', result.inserted, 'text-emerald-400'],
                ['Updated', result.updated, 'text-blue-400'],
                ['Skipped', result.skipped, 'text-white/40'],
                ['Total', result.total, 'text-white']
              ].map(([label, val, color]) => (
                <div key={label.toString()} className="bg-black/50 p-2 rounded border border-white/5">
                  <div className="text-[10px] text-textMuted uppercase tracking-wider font-semibold">{label}</div>
                  <div className={`text-sm font-mono font-bold mt-0.5 ${color}`}>{val}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 p-2.5 bg-primary/10 border border-primary/20 rounded text-[11px] text-primary-light leading-relaxed">
              💡 <strong>football-data.org API Active:</strong> Match results are fetched automatically via the football-data.org v4 API on each sync cycle.
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-danger/5 border border-danger/15 rounded-lg flex items-start gap-2 text-danger">
            <X size={16} className="shrink-0 mt-0.5" />
            <span className="text-xs font-semibold">{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export const ManageTournaments: React.FC = () => {
  const queryClient = useQueryClient();
  
  // States for new tournament form
  const [newName, setNewName] = useState('');
  const [newIsActive, setNewIsActive] = useState(true);
  const [newHasBracket, setNewHasBracket] = useState(false);
  
  // UI States
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  
  // Edit Modal States
  const [editingTournament, setEditingTournament] = useState<Tournament | null>(null);
  const [editName, setEditName] = useState('');
  const [editIsActive, setEditIsActive] = useState(false);
  const [editHasBracket, setEditHasBracket] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Syncing States (mapped per tournament ID)
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [syncResults, setSyncResults] = useState<Record<number, SyncResult>>({});
  const [syncErrors, setSyncErrors] = useState<Record<number, string>>({});

  // Targeted reset states
  const [resettingId, setResettingId] = useState<number | null>(null);
  const [resetScope, setResetScope] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<Record<number, string>>({});
  const [resetError, setResetError] = useState<Record<number, string>>({});

  const { data: tournaments = [], isLoading } = useAdminTournaments();

  // Create Tournament mutation
  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const { data } = await apiClient.post('/admin/tournaments', payload);
      return data;
    },
    onSuccess: (data) => {
      setFormSuccess(`Tournament created successfully! Bracket Mode: ${data.has_bracket ? 'Enabled 🏆' : 'Disabled'}`);
      setFormError(null);
      setNewName('');
      setNewHasBracket(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'tournaments'] });
      queryClient.invalidateQueries({ queryKey: ['tournaments'] });
    },
    onError: (err: any) => {
      setFormError(err.response?.data?.detail || 'Failed to create tournament.');
      setFormSuccess(null);
    }
  });

  // Edit Tournament mutation
  const editMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number, payload: any }) => {
      const { data } = await apiClient.put(`/admin/tournaments/${id}`, payload);
      return data;
    },
    onSuccess: () => {
      setEditingTournament(null);
      setEditError(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'tournaments'] });
      queryClient.invalidateQueries({ queryKey: ['tournaments'] });
    },
    onError: (err: any) => {
      setEditError(err.response?.data?.detail || 'Failed to update tournament.');
    }
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async (tournamentId: number) => {
      const { data } = await apiClient.post(`/admin/tournaments/${tournamentId}/sync`);
      return { id: tournamentId, data } as { id: number, data: SyncResult };
    },
    onSuccess: ({ id, data }) => {
      setSyncResults(prev => ({ ...prev, [id]: data }));
      setSyncErrors(prev => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      setSyncingId(null);
      queryClient.invalidateQueries({ queryKey: ['fixtures'] });
    },
    onError: (err: any, tournamentId) => {
      setSyncErrors(prev => ({ 
        ...prev, 
        [tournamentId]: err.response?.data?.detail || 'Sync failed. Please verify network connection.' 
      }));
      setSyncingId(null);
    }
  });

  // Reset Mutation
  const resetMutation = useMutation({
    mutationFn: async (tournamentId: number) => {
      const { data } = await apiClient.post(`/admin/tournaments/${tournamentId}/reset`);
      return { id: tournamentId, data } as { id: number, data: any };
    },
    onSuccess: () => {
      alert("Tournament purged, reset, and re-seeded successfully!");
      queryClient.invalidateQueries({ queryKey: ['admin', 'tournaments'] });
      queryClient.invalidateQueries({ queryKey: ['fixtures'] });
      queryClient.invalidateQueries({ queryKey: ['predictions'] });
      queryClient.invalidateQueries({ queryKey: ['bracket'] });
      setSyncingId(null);
    },
    onError: (err: any) => {
      alert(err.response?.data?.detail || 'Reset failed.');
      setSyncingId(null);
    }
  });

  const targetedResetMutation = useMutation({
    mutationFn: async ({ id, scope }: { id: number; scope: string }) => {
      const isPredReset = scope.startsWith('pred_');
      const url = isPredReset
        ? `/admin/tournaments/${id}/reset/predictions/${scope}`
        : `/admin/tournaments/${id}/reset/${scope}`;
      const { data } = await apiClient.post(url);
      return data;
    },
    onSuccess: (_data, { id, scope }) => {
      queryClient.invalidateQueries({ queryKey: ['fixtures'] });
      queryClient.invalidateQueries({ queryKey: ['predictions'] });
      queryClient.invalidateQueries({ queryKey: ['bracket'] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'tournaments', id, 'reset-status'] });
      const labels: Record<string, string> = {
        all: 'All data',
        predictions: 'Predictions',
        results: 'Results',
        points: 'Points',
        pred_group_matches: 'Group Stage Game Predictions',
        pred_group_standings: 'Group Standings Predictions',
        pred_ko_bracket: 'KO Bracket Predictions',
        pred_r32_matches: 'R32 Game Predictions',
        pred_r16_matches: 'R16 Game Predictions',
        pred_qf_matches: 'Qtrs Game Predictions',
        pred_sf_matches: 'Semis Game Predictions',
        pred_finals_matches: 'Finals Game Predictions',
      };
      setResetSuccess(prev => ({ ...prev, [id]: `${labels[scope] ?? scope} reset successfully.` }));
      setResetError(prev => { const c = { ...prev }; delete c[id]; return c; });
      setResettingId(null);
      setResetScope(null);
    },
    onError: (err: any, { id }) => {
      setResetError(prev => ({ ...prev, [id]: err.response?.data?.detail || 'Reset failed.' }));
      setResetSuccess(prev => { const c = { ...prev }; delete c[id]; return c; });
      setResettingId(null);
      setResetScope(null);
    },
  });

  const handleTargetedReset = (id: number, scope: string, label: string) => {
    if (!window.confirm(`Reset "${label}" for this tournament?\n\nThis cannot be undone.`)) return;
    setResettingId(id);
    setResetScope(scope);
    targetedResetMutation.mutate({ id, scope });
  };

  const handleTriggerReset = (id: number) => {
    if (window.confirm("🚨 WARNING: This action will PERMANENTLY DELETE all user predictions, bracket picks, custom points, and match fixtures, then re-seed all fixtures and re-map API match IDs.\n\nAre you sure you want to proceed?")) {
      setSyncingId(id);
      resetMutation.mutate(id);
    }
  };


  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    createMutation.mutate({
      name: newName,
      is_active: newIsActive,
      has_bracket: newHasBracket
    });
  };

  const openEditModal = (t: Tournament) => {
    setEditingTournament(t);
    setEditName(t.name);
    setEditIsActive(t.is_active);
    setEditHasBracket(t.has_bracket);
    setEditError(null);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTournament) return;
    editMutation.mutate({
      id: editingTournament.id,
      payload: {
        name: editName,
        is_active: editIsActive,
        has_bracket: editHasBracket
      }
    });
  };

  const handleTriggerSync = (id: number) => {
    setSyncingId(id);
    syncMutation.mutate(id);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 py-4">
      <div>
        <h1 className="text-3xl font-bold text-textMain tracking-tight">Tournament Management</h1>
        <p className="text-textMuted mt-1">Configure competition parameters, set bracket prediction modes, and trigger fixture syncs.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Column: Create New Tournament */}
        <div className="lg:col-span-1">
          <Card title={<span className="flex items-center gap-2 text-primary"><Plus size={18} /> Add Tournament</span>}>
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              {formSuccess && (
                <div className="p-3 bg-success/15 border border-success/30 rounded-lg text-success text-xs">
                  {formSuccess}
                </div>
              )}
              {formError && (
                <div className="p-3 bg-danger/15 border border-danger/30 rounded-lg text-danger text-xs flex items-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-textMuted mb-1 uppercase tracking-wider">Tournament Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-primary outline-none text-sm"
                  placeholder="e.g. World Cup 2026"
                  required
                />
              </div>

              <div className="flex items-center justify-between border-t border-white/5 pt-4">
                <span className="text-sm font-medium text-textMain">Active Tournament</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newIsActive}
                    onChange={(e) => setNewIsActive(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-textMuted after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-black"></div>
                </label>
              </div>

              <div className="flex items-center justify-between pb-2">
                <span className="text-sm font-medium text-textMain flex items-center gap-1.5">
                  Has Bracket
                  <span className="group relative">
                    <HelpCircle size={14} className="text-white/40 cursor-help" />
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-[#161B22] border border-white/10 text-[10px] text-textMuted rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                      Enables the knockout bracket predictor workspace for players.
                    </span>
                  </span>
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newHasBracket}
                    onChange={(e) => setNewHasBracket(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-textMuted after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-black"></div>
                </label>
              </div>

              <Button type="submit" isLoading={createMutation.isPending} className="w-full">
                Add Tournament
              </Button>
            </form>
          </Card>
        </div>

        {/* Right Column: Tournament Listings and Live Sync triggers */}
        <div className="lg:col-span-2 space-y-6">
          <Card title={<span className="flex items-center gap-2 text-primary"><Trophy size={18} /> Active Tournaments</span>}>
            {tournaments.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-white/5 rounded-xl">
                <Trophy className="mx-auto text-white/15 mb-3" size={40} />
                <p className="text-sm text-textMuted">No tournaments loaded. Seed one or add a new one.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {tournaments.map((tournament) => (
                  <TournamentCard
                    key={tournament.id}
                    tournament={tournament}
                    syncingId={syncingId}
                    syncResults={syncResults}
                    syncErrors={syncErrors}
                    resettingId={resettingId}
                    resetScope={resetScope}
                    resetSuccess={resetSuccess}
                    resetError={resetError}
                    targetedResetMutation={targetedResetMutation}
                    resetMutation={resetMutation}
                    openEditModal={openEditModal}
                    handleTargetedReset={handleTargetedReset}
                    handleTriggerReset={handleTriggerReset}
                    handleTriggerSync={handleTriggerSync}
                  />
                ))}
              </div>
            )}
          </Card>

          {/* Quick instructions / API Sync card */}
          <Card title={<span className="flex items-center gap-2 text-primary"><Database size={16} /> football-data.org Sync</span>}>
            <div className="text-xs text-textMuted leading-relaxed space-y-2">
              <p>
                Match results are fetched from the <strong className="text-white">football-data.org v4 API</strong> (free tier — FIFA World Cup included).
              </p>
              <p>
                The background scheduler polls <code className="text-primary">GET /competitions/WC/matches?status=FINISHED</code> on a configurable interval, applying scores and dispatching grading automatically when matches complete.
              </p>
            </div>
          </Card>
        </div>
      </div>

      {/* Edit Tournament Modal */}
      {editingTournament && (
        <Modal 
          isOpen={true} 
          onClose={() => setEditingTournament(null)}
          title="Configure Tournament"
        >
          <form onSubmit={handleEditSubmit} className="space-y-4">
            {editError && (
              <div className="p-3 bg-danger/15 border border-danger/30 rounded-lg text-danger text-xs flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-textMuted mb-1.5 uppercase tracking-wider">Tournament Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-primary outline-none text-sm"
                required
              />
            </div>

            <div className="flex items-center justify-between border-t border-white/5 pt-4">
              <span className="text-sm font-medium text-textMain">Active Tournament</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-textMuted after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-black"></div>
              </label>
            </div>

            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <span className="text-sm font-medium text-textMain">Knockout Bracket Prediction Mode</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={editHasBracket}
                  onChange={(e) => setEditHasBracket(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-textMuted after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-black"></div>
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setEditingTournament(null)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={editMutation.isPending}>
                Save Configuration
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
