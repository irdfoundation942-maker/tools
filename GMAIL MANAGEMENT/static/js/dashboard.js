// Tab switching between "Inbox & Contacts" and "CSV Campaign".
(() => {
  const tabs = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('[data-panel]');

  const activate = (name) => {
    tabs.forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle('border-brand-500', active);
      t.classList.toggle('text-brand-600', active);
      t.classList.toggle('border-transparent', !active);
      t.classList.toggle('text-slate-500', !active);
    });
    panels.forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
  };

  tabs.forEach((t) => t.addEventListener('click', () => activate(t.dataset.tab)));
})();

// Small helper used across panels.
window.apiFetch = async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...opts,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data.error) msg = data.error;
    } catch (_) { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
};
