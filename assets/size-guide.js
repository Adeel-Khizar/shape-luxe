// Size guide popup. Uses document-level delegation so guides inserted later
// (Quick Add modal, variant re-renders) work without re-running inline scripts.

/**
 * @param {HTMLElement} guide
 * @param {string} unit
 */
function buildTable(guide, unit) {
  const data = guide.querySelector(`[data-size-guide-data="${unit}"]`);
  const target = guide.querySelector(`[data-size-guide-table="${unit}"]`);
  if (!(target instanceof HTMLElement) || !data || target.dataset.built === 'true') return;

  let raw = '';
  try {
    raw = JSON.parse(data.textContent || '""');
  } catch (error) {}

  const rows = String(raw || '')
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.split('|').map((cell) => cell.trim()));

  if (!rows.length) {
    target.closest('[data-size-guide-panel]')?.setAttribute('hidden', '');
    return;
  }

  const [header = [], ...body] = rows;
  const table = document.createElement('table');
  table.className = 'size-guide__table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const value of header) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = value;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of body) {
    const tr = document.createElement('tr');
    header.forEach((_, i) => {
      const td = document.createElement('td');
      td.textContent = row[i] || '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  target.replaceChildren(table);
  target.dataset.built = 'true';
}

/**
 * @param {HTMLElement} guide
 * @param {string | undefined} unit
 */
function setUnit(guide, unit) {
  if (!unit) return;

  for (const tab of guide.querySelectorAll('[data-size-guide-tab]')) {
    if (!(tab instanceof HTMLElement)) continue;
    const active = tab.dataset.sizeGuideTab === unit;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }

  for (const panel of guide.querySelectorAll('[data-size-guide-panel]')) {
    if (panel instanceof HTMLElement) panel.hidden = panel.dataset.sizeGuidePanel !== unit;
  }

  buildTable(guide, unit);
}

/** @param {HTMLDialogElement} dialog */
function closeDialog(dialog) {
  if (dialog.close) dialog.close();
  else dialog.removeAttribute('open');
}

if (!window.sizeGuideInitialized) {
  window.sizeGuideInitialized = true;

  // Capture phase so events inside an open guide never reach an outer dialog
  // (e.g. Quick Add), which closes on Escape and on clicks outside its own box.
  document.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;

      const guide = event.target.closest('[data-size-guide]');
      if (!(guide instanceof HTMLElement)) return;

      const dialog = guide.querySelector('[data-size-guide-dialog]');
      if (!(dialog instanceof HTMLDialogElement)) return;

      if (event.target.closest('[data-size-guide-open]')) {
        const firstPanel = guide.querySelector('[data-size-guide-panel]');
        setUnit(guide, firstPanel instanceof HTMLElement ? firstPanel.dataset.sizeGuidePanel : undefined);
        if (dialog.showModal) dialog.showModal();
        else dialog.setAttribute('open', '');
        return;
      }

      if (!dialog.contains(event.target)) return;
      event.stopPropagation();

      if (event.target.closest('[data-size-guide-close]') || event.target === dialog) {
        closeDialog(dialog);
        return;
      }

      const tab = event.target.closest('[data-size-guide-tab]');
      if (tab instanceof HTMLElement) setUnit(guide, tab.dataset.sizeGuideTab);
    },
    true
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !(event.target instanceof Element)) return;

      const dialog = event.target.closest('[data-size-guide-dialog]');
      if (!(dialog instanceof HTMLDialogElement) || !dialog.open) return;

      event.preventDefault();
      event.stopPropagation();
      closeDialog(dialog);
    },
    true
  );
}
