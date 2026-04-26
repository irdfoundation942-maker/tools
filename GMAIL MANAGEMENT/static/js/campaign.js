// Campaign tab: CSV/XLSX upload with drag-drop, UI overrides, templates,
// confirmation modal, and SSE-driven send progress.
(() => {
  const form         = document.getElementById('upload-form');
  const fileInput    = document.getElementById('csv-file');
  const dropZone     = document.getElementById('drop-zone');
  const dzFilename   = document.getElementById('dz-filename');
  const btnClearCsv  = document.getElementById('btn-clear-csv');
  const uploadStatus = document.getElementById('upload-status');
  const previewTbody = document.getElementById('preview-tbody');
  const previewCount = document.getElementById('preview-count');
  const runBtn       = document.getElementById('btn-run-campaign');

  const tplSelect    = document.getElementById('msg-template');
  const btnSaveTpl   = document.getElementById('btn-save-template');
  const btnDelTpl    = document.getElementById('btn-delete-template');
  const uiSubject    = document.getElementById('ui-subject');
  const uiBodyEl     = document.getElementById('ui-body');

  const recipWrap    = document.getElementById('ui-recipients-wrap');
  const recipChips   = document.getElementById('ui-recipients-chips');
  const recipCountEl = document.getElementById('ui-recipients-count');
  const btnClearRecipients = document.getElementById('btn-clear-recipients');

  // Recipients handed off from the Inbox tab live here so the existing
  // CSV/preview flow stays untouched when users don't use this path.
  let uiRecipients = Array.isArray(window.campaignRecipients)
    ? [...window.campaignRecipients] : [];

  // ---------- rich text editor (Quill) -----------------------------------
  const quill = new Quill(uiBodyEl, {
    theme: 'snow',
    placeholder: 'Write your message here…',
    modules: {
      toolbar: '#ui-body-toolbar',
      history: { delay: 1000, maxStack: 100, userOnly: true },
    },
    formats: [
      'bold', 'italic', 'underline', 'color', 'background',
      'font', 'size', 'align', 'list', 'link',
    ],
  });

  document.querySelector('#ui-body-toolbar .ql-undo')
    .addEventListener('click', () => quill.history.undo());
  document.querySelector('#ui-body-toolbar .ql-redo')
    .addEventListener('click', () => quill.history.redo());

  const uiBody = {
    get html()  { return quill.root.innerHTML; },
    get text()  { return quill.getText().trim(); },
    setHtml(h)  { quill.clipboard.dangerouslyPasteHTML(h); },
    clear()     { quill.setText(''); },
    get isEmpty() { return this.text === ''; },
  };

  const modal        = document.getElementById('confirm-modal');
  const cmCount      = document.getElementById('cm-count');
  const cmMode       = document.getElementById('cm-mode');
  const cmSubject    = document.getElementById('cm-subject');
  const cmBody       = document.getElementById('cm-body');
  const cmCancel     = document.getElementById('cm-cancel');
  const cmConfirm    = document.getElementById('cm-confirm');

  const progressWrap    = document.getElementById('progress-wrap');
  const progressBar     = document.getElementById('progress-bar');
  const progressLabel   = document.getElementById('progress-label');
  const progressCount   = document.getElementById('progress-count');
  const progressSummary = document.getElementById('progress-summary');

  const log            = document.getElementById('activity-log');
  const btnClearLog    = document.getElementById('btn-clear-log');

  let currentES = null;
  let uploadedCount = 0;

  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  // ---------- message templates (edit freely; add as many as you want) ----
  const TEMPLATES = [
    {
      name: 'Interview invitation',
      subject: 'Interview invitation',
      body: `<p>Hi {{name}},</p>
<p>Thank you for your interest in the position. We'd like to invite you for an <strong>interview</strong>.</p>
<p>Please reply with a time that works best for you over the next few days.</p>
<p>Looking forward to speaking with you,<br><strong>HR Team</strong></p>`,
    },
  ];

  // Mark built-ins so we know which ones can't be deleted.
  TEMPLATES.forEach((t) => { t.builtin = true; });

  const LS_KEY = 'hrmgr.userTemplates.v1';

  const loadUserTemplates = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  };

  const saveUserTemplates = (arr) => {
    localStorage.setItem(LS_KEY, JSON.stringify(arr));
  };

  let userTemplates = loadUserTemplates();

  const allTemplates = () => [...TEMPLATES, ...userTemplates];

  const rebuildDropdown = (preserveValue) => {
    tplSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— Select a template —';
    tplSelect.appendChild(placeholder);

    if (TEMPLATES.length) {
      const g = document.createElement('optgroup');
      g.label = 'Built-in';
      TEMPLATES.forEach((t, i) => {
        const opt = document.createElement('option');
        opt.value = `b:${i}`;
        opt.textContent = t.name;
        g.appendChild(opt);
      });
      tplSelect.appendChild(g);
    }

    if (userTemplates.length) {
      const g = document.createElement('optgroup');
      g.label = 'My templates';
      userTemplates.forEach((t, i) => {
        const opt = document.createElement('option');
        opt.value = `u:${i}`;
        opt.textContent = t.name;
        g.appendChild(opt);
      });
      tplSelect.appendChild(g);
    }

    if (preserveValue && tplSelect.querySelector(`option[value="${preserveValue}"]`)) {
      tplSelect.value = preserveValue;
    }
    updateDeleteBtn();
  };

  const getSelectedTemplate = () => {
    const v = tplSelect.value;
    if (!v) return null;
    const [kind, idxStr] = v.split(':');
    const i = parseInt(idxStr, 10);
    if (!Number.isFinite(i)) return null;
    if (kind === 'b') return { kind: 'b', i, t: TEMPLATES[i] };
    if (kind === 'u') return { kind: 'u', i, t: userTemplates[i] };
    return null;
  };

  const updateDeleteBtn = () => {
    const sel = getSelectedTemplate();
    if (sel && sel.kind === 'u') {
      btnDelTpl.classList.remove('hidden');
    } else {
      btnDelTpl.classList.add('hidden');
    }
  };

  rebuildDropdown();

  tplSelect.addEventListener('change', () => {
    updateDeleteBtn();
    const sel = getSelectedTemplate();
    if (!sel || !sel.t) return;
    const t = sel.t;
    if (!uiSubject.value.trim() || confirm('Replace current Subject with this template?')) {
      uiSubject.value = t.subject || '';
    }
    if (uiBody.isEmpty || confirm('Replace current Body with this template?')) {
      uiBody.setHtml(t.body || '');
    }
  });

  btnSaveTpl.addEventListener('click', () => {
    const subj = uiSubject.value.trim();
    const html = uiBody.isEmpty ? '' : uiBody.html;
    if (!subj && !html) {
      alert('Add a Subject or Body first — nothing to save.');
      return;
    }

    const sel = getSelectedTemplate();
    const defaultName = (sel && sel.kind === 'u') ? sel.t.name : '';
    const name = prompt('Template name:', defaultName || subj || 'Untitled');
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    if (TEMPLATES.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      alert('That name matches a built-in template. Pick a different name.');
      return;
    }

    const existingIdx = userTemplates.findIndex(
      (t) => t.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existingIdx >= 0) {
      if (!confirm(`Overwrite existing template "${trimmed}"?`)) return;
      userTemplates[existingIdx] = { name: trimmed, subject: subj, body: html };
    } else {
      userTemplates.push({ name: trimmed, subject: subj, body: html });
    }
    saveUserTemplates(userTemplates);

    const newIdx = userTemplates.findIndex(
      (t) => t.name.toLowerCase() === trimmed.toLowerCase()
    );
    rebuildDropdown(`u:${newIdx}`);
  });

  btnDelTpl.addEventListener('click', () => {
    const sel = getSelectedTemplate();
    if (!sel || sel.kind !== 'u') return;
    if (!confirm(`Delete template "${sel.t.name}"? This can't be undone.`)) return;
    userTemplates.splice(sel.i, 1);
    saveUserTemplates(userTemplates);
    rebuildDropdown();
  });

  // ---------- preview rendering ------------------------------------------
  const renderPreview = (rows) => {
    previewCount.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`;
    if (!rows.length) {
      previewTbody.innerHTML = `<tr><td colspan="4" class="px-4 py-10 text-center text-slate-400">
        No rows.
      </td></tr>`;
      return;
    }
    previewTbody.innerHTML = rows.map((r, i) => `
      <tr class="hover:bg-slate-50 align-top">
        <td class="px-4 py-2 text-slate-400">${i + 1}</td>
        <td class="px-4 py-2 font-medium">${escapeHtml(r.Email)}</td>
        <td class="px-4 py-2 text-slate-600">${escapeHtml(r.Subject)}</td>
        <td class="px-4 py-2 text-slate-600 whitespace-pre-wrap">${escapeHtml((r.Message_Body || '').slice(0, 200))}${(r.Message_Body || '').length > 200 ? '…' : ''}</td>
      </tr>
    `).join('');
  };

  const appendLog = (item) => {
    if (log.children.length === 1 && log.children[0].textContent.includes('No activity')) {
      log.innerHTML = '';
    }
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="status-pill ${item.status}">${item.status}</span>
      <span class="font-medium">${escapeHtml(item.email || '—')}</span>
      <span class="text-slate-500 text-xs ml-auto">${escapeHtml(item.detail || '')}</span>
    `;
    log.prepend(li);
  };

  btnClearLog.addEventListener('click', () => {
    log.innerHTML = '<li class="px-4 py-6 text-center text-slate-400">No activity yet.</li>';
  });

  // ---------- drag-and-drop + file input ---------------------------------
  const setFile = (file) => {
    if (!file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    dzFilename.textContent = file.name;
    dzFilename.classList.remove('hidden');
    uploadStatus.textContent = '';
  };

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) {
      dzFilename.textContent = f.name;
      dzFilename.classList.remove('hidden');
    }
  });

  ['dragenter', 'dragover'].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('border-brand-500', 'bg-brand-50');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('border-brand-500', 'bg-brand-50');
    })
  );
  dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const ok = /\.(csv|xlsx|xlsm|xltx|xltm)$/i.test(file.name);
    if (!ok) {
      uploadStatus.textContent = 'Only .csv or .xlsx files are accepted.';
      return;
    }
    setFile(file);
  });

  btnClearCsv.addEventListener('click', async () => {
    fileInput.value = '';
    dzFilename.textContent = '';
    dzFilename.classList.add('hidden');
    uploadStatus.textContent = '';
    uploadedCount = 0;
    runBtn.disabled = !hasUiRecipients();
    renderPreview([]);
    try { await window.apiFetch('/api/campaign/clear', { method: 'POST' }); } catch (_) { /* ignore */ }
  });

  // ---------- upload form ------------------------------------------------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fileInput.files || !fileInput.files[0]) {
      uploadStatus.textContent = 'Choose a CSV/Excel file first.';
      return;
    }
    const fd = new FormData();
    fd.append('file', fileInput.files[0]);

    uploadStatus.textContent = 'Parsing…';
    runBtn.disabled = true;
    try {
      const data = await window.apiFetch('/api/campaign/upload', { method: 'POST', body: fd });
      uploadStatus.textContent = `Parsed ${data.count} row(s). Showing first ${data.preview_count}.`;
      renderPreview(data.preview);
      uploadedCount = data.count;
      runBtn.disabled = data.count === 0 && !hasUiRecipients();
    } catch (err) {
      uploadStatus.textContent = `Error: ${err.message || err}`;
      previewTbody.innerHTML = `<tr><td colspan="4" class="px-4 py-10 text-center text-red-500">
        ${escapeHtml(String(err.message || err))}
      </td></tr>`;
      uploadedCount = 0;
      runBtn.disabled = !hasUiRecipients();
    }
  });

  // ---------- run + confirm ----------------------------------------------
  const getSendMode = () => {
    const picked = document.querySelector('input[name="send-mode"]:checked');
    return picked ? picked.value : 'auto';
  };

  const hasUiRecipients = () => uiRecipients.length > 0;

  const renderRecipients = () => {
    if (!uiRecipients.length) {
      recipWrap.classList.add('hidden');
      recipChips.innerHTML = '';
      recipCountEl.textContent = '0';
    } else {
      recipWrap.classList.remove('hidden');
      recipCountEl.textContent = String(uiRecipients.length);
      recipChips.innerHTML = uiRecipients.map((e, i) => `
        <span class="recipient-chip">
          <span title="${escapeHtml(e)}">${escapeHtml(e)}</span>
          <button type="button" data-idx="${i}" aria-label="Remove ${escapeHtml(e)}">×</button>
        </span>
      `).join('');
    }
    runBtn.disabled = !(uploadedCount > 0 || hasUiRecipients());
  };

  recipChips.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-idx]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    if (!Number.isFinite(idx)) return;
    uiRecipients.splice(idx, 1);
    window.campaignRecipients = uiRecipients;
    renderRecipients();
  });

  btnClearRecipients.addEventListener('click', () => {
    uiRecipients = [];
    window.campaignRecipients = [];
    renderRecipients();
  });

  window.addEventListener('campaign:recipients', (e) => {
    const list = Array.isArray(e.detail) ? e.detail : [];
    // De-dupe while preserving existing order (chips already shown win).
    const existing = new Set(uiRecipients);
    list.forEach((em) => {
      if (em && !existing.has(em)) {
        uiRecipients.push(em);
        existing.add(em);
      }
    });
    window.campaignRecipients = uiRecipients;
    renderRecipients();
  });

  // If inbox.js already set recipients before this script loaded, render them.
  renderRecipients();

  const modeLabel = (m) => ({
    auto:  'Auto (reply if thread exists, else new)',
    reply: 'Reply only',
    new:   'Always new email',
  }[m] || m);

  const openConfirm = () => {
    const mode = getSendMode();
    const subj = uiSubject.value.trim();

    if (uploadedCount) {
      cmCount.textContent = `${uploadedCount} (from CSV/Excel)`;
    } else if (hasUiRecipients()) {
      cmCount.textContent = `${uiRecipients.length} (from Inbox selection)`;
    } else {
      cmCount.textContent = '0';
    }
    cmMode.textContent = modeLabel(mode);
    cmSubject.textContent = subj
      ? subj
      : (uploadedCount ? '(using per-row Subject from CSV)' : '(none)');

    if (!uiBody.isEmpty) {
      cmBody.innerHTML = uiBody.html;
    } else if (uploadedCount) {
      cmBody.textContent = '(using per-row Message_Body from CSV)';
    } else {
      cmBody.textContent = '(empty)';
    }

    modal.classList.remove('hidden');
  };
  const closeConfirm = () => modal.classList.add('hidden');

  cmCancel.addEventListener('click', closeConfirm);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeConfirm();
  });

  runBtn.addEventListener('click', () => {
    if (uploadedCount === 0 && !hasUiRecipients()) {
      uploadStatus.textContent = 'Upload a CSV/Excel or pick recipients from the Inbox tab.';
      return;
    }
    if (!uploadedCount && hasUiRecipients()) {
      const subj = uiSubject.value.trim();
      const mode = getSendMode();
      if (!subj && mode !== 'reply') {
        alert('Add a Subject override — direct recipients have no CSV to fall back to.');
        return;
      }
      if (uiBody.isEmpty && mode !== 'reply') {
        if (!confirm('Body is empty. Send anyway?')) return;
      }
    }
    openConfirm();
  });

  cmConfirm.addEventListener('click', async () => {
    closeConfirm();
    runBtn.disabled = true;
    progressWrap.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressLabel.textContent = 'Starting…';
    progressCount.textContent = '0 / 0';
    progressSummary.textContent = '';

    const bodyHtml = uiBody.isEmpty ? '' : uiBody.html;
    const payload = {
      send_mode: getSendMode(),
      subject: uiSubject.value.trim(),
      body: bodyHtml,
      body_format: bodyHtml ? 'html' : 'plain',
    };
    // When no CSV is loaded, pass the chip recipients so the backend skips
    // the CSV-rows path entirely (see routes/campaign.py::start).
    if (!uploadedCount && hasUiRecipients()) {
      payload.recipients = [...uiRecipients];
    }

    let job;
    try {
      job = await window.apiFetch('/api/campaign/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      progressLabel.textContent = `Failed to start: ${err.message || err}`;
      runBtn.disabled = false;
      return;
    }

    const { job_id, total } = job;
    progressCount.textContent = `0 / ${total}`;

    if (currentES) { currentES.close(); }
    const es = new EventSource(`/api/campaign/progress/${job_id}`);
    currentES = es;

    let processed = 0;
    es.addEventListener('progress', (evt) => {
      const data = JSON.parse(evt.data);
      processed = data.index > 0 ? data.index : processed + 1;
      const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
      progressBar.style.width = `${pct}%`;
      progressLabel.textContent = `Processing ${data.email || ''}`;
      progressCount.textContent = `${processed} / ${total}`;
      appendLog(data);
    });

    es.addEventListener('summary', (evt) => {
      const s = JSON.parse(evt.data);
      progressSummary.textContent =
        `Done. ${s.replied || 0} replied, ${s.new || 0} new, ${s.failed || 0} failed.`;
      progressLabel.textContent = 'Completed';
      progressBar.style.width = '100%';
    });

    es.addEventListener('done', () => {
      es.close();
      currentES = null;
      runBtn.disabled = false;
    });

    es.onerror = () => {
      es.close();
      currentES = null;
      runBtn.disabled = false;
      progressLabel.textContent = 'Connection lost. Check logs.';
    };
  });
})();
