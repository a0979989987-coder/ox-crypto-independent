/* Browser talks only to OX. Provider tokens remain in HttpOnly cookies. */
(() => {
  let current = null, sessionEpoch = 0, logoutPending = false, logoutRequest = null, emailPending = false;
  const cooldownKey = 'ox-email-cooldown-until';
  let emailCooldownUntil = 0;
  try { const stored = Number(window.sessionStorage?.getItem(cooldownKey)); if (Number.isFinite(stored) && stored > Date.now() && stored < Date.now() + 3600000) emailCooldownUntil = stored; } catch {}
  const remainingEmailCooldown = () => Math.max(0, Math.ceil((emailCooldownUntil - Date.now()) / 1000));
  function emailCooldown(seconds = 60) {
    emailCooldownUntil = Date.now() + Math.max(1, Math.min(300, Number(seconds) || 60)) * 1000;
    try { window.sessionStorage?.setItem(cooldownKey, String(emailCooldownUntil)); } catch {}
    document.dispatchEvent(new CustomEvent('ox:emailcooldown', { detail: { until: emailCooldownUntil } }));
  }
  async function sendEmail(email, register) {
    if (emailPending) return { ok: false, code: 'EMAIL_REQUEST_PENDING', message: '登入信正在寄送，請勿重複提交。' };
    const seconds = remainingEmailCooldown();
    if (seconds) return { ok: false, code: 'EMAIL_COOLDOWN', message: `請等候 ${seconds} 秒後再寄送登入信。`, cooldownSeconds: seconds };
    emailPending = true;
    try {
      const result = await request('email', { email, register, returnTo: location.pathname + location.search + location.hash });
      if (result.ok || result.code === 'EMAIL_RATE_LIMITED') emailCooldown(result.cooldownSeconds || 60);
      return result;
    } finally { emailPending = false; }
  }
  let config = { configured: false };
  async function request(endpoint, body, options={}) {
    try {
      const response = await fetch(`/api/v1/account/${endpoint}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal:options.signal, headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      if (!response.ok) return { ok: false, code: endpoint === 'email' && response.status === 429 ? 'EMAIL_RATE_LIMITED' : result.code, cooldownSeconds: result.cooldownSeconds, message: result.message || '登入服務尚未設定或暫時無法使用。' };
      return result;
    } catch { return { ok: false, message: '目前無法連接登入服務。' }; }
  }
  function setUser(user) { current = user || null; document.dispatchEvent(new CustomEvent('ox:accountchange', { detail: { user: current } })); }
  window.OXAuth = Object.freeze({
    get user() { return current; },
    get status() { return { configured: config.configured === true, providerConnected: !!current, configurationOnly: !current }; },
    get emailCooldownSeconds() { return remainingEmailCooldown(); },
    async initialize() { const epoch = sessionEpoch; config = await request('config'); let user = null; if (config.configured) { const result = await request('session'); if (result.ok) user = result.user; } if (epoch === sessionEpoch && !logoutPending) setUser(user); return config; },
    async getCurrent(options={}) { const epoch = sessionEpoch; const result = await request('session',undefined,options); if (epoch === sessionEpoch && !logoutPending) setUser(result.ok ? result.user : null); return current; },
    getAdminReviewStatus() { return request('admin-review'); },
    getBitgetLink() { return request('bitget-link'); },
    saveBitgetLink(uid, revision) { return request('bitget-link', { action: 'save', uid, revision }); },
    removeBitgetLink(revision) { return request('bitget-link', { action: 'remove', revision }); },
    async signInWithGoogle() { const result = await request('google', { returnTo: location.pathname + location.search + location.hash }); if (result.ok && result.url) location.assign(result.url); return result; },
    signInWithEmail(email) { return sendEmail(email, false); },
    registerWithEmail(email) { return sendEmail(email, true); },
    async verifyEmail(email, token) { const epoch = sessionEpoch; const result = await request('verify', { email, token }); if (result.ok && epoch === sessionEpoch && !logoutPending) setUser(result.user); return result; },
    async signOut() {
      if (logoutRequest) return logoutRequest;
      sessionEpoch++; logoutPending = true;
      logoutRequest = (async () => {
        try { const result = await request('logout', {}); sessionEpoch++; if (result.ok) setUser(null); return result; }
        finally { logoutPending = false; logoutRequest = null; }
      })();
      return logoutRequest;
    }
  });
})();
