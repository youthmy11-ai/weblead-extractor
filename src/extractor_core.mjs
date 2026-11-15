/**
 * Core extraction, RFC 4180 CSV serialization, and deterministic Pro license logic
 * for WebLead & Table Extractor (Chrome MV3 + Node ES module compatible).
 */

export const PRICING_URL = "https://youthmy11-ai.github.io/#pricing";
export const PRODUCT_CODE = "WL";
export const ACCEPTED_PRODUCTS = ["WL", "BUNDLE"];
export const FREE_ROW_LIMIT = 25;

const LICENSE_KEY_RE = /^FS-PRO-(AS|WL|BUNDLE)-([A-Z0-9]{8})-([0-9A-F]{4})$/;

const ASSET_EXTENSION_TLDS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "bmp",
  "avif",
  "tif",
  "tiff",
  "css",
  "js",
  "mjs",
  "cjs",
  "json",
  "map",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "pdf",
  "mp4",
  "mp3",
  "wav",
  "webm",
  "zip",
  "gz",
]);

const SOCIAL_HOST_PATTERNS = [
  { name: "linkedin", re: /(^|\.)linkedin\.com$/i },
  { name: "github", re: /(^|\.)github\.com$/i },
  { name: "x", re: /(^|\.)(twitter\.com|x\.com)$/i },
  { name: "facebook", re: /(^|\.)facebook\.com$/i },
  { name: "instagram", re: /(^|\.)instagram\.com$/i },
  { name: "youtube", re: /(^|\.)(youtube\.com|youtu\.be)$/i },
  { name: "tiktok", re: /(^|\.)tiktok\.com$/i },
  { name: "telegram", re: /(^|\.)(t\.me|telegram\.me)$/i },
  { name: "discord", re: /(^|\.)(discord\.gg|discord\.com)$/i },
];

const EMAIL_CANDIDATE_RE =
  /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

const STRICT_EMAIL_RE =
  /^[a-z0-9](?:[a-z0-9.!#$%&'*+/=?^_`{|}~-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;
const PHONE_CANDIDATE_RE =
  /(?<![\w.])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?![\w.])/g;
const ISO_DATE_RE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/;

/**
 * Normalize whitespace inside a cell value.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeCellText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeSpan(raw, fallback = 1) {
  const n = Number.parseInt(String(raw ?? fallback), 10);
  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }
  return Math.min(n, 100);
}

function expandRowCells(rowInput) {
  const cells = Array.isArray(rowInput)
    ? rowInput
    : Array.isArray(rowInput?.cells)
      ? rowInput.cells
      : [];

  const expanded = [];
  let hasHeaderCell = false;
  let allExplicitNonHeader = cells.length > 0;

  for (const cell of cells) {
    if (cell && typeof cell === "object" && !Array.isArray(cell)) {
      const text = normalizeCellText(cell.text ?? cell.value ?? "");
      const colspan = normalizeSpan(cell.colspan ?? cell.colSpan, 1);
      const rowspan = normalizeSpan(cell.rowspan ?? cell.rowSpan, 1);
      if (cell.isHeader === true) {
        hasHeaderCell = true;
        allExplicitNonHeader = false;
      } else if (cell.isHeader !== false) {
        allExplicitNonHeader = false;
      }
      expanded.push({ text, colspan, rowspan, isHeader: Boolean(cell.isHeader) });
    } else {
      allExplicitNonHeader = false;
      expanded.push({
        text: normalizeCellText(cell),
        colspan: 1,
        rowspan: 1,
        isHeader: false,
      });
    }
  }
  return { expanded, hasHeaderCell, allExplicitNonHeader };
}

function buildExpandedGrid(rawRows) {
  const grid = [];
  const rowFlags = [];

  for (let r = 0; r < rawRows.length; r += 1) {
    if (!grid[r]) {
      grid[r] = [];
    }
    const { expanded, hasHeaderCell, allExplicitNonHeader } = expandRowCells(rawRows[r]);
    rowFlags.push({ hasHeaderCell, allExplicitNonHeader });

    let colCursor = 0;
    for (const cell of expanded) {
      while (grid[r][colCursor] !== undefined) {
        colCursor += 1;
      }
      for (let dr = 0; dr < cell.rowspan; dr += 1) {
        const targetRow = r + dr;
        if (!grid[targetRow]) {
          grid[targetRow] = [];
        }
        for (let dc = 0; dc < cell.colspan; dc += 1) {
          if (grid[targetRow][colCursor + dc] === undefined) {
            grid[targetRow][colCursor + dc] = cell.text;
          }
        }
      }
      colCursor += cell.colspan;
    }
  }

  return { grid, rowFlags };
}

/**
 * Convert structured HTML table models into normalized headers and rectangular rows.
 * Expands `colspan` horizontally (and tracks `rowspan`) while normalizing whitespace.
 * @param {Array<object>} tablesData
 */
export function extractTablesFromModel(tablesData) {
  if (!Array.isArray(tablesData)) {
    return [];
  }

  const parsedTables = [];

  for (let idx = 0; idx < tablesData.length; idx += 1) {
    const model = tablesData[idx];
    if (!model || typeof model !== "object") {
      continue;
    }

    const rawRows = Array.isArray(model.rows) ? model.rows : [];
    const hasExplicitHeaders = Array.isArray(model.headers) && model.headers.length > 0;

    let headers = [];
    let bodyGrid = [];

    if (hasExplicitHeaders) {
      const { grid: headerGrid } = buildExpandedGrid([model.headers]);
      headers = headerGrid[0] ?? [];
      const { grid } = buildExpandedGrid(rawRows);
      bodyGrid = grid;
    } else {
      const { grid, rowFlags } = buildExpandedGrid(rawRows);
      if (grid.length === 0) {
        continue;
      }
      const firstFlags = rowFlags[0] ?? { hasHeaderCell: false, allExplicitNonHeader: false };
      const shouldPromoteFirstRow =
        model.hasHeader === true ||
        firstFlags.hasHeaderCell ||
        (model.hasHeader !== false && !firstFlags.allExplicitNonHeader && grid.length >= 2);

      if (shouldPromoteFirstRow) {
        headers = grid[0];
        bodyGrid = grid.slice(1);
      } else {
        bodyGrid = grid;
      }
    }

    const colCount = Math.max(
      headers.length,
      ...bodyGrid.map((row) => row.length),
      0
    );
    if (colCount === 0) {
      continue;
    }

    if (headers.length === 0) {
      headers = Array.from({ length: colCount }, (_, c) => `Column ${c + 1}`);
    } else {
      headers = Array.from({ length: colCount }, (_, c) => normalizeCellText(headers[c] ?? ""));
    }

    const normalizedRows = bodyGrid
      .map((row) => Array.from({ length: colCount }, (_, c) => normalizeCellText(row[c] ?? "")))
      .filter((row) => row.some((cell) => cell !== ""));

    const hasAnyHeaderContent = headers.some((h) => h !== "");
    if (!hasAnyHeaderContent && normalizedRows.length === 0) {
      continue;
    }

    const tableName =
      normalizeCellText(model.name || model.caption || model.id || "") ||
      `Table ${parsedTables.length + 1}`;

    parsedTables.push({
      index: parsedTables.length,
      name: tableName,
      headers,
      rows: normalizedRows,
      columnCount: colCount,
      rowCount: normalizedRows.length,
    });
  }

  return parsedTables;
}

/**
 * Validate whether a candidate string looks like a real public email address,
 * filtering out image retina suffixes such as `@2x.png` or asset filenames.
 * @param {string} candidate
 * @returns {boolean}
 */
export function isValidPublicEmail(candidate) {
  if (!candidate || typeof candidate !== "string") {
    return false;
  }
  const cleaned = candidate.trim().toLowerCase();
  if (cleaned.length > 254 || !STRICT_EMAIL_RE.test(cleaned)) {
    return false;
  }

  const atIndex = cleaned.lastIndexOf("@");
  const local = cleaned.slice(0, atIndex);
  const domain = cleaned.slice(atIndex + 1);

  if (local.includes("..") || domain.includes("..")) {
    return false;
  }

  const labels = domain.split(".");
  const tld = labels[labels.length - 1];
  if (!tld || tld.length < 2 || /^\d+$/.test(tld)) {
    return false;
  }
  if (ASSET_EXTENSION_TLDS.has(tld)) {
    return false;
  }

  // Reject retina asset hints like hero@2x.png or banner@3x.custom
  if (/^\d+(?:\.\d+)?x\./i.test(domain)) {
    return false;
  }

  return true;
}

function normalizeUrl(rawHref) {
  if (!rawHref || typeof rawHref !== "string") {
    return null;
  }
  const trimmed = rawHref.trim().replace(/[),.;]+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.toString();
  } catch {
    return null;
  }
}

function classifyUrl(urlString) {
  try {
    const host = new URL(urlString).hostname.toLowerCase();
    for (const pattern of SOCIAL_HOST_PATTERNS) {
      if (pattern.re.test(host)) {
        return { kind: "social", network: pattern.name };
      }
    }
    return { kind: "website", network: "web" };
  } catch {
    return { kind: "website", network: "web" };
  }
}

/**
 * Extract deduplicated public emails, phone numbers, social links, and website URLs.
 * @param {string} text
 * @param {Array<string | {href?: string, text?: string}>} links
 */
export function extractContactsAndLinks(text = "", links = []) {
  const emailSet = new Set();
  const phoneMap = new Map();
  const linkMap = new Map();

  const scanEmails = (chunk) => {
    if (!chunk || typeof chunk !== "string") {
      return;
    }
    const matches = chunk.match(EMAIL_CANDIDATE_RE) ?? [];
    for (const raw of matches) {
      const lowered = raw.toLowerCase();
      if (isValidPublicEmail(lowered)) {
        emailSet.add(lowered);
      }
    }
  };

  const scanPhones = (chunk) => {
    if (!chunk || typeof chunk !== "string") {
      return;
    }
    const matches = chunk.match(PHONE_CANDIDATE_RE) ?? [];
    for (const raw of matches) {
      const candidate = normalizeCellText(raw);
      if (ISO_DATE_RE.test(candidate)) {
        continue;
      }
      const digits = candidate.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) {
        continue;
      }
      const key = (candidate.startsWith("+") ? "+" : "") + digits;
      if (!phoneMap.has(key)) {
        phoneMap.set(key, candidate);
      }
    }
  };

  const recordUrl = (href, label = "") => {
    const normalized = normalizeUrl(href);
    if (!normalized) {
      return;
    }
    const existing = linkMap.get(normalized);
    const cleanLabel = normalizeCellText(label);
    if (!existing) {
      const cls = classifyUrl(normalized);
      linkMap.set(normalized, {
        url: normalized,
        label: cleanLabel || normalized,
        kind: cls.kind,
        network: cls.network,
      });
    } else if ((!existing.label || existing.label === existing.url) && cleanLabel) {
      existing.label = cleanLabel;
    }
  };

  const bodyText = typeof text === "string" ? text : "";
  scanEmails(bodyText);
  scanPhones(bodyText);

  for (const match of bodyText.match(URL_IN_TEXT_RE) ?? []) {
    recordUrl(match);
  }

  if (Array.isArray(links)) {
    for (const entry of links) {
      const href = typeof entry === "string" ? entry : String(entry?.href ?? "");
      const label = typeof entry === "string" ? "" : String(entry?.text ?? "");

      if (/^mailto:/i.test(href.trim())) {
        const address = href.trim().slice(7).split("?")[0].trim().toLowerCase();
        if (isValidPublicEmail(address)) {
          emailSet.add(address);
        }
      } else if (/^tel:/i.test(href.trim())) {
        scanPhones(href.trim().slice(4));
      } else {
        recordUrl(href, label);
      }

      scanEmails(label);
    }
  }

  const allLinks = Array.from(linkMap.values());
  return {
    emails: Array.from(emailSet),
    phones: Array.from(phoneMap.values()),
    socialLinks: allLinks.filter((item) => item.kind === "social"),
    websiteLinks: allLinks.filter((item) => item.kind === "website"),
    allLinks,
  };
}

/**
 * Escape a single CSV value strictly per RFC 4180.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeCsvCell(value) {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize headers and rows into strict RFC 4180 CSV with optional UTF-8 BOM.
 * @param {Array<Array<unknown>|Record<string, unknown>>} rows
 * @param {Array<string>} headers
 * @param {{ includeBom?: boolean }} [options]
 * @returns {string}
 */
export function toCsv(rows, headers = [], { includeBom = true } = {}) {
  const lines = [];
  const headerList = Array.isArray(headers) ? headers : [];

  if (headerList.length > 0) {
    lines.push(headerList.map(escapeCsvCell).join(","));
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    if (Array.isArray(row)) {
      lines.push(row.map(escapeCsvCell).join(","));
    } else if (row && typeof row === "object") {
      const keys = headerList.length > 0 ? headerList : Object.keys(row);
      lines.push(keys.map((k) => escapeCsvCell(row[k])).join(","));
    }
  }

  const csvBody = lines.join("\r\n");
  return includeBom ? `\uFEFF${csvBody}` : csvBody;
}

/**
 * Compute deterministic 4-hex-digit FNV-1a folded checksum matching AutoShorts Studio.
 * @param {string} productCode
 * @param {string} payload
 * @returns {string}
 */
export function computeLicenseChecksum(productCode, payload) {
  const normProd = String(productCode ?? "").trim().toUpperCase();
  const normPayload = String(payload ?? "").trim().toUpperCase();
  if (!["AS", "WL", "BUNDLE"].includes(normProd)) {
    throw new Error(`Unsupported product code: ${productCode}`);
  }
  if (!/^[A-Z0-9]{8}$/.test(normPayload)) {
    throw new Error("License payload must be exactly 8 alphanumeric characters.");
  }

  const token = `FS-PRO-${normProd}-${normPayload}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const folded = ((h >>> 16) ^ (h & 0xffff)) & 0xffff;
  return folded.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Format a canonical license key string.
 * @param {string} productCode
 * @param {string} payload
 * @returns {string}
 */
export function formatLicenseKey(productCode, payload) {
  const normProd = String(productCode ?? "").trim().toUpperCase();
  const normPayload = String(payload ?? "").trim().toUpperCase();
  const checksum = computeLicenseChecksum(normProd, normPayload);
  return `FS-PRO-${normProd}-${normPayload}-${checksum}`;
}

/**
 * Offline validation for WebLead Extractor Pro (`FS-PRO-WL-...` or `FS-PRO-BUNDLE-...`).
 * @param {string | null | undefined} key
 * @param {Array<string>} [acceptedProducts]
 */
export function validateLicenseKey(key, acceptedProducts = ACCEPTED_PRODUCTS) {
  if (!key || typeof key !== "string" || !key.trim()) {
    return {
      isPro: false,
      tier: "community",
      productCode: null,
      maskedKey: null,
      rowLimit: FREE_ROW_LIMIT,
      allowRegexFilter: false,
      reason: "Community Free active (25 rows/table export limit).",
      upgradeUrl: PRICING_URL,
    };
  }

  const normalized = key.trim().toUpperCase();
  const match = LICENSE_KEY_RE.exec(normalized);
  if (!match) {
    return {
      isPro: false,
      tier: "community",
      productCode: null,
      maskedKey: null,
      rowLimit: FREE_ROW_LIMIT,
      allowRegexFilter: false,
      reason: "Invalid key format. Expected FS-PRO-WL-XXXXXXXX-XXXX or FS-PRO-BUNDLE-XXXXXXXX-XXXX.",
      upgradeUrl: PRICING_URL,
    };
  }

  const [, productCode, payload, providedChecksum] = match;
  if (payload === "00000000") {
    return {
      isPro: false,
      tier: "community",
      productCode: null,
      maskedKey: null,
      rowLimit: FREE_ROW_LIMIT,
      allowRegexFilter: false,
      reason: "Rejected placeholder license payload.",
      upgradeUrl: PRICING_URL,
    };
  }

  const expectedChecksum = computeLicenseChecksum(productCode, payload);
  if (providedChecksum !== expectedChecksum) {
    return {
      isPro: false,
      tier: "community",
      productCode: null,
      maskedKey: null,
      rowLimit: FREE_ROW_LIMIT,
      allowRegexFilter: false,
      reason: "License checksum mismatch.",
      upgradeUrl: PRICING_URL,
    };
  }

  if (!acceptedProducts.includes(productCode)) {
    return {
      isPro: false,
      tier: "community",
      productCode: null,
      maskedKey: null,
      rowLimit: FREE_ROW_LIMIT,
      allowRegexFilter: false,
      reason: `License key belongs to product '${productCode}', not WebLead Extractor.`,
      upgradeUrl: PRICING_URL,
    };
  }

  const label = productCode === "BUNDLE" ? "Suite Bundle Pro" : "WebLead Extractor Pro";
  return {
    isPro: true,
    tier: "pro",
    productCode,
    maskedKey: `FS-PRO-${productCode}-${payload.slice(0, 2)}******-${providedChecksum}`,
    rowLimit: null,
    allowRegexFilter: true,
    reason: `${label} unlocked (unlimited rows + regex filter).`,
    upgradeUrl: PRICING_URL,
  };
}

/**
 * Enforce Community Free 25-row cap or apply Pro unlimited export + optional regex filtering.
 * @param {Array<unknown>} rows
 * @param {boolean} [isPro]
 * @param {{ regexFilter?: string, limit?: number }} [options]
 */
export function applyTierLimit(rows, isPro = false, options = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const rawPattern = typeof options?.regexFilter === "string" ? options.regexFilter.trim() : "";
  const limit = Number.isFinite(options?.limit) ? Math.max(1, Number(options.limit)) : FREE_ROW_LIMIT;

  if (rawPattern && !isPro) {
    throw new Error(
      `Custom regex filtering requires WebLead Extractor Pro. Upgrade at ${PRICING_URL}`
    );
  }

  let filtered = sourceRows;
  let regexApplied = false;

  if (rawPattern && isPro) {
    const regex = new RegExp(rawPattern, "i");
    regexApplied = true;
    filtered = sourceRows.filter((row) => {
      if (Array.isArray(row)) {
        return row.some((cell) => regex.test(String(cell ?? "")));
      }
      if (row && typeof row === "object") {
        return Object.values(row).some((val) => regex.test(String(val ?? "")));
      }
      return regex.test(String(row ?? ""));
    });
  }

  if (isPro) {
    return {
      rows: filtered,
      totalCount: sourceRows.length,
      matchedCount: filtered.length,
      exportedCount: filtered.length,
      truncated: false,
      limit: null,
      regexApplied,
    };
  }

  const capped = filtered.slice(0, limit);
  return {
    rows: capped,
    totalCount: sourceRows.length,
    matchedCount: filtered.length,
    exportedCount: capped.length,
    truncated: filtered.length > limit,
    limit,
    regexApplied: false,
  };
}
