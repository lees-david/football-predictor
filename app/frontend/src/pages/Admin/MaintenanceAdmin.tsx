import React, { useEffect, useRef, useState } from 'react';
import { ShieldAlert, Users, GitBranch, Terminal, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

interface MaintenanceStatus {
  schedule: {
    active: boolean;
    start_time: string;
    end_time: string;
    message: string;
    auto_enabled: boolean;
    preferred_time: string;
    git_check_interval?: number;
  };
  active_users: number;
  git: {
    local_hash?: string;
    remote_hash?: string;
    up_to_date: boolean;
    error?: string;
  };
}

interface ActiveUser {
  id: number;
  email: string;
  display_name: string;
  last_active: string;
}

export const MaintenanceAdmin: React.FC = () => {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [message, setMessage] = useState('');
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [preferredTime, setPreferredTime] = useState('03:00');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Git version check interval (in minutes), persisted in state
  const [gitCheckIntervalMins, setGitCheckIntervalMins] = useState(10);
  const gitIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tracks which remote hash has already been auto-triggered to prevent repeated calls
  const autoTriggeredHashRef = useRef<string | null>(null);

  // Fetch status info
  const { data: statusData, isLoading, refetch } = useQuery<MaintenanceStatus>({
    queryKey: ['admin-maintenance-status'],
    queryFn: () => apiClient.get('/maintenance/admin/status').then((r) => r.data),
    refetchInterval: 10000, // Poll active users & status every 10s
  });

  // Fetch logs
  const { data: logData, refetch: refetchLogs } = useQuery<{ logs: string }>({
    queryKey: ['admin-maintenance-logs'],
    queryFn: () => apiClient.get('/maintenance/admin/logs').then((r) => r.data),
  });

  const [isUsersModalOpen, setIsUsersModalOpen] = useState(false);

  // Fetch active users list on demand
  const { data: activeUsersList = [], isLoading: isLoadingUsers, refetch: refetchActiveUsers } = useQuery<ActiveUser[]>({
    queryKey: ['admin-active-users-list'],
    queryFn: () => apiClient.get('/maintenance/admin/active-users').then((r) => r.data),
    enabled: isUsersModalOpen,
    refetchInterval: isUsersModalOpen ? 10000 : false,
  });

  // Force refetch of active users list when modal opens
  useEffect(() => {
    if (isUsersModalOpen) {
      refetchActiveUsers();
    }
  }, [isUsersModalOpen, refetchActiveUsers]);

  // Set up independent Git version check interval
  useEffect(() => {
    // Clear any existing timer
    if (gitIntervalRef.current) {
      clearInterval(gitIntervalRef.current);
    }
    const ms = Math.max(1, gitCheckIntervalMins) * 60 * 1000;
    gitIntervalRef.current = setInterval(() => {
      refetch();
    }, ms);
    return () => {
      if (gitIntervalRef.current) {
        clearInterval(gitIntervalRef.current);
      }
    };
  }, [gitCheckIntervalMins, refetch]);

  // Auto-trigger update when updates are available and nobody is online
  useEffect(() => {
    if (!statusData) return;
    const { git, active_users, schedule } = statusData;
    const remoteHash = git?.remote_hash;
    const isUpdateAvailable =
      !git?.up_to_date &&
      git?.local_hash?.toLowerCase() !== 'unknown' &&
      !!remoteHash &&
      remoteHash.toLowerCase() !== 'unknown';
    const noUsersOnline = active_users === 0;
    const noUpdateQueued = !schedule?.start_time;
    const alreadyTriggered = autoTriggeredHashRef.current === remoteHash;

    if (isUpdateAvailable && noUsersOnline && noUpdateQueued && !alreadyTriggered && !queueUpdateMutation.isPending) {
      autoTriggeredHashRef.current = remoteHash ?? null;
      queueUpdateMutation.mutate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusData]);

  const formatLastActive = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return 'Unknown';
    }
  };

  // Sync inputs with fetched state
  useEffect(() => {
    if (statusData?.schedule) {
      setEnabled(statusData.schedule.active);
      setStartTime(statusData.schedule.start_time ? statusData.schedule.start_time.substring(0, 16) : '');
      setEndTime(statusData.schedule.end_time ? statusData.schedule.end_time.substring(0, 16) : '');
      setMessage(statusData.schedule.message || '');
      setAutoEnabled(statusData.schedule.auto_enabled || false);
      setPreferredTime(statusData.schedule.preferred_time || '03:00');
      if (statusData.schedule.git_check_interval !== undefined) {
        setGitCheckIntervalMins(statusData.schedule.git_check_interval);
      }
    }
  }, [statusData]);

  const [queueSuccessMsg, setQueueSuccessMsg] = useState('');
  const [queueErrorMsg, setQueueErrorMsg] = useState('');

  // Update Settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: (payload: any) => apiClient.put('/maintenance/admin/settings', payload),
    onSuccess: () => {
      setSuccessMsg('Maintenance settings saved successfully!');
      setErrorMsg('');
      queryClient.invalidateQueries({ queryKey: ['admin-maintenance-status'] });
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.detail || 'Failed to save maintenance settings.');
      setSuccessMsg('');
    },
  });

  // Queue Immediate Update mutation
  const queueUpdateMutation = useMutation({
    mutationFn: () => apiClient.post('/maintenance/admin/queue-update'),
    onSuccess: () => {
      setQueueSuccessMsg('Update successfully queued! Restart pending...');
      setQueueErrorMsg('');
      queryClient.invalidateQueries({ queryKey: ['admin-maintenance-status'] });
      setTimeout(() => setQueueSuccessMsg(''), 5000);
    },
    onError: (err: any) => {
      setQueueErrorMsg(err.response?.data?.detail || 'Failed to queue update.');
      setQueueSuccessMsg('');
    },
  });

  // Trigger Git Check mutation
  const triggerGitCheckMutation = useMutation({
    mutationFn: () => apiClient.post('/maintenance/admin/check-git'),
    onSuccess: (data: any) => {
      setSuccessMsg(data.data?.message || 'Git check flagged. Waiting for host execution...');
      setErrorMsg('');
      queryClient.invalidateQueries({ queryKey: ['admin-maintenance-status'] });
      setTimeout(() => setSuccessMsg(''), 5000);
      setTimeout(() => refetch(), 8000);
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.detail || 'Failed to trigger Git check.');
      setSuccessMsg('');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Convert to ISO-8601 UTC for API
    let startIso = '';
    let endIso = '';
    
    if (startTime) {
      try {
        startIso = new Date(startTime).toISOString();
      } catch (err) {}
    }
    if (endTime) {
      try {
        endIso = new Date(endTime).toISOString();
      } catch (err) {}
    }

    updateSettingsMutation.mutate({
      enabled,
      start_time: startIso,
      end_time: endIso,
      message,
      auto_enabled: autoEnabled,
      preferred_time: preferredTime,
      git_check_interval: gitCheckIntervalMins
    });
  };

  if (isLoading) {
    return <div className="text-textMuted p-6">Loading maintenance controls...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-2">
            <ShieldAlert size={28} className="text-amber-500" />
            System Maintenance & Logs
          </h1>
          <p className="text-textMuted mt-1">
            Configure automated update windows, review active user sessions, and inspect deployment logs.
          </p>
        </div>
        <Button onClick={() => { refetch(); refetchLogs(); }} variant="secondary">
          Refresh Metrics
        </Button>
      </div>

      {/* Grid containing Quick Stats & Config */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Stats & Updates */}
        <div className="space-y-6 lg:col-span-1">
          {/* Active Users */}
          <div onClick={() => setIsUsersModalOpen(true)} className="cursor-pointer group">
            <Card title={
              <span className="flex items-center justify-between w-full text-emerald-400">
                <span className="flex items-center gap-2"><Users size={18} /> Active Users</span>
                <span className="text-xs font-bold text-textMuted group-hover:text-emerald-400 transition-colors uppercase tracking-wider">Click to view list &rarr;</span>
              </span>
            }>
              <div className="py-4">
                <span className="text-5xl font-black text-white">{statusData?.active_users ?? 0}</span>
                <p className="text-sm text-textMuted mt-2">
                  Stateless sessions tracked via API activity heartbeats in the last 5 minutes.
                </p>
              </div>
            </Card>
          </div>

          {/* Git Version Diff Status */}
          <Card title={<span className="flex items-center gap-2 text-primary"><GitBranch size={18} /> Git Version Control</span>}>
            <div className="space-y-4 py-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-textMuted">Local Commit:</span>
                <span className="font-mono text-white bg-slate-800 px-2 py-0.5 rounded text-xs">
                  {statusData?.git?.local_hash || 'Unknown'}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-textMuted">Remote Commit:</span>
                <span className="font-mono text-white bg-slate-800 px-2 py-0.5 rounded text-xs">
                  {statusData?.git?.remote_hash || 'Unknown'}
                </span>
              </div>

              {/* Configurable check interval */}
              <div className="flex items-center gap-2 p-3 bg-slate-800/30 border border-white/5 rounded-xl">
                <Clock size={14} className="text-textMuted flex-shrink-0" />
                <label htmlFor="gitCheckInterval" className="text-xs text-textMuted whitespace-nowrap">Check every</label>
                <input
                  id="gitCheckInterval"
                  type="number"
                  min={1}
                  max={60}
                  value={gitCheckIntervalMins}
                  onChange={(e) => setGitCheckIntervalMins(Math.max(1, parseInt(e.target.value, 10) || 10))}
                  className="w-14 bg-slate-800/50 border border-white/10 rounded-lg px-2 py-1 text-xs text-white text-center focus:outline-none focus:border-primary"
                />
                <span className="text-xs text-textMuted mr-1">min(s)</span>
                {gitCheckIntervalMins !== (statusData?.schedule?.git_check_interval ?? 10) && (
                  <Button
                    onClick={() => {
                      let startIso = '';
                      let endIso = '';
                      if (startTime) {
                        try { startIso = new Date(startTime).toISOString(); } catch (err) {}
                      }
                      if (endTime) {
                        try { endIso = new Date(endTime).toISOString(); } catch (err) {}
                      }
                      updateSettingsMutation.mutate({
                        enabled,
                        start_time: startIso,
                        end_time: endIso,
                        message,
                        auto_enabled: autoEnabled,
                        preferred_time: preferredTime,
                        git_check_interval: gitCheckIntervalMins
                      });
                    }}
                    isLoading={updateSettingsMutation.isPending}
                    variant="primary"
                    className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
                  >
                    Save
                  </Button>
                )}
                <Button
                  onClick={() => triggerGitCheckMutation.mutate()}
                  isLoading={triggerGitCheckMutation.isPending}
                  variant="secondary"
                  className="ml-auto px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
                >
                  Check Now
                </Button>
              </div>

              {statusData?.git?.error ? (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2 text-red-400 text-xs">
                  <AlertCircle size={14} className="flex-shrink-0" />
                  <span>{statusData.git.error}</span>
                </div>
              ) : (statusData?.git?.local_hash?.toLowerCase() === 'unknown' || !statusData?.git?.local_hash) ? (
                <div className="p-3 bg-slate-500/10 border border-slate-500/20 rounded-xl flex items-center gap-2 text-slate-400 text-xs font-semibold">
                  <AlertCircle size={14} className="flex-shrink-0" />
                  <span>Version status pending host execution...</span>
                </div>
              ) : statusData?.git?.up_to_date ? (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                  <CheckCircle2 size={14} className="flex-shrink-0" />
                  <span>System is up to date (no remote changes).</span>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-2 text-amber-400 text-xs font-semibold animate-pulse">
                    <AlertCircle size={14} className="flex-shrink-0" />
                    <span>New updates available on origin/main!</span>
                  </div>

                  {/* Auto-trigger notice / manual button / blocked message */}
                  {statusData?.active_users === 0 && !statusData?.schedule?.start_time ? (
                    <div className="pt-2 border-t border-white/5 space-y-2">
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2 text-emerald-400 text-xs font-semibold animate-pulse justify-center">
                        <CheckCircle2 size={14} className="flex-shrink-0" />
                        <span>No users online — update queued automatically!</span>
                      </div>
                      <p className="text-[10px] text-textMuted text-center">
                        System will lock down, pull changes, and restart on the next host execution (within 5 minutes).
                      </p>
                    </div>
                  ) : statusData?.active_users === 1 && !statusData?.schedule?.start_time ? (
                    <div className="pt-2 border-t border-white/5 space-y-2">
                      <Button
                        onClick={() => queueUpdateMutation.mutate()}
                        isLoading={queueUpdateMutation.isPending}
                        variant="primary"
                        className="w-full text-xs py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black font-extrabold"
                      >
                        Queue Immediate Update & Restart
                      </Button>
                      <p className="text-[10px] text-textMuted text-center">
                        Only you are online. System will lock down, pull changes, and restart on the next host execution (within 5 minutes).
                      </p>
                    </div>
                  ) : statusData?.schedule?.start_time ? (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-2 text-amber-400 text-xs font-semibold animate-pulse mt-2 justify-center">
                      <AlertCircle size={14} className="flex-shrink-0" />
                      <span>Update queued. Restart pending on host...</span>
                    </div>
                  ) : (
                    <p className="text-[10px] text-textMuted text-center pt-2 border-t border-white/5">
                      Cannot trigger auto-update — {statusData.active_users} users are currently online.
                    </p>
                  )}
                </div>
              )}

              {queueSuccessMsg && (
                <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs font-semibold text-center animate-pulse mt-2">
                  {queueSuccessMsg}
                </div>
              )}
              {queueErrorMsg && (
                <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-semibold text-center mt-2">
                  {queueErrorMsg}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right Column: Scheduler Form */}
        <div className="lg:col-span-2">
          <Card title={<span className="flex items-center gap-2 text-amber-500"><ShieldAlert size={18} /> Maintenance Configuration</span>}>
            <form onSubmit={handleSubmit} className="space-y-6">
              {successMsg && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center gap-2 text-emerald-400 text-sm">
                  <CheckCircle2 size={16} />
                  <span>{successMsg}</span>
                </div>
              )}
              {errorMsg && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle size={16} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* SECTION A: AUTOMATED CHECKS */}
              <div className="space-y-4 border-b border-white/5 pb-6">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Automated Daily Maintenance</h3>
                
                <div className="flex items-center gap-3 p-3 bg-slate-800/20 border border-white/5 rounded-2xl">
                  <input
                    type="checkbox"
                    id="autoEnabled"
                    checked={autoEnabled}
                    onChange={(e) => setAutoEnabled(e.target.checked)}
                    className="w-4 h-4 text-primary bg-slate-800 border-white/10 rounded focus:ring-primary focus:ring-offset-slate-900"
                  />
                  <label htmlFor="autoEnabled" className="text-sm font-semibold text-white cursor-pointer select-none">
                    Enable Automated Daily Update Checks
                  </label>
                </div>

                {autoEnabled && (
                  <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-200">
                    <label className="text-xs font-bold text-textMuted uppercase tracking-wider">
                      Preferred Daily Check Time (HH:MM / Server Timezone)
                    </label>
                    <input
                      type="time"
                      value={preferredTime}
                      onChange={(e) => setPreferredTime(e.target.value)}
                      className="w-full md:w-1/3 bg-slate-800/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary"
                    />
                    <p className="text-xs text-textMuted leading-relaxed">
                      If updates are found at this time, the system will schedule a 15-minute warnings banner for users before running the offline pull and reload.
                    </p>
                  </div>
                )}
              </div>

              {/* SECTION B: EMERGENCY & MANUAL WINDOWS */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Manual & Emergency Override</h3>

                <div className="flex items-center gap-3 p-3 bg-red-500/5 border border-red-500/10 rounded-2xl">
                  <input
                    type="checkbox"
                    id="enabled"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="w-4 h-4 text-red-500 bg-slate-800 border-white/10 rounded focus:ring-red-500 focus:ring-offset-slate-900"
                  />
                  <label htmlFor="enabled" className="text-sm font-semibold text-white cursor-pointer select-none">
                    Force Emergency Maintenance Block Immediately
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-textMuted uppercase tracking-wider">Manual Start Time (Optional)</label>
                    <input
                      type="datetime-local"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full bg-slate-800/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-textMuted uppercase tracking-wider">Manual End Time (Optional)</label>
                    <input
                      type="datetime-local"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full bg-slate-800/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 pt-2">
                <label className="text-xs font-bold text-textMuted uppercase tracking-wider">User Warning Message</label>
                <textarea
                  rows={2}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Explain the maintenance context to users..."
                  className="w-full bg-slate-800/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary resize-none"
                />
              </div>

              <Button type="submit" isLoading={updateSettingsMutation.isPending} className="w-full">
                Save Maintenance Settings
              </Button>
            </form>
          </Card>
        </div>
      </div>

      {/* Deploy/Pull Logs terminal view */}
      <Card title={<span className="flex items-center gap-2 text-textMuted"><Terminal size={18} /> Automated Pull Logs (`auto_deploy.log`)</span>}>
        <div className="bg-[#090D13] border border-white/5 rounded-2xl p-4 font-mono text-xs text-textMuted overflow-x-auto max-h-96 overflow-y-auto space-y-1">
          {logData?.logs ? (
            <pre className="whitespace-pre-wrap leading-relaxed text-slate-300">{logData.logs}</pre>
          ) : (
            <div className="text-center py-8">No automated deployment logs populated on the host yet.</div>
          )}
        </div>
      </Card>

      {/* Active Users Modal */}
      <Modal
        isOpen={isUsersModalOpen}
        onClose={() => setIsUsersModalOpen(false)}
        title="Currently Logged In / Active Users"
      >
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs text-textMuted font-bold uppercase tracking-wider">
              Seen in the last 5 minutes
            </span>
            <Button onClick={() => refetchActiveUsers()} variant="secondary" className="px-3 py-1 text-xs">
              Refresh List
            </Button>
          </div>

          <div className="max-h-96 overflow-y-auto border border-white/5 rounded-2xl bg-[#090D13]">
            {isLoadingUsers ? (
              <div className="p-8 text-center text-sm text-textMuted">Loading active profiles...</div>
            ) : activeUsersList.length === 0 ? (
              <div className="p-8 text-center text-sm text-textMuted">No active user sessions found.</div>
            ) : (
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-textMuted font-semibold text-xs tracking-wider uppercase bg-white/2 hover:bg-transparent">
                    <th className="p-4">Display Name</th>
                    <th className="p-4">Email</th>
                    <th className="p-4 text-right">Last Request</th>
                  </tr>
                </thead>
                <tbody>
                  {activeUsersList.map((usr) => (
                    <tr key={usr.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                      <td className="p-4 text-white font-medium">{usr.display_name}</td>
                      <td className="p-4 text-textMuted font-mono text-xs">{usr.email}</td>
                      <td className="p-4 text-right text-emerald-400 font-mono text-xs">
                        {formatLastActive(usr.last_active)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={() => setIsUsersModalOpen(false)} className="px-6">
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
