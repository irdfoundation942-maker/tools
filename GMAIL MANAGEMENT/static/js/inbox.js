// Inbox tab: sync contacts, search, sort, filter, bulk Gmail actions,
// and hand off selected recipients to the Campaign tab for templated sends.
(() => {
  const btnSync       = document.getElementById('btn-sync-inbox');
  const maxSel        = document.getElementById('inbox-max');
  const tbody         = document.getElementById('inbox-tbody');
  const search        = document.getElementById('inbox-search');
  const countEl       = document.getElementById('inbox-count');
  const exportA       = document.getElementById('btn-export-csv');
  const headers       = document.querySelectorAll('th[data-sort]');
  const btnToggle     = document.getElementById('btn-toggle-filters');
  const filtersPanel  = document.getElementById('filters-panel');
  const filtersCaret  = document.getElementById('filters-caret');
  const fFrom         = document.getElementById('filter-from');
  const fSubject      = document.getElementById('filter-subject');
  const fReplied      = document.getElementById('filter-replied');
  const fWithin       = document.getElementById('filter-date-within');
  const fDateFrom     = document.getElementById('filter-date-from');
  const fDateTo       = document.getElementById('filter-date-to');
  const btnClear      = document.getElementById('btn-clear-filters');
  const pageSizeSel   = document.getElementById('page-size');
  const pageRangeEl   = document.getElementById('page-range');
  const pageControls  = document.getElementById('page-controls');
  const selectAll     = document.getElementById('select-all');

  const bulkBar       = document.getElementById('bulk-actions');
  const bulkCountEl   = document.getElementById('bulk-count');
  const btnBulkArchive= document.getElementById('btn-bulk-archive');
  const btnBulkDelete = document.getElementById('btn-bulk-delete');
  const btnBulkLabel  = document.getElementById('btn-bulk-label');
  const btnBulkCompose= document.getElementById('btn-bulk-compose');
  const btnBulkClear  = document.getElementById('btn-bulk-clear');
  const labelPopover  = document.getElementById('label-popover');
  const labelList     = document.getElementById('label-list');
  const labelCancel   = document.getElementById('label-cancel');
  const labelApply    = document.getElementById('label-apply');

  let contacts = [];
  let sortKey  = 'date';
  let sortDir  = 'desc';
  let filter   = '';
  let currentPage = 1;
  let pageSize    = parseInt(pageSizeSel.value, 10) || 25;

  // Selection is tracked by sender email (rows are deduped by email).
  const selected = new Set();
  let availableLabels = null; // fetched lazily on first open of the popover

  const parseDate = (s) => {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  };

  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  const getFilteredSortedRows = () => {
    const q        = filter.trim().toLowerCase();
    const qFrom    = (fFrom.value || '').trim().toLowerCase();
    const qSubject = (fSubject.value || '').trim().toLowerCase();
    const repliedVal = (fReplied && fReplied.value) || '';
    const withinDays = parseInt(fWithin.value, 10);
    const dFromStr = fDateFrom.value;
    const dToStr   = fDateTo.value;

    let minDate = null;
    let maxDate = null;
    if (Number.isFinite(withinDays) && withinDays > 0) {
      minDate = Date.now() - withinDays * 86400000;
    }
    if (dFromStr) {
      const t = Date.parse(dFromStr + 'T00:00:00');
      if (Number.isFinite(t)) minDate = minDate == null ? t : Math.max(minDate, t);
    }
    if (dToStr) {
      const t = Date.parse(dToStr + 'T23:59:59');
      if (Number.isFinite(t)) maxDate = t;
    }

    let rows = contacts;
    if (q) {
      rows = rows.filter((c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.subject || '').toLowerCase().includes(q)
      );
    }
    if (qFrom) {
      rows = rows.filter((c) =>
        (c.name || '').toLowerCase().includes(qFrom) ||
        (c.email || '').toLowerCase().includes(qFrom)
      );
    }
    if (qSubject) {
      rows = rows.filter((c) => (c.subject || '').toLowerCase().includes(qSubject));
    }
    if (repliedVal === 'yes') {
      rows = rows.filter((c) => c.replied === true);
    } else if (repliedVal === 'no') {
      rows = rows.filter((c) => c.replied !== true);
    }
    if (minDate != null || maxDate != null) {
      rows = rows.filter((c) => {
        const t = parseDate(c.date);
        if (t == null) return false;
        if (minDate != null && t < minDate) return false;
        if (maxDate != null && t > maxDate) return false;
        return true;
      });
    }
    rows = [...rows].sort((a, b) => {
      let av = a[sortKey] ?? '';
      let bv = b[sortKey] ?? '';
      if (sortKey === 'date') {
        av = Date.parse(av) || 0;
        bv = Date.parse(bv) || 0;
      } else if (sortKey === 'replied') {
        av = a.replied ? 1 : 0;
        bv = b.replied ? 1 : 0;
      } else {
        av = String(av).toLowerCase();
        bv = String(bv).toLowerCase();
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return rows;
  };

  const renderSelectionUI = () => {
    const n = selected.size;
    if (n === 0) {
      bulkBar.classList.add('hidden');
    } else {
      bulkBar.classList.remove('hidden');
      bulkCountEl.textContent = `${n} selected`;
    }
  };

  const render = () => {
    const rows = getFilteredSortedRows();
    countEl.textContent = `${rows.length} contact${rows.length === 1 ? '' : 's'}`;

    const total = rows.length;
    const effectivePageSize = pageSize > 0 ? pageSize : (total || 1);
    const totalPages = Math.max(1, Math.ceil(total / effectivePageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * effectivePageSize;
    const endIdx   = pageSize > 0 ? Math.min(startIdx + effectivePageSize, total) : total;
    const pageRows = rows.slice(startIdx, endIdx);

    pageRangeEl.textContent = total === 0
      ? '0-0 of 0'
      : `${startIdx + 1}-${endIdx} of ${total}`;

    if (!total) {
      tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-10 text-center text-slate-400">
        No contacts to show.
      </td></tr>`;
      renderPagination(totalPages);
      syncSelectAllCheckbox([]);
      renderSelectionUI();
      return;
    }

    tbody.innerHTML = pageRows.map((c, i) => {
      const chipHtml = (c.labels || []).map((n) =>
        `<span class="label-chip" title="${escapeHtml(n)}">${escapeHtml(n)}</span>`
      ).join('');
      const repliedHtml = c.replied
        ? `<span class="reply-dot yes"></span><span class="text-xs text-emerald-700">Replied</span>`
        : `<span class="reply-dot no"></span><span class="text-xs text-slate-400">—</span>`;
      const checked = selected.has(c.email) ? 'checked' : '';
      return `
        <tr class="hover:bg-slate-50" data-email="${escapeHtml(c.email)}">
          <td class="px-3 py-2">
            <input type="checkbox" class="row-check w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                   data-email="${escapeHtml(c.email)}" ${checked}/>
          </td>
          <td class="px-4 py-2 text-slate-400 text-xs">${startIdx + i + 1}</td>
          <td class="px-4 py-2 font-medium text-slate-800">${escapeHtml(c.name)}</td>
          <td class="px-4 py-2 text-slate-600">${escapeHtml(c.email)}</td>
          <td class="px-4 py-2 text-slate-600 truncate max-w-xs" title="${escapeHtml(c.subject)}">
            ${escapeHtml(c.subject)}
          </td>
          <td class="px-4 py-2 text-slate-600">${chipHtml || '<span class="text-slate-300 text-xs">—</span>'}</td>
          <td class="px-4 py-2 whitespace-nowrap">${repliedHtml}</td>
          <td class="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">${escapeHtml(c.date)}</td>
        </tr>
      `;
    }).join('');

    headers.forEach((h) => {
      h.classList.remove('sort-asc', 'sort-desc');
      if (h.dataset.sort === sortKey) {
        h.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    renderPagination(totalPages);
    syncSelectAllCheckbox(pageRows);
    renderSelectionUI();
  };

  const syncSelectAllCheckbox = (pageRows) => {
    if (!selectAll) return;
    if (!pageRows.length) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
      return;
    }
    const selectedOnPage = pageRows.filter((r) => selected.has(r.email)).length;
    selectAll.checked = selectedOnPage === pageRows.length;
    selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < pageRows.length;
  };

  const pageNumbers = (total, current) => {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const nums = new Set([1, total, current, current - 1, current + 1]);
    if (current <= 3) { nums.add(2); nums.add(3); nums.add(4); }
    if (current >= total - 2) { nums.add(total - 1); nums.add(total - 2); nums.add(total - 3); }
    const sorted = [...nums].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('…');
      out.push(sorted[i]);
    }
    return out;
  };

  const renderPagination = (totalPages) => {
    const btnCls = 'px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed';
    const activeCls = 'px-2.5 py-1 rounded-lg border border-brand-500 bg-brand-500 text-white';
    const parts = [];

    parts.push(`<button class="${btnCls}" data-page="prev" ${currentPage <= 1 ? 'disabled' : ''}>‹ Prev</button>`);

    for (const n of pageNumbers(totalPages, currentPage)) {
      if (n === '…') {
        parts.push(`<span class="px-1 text-slate-400">…</span>`);
      } else {
        parts.push(`<button class="${n === currentPage ? activeCls : btnCls}" data-page="${n}">${n}</button>`);
      }
    }

    parts.push(`<button class="${btnCls}" data-page="next" ${currentPage >= totalPages ? 'disabled' : ''}>Next ›</button>`);

    pageControls.innerHTML = parts.join('');
  };

  pageControls.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-page]');
    if (!btn || btn.disabled) return;
    const v = btn.dataset.page;
    if (v === 'prev') currentPage = Math.max(1, currentPage - 1);
    else if (v === 'next') currentPage = currentPage + 1;
    else currentPage = parseInt(v, 10) || 1;
    render();
  });

  pageSizeSel.addEventListener('change', () => {
    pageSize = parseInt(pageSizeSel.value, 10);
    if (!Number.isFinite(pageSize)) pageSize = 25;
    currentPage = 1;
    render();
  });

  const resetToFirstPage = () => { currentPage = 1; };

  headers.forEach((h) => h.addEventListener('click', () => {
    const key = h.dataset.sort;
    if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortKey = key; sortDir = 'asc'; }
    resetToFirstPage();
    render();
  }));

  search.addEventListener('input', (e) => {
    filter = e.target.value;
    resetToFirstPage();
    render();
  });

  [fFrom, fSubject].forEach((el) =>
    el.addEventListener('input', () => { resetToFirstPage(); render(); })
  );
  [fWithin, fDateFrom, fDateTo, fReplied].forEach((el) =>
    el && el.addEventListener('change', () => { resetToFirstPage(); render(); })
  );

  btnToggle.addEventListener('click', () => {
    const open = filtersPanel.classList.toggle('hidden') === false;
    filtersCaret.textContent = open ? '▴' : '▾';
  });

  btnClear.addEventListener('click', () => {
    fFrom.value = '';
    fSubject.value = '';
    if (fReplied) fReplied.value = '';
    fWithin.value = '';
    fDateFrom.value = '';
    fDateTo.value = '';
    search.value = '';
    filter = '';
    resetToFirstPage();
    render();
  });

  // ---------- selection wiring -------------------------------------------
  tbody.addEventListener('change', (e) => {
    const cb = e.target.closest('input.row-check');
    if (!cb) return;
    const email = cb.dataset.email;
    if (!email) return;
    if (cb.checked) selected.add(email);
    else selected.delete(email);
    renderSelectionUI();
    // Keep header checkbox in sync without re-rendering rows.
    const visible = getFilteredSortedRows();
    const eps = pageSize > 0 ? pageSize : (visible.length || 1);
    const start = (currentPage - 1) * eps;
    const end = pageSize > 0 ? Math.min(start + eps, visible.length) : visible.length;
    syncSelectAllCheckbox(visible.slice(start, end));
  });

  if (selectAll) {
    selectAll.addEventListener('change', () => {
      const visible = getFilteredSortedRows();
      const eps = pageSize > 0 ? pageSize : (visible.length || 1);
      const start = (currentPage - 1) * eps;
      const end = pageSize > 0 ? Math.min(start + eps, visible.length) : visible.length;
      const pageRows = visible.slice(start, end);
      if (selectAll.checked) {
        pageRows.forEach((r) => selected.add(r.email));
      } else {
        pageRows.forEach((r) => selected.delete(r.email));
      }
      render();
    });
  }

  btnBulkClear.addEventListener('click', () => {
    selected.clear();
    render();
  });

  const selectedContacts = () =>
    contacts.filter((c) => selected.has(c.email));

  const selectedThreadIds = () =>
    selectedContacts().map((c) => c.thread_id).filter(Boolean);

  // ---------- bulk actions (Gmail API) -----------------------------------
  const runBulk = async (action, extra = {}) => {
    const thread_ids = selectedThreadIds();
    if (!thread_ids.length) {
      alert('No threads to act on — selected rows are missing thread IDs.');
      return null;
    }
    const body = { action, thread_ids, ...extra };
    return window.apiFetch('/api/inbox/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  };

  const removeSelectedFromView = () => {
    // After archive/delete, rows shouldn't appear in the Inbox list anymore.
    contacts = contacts.filter((c) => !selected.has(c.email));
    selected.clear();
    render();
  };

  btnBulkArchive.addEventListener('click', async () => {
    const n = selected.size;
    if (!n) return;
    if (!confirm(`Archive ${n} thread(s)? They will be removed from the inbox.`)) return;
    btnBulkArchive.disabled = true;
    try {
      const res = await runBulk('archive');
      if (!res) return;
      removeSelectedFromView();
      countEl.textContent = `${contacts.length} contact${contacts.length === 1 ? '' : 's'} · archived ${res.succeeded}`;
    } catch (err) {
      alert(`Archive failed: ${err.message || err}`);
    } finally {
      btnBulkArchive.disabled = false;
    }
  });

  btnBulkDelete.addEventListener('click', async () => {
    const n = selected.size;
    if (!n) return;
    if (!confirm(`Move ${n} thread(s) to Trash? You can restore them from Gmail within 30 days.`)) return;
    btnBulkDelete.disabled = true;
    try {
      const res = await runBulk('delete');
      if (!res) return;
      removeSelectedFromView();
      countEl.textContent = `${contacts.length} contact${contacts.length === 1 ? '' : 's'} · trashed ${res.succeeded}`;
    } catch (err) {
      alert(`Delete failed: ${err.message || err}`);
    } finally {
      btnBulkDelete.disabled = false;
    }
  });

  // ---------- label popover ----------------------------------------------
  const loadLabels = async () => {
    if (availableLabels) return availableLabels;
    labelList.innerHTML = '<div class="px-3 py-2 text-slate-400">Loading labels…</div>';
    try {
      const data = await window.apiFetch('/api/inbox/labels');
      availableLabels = data.labels || [];
    } catch (err) {
      availableLabels = [];
      labelList.innerHTML =
        `<div class="px-3 py-2 text-red-600">Failed to load labels: ${escapeHtml(err.message || err)}</div>`;
      return availableLabels;
    }
    if (!availableLabels.length) {
      labelList.innerHTML =
        `<div class="px-3 py-2 text-slate-500">No user-created labels found. Create one in Gmail first.</div>`;
    }
    return availableLabels;
  };

  const renderLabelList = () => {
    if (!availableLabels || !availableLabels.length) return;
    // Tri-state: "add", "remove", or "leave alone". Each click cycles.
    // Default = leave alone.
    labelList.innerHTML = availableLabels.map((l) => `
      <label class="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-sm"
             data-label-id="${escapeHtml(l.id)}">
        <select class="label-op text-xs border border-slate-200 rounded px-1 py-0.5">
          <option value="" selected>—</option>
          <option value="add">Add</option>
          <option value="remove">Remove</option>
        </select>
        <span class="truncate">${escapeHtml(l.name)}</span>
      </label>
    `).join('');
  };

  btnBulkLabel.addEventListener('click', async (e) => {
    e.stopPropagation();
    const willOpen = labelPopover.classList.contains('hidden');
    labelPopover.classList.toggle('hidden');
    if (willOpen) {
      await loadLabels();
      renderLabelList();
    }
  });

  document.addEventListener('click', (e) => {
    if (labelPopover.classList.contains('hidden')) return;
    if (!labelPopover.contains(e.target) && e.target !== btnBulkLabel) {
      labelPopover.classList.add('hidden');
    }
  });

  labelCancel.addEventListener('click', () => {
    labelPopover.classList.add('hidden');
  });

  labelApply.addEventListener('click', async () => {
    if (!selected.size) return;
    const add_label_ids = [];
    const remove_label_ids = [];
    labelList.querySelectorAll('[data-label-id]').forEach((row) => {
      const id = row.dataset.labelId;
      const op = row.querySelector('.label-op').value;
      if (op === 'add') add_label_ids.push(id);
      else if (op === 'remove') remove_label_ids.push(id);
    });
    if (!add_label_ids.length && !remove_label_ids.length) {
      alert('Pick at least one label to add or remove.');
      return;
    }
    labelApply.disabled = true;
    try {
      const res = await runBulk('label', { add_label_ids, remove_label_ids });
      if (!res) return;
      // Patch local contacts so the table reflects the change without a re-sync.
      const lookup = Object.fromEntries((availableLabels || []).map((l) => [l.id, l.name]));
      contacts.forEach((c) => {
        if (!selected.has(c.email)) return;
        const labelIds = new Set(c.label_ids || []);
        add_label_ids.forEach((id) => labelIds.add(id));
        remove_label_ids.forEach((id) => labelIds.delete(id));
        c.label_ids = [...labelIds].sort();
        c.labels = c.label_ids.map((id) => lookup[id]).filter(Boolean);
      });
      labelPopover.classList.add('hidden');
      render();
      countEl.textContent = `${contacts.length} contact${contacts.length === 1 ? '' : 's'} · labels updated on ${res.succeeded}`;
    } catch (err) {
      alert(`Label update failed: ${err.message || err}`);
    } finally {
      labelApply.disabled = false;
    }
  });

  // ---------- direct template send handoff -------------------------------
  btnBulkCompose.addEventListener('click', () => {
    const emails = [...selected];
    if (!emails.length) return;
    // Store on window so campaign.js picks it up immediately.
    window.campaignRecipients = emails;
    window.dispatchEvent(new CustomEvent('campaign:recipients', { detail: emails }));
    // Switch to the Campaign tab.
    const btn = document.querySelector('.tab-btn[data-tab="campaign"]');
    if (btn) btn.click();
  });

  // ---------- CSV export (filtered view) ---------------------------------
  const csvEscape = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const downloadFilteredCsv = () => {
    const rows = getFilteredSortedRows();
    const header = ['#', 'Name', 'Email', 'Subject', 'Date', 'Replied', 'Labels'];
    const lines = [header.map(csvEscape).join(',')];
    rows.forEach((c, i) => {
      lines.push([
        i + 1,
        c.name || '',
        c.email || '',
        c.subject || '',
        c.date || '',
        c.replied ? 'yes' : 'no',
        (c.labels || []).join('; '),
      ].map(csvEscape).join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inbox_contacts_${rows.length}_${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  exportA.removeAttribute('href');
  exportA.setAttribute('role', 'button');
  exportA.style.cursor = 'pointer';
  exportA.addEventListener('click', (e) => {
    e.preventDefault();
    downloadFilteredCsv();
  });

  // ---------- sync -------------------------------------------------------
  btnSync.addEventListener('click', async () => {
    btnSync.disabled = true;
    const orig = btnSync.textContent;
    btnSync.textContent = 'Syncing…';
    try {
      const data = await window.apiFetch(`/api/inbox/contacts?max=${encodeURIComponent(maxSel.value)}`);
      contacts = data.contacts || [];
      selected.clear();
      resetToFirstPage();
      render();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-10 text-center text-red-500">
        Failed: ${String(e.message || e)}
      </td></tr>`;
    } finally {
      btnSync.disabled = false;
      btnSync.textContent = orig;
    }
  });
})();
