import {
  PRICING_URL,
  applyTierLimit,
  extractContactsAndLinks,
  extractJsonLdTables,
  extractTablesFromModel,
  toCsv,
  toMarkdownTable,
  validateLicenseKey,
} from "./src/extractor_core.mjs";

const LICENSE_STORAGE_KEY = "weblead_pro_license_key";

const state = {
  pageUrl: "",
  pageTitle: "",
  tables: [],
  leads: { emails: [], phones: [], socialLinks: [], websiteLinks: [], allLinks: [] },
  license: validateLicenseKey(null),
};

const els = {
  pageSummary: document.getElementById("pageSummary"),
  tierBadge: document.getElementById("tierBadge"),
  tabCountTables: document.getElementById("tabCountTables"),
  tabCountLeads: document.getElementById("tabCountLeads"),
  tableSelect: document.getElementById("tableSelect"),
  rescanBtn: document.getElementById("rescanBtn"),
  regexInput: document.getElementById("regexInput"),
  tableLimitNotice: document.getElementById("tableLimitNotice"),
  tablePreviewWrap: document.getElementById("tablePreviewWrap"),
  copyCsvBtn: document.getElementById("copyCsvBtn"),
  copyMdBtn: document.getElementById("copyMdBtn"),
  downloadCsvBtn: document.getElementById("downloadCsvBtn"),
  downloadJsonBtn: document.getElementById("downloadJsonBtn"),
  emailCount: document.getElementById("emailCount"),
  phoneCount: document.getElementById("phoneCount"),
  linkCount: document.getElementById("linkCount"),
  emailList: document.getElementById("emailList"),
  phoneList: document.getElementById("phoneList"),
  linkList: document.getElementById("linkList"),
  copyEmailsBtn: document.getElementById("copyEmailsBtn"),
  exportLeadsCsvBtn: document.getElementById("exportLeadsCsvBtn"),
  exportLeadsJsonBtn: document.getElementById("exportLeadsJsonBtn"),
  licenseStatusText: document.getElementById("licenseStatusText"),
  licenseKeyInput: document.getElementById("licenseKeyInput"),
  activateKeyBtn: document.getElementById("activateKeyBtn"),
  clearKeyBtn: document.getElementById("clearKeyBtn"),
  toast: document.getElementById("toast"),
};

function setToast(message) {
  els.toast.textContent = message;
}

function getSavedLicenseKey() {
  try {
    return window.localStorage.getItem(LICENSE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function setSavedLicenseKey(value) {
  try {
    if (value) {
      window.localStorage.setItem(LICENSE_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(LICENSE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage unavailability in restricted contexts
  }
}

function refreshLicenseUi() {
  const key = getSavedLicenseKey();
  state.license = validateLicenseKey(key);

  if (state.license.isPro) {
    els.tierBadge.textContent = "PRO";
    els.tierBadge.className = "badge badge-pro";
    els.regexInput.disabled = false;
    els.regexInput.placeholder = "Pro regex filter (e.g. @acme\\.com|director)";
  } else {
    els.tierBadge.textContent = "FREE";
    els.tierBadge.className = "badge badge-free";
    els.regexInput.value = "";
    els.regexInput.disabled = true;
    els.regexInput.placeholder = "Regex filter locked (Pro Edition)";
  }

  els.licenseStatusText.textContent = state.license.reason;
  if (key && !els.licenseKeyInput.value) {
    els.licenseKeyInput.value = key;
  }
}

function getSelectedTable() {
  const idx = Number.parseInt(els.tableSelect.value || "0", 10);
  return state.tables[idx] ?? null;
}

function getActiveTableExportSlice() {
  const table = getSelectedTable();
  if (!table) {
    return { table: null, sliced: null, error: null };
  }
  const regexPattern = state.license.isPro ? els.regexInput.value.trim() : "";
  try {
    const sliced = applyTierLimit(table.rows, state.license.isPro, {
      regexFilter: regexPattern,
    });
    return { table, sliced, error: null };
  } catch (err) {
    return {
      table,
      sliced: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function renderSelectedTable() {
  const { table, sliced, error } = getActiveTableExportSlice();
  els.tablePreviewWrap.innerHTML = "";
  els.tableLimitNotice.classList.add("hidden");
  els.tableLimitNotice.innerHTML = "";

  if (!table) {
    const empty = document.createElement("p");
    empty.className = "muted empty-state";
    empty.textContent = "No HTML tables detected on this page.";
    els.tablePreviewWrap.appendChild(empty);
    return;
  }

  if (error) {
    const errEl = document.createElement("p");
    errEl.className = "muted empty-state";
    errEl.textContent = `Regex error: ${error}`;
    els.tablePreviewWrap.appendChild(errEl);
    return;
  }

  if (sliced.truncated) {
    els.tableLimitNotice.classList.remove("hidden");
    const msg = document.createTextNode(
      `Free tier exports the first ${sliced.limit} of ${sliced.totalCount} rows. `
    );
    const link = document.createElement("a");
    link.href = PRICING_URL;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Unlock unlimited rows with Pro ->";
    els.tableLimitNotice.appendChild(msg);
    els.tableLimitNotice.appendChild(link);
  }

  const domTable = document.createElement("table");
  domTable.className = "preview";

  const thead = document.createElement("thead");
  const headTr = document.createElement("tr");
  for (const h of table.headers) {
    const th = document.createElement("th");
    th.textContent = h;
    th.title = h;
    headTr.appendChild(th);
  }
  thead.appendChild(headTr);
  domTable.appendChild(thead);

  const tbody = document.createElement("tbody");
  const previewRows = sliced.rows.slice(0, 50);
  for (const row of previewRows) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      td.textContent = cell;
      td.title = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  domTable.appendChild(tbody);
  els.tablePreviewWrap.appendChild(domTable);
}

function renderTableSelector() {
  els.tableSelect.innerHTML = "";
  els.tabCountTables.textContent = String(state.tables.length);

  if (state.tables.length === 0) {
    const opt = document.createElement("option");
    opt.value = "0";
    opt.textContent = "No tables detected";
    els.tableSelect.appendChild(opt);
    els.tableSelect.disabled = true;
  } else {
    els.tableSelect.disabled = false;
    state.tables.forEach((t, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = `${t.name} (${t.rowCount} rows x ${t.columnCount} cols)`;
      els.tableSelect.appendChild(opt);
    });
  }

  renderSelectedTable();
}

function fillList(ulEl, items, emptyLabel) {
  ulEl.innerHTML = "";
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = emptyLabel;
    ulEl.appendChild(li);
    return;
  }
  for (const item of items.slice(0, 100)) {
    const li = document.createElement("li");
    li.textContent = item;
    ulEl.appendChild(li);
  }
}

function renderLeads() {
  const { emails, phones, allLinks } = state.leads;
  els.emailCount.textContent = String(emails.length);
  els.phoneCount.textContent = String(phones.length);
  els.linkCount.textContent = String(allLinks.length);
  els.tabCountLeads.textContent = String(emails.length + phones.length);

  fillList(els.emailList, emails, "No public email addresses detected.");
  fillList(els.phoneList, phones, "No phone numbers detected.");
  fillList(
    els.linkList,
    allLinks.map((entry) => `[${entry.network}] ${entry.url}`),
    "No external links detected."
  );
}

function triggerDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeSafeSlug(text) {
  return (text || "weblead")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "weblead";
}

async function scanCurrentTab() {
  setToast("Scanning active tab...");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active browser tab found.");
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: "WEBLEAD_SCAN" });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      response = await chrome.tabs.sendMessage(tab.id, { type: "WEBLEAD_SCAN" });
    }

    if (!response?.ok || !response.payload) {
      throw new Error(response?.error || "Could not scan page contents.");
    }

    const payload = response.payload;
    state.pageUrl = payload.url || "";
    state.pageTitle = payload.title || "";
    const domTables = extractTablesFromModel(payload.tables || []);
    const ldRes = extractJsonLdTables(payload.jsonLd || []);
    state.tables = [...domTables, ...ldRes.tables].map((t, i) => ({ ...t, index: i }));
    const combinedText = ldRes.extractedText
      ? `${payload.text || ""}\n${ldRes.extractedText}`
      : payload.text || "";
    state.leads = extractContactsAndLinks(combinedText, payload.links || []);

    els.pageSummary.textContent = state.pageTitle || state.pageUrl || "Active tab scanned";
    renderTableSelector();
    renderLeads();
    setToast(
      `Found ${state.tables.length} table(s), ${state.leads.emails.length} email(s), ${state.leads.allLinks.length} link(s).`
    );
  } catch (err) {
    els.pageSummary.textContent = "Cannot scan restricted browser page.";
    setToast(err instanceof Error ? err.message : String(err));
  }
}

function bindEvents() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`panel-${btn.dataset.tab}`)?.classList.add("active");
    });
  });

  els.tableSelect.addEventListener("change", renderSelectedTable);
  els.regexInput.addEventListener("input", renderSelectedTable);
  els.rescanBtn.addEventListener("click", scanCurrentTab);

  els.copyCsvBtn.addEventListener("click", async () => {
    const { table, sliced, error } = getActiveTableExportSlice();
    if (!table || error) {
      setToast(error || "No table selected.");
      return;
    }
    const csv = toCsv(sliced.rows, table.headers, { includeBom: false });
    await navigator.clipboard.writeText(csv);
    setToast(`Copied ${sliced.exportedCount} row(s) as CSV.`);
  });

  if (els.copyMdBtn) {
    els.copyMdBtn.addEventListener("click", async () => {
      const { table, sliced, error } = getActiveTableExportSlice();
      if (!table || error) {
        setToast(error || "No table selected.");
        return;
      }
      const md = toMarkdownTable(sliced.rows, table.headers);
      await navigator.clipboard.writeText(md);
      setToast(`Copied ${sliced.exportedCount} row(s) as Markdown.`);
    });
  }

  els.downloadCsvBtn.addEventListener("click", () => {
    const { table, sliced, error } = getActiveTableExportSlice();
    if (!table || error) {
      setToast(error || "No table selected.");
      return;
    }
    const csv = toCsv(sliced.rows, table.headers, { includeBom: true });
    const filename = `${makeSafeSlug(table.name)}.csv`;
    triggerDownload(filename, csv, "text/csv;charset=utf-8");
    setToast(`Downloaded ${filename} (${sliced.exportedCount} rows).`);
  });

  els.downloadJsonBtn.addEventListener("click", () => {
    const { table, sliced, error } = getActiveTableExportSlice();
    if (!table || error) {
      setToast(error || "No table selected.");
      return;
    }
    const objects = sliced.rows.map((row) => {
      const obj = {};
      table.headers.forEach((header, idx) => {
        const key = header || `col_${idx + 1}`;
        obj[key] = row[idx] ?? "";
      });
      return obj;
    });
    const filename = `${makeSafeSlug(table.name)}.json`;
    triggerDownload(filename, JSON.stringify(objects, null, 2), "application/json;charset=utf-8");
    setToast(`Downloaded ${filename} (${objects.length} rows).`);
  });

  els.copyEmailsBtn.addEventListener("click", async () => {
    if (state.leads.emails.length === 0) {
      setToast("No emails to copy.");
      return;
    }
    await navigator.clipboard.writeText(state.leads.emails.join("\n"));
    setToast(`Copied ${state.leads.emails.length} email(s).`);
  });

  els.exportLeadsCsvBtn.addEventListener("click", () => {
    const rows = [
      ...state.leads.emails.map((email) => ["email", email, ""]),
      ...state.leads.phones.map((phone) => ["phone", phone, ""]),
      ...state.leads.allLinks.map((link) => [link.kind, link.url, link.label]),
    ];
    const limited = applyTierLimit(rows, state.license.isPro);
    const csv = toCsv(limited.rows, ["type", "value", "label"], { includeBom: true });
    triggerDownload(`${makeSafeSlug(state.pageTitle)}-leads.csv`, csv, "text/csv;charset=utf-8");
    setToast(`Exported ${limited.exportedCount} lead record(s) to CSV.`);
  });

  els.exportLeadsJsonBtn.addEventListener("click", () => {
    const payload = {
      sourceUrl: state.pageUrl,
      sourceTitle: state.pageTitle,
      emails: applyTierLimit(state.leads.emails, state.license.isPro).rows,
      phones: applyTierLimit(state.leads.phones, state.license.isPro).rows,
      socialLinks: applyTierLimit(state.leads.socialLinks, state.license.isPro).rows,
      websiteLinks: applyTierLimit(state.leads.websiteLinks, state.license.isPro).rows,
    };
    triggerDownload(
      `${makeSafeSlug(state.pageTitle)}-leads.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
    setToast("Exported leads JSON.");
  });

  els.activateKeyBtn.addEventListener("click", () => {
    const candidate = els.licenseKeyInput.value.trim();
    const validation = validateLicenseKey(candidate);
    if (!validation.isPro) {
      setToast(validation.reason);
      return;
    }
    setSavedLicenseKey(candidate.toUpperCase());
    refreshLicenseUi();
    renderSelectedTable();
    setToast(validation.reason);
  });

  els.clearKeyBtn.addEventListener("click", () => {
    setSavedLicenseKey("");
    els.licenseKeyInput.value = "";
    refreshLicenseUi();
    renderSelectedTable();
    setToast("Reverted to Community Free tier.");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  refreshLicenseUi();
  bindEvents();
  scanCurrentTab();
});
