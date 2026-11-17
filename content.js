/**
 * Read-only DOM scanner for WebLead & Table Extractor (Manifest V3).
 * Inspects visible HTML tables, public mailto/text contacts, and anchor links
 * without mutating the active page.
 */
(() => {
  if (globalThis.__webleadScannerBound) {
    return;
  }
  globalThis.__webleadScannerBound = true;

  function collectTables() {
    const tableEls = Array.from(document.querySelectorAll("table"));
    return tableEls.map((table, idx) => {
      const caption =
        table.querySelector("caption")?.textContent?.trim() ||
        table.getAttribute("aria-label")?.trim() ||
        table.id?.trim() ||
        `Table ${idx + 1}`;

      const rows = Array.from(table.rows).map((tr) =>
        Array.from(tr.cells).map((cell) => ({
          text: cell.innerText ?? cell.textContent ?? "",
          colspan: cell.colSpan || 1,
          rowspan: cell.rowSpan || 1,
          isHeader: cell.tagName === "TH" || Boolean(cell.closest("thead")),
        }))
      );

      return { name: caption, rows };
    });
  }

  function collectAriaGrids() {
    const gridEls = Array.from(document.querySelectorAll('[role="table"], [role="grid"]'));
    return gridEls
      .filter((el) => !el.closest("table"))
      .map((grid, idx) => {
        const caption =
          grid.getAttribute("aria-label")?.trim() ||
          grid.id?.trim() ||
          `ARIA Grid ${idx + 1}`;
        const rowEls = Array.from(grid.querySelectorAll('[role="row"]'));
        const rows = rowEls.map((row) =>
          Array.from(row.querySelectorAll('[role="columnheader"], [role="gridcell"], [role="cell"]')).map((cell) => ({
            text: cell.innerText ?? cell.textContent ?? "",
            colspan: 1,
            rowspan: 1,
            isHeader: cell.getAttribute("role") === "columnheader",
          }))
        ).filter((r) => r.length > 0);
        return { name: caption, rows };
      })
      .filter((g) => g.rows.length > 0);
  }

  function collectJsonLd() {
    return Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((el) => el.textContent || "")
      .filter((txt) => txt.trim().length > 0);
  }

  function collectLinks() {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    return anchors.map((anchor) => ({
      href: anchor.href || anchor.getAttribute("href") || "",
      text: anchor.innerText || anchor.textContent || "",
    }));
  }

  function scanActiveDocument() {
    const bodyText = document.body
      ? document.body.innerText || document.body.textContent || ""
      : "";

    return {
      url: window.location.href,
      title: document.title || "",
      tables: [...collectTables(), ...collectAriaGrids()],
      jsonLd: collectJsonLd(),
      text: bodyText,
      links: collectLinks(),
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "WEBLEAD_SCAN") {
      try {
        sendResponse({ ok: true, payload: scanActiveDocument() });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return false;
    }
    return false;
  });
})();
