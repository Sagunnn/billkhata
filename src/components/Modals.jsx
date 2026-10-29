import { useState } from 'react';
import { Save, Ticket, Trash } from 'lucide-react';
import { validateExpense } from '../lib/expense.js';
import { compressImage, fileToDataUrl, validateImageFile } from '../lib/image.js';
import { formatAD, formatBS } from '../lib/nepaliDate.js';
import { money } from '../lib/format.js';
import { getIrdStatus } from '../lib/ird.js';
import { IRD_STATUS } from '../lib/constants.js';
import { useStore } from '../store.jsx';
import BillForm from './BillForm.jsx';
import { IrdModal } from './Ird.jsx';
import { useToast } from './Toast.jsx';
import { Button, Modal } from './ui.jsx';

/** Reads, checks and compresses a picked photo. Returns a data URL or throws. */
export async function photoFromFile(file) {
  const err = validateImageFile(file);
  if (err) throw new Error(err);
  const { dataUrl } = await compressImage(await fileToDataUrl(file));
  return dataUrl;
}

export function BillEditor({ expense, onClose }) {
  const { saveExpense, removeExpense, profile, openIrd } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState(expense);
  const [viewPhoto, setViewPhoto] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  async function save(thenApply = false) {
    const errs = validateExpense(draft);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const saved = await saveExpense(draft);
      toast('Bill saved.');
      if (thenApply) openIrd(saved);
      else onClose();
    } catch (e) {
      toast(e.message || 'Could not save.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the bill from ${draft.merchantName || 'this shop'}? This cannot be undone.`)) return;
    await removeExpense(draft.id);
    toast('Bill deleted.');
    onClose();
  }

  const canApply = getIrdStatus(draft) === IRD_STATUS.NOT_APPLIED;

  return (
    <>
    <Modal
      open
      onClose={viewPhoto ? () => {} : onClose}
      title="Edit bill"
      size="xl"
      footer={(
        <>
          <Button variant="danger" icon={Trash} onClick={remove} className="mr-auto">Delete</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {canApply && <Button variant="outline" icon={Ticket} onClick={() => save(true)} disabled={busy}>Save & apply</Button>}
          <Button variant="dark" icon={Save} onClick={() => save(false)} disabled={busy}>Save</Button>
        </>
      )}
    >
      <BillForm
        value={draft}
        errors={errors}
        region={profile.region}
        onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        onPhoto={async (file) => {
          try {
            const img = await photoFromFile(file);
            setDraft((d) => ({ ...d, receiptImage: img }));
          } catch (e) {
            toast(e.message, 'error');
          }
        }}
        onRemovePhoto={() => setDraft((d) => ({ ...d, receiptImage: null }))}
        onViewPhoto={() => setViewPhoto(true)}
      />
    </Modal>
    {viewPhoto && <PhotoViewer expense={draft} onClose={() => setViewPhoto(false)} />}
    </>
  );
}

export function PhotoViewer({ expense, onClose }) {
  const { profile } = useStore();
  return (
    <Modal open onClose={onClose} title={expense.merchantName || 'Bill photo'} size="lg">
      <img src={expense.receiptImage} alt={`Bill from ${expense.merchantName}`} className="mx-auto max-h-[70dvh] rounded-lg border border-slate-200 object-contain" />
      <p className="mt-3 text-center text-sm text-slate-600">
        {formatAD(expense.billDateAD)}{expense.billDateBS ? ` · ${formatBS(expense.billDateBS)} BS` : ''} · <span className="num font-semibold text-slate-900">{money(expense.totalAmount, profile.region)}</span>
      </p>
    </Modal>
  );
}

/** Renders whichever shared modal is open. */
export function ModalHost() {
  const { modal, closeModal } = useStore();
  if (!modal) return null;
  if (modal.type === 'editor') return <BillEditor key={modal.expense.id} expense={modal.expense} onClose={closeModal} />;
  if (modal.type === 'ird') return <IrdModal expense={modal.expense} onClose={closeModal} />;
  if (modal.type === 'photo') return <PhotoViewer expense={modal.expense} onClose={closeModal} />;
  return null;
}
