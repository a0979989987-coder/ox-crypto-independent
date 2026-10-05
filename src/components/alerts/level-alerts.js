const getKeyLevelPeriods = () => ["1m","5m","15m"].includes(state.period) ? ["4H","1D"] : [state.period];
const getKeyLevelPeriod = () => getKeyLevelPeriods()[0];
const alertStorageKey = (kind, symbol = state.symbol, period = getKeyLevelPeriod()) => `ox-level-alert:${symbol}:${period}:${kind}`;

function getStoredAlert(kind, symbol = state.symbol, period = state.period) {
  try { return JSON.parse(localStorage.getItem(alertStorageKey(kind, symbol, period)) || "null"); }
  catch { return null; }
}

function setStoredAlert(kind, value, symbol = state.symbol, period = state.period) {
  localStorage.setItem(alertStorageKey(kind, symbol, period), JSON.stringify(value));
}

function removeStoredAlert(kind, symbol = state.symbol, period = state.period) {
  localStorage.removeItem(alertStorageKey(kind, symbol, period));
}

function showToast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), 3200);
}

async function primeAlertAudio(fromUserGesture = false) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    if (!state.audioCtx || state.audioCtx.state === "closed") state.audioCtx = new Ctx();
    if (state.audioCtx.state === "suspended") {
      try { await state.audioCtx.resume(); } catch (e) {}
    }
    if (fromUserGesture && state.audioCtx.state === "running" && !state.audioPrimed) {
      // Play a silent one-sample buffer during a real user gesture so Safari / iOS / Chrome
      // considers this AudioContext user-unlocked before an alert happens later.
      const buffer = state.audioCtx.createBuffer(1, 1, state.audioCtx.sampleRate || 44100);
      const source = state.audioCtx.createBufferSource();
      const gain = state.audioCtx.createGain();
      gain.gain.value = 0.00001;
      source.buffer = buffer;
      source.connect(gain); gain.connect(state.audioCtx.destination);
      source.start(0);
      state.audioPrimed = true;
    }
    return state.audioCtx.state === "running";
  } catch (e) {
    console.warn("OX alert audio unlock failed", e);
    return false;
  }
}

async function playAlertTone(kind = "high") {
  if (localStorage.getItem("ox-alert-sound-enabled") === "0") return false;
  try {
    const ready = await primeAlertAudio(false);
    if (!ready || !state.audioCtx) return false;
    const now = state.audioCtx.currentTime;
    const osc = state.audioCtx.createOscillator();
    const gain = state.audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(kind === "high" ? 880 : 520, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    osc.connect(gain); gain.connect(state.audioCtx.destination);
    osc.start(now); osc.stop(now + 0.54);
    return true;
  } catch (e) {
    console.warn("OX alert sound failed", e);
    return false;
  }
}

function notificationPlatformInfo() {
  const ua = navigator.userAgent || "";
  const isiOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone === true;
  const supported = "Notification" in window;
  return { isiOS, standalone, supported, permission: supported ? Notification.permission : "unsupported" };
}

function notificationMasterEnabled() {
  return localStorage.getItem("ox-control-notifications-enabled") === "1";
}

function notificationPermissionText() {
  const info = notificationPlatformInfo();
  if (!info.supported) return info.isiOS && !info.standalone ? "iPhone 瀏覽器頁籤不支援" : "此瀏覽器不支援";
  if (info.permission === "granted") return "已授權";
  if (info.permission === "denied") return "已封鎖";
  return "尚未詢問";
}

function syncNotificationPermissionUI() {
  const info = notificationPlatformInfo();
  const stateEl = document.getElementById("notification-permission-state");
  const hintEl = document.getElementById("notification-support-hint");
  const controlStatus = document.getElementById("ox-control-notify-status");
  const controlToggle = document.getElementById("ox-control-notify-toggle");
  const grantedAndOn = info.supported && info.permission === "granted" && notificationMasterEnabled();

  if (stateEl) stateEl.textContent = notificationPermissionText();
  if (hintEl) {
    if (info.isiOS && !info.standalone) hintEl.textContent = "iPhone / iPad 的系統通知通常需要先把網站加入主畫面並以 Web App 開啟；一般 Safari 分頁仍會保留頁內提示與鈴聲。";
    else if (!info.supported) hintEl.textContent = "這個瀏覽器沒有提供 Notification API；OX 仍會使用頁內提示與鈴聲。";
    else if (info.permission === "denied") hintEl.textContent = "瀏覽器已封鎖通知。請到瀏覽器 / 系統網站權限中重新允許；網站本身不能繞過封鎖。";
    else if (info.permission === "granted") hintEl.textContent = notificationMasterEnabled() ? "瀏覽器已授權，OX 系統通知總開關目前為開啟。" : "瀏覽器已授權，但 OX 系統通知總開關目前為關閉。";
    else hintEl.textContent = "尚未取得瀏覽器授權。請由按鈕或設定前高 / 前低提醒時主動授權。";
  }
  if (controlStatus) {
    if (!info.supported) controlStatus.textContent = "瀏覽器通知不可用；頁內提示 / 鈴聲仍可使用。";
    else if (info.permission === "granted") controlStatus.textContent = grantedAndOn ? "瀏覽器已授權 · 系統通知開啟" : "瀏覽器已授權 · OX 總開關關閉";
    else if (info.permission === "denied") controlStatus.textContent = "瀏覽器已封鎖；需到瀏覽器 / 系統權限重新允許。";
    else controlStatus.textContent = "尚未授權；開啟時會向瀏覽器要求權限。";
  }
  if (controlToggle) {
    controlToggle.checked = grantedAndOn;
    controlToggle.disabled = !info.supported || info.permission === "denied";
  }
}

async function maybeRequestNotificationPermission({ interactive = false } = {}) {
  const info = notificationPlatformInfo();
  if (!info.supported) {
    syncNotificationPermissionUI();
    return "unsupported";
  }
  if (Notification.permission !== "default") {
    syncNotificationPermissionUI();
    return Notification.permission;
  }
  if (!interactive) return "default";
  try {
    const result = await Notification.requestPermission();
    if (result === "granted" && localStorage.getItem("ox-control-notifications-enabled") === null) {
      localStorage.setItem("ox-control-notifications-enabled", "1");
    }
    syncNotificationPermissionUI();
    return result;
  } catch (e) {
    console.warn("OX notification permission request failed", e);
    syncNotificationPermissionUI();
    return "error";
  }
}

async function sendBrowserNotification(title, options = {}, { bypassMaster = false } = {}) {
  const info = notificationPlatformInfo();
  if (!info.supported || Notification.permission !== "granted") return false;
  if (!bypassMaster && !notificationMasterEnabled()) return false;
  const payload = { ...options, tag: options.tag || `ox-${Date.now()}` };
  try {
    // If the site already has a service worker, prefer it for better background-tab behavior.
    if (navigator.serviceWorker?.getRegistration) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.showNotification) {
        await reg.showNotification(title, payload);
        return true;
      }
    }
    const n = new Notification(title, payload);
    n.onclick = () => { try { window.focus(); n.close(); } catch (e) {} };
    return true;
  } catch (e) {
    console.warn("OX browser notification failed", e);
    return false;
  }
}

async function fireLevelAlert(kind, alert, price, symbol = state.symbol, period = state.period) {
  const isHigh = kind === "high";
  const title = `${symbol} ${isHigh ? "突破前高" : "跌破前低"}`;
  const body = `${period}｜目標 ${fmtPrice(alert.target)}｜目前 ${fmtPrice(price)}`;
  const soundPlayed = await playAlertTone(kind);
  if (navigator.vibrate) navigator.vibrate([180, 80, 180]);
  const notified = await sendBrowserNotification(title, { body, icon: "ox-logo.png", tag: `ox-level-${symbol}-${period}-${kind}` });
  const suffix = notified ? "" : (notificationPlatformInfo().permission === "granted" && !notificationMasterEnabled() ? "（系統通知總開關關閉）" : "（頁內提醒）");
  showToast(`🔔 ${title}：${fmtPrice(price)}${suffix}${soundPlayed ? "" : " · 音效未解鎖"}`);
}

function updateAlertButtons() {
  const highBtn = document.getElementById("btn-alert-high");
  const lowBtn = document.getElementById("btn-alert-low");
  if (!highBtn || !lowBtn) return;

  const sourcePeriod = state.currentLevels.sourcePeriod || getKeyLevelPeriod();
  const high = getStoredAlert("high", state.symbol, sourcePeriod);
  const low = getStoredAlert("low", state.symbol, sourcePeriod);

  // 手機上不再因目前查看 1H/15m 而禁用；小級別畫面仍使用 4H 結構前高/前低。
  highBtn.disabled = !state.currentLevels.high;
  lowBtn.disabled = !state.currentLevels.low;
  highBtn.className = "alert-btn" + (high?.triggered ? " triggered" : high?.enabled ? " enabled-high" : "");
  lowBtn.className = "alert-btn" + (low?.triggered ? " triggered" : low?.enabled ? " enabled-low" : "");
  highBtn.textContent = high?.triggered ? `✓ 前高提醒` : `前高提醒`;
  lowBtn.textContent = low?.triggered ? `✓ 前低提醒` : `前低提醒`;

  const highChip = document.getElementById("detail-high-alert");
  const lowChip = document.getElementById("detail-low-alert");
  if (highChip) highChip.textContent = high?.triggered ? `${sourcePeriod}前高已觸發 ${fmtPrice(high.target)}` : high?.enabled ? `提醒中 · ${sourcePeriod}前高提醒 ${fmtPrice(high.target)}` : `${sourcePeriod}前高提醒：未設定`;
  if (lowChip) lowChip.textContent = low?.triggered ? `${sourcePeriod}前低已觸發 ${fmtPrice(low.target)}` : low?.enabled ? `提醒中 · ${sourcePeriod}前低提醒 ${fmtPrice(low.target)}` : `${sourcePeriod}前低提醒：未設定`;
}

async function toggleLevelAlert(kind) {
  const sourcePeriod = state.currentLevels.sourcePeriod || getKeyLevelPeriod();
  const target = kind === "high" ? state.currentLevels.high : state.currentLevels.low;
  if (!target) return showToast(`正在取得 ${sourcePeriod} ${kind === "high" ? "前高" : "前低"}，請稍候再點一次`);

  const existing = getStoredAlert(kind, state.symbol, sourcePeriod);
  if (existing?.enabled && !existing?.triggered) {
    removeStoredAlert(kind, state.symbol, sourcePeriod);
    showToast(`已關閉 ${state.symbol} ${sourcePeriod} ${kind === "high" ? "前高" : "前低"}提醒`);
  } else {
    await primeAlertAudio(true);
    const permission = await maybeRequestNotificationPermission({ interactive: true });
    if (permission === "granted" && localStorage.getItem("ox-control-notifications-enabled") === null) {
      localStorage.setItem("ox-control-notifications-enabled", "1");
    }
    setStoredAlert(kind, {
      enabled: true,
      triggered: false,
      target,
      sourcePeriod,
      createdAt: Date.now()
    }, state.symbol, sourcePeriod);
    syncNotificationPermissionUI();
    const delivery = permission === "granted" && notificationMasterEnabled() ? "瀏覽器通知＋鈴聲" : "頁內提示＋鈴聲";
    showToast(`已設定 ${state.symbol} ${sourcePeriod} ${kind === "high" ? "前高突破" : "前低跌破"}提醒 ${fmtPrice(target)} · ${delivery}`);
  }
  updateAlertButtons();
}

function checkLevelAlerts() {
  if (!state.tickers.length) return;
  if (localStorage.getItem("ox-setting-breakout") === "0") return;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith("ox-level-alert:")) continue;
    const parts = key.split(":");
    if (parts.length !== 4) continue;
    const [, symbol, period, kind] = parts;
    let alert = null;
    try { alert = JSON.parse(localStorage.getItem(key) || "null"); } catch (e) {}
    if (!alert?.enabled || alert.triggered || !alert.target) continue;
    const ticker = state.tickers.find(t => t.symbol === symbol);
    if (!ticker) continue;
    const price = num(ticker.lastPr);
    const hit = kind === "high" ? price >= alert.target : price <= alert.target;
    if (!hit) continue;
    alert.triggered = true;
    alert.triggeredAt = Date.now();
    localStorage.setItem(key, JSON.stringify(alert));
    fireLevelAlert(kind, alert, price, symbol, period);
    if (symbol === state.symbol && getKeyLevelPeriods().includes(period)) updateAlertButtons();
  }
}


