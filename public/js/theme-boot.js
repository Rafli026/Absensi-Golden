/* Theme boot — must load synchronously in <head> (no defer) to avoid a flash. */
(function () {
  try {
    var t = localStorage.getItem('absensi_theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* ignore (private mode / storage disabled) */ }
})();
