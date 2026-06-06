import React from 'react';

interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '' }) => (
  <div className={`animate-pulse rounded bg-white/8 ${className}`} />
);

export const SkeletonCard: React.FC<{ rows?: number; className?: string }> = ({
  rows = 3,
  className = '',
}) => (
  <div className={`glass-card rounded-xl p-6 space-y-3 ${className}`}>
    <Skeleton className="h-5 w-1/3" />
    {Array.from({ length: rows }).map((_, i) => (
      <Skeleton key={i} className={`h-4 ${i % 2 === 0 ? 'w-full' : 'w-4/5'}`} />
    ))}
  </div>
);

export const SkeletonTable: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="space-y-2">
    <Skeleton className="h-8 w-full rounded-lg" />
    {Array.from({ length: rows }).map((_, i) => (
      <Skeleton key={i} className="h-12 w-full rounded-lg" />
    ))}
  </div>
);

export const SkeletonFixtureCard: React.FC = () => (
  <div className="glass-card rounded-2xl p-5 space-y-4 min-h-[220px]">
    <div className="flex justify-between">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex-1 flex flex-col items-center gap-2">
        <Skeleton className="w-14 h-9 rounded" />
        <Skeleton className="h-3 w-20" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <Skeleton className="h-8 w-20 rounded-xl" />
      </div>
      <div className="flex-1 flex flex-col items-center gap-2">
        <Skeleton className="w-14 h-9 rounded" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
    <div className="border-t border-white/5 pt-3 flex justify-between">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3 w-16" />
    </div>
  </div>
);
