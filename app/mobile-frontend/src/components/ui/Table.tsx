import React from 'react';

interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {}

export const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className = '', children, ...props }, ref) => {
    return (
      <div className="overflow-x-auto">
        <table
          ref={ref}
          className={`w-full text-sm text-left text-textMain ${className}`}
          {...props}
        >
          {children}
        </table>
      </div>
    );
  }
);
Table.displayName = 'Table';

export const Thead: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ className = '', children, ...props }) => (
  <thead className={`text-xs text-textMuted uppercase bg-white/5 ${className}`} {...props}>
    {children}
  </thead>
);

export const Tbody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ className = '', children, ...props }) => (
  <tbody className={`divide-y divide-white/5 ${className}`} {...props}>
    {children}
  </tbody>
);

export const Tr: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({ className = '', children, ...props }) => (
  <tr className={`hover:bg-white/5 transition-colors ${className}`} {...props}>
    {children}
  </tr>
);

export const Th: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({ className = '', children, ...props }) => (
  <th scope="col" className={`px-6 py-3 font-medium ${className}`} {...props}>
    {children}
  </th>
);

export const Td: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({ className = '', children, ...props }) => (
  <td className={`px-6 py-4 ${className}`} {...props}>
    {children}
  </td>
);
