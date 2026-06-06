import React, { useEffect, useState } from 'react';
import { Outlet, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { apiClient } from '../../api/client';
import { useTournamentContext } from '../../api/TournamentContext';
import { Trophy, CheckCircle2, AlertCircle } from 'lucide-react';

export const Layout: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { selectedTournamentId, setSelectedTournamentId } = useTournamentContext();
  const token = searchParams.get('token');

  // Modal State
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [leagueName, setLeagueName] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [joinSuccess, setJoinSuccess] = useState(false);
  const [isAlreadyMember, setIsAlreadyMember] = useState(false);

  // Maintenance State
  const [minutesToMaintenance, setMinutesToMaintenance] = useState<number | null>(null);

  useEffect(() => {
    const checkMaintenance = async () => {
      try {
        const response = await apiClient.get('/maintenance/status');
        const { active, start_time } = response.data;
        
        if (active && window.location.pathname !== '/maintenance') {
          // If maintenance is active, clear token and redirect (exempting admin role is handled by 503 auth check on api requests)
          localStorage.removeItem('token');
          window.location.href = '/maintenance';
          return;
        }

        if (start_time) {
          const start = new Date(start_time).getTime();
          const now = new Date().getTime();
          const diffMs = start - now;
          const diffMins = Math.floor(diffMs / 60000);
          
          if (diffMins > 0 && diffMins <= 30) {
            setMinutesToMaintenance(diffMins);
          } else {
            setMinutesToMaintenance(null);
          }
        } else {
          setMinutesToMaintenance(null);
        }
      } catch (error) {
        console.error("Failed to fetch maintenance status:", error);
      }
    };

    checkMaintenance();
    const interval = setInterval(checkMaintenance, 20000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (token) {
      // Fetch details of the league for this invitation token
      apiClient.get(`/leagues/invite-details/${token}`)
        .then((response) => {
          setLeagueName(response.data.league_name);
          const isReg = searchParams.get('registered') === 'true';
          if (isReg) {
            setJoinSuccess(true);
            setIsAlreadyMember(false);
          } else {
            setIsAlreadyMember(response.data.is_member || false);
          }
          setIsInviteModalOpen(true);
          setErrorMessage('');
        })
        .catch((error) => {
          console.error("Failed to fetch invite details:", error);
          // Token is invalid/expired
          setErrorMessage(error.response?.data?.detail || "This invitation link is invalid or has expired.");
          setIsInviteModalOpen(true);
        });
    }
  }, [token, searchParams]);

  const clearTokenParam = () => {
    setIsInviteModalOpen(false);
    // Remove parameters from URL
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('token');
    newParams.delete('registered');
    setSearchParams(newParams);
    
    // Reset state
    setTimeout(() => {
      setLeagueName('');
      setErrorMessage('');
      setJoinSuccess(false);
      setIsAlreadyMember(false);
    }, 300);
  };

  const handleJoin = async () => {
    if (!token) return;
    setIsJoining(true);
    setErrorMessage('');
    
    try {
      const response = await apiClient.post('/leagues/join', { invite_token: token });
      setJoinSuccess(true);
      
      // Invalidate leagues list query to refresh rankings & listings
      await queryClient.invalidateQueries({ queryKey: ['leagues'] });

      if (response.data.tournament_id && response.data.tournament_id !== selectedTournamentId) {
        setSelectedTournamentId(response.data.tournament_id);
      }
    } catch (error: any) {
      console.error("Failed to join league:", error);
      setErrorMessage(error.response?.data?.detail || "Failed to join the league. Please try again.");
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0D1117] text-[#F0F6FC]">
      <Navbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 ml-64 p-8 overflow-y-auto">
          <div className="max-w-screen-2xl mx-auto">
            {minutesToMaintenance !== null && (
              <div className="mb-6 p-4 bg-gradient-to-r from-amber-500/20 to-yellow-600/20 border border-amber-500/30 rounded-2xl flex items-center gap-3 text-amber-300 animate-pulse">
                <AlertCircle size={20} className="flex-shrink-0 text-amber-400" />
                <div className="text-sm font-semibold">
                  Scheduled Maintenance is starting soon. Please save any active changes. You will be automatically logged out in <strong className="text-white font-extrabold">{minutesToMaintenance} minutes</strong>.
                </div>
              </div>
            )}
            <Outlet />
          </div>
        </main>
      </div>

      {/* Premium Invite Modal */}
      <Modal 
        isOpen={isInviteModalOpen} 
        onClose={clearTokenParam} 
        title={joinSuccess ? "Welcome to the League!" : "League Invitation"}
      >
        <div className="space-y-6">
          {joinSuccess ? (
            <div className="text-center space-y-4 py-4 animate-in zoom-in-95 duration-300">
              <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                <CheckCircle2 size={36} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Successfully Joined!</h3>
                <p className="text-sm text-textMuted mt-1">
                  You are now a member of <strong className="text-amber-400 font-semibold">{leagueName}</strong>.
                </p>
              </div>
              <Button 
                onClick={clearTokenParam}
                className="w-full mt-2"
              >
                Let's Play
              </Button>
            </div>
          ) : errorMessage ? (
            <div className="text-center space-y-4 py-4">
              <div className="w-16 h-16 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mx-auto border border-red-500/20">
                <AlertCircle size={36} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Invitation Error</h3>
                <p className="text-sm text-textMuted mt-1">
                  {errorMessage}
                </p>
              </div>
              <Button 
                variant="secondary"
                onClick={clearTokenParam}
                className="w-full mt-2"
              >
                Close
              </Button>
            </div>
          ) : isAlreadyMember ? (
            <div className="text-center space-y-4 py-4">
              <div className="w-16 h-16 bg-blue-500/10 text-blue-400 rounded-full flex items-center justify-center mx-auto border border-blue-500/20">
                <CheckCircle2 size={36} className="text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Already a Member</h3>
                <p className="text-sm text-textMuted mt-1">
                  You are already a member of the league <strong className="text-amber-400 font-semibold">{leagueName}</strong>.
                </p>
              </div>
              <Button 
                onClick={clearTokenParam}
                className="w-full mt-2"
              >
                Close
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
                <div className="w-12 h-12 bg-amber-500/10 text-amber-500 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Trophy size={24} />
                </div>
                <div>
                  <span className="text-xs text-textMuted font-bold uppercase tracking-wider">Invitation Received</span>
                  <h4 className="text-base font-extrabold text-white leading-tight mt-0.5">{leagueName}</h4>
                </div>
              </div>

              <p className="text-sm text-textMuted leading-relaxed">
                You've been invited to join this prediction league. Accept the invitation to compete against friends and track rankings.
              </p>

              <div className="flex gap-3 pt-3 border-t border-white/5">
                <Button 
                  variant="secondary"
                  onClick={clearTokenParam}
                  disabled={isJoining}
                  className="flex-1"
                >
                  Decline
                </Button>
                <Button 
                  onClick={handleJoin}
                  disabled={isJoining}
                  className="flex-1"
                >
                  {isJoining ? 'Joining...' : 'Accept Invite'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
