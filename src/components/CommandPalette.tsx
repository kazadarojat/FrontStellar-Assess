import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search, type LucideIcon } from 'lucide-react';

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  icon: LucideIcon;
  run: () => void;
  disabled?: boolean;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
}

export default function CommandPalette({ open, onClose, actions }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter((action) =>
      `${action.label} ${action.hint ?? ''} ${action.keywords ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [actions, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    setActiveIndex((previous) => Math.min(previous, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  if (!open) return null;

  const runAction = (action: PaletteAction | undefined) => {
    if (!action || action.disabled) return;
    onClose();
    action.run();
  };

  return (
    <div className="modal-backdrop palette-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((previous) => Math.min(filtered.length - 1, previous + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((previous) => Math.max(0, previous - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                runAction(filtered[activeIndex]);
              }
            }}
            placeholder="Ketik aksi: jalankan, ulangi gagal, tema, demo…"
            aria-label="Cari aksi"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd>ESC</kbd>
        </div>

        <div className="palette-list" ref={listRef} role="listbox" aria-label="Daftar aksi">
          {filtered.length ? (
            filtered.map((action, index) => {
              const Icon = action.icon;
              return (
                <button
                  type="button"
                  key={action.id}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-active={index === activeIndex}
                  className={`palette-item ${index === activeIndex ? 'active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => runAction(action)}
                  disabled={action.disabled}
                >
                  <span className="palette-icon">
                    <Icon size={15} />
                  </span>
                  <span className="palette-copy">
                    <strong>{action.label}</strong>
                    {action.hint && <small>{action.hint}</small>}
                  </span>
                  {index === activeIndex && (
                    <span className="palette-enter">
                      <CornerDownLeft size={12} />
                    </span>
                  )}
                </button>
              );
            })
          ) : (
            <p className="palette-empty">Tidak ada aksi yang cocok.</p>
          )}
        </div>

        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigasi
          </span>
          <span>
            <kbd>↵</kbd> jalankan
          </span>
          <span>Ctrl/Cmd + K untuk buka</span>
        </div>
      </div>
    </div>
  );
}
