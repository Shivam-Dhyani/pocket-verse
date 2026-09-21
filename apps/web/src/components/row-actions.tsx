'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { MoreIcon } from '@/components/icons';
import { useMediaQuery } from '@/lib/pointer';

export interface RowAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * Per-item actions for a drive row or grid card.
 *
 * On pointer/desktop layouts these stay as the familiar inline icon buttons.
 * On phones and small tablets four icon buttons consumed most of the row — so
 * they collapse into one overflow button that opens a labelled menu. Labels are
 * a bonus on touch: the inline icons were unlabelled and easy to mis-tap.
 */
export function RowActions({ actions }: { actions: RowAction[] }) {
  const compact = useMediaQuery('(max-width: 760px)');
  const [open, setOpen] = useState(false);

  // A row can scroll out from under an open menu; close on Escape too.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    // Clicks on the actions must never also trigger the row's open handler.
    <span className="pv-row-actions" onClick={(event) => event.stopPropagation()}>
      {compact ? (
        <span className="pv-menu-wrap">
          <button
            className="pv-iconbtn"
            type="button"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <MoreIcon />
          </button>
          {open && (
            <>
              <div className="pv-menu-backdrop" onClick={() => setOpen(false)} />
              <div className="pv-menu pv-menu--end" role="menu">
                {actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    role="menuitem"
                    className={action.danger ? 'pv-menu-danger' : undefined}
                    onClick={() => {
                      setOpen(false);
                      action.onSelect();
                    }}
                  >
                    {action.icon} {action.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </span>
      ) : (
        actions.map((action) => (
          <button
            key={action.label}
            className="pv-iconbtn"
            type="button"
            title={action.label}
            aria-label={action.label}
            onClick={action.onSelect}
          >
            {action.icon}
          </button>
        ))
      )}
    </span>
  );
}
