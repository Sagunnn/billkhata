import { useState } from 'react';
import { Check, Divide, Ticket, Trash } from 'lucide-react';
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
import { ReceiptViewer } from './ReceiptViewer.jsx';
import { AccountsSheet, MoneyHistorySheet, MoneyInSheet, MoveSheet, QuickOutSheet } from './MoneySheets.jsx';
import { ShortcutsSheet } from './Shortcuts.jsx';
import { TripQuickSheet } from '../views/Trips.jsx';
import { WelcomeSheet } from './Welcome.jsx';
import { InstallSheet } from './InstallGuide.jsx';

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
      title={isSaved ? 'Edit bill' : 'New bill'}
      size="xl"
      footer={(
        // Phones: a full-width Save on top, the rest in one row below it (✕ closes, so no Cancel).
        <div className="flex w-full flex-wrap gap-2 sm:justify-end">
          <Button variant="primary" size="lg" icon={Check} onClick={() => save(false)} disabled={busy} className="w-full sm:order-last sm:w-auto">Save bill</Button>
          <Button variant="danger" icon={Trash} onClick={remove} aria-label="Delete this bill" className="sm:order-first sm:mr-auto"><span className="hidden sm:inline">Delete</span></Button>
          <span className="hidden sm:contents"><Button variant="ghost" onClick={onClose}>Cancel</Button></span>
          <Button variant="outline" icon={Divide} disabled={busy} onClick={() => save('split')} className="flex-1 sm:flex-none">{draft.split ? 'Edit split' : 'Split'}</Button>
          {canApply && <Button variant="outline" icon={Ticket} onClick={() => save(true)} disabled={busy} className="flex-1 sm:flex-none">Save &amp; apply</Button>}
        </div>
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
      <ReceiptViewer src={expense.receiptImage} alt={`Bill from ${expense.merchantName || 'this shop'}`} className="h-[68dvh] rounded-lg border border-slate-200" />
      <p className="mt-3 text-center text-sm text-slate-600">
        {formatAD(expense.billDateAD)}{expense.billDateBS ? ` · ${formatBS(expense.billDateBS)} BS` : ''} · <span className="num font-semibold text-slate-900">{money(expense.totalAmount, profile.region)}</span>
      </p>
    </Modal>
  );
}

/** Renders whichever shared modal is open. */
export function ModalHost() {
  const { modal, closeModal, openSheet, expenses } = useStore();
  if (!modal) return null;
  // "Apply all": one bill after another, stopping when one is closed without its coupon saved.
  const irdDone = () => {
    const queue = (modal.queue || []).map((id) => expenses.find((e) => e.id === id)).filter((e) => e && getIrdStatus(e) === IRD_STATUS.NOT_APPLIED);
    const saved = getIrdStatus(expenses.find((e) => e.id === modal.expense.id) || modal.expense) === IRD_STATUS.APPLIED;
    if (saved && queue.length) openSheet('ird', { expense: queue[0], queue: queue.slice(1).map((e) => e.id) });
    else closeModal();
  };
  if (modal.type === 'editor') return <BillEditor key={modal.expense.id} expense={modal.expense} onClose={closeModal} />;
  if (modal.type === 'ird') return <IrdModal key={modal.expense.id} expense={modal.expense} onClose={modal.queue ? irdDone : closeModal} />;
  if (modal.type === 'photo') return <PhotoViewer expense={modal.expense} onClose={closeModal} />;
  if (modal.type === 'accounts') return <AccountsSheet onClose={closeModal} />;
  if (modal.type === 'moneyIn') return <MoneyInSheet account={modal.account} onClose={closeModal} />;
  if (modal.type === 'move') return <MoveSheet onClose={closeModal} />;
  if (modal.type === 'quickOut') return <QuickOutSheet split={modal.split} onClose={closeModal} />;
  if (modal.type === 'moneyHistory') return <MoneyHistorySheet onClose={closeModal} />;
  if (modal.type === 'shortcuts') return <ShortcutsSheet onClose={closeModal} />;
  if (modal.type === 'install') return <InstallSheet onClose={closeModal} />;
  if (modal.type === 'welcome') return <WelcomeSheet step={modal.step} onClose={closeModal} />;
  if (modal.type === 'tripQuick') return <TripQuickSheet tripId={modal.tripId} onClose={closeModal} />;
  return null;
}
