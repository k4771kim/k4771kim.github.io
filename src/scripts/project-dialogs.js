const modals = Array.from(
  document.querySelectorAll('dialog.modal'),
).filter((modal) => modal instanceof HTMLDialogElement);

/**
 * @type {WeakMap<HTMLDialogElement, {
 *   trigger: HTMLButtonElement;
 *   previousBodyOverflow: string;
 * }>}
 */
const modalStates = new WeakMap();

/** @param {HTMLDialogElement} modal */
function closeModal(modal) {
  if (modal.open) modal.close();
}

/**
 * @param {HTMLDialogElement} modal
 * @param {HTMLButtonElement} trigger
 */
function openModal(modal, trigger) {
  if (modal.open) return;

  let previousBodyOverflow = document.body.style.overflow;
  const currentModal = modals.find(
    (candidate) => candidate !== modal && candidate.open,
  );
  if (currentModal) {
    previousBodyOverflow =
      modalStates.get(currentModal)?.previousBodyOverflow ??
      previousBodyOverflow;
    modalStates.delete(currentModal);
    closeModal(currentModal);
  }

  modalStates.set(modal, {
    trigger,
    previousBodyOverflow,
  });
  document.body.style.overflow = 'hidden';
  modal.showModal();
  modal
    .querySelector('.modal-close')
    ?.focus({ preventScroll: true });
}

document.querySelectorAll('.detail-btn').forEach((trigger) => {
  if (!(trigger instanceof HTMLButtonElement)) return;

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const target = trigger.dataset.modalTarget;
    const modal = target ? document.getElementById(target) : null;
    if (modal instanceof HTMLDialogElement) openModal(modal, trigger);
  });
});

modals.forEach((modal) => {
  modal.addEventListener('close', () => {
    const state = modalStates.get(modal);
    if (!state) return;

    document.body.style.overflow = state.previousBodyOverflow;
    modalStates.delete(modal);
    state.trigger.focus({ preventScroll: true });
  });

  modal.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeModal(modal);
  });

  modal.addEventListener('click', (event) => {
    if (event.target !== modal) return;

    const panel = modal.querySelector('[data-modal-panel]');
    if (!(panel instanceof HTMLElement)) return;

    const { left, right, top, bottom } = panel.getBoundingClientRect();
    const outsidePanel =
      event.clientX < left ||
      event.clientX > right ||
      event.clientY < top ||
      event.clientY > bottom;
    if (outsidePanel) closeModal(modal);
  });

  modal.querySelector('.modal-close')?.addEventListener('click', () => {
    closeModal(modal);
  });
});
