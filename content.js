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
      tables: collectTables(),
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
