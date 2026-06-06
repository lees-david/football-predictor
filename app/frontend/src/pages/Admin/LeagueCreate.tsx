import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { apiClient } from '../../api/client';
import { 
  Trophy, 
  Plus, 
  Trash2, 
  Upload, 
  Copy, 
  Check, 
  AlertCircle, 
  Settings, 
  Image as ImageIcon,
  Link as LinkIcon
} from 'lucide-react';

interface League {
  id: number;
  name: string;
  invite_token: string;
  created_by: number;
  is_active: boolean;
  logo_url?: string | null;
  member_count?: number;
}

interface Invitation {
  token: string;
  league_id: number;
  league_name: string;
  created_at: string;
}

interface SettingItem {
  key: string;
  value: string;
}

import { useTournamentContext } from '../../api/TournamentContext';
import { useMe } from '../../api/hooks/useAuth';

const copyToClipboard = (text: string): boolean => {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn("Secure clipboard failed, using fallback:", err);
    }
  }

  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error("Textarea copy fallback failed:", err);
    return false;
  }
};

export const LeagueCreate: React.FC = () => {
  const queryClient = useQueryClient();
  const { selectedTournamentId } = useTournamentContext();
  const { data: me } = useMe();
  const isAdmin = me?.role === 'admin';

  // Create form states
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdInfo, setCreatedInfo] = useState<{ name: string; token: string } | null>(null);

  // File Upload / copied token states
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<Record<number, string>>({});
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Fetch all leagues for active tournament
  const { data: leagues = [], isLoading } = useQuery<League[]>({
    queryKey: ['admin-leagues', { selectedTournamentId }],
    queryFn: async () => {
      const { data } = await apiClient.get('/leagues', {
        params: selectedTournamentId ? { tournament_id: selectedTournamentId } : undefined
      });
      return data;
    },
    enabled: !!selectedTournamentId
  });

  // Fetch all pending invitations (moved from UserManagement)
  const { data: invitations = [] } = useQuery<Invitation[]>({
    queryKey: ['admin-invitations'],
    queryFn: async () => {
      const { data } = await apiClient.get('/admin/invitations');
      return data;
    },
    staleTime: 30_000,
    enabled: isAdmin || !!me?.can_manage_leagues,
  });

  // Fetch settings for Site Address
  const { data: settings = [] } = useQuery<SettingItem[]>({
    queryKey: ['admin-settings'],
    queryFn: async () => {
      const { data } = await apiClient.get<SettingItem[]>('/admin/settings');
      return data;
    },
    staleTime: 60_000,
    enabled: isAdmin,
  });

  const siteAddress = settings.find(s => s.key === 'site_address')?.value || 'worldcup.leeshomeserver.com';

  // Settings Panel States & Mutation
  const [siteAddrInput, setSiteAddrInput] = useState('');
  const [syncIntervalInput, setSyncIntervalInput] = useState('5');
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    if (settings && settings.length > 0) {
      const addr = settings.find(s => s.key === 'site_address')?.value;
      if (addr) setSiteAddrInput(addr);
      
      const interval = settings.find(s => s.key === 'live_sync_interval')?.value;
      if (interval) setSyncIntervalInput(interval);
    }
  }, [settings]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (payload: { site_address: string, live_sync_interval: string }) => {
      await apiClient.put('/admin/settings', payload);
    },
    onSuccess: () => {
      setSettingsSuccess(true);
      setSettingsError(null);
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      setTimeout(() => setSettingsSuccess(false), 2000);
    },
    onError: (err: any) => {
      setSettingsError(err.response?.data?.detail || 'Failed to update settings.');
    }
  });

  const handleSettingsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettingsMutation.mutate({
      site_address: siteAddrInput,
      live_sync_interval: syncIntervalInput
    });
  };


  // Create League Mutation
  const createMutation = useMutation({
    mutationFn: async (leagueName: string) => {
      const { data } = await apiClient.post('/leagues', { name: leagueName, tournament_id: selectedTournamentId });
      return data;
    },
    onSuccess: (data) => {
      setCreatedInfo({ name: data.name, token: data.invite_token });
      setCreateError(null);
      setName('');
      queryClient.invalidateQueries({ queryKey: ['admin-leagues'] });
      queryClient.invalidateQueries({ queryKey: ['leagues'] });
      queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
    },
    onError: (err: any) => {
      setCreateError(err.response?.data?.detail || 'Failed to create league.');
      setCreatedInfo(null);
    }
  });

  // Delete League Mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/leagues/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-leagues'] });
      queryClient.invalidateQueries({ queryKey: ['leagues'] });
      queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
    },
    onError: (err: any) => {
      alert(err.response?.data?.detail || 'Failed to delete league.');
    }
  });

  // Revoke Invitation Mutation
  const revokeMutation = useMutation({
    mutationFn: async (token: string) => {
      await apiClient.delete(`/admin/invitations/${token}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
    }
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreatedInfo(null);
    createMutation.mutate(name);
  };

  const handleFileChange = async (leagueId: number, file: File) => {
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/gif'];
    if (!allowed.includes(file.type)) {
      setUploadError(prev => ({ 
        ...prev, 
        [leagueId]: 'Invalid format. Use PNG, JPG, JPEG, SVG, or GIF.' 
      }));
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    setUploadingId(leagueId);
    setUploadError(prev => {
      const copy = { ...prev };
      delete copy[leagueId];
      return copy;
    });

    try {
      const { data } = await apiClient.post(`/leagues/${leagueId}/logo`, formData, {
        headers: { 'Content-Type': undefined },
      });
      // Update the cached league list directly so the logo shows immediately
      queryClient.setQueryData(
        ['admin-leagues', { selectedTournamentId }],
        (old: League[] | undefined) =>
          old ? old.map(l => l.id === leagueId ? { ...l, logo_url: data.logo_url } : l) : old
      );
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const errorMsg =
          typeof detail === 'string'
            ? detail
            : Array.isArray(detail)
            ? detail.map((d: any) => d.msg ?? String(d)).join('; ')
            : 'Image upload failed.';
      setUploadError(prev => ({ ...prev, [leagueId]: errorMsg }));
    } finally {
      setUploadingId(null);
    }
  };

  const copyInviteLink = (token: string) => {
    const fullLink = `http://${siteAddress}/login?token=${token}`;
    copyToClipboard(fullLink);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleDeleteClick = (id: number, leagueName: string) => {
    if (window.confirm(`Are you absolutely sure you want to delete "${leagueName}"? All participants and predictions associated with this league will be removed permanently!`)) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 py-4">
      <div>
        <h1 className="text-3xl font-bold text-textMain tracking-tight">League Administration</h1>
        <p className="text-textMuted mt-1">Manage private prediction groups, provision custom team logos, and monitor member directories.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Column: Create League & Active Invitations */}
        <div className="lg:col-span-1 space-y-6">
          {/* Create League Card */}
          <Card title={<span className="flex items-center gap-2 text-primary"><Plus size={18} /> New League</span>}>
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              {createError && (
                <div className="p-3 bg-danger/15 border border-danger/30 rounded-lg text-danger text-xs flex items-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-textMuted mb-1.5 uppercase tracking-wider">League Name</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-primary outline-none text-sm"
                  placeholder="e.g. Friends Prediction League"
                  required
                />
              </div>

              <Button type="submit" isLoading={createMutation.isPending} className="w-full">
                Create League
              </Button>
            </form>

            {createdInfo && (
              <div className="mt-5 p-4 bg-success/10 border border-success/30 rounded-xl space-y-3">
                <h4 className="text-success font-bold text-xs flex items-center gap-1">
                  <Check size={14} /> League Created!
                </h4>
                <p className="text-[11px] text-textMuted leading-relaxed">
                  Share this invitation token with your friends so they can join this prediction league:
                </p>
                <div className="flex gap-2">
                  <code className="bg-black/50 px-2.5 py-1.5 rounded font-mono text-primary text-sm flex-1 text-center font-bold tracking-wider select-all">
                    {createdInfo.token}
                  </code>
                  <Button 
                    variant="secondary" 
                    size="sm"
                    onClick={() => {
                       copyToClipboard(createdInfo.token);
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Global Settings Card */}
          {isAdmin && (
          <Card title={<span className="flex items-center gap-2 text-primary"><Settings size={18} /> Global Settings</span>}>
            <form onSubmit={handleSettingsSubmit} className="space-y-4">
              {settingsSuccess && (
                <div className="p-3 bg-success/15 border border-success/30 rounded-lg text-success text-xs flex items-center gap-2 animate-pulse">
                  <Check size={14} className="shrink-0" />
                  <span>Settings updated successfully!</span>
                </div>
              )}
              {settingsError && (
                <div className="p-3 bg-danger/15 border border-danger/30 rounded-lg text-danger text-xs flex items-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{settingsError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-textMuted mb-1.5 uppercase tracking-wider">Site Domain (Address)</label>
                <input 
                  type="text" 
                  value={siteAddrInput}
                  onChange={e => setSiteAddrInput(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-primary outline-none text-sm font-mono"
                  placeholder="e.g. worldcup.leeshomeserver.com"
                  required
                />
                <p className="text-[10px] text-textMuted mt-1">Used to generate invitation links.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-textMuted mb-1.5 uppercase tracking-wider">Live Sync Frequency</label>
                <select
                  value={syncIntervalInput}
                  onChange={e => setSyncIntervalInput(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-primary outline-none text-sm"
                >
                  <option value="1">Every 1 Minute (High Sync)</option>
                  <option value="2">Every 2 Minutes</option>
                  <option value="5">Every 5 Minutes (Standard)</option>
                  <option value="10">Every 10 Minutes</option>
                  <option value="15">Every 15 Minutes</option>
                  <option value="30">Every 30 Minutes</option>
                  <option value="60">Every 1 Hour (Battery Save)</option>
                </select>
                <p className="text-[10px] text-textMuted mt-1">Wikipedia scraper score check interval.</p>
              </div>

              <Button type="submit" isLoading={updateSettingsMutation.isPending} className="w-full">
                Save Settings
              </Button>
            </form>
          </Card>
          )}


        </div>

        {/* Right Column: Existing Leagues & Logo uploads */}
        <div className="lg:col-span-2">
          <Card 
            title={
              <span className="flex items-center gap-2 text-primary">
                <Settings size={18} /> Active Leagues
                <Badge variant="player" className="ml-2 font-mono">
                  {leagues.length}
                </Badge>
              </span>
            }
          >
            {isLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-primary"></div>
              </div>
            ) : leagues.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-white/5 rounded-2xl">
                <Trophy className="mx-auto text-white/10 mb-3" size={40} />
                <p className="text-sm text-textMuted">No active prediction leagues found.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {leagues.map((league) => {
                  const isUploading = uploadingId === league.id;
                  const error = uploadError[league.id];
                  const isCreatorOrAdmin = isAdmin || league.created_by === me?.id;

                  return (
                    <div 
                      key={league.id} 
                      className="p-4 rounded-xl border border-white/5 bg-black/35 hover:border-white/15 transition-all duration-200 flex flex-col justify-between"
                    >
                      <div className="space-y-4">
                        {/* Header: Logo + Name */}
                        <div className="flex items-center gap-3">
                          {league.logo_url ? (
                            <img 
                              src={league.logo_url} 
                              alt={`${league.name} logo`} 
                              className="w-12 h-12 rounded-lg object-contain bg-white/5 border border-white/10 p-0.5"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/10 to-amber-500/10 border border-primary/20 flex items-center justify-center text-primary text-xl font-bold font-mono">
                              {league.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <h4 className="font-bold text-textMain text-sm line-clamp-1">{league.name}</h4>
                            <p className="text-[10px] text-textMuted">Creator ID: <span className="font-mono">{league.created_by}</span></p>
                          </div>
                        </div>

                        {/* Active invitation links for this league */}
                        {(() => {
                          const leagueInvites = invitations.filter(inv => inv.league_id === league.id);
                          if (leagueInvites.length === 0) return null;
                          return (
                            <div className="border-t border-white/5 pt-3 space-y-2">
                              <span className="text-[11px] font-semibold text-textMuted flex items-center gap-1">
                                <LinkIcon size={12} />
                                Active Invitation Links
                              </span>
                              {leagueInvites.map((inv) => {
                                const fullUrl = `http://${siteAddress}/login?token=${inv.token}`;
                                return (
                                  <div key={inv.token} className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      readOnly
                                      value={fullUrl}
                                      className="bg-black/60 border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-primary flex-1 outline-none select-all"
                                    />
                                    <button
                                      onClick={() => copyInviteLink(inv.token)}
                                      className="p-1.5 rounded bg-white/5 hover:bg-primary/20 hover:text-primary transition-all text-textMuted"
                                      title="Copy Full Invite URL"
                                    >
                                      {copiedToken === inv.token ? (
                                        <Check size={12} className="text-success" />
                                      ) : (
                                        <Copy size={12} />
                                      )}
                                    </button>
                                    <button
                                      onClick={() => revokeMutation.mutate(inv.token)}
                                      disabled={revokeMutation.isPending}
                                      className="p-1.5 rounded bg-white/5 hover:bg-danger/20 hover:text-danger transition-all text-textMuted"
                                      title="Revoke Invite Token"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}

                        {/* Interactive Logo Upload Form */}
                        {isCreatorOrAdmin && (
                        <div className="border-t border-white/5 pt-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-textMuted flex items-center gap-1">
                              <ImageIcon size={12} />
                              League Logo
                            </span>
                            {isUploading && (
                              <span className="text-[10px] text-primary animate-pulse flex items-center gap-1">
                                <Upload size={10} className="animate-bounce" /> Uploading...
                              </span>
                            )}
                          </div>

                          <label className="relative flex flex-col items-center justify-center border border-dashed border-white/10 hover:border-primary/45 rounded-lg py-2 cursor-pointer bg-black/20 hover:bg-black/40 transition-all group">
                            <Upload size={14} className="text-textMuted group-hover:text-primary mb-1 transition-colors" />
                            <span className="text-[10px] text-textMuted group-hover:text-textMain font-medium transition-colors">
                              Choose Logo PNG/SVG
                            </span>
                            <input 
                              type="file" 
                              accept="image/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleFileChange(league.id, file);
                              }}
                              className="hidden"
                              disabled={isUploading}
                            />
                          </label>

                          {error && (
                            <div className="text-[9px] text-danger font-medium flex items-center gap-1">
                              <AlertCircle size={10} className="shrink-0" />
                              <span>{error}</span>
                            </div>
                          )}
                        </div>
                        )}
                      </div>

                      {/* Footer Actions */}
                      <div className="border-t border-white/5 pt-3 mt-4 flex justify-between items-center">
                        <Link
                          to={`/leaderboard?leagueId=${league.id}`}
                          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary hover:text-amber-400 transition-colors"
                        >
                          <Trophy size={12} />
                          View League
                        </Link>
                        {isCreatorOrAdmin && (
                        <button
                          onClick={() => handleDeleteClick(league.id, league.name)}
                          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-white/40 hover:text-danger transition-colors cursor-pointer"
                        >
                          <Trash2 size={12} />
                          Remove League
                        </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};
