import React, { ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface CollapsibleSectionProps {
  title: ReactNode;
  badges?: ReactNode;
  subtitle?: ReactNode;
  headerActions?: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  variant?: 'stage' | 'group';
  children: ReactNode;
  bodyClassName?: string;
  className?: string;
}

const STAGE_WRAPPER = 'glass-card rounded-2xl border border-white/5 overflow-hidden shadow-xl';
const STAGE_HEADER  = 'flex items-center justify-between gap-3 p-4 bg-white/5 border-b border-white/5 cursor-pointer hover:bg-white/10 transition-colors select-none';
const STAGE_BODY    = 'p-6 bg-black/25';

const GROUP_WRAPPER = 'rounded-xl border border-white/5 overflow-hidden';
const GROUP_HEADER  = 'flex items-center justify-between gap-3 px-4 py-2.5 bg-white/5 cursor-pointer hover:bg-white/10 transition-colors select-none';
const GROUP_BODY    = 'p-4';

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  badges,
  subtitle,
  headerActions,
  isOpen,
  onToggle,
  variant = 'stage',
  children,
  bodyClassName,
  className,
}) => {
  const isStage = variant === 'stage';

  return (
    <div className={`${isStage ? STAGE_WRAPPER : GROUP_WRAPPER} ${className ?? ''}`}>
      <div onClick={onToggle} className={isStage ? STAGE_HEADER : GROUP_HEADER}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            {isStage ? (
              <h2 className="text-lg font-bold text-white capitalize tracking-wide">{title}</h2>
            ) : (
              <span className="text-sm font-bold text-white">{title}</span>
            )}
            {badges}
          </div>
          {subtitle && (
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4 text-[10px] text-textMuted font-semibold uppercase tracking-wider mt-1.5">
              {subtitle}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {headerActions}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="text-textMuted hover:text-white transition-colors"
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            {isOpen
              ? <ChevronUp size={isStage ? 20 : 16} />
              : <ChevronDown size={isStage ? 20 : 16} />}
          </button>
        </div>
      </div>
      {isOpen && (
        <div className={bodyClassName ?? (isStage ? STAGE_BODY : GROUP_BODY)}>
          {children}
        </div>
      )}
    </div>
  );
};

interface StageSubtitleProps {
  isCurrentlyOpen: boolean;
  /** When open: shown as the closing time. When closed: unused. */
  closesAt?: string;
  /** When closed: shown as the opening time. When open: unused. */
  opensAt?: string;
}

export const StageSubtitle: React.FC<StageSubtitleProps> = ({ isCurrentlyOpen, closesAt, opensAt }) => {
  if (isCurrentlyOpen) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 font-bold tracking-widest text-[9px]">
          OPEN
        </span>
        {closesAt && (
          <span className="text-textMuted">Closes {closesAt}</span>
        )}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-500/15 text-red-400 font-bold tracking-widest text-[9px]">
        CLOSED
      </span>
      {opensAt && (
        <span className="text-textMuted">Opens {opensAt}</span>
      )}
    </span>
  );
};
