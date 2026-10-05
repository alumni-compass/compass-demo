"use client";

import { api, useMutation, useQuery } from "@/lib/standalone";

import { useRef, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import {
  Button,
  Card,
  Empty,
  Eyebrow,
  Pill,
  Stat,
  actionErrorMessage,
} from "@/components/kit";
import { formatDate } from "@/lib/site";

/**
 * Admin: import the association's student database from Excel.
 *
 * WHY THE BROWSER PARSES THE FILE. A Convex function has no filesystem and a
 * mutation argument is JSON, so the .xlsx has to be decoded somewhere else.
 * SheetJS runs here, turns the sheet into plain rows, and posts them.
 *
 * WHY THAT IS NOT A SECURITY HOLE. Nothing this component computes is trusted.
 * `roster.importRows` re-validates every cell server-side and is gated to the
 * admin role, so a hand-crafted request gets exactly the same treatment as a real
 * upload. The only thing the browser decides is which spreadsheet column feeds
 * which field, and it decides that from the sheet's own header text.
 *
 * COLUMNS ARE MATCHED BY HEADER, NOT POSITION. Both supplied files happen to use
 * the same order, but an association that inserts a column would otherwise
 * silently import addresses into the phone field. Matching on the header makes a
 * reordered sheet work and an unrecognised sheet fail loudly.
 *
 * THE WORKFLOW IS VALIDATE, FIX, IMPORT. Every one of the sixteen columns is
 * required, so a real sheet usually fails the first time. "Check the file" writes
 * nothing and returns the full list of problems with row numbers; the report
 * downloads as CSV so it can be worked through beside the spreadsheet.
 */

/** Rows per mutation call. Matches MAX_ROWS_PER_CALL in roster.ts. */
const CHUNK = 250;

/** The keys `roster.importRows` accepts, in the sheet's own order. */
const KEYS = [
  "slNo",
  "firstName",
  "middleName",
  "lastName",
  "personalEmail",
  "secondaryEmail",
  "phone",
  "secondaryPhone",
  "enrollmentNumber",
  "degree",
  "departmentRaw",
  "permanentAddress",
  "designation",
  "company",
  "yearOfPassing",
  "yearOfJoining",
] as const;

type Key = (typeof KEYS)[number];

/**
 * Header text → field, with the spellings the association actually uses plus the
 * obvious variants. Compared after `normalise`, so case, the `*` marker and
 * punctuation do not matter.
 */
const HEADER_ALIASES: Record<string, Key> = {
  "sl no": "slNo",
  slno: "slNo",
  "s no": "slNo",
  "serial no": "slNo",
  "first name": "firstName",
  "middle name": "middleName",
  "last name": "lastName",
  "email personal email id": "personalEmail",
  "personal email id": "personalEmail",
  "personal email": "personalEmail",
  email: "personalEmail",
  "secondary email id": "secondaryEmail",
  "secondary email": "secondaryEmail",
  "phone number": "phone",
  phone: "phone",
  "mobile number": "phone",
  "secondary phone no": "secondaryPhone",
  "secondary phone": "secondaryPhone",
  "enrollment number": "enrollmentNumber",
  "enrolment number": "enrollmentNumber",
  "roll number": "enrollmentNumber",
  "register number": "enrollmentNumber",
  degree: "degree",
  department: "departmentRaw",
  branch: "departmentRaw",
  "permanent address": "permanentAddress",
  address: "permanentAddress",
  designation: "designation",
  company: "company",
  "year of passing": "yearOfPassing",
  "year of joining": "yearOfJoining",
};

function normalise(header: unknown) {
  return String(header ?? "")
    .replace(/\*/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** A cell as a trimmed string. Dates and numbers arrive typed; text is wanted. */
function cell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return String(value.getUTCFullYear());
  return String(value).trim().replace(/\s+/g, " ");
}

type ParsedRow = { rowNumber: number } & Partial<Record<Key, string>>;
type Problem = { rowNumber: number; column: string; problem: string };

type Parsed = {
  fileName: string;
  sheetName: string;
  rows: ParsedRow[];
  /** Which sheet column index feeds each field. */
  mapping: Array<{ header: string; key: Key | null }>;
  missingColumns: string[];
  headerRow: number;
};

/**
 * Finds the header row and builds the column mapping.
 *
 * The header is located by looking for the row that mentions an enrollment
 * number, rather than assuming row 1 — a sheet with a title banner above the
 * table is common and would otherwise map every column to nothing.
 */
function parseSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  fileName: string,
): Parsed {
  const sheet = workbook.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false,
  });

  let headerRow = -1;
  for (let i = 0; i < Math.min(grid.length, 12); i += 1) {
    const cells = (grid[i] ?? []).map(normalise);
    if (cells.some((c) => c.includes("enrollment") || c.includes("enrolment") || c.includes("roll number"))) {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) headerRow = 0;

  const headers = (grid[headerRow] ?? []).map((h) => String(h ?? "").trim());
  const mapping = headers.map((header) => ({
    header,
    key: HEADER_ALIASES[normalise(header)] ?? null,
  }));

  const found = new Set(mapping.map((m) => m.key).filter(Boolean) as Key[]);
  const missingColumns = KEYS.filter((k) => !found.has(k));

  const rows: ParsedRow[] = [];
  for (let i = headerRow + 1; i < grid.length; i += 1) {
    const line = grid[i] ?? [];
    const row: ParsedRow = { rowNumber: i + 1 };
    let any = false;
    mapping.forEach((column, index) => {
      if (!column.key) return;
      const text = cell(line[index]);
      if (text.length > 0) any = true;
      row[column.key] = text;
    });
    if (any) rows.push(row);
  }

  return { fileName, sheetName, rows, mapping, missingColumns, headerRow: headerRow + 1 };
}

function downloadCsv(name: string, header: string[], lines: string[][]) {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const body = [header, ...lines].map((line) => line.map(escape).join(",")).join("\r\n");
  const url = URL.createObjectURL(
    new Blob([`﻿${body}`], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function RosterImport() {
  const importRows = useMutation(api.roster.importRows);
  const recordBatch = useMutation(api.roster.recordImportBatch);
  const undoImport = useMutation(api.roster.undoImport);
  const format = useQuery(api.roster.importFormat);
  const history = useQuery(api.roster.importHistory);

  const fileInput = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [busy, setBusy] = useState<"idle" | "checking" | "importing">("idle");
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<{
    dryRun: boolean;
    rowsSeen: number;
    imported: number;
    updated: number;
    rejected: number;
    problems: Problem[];
  } | null>(null);

  async function onFile(file: File) {
    setReport(null);
    setParsed(null);
    try {
      const buffer = await file.arrayBuffer();
      const book = XLSX.read(buffer, { cellDates: true });
      if (book.SheetNames.length === 0) {
        toast.error("That workbook has no sheets in it.");
        return;
      }
      setWorkbook(book);
      setSheetNames(book.SheetNames);
      const first = book.SheetNames[0]!;
      setParsed(parseSheet(book, first, file.name));
    } catch (error) {
      toast.error(
        `That file could not be read as a spreadsheet. ${
          error instanceof Error ? error.message : ""
        }`.trim(),
      );
    }
  }

  /** Sends the parsed rows in chunks. `dryRun` writes nothing. */
  async function send(dryRun: boolean) {
    if (!parsed) return;
    if (parsed.rows.length === 0) {
      toast.error("That sheet has a header but no data rows.");
      return;
    }

    setBusy(dryRun ? "checking" : "importing");
    setProgress(0);
    setReport(null);

    // A stamp rather than a random id: Math.random is fine in a browser, but a
    // readable batch id is what makes the history table and `undoImport` usable.
    const batchId = `${parsed.fileName}-${parsed.sheetName}-${Date.now()}`;
    const totals = { rowsSeen: 0, imported: 0, updated: 0, rejected: 0 };
    const problems: Problem[] = [];

    try {
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        const chunk = parsed.rows.slice(i, i + CHUNK);
        const result = await importRows({
          importBatchId: batchId,
          fileName: parsed.fileName,
          sheetName: parsed.sheetName,
          rows: chunk,
          dryRun,
        });
        totals.rowsSeen += result.rowsSeen;
        totals.imported += result.imported;
        totals.updated += result.updated;
        totals.rejected += result.rejected;
        problems.push(...result.problems);
        setProgress(Math.min(i + CHUNK, parsed.rows.length));
      }

      // Recorded even for a dry run, so the association has a trail of who
      // checked what and when.
      await recordBatch({ batchId, ...totals, fileName: parsed.fileName, sheetName: parsed.sheetName, dryRun });

      setReport({ dryRun, ...totals, problems });
      if (dryRun) {
        toast.success(
          totals.rejected === 0
            ? `All ${totals.rowsSeen} rows pass. Import is safe to run.`
            : `${totals.rejected} of ${totals.rowsSeen} rows would be rejected.`,
        );
      } else {
        toast.success(
          `${totals.imported} added, ${totals.updated} updated, ${totals.rejected} rejected.`,
        );
      }
    } catch (error) {
      toast.error(actionErrorMessage(error));
    } finally {
      setBusy("idle");
    }
  }

  const unknownColumns = (parsed?.mapping ?? []).filter(
    (column) => column.key === null && column.header.trim().length > 0,
  );

  return (
    <div className="space-y-6">
      {/* ---- The format the association must use ------------------------ */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Eyebrow>Import format</Eyebrow>
          <Pill tone="maroon">All 16 columns required</Pill>
        </div>
        <p className="mt-3 max-w-3xl text-[0.9rem] leading-relaxed text-slate-ink">
          The sixteen columns below are the header of the association&rsquo;s own
          student database files. Every one of them is required: a row with any
          blank cell is rejected and named in the report. Columns are matched by
          their header text, so the order in the sheet does not matter.
        </p>
        <div className="mt-5 flex flex-wrap gap-1.5">
          {(format?.columns ?? []).map((column) => (
            <Pill key={column.key} tone={column.required ? "maroon" : "quiet"}>
              {column.header}
            </Pill>
          ))}
        </div>
        <p className="mt-4 text-[0.82rem] leading-relaxed text-slate-soft">
          College addresses are derived as{" "}
          <code className="font-mono">
            &lt;enrollment number&gt;@{format?.collegeEmailDomain ?? "…"}
          </code>{" "}
          — neither supplied file carries one. Members can search on it, on a name,
          or on the roll number.
        </p>
      </Card>

      {/* ---- Pick a file ------------------------------------------------ */}
      <Card>
        <Eyebrow>Choose a file</Eyebrow>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <Button onClick={() => fileInput.current?.click()}>
            Select spreadsheet
          </Button>
          {parsed ? (
            <span className="font-mono text-[0.78rem] text-ink">
              {parsed.fileName}
            </span>
          ) : (
            <span className="text-[0.85rem] text-slate-ink">
              .xlsx, .xls or .csv
            </span>
          )}
        </div>

        {sheetNames.length > 1 && workbook && parsed ? (
          <div className="mt-5">
            <label
              htmlFor="sheet-pick"
              className="font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink"
            >
              Sheet
            </label>
            <select
              id="sheet-pick"
              value={parsed.sheetName}
              onChange={(event) =>
                setParsed(
                  parseSheet(workbook, event.target.value, parsed.fileName),
                )
              }
              className="font-mono mt-2 rounded-control border border-line bg-surface px-3 py-2 text-[0.8rem] text-ink"
            >
              {sheetNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {parsed ? (
          <>
            <div className="mt-6 grid grid-cols-2 gap-6 border-t border-line pt-5 sm:grid-cols-4">
              <Stat value={parsed.rows.length} label="Data rows found" />
              <Stat value={parsed.headerRow} label="Header on row" />
              <Stat
                value={KEYS.length - parsed.missingColumns.length}
                label="Columns matched"
              />
              <Stat value={parsed.missingColumns.length} label="Columns missing" />
            </div>

            {parsed.missingColumns.length > 0 ? (
              <div className="mt-5 rounded-card border border-maroon/30 bg-maroon-tint p-5">
                <Eyebrow>Missing columns</Eyebrow>
                <p className="mt-2 text-[0.875rem] leading-relaxed text-ink">
                  This sheet has no column matching{" "}
                  {parsed.missingColumns
                    .map((key) => KEYS.indexOf(key as Key))
                    .map((i) => format?.columns[i]?.header ?? KEYS[i])
                    .join(", ")}
                  . Every row will be rejected until the column is present, because
                  all sixteen are required.
                </p>
              </div>
            ) : null}

            {unknownColumns.length > 0 ? (
              <p className="mt-4 text-[0.82rem] leading-relaxed text-slate-ink">
                Ignored, because nothing in the import format matches them:{" "}
                {unknownColumns.map((c) => `"${c.header}"`).join(", ")}.
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-5">
              <Button
                onClick={() => void send(true)}
                disabled={busy !== "idle"}
                variant="outline"
              >
                {busy === "checking" ? "Checking…" : "Check the file"}
              </Button>
              <Button
                onClick={() => void send(false)}
                disabled={busy !== "idle" || parsed.rows.length === 0}
              >
                {busy === "importing" ? "Importing…" : "Import for real"}
              </Button>
              {busy !== "idle" ? (
                <span className="font-mono self-center text-[0.75rem] tabular-nums text-slate-ink">
                  {progress}/{parsed.rows.length}
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-[0.8rem] leading-relaxed text-slate-ink">
              &ldquo;Check the file&rdquo; writes nothing. Run it first — with all
              sixteen columns required, a sheet usually needs a pass of filling in
              before anything imports.
            </p>
          </>
        ) : null}
      </Card>

      {/* ---- The report ------------------------------------------------- */}
      {report ? (
        <Card accent>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
            <Eyebrow>{report.dryRun ? "Check result" : "Import result"}</Eyebrow>
            {report.rejected === 0 ? (
              <Pill tone="jade">Every row passes</Pill>
            ) : (
              <Pill tone="maroon">{report.rejected} rejected</Pill>
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat value={report.rowsSeen} label="Rows read" />
            <Stat
              value={report.imported}
              label={report.dryRun ? "Would be added" : "Added"}
            />
            <Stat
              value={report.updated}
              label={report.dryRun ? "Would be updated" : "Updated"}
            />
            <Stat value={report.rejected} label="Rejected" />
          </div>

          {report.problems.length === 0 ? (
            <p className="mt-6 text-[0.9rem] leading-relaxed text-ink">
              No problems found.{" "}
              {report.dryRun
                ? "Run the import for real when you are ready."
                : "The roster is up to date."}
            </p>
          ) : (
            <>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[0.9rem] leading-relaxed text-ink">
                  {report.problems.length} problem
                  {report.problems.length === 1 ? "" : "s"} across{" "}
                  {new Set(report.problems.map((p) => p.rowNumber)).size} row
                  {new Set(report.problems.map((p) => p.rowNumber)).size === 1
                    ? ""
                    : "s"}
                  . Fix them in the spreadsheet and check it again.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    downloadCsv(
                      `import-problems-${parsed?.sheetName ?? "sheet"}.csv`,
                      ["Sheet row", "Column", "Problem"],
                      report.problems.map((p) => [
                        String(p.rowNumber),
                        p.column,
                        p.problem,
                      ]),
                    )
                  }
                >
                  Download report
                </Button>
              </div>

              {/* Capped display, full CSV. A 234-row file with four blank
                  columns produces ~900 problems, which no one reads on screen. */}
              <div className="mt-4 max-h-80 overflow-auto rounded-card border border-line">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 bg-bone">
                    <tr>
                      {["Row", "Column", "Problem"].map((head) => (
                        <th
                          key={head}
                          className="font-mono border-b border-line px-3 py-2 text-[0.65rem] uppercase tracking-[0.1em] text-slate-ink"
                        >
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.problems.slice(0, 200).map((problem, index) => (
                      <tr key={index} className="odd:bg-surface even:bg-bone/40">
                        <td className="font-mono border-b border-line px-3 py-2 text-[0.75rem] tabular-nums text-ink">
                          {problem.rowNumber}
                        </td>
                        <td className="border-b border-line px-3 py-2 text-[0.78rem] text-ink">
                          {problem.column}
                        </td>
                        <td className="border-b border-line px-3 py-2 text-[0.78rem] text-slate-ink">
                          {problem.problem}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.problems.length > 200 ? (
                <p className="mt-3 text-[0.8rem] text-slate-ink">
                  Showing the first 200. The downloaded report has all{" "}
                  {report.problems.length}.
                </p>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {/* ---- History ---------------------------------------------------- */}
      <Card>
        <Eyebrow>Recent uploads</Eyebrow>
        {history === undefined ? (
          <p className="mt-3 text-[0.85rem] text-slate-ink">Loading…</p>
        ) : history.length === 0 ? (
          <div className="mt-4">
            <Empty
              title="Nothing has been imported yet."
              hint="Upload one of the association's department files to get started."
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {history.map((batch) => (
              <li
                key={batch._id}
                className="flex flex-wrap items-center justify-between gap-3 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-[0.875rem] text-ink">
                    {batch.fileName}
                    <span className="text-slate-ink"> · {batch.sheetName}</span>
                  </p>
                  <p className="font-mono mt-0.5 text-[0.7rem] tabular-nums text-slate-ink">
                    {formatDate(batch.createdAt)} · {batch.imported} added ·{" "}
                    {batch.updated} updated · {batch.rejected} rejected
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {batch.dryRun ? (
                    <Pill>Check only</Pill>
                  ) : (
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => {
                        void undoImport({ batchId: batch.batchId })
                          .then((result) =>
                            toast.success(`Removed ${result.deleted} rows.`),
                          )
                          .catch((error) => toast.error(actionErrorMessage(error)));
                      }}
                    >
                      Undo
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[0.8rem] leading-relaxed text-slate-soft">
          Undo deletes the rows carrying that upload&rsquo;s id. For a re-upload
          that corrected existing students, that removes the corrected rows too —
          there is no per-row history to restore from.
        </p>
      </Card>
    </div>
  );
}
