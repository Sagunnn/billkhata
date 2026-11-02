// Keyboard shortcuts (Figma: Desktop notes → Keyboard). Opened with "?".
import { Modal, Kbd } from './ui.jsx';

const KEYS = [
  ['S', 'Scan a bill'],
  ['N', 'Add a bill by hand'],
  ['Q', 'Quick cash out'],
  ['/', 'Search'],
  ['J / K', 'Next / previous bill'],
  ['↵', 'Open the selected bill'],
  ['Esc', 'Close a sheet'],
  ['?', 'Show or hide this list'],
];

export function ShortcutsSheet({ onClose }) {
  return (
    <Modal open size="md" title="Keyboard shortcuts" subtitle="Not while typing in a box" onClose={onClose}>
      <ul className="divide-y divide-line">
        {KEYS.map(([k, what]) => (
          <li key={k} className="flex items-center justify-between gap-3 py-2.5">
            <span className="t-body text-ink">{what}</span>
            <span className="flex gap-1">{k.split(' / ').map((x) => <Kbd key={x} className="!inline-flex">{x}</Kbd>)}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
