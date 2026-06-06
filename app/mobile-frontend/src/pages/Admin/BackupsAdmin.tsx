import React, { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { apiClient } from '../../api/client';
import {
  Database,
  Upload,
  Download,
  Trash2,
  Settings,
  RefreshCw,
  Check,
  AlertCircle,
  Clock,
  ShieldAlert
} from 'lucide-react';

interface BackupFile {
  filename: string;
  created_at: string;
  size_bytes: number;
}

interface BackupSettings {
  enabled: boolean;
  time: string;
  retention_days: number;
}

interface Tournament {
  id: number;
  name: string;
  is_active: boolean;
  has_bracket: boolean;
}

interface ImportStats {
  match_predictions_imported: number;
  bracket_predictions_imported: number;
  skipped_users: string[];
  skipped_fixtures: string[];
}

export const BackupsAdmin: React.FC = () => {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // UI States
  const [activeTab, setActiveTab] = useState<'backups' | 'predictions'>('backups');
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ message: string; stats: ImportStats } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // 1. Fetch Tournaments
  const { data: tournaments = [] } = useQuery<Tournament[]>({
    queryKey: ['admin', 'backups', 'tournaments'],
    queryFn: async () => {
      const { data } = await apiClient.get('/admin/tournaments');
      if (data && data.length > 0) {
        setSelectedTournamentId(data[0].id);
      }
      return data;
    }
  });

  // 2. Fetch Backups List
  const { data: backups = [], isLoading: isBackupsLoading, refetch: refetchBackups } = useQuery<BackupFile[]>({
    queryKey: ['admin', 'backups', 'list'],
    queryFn: async () => {
      const { data } = await apiClient.get('/admin/backups');
      return data;
    }
  });

  // 3. Fetch Backup Settings
  const { data: settings, isLoading: isSettingsLoading } = useQuery<BackupSettings>({
    queryKey: ['admin', 'backups', 'settings'],
    queryFn: async () => {
      const { data } = await apiClient.get('/admin/backups/settings');
      return data;
    }
  });

  // Settings form states
  const [settingsEnabled, setSettingsEnabled] = useState<boolean>(false);
  const [settingsTime, setSettingsTime] = useState<string>('03:00');
  const [settingsRetention, setSettingsRetention] = useState<number>(7);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // Sync settings form state when data is loaded
  React.useEffect(() => {
    if (settings) {
      setSettingsEnabled(settings.enabled);
      setSettingsTime(settings.time);
      setSettingsRetention(settings.retention_days);
    }
  }, [settings]);

  // Update Settings Mutation
  const updateSettingsMutation = useMutation({
    mutationFn: async (payload: BackupSettings) => {
      const { data } = await apiClient.put('/admin/backups/settings', payload);
      return data;
    },
    onSuccess: () => {
      setSettingsSuccess('Backup settings updated successfully!');
      setSettingsError(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'backups', 'settings'] });
      setTimeout(() => setSettingsSuccess(null), 3000);
    },
    onError: (err: any) => {
      setSettingsError(err.response?.data?.detail || 'Failed to update settings.');
      setSettingsSuccess(null);
    }
  });

  // Create Backup Mutation
  const createBackupMutation = useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post('/admin/backups');
      return data;
    },
    onSuccess: (data) => {
      refetchBackups();
      alert(`Manual backup created successfully!\nFile: ${data.filename}`);
    },
    onError: (err: any) => {
      alert(err.response?.data?.detail || 'Failed to trigger backup.');
    }
  });

  // Delete Backup Mutation
  const deleteBackupMutation = useMutation({
    mutationFn: async (filename: string) => {
      await apiClient.delete(`/admin/backups/${filename}`);
    },
    onSuccess: () => {
      refetchBackups();
    },
    onError: (err: any) => {
      alert(err.response?.data?.detail || 'Failed to delete backup.');
    }
  });

  // Restore Backup Mutation
  const restoreBackupMutation = useMutation({
    mutationFn: async (filename: string) => {
      const { data } = await apiClient.post(`/admin/backups/${filename}/restore`);
      return data;
    },
    onSuccess: () => {
      setRestoreTarget(null);
      setRestoreConfirmText('');
      alert('Database restored successfully! Page will now reload to refresh data.');
      window.location.reload();
    },
    onError: (err: any) => {
      alert(err.response?.data?.detail || 'Failed to restore database backup.');
    }
  });

  // Export Predictions Mutation
  const exportPredictionsMutation = useMutation({
    mutationFn: async (tournamentId: number) => {
      const { data } = await apiClient.get(`/admin/tournaments/${tournamentId}/export-predictions`);
      return data;
    },
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const tournamentName = data.tournament_name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      link.setAttribute('download', `predictions_${tournamentName}_export.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },
    onError: (err: any) => {
      alert(err.response?.data?.detail || 'Failed to export predictions.');
    }
  });

  // Import Predictions Mutation
  const importPredictionsMutation = useMutation({
    mutationFn: async ({ tournamentId, payload }: { tournamentId: number; payload: any }) => {
      const { data } = await apiClient.post(`/admin/tournaments/${tournamentId}/import-predictions`, payload);
      return data;
    },
    onSuccess: (data) => {
      setImportResult(data);
      setImportError(null);
      setImportFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err: any) => {
      setImportError(err.response?.data?.detail || 'Failed to import predictions. Verify the file format.');
      setImportResult(null);
    }
  });

  const handleSettingsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettingsMutation.mutate({
      enabled: settingsEnabled,
      time: settingsTime,
      retention_days: settingsTime ? settingsRetention : 7
    });
  };

  const handleDeleteBackup = (filename: string) => {
    if (window.confirm(`Are you sure you want to permanently delete the backup file "${filename}"?`)) {
      deleteBackupMutation.mutate(filename);
    }
  };

  const handleRestoreBackupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!restoreTarget) return;
    if (restoreConfirmText !== 'RESTORE') {
      alert('Please type RESTORE in capitals to confirm.');
      return;
    }
    restoreBackupMutation.mutate(restoreTarget);
  };

  const handleExport = () => {
    if (!selectedTournamentId) return;
    exportPredictionsMutation.mutate(selectedTournamentId);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setImportFile(e.target.files[0]);
      setImportResult(null);
      setImportError(null);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTournamentId || !importFile) return;

    try {
      const fileText = await importFile.text();
      const payload = JSON.parse(fileText);
      importPredictionsMutation.mutate({ tournamentId: selectedTournamentId, payload });
    } catch (err) {
      setImportError('Invalid JSON file. Please verify the content.');
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDateTime = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString();
    } catch {
      return isoString;
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 py-4">
      <div>
        <h1 className="text-3xl font-bold text-textMain tracking-tight">System Backups & Data Transfer</h1>
        <p className="text-textMuted mt-1">Manage database-level PostgreSQL dumps, schedule automated cleanups, and export/import prediction datasets.</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5 overflow-x-auto flex-nowrap no-scrollbar">
        <button
          onClick={() => setActiveTab('backups')}
          className={`flex items-center gap-2 px-6 py-3 border-b-2 font-medium text-sm transition-all duration-200 whitespace-nowrap ${
            activeTab === 'backups'
              ? 'border-primary text-primary bg-primary/5'
              : 'border-transparent text-textMuted hover:text-white hover:bg-white/5'
          }`}
        >
          <Database size={16} />
          System Database Backups
        </button>
        <button
          onClick={() => setActiveTab('predictions')}
          className={`flex items-center gap-2 px-6 py-3 border-b-2 font-medium text-sm transition-all duration-200 whitespace-nowrap ${
            activeTab === 'predictions'
              ? 'border-primary text-primary bg-primary/5'
              : 'border-transparent text-textMuted hover:text-white hover:bg-white/5'
          }`}
        >
          <Upload size={16} />
          Prediction Import/Export (JSON)
        </button>
      </div>

      {activeTab === 'backups' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start animate-fadeIn">
          {/* Scheduling Configuration */}
          <div className="lg:col-span-1">
            <Card title={<span className="flex items-center gap-2 text-primary"><Settings size={18} /> Backup Schedule</span>}>
              {isSettingsLoading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary"></div>
                </div>
              ) : (
                <form onSubmit={handleSettingsSubmit} className="space-y-4">
                  {settingsSuccess && (
                    <div className="p-3 bg-success/15 border border-success/30 rounded-lg text-success text-xs flex items-center gap-2">
                      <Check size={14} className="shrink-0" />
                      <span>{settingsSuccess}</span>
                    </div>
                  )}
                  {settingsError && (
                    <div className="p-3 bg-danger/15 border border-danger/30 rounded-lg text-danger text-xs flex items-center gap-2">
                      <AlertCircle size={14} className="shrink-0" />
                      <span>{settingsError}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between border-b border-white/5 pb-4">
                    <span className="text-sm font-medium text-textMain">Automated Backups</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settingsEnabled}
                        onChange={(e) => setSettingsEnabled(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-textMuted after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-black"></div>
                    </label>
                  </div>

                  <div className={settingsEnabled ? 'space-y-4' : 'opacity-40 pointer-events-none space-y-4'}>
                    <div>
                      <label className="block text-xs font-semibold text-textMuted mb-1 uppercase tracking-wider flex items-center gap-1.5">
                        <Clock size={12} /> Backup Time (UTC)
                      </label>
                      <input
                        type="text"
                        value={settingsTime}
                        onChange={(e) => setSettingsTime(e.target.value)}
                        placeholder="03:00"
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-primary outline-none text-sm font-mono"
                        required={settingsEnabled}
                      />
                      <p className="text-[10px] text-textMuted mt-1">Specify backup execution time in 24-hour HH:MM format.</p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-textMuted mb-1.5 uppercase tracking-wider">Retention Period (Days)</label>
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={settingsRetention}
                        onChange={(e) => setSettingsRetention(parseInt(e.target.value) || 7)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-primary outline-none text-sm font-mono"
                        required={settingsEnabled}
                      />
                      <p className="text-[10px] text-textMuted mt-1">Backups older than this count will be auto-deleted.</p>
                    </div>
                  </div>

                  <Button type="submit" isLoading={updateSettingsMutation.isPending} className="w-full">
                    Save Schedule Settings
                  </Button>
                </form>
              )}
            </Card>
          </div>

          {/* Backup Files Directory */}
          <div className="lg:col-span-2 space-y-6">
            <Card
              title={<span className="flex items-center gap-2 text-primary"><Database size={18} /> SQL Dump History</span>}
              headerExtra={
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => refetchBackups()}
                    className="text-xs"
                  >
                    <RefreshCw size={12} className="mr-1.5" />
                    Refresh
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => createBackupMutation.mutate()}
                    isLoading={createBackupMutation.isPending}
                    className="text-xs"
                  >
                    Backup Now
                  </Button>
                </div>
              }
            >
              {isBackupsLoading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
                </div>
              ) : backups.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-white/5 rounded-xl">
                  <Database className="mx-auto text-white/15 mb-3" size={40} />
                  <p className="text-sm text-textMuted">No backup files found. Click "Backup Now" to create one.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 text-xs text-textMuted font-bold uppercase tracking-wider">
                        <th className="pb-3 pl-2">Backup File Name</th>
                        <th className="pb-3">Created At (Local)</th>
                        <th className="pb-3 text-right">File Size</th>
                        <th className="pb-3 text-right pr-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backups.map((backup) => (
                        <tr key={backup.filename} className="border-b border-white/5 text-sm hover:bg-white/[0.02] transition-colors">
                          <td className="py-3.5 pl-2 font-mono text-xs text-textMain max-w-[200px] truncate" title={backup.filename}>
                            {backup.filename}
                          </td>
                          <td className="py-3.5 text-textMuted text-xs">
                            {formatDateTime(backup.created_at)}
                          </td>
                          <td className="py-3.5 text-right text-xs font-mono font-semibold text-textMain">
                            {formatBytes(backup.size_bytes)}
                          </td>
                          <td className="py-3.5 text-right pr-2">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setRestoreTarget(backup.filename)}
                                className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-xs px-2 py-1"
                              >
                                Restore
                              </Button>
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => handleDeleteBackup(backup.filename)}
                                className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs px-2 py-1"
                              >
                                <Trash2 size={12} />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'predictions' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start animate-fadeIn">
          {/* Tournament Selection & Actions */}
          <div className="lg:col-span-1 space-y-6">
            <Card title={<span className="flex items-center gap-2 text-primary"><Settings size={18} /> Select Scoped Tournament</span>}>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1.5 uppercase tracking-wider">Tournament Scope</label>
                  <select
                    value={selectedTournamentId || ''}
                    onChange={(e) => setSelectedTournamentId(parseInt(e.target.value) || null)}
                    className="w-full bg-black/45 border border-white/10 rounded-lg px-3 py-2.5 text-white focus:ring-1 focus:ring-primary outline-none text-sm"
                  >
                    {tournaments.map((t) => (
                      <option key={t.id} value={t.id} className="bg-[#121212]">
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pt-2 border-t border-white/5">
                  <h4 className="text-xs font-bold text-textMuted uppercase tracking-wider mb-2">Export Data</h4>
                  <p className="text-[11px] text-textMuted leading-relaxed mb-3">
                    Downloads all user match predictions and group/KO bracket predictions for this tournament as a single structured JSON file.
                  </p>
                  <Button
                    onClick={handleExport}
                    disabled={!selectedTournamentId}
                    isLoading={exportPredictionsMutation.isPending}
                    className="w-full flex items-center justify-center gap-2"
                  >
                    <Download size={14} />
                    Export Predictions JSON
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          {/* Import JSON Form */}
          <div className="lg:col-span-2 space-y-6">
            <Card title={<span className="flex items-center gap-2 text-primary"><Upload size={18} /> Import Prediction File</span>}>
              <form onSubmit={handleImportSubmit} className="space-y-4">
                {importError && (
                  <div className="p-3 bg-danger/15 border border-danger/30 rounded-lg text-danger text-xs flex items-center gap-2">
                    <AlertCircle size={14} className="shrink-0" />
                    <span>{importError}</span>
                  </div>
                )}

                <div className="border-2 border-dashed border-white/10 rounded-xl p-6 text-center hover:border-primary/40 transition-colors bg-black/20">
                  <Upload className="mx-auto text-white/25 mb-2" size={32} />
                  <span className="block text-sm text-textMain font-medium mb-1">
                    {importFile ? importFile.name : 'Select or drop JSON file'}
                  </span>
                  <span className="block text-xs text-textMuted mb-3">
                    {importFile ? `${formatBytes(importFile.size)}` : 'Must be a valid prediction export file'}
                  </span>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".json,application/json"
                    onChange={handleFileChange}
                    className="hidden"
                    id="prediction-json-upload"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs"
                  >
                    Choose File
                  </Button>
                </div>

                <div className="flex justify-end gap-3">
                  <Button
                    type="submit"
                    disabled={!selectedTournamentId || !importFile}
                    isLoading={importPredictionsMutation.isPending}
                    className="w-full sm:w-auto px-6"
                  >
                    ⚡ Import Predictions Data
                  </Button>
                </div>
              </form>

              {/* Import Results */}
              {importResult && (
                <div className="p-4 bg-success/5 border border-success/15 rounded-lg space-y-3 mt-4">
                  <h5 className="text-xs font-bold text-success flex items-center gap-1.5">
                    <Check size={14} /> Import Completed Successfully
                  </h5>
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="bg-black/50 p-2.5 rounded border border-white/5">
                      <div className="text-[10px] text-textMuted uppercase tracking-wider font-semibold">Match Predictions</div>
                      <div className="text-lg font-mono font-bold mt-0.5 text-emerald-400">
                        {importResult.stats.match_predictions_imported}
                      </div>
                    </div>
                    <div className="bg-black/50 p-2.5 rounded border border-white/5">
                      <div className="text-[10px] text-textMuted uppercase tracking-wider font-semibold">Bracket Predictions</div>
                      <div className="text-lg font-mono font-bold mt-0.5 text-emerald-400">
                        {importResult.stats.bracket_predictions_imported}
                      </div>
                    </div>
                  </div>

                  {/* Warning stats */}
                  {(importResult.stats.skipped_users.length > 0 || importResult.stats.skipped_fixtures.length > 0) && (
                    <div className="pt-3 border-t border-white/5 space-y-2 text-xs text-textMuted leading-relaxed">
                      <div className="font-semibold text-textMain flex items-center gap-1.5 text-warning">
                        <AlertCircle size={13} /> Review Skipped Entities:
                      </div>
                      {importResult.stats.skipped_users.length > 0 && (
                        <div>
                          <strong className="text-white/80">Users skipped ({importResult.stats.skipped_users.length}):</strong>
                          <div className="font-mono text-[10px] mt-1 bg-black/40 p-2 rounded max-h-[80px] overflow-y-auto truncate">
                            {importResult.stats.skipped_users.join(', ')}
                          </div>
                          <p className="text-[10px] text-textMuted mt-0.5">These emails do not exist in the database and their predictions were omitted.</p>
                        </div>
                      )}
                      {importResult.stats.skipped_fixtures.length > 0 && (
                        <div>
                          <strong className="text-white/80">Fixtures skipped ({importResult.stats.skipped_fixtures.length}):</strong>
                          <div className="font-mono text-[10px] mt-1 bg-black/40 p-2 rounded max-h-[80px] overflow-y-auto truncate">
                            {importResult.stats.skipped_fixtures.join(', ')}
                          </div>
                          <p className="text-[10px] text-textMuted mt-0.5">These external fixture IDs do not match the seeder structure of this tournament.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* Database Restore Confirmation Modal */}
      {restoreTarget && (
        <Modal
          isOpen={true}
          onClose={() => {
            setRestoreTarget(null);
            setRestoreConfirmText('');
          }}
          title="Destructive Database Restore"
        >
          <form onSubmit={handleRestoreBackupSubmit} className="space-y-4">
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2.5 text-red-400">
              <ShieldAlert size={18} className="shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <span className="font-bold">CRITICAL WARNING:</span>
                <p className="leading-relaxed">
                  Restoring database from a backup will <strong className="text-white">WIPE ALL CURRENT DATABASE STATE</strong>, terminate all active user sessions, drop the tables, and rebuild the database from the selected dump file.
                </p>
                <p>This action is instantaneous and cannot be undone.</p>
              </div>
            </div>

            <div>
              <p className="text-xs text-textMuted mb-2">
                Selected Backup File: <span className="font-mono text-white text-xs">{restoreTarget}</span>
              </p>
              <label className="block text-xs font-semibold text-textMuted mb-1.5 uppercase tracking-wider">
                Type <strong className="text-red-400">RESTORE</strong> below to confirm
              </label>
              <input
                type="text"
                value={restoreConfirmText}
                onChange={(e) => setRestoreConfirmText(e.target.value)}
                placeholder="RESTORE"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-primary outline-none text-sm font-mono tracking-widest text-center"
                required
              />
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-white/5">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setRestoreTarget(null);
                  setRestoreConfirmText('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={restoreConfirmText !== 'RESTORE'}
                isLoading={restoreBackupMutation.isPending}
                className="bg-red-500 text-black hover:bg-red-400 border border-transparent font-semibold"
              >
                Execute Destructive Restore
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
