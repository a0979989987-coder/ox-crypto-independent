// The saved theme before the first paint, so a 白金 reader never sees a dark frame first
// (src/app/view-home-theme.js applies the theme again with everything else). Loaded right
// after <body> opens; index.html keeps no inline scripts.
(function () {
  try {
    var mode = localStorage.getItem('ox-ui-theme');
    if (mode === 'light' || mode === 'system' && matchMedia('(prefers-color-scheme: light)').matches) {
      document.body.classList.add('theme-light');
      document.documentElement.style.colorScheme = 'light';
    }
  } catch (e) {}
})();
