import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireRole } from "./authz";
import { DEPARTMENTS } from "./schema";

/**
 * The student roster — the association's Excel import.
 *
 * THE FORMAT IS THE ASSOCIATION'S OWN, NOT INVENTED HERE. Both spreadsheets
 * supplied ("AIDS - Database 2022-2026 Batch Format.xlsx" and "CSE - Student
 * Database (2022-26 Batch).xlsx") carry the identical 16-column header, so that
 * header is the contract. `COLUMNS` below is a transcription of it, `*` and all.
 *
 * WHERE PARSING HAPPENS. The browser reads the .xlsx (SheetJS cannot run in a
 * Convex function, and a file upload is not a mutation argument) and sends plain
 * rows here. VALIDATION IS ENTIRELY SERVER-SIDE regardless: a client could post
 * any rows it liked, so nothing here trusts that the browser checked anything.
 * The browser's own pre-check is a convenience, never the gate.
 *
 * EVERY COLUMN IS REQUIRED. That is the association's instruction, taken
 * literally: a row missing any of the sixteen values is rejected, and the report
 * names the row and the columns. It is worth being blunt about the consequence,
 * because the two files as they stand do not satisfy it — `Middle Name` and
 * `Secondary Email ID` are blank in all 234 rows, `Designation` in 222 and
 * `Company` in 202 — so a strict import of them today accepts nothing. That is
 * the specified behaviour, not a defect. Run `validateOnly` first, fill the gaps
 * the report names, then import. If the association later decides some columns
 * are genuinely optional, move them out of `REQUIRED_COLUMNS` — that one list is
 * the only thing that decides.
 */

/** The sheet's own header, column for column. `required` mirrors the `*`. */
export const COLUMNS = [
  { key: "slNo", header: "Sl.No" },
  { key: "firstName", header: "First Name*" },
  { key: "middleName", header: "Middle Name" },
  { key: "lastName", header: "Last Name*" },
  { key: "personalEmail", header: "Email (Personal Email Id)*" },
  { key: "secondaryEmail", header: "Secondary Email ID" },
  { key: "phone", header: "Phone Number*" },
  { key: "secondaryPhone", header: "Secondary Phone No" },
  { key: "enrollmentNumber", header: "Enrollment Number*" },
  { key: "degree", header: "Degree*" },
  { key: "departmentRaw", header: "Department*" },
  { key: "permanentAddress", header: "Permanent Address" },
  { key: "designation", header: "Designation" },
  { key: "company", header: "Company" },
  { key: "yearOfPassing", header: "Year of Passing*" },
  { key: "yearOfJoining", header: "Year of Joining*" },
] as const;

export type ColumnKey = (typeof COLUMNS)[number]["key"];

/**
 * Which columns a row must carry to be accepted.
 *
 * All sixteen, by instruction. This single list is the whole policy — nothing
 * else in this file decides whether a value may be blank.
 */
const REQUIRED_COLUMNS: readonly ColumnKey[] = COLUMNS.map((c) => c.key);

const HEADER_BY_KEY = Object.fromEntries(
  COLUMNS.map((c) => [c.key, c.header]),
) as Record<ColumnKey, string>;

/**
 * The college address is DERIVED from the enrollment number, because neither
 * spreadsheet carries one — `Secondary Email ID` is blank in all 234 rows.
 * Change this constant if the institute's convention differs; nothing else
 * depends on the pattern, and search matches the enrollment number directly
 * anyway, so a wrong domain here cannot make a student unfindable.
 */
const COLLEGE_EMAIL_DOMAIN = "ritrjpm.ac.in";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Indian mobile numbers as the sheets record them: exactly ten digits. */
const PHONE_RE = /^\d{10}$/;
const ENROLLMENT_RE = /^\d{6,15}$/;

/** Rows accepted per mutation call. The browser chunks a large sheet. */
const MAX_ROWS_PER_CALL = 250;
const MAX_CELL = 400;

/**
 * The sheet's department spellings, mapped onto the portal's codes.
 *
 * Both observed values are here; anything else is reported as an unknown
 * department rather than guessed at, because filing a student under the wrong
 * department silently is worse than refusing the row.
 */
const DEPARTMENT_ALIASES: Record<string, string> = {
  "AI&DS": "AIDS",
  "AI & DS": "AIDS",
  AIDS: "AIDS",
  "ARTIFICIAL INTELLIGENCE AND DATA SCIENCE": "AIDS",
  "COMPUTER SCIENCE AND ENGINEERING": "CSE",
  CSE: "CSE",
  "INFORMATION TECHNOLOGY": "IT",
  IT: "IT",
  "ELECTRONICS AND COMMUNICATION ENGINEERING": "ECE",
  ECE: "ECE",
  "ELECTRICAL AND ELECTRONICS ENGINEERING": "EEE",
  EEE: "EEE",
  "MECHANICAL ENGINEERING": "MECH",
  MECH: "MECH",
  "CIVIL ENGINEERING": "CIVIL",
  CIVIL: "CIVIL",
};

function normaliseDepartment(raw: string): string | null {
  const key = raw.trim().toUpperCase().replace(/\s+/g, " ");
  const mapped = DEPARTMENT_ALIASES[key];
  if (mapped) return mapped;
  if ((DEPARTMENTS as readonly string[]).includes(key)) return key;
  return null;
}

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim().replace(/\s+/g, " ");
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

/** One incoming spreadsheet row, as the browser read it. */
const rowValidator = v.object({
  /** 1-based row number in the sheet, so a report can point at it. */
  rowNumber: v.number(),
  slNo: v.optional(v.string()),
  firstName: v.optional(v.string()),
  middleName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  personalEmail: v.optional(v.string()),
  secondaryEmail: v.optional(v.string()),
  phone: v.optional(v.string()),
  secondaryPhone: v.optional(v.string()),
  enrollmentNumber: v.optional(v.string()),
  degree: v.optional(v.string()),
  departmentRaw: v.optional(v.string()),
  permanentAddress: v.optional(v.string()),
  designation: v.optional(v.string()),
  company: v.optional(v.string()),
  yearOfPassing: v.optional(v.string()),
  yearOfJoining: v.optional(v.string()),
});

type IncomingRow = {
  rowNumber: number;
} & Partial<Record<ColumnKey, string>>;

type RowProblem = { rowNumber: number; column: string; problem: string };

/**
 * Validates one row and, when it passes, returns the document to write.
 *
 * Blank-check first, then format. That order matters for the report: a row with
 * four empty cells should say so once per cell rather than complaining that an
 * empty string is not a valid email address.
 */
export function checkRow(row: IncomingRow) {
  const problems: RowProblem[] = [];
  const value = (key: ColumnKey) => text(row[key]);

  for (const key of REQUIRED_COLUMNS) {
    if (value(key).length === 0) {
      problems.push({
        rowNumber: row.rowNumber,
        column: HEADER_BY_KEY[key],
        problem: "required, but this cell is empty",
      });
    }
  }

  for (const key of COLUMNS.map((c) => c.key)) {
    if (value(key).length > MAX_CELL) {
      problems.push({
        rowNumber: row.rowNumber,
        column: HEADER_BY_KEY[key],
        problem: `longer than ${MAX_CELL} characters`,
      });
    }
  }

  const personalEmail = lower(row.personalEmail);
  if (personalEmail.length > 0 && !EMAIL_RE.test(personalEmail)) {
    problems.push({
      rowNumber: row.rowNumber,
      column: HEADER_BY_KEY.personalEmail,
      problem: `"${personalEmail}" is not a valid email address`,
    });
  }

  const secondaryEmail = lower(row.secondaryEmail);
  if (secondaryEmail.length > 0 && !EMAIL_RE.test(secondaryEmail)) {
    problems.push({
      rowNumber: row.rowNumber,
      column: HEADER_BY_KEY.secondaryEmail,
      problem: `"${secondaryEmail}" is not a valid email address`,
    });
  }

  /*
   * Six cells across the two supplied files hold two numbers separated by a
   * space ("8838643099 9488001132"). That is rejected rather than split: which
   * of the two is the student's own is not ours to decide, and guessing would
   * put a stranger's number on a member's record.
   */
  const phone = text(row.phone).replace(/[\s-]/g, "");
  if (text(row.phone).length > 0 && !PHONE_RE.test(phone)) {
    problems.push({
      rowNumber: row.rowNumber,
      column: HEADER_BY_KEY.phone,
      problem: /\s/.test(text(row.phone))
        ? `"${text(row.phone)}" looks like two numbers in one cell — keep one, and put the other in "${HEADER_BY_KEY.secondaryPhone}"`
        : `"${text(row.phone)}" is not a ten-digit number`,
    });
  }

  const secondaryPhone = text(row.secondaryPhone).replace(/[\s-]/g, "");
  if (text(row.secondaryPhone).length > 0 && !PHONE_RE.test(secondaryPhone)) {
    problems.push({
      rowNumber: row.rowNumber,
      column: HEADER_BY_KEY.secondaryPhone,
      problem: `"${text(row.secondaryPhone)}" is not a ten-digit number`,
    });
  }

  const enrollmentNumber = text(row.enrollmentNumber);
  if (enrollmentNumber.length > 0 && !ENROLLMENT_RE.test(enrollmentNumber)) {
    problems.push({
      rowNumber: row.rowNumber,
      column: HEADER_BY_KEY.enrollmentNumber,
      problem: `"${enrollmentNumber}" should be digits only`,
    });
  }

  const departmentRaw = text(row.departmentRaw);
  const department = departmentRaw ? normaliseDepartment(departmentRaw) : null;
  if (departmentRaw.length > 0 && department === null) {
    problems.push({
      rowNumber: row.rowNumber,
      column: HEADER_BY_KEY.departmentRaw,
      problem: `"${departmentRaw}" is not a department this portal knows. Expected one of: ${DEPARTMENTS.join(", ")}`,
    });
  }

  const thisYear = new Date().getUTCFullYear();
  function year(key: "yearOfPassing" | "yearOfJoining") {
    const raw = text(row[key]);
    if (raw.length === 0) return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1980 || n > thisYear + 8) {
      problems.push({
        rowNumber: row.rowNumber,
        column: HEADER_BY_KEY[key],
        problem: `"${raw}" is not a year between 1980 and ${thisYear + 8}`,
      });
      return null;
    }
    return n;
  }
  const yearOfPassing = year("yearOfPassing");
  const yearOfJoining = year("yearOfJoining");

  if (
    yearOfPassing !== null &&
    yearOfJoining !== null &&
    yearOfPassing <= yearOfJoining
  ) {
    problems.push({
      rowNumber: row.rowNumber,
      column: HEADER_BY_KEY.yearOfPassing,
      problem: `passing year ${yearOfPassing} must be after joining year ${yearOfJoining}`,
    });
  }

  if (problems.length > 0) return { ok: false as const, problems };

  const firstName = value("firstName");
  const middleName = value("middleName");
  const lastName = value("lastName");
  const fullName = [firstName, middleName, lastName]
    .filter((part) => part.length > 0)
    .join(" ");
  const collegeEmail = `${enrollmentNumber}@${COLLEGE_EMAIL_DOMAIN}`;
  const slNoNumber = Number(value("slNo"));

  return {
    ok: true as const,
    doc: {
      slNo: Number.isInteger(slNoNumber) ? slNoNumber : undefined,
      firstName,
      middleName,
      lastName,
      personalEmail,
      secondaryEmail,
      phone,
      secondaryPhone,
      enrollmentNumber,
      degree: value("degree"),
      departmentRaw,
      department: department!,
      permanentAddress: value("permanentAddress"),
      designation: value("designation"),
      company: value("company"),
      yearOfPassing: yearOfPassing!,
      yearOfJoining: yearOfJoining!,
      collegeEmail,
      fullName,
      // Everything one search box has to match, in one indexed field.
      searchText: [
        fullName,
        enrollmentNumber,
        personalEmail,
        secondaryEmail,
        collegeEmail,
      ]
        .filter((part) => part.length > 0)
        .join(" "),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Import                                                             */
/* ------------------------------------------------------------------ */

/**
 * Validates a chunk of rows and, unless `dryRun`, writes them.
 *
 * Admin only. The roster is the association's record of who studied at the
 * institute and carries a personal address, a phone number and a home address
 * for every student, so writing to it is the most privileged thing in the portal
 * after granting a role.
 *
 * Idempotent on `enrollmentNumber`: re-uploading a corrected sheet updates the
 * existing rows rather than duplicating the cohort. That is the behaviour a
 * strict importer needs — the expected workflow is validate, fix the sheet,
 * upload again, and a second upload must not double the roster.
 */
export const importRows = mutation({
  args: {
    /** Groups this chunk with the rest of the same upload. */
    importBatchId: v.string(),
    fileName: v.string(),
    sheetName: v.string(),
    rows: v.array(rowValidator),
    /** True to report only, writing nothing. */
    dryRun: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { email } = await requireRole(ctx, ["admin"]);

    if (args.rows.length === 0) {
      throw new ConvexError("That chunk has no rows in it.");
    }
    if (args.rows.length > MAX_ROWS_PER_CALL) {
      throw new ConvexError(
        `Send at most ${MAX_ROWS_PER_CALL} rows per call — the browser splits a large sheet into chunks.`,
      );
    }

    const problems: RowProblem[] = [];
    let imported = 0;
    let updated = 0;
    let rejected = 0;

    /** Duplicate enrollment numbers *within* this chunk. */
    const seenEnrollment = new Map<string, number>();

    for (const row of args.rows) {
      const result = checkRow(row);
      if (!result.ok) {
        rejected += 1;
        problems.push(...result.problems);
        continue;
      }

      const first = seenEnrollment.get(result.doc.enrollmentNumber);
      if (first !== undefined) {
        rejected += 1;
        problems.push({
          rowNumber: row.rowNumber,
          column: HEADER_BY_KEY.enrollmentNumber,
          problem: `"${result.doc.enrollmentNumber}" also appears on row ${first} of this sheet`,
        });
        continue;
      }
      seenEnrollment.set(result.doc.enrollmentNumber, row.rowNumber);

      const existing = await ctx.db
        .query("studentRecords")
        .withIndex("by_enrollment", (q) =>
          q.eq("enrollmentNumber", result.doc.enrollmentNumber),
        )
        .first();

      if (args.dryRun) {
        if (existing) updated += 1;
        else imported += 1;
        continue;
      }

      if (existing) {
        await ctx.db.patch(existing._id, {
          ...result.doc,
          importedAt: Date.now(),
          importedByEmail: email,
          importBatchId: args.importBatchId,
        });
        updated += 1;
      } else {
        await ctx.db.insert("studentRecords", {
          ...result.doc,
          importedAt: Date.now(),
          importedByEmail: email,
          importBatchId: args.importBatchId,
        });
        imported += 1;
      }
    }

    return {
      rowsSeen: args.rows.length,
      imported,
      updated,
      rejected,
      /*
       * Every problem, not a sample. The point of a strict importer is that the
       * admin can fix the sheet, and a truncated report would send them back to
       * the spreadsheet repeatedly. A chunk is capped at 250 rows, so the worst
       * case is bounded.
       */
      problems,
      dryRun: args.dryRun,
    };
  },
});

/** Records what one upload did, once its chunks have all been sent. */
export const recordImportBatch = mutation({
  args: {
    batchId: v.string(),
    fileName: v.string(),
    sheetName: v.string(),
    rowsSeen: v.number(),
    imported: v.number(),
    updated: v.number(),
    rejected: v.number(),
    dryRun: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { email } = await requireRole(ctx, ["admin"]);
    return ctx.db.insert("importBatches", {
      ...args,
      uploadedByEmail: email,
      createdAt: Date.now(),
    });
  },
});

/**
 * Reverses one upload by deleting every row it inserted.
 *
 * Admin only, and deliberately blunt: it removes rows carrying this batch id,
 * which for a re-upload that *updated* existing rows means the updated rows go
 * too. That is stated here rather than worked around, because the alternative —
 * restoring the previous values — would need a history table this schema does
 * not have. Use it to undo a bad first import, not to roll back a correction.
 */
export const undoImport = mutation({
  args: { batchId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const rows = await ctx.db
      .query("studentRecords")
      .withIndex("by_import", (q) => q.eq("importBatchId", args.batchId))
      .collect();
    await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
    return { deleted: rows.length };
  },
});

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

/** The full row. Admin only — personal address, phone and home address. */
function adminView(row: Doc<"studentRecords">) {
  return {
    _id: row._id,
    fullName: row.fullName,
    firstName: row.firstName,
    middleName: row.middleName,
    lastName: row.lastName,
    personalEmail: row.personalEmail,
    secondaryEmail: row.secondaryEmail,
    phone: row.phone,
    secondaryPhone: row.secondaryPhone,
    enrollmentNumber: row.enrollmentNumber,
    collegeEmail: row.collegeEmail,
    degree: row.degree,
    department: row.department,
    departmentRaw: row.departmentRaw,
    permanentAddress: row.permanentAddress,
    designation: row.designation,
    company: row.company,
    yearOfPassing: row.yearOfPassing,
    yearOfJoining: row.yearOfJoining,
    importedAt: row.importedAt,
  };
}

/**
 * What a signed-in member may see of a roster row.
 *
 * The association asked members to be able to search by name, roll number or
 * college address. Being able to *search* by a value is not the same as being
 * allowed to *read* it, so this returns neither address nor phone number nor home
 * address — only who the person is and which cohort they were in. The roll number
 * is withheld too: it is the secret the verification gate checks, so publishing it
 * would let anyone submit a join request in a real student's name.
 */
function memberView(row: Doc<"studentRecords">) {
  return {
    _id: row._id,
    fullName: row.fullName,
    department: row.department,
    degree: row.degree,
    yearOfPassing: row.yearOfPassing,
    yearOfJoining: row.yearOfJoining,
    /** Enough to say "yes, that person is on the roster" and nothing more. */
    designation: row.designation,
    company: row.company,
  };
}

const SEARCH_LIMIT = 40;

/**
 * Search the roster by name, roll number or college address.
 *
 * One search index over `searchText` answers all three, which is why the field
 * exists — three separate lookups would each need their own index and would still
 * not handle "part of a name plus part of a number".
 *
 * Members get `memberView`; admins get the whole row. The projection is chosen
 * from the caller's resolved role, on the server, so there is no client flag that
 * could ask for the fuller one.
 */
export const search = query({
  args: {
    text: v.string(),
    department: v.optional(v.string()),
    yearOfPassing: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Signed-in members only. The roster is the college's record of real people,
    // so it is not a public search box.
    const { role } = await requireRole(ctx, [
      "alumni",
      "entrepreneur",
      "admin",
    ]);

    const term = args.text.trim();
    if (term.length < 2) {
      return { isAdmin: role === "admin", rows: [], adminRows: [], tooShort: true };
    }

    const limit = Math.min(Math.max(args.limit ?? SEARCH_LIMIT, 1), 100);
    const rows = await ctx.db
      .query("studentRecords")
      .withSearchIndex("search_students", (q) => {
        let search = q.search("searchText", term);
        if (args.department) search = search.eq("department", args.department);
        if (args.yearOfPassing !== undefined) {
          search = search.eq("yearOfPassing", args.yearOfPassing);
        }
        return search;
      })
      .take(limit);

    return {
      isAdmin: role === "admin",
      tooShort: false,
      rows: rows.map(memberView),
      /** Only ever populated for an admin. */
      adminRows: role === "admin" ? rows.map(adminView) : [],
    };
  },
});

/**
 * Roster totals, by department and cohort.
 *
 * Counts only, so this is safe for any signed-in member and is what tells them
 * whether their own batch has been imported yet.
 */
export const rosterStats = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["alumni", "entrepreneur", "admin"]);
    const rows = await ctx.db.query("studentRecords").collect();

    const byDepartment = new Map<string, number>();
    const byPassing = new Map<number, number>();
    for (const row of rows) {
      byDepartment.set(row.department, (byDepartment.get(row.department) ?? 0) + 1);
      byPassing.set(row.yearOfPassing, (byPassing.get(row.yearOfPassing) ?? 0) + 1);
    }

    return {
      total: rows.length,
      departments: [...byDepartment.entries()]
        .map(([department, count]) => ({ department, count }))
        .sort((a, b) => b.count - a.count),
      cohorts: [...byPassing.entries()]
        .map(([yearOfPassing, count]) => ({ yearOfPassing, count }))
        .sort((a, b) => b.yearOfPassing - a.yearOfPassing),
    };
  },
});

/** Recent uploads, for the admin import panel. */
export const importHistory = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return [];
    // Soft check: the panel renders an access notice rather than crashing.
    try {
      await requireRole(ctx, ["admin"]);
    } catch {
      return [];
    }
    return ctx.db.query("importBatches").withIndex("by_created").order("desc").take(20);
  },
});

/**
 * Does a claimed enrollment number match the roster, and does the address on the
 * request match the one the college has?
 *
 * This is what makes the imported roster worth having: `access.reviewVerification`
 * can be checked against the college's own record instead of against a
 * self-declared field. Admin only — it answers a question about a specific
 * student, so it must not be a probe anyone can run.
 */
export const verifyAgainstRoster = query({
  args: { enrollmentNumber: v.string(), email: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);

    const row = await ctx.db
      .query("studentRecords")
      .withIndex("by_enrollment", (q) =>
        q.eq("enrollmentNumber", args.enrollmentNumber.trim()),
      )
      .first();

    if (!row) {
      return { found: false as const, emailMatches: null, record: null };
    }

    const claimed = args.email?.trim().toLowerCase() ?? null;
    return {
      found: true as const,
      emailMatches:
        claimed === null
          ? null
          : claimed === row.personalEmail ||
            claimed === row.secondaryEmail ||
            claimed === row.collegeEmail,
      record: adminView(row),
    };
  },
});

/** The header the admin panel tells the association to use, and what is required. */
export const importFormat = query({
  args: {},
  handler: async () => ({
    columns: COLUMNS.map((column) => ({
      header: column.header,
      key: column.key,
      required: REQUIRED_COLUMNS.includes(column.key),
    })),
    collegeEmailDomain: COLLEGE_EMAIL_DOMAIN,
    maxRowsPerCall: MAX_ROWS_PER_CALL,
    departments: DEPARTMENTS,
  }),
});

/** Exported so the browser parser and the admin panel share one column order. */
export { COLLEGE_EMAIL_DOMAIN, HEADER_BY_KEY, REQUIRED_COLUMNS };

/**
 * Whether the caller may search the roster at all.
 *
 * `search` throws for a guest, which is correct for a mutation-shaped question but
 * would take the search page down on load. This answers the same question without
 * throwing, so the page can render a "verify first" notice instead.
 */
export const canSearchRoster = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) {
      return { allowed: false, role: null, signedIn: false };
    }
    try {
      const { role } = await requireRole(ctx, ["alumni", "entrepreneur", "admin"]);
      return { allowed: true, role, signedIn: true };
    } catch {
      return { allowed: false, role: "guest" as const, signedIn: true };
    }
  },
});
