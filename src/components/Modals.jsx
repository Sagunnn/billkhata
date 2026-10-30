import { useState } from 'react';
import { Divide, Save, Ticket, Trash } from 'lucide-react';
import { validateExpense } from '../lib/expense.js';
import { compressImage, fileToDataUrl, imageHash, validateImageFile } from '../lib/image.js';
import { crossReferenceBill } from '../lib/dedupe.js';
import { unresolvedMatches } from './CrossReference.jsx';
import { formatAD, formatBS } from '../lib/nepaliDate.js';
import { money } from '../lib/format.js';
import { findDuplicateBill, getIrdStatus } from '../lib/ird.js';
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

/** The fields to set on a bill for a new photo: the image and its perceptual hash. */
export async function photoFieldsFromFile(file) {
  const receiptImage = await photoFromFile(file);
  return { receiptImage, imageHash: await imageHash(receiptImage) };
}

/** Saving is held back while the bill copies an earlier one and the user hasn't chosen "Save anyway". */
export function duplicateHold(draft, expenses) {
  return unresolvedMatches(crossReferenceBill(draft, expenses), draft);
}

export function BillEditor({ expense, onClose }) {
  const { saveExpense, removeExpense, profile, openIrd, expenses } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState(expense);
  const [viewPhoto, setViewPhoto] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  async function save(thenApply = false) {
    const errs = validateExpense(draft);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (duplicateHold(draft, expenses).length) {
      toast('This looks like a bill you already saved. Use “Delete this copy”, or “Save Anyway (Override)” if it really is a different bill.', 'error');
      return;
    }
    setBusy(true);
    try {
      const saved = await saveExpense(draft);
      toast('Bill saved.');
      if (thenApply === 'split') { onClose(); window.location.hash = `#/split-bill/${encodeURIComponent(saved.id)}`; }
      else if (thenApply) openIrd(saved);
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

  const canApply = getIrdStatus(draft) === IRD_STATUS.NOT_APPLIED && !findDuplicateBill(draft, expenses);
  const isSaved = expenses.some((x) => x.id === draft.id);

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
          <Button variant="outline" icon={Divide} disabled={busy} onClick={() => save('split')}>{draft.split ? 'Edit split' : 'Split'}</Button>
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
            const fields = await photoFieldsFromFile(file);
            setDraft((d) => ({ ...d, ...fields }));
          } catch (e) {
            toast(e.message, 'error');
          }
        }}
        onRemovePhoto={() => setDraft((d) => ({ ...d, receiptImage: null, imageHash: '' }))}
        onViewPhoto={() => setViewPhoto(true)}
        onDiscard={isSaved ? remove : onClose}
        discardLabel={isSaved ? 'Delete this copy' : 'Discard this bill'}
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
