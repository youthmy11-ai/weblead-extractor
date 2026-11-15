import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FREE_ROW_LIMIT,
  applyTierLimit,
  computeLicenseChecksum,
  extractContactsAndLinks,
  extractTablesFromModel,
  formatLicenseKey,
  isValidPublicEmail,
  toCsv,
  validateLicenseKey,
} from "../src/extractor_core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

test("extractTablesFromModel expands colspan horizontally and normalizes whitespace", () => {
  const tables = extractTablesFromModel([
    {
      name: "  Q4   Revenue  ",
      rows: [
        [
          { text: "Region", isHeader: true },
          { text: "Contact   Channels", colspan: 2, isHeader: true },
          { text: "ARR", isHeader: true },
        ],
        [
          { text: " North\nAmerica " },
          { text: "sales@acme.com" },
          { text: "+1 (415) 555-0199" },
          { text: "$120,000" },
        ],
        [
          { text: "EMEA" },
          { text: "N/A", colspan: 2 },
          { text: "$85,000" },
        ],
      ],
    },
  ]);

  assert.equal(tables.length, 1);
  assert.equal(tables[0].name, "Q4 Revenue");
  assert.equal(tables[0].columnCount, 4);
  assert.deepEqual(tables[0].headers, [
    "Region",
    "Contact Channels",
    "Contact Channels",
    "ARR",
  ]);
  assert.deepEqual(tables[0].rows, [
    ["North America", "sales@acme.com", "+1 (415) 555-0199", "$120,000"],
    ["EMEA", "N/A", "N/A", "$85,000"],
  ]);
});

test("toCsv enforces RFC 4180 escaping for quotes, commas, newlines, and UTF-8 BOM", () => {
  const headers = ["Name", "Notes", "Revenue"];
  const rows = [
    ['Alice "A." Smith', "Line 1\nLine 2, Urgent", "$1,250"],
    ["Bob", "Clean", "900"],
  ];

  const withBom = toCsv(rows, headers, { includeBom: true });
  assert.ok(withBom.startsWith("\uFEFF"));
  assert.equal(
    withBom,
    '\uFEFFName,Notes,Revenue\r\n"Alice ""A."" Smith","Line 1\nLine 2, Urgent","$1,250"\r\nBob,Clean,900'
  );

  const withoutBom = toCsv(rows, headers, { includeBom: false });
  assert.ok(!withoutBom.startsWith("\uFEFF"));
  assert.equal(
    withoutBom,
    'Name,Notes,Revenue\r\n"Alice ""A."" Smith","Line 1\nLine 2, Urgent","$1,250"\r\nBob,Clean,900'
  );
});

test("extractContactsAndLinks filters @2x.png asset false positives and deduplicates leads", () => {
  assert.equal(isValidPublicEmail("logo@2x.png"), false);
  assert.equal(isValidPublicEmail("hero@3x.webp"), false);
  assert.equal(isValidPublicEmail("bundle@1.2.js"), false);
  assert.equal(isValidPublicEmail("founder@example.com"), true);

  const text = `
    Reach us at Sales@Example.com or support@acme-corp.io.
    Ignore retina sprites logo@2x.png, badge@3x.svg, icon@2x.jpg, style@1.css.
    Office: +1 (415) 867-5309 | Date: 2026-11-15
    Visit https://acme-corp.io/pricing or https://www.linkedin.com/company/acme
  `;

  const links = [
    { href: "mailto:sales@example.com?subject=Hello", text: "Email Sales" },
    { href: "mailto:press@acme-corp.io", text: "press@acme-corp.io" },
    { href: "https://github.com/acme-org", text: "GitHub" },
    { href: "https://acme-corp.io/pricing", text: "Pricing" },
  ];

  const result = extractContactsAndLinks(text, links);
  assert.deepEqual(result.emails, [
    "sales@example.com",
    "support@acme-corp.io",
    "press@acme-corp.io",
  ]);
  assert.deepEqual(result.phones, ["+1 (415) 867-5309"]);
  assert.equal(result.socialLinks.length, 2);
  assert.equal(result.websiteLinks.length, 1);
  assert.equal(result.websiteLinks[0].url, "https://acme-corp.io/pricing");
});

test("applyTierLimit and validateLicenseKey enforce Free 25-row cap and Pro checksum unlock", () => {
  const rows = Array.from({ length: 40 }, (_, i) => [
    `Lead ${i + 1}`,
    i % 2 === 0 ? `eng${i}@acme.io` : `sales${i}@other.org`,
  ]);

  const freeLimited = applyTierLimit(rows, false);
  assert.equal(freeLimited.exportedCount, FREE_ROW_LIMIT);
  assert.equal(freeLimited.rows.length, 25);
  assert.equal(freeLimited.truncated, true);
  assert.equal(freeLimited.totalCount, 40);

  assert.throws(
    () => applyTierLimit(rows, false, { regexFilter: "acme\\.io" }),
    /Pro/i
  );

  const wlKey = formatLicenseKey("WL", "AB12CD34");
  const bundleKey = formatLicenseKey("BUNDLE", "99FF00AA");
  const asKey = formatLicenseKey("AS", "AB12CD34");

  assert.equal(validateLicenseKey(wlKey).isPro, true);
  assert.equal(validateLicenseKey(bundleKey.toLowerCase()).isPro, true);
  assert.equal(validateLicenseKey(asKey).isPro, false);
  assert.equal(validateLicenseKey(wlKey.slice(0, -1) + (wlKey.endsWith("0") ? "1" : "0")).isPro, false);
  assert.equal(validateLicenseKey(formatLicenseKey("WL", "00000000")).isPro, false);
  assert.equal(validateLicenseKey("").isPro, false);

  // Known deterministic checksum check (shared algorithm with Python license.py)
  assert.equal(computeLicenseChecksum("WL", "AB12CD34").length, 4);

  const proFiltered = applyTierLimit(rows, true, { regexFilter: "@acme\\.io$" });
  assert.equal(proFiltered.truncated, false);
  assert.equal(proFiltered.exportedCount, 20);
  assert.equal(proFiltered.regexApplied, true);

  const proAll = applyTierLimit(rows, true);
  assert.equal(proAll.exportedCount, 40);
  assert.equal(proAll.truncated, false);
});

test("manifest.json and MV3 PNG icons exist and are valid", () => {
  const manifestPath = path.join(ROOT_DIR, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("activeTab"));

  for (const relIcon of Object.values(manifest.icons)) {
    const iconPath = path.join(ROOT_DIR, relIcon);
    assert.ok(fs.existsSync(iconPath), `Missing icon: ${relIcon}`);
    const bytes = fs.readFileSync(iconPath);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
});
