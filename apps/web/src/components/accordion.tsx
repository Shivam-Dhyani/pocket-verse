'use client';

import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * An exclusive accordion: opening one panel closes the others.
 *
 * Two mechanisms, deliberately layered:
 *  1. The HTML `name` attribute makes `<details>` elements mutually exclusive
 *     natively — it works before React hydrates and costs nothing.
 *  2. A capture-phase `toggle` listener does the same in browsers that predate
 *     that attribute. (`toggle` doesn't bubble, but non-bubbling events still
 *     reach ancestors during the capture phase, so one listener covers a whole
 *     group.) Where both apply the JS pass simply finds nothing left to close.
 */
const AccordionContext = createContext<string | null>(null);

export function Accordion({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // One shared `name` per group — that is what makes the panels exclusive.
  const groupName = useId();

  useEffect(() => {
    const root = ref.current;
    if (!root) {
      return;
    }
    const onToggle = (event: Event) => {
      const opened = event.target as HTMLDetailsElement;
      if (!opened.open) {
        return;
      }
      for (const other of root.querySelectorAll<HTMLDetailsElement>('details[open]')) {
        if (other !== opened) {
          other.open = false;
        }
      }
    };
    root.addEventListener('toggle', onToggle, true);
    return () => root.removeEventListener('toggle', onToggle, true);
  }, []);

  return (
    <AccordionContext.Provider value={groupName}>
      <div className="pv-accordion" ref={ref}>
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

export function AccordionItem({
  summary,
  children,
  defaultOpen,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const groupName = useContext(AccordionContext);
  return (
    <details name={groupName ?? undefined} open={defaultOpen}>
      <summary>{summary}</summary>
      <div className="pv-accordion-body">{children}</div>
    </details>
  );
}
