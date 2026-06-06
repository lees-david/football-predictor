import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { useAdminUsers } from '../../api/hooks/useAdminUsers';
import { useMe } from '../../api/hooks/useAuth';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { useTournamentContext } from '../../api/TournamentContext';
import { TournamentCompletionResponse, League } from '../../types';
import { 
  Shield, 
  Users, 
  ChevronUp, 
  ChevronDown,
  Trophy,
  Search,
  Check,
  ClipboardList
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AdminUser {
  id: number;
  email: string;
  display_name: string;
  role: 'admin' | 'player';
  total_points: number;
  current_rank: number | null;
  is_active: boolean;
  can_manage_leagues: boolean;
  can_manage_tournaments: boolean;
  can_invite_users: boolean;
  created_at: string;
}


interface LeagueDetail {
  id: number;
  name: string;
  joined_at: string;
}

interface TournamentDetail {
  id: number;
  name: string;
  leagues: LeagueDetail[];
}

interface UserDetailOut {
  id: number;
  display_name: string;
  email: string;
  tournaments: TournamentDetail[];
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
const Toggle: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}> = ({ checked, onChange, disabled }) => (
  <button
    type="button"
    onClick={() => !disabled && onChange(!checked)}
    disabled={disabled}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
      checked ? 'bg-primary' : 'bg-white/10'
    } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

const RoleBadge: React.FC<{
  role: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
}> = ({ role, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || !onClick}
    title={onClick && !disabled ? (role === 'admin' ? 'Demote to player' : 'Promote to admin') : undefined}
    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-opacity ${
      role === 'admin'
        ? 'bg-primary/20 text-primary border border-primary/30'
        : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
    } ${onClick && !disabled ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
  >
    {role === 'admin' ? <Shield size={10} /> : <Users size={10} />}
    {role}
  </button>
);

export const UserManagement: React.FC = () => {
  const qc = useQueryClient();
  const { data: currentUser } = useMe();
  const [searchTerm, setSearchTerm] = useState('');
  const { selectedTournament } = useTournamentContext();
  const [selectedLeagueId, setSelectedLeagueId] = useState<number | 'all'>('all');
  const [showEmailsInCompletion, setShowEmailsInCompletion] = useState(true);

  // Reset selected league filter when tournament changes
  useEffect(() => {
    setSelectedLeagueId('all');
  }, [selectedTournament?.id]);

  // Fetch leagues for the selected tournament
  const { data: leagues = [] } = useQuery<League[]>({
    queryKey: ['admin', 'leagues', selectedTournament?.id],
    queryFn: async () => {
      if (!selectedTournament) return [];
      const { data } = await apiClient.get<League[]>(`/leagues?tournament_id=${selectedTournament.id}`);
      return data;
    },
    enabled: !!selectedTournament,
  });

  const { data: completionData, isLoading: completionLoading } = useQuery<TournamentCompletionResponse>({
    queryKey: ['admin', 'users-completion', selectedTournament?.id, selectedLeagueId],
    queryFn: async () => {
      if (!selectedTournament) throw new Error('No tournament selected');
      let url = `/admin/tournaments/${selectedTournament.id}/users-completion`;
      if (selectedLeagueId !== 'all') {
        url += `?league_id=${selectedLeagueId}`;
      }
      const { data } = await apiClient.get<TournamentCompletionResponse>(url);
      return data;
    },
    enabled: !!selectedTournament,
  });

  const filteredCompletions = (completionData?.users || []).filter(u => 
    u.display_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Card Expand / Cache states
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [userDetailsCache, setUserDetailsCache] = useState<Record<number, UserDetailOut>>({});
  const [loadingDetailsId, setLoadingDetailsId] = useState<number | null>(null);

  // Sorting UI states
  const [sortField, setSortField] = useState<keyof AdminUser>('display_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const { data: users = [], isLoading: usersLoading } = useAdminUsers();

  // Role/privileges update mutation (fixed 422 missing fields)
  const updateRoleMutation = useMutation({
    mutationFn: async ({
      userId,
      payload,
    }: {
      userId: number;
      payload: { 
        role: string; 
        can_manage_leagues: boolean; 
        can_manage_tournaments: boolean; 
        can_invite_users: boolean; 
        is_active: boolean; 
      };
    }) => (await apiClient.put(`/admin/users/${userId}/role`, payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  const handleSort = (field: keyof AdminUser) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const toggleExpandUser = async (userId: number) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      return;
    }
    setExpandedUserId(userId);
    if (!userDetailsCache[userId]) {
      setLoadingDetailsId(userId);
      try {
        const { data } = await apiClient.get<UserDetailOut>(`/admin/users/${userId}/details`);
        setUserDetailsCache(prev => ({ ...prev, [userId]: data }));
      } catch (err) {
        console.error('Failed to fetch user details:', err);
      } finally {
        setLoadingDetailsId(null);
      }
    }
  };

  // Filters users based on search
  const filteredUsers = users.filter(u => 
    u.display_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Sorts filtered users
  const sortedUsers = [...filteredUsers].sort((a, b) => {
    const av = a[sortField] ?? '';
    const bv = b[sortField] ?? '';
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <div className="space-y-8 py-4">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h1 className="text-3xl font-bold text-textMain tracking-tight">User Administration</h1>
          <p className="text-textMuted mt-1">Manage user directories, toggle access privilege roles, and audit pending invitations.</p>
        </div>
      </div>

      <div className="space-y-6">
        <Card
          title={
            <div className="flex flex-col gap-4 w-full">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-primary font-bold">
                  <Users size={20} /> Registered Users
                  <Badge variant="player" className="ml-2 font-mono">
                    {users.length}
                  </Badge>
                </span>
              </div>
              
              {/* Search & Sort Controls */}
              <div className="flex flex-col gap-3 w-full sm:flex-row sm:items-center sm:justify-end">
                {/* Search Bar */}
                <div className="relative w-full sm:w-60">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search name or email..."
                    className="w-full bg-black/50 border border-white/10 rounded-lg pl-9 pr-4 py-1.5 text-xs text-white focus:ring-1 focus:ring-primary outline-none transition-all"
                  />
                </div>
                
                {/* Sort selector */}
                <div className="flex items-center gap-1.5 text-xs text-textMuted font-semibold">
                  <span>Sort by:</span>
                  <button
                    type="button"
                    onClick={() => handleSort('display_name')}
                    className={`px-2 py-1 rounded bg-white/5 border border-white/5 text-[10px] font-bold transition-all ${
                      sortField === 'display_name' ? 'text-primary border-primary/30 bg-primary/5' : ''
                    }`}
                  >
                    Name {sortField === 'display_name' && (sortDir === 'asc' ? '↑' : '↓')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSort('role')}
                    className={`px-2 py-1 rounded bg-white/5 border border-white/5 text-[10px] font-bold transition-all ${
                      sortField === 'role' ? 'text-primary border-primary/30 bg-primary/5' : ''
                    }`}
                  >
                    Role {sortField === 'role' && (sortDir === 'asc' ? '↑' : '↓')}
                  </button>
                </div>
              </div>
            </div>
          }
        >
          {usersLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-primary"></div>
            </div>
          ) : sortedUsers.length === 0 ? (
            <div className="text-center py-12 text-textMuted">
              No users found matching query.
            </div>
          ) : (
            <div className="space-y-3">
              {sortedUsers.map((user) => {
                const isExpanded = expandedUserId === user.id;
                const isPending =
                  updateRoleMutation.isPending &&
                  (updateRoleMutation.variables as any)?.userId === user.id;

                const update = (patch: Partial<{
                  role: string;
                  can_manage_leagues: boolean;
                  can_manage_tournaments: boolean;
                  can_invite_users: boolean;
                  is_active: boolean;
                }>) =>
                  updateRoleMutation.mutate({
                    userId: user.id,
                    payload: {
                      role: user.role,
                      can_manage_leagues: user.can_manage_leagues,
                      can_manage_tournaments: user.can_manage_tournaments,
                      can_invite_users: user.can_invite_users,
                      is_active: user.is_active,
                      ...patch,
                    },
                  });

                const details = userDetailsCache[user.id];
                const isDetailsLoading = loadingDetailsId === user.id;

                return (
                  <div
                    key={user.id}
                    className={`rounded-xl border border-white/5 bg-black/35 overflow-hidden transition-all duration-200 ${
                      isPending ? 'opacity-50' : ''
                    }`}
                  >
                    {/* Header Row (Always Visible) */}
                    <div
                      onClick={() => toggleExpandUser(user.id)}
                      className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-white text-sm truncate">{user.display_name}</h4>
                          <RoleBadge
                            role={user.role}
                            disabled={isPending || user.id === currentUser?.id}
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent card expansion when clicking role badge
                              update({ role: user.role === 'admin' ? 'player' : 'admin' });
                            }}
                          />
                          {!user.is_active && (
                            <span className="text-[9px] font-bold uppercase tracking-wider bg-red-500/25 text-red-400 px-1.5 py-0.5 rounded border border-red-500/20">
                              Inactive
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-textMuted mt-1 truncate">{user.email}</p>
                      </div>
                      
                      <div className="shrink-0 flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronUp size={16} className="text-textMuted" />
                        ) : (
                          <ChevronDown size={16} className="text-textMuted" />
                        )}
                      </div>
                    </div>

                    {/* Expanded Details Section */}
                    {isExpanded && (
                      <div className="border-t border-white/5 bg-black/10 p-4 space-y-4 animate-slideDown text-xs">
                        {/* Admin privileges configuration */}
                        <div className="space-y-3">
                          <h5 className="text-[10px] font-bold text-primary uppercase tracking-wider border-b border-white/5 pb-1">
                            Privileges &amp; Access Control
                          </h5>
                          
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="flex items-center justify-between p-2 rounded bg-white/[0.02] border border-white/5">
                              <div>
                                <div className="font-semibold text-white">Leagues Admin</div>
                                <div className="text-[10px] text-textMuted">Can create and manage leagues</div>
                              </div>
                              <Toggle
                                checked={user.can_manage_leagues}
                                onChange={(v) => update({ can_manage_leagues: v })}
                                disabled={isPending}
                              />
                            </div>

                            <div className="flex items-center justify-between p-2 rounded bg-white/[0.02] border border-white/5">
                              <div>
                                <div className="font-semibold text-white">Tournaments Admin</div>
                                <div className="text-[10px] text-textMuted">Can manage match schedules</div>
                              </div>
                              <Toggle
                                checked={user.can_manage_tournaments}
                                onChange={(v) => update({ can_manage_tournaments: v })}
                                disabled={isPending}
                              />
                            </div>

                            <div className="flex items-center justify-between p-2 rounded bg-white/[0.02] border border-white/5">
                              <div>
                                <div className="font-semibold text-white">Invite Users</div>
                                <div className="text-[10px] text-textMuted">Can generate invitation links</div>
                              </div>
                              <Toggle
                                checked={user.can_invite_users}
                                onChange={(v) => update({ can_invite_users: v })}
                                disabled={isPending}
                              />
                            </div>

                            <div className="flex items-center justify-between p-2 rounded bg-white/[0.02] border border-white/5">
                              <div>
                                <div className="font-semibold text-white">Account Active</div>
                                <div className="text-[10px] text-textMuted">Allows logging into the app</div>
                              </div>
                              <Toggle
                                checked={user.is_active}
                                onChange={(v) => update({ is_active: v })}
                                disabled={isPending}
                              />
                            </div>
                          </div>
                        </div>

                        {/* User leagues hierarchical list */}
                        <div className="space-y-2">
                          <h5 className="text-[10px] font-bold text-primary uppercase tracking-wider border-b border-white/5 pb-1">
                            Joined Leagues Hierarchy
                          </h5>

                          {isDetailsLoading ? (
                            <div className="flex items-center justify-center py-4 gap-2 text-textMuted">
                              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                              <span>Loading user registrations...</span>
                            </div>
                          ) : details ? (
                            details.tournaments.length === 0 ? (
                              <div className="text-textMuted italic py-1">
                                User is not registered in any leagues.
                              </div>
                            ) : (
                              <div className="space-y-2.5 max-h-[200px] overflow-y-auto pr-1">
                                {details.tournaments.map((t) => (
                                  <div key={t.id} className="p-2 rounded bg-black/40 border border-white/5 space-y-1.5">
                                    <div className="font-bold text-white text-[11px] flex items-center gap-1 border-b border-white/5 pb-1">
                                      <Trophy size={12} className="text-amber-500" />
                                      {t.name}
                                    </div>
                                    <div className="space-y-1 pl-4">
                                      {t.leagues.map((lg) => (
                                        <div key={lg.id} className="flex justify-between items-center text-[10px]">
                                          <span className="text-textMain font-medium">{lg.name}</span>
                                          <span className="text-textMuted">
                                            Joined: {new Date(lg.joined_at).toLocaleDateString()}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )
                          ) : (
                            <div className="text-danger italic py-1">
                              Failed to load league hierarchy.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

          {/* User Stage Readiness & Completion Summary */}
          <Card 
            title={
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
                <span className="flex items-center gap-2 text-primary">
                  <ClipboardList size={20} /> User Stage Readiness &amp; Completion Summary
                </span>
                
                {/* Filters */}
                {selectedTournament && (
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    {/* Show Emails Checkbox */}
                    <label className="flex items-center gap-2 text-xs text-textMuted cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={showEmailsInCompletion}
                        onChange={(e) => setShowEmailsInCompletion(e.target.checked)}
                        className="rounded border-white/10 bg-black/50 text-primary focus:ring-1 focus:ring-primary h-3.5 w-3.5 transition-colors cursor-pointer"
                      />
                      <span>Show Emails</span>
                    </label>

                    {/* League Filter */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-textMuted whitespace-nowrap">Filter by League:</span>
                      <select
                        value={selectedLeagueId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedLeagueId(val === 'all' ? 'all' : Number(val));
                        }}
                        className="bg-black/50 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:ring-1 focus:ring-primary outline-none transition-all cursor-pointer"
                      >
                        <option value="all">All Users</option>
                        {leagues.map((lg) => (
                          <option key={lg.id} value={lg.id}>
                            {lg.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            }
          >
            {!selectedTournament ? (
              <div className="text-center py-6 text-textMuted">
                Please select a tournament from the navigation header to view completion statistics.
              </div>
            ) : completionLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-primary"></div>
              </div>
            ) : !completionData || completionData.users.length === 0 ? (
              <div className="text-center py-12 text-textMuted">
                No completion data available.
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-textMuted leading-relaxed">
                  This table summarizes user prediction completion against the stages for the currently selected tournament (<strong>{selectedTournament.name}</strong>).
                </p>
                <div className="overflow-x-auto border border-white/5 rounded-xl">
                  <table className="w-full text-xs text-left min-w-[1000px]">
                    <thead>
                      <tr className="border-b border-white/5 bg-white/[0.01]">
                        <th className="py-3 px-3 text-white font-semibold uppercase tracking-wider">User</th>
                        <th className="py-3 px-3 text-white/60 font-semibold uppercase tracking-wider text-center">S1a (Group)</th>
                        {selectedTournament.has_bracket && (
                          <>
                            <th className="py-3 px-3 text-white/60 font-semibold uppercase tracking-wider text-center">S1b (Standings)</th>
                            <th className="py-3 px-3 text-white/60 font-semibold uppercase tracking-wider text-center">S1c (KO Bracket)</th>
                          </>
                        )}
                        <th className="py-3 px-3 text-white/60 font-semibold uppercase tracking-wider text-center">S2 (R32)</th>
                        <th className="py-3 px-3 text-white/60 font-semibold uppercase tracking-wider text-center">S3 (R16)</th>
                        <th className="py-3 px-3 text-white/60 font-semibold uppercase tracking-wider text-center">S4 (QF)</th>
                        <th className="py-3 px-3 text-white/60 font-semibold uppercase tracking-wider text-center">S5 (SF)</th>
                        <th className="py-3 px-3 text-white/60 font-semibold uppercase tracking-wider text-center">S6a (3rd)</th>
                        <th className="py-3 px-3 text-white/60 font-semibold uppercase tracking-wider text-center">S6b (Final)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredCompletions.map((user) => {
                        const renderStageCell = (completion: any) => {
                          if (!completion || completion.total === 0) {
                            return <span className="text-white/20">-</span>;
                          }
                          if (completion.predicted === completion.total) {
                            return (
                              <span className="text-emerald-400 font-semibold flex items-center gap-1 justify-center">
                                <Check size={12} strokeWidth={3} /> {completion.predicted}/{completion.total}
                              </span>
                            );
                          }
                          if (completion.predicted > 0) {
                            return (
                              <span className="text-amber-400 font-semibold">
                                {completion.predicted}/{completion.total}
                              </span>
                            );
                          }
                          return (
                            <span className="text-red-500/50 font-semibold">
                              0/{completion.total}
                            </span>
                          );
                        };


                        return (
                          <tr key={user.user_id} className="hover:bg-white/[0.01] transition-colors">
                            <td className="py-3 px-3 font-medium">
                              <div className="font-bold text-white">{user.display_name}</div>
                              {showEmailsInCompletion && (
                                <div className="text-[10px] text-textMuted mt-0.5">{user.email}</div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center">{renderStageCell(user.group)}</td>
                            {selectedTournament.has_bracket && (
                              <>
                                <td className="py-3 px-3 text-center">{renderStageCell(user.group_bracket_picks)}</td>
                                <td className="py-3 px-3 text-center">{renderStageCell(user.ko_bracket_picks)}</td>
                              </>
                            )}
                            <td className="py-3 px-3 text-center">{renderStageCell(user.round_32)}</td>
                            <td className="py-3 px-3 text-center">{renderStageCell(user.round_16)}</td>
                            <td className="py-3 px-3 text-center">{renderStageCell(user.quarter_final)}</td>
                            <td className="py-3 px-3 text-center">{renderStageCell(user.semi_final)}</td>
                            <td className="py-3 px-3 text-center">{renderStageCell(user.third_place)}</td>
                            <td className="py-3 px-3 text-center">{renderStageCell(user.final)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        </div>

    </div>
  );
};
