(() => {
  const $ = (s, root=document) => root.querySelector(s);
  const overlay = $('#ox-account-overlay');
  const authView = $('#ox-account-auth-view');
  const center = $('#ox-account-center');
  const status = $('#ox-account-auth-status');
  let priorFocus = null, busy = false;
  const form = $('#ox-account-email-form');
  let linkEpoch = 0, linkRevision = null, adminEpoch = 0;
  async function loadAdmin(user) {
    const epoch = ++adminEpoch;
    let entry = $('#ox-account-admin-open');
    if (!entry) {
      entry = document.createElement('button'); entry.id = 'ox-account-admin-open'; entry.type = 'button';
      entry.className = 'ox-account-skip'; entry.textContent = '代理審核後台'; center?.append(entry);
      entry.addEventListener('click', () => { if (!entry.hidden && window.OXAuth.user) location.assign('/previews/account-admin/'); });
    }
    entry.hidden = true; entry.style.display = 'none';
    if (!user) return;
    try {
      const result = await window.OXAuth.getAdminReviewStatus();
      if (epoch !== adminEpoch || window.OXAuth.user?.id !== user.id) return;
      entry.hidden = !(result.ok && result.administrator === true); entry.style.display = entry.hidden ? 'none' : '';
    } catch { /* Fail closed; ordinary member and market use remain available. */ }
  }
  function ensureLinkForm() {
    if ($('#ox-bitget-link-form')) return;
    const section = document.createElement('section'); section.id = 'ox-bitget-link-section';
    section.innerHTML = '<h3>Bitget UID 待驗證連結</h3><p>填寫 UID 不代表已證明帳號持有權，也不會取得會員資格。所有公開功能維持開放。</p><form id="ox-bitget-link-form"><label for="ox-bitget-uid">Bitget UID</label><input id="ox-bitget-uid" inputmode="numeric" pattern="[1-9][0-9]{0,19}" maxlength="20" autocomplete="off" required><button class="ox-account-submit" id="ox-bitget-link-save" type="submit">儲存待驗證 UID</button><button class="ox-account-skip" id="ox-bitget-link-remove" type="button" hidden>移除待驗證連結</button></form><p id="ox-bitget-link-status" role="status" aria-live="polite"></p>';
    $('#ox-bitget-link-summary')?.closest('.ox-service-row')?.after(section);
    $('#ox-bitget-link-form').addEventListener('submit', async event => {
      event.preventDefault(); if (!event.currentTarget.reportValidity() || event.currentTarget.getAttribute('aria-busy') === 'true') return;
      await mutateLink(() => window.OXAuth.saveBitgetLink($('#ox-bitget-uid').value.trim(), linkRevision));
    });
    $('#ox-bitget-link-remove').addEventListener('click', () => mutateLink(() => window.OXAuth.removeBitgetLink(linkRevision)));
  }
  function linkBusy(value) {
    $('#ox-bitget-link-form')?.setAttribute('aria-busy', String(value));
    for (const id of ['#ox-bitget-link-save', '#ox-bitget-link-remove', '#ox-bitget-uid']) if ($(id)) $(id).disabled = value;
  }
  function showLink(link, revision = null) {
    linkRevision = link?.revision ?? revision;
    $('#ox-bitget-uid').value = link?.uid ?? '';
    $('#ox-bitget-link-remove').hidden = !link;
    $('#ox-bitget-link-status').textContent = link ? 'UID 已儲存，持有權待驗證。代理關係、KYC 與子代理狀態尚未確認；未授予資格。' : '尚未填寫 UID。';
    if ($('#ox-bitget-link-summary')) $('#ox-bitget-link-summary').textContent = link ? '持有權待驗證' : '尚未連結';
  }
  async function loadLink(user) {
    const epoch = ++linkEpoch; linkRevision = null;
    if (!user) {
      if ($('#ox-bitget-link-section')) $('#ox-bitget-link-section').hidden = true;
      if ($('#ox-bitget-uid')) $('#ox-bitget-uid').value = '';
      if ($('#ox-bitget-link-status')) $('#ox-bitget-link-status').textContent = '';
      if ($('#ox-bitget-link-summary')) $('#ox-bitget-link-summary').textContent = '尚未連結';
      return;
    }
    ensureLinkForm(); $('#ox-bitget-link-section').hidden = false; $('#ox-bitget-uid').value = ''; linkBusy(true);
    $('#ox-bitget-link-status').textContent = '正在讀取 UID 連結…';
    const result = await window.OXAuth.getBitgetLink();
    if (epoch !== linkEpoch || window.OXAuth.user?.id !== user.id) return;
    if (result.ok) { showLink(result.link, result.revision); linkBusy(false); }
    else { $('#ox-bitget-link-status').textContent = result.message; if ($('#ox-bitget-link-summary')) $('#ox-bitget-link-summary').textContent = '狀態尚未確認'; }
  }
  async function mutateLink(action) {
    if ($('#ox-bitget-link-form')?.getAttribute('aria-busy') === 'true') return;
    const epoch = linkEpoch; linkBusy(true);
    const result = await action(); if (epoch !== linkEpoch || !window.OXAuth.user) return;
    if (result.ok) { showLink(result.link, result.revision); linkBusy(false); }
    else {
      await loadLink(window.OXAuth.user);
      if (window.OXAuth.user) $('#ox-bitget-link-status').textContent = result.message;
    }
  }
  let emailCooldownTimer = null;
  function syncEmailCooldown() {
    const button = $('#ox-account-email-submit'); if (!button) return;
    const seconds = window.OXAuth.emailCooldownSeconds || 0;
    button.disabled = busy || seconds > 0;
    button.textContent = seconds ? `請等待 ${seconds} 秒` : $('#ox-account-tab-register')?.getAttribute('aria-selected') === 'true' ? '建立帳號' : 'Email 登入';
    if (seconds && !emailCooldownTimer) emailCooldownTimer = setInterval(syncEmailCooldown, 1000);
    if (!seconds && emailCooldownTimer) { clearInterval(emailCooldownTimer); emailCooldownTimer = null; }
  }
  document.addEventListener('ox:emailcooldown', syncEmailCooldown);
  syncEmailCooldown();
  $('#ox-account-password')?.removeAttribute('required');
  async function perform(action) {
    if (busy) return;
    busy = true; form?.setAttribute('aria-busy','true');
    const buttons = [$('#ox-account-google'), $('#ox-account-email-submit')];
    buttons.forEach(button => { if (button) button.disabled = true; });
    try { return await action(); } finally { busy = false; form?.removeAttribute('aria-busy'); buttons.forEach(button => { if (button) button.disabled = false; }); syncEmailCooldown(); }
  }
  const renderUser = user => {
    for (const note of document.querySelectorAll('.ox-account-provider-note')) {
      note.textContent = user ? '已登入 OX 帳號，可開啟帳號中心。' : window.OXAuth.status.configured ? '帳號連線設定已載入。請開啟登入／註冊。' : '帳號連線設定尚未完成。';
    }
    if (!center) return;
    loadLink(user); loadAdmin(user);
    let profile = $('#ox-account-profile');
    if (!profile) {
      center.querySelector('h2 + p')?.remove();
      profile = document.createElement('div'); profile.id = 'ox-account-profile';
      center.querySelector('h2')?.after(profile);
      const signout = document.createElement('button'); signout.type = 'button'; signout.className = 'ox-account-skip'; signout.id = 'ox-account-signout'; signout.textContent = '登出'; center.append(signout);
    }
    profile.replaceChildren();
    if (user) {
      const initial = document.createElement('span'); initial.className = 'ox-account-avatar'; initial.textContent = user.displayName.slice(0,1); profile.append(initial);
      for (const [label,value] of [['名稱',user.displayName],['電子郵件',user.email],['OX Account ID',user.id],['加入日期',new Date(user.createdAt).toLocaleDateString('zh-TW')],['登入方式',user.methods.map(v => v === 'google' ? 'Google' : v === 'email' ? '電子郵件' : v).join('、')]]) {
        const row = document.createElement('p'), name = document.createElement('strong'); name.textContent = label + '：'; row.append(name,document.createTextNode(value)); profile.append(row);
      }
      const storage = document.createElement('p');
      storage.textContent = user.accountStorage === 'stored' ? '會員資料已儲存。' : user.accountStorage === 'missing' ? '已登入，會員資料尚未建立。' : '已登入，會員資料儲存狀態尚未確認。';
      profile.append(storage);
    }
    const title = $('#ox-account-title'), subtitle = $('#ox-account-sub');
    if (title) title.textContent = user ? user.displayName : '登入 / 註冊';
    if (subtitle) subtitle.textContent = user ? '管理你的 OX 帳號' : '建立你的 OX 統一帳號。';
    const trigger = $('#ox-account-trigger'); if (trigger) trigger.setAttribute('aria-label',user ? `OX 帳號：${user.displayName}` : '登入或註冊 OX 帳號');
  };
  document.addEventListener('ox:accountchange',event => renderUser(event.detail.user));
  $('#ox-bitget-link-open')?.addEventListener('click', () => {
    if (!window.OXAuth.user) return;
    ensureLinkForm();
    $('#ox-bitget-link-section').hidden = false;
    $('#ox-bitget-link-section').scrollIntoView({ block: 'center' });
    if (!$('#ox-bitget-uid').disabled) $('#ox-bitget-uid').focus({ preventScroll: true });
  });
  const open = (view='auth', returnFocus=null) => {
    if (view === 'auth' && window.OXAuth.user) view = 'center';
    priorFocus = returnFocus || document.activeElement;
    overlay?.classList.add('is-open'); overlay?.setAttribute('aria-hidden','false');
    document.body.classList.add('ox-account-open');
    authView.hidden = view !== 'auth'; center.hidden = view !== 'center';
    requestAnimationFrame(() => (view === 'auth' ? $('#ox-account-tab-login') : $('#ox-account-close'))?.focus());
  };
  const close = () => {
    overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true');
    document.body.classList.remove('ox-account-open'); priorFocus?.focus?.();
  };
  const mode = (register) => {
    const card = $('#ox-account-auth-view');
    card.classList.add('is-switching');
    window.setTimeout(() => card.classList.remove('is-switching'), 280);
    overlay.classList.toggle('is-register', register);
    $('#ox-account-tab-login').setAttribute('aria-selected', String(!register));
    $('#ox-account-tab-register').setAttribute('aria-selected', String(register));
    $('#ox-account-title-main').textContent = register ? '建立 OX 帳號' : '登入 OX';
    $('#ox-account-email-submit').textContent = register ? '建立帳號' : '繼續'; syncEmailCooldown();
    $('.ox-account-password-wrap').hidden = true;

    $('#ox-account-lead')?.remove();
    status.textContent = window.OXAuth.status.configured ? '使用電子郵件登入連結，不需要設定密碼。' : '正式登入服務尚未設定。';
  };
  // The control panel stops click bubbling, so its account CTA must open the
  // account surface on the button itself instead of relying on document delegation.
  document.querySelectorAll('[data-ox-account-open]').forEach(trigger => {
    trigger.addEventListener('click', e => {
      e.preventDefault();
      const controlOverlay = $('#ox-control-overlay');
      const controlWasOpen = controlOverlay?.classList.contains('is-open');
      if (controlWasOpen) $('#ox-control-close')?.click();
      open('auth', controlWasOpen ? $('#ox-control-open') : trigger);
    });
  });
  document.addEventListener('click', e => {
    if (e.target.closest('#ox-account-trigger')) open();
    if (e.target.closest('#ox-account-close,#ox-account-skip')) close();
    if (e.target.closest('[data-ox-account-login]')) open();
    if (e.target.closest('#ox-account-tab-login')) mode(false);
    if (e.target.closest('#ox-account-tab-register')) mode(true);
    if (e.target.closest('#ox-account-google')) perform(async () => { status.textContent = '正在連接 Google…'; const result = await window.OXAuth.signInWithGoogle(); if (!result.ok) status.textContent = result.message; });
    if (e.target.closest('#ox-account-signout')) perform(async () => { const result = await window.OXAuth.signOut(); if (result.ok) close(); else status.textContent = result.message; });
    if (e.target.closest('#ox-account-bitget-info')) { $('#ox-account-info-modal').classList.add('is-open'); $('#ox-account-info-modal').setAttribute('aria-hidden','false'); }
    if (e.target.closest('#ox-account-info-close') || (e.target.id === 'ox-account-info-modal')) { $('#ox-account-info-modal').classList.remove('is-open'); $('#ox-account-info-modal').setAttribute('aria-hidden','true'); }
  });
  form?.addEventListener('submit', e => {
    e.preventDefault();
    if (!$('#ox-account-email').reportValidity()) return;
    perform(async () => {
      const email = $('#ox-account-email').value.trim();
      status.textContent = '正在寄送登入連結…';
      const register = $('#ox-account-tab-register').getAttribute('aria-selected') === 'true';
      const result = await (register ? window.OXAuth.registerWithEmail(email) : window.OXAuth.signInWithEmail(email));
      status.textContent = result.message;
    });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if ($('#ox-account-info-modal')?.classList.contains('is-open')) { $('#ox-account-info-modal').classList.remove('is-open'); $('#ox-account-info-modal').setAttribute('aria-hidden','true'); } else close(); }
    if (e.key === 'Tab' && overlay?.classList.contains('is-open')) {
      const nodes = [...overlay.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(x => !x.closest('[hidden]'));
      if (!nodes.length) return; const first=nodes[0], last=nodes[nodes.length-1];
      if (e.shiftKey && document.activeElement===first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement===last) { e.preventDefault(); first.focus(); }
    }
  });
  window.OXAccount = Object.freeze({open,close, get sessionStatus(){return window.OXSession.status;}});
  window.OXAuth.initialize().then(config => {
    const landing = new URL(location.href);
    // Direct Supabase email failures may bypass the OX callback in a fragment.
    // Never display raw descriptions or accept a fragment as session proof.
    const fragment = new URLSearchParams(landing.hash.slice(1));
    if (fragment.has('error')) {
      const code = fragment.get('error_code');
      landing.searchParams.set('ox_auth', 'error');
      landing.searchParams.set('ox_auth_reason', ['otp_expired', 'flow_state_expired'].includes(code) ? 'authorization_expired' : code === 'flow_state_not_found' ? 'authorization_invalid' : 'provider_denied');
      landing.hash = '';
    }
    const failedCallback = landing.searchParams.get('ox_auth') === 'error' && !window.OXAuth.user;
    const successfulCallback = landing.searchParams.get('ox_auth') === 'success' && !!window.OXAuth.user;
    const reason = landing.searchParams.get('ox_auth_reason');
    const provider = landing.searchParams.get('ox_auth_provider');
    const providerLabels = new Set(['otp_expired','otp_disabled','email_not_confirmed','email_provider_disabled','unexpected_failure', 'bad_oauth_callback', 'bad_oauth_state', 'flow_state_expired', 'flow_state_not_found', 'provider_disabled', 'oauth_provider_not_supported', 'provider_email_needs_verification', 'signup_disabled', 'identity_already_exists', 'email_exists', 'user_already_exists', 'user_banned', 'over_request_rate_limit', 'request_timeout', 'validation_failed', 'access_denied', 'server_error', 'invalid_request', 'temporarily_unavailable', 'unauthorized_client', 'unsupported_response_type', 'invalid_scope', 'unclassified']);
    const messages = {
      flow_missing: '登入驗證 Cookie 未收到。請重新點選登入；若仍發生，請回報原因：flow_missing。',
      flow_invalid: '登入驗證 Cookie 已失效或無法驗證。請重新點選登入；原因：flow_invalid。',
      code_missing: '登入回呼未收到授權碼。請重新點選登入；原因：code_missing。',
      provider_denied: '登入連結或授權未完成。連結可能已使用或過期，也可能取消了登入；請回到發起登入的同一瀏覽器確認後再試。',
      provider_callback_error: '登入提供者未完成回呼。請回報原因：provider_callback_error。',
      pkce_missing: '登入驗證資料未完整還原。請回報原因：pkce_missing。',
      pkce_mismatch: '登入驗證資料與回呼不符。請重新登入；原因：pkce_mismatch。',
      authorization_expired: '登入驗證已失效，可能已使用或過期。請停止重開舊信，待寄信限制解除後再取得一封新信；原因：authorization_expired。',
      authorization_invalid: '本次授權碼已使用或無法確認。請重新登入；原因：authorization_invalid。',
      exchange_failed: '登入提供者未能完成授權交換。請回報原因：exchange_failed。',
      response_invalid: '登入提供者沒有回傳完整登入資料。請回報原因：response_invalid。',
      callback_unavailable: '登入回呼暫時無法完成。請回報原因：callback_unavailable。'
    };
    status.textContent = failedCallback ? (Object.hasOwn(messages, reason) ? messages[reason] : '登入回呼未完成。請重新點選 Google 或 Email 登入。') : config.configured ? '使用電子郵件登入連結，不需要設定密碼。' : '正式登入服務尚未設定，訪客功能可正常使用。';
    if (failedCallback && reason === 'provider_callback_error') {
      status.textContent = `Supabase 登入提供者在返回 OX 前已回報錯誤。請回報診斷代碼：provider_callback_error / ${providerLabels.has(provider) ? provider : 'unclassified'}。這不是 OX 授權碼交換或會員查詢失敗，暫勿重複登入。`;
    }
    // Remove transient errors before another attempt; never collect their URL.
    if (landing.searchParams.has('ox_auth')) {
      landing.searchParams.delete('ox_auth'); landing.searchParams.delete('ox_auth_reason'); landing.searchParams.delete('ox_auth_provider');
      history.replaceState(null, '', landing.pathname + landing.search + landing.hash);
    }
    if (failedCallback || (successfulCallback && !window.OXFeatures?.returning)) open();
  });
})();
