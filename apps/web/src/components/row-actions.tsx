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
    // Each button below stops its own click from also opening/toggling the
    // row — this span doesn't do it in one place, on purpose. Mobile Chrome
    // nudges an imprecise tap onto the nearest small tappable target (built-in
    // "touch adjustment", meant to make small buttons easier to hit); a tap a
    // few pixels off the kebab button lands its click on this wrapper span,
    // not the button. A stopPropagation() here would swallow that click
    // outright — no menu opens, and it silently never reaches the row either —
    // turning a generous area *around* the kebab into a dead zone. Stopping
    // propagation only on each real button means a tap that truly lands on
    // one still won't also select the row, while a tap merely adjusted into
    // this wrapper's area falls through to the row as intended.
    <span className="pv-row-actions">
      {compact ? (
        <span className="pv-menu-wrap">
          <button
            className="pv-iconbtn"
            type="button"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((value) => !value);
            }}
          >
            <MoreIcon />
          </button>
          {open && (
            <>
              <div
                className="pv-menu-backdrop"
                // Fixed and full-screen visually, but still nested under the
                // row in the DOM — without this, dismissing the menu by
                // tapping anywhere on screen would also bubble up and
                // toggle/open the row it belongs to.
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                }}
              />
              <div
                className="pv-menu pv-menu--end"
                role="menu"
                onClick={(event) => event.stopPropagation()}
              >
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
            onClick={(event) => {
              event.stopPropagation();
              action.onSelect();
            }}
          >
            {action.icon}
          </button>
        ))
      )}
    </span>
  );
}
