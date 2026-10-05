(() => {
  window.OXSession = Object.freeze({
    get status() { return window.OXAuth.user ? 'authenticated' : window.OXAuth.status.configured ? 'configured' : 'not-configured'; },
    getCurrent: () => window.OXAuth.getCurrent(),
    refresh: () => window.OXAuth.getCurrent(),
    signOut: () => window.OXAuth.signOut()
  });
})();
