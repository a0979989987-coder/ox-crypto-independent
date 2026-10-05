// Restore the OX LIVE display preference before the page body paints.
try {
  document.documentElement.classList.toggle('ox-live-disabled', localStorage.getItem('ox-setting-oxLive') !== '1');
} catch { document.documentElement.classList.add('ox-live-disabled'); }
