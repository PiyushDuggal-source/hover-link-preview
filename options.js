const DEFAULTS = { enabled: true, delaySec: 5, size: 'medium', keepOnScreen: false, listMode: 'deny', domains: '' };
const $ = (id) => document.getElementById(id);
const status = $('status');

function checkedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value;
}

function setRadio(name, value) {
  const r = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (r) r.checked = true;
}

function flash(msg, isErr) {
  status.textContent = msg;
  status.className = isErr ? 'err' : '';
  if (!isErr) setTimeout(() => (status.textContent = ''), 2000);
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  $('enabled').checked = !!s.enabled;
  $('keepOnScreen').checked = s.keepOnScreen === true;
  $('delaySec').value = s.delaySec;
  setRadio('size', s.size);
  setRadio('listMode', s.listMode);
  $('domains').value = s.domains;
});

$('save').addEventListener('click', () => {
  const delay = Number($('delaySec').value);
  if (!Number.isFinite(delay) || delay < 1 || delay > 30) {
    flash('Delay must be between 1 and 30 seconds.', true);
    return;
  }
  chrome.storage.sync.set(
    {
      enabled: $('enabled').checked,
      keepOnScreen: $('keepOnScreen').checked,
      delaySec: Math.round(delay),
      size: checkedValue('size') || DEFAULTS.size,
      listMode: checkedValue('listMode') || DEFAULTS.listMode,
      domains: $('domains').value,
    },
    () => (chrome.runtime.lastError ? flash(chrome.runtime.lastError.message, true) : flash('Saved'))
  );
});
