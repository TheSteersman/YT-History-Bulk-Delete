// YouTube History Bulk Delete
//
// Adds a checkbox to each row on youtube.com/feed/history and a floating
// "Delete selected" button that removes every checked video from watch
// history in one go, by driving the same "..." menu -> "Remove from watch
// history" action YouTube's own UI uses.
//
// This automates YouTube's own UI rather than calling a private API, so it
// is inherently sensitive to YouTube changing its markup. Everything here
// is logged with the [YHBD] prefix -- if something stops working, open
// DevTools (F12) on the history page, look at the Console tab filtered to
// "YHBD", and send Claude what shows up there.

(function () {
  const LOG = "[YHBD]";
  const PROCESSED_ATTR = "data-yhbd-seen";

  // Row types that can appear on the history page. Regular watched videos
  // are ytd-video-renderer. Shorts sometimes appear individually and
  // sometimes grouped in a horizontal shelf as ytd-reel-item-renderer --
  // those are included on a best-effort basis since we can't confirm their
  // exact menu structure without a logged-in account to test against.
  const ROW_SELECTORS = [
    "ytd-video-renderer",
    "ytd-rich-item-renderer",
    "ytd-reel-item-renderer",
    "yt-lockup-view-model",
    "ytm-shorts-lockup-view-model-v2",
    "ytm-shorts-lockup-view-model",
  ];

  const MENU_BUTTON_SELECTOR = [
    "ytd-menu-renderer yt-icon-button#button",
    "ytd-menu-renderer button#button",
    'ytd-menu-renderer [aria-label*="Action menu" i]',
    'ytd-menu-renderer [aria-label*="More actions" i]',
    "yt-icon-button.dropdown-trigger",
    '[aria-haspopup="true"]',
    '[aria-haspopup="menu"]',
    'button[aria-label*="action" i]',
    'button[aria-label*="more" i]',
    'yt-icon-button[aria-label*="action" i]',
    'yt-icon-button[aria-label*="more" i]',
  ].join(", ");

  const REMOVE_ITEM_MATCH = "remove from watch history";

  // How many scan passes we'll retry a row that has no menu button yet
  // before giving up on it for good. Rows exist in the DOM before their
  // internal menu button finishes rendering, so a row with no menu button
  // on the FIRST look isn't necessarily a dead end -- it might just not be
  // ready yet. Giving up too early (or never) are both wrong; this caps it.
  const MAX_ATTEMPTS = 30;

  /** @type {Set<HTMLElement>} rows the user has checked */
  const selected = new Set();

  /** @type {WeakMap<HTMLElement, number>} retry counter per unprocessed row */
  const attempts = new WeakMap();

  let floatingBtn = null;
  let diagnosticsLogged = false;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function findRows() {
    const found = [];
    for (const sel of ROW_SELECTORS) {
      document
        .querySelectorAll(`${sel}:not([${PROCESSED_ATTR}])`)
        .forEach((el) => found.push(el));
    }
    return found;
  }

  // One-time dump of every custom element tag on the page that looks like
  // a content renderer, so we can see what YouTube is actually using for
  // the Shorts shelf and video rows on this account/page, rather than
  // guessing from a logged-out test.
  function logDiagnosticsOnce() {
    if (diagnosticsLogged) return;
    diagnosticsLogged = true;
    const tags = new Set();
    document.querySelectorAll("*").forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (
        tag.includes("-") &&
        (tag.includes("renderer") ||
          tag.includes("view-model") ||
          tag.includes("lockup") ||
          tag.includes("shelf"))
      ) {
        tags.add(tag);
      }
    });
    console.log(LOG, "DIAGNOSTIC: content-like custom elements on page:", Array.from(tags).sort());
  }

  function injectCheckbox(row) {
    // Only look for a menu button once the row has actual content --
    // an empty placeholder row shouldn't count as a real attempt.
    const menuButton = row.querySelector(MENU_BUTTON_SELECTOR);
    if (!menuButton) {
      const count = (attempts.get(row) || 0) + 1;
      if (count >= MAX_ATTEMPTS) {
        row.setAttribute(PROCESSED_ATTR, "1");
        console.debug(LOG, "giving up on row after", count, "attempts, no menu button found:", row.tagName, row);
      } else {
        attempts.set(row, count);
      }
      return false;
    }

    // Found a working menu button -- lock this row in as done so we never
    // touch it again.
    row.setAttribute(PROCESSED_ATTR, "1");

    const wrapper = document.createElement("div");
    wrapper.className = "yhbd-checkbox-wrapper";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "yhbd-checkbox";
    checkbox.setAttribute("aria-label", "Select this video for bulk removal");

    checkbox.addEventListener("click", (e) => {
      // Stop the click from bubbling up into YouTube's row-level
      // navigation handler.
      e.stopPropagation();
    });

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selected.add(row);
        row.classList.add("yhbd-selected");
      } else {
        selected.delete(row);
        row.classList.remove("yhbd-selected");
      }
      updateFloatingButton();
    });

    wrapper.appendChild(checkbox);

    const computed = getComputedStyle(row);
    if (computed.position === "static") {
      row.style.position = "relative";
    }
    row.prepend(wrapper);
    return true;
  }

  function scan() {
    logDiagnosticsOnce();
    const rows = findRows();
    let injected = 0;
    rows.forEach((row) => {
      if (injectCheckbox(row)) injected++;
    });
    if (injected > 0) {
      console.log(LOG, `injected ${injected} checkbox(es) this pass, ${selected.size} currently selected`);
    }
  }

  function ensureFloatingButton() {
    if (floatingBtn) return floatingBtn;
    floatingBtn = document.createElement("button");
    floatingBtn.id = "yhbd-delete-btn";
    floatingBtn.type = "button";
    floatingBtn.addEventListener("click", handleDeleteSelected);
    document.body.appendChild(floatingBtn);
    return floatingBtn;
  }

  function updateFloatingButton() {
    const btn = ensureFloatingButton();
    btn.classList.remove("yhbd-error");
    if (selected.size === 0) {
      btn.style.display = "none";
      return;
    }
    btn.style.display = "block";
    btn.disabled = false;
    btn.textContent = `Delete ${selected.size} selected`;
  }

  // Finds the smallest/most specific visible element anywhere in the
  // document whose own text matches `matchText`. This deliberately does
  // NOT depend on any particular tag name (ytd-menu-service-item-renderer,
  // yt-list-item-view-model, or whatever YouTube uses next) -- YouTube
  // keeps the user-facing label text far more stable than its internal
  // component names, so matching on visible text is the most durable way
  // to find "Remove from watch history" regardless of which component
  // system rendered it.
  function findVisibleTextMatch(matchText) {
    const all = document.querySelectorAll("body *");
    let best = null;
    let bestLen = Infinity;
    for (const el of all) {
      // Skip big containers -- we want the innermost element carrying the
      // label, not some ancestor that happens to also contain that text
      // among many other menu items.
      if (el.children.length > 2) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue; // not visible
      const text = (el.textContent || "").trim().toLowerCase();
      if (text && text.includes(matchText) && text.length < bestLen) {
        best = el;
        bestLen = text.length;
      }
    }
    return best;
  }

  // Finds any currently-visible popup/menu/sheet-like container, whatever
  // YouTube's current component system calls it, so we can log its actual
  // contents when we fail to find what we expect inside it.
  function findOpenMenuContainers() {
    const candidates = document.querySelectorAll(
      [
        '[role="menu"]',
        '[role="listbox"]',
        '[role="dialog"]',
        "tp-yt-iron-dropdown",
        "ytd-popup-container",
        'yt-sheet-view-model',
        '[class*="popup" i]',
        '[class*="dropdown" i]',
        '[class*="sheet" i]',
        '[class*="menu" i]',
      ].join(", ")
    );
    return Array.from(candidates).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  function logOpenMenuDiagnostics() {
    const containers = findOpenMenuContainers();
    if (containers.length === 0) {
      console.warn(
        LOG,
        "no visible popup/menu/sheet container found at all -- the menu button click likely did not open anything (wrong element?)"
      );
      return;
    }
    console.warn(
      LOG,
      `${containers.length} visible menu-like container(s) found -- here's what's actually in them:`,
      containers.slice(0, 5).map((el) => ({
        tag: el.tagName,
        class: typeof el.className === "string" ? el.className : String(el.className),
        text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 300),
      }))
    );
  }

  // Waits for a menu item whose text matches `matchText` to show up
  // anywhere in the document (YouTube renders the dropdown into a single
  // shared popup container, not inside the row itself). Checks on an
  // interval rather than every animation frame since this can run for up
  // to a couple of seconds per row.
  function waitForMenuItem(matchText, timeoutMs) {
    return new Promise((resolve) => {
      const start = performance.now();
      function check() {
        const found = findVisibleTextMatch(matchText);
        if (found) {
          resolve(found);
          return;
        }
        if (performance.now() - start > timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(check, 150);
      }
      check();
    });
  }

  // Confirms YouTube actually processed the removal, rather than assuming
  // success right after the click. Turns out YouTube doesn't remove the
  // row from the page at all here -- it swaps the row's content in place
  // for a confirmation bar ("All views of this video removed from
  // history"), keeping the same element attached and visible. So success
  // is: either the row disappears entirely (in case YouTube does that in
  // some other view), OR that confirmation text shows up inside it.
  function waitForRemoval(row, timeoutMs) {
    return new Promise((resolve) => {
      const start = performance.now();
      function check() {
        const detached = !document.documentElement.contains(row) || row.offsetParent === null;
        const confirmedInPlace = (row.textContent || "").toLowerCase().includes("removed from");
        if (detached || confirmedInPlace) {
          resolve(true);
          return;
        }
        if (performance.now() - start > timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(check, 150);
      }
      check();
    });
  }

  function closeAnyOpenMenu() {
    // Clicking elsewhere closes YouTube's popup if one is stuck open.
    document.body.click();
  }

  async function removeOneFromHistory(row) {
    const menuButton = row.querySelector(MENU_BUTTON_SELECTOR);
    if (!menuButton) {
      console.warn(LOG, "no menu button found on row, skipping", row);
      return false;
    }

    menuButton.click();

    const item = await waitForMenuItem(REMOVE_ITEM_MATCH, 2500);
    if (!item) {
      console.warn(
        LOG,
        '"Remove from watch history" option did not appear for row -- closing menu and skipping. Here is what the open menu (if any) actually contains:',
        row
      );
      logOpenMenuDiagnostics();
      closeAnyOpenMenu();
      return false;
    }

    // The text match might have landed on a plain text span rather than
    // the actual clickable menu-item element wrapping it. Walk up a few
    // levels to find something that behaves like a real menu item.
    const clickTarget =
      item.closest('[role="menuitem"], [role="option"], button, li, tp-yt-paper-item, a') ||
      item;
    clickTarget.click();

    // Confirmed by testing: successfully finding and clicking this item
    // means the video is removed, whether or not the page shows any sign
    // of it -- regular videos get an in-place "removed from..." bar,
    // Shorts show nothing at all until the next refresh. So clean up the
    // checkbox immediately rather than waiting on a confirmation some row
    // types never give.
    row.querySelector(".yhbd-checkbox-wrapper")?.remove();
    row.classList.remove("yhbd-selected");

    // Non-blocking: still watch briefly for a visible confirmation purely
    // to log it for future debugging. Nothing depends on this resolving.
    waitForRemoval(row, 2000).then((confirmed) => {
      if (!confirmed) {
        console.log(
          LOG,
          "no visible confirmation appeared for this row (expected for Shorts) -- already treated as done",
          row
        );
      }
    });

    return true;
  }

  async function handleDeleteSelected() {
    const btn = ensureFloatingButton();
    const rows = Array.from(selected);
    const total = rows.length;
    let done = 0;
    let failed = 0;

    btn.disabled = true;

    for (const row of rows) {
      btn.textContent = `Deleting... (${done + failed}/${total})`;
      let ok = false;
      try {
        ok = await removeOneFromHistory(row);
      } catch (err) {
        console.error(LOG, "error removing row", err, row);
      }

      if (ok) {
        done++;
        selected.delete(row);
      } else {
        failed++;
      }

      // Small pause between each removal so YouTube's own animations and
      // singleton popup have time to settle before we open the next one.
      await sleep(450 + Math.random() * 250);
    }

    btn.disabled = false;

    if (failed === 0) {
      btn.textContent = `Removed ${done} video${done === 1 ? "" : "s"}`;
      setTimeout(() => {
        if (selected.size === 0) btn.style.display = "none";
      }, 2500);
    } else {
      btn.classList.add("yhbd-error");
      btn.textContent = `Removed ${done}, ${failed} failed -- click to retry failed`;
      console.warn(
        LOG,
        `${failed} row(s) could not be removed automatically. See warnings above for which ones and why.`
      );
    }
  }

  // Coalesce bursts of mutations (YouTube's page updates constantly) into
  // one scan per animation frame instead of one scan per mutation record.
  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scan();
    });
  }

  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  scan();
  console.log(LOG, "content script loaded on", location.href);
})();
