const OXFeaturePack = (()=>{
  const init=()=>{
    updateAccountUI(); syncWatchBadge(); MarketController.init();
    const sound=document.getElementById("ox-control-sound-toggle"); if(sound){ sound.checked=localStorage.getItem("ox-alert-sound-enabled")!=="0"; sound.addEventListener("change",()=>{localStorage.setItem("ox-alert-sound-enabled",sound.checked?"1":"0"); AccountStore.capturePrefs();}); }
    document.querySelectorAll("[data-market-choice]").forEach(b=>b.addEventListener("click",()=>MarketController.setMarket(b.dataset.marketChoice)));
    document.getElementById("ox-control-account-open")?.addEventListener("click",()=>{
      if(window.OXAccount){const opener=["ox-control-open","ox-dock-menu"].map(id=>document.getElementById(id)).find(el=>el&&el.getClientRects().length&&getComputedStyle(el).visibility!=="hidden");document.getElementById("ox-control-close")?.click();window.OXAccount.open('auth',opener);return;}
      document.querySelectorAll("[data-control-view]").forEach(v=>v.classList.toggle("active",v.dataset.controlView==="account"));
    });
    document.getElementById("ox-control-account-back")?.addEventListener("click",()=>document.querySelectorAll("[data-control-view]").forEach(v=>v.classList.toggle("active",v.dataset.controlView==="main")));



    document.getElementById("ox-control-test-notification")?.addEventListener("click",async()=>{ await primeAlertAudio(true); let p=notificationPlatformInfo().permission; if(p==="default")p=await maybeRequestNotificationPermission({interactive:true}); const soundOk=await playAlertTone("high"); const notifyOk=p==="granted"?await sendBrowserNotification("OX 測試通知",{body:"OX 通知與鈴聲測試已執行。",icon:"ox-logo.png",tag:"ox-control-test"},{bypassMaster:true}):false; showToast(`${notifyOk?"通知✓":"通知×"} · ${soundOk?"鈴聲✓":"鈴聲×"}`); syncNotificationPermissionUI(); });
    document.addEventListener("change",e=>{ if(e.target.matches("#chk-key-levels,[data-setting-key],#ox-control-notify-toggle,#setting-email,#setting-phone,#setting-frequency")) setTimeout(AccountStore.capturePrefs,0); });
    document.addEventListener("click",e=>{ if(e.target.closest("[data-theme-choice],[data-control-theme]")) setTimeout(AccountStore.capturePrefs,0); });
    document.addEventListener("ox:filterchange",()=>setTimeout(AccountStore.capturePrefs,0));
    document.querySelectorAll("[data-home-mini-tf]").forEach(b=>b.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();HomeMiniChart.setPeriod(b.dataset.homeMiniTf);}));
    if(state.activeView==="home") setTimeout(()=>HomeMiniChart.ensureAndLoad(true),80);
    setInterval(()=>{ if(state.activeView==="home"&&state.activeMarket==="crypto") HomeMiniChart.ensureAndLoad(false); },60000);
  };
  return {init};
})();

/* ===== OX CONTROL module: isolated from OX Engine / radar logic ===== */
const OXControlPanel = (() => {
  const q = sel => document.querySelector(sel);
  let overlay, panel, openBtn, closeBtn, scanObserver,initialized=false;

  const setView = name => {
    document.querySelectorAll("[data-control-view]").forEach(view => view.classList.toggle("active", view.dataset.controlView === name));
  };

  const syncTheme = () => {
    const mode = getSavedThemeMode();
    document.querySelectorAll("[data-control-theme]").forEach(btn => btn.classList.toggle("active", btn.dataset.controlTheme === mode));
  };

  const syncDataStatus = () => {
    const target = q("#ox-control-data-status");
    const source = q("#scan-status");
    if (!target) return;
    const cadence = Math.max(1, Math.round(CONFIG.tickerRefreshMs / 1000));
    target.textContent = source?.textContent ? `${source.textContent} · 行情 ${cadence}s 自動更新` : `即時 / 行情 ${cadence}s 自動更新`;
  };

  const open = () => {
    if (!overlay) return;
    window.OXControlResources?.ensure(overlay,close);
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    openBtn?.setAttribute("aria-expanded", "true");
    q("#ox-dock-menu")?.setAttribute("aria-expanded", "true");
    document.body.classList.add("ox-control-open");
    setView("main");
    syncTheme();
    syncDataStatus();
    updateAccountUI();
    MarketController.syncPlaceholder();
    syncNotificationPermissionUI();
    setTimeout(() => closeBtn?.focus(), 310);
  };

  const close = () => {
    if (!overlay) return;
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    openBtn?.setAttribute("aria-expanded", "false");
    q("#ox-dock-menu")?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("ox-control-open");
    setView("main");
  };

  const init = () => {
    if(initialized)return;
    overlay = q("#ox-control-overlay");
    panel = q("#ox-control-panel");
    openBtn = q("#ox-control-open");
    closeBtn = q("#ox-control-close");
    if (!overlay || !panel || !openBtn || !closeBtn) return;

    initialized=true;
    openBtn.addEventListener("click", open);
    q("#ox-dock-menu")?.addEventListener("click", open);
    q("#ox-control-media")?.addEventListener("click", () => { close(); switchAppView("media"); });
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    panel.addEventListener("click", e => e.stopPropagation());
    document.addEventListener("keydown", e => { if (e.key === "Escape" && overlay.classList.contains("is-open")) close(); });

    document.querySelectorAll("[data-control-theme]").forEach(btn => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.controlTheme;
        localStorage.setItem("ox-ui-theme", mode);
        applyTheme(mode);
        syncTheme();
      });
    });
    document.addEventListener("ox:themechange", syncTheme);

    const notify = q("#ox-control-notify-toggle");
    if (notify) {
      syncNotificationPermissionUI();
      notify.addEventListener("change", async () => {
        if (!notify.checked) {
          localStorage.setItem("ox-control-notifications-enabled", "0");
          syncNotificationPermissionUI();
          return;
        }
        await primeAlertAudio(true);
        const permission = await maybeRequestNotificationPermission({ interactive: true });
        if (permission === "granted") {
          localStorage.setItem("ox-control-notifications-enabled", "1");
          showToast("瀏覽器通知已授權並開啟");
        } else {
          localStorage.setItem("ox-control-notifications-enabled", "0");
          showToast(permission === "denied" ? "瀏覽器已封鎖通知，請到網站權限重新允許" : "此瀏覽器目前無法啟用系統通知");
        }
        syncNotificationPermissionUI();
      });
    }

    q("#ox-control-open-notifications")?.addEventListener("click", () => {
      close();
      switchAppView("settings");
      setTimeout(() => document.querySelector("#view-settings .settings-grid")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    });
    q("#ox-control-open-settings")?.addEventListener("click", () => {
      close();
      switchAppView("settings");
    });

    q("#ox-control-refresh")?.addEventListener("click", () => {
      syncDataStatus();
      q("#btn-force-rescan")?.click();
    });

    q("#ox-control-feedback-open")?.addEventListener("click", () => setView("feedback"));
    q("#ox-control-feedback-back")?.addEventListener("click", () => setView("advanced"));
    q("#ox-control-advanced-open")?.addEventListener("click", () => setView("advanced"));
    q("#ox-control-advanced-back")?.addEventListener("click", () => setView("main"));

    const about = q("#ox-control-about-toggle");
    const changelog = q("#ox-control-changelog");
    about?.addEventListener("click", () => {
      const expanded = about.getAttribute("aria-expanded") === "true";
      about.setAttribute("aria-expanded", String(!expanded));
      changelog?.classList.toggle("open", !expanded);
    });

    q("#ox-feedback-form")?.addEventListener("submit", e => {
      e.preventDefault();
      const status = q("#ox-feedback-status");
      const msg = q("#ox-feedback-message")?.value.trim();
      if (!msg) {
        if (status) status.textContent = "請先填寫問題或建議內容。";
        return;
      }
      if (status) status.textContent = "目前尚未連接寄信後端，因此這份回饋沒有送出。等串接 Formspree、Web3Forms 或自建 API 後，再啟用真正送出。";
    });

    const scanStatus = q("#scan-status");
    if (scanStatus) {
      scanObserver = new MutationObserver(syncDataStatus);
      scanObserver.observe(scanStatus, { childList: true, characterData: true, subtree: true });
    }
    syncTheme();
    syncDataStatus();
  };

  return { init, open, close, syncTheme, syncDataStatus };
})();
