import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { apiClient } from '../api/client';
import { useMe } from '../api/hooks/useAuth';
import { useMyLeagues } from '../api/hooks/useRankings';
import { useQueryClient } from '@tanstack/react-query';
import { User, Shield, Key, AlertCircle, CheckCircle, Globe, Bell, Trash2 } from 'lucide-react';
import { COMMON_TIMEZONES } from '../utils/timezone';
import { useTournamentContext } from '../api/TournamentContext';


export const Profile: React.FC = () => {
  const { data: currentUser, isLoading: isUserLoading } = useMe();
  const { data: leagues = [] } = useMyLeagues();
  const queryClient = useQueryClient();
  const { selectedTournamentId } = useTournamentContext();

  const [displayName, setDisplayName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [email, setEmail] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [timezone, setTimezone] = useState(() => localStorage.getItem('userTimezone') || '');

  const [emailPrefs, setEmailPrefs] = useState<Record<string, boolean>>({});
  const [emailTournamentEnabled, setEmailTournamentEnabled] = useState<Record<string, boolean>>({});
  const [isSavingEmailPrefs, setIsSavingEmailPrefs] = useState(false);
  const [emailPrefsSuccess, setEmailPrefsSuccess] = useState('');
  const [emailPrefsError, setEmailPrefsError] = useState('');

  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileError, setProfileError] = useState('');
  
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') {
      setDeleteError('Please type DELETE to confirm.');
      return;
    }
    setIsDeleting(true);
    setDeleteError('');
    try {
      await apiClient.delete('/users/me');
      localStorage.removeItem('token');
      window.location.href = '/login';
    } catch (err: any) {
      setDeleteError(err.response?.data?.detail || 'Failed to delete account. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      setDisplayName(currentUser.display_name);
      setTeamName(currentUser.team_name || '');
      setEmail(currentUser.email);
    }
  }, [currentUser]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'delete-account') {
      setShowDeleteConfirm(true);
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  useEffect(() => {
    const params = selectedTournamentId ? `?tournament_id=${selectedTournamentId}` : '';
    apiClient.get(`/users/me/email-preferences${params}`).then(res => {
      const prefsMap: Record<string, boolean> = {};
      const enabledMap: Record<string, boolean> = {};
      for (const p of res.data) {
        prefsMap[p.email_type] = p.opted_in;
        enabledMap[p.email_type] = p.tournament_enabled;
      }
      setEmailPrefs(prefsMap);
      setEmailTournamentEnabled(enabledMap);
    });
  }, [selectedTournamentId]);

  const handleSaveEmailPrefs = async () => {
    setEmailPrefsSuccess('');
    setEmailPrefsError('');
    setIsSavingEmailPrefs(true);
    try {
      await apiClient.put('/users/me/email-preferences', {
        preferences: Object.entries(emailPrefs).map(([email_type, opted_in]) => ({ email_type, opted_in })),
        tournament_id: selectedTournamentId ?? null,
      });
      setEmailPrefsSuccess('Email preferences saved!');
    } catch {
      setEmailPrefsError('Failed to save preferences. Please try again.');
    } finally {
      setIsSavingEmailPrefs(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSuccess('');
    setProfileError('');
    setIsSavingProfile(true);

    try {
      await apiClient.put('/users/me/profile', {
        display_name: displayName,
        team_name: teamName,
        email: email,
      });
      setProfileSuccess('Profile updated successfully!');
      queryClient.invalidateQueries({ queryKey: ['me'] });
    } catch (err: any) {
      setProfileError(err.response?.data?.detail || 'Failed to update profile. Please try again.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordSuccess('');
    setPasswordError('');

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long.');
      return;
    }

    setIsSavingPassword(true);

    try {
      const res = await apiClient.put('/users/me/profile', {
        display_name: displayName,
        team_name: teamName,
        email: email,
        current_password: currentPassword,
        new_password: newPassword,
      });
      if (res.data && res.data.access_token) {
        localStorage.setItem('token', res.data.access_token);
      }
      setPasswordSuccess('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      queryClient.invalidateQueries({ queryKey: ['me'] });
    } catch (err: any) {
      setPasswordError(err.response?.data?.detail || 'Failed to change password. Please verify your current password.');
    } finally {
      setIsSavingPassword(false);
    }
  };

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  const initialLetter = displayName ? displayName.charAt(0).toUpperCase() : '?';

  return (
    <div className="max-w-4xl mx-auto space-y-8 py-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h1 className="text-3xl font-bold text-textMain tracking-tight">User Profile</h1>
          <p className="text-textMuted mt-1">Manage your account information and password settings.</p>
        </div>
        {currentUser?.role === 'admin' && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold">
            <Shield size={14} />
            Administrator Account
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left column: User Card Summary */}
        <div className="md:col-span-1 space-y-6">
          <Card className="flex flex-col items-center text-center">
            <div className="relative group mb-4">
              <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-primary to-amber-500 flex items-center justify-center text-black text-3xl font-bold shadow-lg shadow-primary/20 transition-transform duration-300 group-hover:scale-105">
                {initialLetter}
              </div>
            </div>
            <h2 className="text-xl font-bold text-textMain">{teamName || displayName || 'User'}</h2>
            <p className="text-sm text-textMuted">{displayName}</p>
            <p className="text-sm text-textMuted mb-4">{email}</p>
            <div className="w-full border-t border-white/5 pt-4 text-left space-y-2.5">
              <div className="flex justify-between text-xs">
                <span className="text-textMuted">Role:</span>
                <span className="font-medium text-textMain capitalize">{currentUser?.role}</span>
              </div>
              <div className="flex justify-between text-xs pb-2">
                <span className="text-textMuted">Total Predictions Points:</span>
                <span className="font-medium text-primary font-mono">{currentUser?.total_points ?? 0} pts</span>
              </div>
              
              {/* Display ranks in each league */}
              <div className="border-t border-white/5 pt-3 space-y-2 w-full">
                <div className="text-[10px] font-bold text-textMuted uppercase tracking-wider mb-2">My League Standings</div>
                {leagues.length > 0 ? (
                  leagues.map(l => (
                    <div key={l.id} className="flex justify-between text-xs">
                      <span className="text-textMuted truncate max-w-[150px]">{l.name}:</span>
                      <span className="font-bold text-primary font-mono">
                        {l.my_rank ? `#${l.my_rank}` : 'Unranked'}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-textMuted italic">Not in any leagues yet.</div>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* Right column: Edit forms */}
        <div className="md:col-span-2 space-y-8">
          {/* Profile Details Card */}
          <Card title={<span className="flex items-center gap-2"><User size={20} className="text-primary" /> Profile Information</span>}>
            <form onSubmit={handleUpdateProfile} className="space-y-4">
              {profileSuccess && (
                <div className="flex items-center gap-2 p-3 bg-success/15 border border-success/30 rounded-lg text-success text-sm">
                  <CheckCircle size={16} />
                  <span>{profileSuccess}</span>
                </div>
              )}
              {profileError && (
                <div className="flex items-center gap-2 p-3 bg-danger/15 border border-danger/30 rounded-lg text-danger text-sm">
                  <AlertCircle size={16} />
                  <span>{profileError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1.5 uppercase tracking-wider">Your Name</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-primary outline-none transition-all duration-150 text-sm"
                    placeholder="Your real name"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1.5 uppercase tracking-wider">Team Name</label>
                  <input
                    type="text"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-primary outline-none transition-all duration-150 text-sm"
                    placeholder="Your team's nickname"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1.5 uppercase tracking-wider">Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-primary outline-none transition-all duration-150 text-sm"
                    placeholder="name@example.com"
                    required
                  />
                </div>
              </div>

            <div>
              <label className="block text-xs font-semibold text-textMuted mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
                <Globe size={14} className="text-primary/70" />
                Display Timezone
              </label>
              <select
                value={timezone}
                onChange={(e) => {
                  setTimezone(e.target.value);
                  localStorage.setItem('userTimezone', e.target.value);
                }}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-primary outline-none transition-all duration-150 text-sm cursor-pointer"
              >
                <option value="" className="bg-[#161B22]">Local / Browser default ({Intl.DateTimeFormat().resolvedOptions().timeZone})</option>
                {COMMON_TIMEZONES.map(tz => (
                  <option key={tz.value} value={tz.value} className="bg-[#161B22]">{tz.label}</option>
                ))}
              </select>
              <p className="text-[10px] text-textMuted mt-1">This adjusts all match dates, kickoff times, and lock deadlines throughout the platform to your preferred zone.</p>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" isLoading={isSavingProfile} className="w-full md:w-auto">
                Save Information
              </Button>
            </div>
            </form>
          </Card>

          {/* Email Notifications Card */}
          {(() => {
            const EMAIL_TYPES = [
              { key: 'round_summary', label: 'Round Summary', description: 'Results and points after each completed matchday' },
              { key: 'daily_digest', label: 'Daily Digest', description: 'Daily summary of upcoming fixtures and standings' },
            ];
            const availableTypes = EMAIL_TYPES.filter(({ key }) => emailTournamentEnabled[key] !== false);
            const allDisabled = availableTypes.length === 0;
            return (
              <Card title={<span className="flex items-center gap-2"><Bell size={20} className="text-primary" /> Email Notifications</span>}>
                {allDisabled ? (
                  <p className="text-sm text-textMuted">Email notifications are not currently enabled for this tournament.</p>
                ) : (
                  <>
                    <p className="text-xs text-textMuted mb-4">Choose which emails you want to receive from the platform.</p>
                    {emailPrefsSuccess && (
                      <div className="flex items-center gap-2 p-3 bg-success/15 border border-success/30 rounded-lg text-success text-sm mb-4">
                        <CheckCircle size={16} /><span>{emailPrefsSuccess}</span>
                      </div>
                    )}
                    {emailPrefsError && (
                      <div className="flex items-center gap-2 p-3 bg-danger/15 border border-danger/30 rounded-lg text-danger text-sm mb-4">
                        <AlertCircle size={16} /><span>{emailPrefsError}</span>
                      </div>
                    )}
                    <div className="space-y-3">
                      {availableTypes.map(({ key, label, description }) => (
                        <label key={key} className="flex items-center justify-between gap-4 p-3 rounded-lg bg-black/20 border border-white/5 cursor-pointer hover:border-white/10 transition-colors">
                          <div>
                            <div className="text-sm font-medium text-textMain">{label}</div>
                            <div className="text-xs text-textMuted">{description}</div>
                          </div>
                          <div className="relative flex-shrink-0">
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={!!emailPrefs[key]}
                              onChange={(e) => setEmailPrefs(prev => ({ ...prev, [key]: e.target.checked }))}
                            />
                            <div className={`w-10 h-6 rounded-full transition-colors duration-200 ${emailPrefs[key] ? 'bg-primary' : 'bg-white/10'}`}>
                              <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform duration-200 ${emailPrefs[key] ? 'translate-x-5' : 'translate-x-1'}`} />
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                    <div className="flex justify-end pt-4">
                      <Button onClick={handleSaveEmailPrefs} isLoading={isSavingEmailPrefs} variant="secondary" className="w-full md:w-auto">
                        Save Preferences
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            );
          })()}

          {/* Change Password Card */}
          <Card title={<span className="flex items-center gap-2"><Key size={20} className="text-primary" /> Security & Password</span>}>
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              {passwordSuccess && (
                <div className="flex items-center gap-2 p-3 bg-success/15 border border-success/30 rounded-lg text-success text-sm">
                  <CheckCircle size={16} />
                  <span>{passwordSuccess}</span>
                </div>
              )}
              {passwordError && (
                <div className="flex items-center gap-2 p-3 bg-danger/15 border border-danger/30 rounded-lg text-danger text-sm">
                  <AlertCircle size={16} />
                  <span>{passwordError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-textMuted mb-1.5 uppercase tracking-wider">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-primary outline-none transition-all duration-150 text-sm"
                  placeholder="••••••••"
                  required={newPassword.length > 0}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1.5 uppercase tracking-wider">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-primary outline-none transition-all duration-150 text-sm"
                    placeholder="Minimum 6 characters"
                    required={currentPassword.length > 0}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1.5 uppercase tracking-wider">Confirm New Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-primary outline-none transition-all duration-150 text-sm"
                    placeholder="Re-enter new password"
                    required={currentPassword.length > 0}
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button type="submit" isLoading={isSavingPassword} variant="secondary" className="w-full md:w-auto">
                  Change Password
                </Button>
              </div>
            </form>
          </Card>

          {/* Danger Zone Card */}
          <Card 
            className="border border-red-500/20 bg-red-500/5"
            title={<span className="flex items-center gap-2 text-red-500 font-bold"><Trash2 size={20} /> Danger Zone</span>}
          >
            <div className="space-y-4">
              <p className="text-xs text-textMuted leading-relaxed">
                Permanently delete your profile and all prediction statistics, brackets, and ledger entries. 
                If you created any leagues, their ownership will be transferred to another member, or dissolved if you are the only participant. 
                <strong>This action is irreversible.</strong>
              </p>
              <div className="flex justify-start">
                <Button 
                  onClick={() => { setShowDeleteConfirm(true); setDeleteConfirmText(''); setDeleteError(''); }}
                  className="bg-red-600 hover:bg-red-700 text-white border-0 shadow-lg shadow-red-600/10 transition-all duration-300"
                >
                  Delete Account
                </Button>
              </div>
            </div>
          </Card>

        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#161B22] border border-white/10 rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-lg font-semibold text-white mb-2 flex items-center gap-2 text-red-500">
              <Trash2 size={20} /> Confirm Deletion
            </h2>
            <p className="text-textMuted text-xs mb-4 leading-relaxed">
              Are you sure you want to permanently delete your account? All your statistics, scores, and brackets will be permanently erased. This action cannot be undone.
            </p>
            <p className="text-textMuted text-xs mb-4 font-semibold">
               Please type <span className="text-white font-mono bg-black/40 px-1 py-0.5 rounded">DELETE</span> below to confirm:
            </p>
            {deleteError && (
              <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/25 p-2 rounded mb-3">
                {deleteError}
              </div>
            )}
            <div className="space-y-4">
              <input
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all text-sm font-mono"
                placeholder="DELETE"
                required
              />
              <div className="flex gap-3">
                <Button 
                  type="button" 
                  variant="secondary" 
                  className="flex-1" 
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button 
                  type="button" 
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white border-0 shadow-lg shadow-red-600/10" 
                  onClick={handleDeleteAccount}
                  isLoading={isDeleting}
                  disabled={deleteConfirmText !== 'DELETE'}
                >
                  Delete Account
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
