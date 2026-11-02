import { useState } from 'react';
import { Check, Database, Download, FileJson, GitCompare, History, Trash2 } from 'lucide-react';
import type { HistoryEntry } from '../history';
import { historyProviderLabels, historyRetries } from '../history';
import { formatDateTime, formatDuration, truncate } from '../format';
import HistoryDiff from './HistoryDiff';

interface HistoryPanelProps {
  entries: HistoryEntry[];
  onLoad: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onExportCsv: (entry: HistoryEntry) => void;
  onExportJson: (entry: HistoryEntry) => void;
}

export default function HistoryPanel({
  entries,
  onLoad,
  onDelete,
  onClear,
  onExportCsv,
  onExportJson,
}: HistoryPanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [diffOpen, setDiffOpen] = useState(false);

  const selectedEntries = selectedIds
    .map((id) => entries.find((entry) => entry.id === id))
    .filter((entry): entry is HistoryEntry => Boolean(entry));

  function toggleSelect(id: string) {
    setSelectedIds((previous) => {
      if (previous.includes(id)) return previous.filter((item) => item !== id);
      return previous.length >= 2 ? [previous[1], id] : [...previous, id];
    });
  }

  function handleDelete(id: string) {
    setSelectedIds((previous) => previous.filter((item) => item !== id));
    onDelete(id);
  }

  function handleClear() {
    setSelectedIds([]);
    setDiffOpen(false);
    onClear();
  }

  return (
    <section className="panel history-panel" id="history">
      <div className="section-heading compact">
        <span className="step-number">
          <History size={15} />
        </span>
        <div>
          <div className="eyebrow small">Arsip lokal</div>
          <h2>Riwayat pengujian</h2>
        </div>
        <div className="history-head-actions">
          {selectedIds.length > 0 && (
            <button
              type="button"
              className="button secondary small-button"
              onClick={() => setDiffOpen(true)}
              disabled={selectedEntries.length < 2}
              title={
                selectedEntries.length < 2
                  ? 'Pilih dua riwayat untuk membandingkan'
                  : 'Bandingkan dua riwayat'
              }
            >
              <GitCompare size={13} />
              Bandingkan {selectedIds.length}/2
            </button>
          )}
          <span className="selection-count">
            <span>{entries.length}</span> / 15
          </span>
          {entries.length > 0 && (
            <button type="button" className="text-button muted" onClick={handleClear}>
              <Trash2 size={13} />
              Hapus semua
            </button>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="history-empty">
          <span className="empty-icon">
            <Database size={22} />
          </span>
          <div>
            <strong>Belum ada riwayat</strong>
            <p>
              Setiap benchmark yang selesai otomatis disimpan di browser ini. API key tidak pernah
              ikut disimpan.
            </p>
          </div>
        </div>
      ) : (
        <div className="history-list">
          {entries.map((entry) => {
            const modelCount = entry.runs.length;
            const retries = historyRetries(entry);
            const selected = selectedIds.includes(entry.id);
            return (
              <article
                className={`history-row ${selected ? 'is-selected' : ''}`}
                key={entry.id}
              >
                <div className="history-main">
                  <div className="history-meta">
                    <span className="history-date">{formatDateTime(entry.createdAt)}</span>
                    <span className="history-dot" />
                    <span>{modelCount} model</span>
                    <span className="history-dot" />
                    <span>{entry.repetitions}× ulangan</span>
                    <span className="history-dot" />
                    <span>{entry.concurrency} bersamaan</span>
                    {retries > 0 && (
                      <>
                        <span className="history-dot" />
                        <span className="history-retry">{retries}× retry</span>
                      </>
                    )}
                  </div>
                  <p className="history-prompt" title={entry.prompt}>
                    {truncate(entry.prompt.replace(/\s+/g, ' '), 130)}
                  </p>
                  <div className="history-tags">
                    {historyProviderLabels(entry).map((label) => (
                      <span className="meta-tag" key={label}>
                        {label}
                      </span>
                    ))}
                    <span className="meta-tag manual">
                      {formatDuration(entry.wallTotalMs)} total
                    </span>
                  </div>
                </div>
                <div className="history-actions">
                  <button
                    type="button"
                    className={`text-button ${selected ? 'is-selected' : ''}`}
                    onClick={() => toggleSelect(entry.id)}
                    aria-pressed={selected}
                    title={selected ? 'Batalkan pilihan' : 'Pilih untuk dibandingkan'}
                  >
                    {selected ? <Check size={13} /> : <GitCompare size={13} />}
                    {selected ? 'Terpilih' : 'Pilih'}
                  </button>
                  <button type="button" className="text-button" onClick={() => onLoad(entry)}>
                    Buka
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onExportCsv(entry)}
                    title="Ekspor CSV"
                    aria-label="Ekspor riwayat ke CSV"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onExportJson(entry)}
                    title="Ekspor JSON"
                    aria-label="Ekspor riwayat ke JSON"
                  >
                    <FileJson size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button danger"
                    onClick={() => handleDelete(entry.id)}
                    title="Hapus riwayat"
                    aria-label="Hapus riwayat ini"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {diffOpen && selectedEntries.length >= 2 && (
        <HistoryDiff
          first={selectedEntries[0]}
          second={selectedEntries[1]}
          onClose={() => setDiffOpen(false)}
        />
      )}
    </section>
  );
}
