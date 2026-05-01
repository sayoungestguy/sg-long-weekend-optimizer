/**
 * Fetches Singapore public holidays from data.gov.sg and writes them to
 * src/data/holidays-sg.json. Re-run when a new year is released.
 *
 * Dataset: d_8ef23381f9417e4d4254ee8b4dcdb176 (covers 2020–2026)
 *
 * data.gov.sg uses an async poll-download flow:
 *   1. POST/GET /v1/public/api/datasets/{id}/poll-download → returns a download URL
 *   2. GET that URL → returns CSV
 *
 * If the API contract has changed since this was written, check
 * https://guide.data.gov.sg/developer-guide/dataset-apis
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATASET_ID = "d_8ef23381f9417e4d4254ee8b4dcdb176";
const POLL_URL = `https://api-open.data.gov.sg/v1/public/api/datasets/${DATASET_ID}/poll-download`;

type Holiday = {
  date: string;
  name: string;
  year: number;
  dayOfWeek: number;
};

async function pollDownloadUrl(): Promise<string> {
  const res = await fetch(POLL_URL);
  if (!res.ok) {
    throw new Error(`poll-download failed: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  const url = body?.data?.url;
  if (!url) {
    throw new Error(`poll-download returned no url. Body: ${JSON.stringify(body)}`);
  }
  return url;
}

async function fetchCsv(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`csv fetch failed: ${res.status}`);
  return res.text();
}

function parseCsv(csv: string): Holiday[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]!.split(",").map((s) => s.trim().toLowerCase());
  const dateIdx = header.indexOf("date");
  const nameIdx = header.indexOf("holiday");

  if (dateIdx === -1 || nameIdx === -1) {
    throw new Error(
      `unexpected CSV header: ${header.join(",")} — expected 'date' and 'holiday' columns`,
    );
  }

  return lines
    .slice(1)
    .map((line) => {
      const cols = line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
      const date = cols[dateIdx] ?? "";
      const name = cols[nameIdx] ?? "";
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      const d = new Date(date + "T00:00:00Z");
      return {
        date,
        name,
        year: d.getUTCFullYear(),
        dayOfWeek: d.getUTCDay(),
      };
    })
    .filter((h): h is Holiday => h !== null);
}

async function main() {
  console.log(`Polling ${POLL_URL} ...`);
  const downloadUrl = await pollDownloadUrl();
  console.log(`Got download URL, fetching CSV ...`);
  const csv = await fetchCsv(downloadUrl);
  const holidays = parseCsv(csv);

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, "../src/data/holidays-sg.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(holidays, null, 2) + "\n");

  const years = [...new Set(holidays.map((h) => h.year))].sort();
  console.log(`Wrote ${holidays.length} holidays for years ${years.join(", ")} → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
