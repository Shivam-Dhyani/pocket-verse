'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SearchResultDto } from '@pocketverse/shared';
import { driveApi } from '@/lib/files';
import { iconForMime, SearchIcon } from '@/components/icons';

export function SearchBox({ onOpen }: { onOpen: (file: SearchResultDto) => void }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => driveApi.search(debounced),
    enabled: debounced.length > 0,
  });

  const matches = results.data?.results ?? [];

  return (
    <div className="pv-search" ref={boxRef}>
      <SearchIcon width={16} height={16} />
      <input
        value={query}
        placeholder="Search your universe…"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && debounced.length > 0 && (
        <div className="pv-search-results">
          {matches.length === 0 ? (
            <button type="button" disabled style={{ cursor: 'default', opacity: 0.7 }}>
              {results.isPending ? 'Searching…' : 'No matches'}
            </button>
          ) : (
            matches.map((file) => {
              const Icon = iconForMime(file.mimeType);
              return (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => {
                    onOpen(file);
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  <Icon width={16} height={16} />
                  <span>{file.name}</span>
                  <span className="where">{file.folderName ?? 'My universe'}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
