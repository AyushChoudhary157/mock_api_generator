// Dialog for backing up / restoring the anonymous management token.
import { h, openDialog, field, copyButton, toast, confirmDialog } from './util.js';
import { getToken, setToken, TOKEN_RE } from './store.js';

export function openAccessKeyDialog({ onRestored }) {
  const token = getToken();
  let shown = false;
  const code = h('code', { class: 'url token' }, `${token.slice(0, 8)}${'•'.repeat(24)}${token.slice(-4)}`);
  const toggle = h('button', { type: 'button', class: 'btn btn-sm', onClick: () => {
    shown = !shown;
    code.textContent = shown ? token : `${token.slice(0, 8)}${'•'.repeat(24)}${token.slice(-4)}`;
    toggle.textContent = shown ? 'Hide' : 'Show';
  } }, 'Show');
  const input = h('input', { type: 'text', placeholder: 'mat_…', autocomplete: 'off', spellcheck: 'false' });
  const f = field({ label: 'Restore access with an existing key', input, hint: 'Paste a key from another browser or device. Your current key is replaced.' });

  openDialog({
    title: 'Access key & backup', size: 'md',
    body: h('div', { class: 'stack' },
      h('p', { class: 'lead' }, 'No account needed. Your projects are tied to this secret key, stored only in this browser. Anyone who has it can edit your projects, so keep it private.'),
      h('div', { class: 'endpoint-row' }, code, toggle, copyButton(() => token, { label: 'Copy key', ariaLabel: 'Copy access key' })),
      h('div', { class: 'notice notice-warn' }, 'If you clear your browser data without saving this key, you lose management access. Your public API keeps working until the project expires after 30 days of inactivity.'),
      f.el),
    actions: [
      { label: 'Close' },
      { label: 'Restore access', primary: true, onClick: async () => {
        const v = input.value.trim();
        if (!TOKEN_RE.test(v)) { f.setError('That does not look like a valid key. It starts with mat_ followed by 48 characters.'); return true; }
        const ok = await confirmDialog({ title: 'Switch to this key?', message: 'Your current key will be replaced. Make sure you saved it if you still need it.', confirmLabel: 'Switch key' });
        if (!ok) return true;
        setToken(v);
        toast('Access restored', 'success');
        await onRestored();
        return false;
      } },
    ],
  });
}
