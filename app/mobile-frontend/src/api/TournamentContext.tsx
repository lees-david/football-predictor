import React, { createContext, useContext, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';
import { Tournament } from '../types';

interface TournamentContextType {
  selectedTournamentId: number | null;
  selectedTournament: Tournament | null;
  tournaments: Tournament[];
  setSelectedTournamentId: (id: number) => void;
  isLoading: boolean;
}

const TournamentContext = createContext<TournamentContextType | undefined>(undefined);

export const TournamentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedTournamentId, setLocalSelectedTournamentId] = useState<number | null>(() => {
    const saved = localStorage.getItem('selectedTournamentId');
    return saved ? parseInt(saved, 10) : null;
  });

  const token = localStorage.getItem('token');
  const isPublicPage = window.location.pathname.replace(/\/$/, "") === '/login' ||
                       window.location.pathname.replace(/\/$/, "") === '/reset-password' ||
                       window.location.pathname.replace(/\/$/, "") === '/maintenance';

  const { data: tournaments = [], isLoading } = useQuery({
    queryKey: ['tournaments'],
    queryFn: async () => {
      const { data } = await apiClient.get<Tournament[]>('/tournaments');
      return data;
    },
    enabled: !!token && !isPublicPage,
  });

  // Set default tournament if none is selected yet
  useEffect(() => {
    if (tournaments.length > 0 && selectedTournamentId === null) {
      const active = tournaments.find(t => t.is_active) || tournaments[0];
      setLocalSelectedTournamentId(active.id);
      localStorage.setItem('selectedTournamentId', active.id.toString());
    }
  }, [tournaments, selectedTournamentId]);

  const setSelectedTournamentId = (id: number) => {
    setLocalSelectedTournamentId(id);
    localStorage.setItem('selectedTournamentId', id.toString());
  };

  const selectedTournament = tournaments.find(t => t.id === selectedTournamentId) || null;

  return (
    <TournamentContext.Provider
      value={{
        selectedTournamentId,
        selectedTournament,
        tournaments,
        setSelectedTournamentId,
        isLoading
      }}
    >
      {children}
    </TournamentContext.Provider>
  );
};

export const useTournamentContext = () => {
  const context = useContext(TournamentContext);
  if (context === undefined) {
    throw new Error('useTournamentContext must be used within a TournamentProvider');
  }
  return context;
};
