import React from 'react';

interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  headerExtra?: React.ReactNode;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className = '', title, headerExtra, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`glass-card rounded-xl p-6 ${className}`}
        {...props}
      >
        {(title || headerExtra) && (
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-textMain flex items-center">
              {title}
            </h3>
            {headerExtra}
          </div>
        )}
        {children}
      </div>
    );
  }
);
Card.displayName = 'Card';
