(() => {
  "use strict";

  /*
   * OX Market Quick Switch v2
   *
   * Desktop:
   * - Click Radar -> Radar
   * - Hover Radar -> Quick Switch
   * - Choose a market -> Its Radar
   *
   * Mobile:
   * - Tap Radar -> Radar
   * - Triple tap -> Previous market
   * - Hold 420ms -> Quick Switch
   * - Keep finger down
   * - Swipe upward
   * - Move left/right
   * - Release -> Switch market
   *
   * Gesture handling is local to Radar and its menu.
   * Page scrolling and viewport zoom remain native.
   */

  const CFG = {
    hold: 420,
    moveCancel: 24,
    tripleWindow: 650,
    gap: 16,
    hitSlopTop: 36,
    hitSlopBottom: 62,
    armDistance: 24,
    closeMs: 170,
    postReleaseHoldMs: 3000
  };

  const MARKETS = [ { id: "crypto", label: "加密" } ];
  const IDS = MARKETS.map(item => item.id);

  const MENU_ID =
    "ox-market-quick-switch";

  const STYLE_ID =
    "ox-market-quick-switch-style";

  const PREV_KEY =
    "ox-previous-market";

  let radar = null;
  let desktopRadar = null;
  let menuAnchor = null;
  let hoverCloseTimer = null;
  let hoverOpenTimer = null;
  let menu = null;

  let holdTimer = null;
  let closeTimer = null;
  let postReleaseTimer = null;
  let pointerHover = false;

  function pauseAutoClose() { clearTimeout(postReleaseTimer); postReleaseTimer = null; }
  function scheduleAutoClose() {
    pauseAutoClose();
    if (holding || pointerHover || menu?.contains(document.activeElement)) return;
    postReleaseTimer = setTimeout(() => closeMenu(), CFG.postReleaseHoldMs);
  }

  let holding = false;
  let moved = false;
  let selected = null;
  let selectionArmed = false;

  let startX = 0;
  let startY = 0;

  let taps = [];

  /*
   * Desktop Pointer
   */
  let pointerId = null;

  /*
   * Mobile Touch
   */
  let touchId = null;
  let touchActive = false;

  const valid =
    id =>
      IDS.includes(id);

  /* =========================================================
     MARKET STATE
     ========================================================= */

  function currentMarket() {
    const bodyMarket =
      document.body
        ?.dataset
        ?.market;

    if (
      valid(bodyMarket)
    ) {
      return bodyMarket;
    }

    const stored =
      localStorage.getItem(
        "ox-active-market"
      );

    if (
      valid(stored)
    ) {
      return stored;
    }

    return "crypto";
  }

  let current =
    currentMarket();

  let previous =
    (() => {
      const saved =
        sessionStorage.getItem(
          PREV_KEY
        );

      if (
        valid(saved) &&
        saved !== current
      ) {
        return saved;
      }

      return null;
    })();

  /* =========================================================
     HAPTIC
     ========================================================= */

  function haptic(ms = 8) {
    try {
      navigator.vibrate?.(
        ms
      );
    } catch {
      /*
       * iPhone Safari normally ignores navigator.vibrate.
       * That's fine.
       */
    }
  }

  /* =========================================================
     STYLES
     ========================================================= */

  function addStyles() {
    if (
      document.getElementById(
        STYLE_ID
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      STYLE_ID;

    style.textContent = `


/* =========================================================
   QUICK SWITCH
   ========================================================= */

#${MENU_ID} {

  position: fixed;

  z-index: 2147483000;

  left: 50%;

  bottom: 112px;

  width:
    min(
      212px,
      calc(100vw - 20px)
    );

  padding: 6px;

  box-sizing:
    border-box;

  border:
    1px solid
    rgba(
      177,
      204,
      230,
      .18
    );

  border-radius:
    20px;

  background:
    linear-gradient(
      180deg,
      rgba(25,39,57,.92),
      rgba(8,18,30,.96)
    );

  box-shadow:
    0 18px 50px
    rgba(0,0,0,.42),

    inset 0 1px 0
    rgba(255,255,255,.08);

  backdrop-filter:
    blur(24px)
    saturate(145%);

  -webkit-backdrop-filter:
    blur(24px)
    saturate(145%);

  opacity: 0;

  visibility: hidden;

  pointer-events: none;

  user-select: none;

  -webkit-user-select:
    none;

  -webkit-touch-callout:
    none;

  touch-action:
    none;

  transform:
    translateX(-50%)
    translateY(14px)
    scale(.90);

  transform-origin:
    50% 100%;

  transition:
    opacity
    190ms
    cubic-bezier(.2,.8,.2,1),

    transform
    220ms
    cubic-bezier(.2,.85,.2,1),

    visibility
    0s linear
    220ms;
}


/* Arrow */

#${MENU_ID}::after {

  content: "";

  position: absolute;

  left: 50%;

  bottom: -7px;

  width: 13px;

  height: 13px;

  background:
    rgba(9,19,31,.96);

  border-right:
    1px solid
    rgba(177,204,230,.16);

  border-bottom:
    1px solid
    rgba(177,204,230,.16);

  border-radius:
    0 0 3px 0;

  transform:
    translateX(-50%)
    rotate(45deg);
}


#${MENU_ID}[data-placement="below"] {transform-origin:50% 0;touch-action:auto}
#${MENU_ID}[data-placement="below"]::after {top:-7px;bottom:auto;transform:translateX(-50%) rotate(225deg)}

/* Open */

#${MENU_ID}.is-open {

  opacity: 1;

  visibility: visible;

  pointer-events: auto;

  transform:
    translateX(-50%)
    translateY(0)
    scale(1);

  transition:
    opacity
    190ms
    cubic-bezier(.2,.8,.2,1),

    transform
    220ms
    cubic-bezier(.2,.85,.2,1),

    visibility 0s;
}


/* Closing */

#${MENU_ID}.is-closing {

  opacity: 0;

  pointer-events: none;

  transform:
    translateX(-50%)
    translateY(8px)
    scale(.94);
}


/* =========================================================
   HORIZONTAL MARKET GRID
   ========================================================= */

#${MENU_ID}
.ox-mqs-grid {

  position: relative;

  z-index: 1;

  display: grid;

  grid-template-columns:
    repeat(
      1,
      minmax(0,1fr)
    );

  gap: 4px;
}


/* Individual Market */

#${MENU_ID}
.ox-mqs-item {

  appearance: none;

  -webkit-appearance:
    none;

  height: 48px;

  min-width: 0;

  padding:
    0 7px;

  border:
    1px solid
    transparent;

  border-radius:
    15px;

  background:
    transparent;

  color:
    rgba(
      221,
      232,
      244,
      .74
    );

  font: inherit;

  font-size:
    12px;

  font-weight:
    760;

  cursor: pointer;

  touch-action:
    none;

  user-select:
    none;

  -webkit-user-select:
    none;

  transition:
    transform
    150ms ease,

    color
    150ms ease,

    background
    150ms ease,

    border-color
    150ms ease,

    box-shadow
    150ms ease;
}


#${MENU_ID}
.ox-mqs-inner {

  display: flex;

  align-items: center;

  justify-content: center;

  gap: 6px;

  height: 100%;

  white-space:
    nowrap;
}


/* Dot */

#${MENU_ID}
.ox-mqs-dot {

  width: 6px;

  height: 6px;

  flex:
    0 0 6px;

  border-radius:
    50%;

  background:
    rgba(
      152,
      170,
      190,
      .38
    );

  transition:
    transform
    150ms ease,

    background
    150ms ease,

    box-shadow
    150ms ease;
}


/* Current market */

#${MENU_ID}
.ox-mqs-item.is-current {

  color:
    rgba(
      246,
      224,
      176,
      .95
    );
}


#${MENU_ID}
.ox-mqs-item.is-current
.ox-mqs-dot {

  background:
    #f0bc54;

  box-shadow:
    0 0 10px
    rgba(
      240,
      188,
      84,
      .52
    );
}


/* Hovered / finger selected */

#${MENU_ID}
.ox-mqs-item.is-selected {

  color:
    #f8d98e;

  background:
    linear-gradient(
      180deg,
      rgba(244,192,86,.18),
      rgba(244,192,86,.08)
    );

  border-color:
    rgba(
      244,
      192,
      86,
      .32
    );

  box-shadow:
    inset
    0 1px 0
    rgba(255,255,255,.08),

    0 7px 20px
    rgba(0,0,0,.13);

  transform:
    translateY(-1px)
    scale(1.035);
}


#${MENU_ID}
.ox-mqs-item.is-selected
.ox-mqs-dot {

  background:
    #f5bf55;

  transform:
    scale(1.15);

  box-shadow:
    0 0 12px
    rgba(
      245,
      191,
      85,
      .66
    );
}


/* =========================================================
   RADAR GESTURE AREA
   ========================================================= */

.dock-radar {

  touch-action:
    none !important;

  -webkit-touch-callout:
    none !important;

  user-select:
    none !important;

  -webkit-user-select:
    none !important;
}


.dock-radar
.dock-radar-orb {

  transition:
    transform
    170ms
    cubic-bezier(.2,.8,.2,1),

    box-shadow
    170ms ease
    !important;
}


/* Pressing */

.dock-radar.ox-mqs-pressing
.dock-radar-orb {

  transform:
    translateX(-50%)
    scale(.94)
    !important;
}


/* Open radar glow */

body.ox-mqs-open
.dock-radar
.dock-radar-orb {

  transform:
    translateX(-50%)
    scale(1.02)
    !important;

  box-shadow:
    0 0 0 1px
    rgba(247,189,82,.38),

    0 0 26px
    rgba(247,189,82,.52),

    inset
    0 1px 8px
    rgba(255,255,255,.05)
    !important;
}


/* Radar/menu touch-action handles the drag without changing the page scroll root. */

/* =========================================================
   LIGHT
   ========================================================= */

body.theme-light
#${MENU_ID} {

  border-color:
    rgba(87,111,139,.16);

  background:
    linear-gradient(
      180deg,
      rgba(255,255,255,.93),
      rgba(239,245,251,.96)
    );

  box-shadow:
    0 18px 45px
    rgba(36,57,81,.18),

    inset
    0 1px 0
    rgba(255,255,255,.90);
}


body.theme-light
#${MENU_ID}::after {

  background:
    rgba(240,246,251,.96);

  border-color:
    rgba(87,111,139,.13);
}


body.theme-light
#${MENU_ID}
.ox-mqs-item {

  color:
    rgba(45,66,91,.68);
}


body.theme-light
#${MENU_ID}
.ox-mqs-item.is-current,

body.theme-light
#${MENU_ID}
.ox-mqs-item.is-selected {

  color:
    #8c621c;
}


body.theme-light
#${MENU_ID}
.ox-mqs-item.is-selected {

  background:
    linear-gradient(
      180deg,
      rgba(217,165,62,.17),
      rgba(217,165,62,.07)
    );

  border-color:
    rgba(185,132,43,.25);
}


/* =========================================================
   MOBILE
   ========================================================= */

@media (max-width:430px) {

  #${MENU_ID} {

    width:
      min(212px, calc(100vw - 18px));

    padding: 5px;

    border-radius:
      19px;
  }

  #${MENU_ID}
  .ox-mqs-grid {

    gap: 3px;
  }

  #${MENU_ID}
  .ox-mqs-item {

    height: 48px;

    padding:
      0 4px;

    border-radius:
      14px;

    font-size:
      11px;
  }

}


@media (max-width:365px) {

  #${MENU_ID}
  .ox-mqs-item {

    font-size:
      10px;
  }

}


/* =========================================================
   REDUCED MOTION
   ========================================================= */

@media
(prefers-reduced-motion:reduce) {

  #${MENU_ID},

  #${MENU_ID}
  .ox-mqs-item,

  #${MENU_ID}
  .ox-mqs-dot,

  .dock-radar
  .dock-radar-orb {

    transition-duration:
      1ms !important;
  }

}

`;

    document.head.appendChild(
      style
    );
  }

  /* =========================================================
     BUILD MENU
     ========================================================= */

  function buildMenu() {
    if (menu) {
      return;
    }

    menu =
      document.createElement(
        "div"
      );

    menu.id =
      MENU_ID;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '雷達市場');

    menu.setAttribute(
      "aria-hidden",
      "true"
    );

    menu.innerHTML = `
      <div class="ox-mqs-grid">

        ${MARKETS.map(
          market => `
            <button
              class="ox-mqs-item"
              type="button"
              role="menuitem"
              data-market="${market.id}"
              aria-label="切換至${market.label}"
            >
              <span class="ox-mqs-inner">

                <span
                  class="ox-mqs-dot"
                ></span>

                <span>
                  ${market.label}
                </span>

              </span>
            </button>
          `
        ).join("")}

      </div>
    `;

    document.body.appendChild(
      menu
    );

    menu.addEventListener('pointerenter', event => {
      clearTimeout(hoverCloseTimer);
      pointerHover = event.pointerType === 'mouse';
      if (pointerHover) pauseAutoClose();
    });
    menu.addEventListener('pointerleave', () => { pointerHover = false; if (menuAnchor === desktopRadar) leaveDesktopMenu(); else scheduleAutoClose(); });
    menu.addEventListener('focusin', pauseAutoClose);
    menu.addEventListener('focusout', event => {
      if (!menu.contains(event.relatedTarget)) scheduleAutoClose();
    });
    menu.addEventListener('pointerdown', pauseAutoClose);
    menu.addEventListener('pointerup', event => {
      if (!event.target.closest('.ox-mqs-item')) scheduleAutoClose();
    });
    menu.addEventListener('keydown', event => {
      const buttons = [...menu.querySelectorAll('.ox-mqs-item')];
      const index = buttons.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(); (menuAnchor || radar).focus(); }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length].focus();
      }
    });

    /*
     * Direct click fallback.
     */
    menu
      .querySelectorAll(
        ".ox-mqs-item"
      )
      .forEach(
        button => {

          button.addEventListener(
            "click",
            event => {

              event.preventDefault();
              event.stopPropagation();

              switchMarket(
                button.dataset.market
              );

              closeMenu();
            }
          );

        }
      );

    syncMenu();
  }

  /* =========================================================
     MENU POSITION
     ========================================================= */

  function positionMenu() {
    if (
      !radar ||
      !menu
    ) {
      return;
    }

    const rect =
      (menuAnchor || radar).getBoundingClientRect();

    if (menuAnchor === desktopRadar && desktopRadar) {
      const half = Math.min(212, window.innerWidth - 20) / 2;
      menu.dataset.placement = 'below';
      menu.style.left = `${Math.max(half + 10, Math.min(window.innerWidth - half - 10, rect.left + rect.width / 2))}px`;
      menu.style.bottom = 'auto';
      menu.style.top = `${rect.bottom + 8}px`;
      return;
    }
    menu.dataset.placement = 'above';
    menu.style.top = '';

    const viewportHeight =
      window.visualViewport
        ?.height ||
      window.innerHeight;

    const viewportTop =
      window.visualViewport
        ?.offsetTop ||
      0;

    const radarTop =
      rect.top -
      viewportTop;

    menu.style.left =
      `${
        rect.left +
        rect.width / 2
      }px`;

    menu.style.bottom =
      `${
        Math.max(
          10,

          viewportHeight -
          radarTop +
          CFG.gap
        )
      }px`;
  }

  /* =========================================================
     SYNC CURRENT MARKET
     ========================================================= */

  function syncMenu() {
    current =
      currentMarket();
    const activeMarket = document.body.dataset.market || current;

    menu
      ?.querySelectorAll(
        ".ox-mqs-item"
      )
      .forEach(
        button => {

          button.classList.toggle(
            "is-current",

            button.dataset.market ===
              activeMarket
          );

        }
      );
  }

  /* =========================================================
     SELECTED MARKET
     ========================================================= */

  function setSelected(id) {
    const next =
      valid(id)
        ? id
        : null;

    if (
      next === selected
    ) {
      return;
    }

    selected =
      next;

    menu
      ?.querySelectorAll(
        ".ox-mqs-item"
      )
      .forEach(
        button => {

          button.classList.toggle(
            "is-selected",

            button.dataset.market ===
              selected
          );

        }
      );

    if (selected) {
      haptic(8);
    }
  }

  /* =========================================================
     MARKET HIT TEST
     ========================================================= */

  function marketAt(
    x,
    y
  ) {
    if (
      !menu ||
      !menu.classList.contains(
        "is-open"
      )
    ) {
      return null;
    }

    const rect =
      menu.getBoundingClientRect();

    /*
     * Mobile gets a larger vertical hit area,
     * so finger doesn't need pixel-perfect contact.
     */
    const top =
      rect.top -
      CFG.hitSlopTop;

    const bottom =
      rect.bottom +
      CFG.hitSlopBottom;

    if (
      y < top ||
      y > bottom ||
      x < rect.left ||
      x > rect.right
    ) {
      return null;
    }

    const relativeX =
      Math.max(
        0,

        Math.min(
          rect.width - 0.001,

          x -
          rect.left
        )
      );

    const index =
      Math.floor(
        (
          relativeX /
          rect.width
        ) *
        MARKETS.length
      );

    return (
      MARKETS[
        Math.min(
          MARKETS.length - 1,

          Math.max(
            0,
            index
          )
        )
      ].id
    );
  }

  /* =========================================================
     OPEN
     ========================================================= */

  function openMenu(anchor = radar, { hover = false } = {}) {
    clearTimeout(hoverOpenTimer);
    menuAnchor = anchor;
    clearTimeout(hoverCloseTimer);
    pauseAutoClose();
    clearTimeout(
      closeTimer
    );

    buildMenu();

    syncMenu();

    setSelected(
      null
    );

    selectionArmed =
      false;

    positionMenu();

    holding = !hover;

    taps =
      [];

    radar
      ?.classList
      .remove(
        "ox-mqs-pressing"
      );

    document.body
      .classList
      .add(
        "ox-mqs-open"
      );
    document.body.classList.toggle('ox-mqs-dragging', !hover);
    desktopRadar?.setAttribute('aria-expanded', String(anchor === desktopRadar));

    menu
      .classList
      .remove(
        "is-closing"
      );

    menu.setAttribute(
      "aria-hidden",
      "false"
    );

    requestAnimationFrame(
      () => {
        if (menu.getAttribute?.('aria-hidden') === 'true') return;
        menu
          .classList
          .add(
            "is-open"
          );
      }
    );

    haptic(12);
  }

  /* =========================================================
     CLOSE
     ========================================================= */

  function closeMenu(
    immediate = false
  ) {
    if (menu?.contains(document.activeElement)) (menuAnchor || radar)?.focus();
    clearTimeout(hoverCloseTimer);
    pointerHover = false;
    desktopRadar?.setAttribute('aria-expanded', 'false');
    clearTimeout(
      holdTimer
    );

    clearTimeout(
      closeTimer
    );
    pauseAutoClose();

    holdTimer =
      null;

    holding =
      false;

    selectionArmed =
      false;

    setSelected(
      null
    );

    radar
      ?.classList
      .remove(
        "ox-mqs-pressing"
      );

    document.body
      .classList
      .remove(
        "ox-mqs-open",
        "ox-mqs-dragging"
      );

    if (!menu) {
      return;
    }

    if (immediate) {

      menu.classList.remove(
        "is-open",
        "is-closing"
      );

      menu.setAttribute(
        "aria-hidden",
        "true"
      );

      return;
    }

    menu
      .classList
      .add(
        "is-closing"
      );

    menu
      .classList
      .remove(
        "is-open"
      );

    menu.setAttribute(
      "aria-hidden",
      "true"
    );

    closeTimer =
      setTimeout(
        () => {
          menu
            ?.classList
            .remove(
              "is-closing"
            );
        },

        CFG.closeMs
      );
  }

  /* =========================================================
     MARKET CONTROLLER
     ========================================================= */

  function switchMarket(id) {
    if (
      !valid(id)
    ) {
      return false;
    }

    if (
      id === document.body.dataset.market
    ) {
      openRadar();
      return true;
    }

    const controller =
      window.OXMarketController;

    if (
      !controller
        ?.setMarket
    ) {
      console.warn(
        "[OX Quick Switch] OXMarketController unavailable."
      );

      return false;
    }

    controller.setMarket(
      id
    );
    openRadar();

    return true;
  }

  /* =========================================================
     RADAR NORMAL CLICK
     ========================================================= */

  function openRadar() {
    closeMenu(true);
    if (
      typeof
      window.switchAppView ===
      "function"
    ) {

      window.switchAppView(
        "radar"
      );

    }
  }

  /* =========================================================
     TRIPLE TAP
     ========================================================= */

  function goPrevious() {
    const now =
      currentMarket();

    if (
      !valid(previous) ||
      previous === now
    ) {

      window
        .showMarketToast
        ?.(
          "目前沒有上一個市場"
        );

      return;
    }

    switchMarket(
      previous
    );
  }

  function shortTap() {
    const now =
      performance.now();

    taps =
      taps.filter(
        time =>
          now - time <=
          CFG.tripleWindow
      );

    taps.push(
      now
    );

    /*
     * One tap keeps normal Radar behavior.
     */
    openRadar();

    /*
     * Three fast taps return to previous market.
     */
    if (
      taps.length >= 3 &&
      now -
        taps[
          taps.length - 3
        ] <=
        CFG.tripleWindow
    ) {

      taps = [];

      haptic(
        16
      );

      goPrevious();
    }
  }

  /* =========================================================
     COMMON GESTURE
     ========================================================= */

  function beginGesture(
    x,
    y
  ) {
    startX = x;
    startY = y;

    moved = false;
    holding = false;

    selectionArmed =
      false;

    selected =
      null;

    radar
      ?.classList
      .add(
        "ox-mqs-pressing"
      );

    clearTimeout(
      holdTimer
    );

    holdTimer =
      setTimeout(
        openMenu,
        CFG.hold
      );
  }

  function moveGesture(
    x,
    y,
    event
  ) {
    const dx =
      x - startX;

    const dy =
      y - startY;

    const distance =
      Math.hypot(
        dx,
        dy
      );

    /*
     * Before long press activates:
     * too much movement means user wanted normal scroll.
     */
    if (!holding) {

      if (
        distance >
        CFG.moveCancel
      ) {
        moved = true;

        clearTimeout(
          holdTimer
        );

        holdTimer = null;

        radar
          ?.classList
          .remove(
            "ox-mqs-pressing"
          );
      }

      return;
    }

    /*
     * Once Quick Switch is open,
     * browser must NOT scroll the page.
     */
    if (
      event?.cancelable
    ) {
      event.preventDefault();
    }

    /*
     * User must move upward a little before
     * selection becomes armed.
     *
     * Prevents:
     * hold -> release
     * accidentally selecting a market.
     */
    if (
      !selectionArmed
    ) {

      const rect =
        menu
          ?.getBoundingClientRect();

      if (
        startY - y >=
          CFG.armDistance ||

        (
          rect &&
          y <=
            rect.bottom +
            16
        )
      ) {

        selectionArmed =
          true;

      }

    }

    if (
      !selectionArmed
    ) {
      return;
    }

    setSelected(
      marketAt(
        x,
        y
      )
    );
  }

  function finishGesture(
    x,
    y
  ) {
    const wasHolding =
      holding;

    const wasMoved =
      moved;

    /*
     * Get final position one more time.
     * Important for Safari where final touchmove
     * can occasionally be skipped.
     */
    if (
      wasHolding &&
      selectionArmed
    ) {

      const finalChoice =
        marketAt(
          x,
          y
        );

      if (finalChoice) {
        selected =
          finalChoice;
      }

    }

    const choice =
      selected;

    clearTimeout(
      holdTimer
    );

    holdTimer =
      null;

    radar
      ?.classList
      .remove(
        "ox-mqs-pressing"
      );

    if (wasHolding) {

      if (
        selectionArmed &&
        choice
      ) {
        switchMarket(
          choice
        );
      }

      if (selectionArmed && choice) closeMenu();
      else {
        holding = false;
        selectionArmed = false;
        setSelected(null);
        document.body.classList.remove('ox-mqs-dragging');
        scheduleAutoClose();
      }

      return;
    }

    closeMenu(
      true
    );

    if (
      !wasMoved
    ) {
      shortTap();
    }
  }

  /* =========================================================
     MOBILE TOUCH
     ========================================================= */

  function findTouch(
    list,
    id
  ) {
    if (!list) {
      return null;
    }

    for (
      let i = 0;
      i < list.length;
      i += 1
    ) {

      if (
        list[i].identifier ===
        id
      ) {
        return list[i];
      }

    }

    return null;
  }

  function onTouchStart(
    event
  ) {
    if (
      touchActive ||
      event.touches.length !== 1
    ) {
      return;
    }

    const touch =
      event.changedTouches[0];

    if (!touch) {
      return;
    }

    touchActive =
      true;

    touchId =
      touch.identifier;

    // Keep document scrolling compositor-driven until a Radar gesture begins.
    document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    document.addEventListener('touchend', onTouchEnd, { passive: false, capture: true });
    document.addEventListener('touchcancel', onTouchCancel, { passive: true, capture: true });

    beginGesture(
      touch.clientX,
      touch.clientY
    );
  }

  function onTouchMove(
    event
  ) {
    if (
      !touchActive
    ) {
      return;
    }

    const touch =
      findTouch(
        event.touches,
        touchId
      );

    if (!touch) {
      return;
    }

    moveGesture(
      touch.clientX,
      touch.clientY,
      event
    );
  }

  function onTouchEnd(
    event
  ) {
    if (
      !touchActive
    ) {
      return;
    }

    const touch =
      findTouch(
        event.changedTouches,
        touchId
      );

    if (!touch) {
      return;
    }

    /*
     * Prevent Safari synthetic click / zoom.
     */
    if (
      event.cancelable && !moved
    ) {
      event.preventDefault();
    }

    touchActive =
      false;

    touchId =
      null;

    releaseTouchListeners();

    finishGesture(
      touch.clientX,
      touch.clientY
    );
  }

  function onTouchCancel() {
    if (
      !touchActive
    ) {
      return;
    }

    touchActive =
      false;

    touchId =
      null;

    releaseTouchListeners();

    cancelGesture();
  }

  function releaseTouchListeners() {
    document.removeEventListener('touchmove', onTouchMove, true);
    document.removeEventListener('touchend', onTouchEnd, true);
    document.removeEventListener('touchcancel', onTouchCancel, true);
  }

  /* =========================================================
     DESKTOP POINTER
     ========================================================= */

  function releasePointer() {
    if (
      pointerId !== null &&
      radar
        ?.hasPointerCapture
        ?.(pointerId)
    ) {

      try {
        radar.releasePointerCapture(
          pointerId
        );
      } catch {
        /*
         * Ignore.
         */
      }

    }

    pointerId =
      null;
  }

  function onPointerDown(
    event
  ) {
    /*
     * Touch is handled separately.
     */
    if (
      event.pointerType ===
      "touch"
    ) {
      return;
    }

    if (
      pointerId !== null
    ) {
      return;
    }

    if (
      event.pointerType ===
        "mouse" &&
      event.button !==
        0
    ) {
      return;
    }

    pointerId =
      event.pointerId;

    try {
      radar.setPointerCapture(
        pointerId
      );
    } catch {
      /*
       * Ignore.
       */
    }

    beginGesture(
      event.clientX,
      event.clientY
    );
  }

  function onPointerMove(
    event
  ) {
    if (
      event.pointerType ===
        "touch" ||
      event.pointerId !==
        pointerId
    ) {
      return;
    }

    moveGesture(
      event.clientX,
      event.clientY,
      event
    );
  }

  function onPointerUp(
    event
  ) {
    if (
      event.pointerType ===
        "touch" ||
      event.pointerId !==
        pointerId
    ) {
      return;
    }

    const x =
      event.clientX;

    const y =
      event.clientY;

    releasePointer();

    finishGesture(
      x,
      y
    );
  }

  /* =========================================================
     CANCEL
     ========================================================= */

  function cancelGesture() {
    if (touchActive) {
      touchActive = false;
      touchId = null;
      releaseTouchListeners();
    }
    clearTimeout(
      holdTimer
    );

    holdTimer =
      null;

    releasePointer();

    radar
      ?.classList
      .remove(
        "ox-mqs-pressing"
      );

    closeMenu();
  }

  /* =========================================================
     BIND
     ========================================================= */

  function leaveDesktopMenu() {
    clearTimeout(hoverOpenTimer);
    clearTimeout(hoverCloseTimer);
    hoverCloseTimer = setTimeout(() => {
      if (!pointerHover && !menu?.contains(document.activeElement)) closeMenu();
    }, 180);
  }

  function bindDesktopRadar() {
    desktopRadar = document.querySelector('.ox-desktop-nav [data-view-target="radar"]');
    if (!desktopRadar || desktopRadar.dataset.oxQuickSwitch) return;
    desktopRadar.dataset.oxQuickSwitch = '3';
    desktopRadar.setAttribute('aria-haspopup', 'menu');
    desktopRadar.setAttribute('aria-expanded', 'false');
    desktopRadar.setAttribute('aria-controls', MENU_ID);
    desktopRadar.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse') return;
      pointerHover = true;
      clearTimeout(hoverOpenTimer);
      hoverOpenTimer = setTimeout(() => {
        hoverOpenTimer = null;
        if (pointerHover && desktopRadar.matches(':hover')) openMenu(desktopRadar, { hover: true });
      }, 250);
    });
    desktopRadar.addEventListener('pointerleave', () => {
      pointerHover = false;
      leaveDesktopMenu();
    });
    desktopRadar.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openRadar();
    }, true);
    desktopRadar.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openMenu(desktopRadar, { hover: true });
        menu.querySelector('.ox-mqs-item')?.focus();
      } else if (event.key === 'Escape') closeMenu();
    });
  }

  function bind() {
    radar =
      document.querySelector(
        ".app-dock .dock-radar[data-view-target='radar']"
      );

    if (!radar) {
      return false;
    }

    if (
      radar.dataset
        .oxQuickSwitch ===
      "2"
    ) {
      return true;
    }

    radar.dataset
      .oxQuickSwitch =
      "2";

    addStyles();

    buildMenu();

    bindDesktopRadar();

    /*
     * =======================================================
     * MOBILE
     *
     * Important:
     * touchmove / touchend are on DOCUMENT,
     * not Radar.
     *
     * So finger can leave Radar and keep moving upward.
     * =======================================================
     */

    radar.addEventListener(
      "touchstart",
      onTouchStart,
      {
        passive: true
      }
    );

    /*
     * =======================================================
     * DESKTOP
     * =======================================================
     */

    radar.addEventListener(
      "pointerdown",
      onPointerDown,
      {
        passive: false
      }
    );

    radar.addEventListener(
      "pointermove",
      onPointerMove,
      {
        passive: false
      }
    );

    radar.addEventListener(
      "pointerup",
      onPointerUp,
      {
        passive: false
      }
    );

    radar.addEventListener(
      "pointercancel",
      event => {

        if (
          event.pointerType !==
          "touch"
        ) {
          cancelGesture();
        }

      },
      {
        passive: false
      }
    );

    /*
     * Disable native context menu.
     */
    radar.addEventListener(
      "contextmenu",
      event => {
        event.preventDefault();
      }
    );

    /*
     * Suppress synthetic browser click.
     * Our own gesture system handles Radar click.
     */
    radar.addEventListener(
      "click",
      event => {

        event.preventDefault();

        event.stopImmediatePropagation();

      },
      true
    );

    /*
     * Keyboard
     */
    radar.addEventListener(
      "keydown",
      event => {

        if (
          event.key === "Enter" ||
          event.key === " "
        ) {

          event.preventDefault();

          openRadar();

        }

        else if (
          event.key ===
          "ArrowUp"
        ) {

          event.preventDefault();

          openMenu();
          holding = false;
          document.body.classList.remove('ox-mqs-dragging');
          menu.querySelector('.ox-mqs-item')?.focus();

        }

        else if (
          event.key ===
          "Escape"
        ) {

          closeMenu();

        }

      }
    );

    document.addEventListener('pointerdown', event => {
      if (menu?.classList.contains('is-open') && !menu.contains(event.target) && !radar.contains(event.target) && !desktopRadar?.contains(event.target)) closeMenu();
    });
    document.addEventListener('ox:viewchange', () => closeMenu(true));

    /*
     * =======================================================
     * TRACK ALL MARKET CHANGES
     * =======================================================
     */

    document.addEventListener(
      "ox:marketchange",
      event => {

        const next =
          event.detail
            ?.market;

        if (
          !valid(next)
        ) {
          return;
        }

        if (
          next !== current
        ) {

          previous =
            current;

          sessionStorage.setItem(
            PREV_KEY,
            previous
          );

          current =
            next;

        }

        syncMenu();
      }
    );

    /*
     * Reposition menu when viewport changes.
     */
    const reposition =
      () => {

        if (
          menu
            ?.classList
            .contains(
              "is-open"
            )
        ) {
          positionMenu();
        }

      };

    window.addEventListener(
      "resize",
      reposition,
      {
        passive: true
      }
    );

    window.visualViewport
      ?.addEventListener(
        "resize",
        reposition,
        {
          passive: true
        }
      );

    window.visualViewport
      ?.addEventListener(
        "scroll",
        reposition,
        {
          passive: true
        }
      );

    // Safari can end a gesture in browser chrome without delivering touchend.
    window.addEventListener("blur", cancelGesture);
    window.addEventListener("pagehide", cancelGesture);

    /*
     * Close if app/tab becomes inactive.
     */
    document.addEventListener(
      "visibilitychange",
      () => {

        if (
          document.hidden
        ) {
          cancelGesture();
        }

      }
    );

    return true;
  }

  /* =========================================================
     INIT
     ========================================================= */

  function init() {
    if (
      bind()
    ) {
      return;
    }

    let tries = 0;

    const timer =
      setInterval(
        () => {

          tries += 1;

          if (
            bind() ||
            tries >= 20
          ) {
            clearInterval(
              timer
            );
          }

        },
        150
      );
  }

  /* =========================================================
     DEBUG API
     ========================================================= */

  window.OXMarketQuickSwitch =
    Object.freeze({
      open: openMenu,
      close: closeMenu,
      switchMarket,
      current: currentMarket,
      previous:
        () => previous
    });

  /* =========================================================
     BOOT
     ========================================================= */

  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once: true
      }
    );

  } else {

    init();

  }

})();
