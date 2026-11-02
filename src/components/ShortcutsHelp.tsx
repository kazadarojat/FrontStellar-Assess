import { useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';

interface ShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], label: 'Buka command palette' },
  { keys: ['R'], label: 'Jalankan benchmark' },
  { keys: ['S'], label: 'Hentikan benchmark yang berjalan' },
  { keys: ['1', '…', '6'], label: 'Pindah tab provider' },
  { keys: ['?'], label: 'Buka bantuan shortcut' },
  { keys: ['Esc'], label: 'Tutup dialog atau palette' },
];

export default function ShortcutsHelp({ open, onClose }: ShortcutsHelpProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Bantuan shortcut keyboard"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow small">
              <Keyboard size={13} />
              Shortcut
            </span>
            <h3>Kendalikan tanpa mouse</h3>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Tutup bantuan shortcut"
          >
            <X size={16} />
          </button>
        </div>
        <ul className="shortcut-list">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.label}>
              <span>{shortcut.label}</span>
              <span className="shortcut-keys">
                {shortcut.keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="shortcut-note">
          Shortcut angka dan huruf tidak aktif saat Anda mengetik di kolom input.
        </p>
      </div>
    </div>
  );
}
