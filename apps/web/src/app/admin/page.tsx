"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useState, type ReactNode } from "react";

import DetailsFormAdmin from "@/components/details-form-admin";
import RosterImport from "@/components/roster-import";
import {
  Button,
  Card,
  Empty,
  Eyebrow,
  LoadingRows,
  Meter,
  PageHeader,
  Pill,
  SectionHead,
  Shell,
  Stat,
} from "@/components/kit";
import { DEPARTMENT_NAMES, formatDate, inr, RITAA, ROLES } from "@/lib/site";

/**
 * Module 10 — admin panel.
 *
 * An operations console, so it is built as dense tables rather than cards: the
 * job here is to scan a queue and act on it, not to be admired.
 *
 * Every number on this page comes from a live Convex subscription. `useQuery`
 * re-renders when the underlying table changes, so the dashboard is genuinely
 * real-time — no polling, no nightly snapshot.
 *
 * THE READ/WRITE SPLIT
 *
 * `/admin` has no access gate yet. That single fact decides the architecture of
 * this whole screen: every privileged action is a documented CLI command, not a
 * button. `convex/adminOps.ts` exposes the moderation queues as public read-only
 * queries, and keeps `approveVenture` / `rejectVenture` as `internalMutation` —
 * unreachable from any browser. `access.ts` already does the same with
 * `reviewVerification` and `setRole`. So there is no code path on this page, and
 * none in the deployed public API, by which a visitor could approve a venture,
 * verify a member or grant themselves the admin role. The copy buttons in the
 * queues below copy a shell command to the clipboard; they do not act.
 *
 * The CSV exports are real: each file is assembled in the browser from the
 * loaded query results and handed over through a Blob object URL.
 */

/* ------------------------------------------------------------------ */
/* Local helpers                                                       */
/* ------------------------------------------------------------------ */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const inputClass =
  "w-full border border-line bg-white px-3 py-2.5 text-[0.9rem] text-ink placeholder:text-slate-ink/55 focus:border-maroon";
const labelClass =
  "font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink";

/** The verification split is derived from this many directory rows, not all of them. */
const SAMPLE_LIMIT = 200;

/** Privileged actions are CLI calls. These build the exact command, per row. */
const CLI_CWD = "packages/backend";

function approveVentureCmd(ventureId: string) {
  return `npx convex run adminOps:approveVenture '{"ventureId":"${ventureId}"}'`;
}

function rejectVentureCmd(ventureId: string) {
  return `npx convex run adminOps:rejectVenture '{"ventureId":"${ventureId}"}'`;
}

function reviewVerificationCmd(email: string, decision: "approved" | "rejected") {
  return `npx convex run access:reviewVerification '{"email":"${email}","decision":"${decision}"}'`;
}

function setRoleCmd(email: string, role: string) {
  return `npx convex run access:setRole '{"email":"${email}","role":"${role}"}'`;
}

function daysSince(ts: number) {
  return Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));
}

/* ------------------------------------------------------------------ */
/* CSV export — real, no dependencies                                  */
/* ------------------------------------------------------------------ */

type CsvValue = string | number;

/** RFC 4180 quoting: wrap when the cell holds a comma, quote, CR or LF. */
function csvCell(value: CsvValue) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: CsvValue[][]) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function downloadCsv(filename: string, rows: CsvValue[][]) {
  // The BOM keeps Excel from mangling the rupee sign and Tamil names.
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom + toCsv(rows)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function stamped(name: string) {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  return `ritaa-${name}-${day}.csv`;
}

/* ------------------------------------------------------------------ */
/* Table primitives — six tables on this page, one set of cell styles   */
/* ------------------------------------------------------------------ */

function TableFrame({
  caption,
  minWidth,
  children,
}: {
  caption: string;
  minWidth?: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto border border-line bg-white">
      <table className={cx("w-full border-collapse text-left", minWidth)}>
        <caption className="border-b border-line bg-bone px-4 py-3 text-left">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-brass">
            {caption}
          </span>
        </caption>
        {children}
      </table>
    </div>
  );
}

function Th({
  children,
  numeric = false,
}: {
  children: ReactNode;
  numeric?: boolean;
}) {
  return (
    <th
      scope="col"
      className={cx(
        "font-mono whitespace-nowrap px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink",
        numeric ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function RowTh({
  children,
  mono = false,
}: {
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <th
      scope="row"
      className={cx(
        "px-4 py-2.5 text-left align-top text-[0.8rem] font-normal text-ink",
        mono && "font-mono tabular-nums",
      )}
    >
      {children}
    </th>
  );
}

/**
 * Colour is a prop rather than an override class: Tailwind v4 resolves
 * conflicting utilities by its own sort order, not by the order they appear in
 * the attribute, so `text-ink` and `text-maroon` on the same cell is a coin flip.
 */
function Td({
  children,
  numeric = false,
  tone = "ink",
}: {
  children: ReactNode;
  numeric?: boolean;
  tone?: "ink" | "quiet" | "maroon";
}) {
  const tones = {
    ink: "text-ink",
    quiet: "text-slate-ink",
    maroon: "text-maroon",
  };
  return (
    <td
      className={cx(
        "px-4 py-2.5 align-top text-[0.8rem]",
        numeric && "font-mono text-right tabular-nums",
        tones[tone],
      )}
    >
      {children}
    </td>
  );
}

/**
 * Copies a shell command. Deliberately not a mutation trigger — the label says
 * "Copy" so nobody can mistake it for the action itself.
 */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  return (
    <button
      type="button"
      title={`Copy to clipboard: ${text}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
          window.setTimeout(() => setState("idle"), 1800);
        } catch {
          setState("failed");
        }
      }}
      className="font-mono whitespace-nowrap border border-ink/25 px-2 py-1 text-[0.65rem] uppercase tracking-[0.1em] text-ink transition-colors hover:border-maroon hover:text-maroon"
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Blocked" : label}
    </button>
  );
}

/** A command shown in full, for the runbook blocks. */
function Command({ children }: { children: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border border-line bg-bone px-3 py-2">
      <code className="font-mono break-all text-[0.75rem] text-ink">
        {children}
      </code>
      <CopyButton text={children} label="Copy" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Static reference data                                               */
/* ------------------------------------------------------------------ */

/** How `api.access.roleFor` explains the role it resolved. */
const ROLE_SOURCES: Record<string, string> = {
  assigned: "Explicit grant in the memberRoles table",
  venture: "Inferred — this address founded a venture on RACE",
  verified: "Inferred — their verification request was approved",
  unverified: "No grant, no venture and no approved verification",
  "no-session": "No email was supplied",
};

/** What each of the brief's four roles can reach, and how it is granted. */
const ROLE_GRANTS: Record<string, string> = {
  alumni:
    "Granted automatically when a verification request is approved, or explicitly with access:setRole.",
  entrepreneur:
    "Inferred by access.roleFor for any address that founded a venture, or explicitly with access:setRole.",
  admin: "Explicit grant only. There is no path by which a member self-promotes.",
  guest: "The default for every address with no grant, no venture and no approval.",
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function AdminPage() {
  const stats = useQuery(api.directory.stats);
  const raceStats = useQuery(api.race.raceStats);
  const givingTotals = useQuery(api.giving.givingTotals);
  const jobs = useQuery(api.careers.listJobs, {});
  const events = useQuery(api.events.list, {});
  const stories = useQuery(api.stories.list, {});
  const batchCounts = useQuery(api.directory.batchCounts);
  const departmentCounts = useQuery(api.directory.departmentCounts);
  const campaigns = useQuery(api.giving.listCampaigns, {});
  /** Capped sample: the verification split is derived from these rows only. */
  const memberSample = useQuery(api.directory.search, { limit: SAMPLE_LIMIT });

  /* Module 10's two queues. Reads are public; the writes behind them are not. */
  const verificationQueue = useQuery(api.access.verificationQueue);
  const pendingVerifications = useQuery(api.adminOps.pendingVerifications);
  const pendingVentures = useQuery(api.adminOps.pendingVentures);

  /** Which of the two sign-in providers this deployment has credentials for. */
  const authMethods = useQuery(api.auth.configuredAuthMethods);
  /** `Boolean(RESEND_API_KEY)` on the deployment — the transactional mail gateway. */
  const mailer = useQuery(api.eventAdmin.mailerStatus);

  /* Role lookup. Committed on submit rather than per keystroke, so the page does
     not open a subscription for every half-typed address. */
  const [roleInput, setRoleInput] = useState("");
  const [lookupEmail, setLookupEmail] = useState("");
  const resolvedRole = useQuery(
    api.access.roleFor,
    lookupEmail ? { email: lookupEmail } : "skip",
  );

  const batchTotal = (batchCounts ?? []).reduce((sum, row) => sum + row.count, 0);
  const departmentTotal = (departmentCounts ?? []).reduce(
    (sum, row) => sum + row.count,
    0,
  );

  const sample = memberSample ?? [];
  const verifiedCount = sample.filter((member) => member.verified).length;
  const unverifiedCount = sample.length - verifiedCount;
  const mentorCount = sample.filter((member) => member.openToMentor).length;
  const sampleCapped = sample.length === SAMPLE_LIMIT;

  const raisedTotal = (campaigns ?? []).reduce((sum, c) => sum + c.raisedInr, 0);
  const allocatedTotal = (campaigns ?? []).reduce((sum, c) => sum + c.allocated, 0);
  const unallocatedTotal = raisedTotal - allocatedTotal;

  const emailGateway = mailer === undefined ? undefined : mailer.configured;

  const contentRows = [
    {
      label: "Ventures awaiting approval",
      count: pendingVentures?.length,
      source: "api.adminOps.pendingVentures",
      scope: "Pending only",
      urgent: true,
    },
    {
      label: "Approved ventures on RACE",
      count: raceStats?.total,
      source: "api.race.raceStats",
      scope: "Approved only",
      urgent: false,
    },
    {
      label: "Stories in the archive",
      count: stories?.length,
      source: "api.stories.list",
      scope: "All rows, newest first",
      urgent: false,
    },
    {
      label: "Published events",
      count: events?.length,
      source: "api.events.list",
      scope: "Published only",
      urgent: false,
    },
    {
      label: "Active job & internship posts",
      count: jobs?.length,
      source: "api.careers.listJobs",
      scope: "Active only",
      urgent: false,
    },
  ];

  const channels = [
    {
      channel: "Email",
      gateway: "Resend HTTP API",
      ready: emailGateway,
      would:
        "RSVP reminders for module 7, campaign updates and receipts for module 8, newsletter issues from module 6, and the decision note that closes a verification request.",
      blocker:
        "npx convex env set RESEND_API_KEY re_… — eventAdmin.sendReminder throws without it rather than reporting a reminder it never sent.",
    },
    {
      channel: "SMS",
      gateway: "None configured",
      ready: false,
      would:
        "The reminders that do not need a body: RSVP confirmation, event-day venue and time, gift receipt reference.",
      blocker:
        "No SMS provider exists anywhere in the deployment. Indian bulk SMS additionally needs a DLT-registered sender header and pre-approved templates before the first message can legally go out.",
    },
    {
      channel: "Push",
      gateway: "None configured",
      ready: false,
      would:
        "Module 11's lightweight alerts — a story published, a mentorship request accepted, an event starting within the hour.",
      blocker:
        "Needs a service worker, a VAPID key pair, and somewhere to keep each device subscription. schema.ts has no subscription table, so there is nowhere to store a push token yet.",
    },
  ];

  /* ---- Report builders ------------------------------------------- */

  function exportMembersByBatch() {
    const rows: CsvValue[][] = [
      ["RITAA — members by batch"],
      ["Generated", new Date().toISOString()],
      ["Source", "api.directory.batchCounts"],
      [],
      ["Batch", "Members", "Share of directory (%)"],
      ...(batchCounts ?? []).map((row) => [
        row.batch,
        row.count,
        batchTotal > 0 ? ((row.count / batchTotal) * 100).toFixed(1) : "0.0",
      ]),
      [],
      ["Total", batchTotal, batchTotal > 0 ? "100.0" : "0.0"],
    ];
    downloadCsv(stamped("members-by-batch"), rows);
  }

  function exportMembersByDepartment() {
    const rows: CsvValue[][] = [
      ["RITAA — members by department"],
      ["Generated", new Date().toISOString()],
      ["Source", "api.directory.departmentCounts"],
      [],
      ["Code", "Department", "Members", "Share of directory (%)"],
      ...(departmentCounts ?? []).map((row) => [
        row.department,
        DEPARTMENT_NAMES[row.department] ?? row.department,
        row.count,
        departmentTotal > 0
          ? ((row.count / departmentTotal) * 100).toFixed(1)
          : "0.0",
      ]),
      [],
      ["Total", "", departmentTotal, departmentTotal > 0 ? "100.0" : "0.0"],
    ];
    downloadCsv(stamped("members-by-department"), rows);
  }

  function exportCampaignPerformance() {
    const rows: CsvValue[][] = [
      ["RITAA — campaign performance"],
      ["Generated", new Date().toISOString()],
      ["Source", "api.giving.listCampaigns"],
      [],
      [
        "Campaign",
        "Cause",
        "Batch",
        "Status",
        "Goal (INR)",
        "Raised (INR)",
        "Progress (%)",
        "Donors",
        "Allocated (INR)",
        "Unallocated (INR)",
        "Allocations",
      ],
      ...(campaigns ?? []).map((c) => [
        c.title,
        c.cause,
        c.batch ?? "All batches",
        c.active ? "Active" : "Closed",
        c.goalInr,
        c.raisedInr,
        Math.round(c.progress * 100),
        c.donorCount,
        c.allocated,
        c.raisedInr - c.allocated,
        c.allocations.map((a) => `${a.label}: ${a.amountInr}`).join("; "),
      ]),
      [],
      [
        "Total",
        "",
        "",
        "",
        (campaigns ?? []).reduce((s, c) => s + c.goalInr, 0),
        raisedTotal,
        "",
        (campaigns ?? []).reduce((s, c) => s + c.donorCount, 0),
        allocatedTotal,
        unallocatedTotal,
        "",
      ],
    ];
    downloadCsv(stamped("campaign-performance"), rows);
  }

  function exportPendingVerifications() {
    const rows: CsvValue[][] = [
      ["RITAA — verification requests awaiting review"],
      ["Generated", new Date().toISOString()],
      ["Source", "api.adminOps.pendingVerifications"],
      [
        "Note",
        "Check each roll number against college records, then run access:reviewVerification for that email.",
      ],
      [],
      [
        "Waiting (days)",
        "Submitted",
        "Name",
        "Email",
        "Batch",
        "Dept",
        "Department",
        "Roll number",
        "Graduation year",
      ],
      ...(pendingVerifications ?? []).map((r) => [
        daysSince(r.createdAt),
        new Date(r.createdAt).toISOString(),
        r.name,
        r.email,
        r.batch,
        r.department,
        DEPARTMENT_NAMES[r.department] ?? r.department,
        r.rollNumber,
        r.graduationYear,
      ]),
      [],
      ["Pending total", (pendingVerifications ?? []).length],
    ];
    downloadCsv(stamped("pending-verifications"), rows);
  }

  function exportPendingVentures() {
    const rows: CsvValue[][] = [
      ["RITAA — RACE submissions awaiting moderation"],
      ["Generated", new Date().toISOString()],
      ["Source", "api.adminOps.pendingVentures"],
      [
        "Note",
        "Approve with adminOps:approveVenture, reject with adminOps:rejectVenture, using the venture ID column.",
      ],
      [],
      [
        "Waiting (days)",
        "Submitted",
        "Business",
        "Stage",
        "Category",
        "Founder",
        "Founder email",
        "Batch",
        "Location",
        "Website",
        "Images",
        "Looking for",
        "Offers help",
        "Description",
        "Venture ID",
      ],
      ...(pendingVentures ?? []).map((r) => [
        daysSince(r.createdAt),
        new Date(r.createdAt).toISOString(),
        r.businessName,
        r.stage,
        r.category,
        r.founderName,
        r.founderEmail,
        r.founderBatch ?? "",
        r.location,
        r.website ?? "",
        r.imageCount,
        r.lookingFor.join("; "),
        r.offersHelp.join("; "),
        r.description,
        r._id,
      ]),
      [],
      ["Pending total", (pendingVentures ?? []).length],
    ];
    downloadCsv(stamped("pending-ventures"), rows);
  }

  const reports = [
    {
      title: "Verification queue",
      copy: "Everyone waiting on a decision, oldest first, with roll number and graduation year for the records check.",
      action: exportPendingVerifications,
      ready: Boolean(pendingVerifications),
      rows: pendingVerifications?.length,
    },
    {
      title: "Moderation queue",
      copy: "Every unapproved RACE submission with its full description and the venture ID the approve command needs.",
      action: exportPendingVentures,
      ready: Boolean(pendingVentures),
      rows: pendingVentures?.length,
    },
    {
      title: "Members by batch",
      copy: "One row per cohort with headcount and share of the directory, closed by a total row.",
      action: exportMembersByBatch,
      ready: Boolean(batchCounts),
      rows: batchCounts?.length,
    },
    {
      title: "Members by department",
      copy: "Department code, full name, headcount and share — ordered by size.",
      action: exportMembersByDepartment,
      ready: Boolean(departmentCounts),
      rows: departmentCounts?.length,
    },
    {
      title: "Campaign performance",
      copy: "Goal, raised, progress, donors, allocated and unallocated per campaign, with the usage-tracker line items inline.",
      action: exportCampaignPerformance,
      ready: Boolean(campaigns),
      rows: campaigns?.length,
    },
  ];

  return (
    <>
      <PageHeader
        module="Module 10 · Admin panel"
        title="Operations console."
        lede="Live association figures and the two queues that need a human: alumni waiting on verification, and ventures waiting on moderation. Reads are live; every write is a documented command, never a button on this page."
      >
        <div className="flex flex-wrap gap-2">
          <Pill tone="dark">Real-time subscriptions</Pill>
          <Pill tone="dark">Reads public · writes CLI-only</Pill>
          <Pill tone="dark">Route not yet gated</Pill>
        </div>
      </PageHeader>

      {/* ---- The single most important thing on this page ---------------- */}
      <section className="border-b border-line bg-bone-deep">
        <Shell className="py-8">
          <div className="border-l-2 border-maroon bg-white p-6">
            <Eyebrow>Access control · read before deploying</Eyebrow>
            <p className="mt-3 max-w-3xl text-[0.95rem] leading-relaxed text-ink">
              <strong className="font-semibold">
                This route is not authenticated.
              </strong>{" "}
              Anyone who knows the URL <code className="font-mono">/admin</code>{" "}
              can load it, and the queues below are public Convex queries — which
              means applicant names, email addresses and roll numbers are readable
              by any client today. Gating this route to the Admin role is now a
              release blocker, not a nicety.
            </p>
            <p className="mt-3 max-w-3xl text-[0.875rem] leading-relaxed text-slate-ink">
              What is <em>not</em> exposed is the ability to change anything.
              Approving a venture, verifying a member and granting a role are all{" "}
              <code className="font-mono">internalMutation</code>s in{" "}
              <code className="font-mono">adminOps.ts</code> and{" "}
              <code className="font-mono">access.ts</code>, so they are absent from
              the public API and cannot be called from a browser at all. That is
              why this screen hands you commands instead of buttons.
            </p>
          </div>

          {/*
            Sign-in is Google and LinkedIn only. With neither configured nobody can
            open a session at all — including the association — so this is now the
            second release blocker and belongs beside the first rather than buried
            in the integrations table further down.
          */}
          {authMethods !== undefined && !authMethods.anyConfigured ? (
            <div className="mt-4 border-l-2 border-maroon bg-white p-6">
              <Eyebrow>Sign-in · release blocker</Eyebrow>
              <p className="mt-3 max-w-3xl text-[0.95rem] leading-relaxed text-ink">
                <strong className="font-semibold">
                  No sign-in provider is configured.
                </strong>{" "}
                Google and LinkedIn are the only two ways into the portal and
                neither has credentials on this deployment, so no one can sign in —
                every member-only surface is unreachable, including this panel once
                it is gated.
              </p>
              <pre className="font-mono mt-4 overflow-x-auto rounded-control bg-ink p-4 text-[0.72rem] leading-relaxed text-bone">
                {`npx convex env set GOOGLE_CLIENT_ID        …
npx convex env set GOOGLE_CLIENT_SECRET    …
npx convex env set LINKEDIN_CLIENT_ID      …
npx convex env set LINKEDIN_CLIENT_SECRET  …`}
              </pre>
              <p className="mt-3 max-w-3xl text-[0.875rem] leading-relaxed text-slate-ink">
                Each provider registers itself the moment both of its values are
                present — see <code className="font-mono">auth.ts</code>. Register{" "}
                <code className="font-mono">
                  &lt;SITE_URL&gt;/api/auth/callback/google
                </code>{" "}
                and the LinkedIn equivalent as redirect URIs with each provider.
              </p>
            </div>
          ) : null}
        </Shell>
      </section>

      {/* ---- Headline analytics ----------------------------------------- */}
      <section className="border-b border-line bg-white">
        <Shell>
          <div className="grid grid-cols-2 gap-8 py-10 sm:grid-cols-3 lg:grid-cols-6">
            <Stat value={stats?.alumni ?? "—"} label="Members in directory" />
            <Stat value={stats?.batches ?? "—"} label="Batches represented" />
            <Stat value={stats?.companies ?? "—"} label="Companies & institutions" />
            <Stat value={stats?.mentors ?? "—"} label="Alumni mentoring" />
            <Stat value={raceStats?.total ?? "—"} label="Approved ventures" />
            <Stat
              value={
                givingTotals ? inr(givingTotals.raisedInr, { compact: true }) : "—"
              }
              label="Raised across campaigns"
            />
          </div>
        </Shell>
      </section>

      {/* ---- Data dashboard --------------------------------------------- */}
      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Data dashboard"
            title="Every figure here is live"
            lede="These are Convex subscriptions, not a nightly snapshot. When a member joins, a venture is submitted, an RSVP lands or a gift is recorded, the numbers on this screen change without a refresh."
          />
          <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                label: "Ventures awaiting moderation",
                value: pendingVentures?.length,
                sub: `${raceStats?.total ?? "—"} already published on RACE`,
              },
              {
                label: "Members awaiting verification",
                value: verificationQueue?.pending,
                sub: `${verificationQueue?.approved ?? "—"} approved · ${
                  verificationQueue?.rejected ?? "—"
                } rejected to date`,
              },
              {
                label: "Active campaigns",
                value: givingTotals?.activeCampaigns,
                sub: `${givingTotals?.donors ?? "—"} gifts recorded in total`,
              },
              {
                label: "Open roles posted",
                value: jobs?.length,
                sub: `${(jobs ?? []).filter((j) => j.referralOffered).length} with a referral offered`,
              },
              {
                label: "Ventures seeking guidance",
                value: raceStats?.upcoming,
                sub: `${raceStats?.established ?? "—"} established businesses listed`,
              },
              {
                label: "Founders offering help",
                value: raceStats?.mentoringOffered,
                sub: `across ${raceStats?.categories ?? "—"} industries`,
              },
              {
                label: "Events published",
                value: events?.length,
                sub: `${stories?.length ?? "—"} stories in the archive`,
              },
              {
                label: "Alumni mentoring",
                value: stats?.mentors,
                sub: `out of ${stats?.alumni ?? "—"} directory members`,
              },
            ].map((cell) => (
              <div key={cell.label} className="bg-white p-7">
                <Stat value={cell.value ?? "—"} label={cell.label} />
                <p className="font-mono mt-3 text-[0.7rem] tabular-nums text-slate-ink">
                  {cell.sub}
                </p>
              </div>
            ))}
          </div>
        </section>
      </Shell>

      {/* ---- Student roster import --------------------------------------
          Placed before member management because it is what makes that queue
          checkable: once the college's own record is here, a claimed roll number
          can be verified against it instead of taken on trust. */}
      <Shell>
        <section id="roster" className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Student database"
            title="Import the college's own record"
            lede="Upload the association's department spreadsheets. The file is read in this browser, then every cell is re-validated on the server before anything is written — so the report you get is what the server actually decided, not what the page guessed."
          />
          <RosterImport />
        </section>
      </Shell>

      {/* ---- The member details form ------------------------------------
          The questionnaire every member fills in after signing in. This panel
          is the whole of it: the eleven fields with their labels, help text,
          option lists and ordering, plus any extra questions the association
          adds. Nothing about the form is hard-coded in the member-facing
          page — see details-form.tsx. */}
      <section id="details-form" className="border-t border-line bg-bone-deep">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Member details form"
            title="What every member is asked after signing in"
            lede="Name and email arrive confirmed from Google or LinkedIn. Everything else on this list is yours to configure: relabel a field, reword its help, reorder it, make it required or optional, edit the batch and department dropdowns, or add a question of your own. Changes reach members immediately — there is no deploy."
          />
          <DetailsFormAdmin />
        </Shell>
      </section>

      {/* ---- Member management ------------------------------------------ */}
      <section className="border-y border-line bg-white">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Member management"
            title="Who is waiting, and who is already in"
            lede="The verification queue is the actionable half: each request carries a roll number to check against college records. Below it, the cohort and department distribution of everyone already listed."
            action={
              <Button
                variant="outline"
                onClick={exportPendingVerifications}
                disabled={!pendingVerifications}
              >
                Export queue (CSV)
              </Button>
            }
          />

          <div className="grid gap-px bg-line sm:grid-cols-3">
            <div className="bg-white p-7">
              <Stat
                value={verificationQueue?.pending ?? "—"}
                label="Requests pending review"
              />
            </div>
            <div className="bg-white p-7">
              <Stat
                value={verificationQueue?.approved ?? "—"}
                label="Approved — now verified alumni"
              />
            </div>
            <div className="bg-white p-7">
              <Stat value={verificationQueue?.rejected ?? "—"} label="Rejected" />
            </div>
          </div>

          <p className="mt-4 max-w-3xl text-[0.85rem] leading-relaxed text-slate-ink">
            Counts from <code className="font-mono">api.access.verificationQueue</code>
            ; the rows from <code className="font-mono">api.adminOps.pendingVerifications</code>.
            Approving a request also grants the Alumni role and flips the member&rsquo;s
            directory listing to verified, which is why it is the association&rsquo;s
            authenticity gate and why it runs from a terminal rather than from here.
          </p>

          <div className="mt-8">
            {pendingVerifications === undefined ? (
              <LoadingRows rows={3} />
            ) : pendingVerifications.length === 0 ? (
              <Empty
                title="Nobody is waiting on verification."
                hint="New join requests from the /join page land here the moment they are submitted — this list is a live subscription."
              />
            ) : (
              <TableFrame
                caption={`Verification queue · ${pendingVerifications.length} pending · oldest first`}
                minWidth="min-w-[62rem]"
              >
                <thead>
                  <tr className="border-b border-line">
                    <Th numeric>Days</Th>
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th numeric>Batch</Th>
                    <Th>Dept</Th>
                    <Th>Roll number</Th>
                    <Th numeric>Graduated</Th>
                    <Th>Copy review command</Th>
                  </tr>
                </thead>
                <tbody>
                  {pendingVerifications.map((row) => (
                    <tr key={row._id} className="border-b border-line last:border-0">
                      <Td numeric tone="maroon">
                        {daysSince(row.createdAt)}
                      </Td>
                      <RowTh>
                        {row.name}
                        <span className="font-mono mt-0.5 block text-[0.68rem] text-slate-ink">
                          {formatDate(row.createdAt)}
                        </span>
                      </RowTh>
                      <Td>
                        <span className="font-mono break-all text-[0.75rem]">
                          {row.email}
                        </span>
                      </Td>
                      <Td numeric>{row.batch}</Td>
                      <Td>
                        <span className="font-mono text-brass">{row.department}</span>
                      </Td>
                      <Td>
                        <span className="font-mono text-[0.75rem] tabular-nums">
                          {row.rollNumber}
                        </span>
                      </Td>
                      <Td numeric tone="quiet">
                        {row.graduationYear}
                      </Td>
                      <Td>
                        <span className="flex gap-2">
                          <CopyButton
                            text={reviewVerificationCmd(row.email, "approved")}
                            label="Copy approve"
                          />
                          <CopyButton
                            text={reviewVerificationCmd(row.email, "rejected")}
                            label="Copy reject"
                          />
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableFrame>
            )}
          </div>

          <Card className="mt-6 hover:border-line">
            <Eyebrow>Runbook · verification</Eyebrow>
            <p className="mt-3 text-[0.875rem] leading-relaxed text-slate-ink">
              Run from <code className="font-mono">{CLI_CWD}</code>. The buttons in
              the table above copy the same command with that row&rsquo;s email
              already filled in.
            </p>
            <div className="mt-4 space-y-2">
              <Command>
                {reviewVerificationCmd("member@example.com", "approved")}
              </Command>
              <Command>
                {reviewVerificationCmd("member@example.com", "rejected")}
              </Command>
            </div>
          </Card>

          <div className="mt-12 grid gap-px bg-line sm:grid-cols-3">
            <div className="bg-white p-7">
              <Stat
                value={memberSample ? verifiedCount : "—"}
                label="Verified in sample"
              />
            </div>
            <div className="bg-white p-7">
              <Stat
                value={memberSample ? unverifiedCount : "—"}
                label="Unverified in sample"
              />
            </div>
            <div className="bg-white p-7">
              <Stat
                value={memberSample ? mentorCount : "—"}
                label="Opted in to mentoring"
              />
            </div>
          </div>

          <p className="mt-4 max-w-3xl text-[0.85rem] leading-relaxed text-slate-ink">
            Those three figures are computed from{" "}
            <code className="font-mono">api.directory.search</code> with a{" "}
            {SAMPLE_LIMIT}-row limit, so they are a sample rather than a census.
            {sampleCapped
              ? " That limit has been reached — the true totals are higher, and a dedicated admin count query should replace this."
              : ` All ${sample.length} directory rows fit inside the limit, so these figures are complete.`}
          </p>

          <div className="mt-10 grid gap-8 lg:grid-cols-2">
            {/* Batch table */}
            <TableFrame caption="Members by batch" minWidth="min-w-[22rem]">
              <thead>
                <tr className="border-b border-line">
                  <Th>Batch</Th>
                  <Th numeric>Members</Th>
                  <Th numeric>Share</Th>
                </tr>
              </thead>
              <tbody>
                {(batchCounts ?? []).map((row) => (
                  <tr key={row.batch} className="border-b border-line">
                    <RowTh mono>{row.batch}</RowTh>
                    <Td numeric>{row.count}</Td>
                    <Td numeric tone="quiet">
                      {batchTotal > 0
                        ? `${((row.count / batchTotal) * 100).toFixed(1)}%`
                        : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-bone">
                  <th
                    scope="row"
                    className="font-mono px-4 py-2.5 text-left text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink"
                  >
                    Total
                  </th>
                  <Td numeric tone="maroon">
                    {batchCounts ? batchTotal : "—"}
                  </Td>
                  <Td numeric tone="quiet">
                    {batchCounts && batchTotal > 0 ? "100.0%" : "—"}
                  </Td>
                </tr>
              </tfoot>
            </TableFrame>

            {/* Department table */}
            <TableFrame caption="Members by department" minWidth="min-w-[26rem]">
              <thead>
                <tr className="border-b border-line">
                  <Th>Department</Th>
                  <Th numeric>Members</Th>
                  <Th numeric>Share</Th>
                </tr>
              </thead>
              <tbody>
                {(departmentCounts ?? []).map((row) => (
                  <tr key={row.department} className="border-b border-line">
                    <RowTh>
                      <span className="font-mono text-brass">{row.department}</span>{" "}
                      <span className="text-slate-ink">
                        {DEPARTMENT_NAMES[row.department] ?? ""}
                      </span>
                    </RowTh>
                    <Td numeric>{row.count}</Td>
                    <Td numeric tone="quiet">
                      {departmentTotal > 0
                        ? `${((row.count / departmentTotal) * 100).toFixed(1)}%`
                        : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-bone">
                  <th
                    scope="row"
                    className="font-mono px-4 py-2.5 text-left text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink"
                  >
                    Total
                  </th>
                  <Td numeric tone="maroon">
                    {departmentCounts ? departmentTotal : "—"}
                  </Td>
                  <Td numeric tone="quiet">
                    {departmentCounts && departmentTotal > 0 ? "100.0%" : "—"}
                  </Td>
                </tr>
              </tfoot>
            </TableFrame>
          </div>
        </Shell>
      </section>

      {/* ---- Content moderation ----------------------------------------- */}
      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Content moderation"
            title="The moderation queue, finally readable"
            lede="RACE submissions land unapproved and stay invisible on the public feed until someone approves them. api.race.listVentures can only ever see approved rows, so api.adminOps.pendingVentures reads the other side of the same index."
            action={
              <Button
                variant="outline"
                onClick={exportPendingVentures}
                disabled={!pendingVentures}
              >
                Export queue (CSV)
              </Button>
            }
          />

          <Card className="hover:border-line">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Eyebrow>Runbook · moderation</Eyebrow>
              <Pill tone="jade">No public mutation exists</Pill>
            </div>
            <p className="mt-3 max-w-3xl text-[0.875rem] leading-relaxed text-slate-ink">
              Approve and reject are{" "}
              <code className="font-mono">internalMutation</code>s, so they are not
              part of the deployed public API and no visitor to this page can invoke
              them. Run them from <code className="font-mono">{CLI_CWD}</code> with
              the deployment&rsquo;s admin key — the per-row buttons below copy the
              same command with the venture ID already substituted.
            </p>
            <div className="mt-4 space-y-2">
              <Command>{approveVentureCmd("<ventureId>")}</Command>
              <Command>{rejectVentureCmd("<ventureId>")}</Command>
            </div>
            <p className="mt-4 max-w-3xl text-[0.85rem] leading-relaxed text-slate-ink">
              Approving patches <code className="font-mono">approved: true</code> and
              the venture appears on <code className="font-mono">/race</code>{" "}
              immediately. Rejecting deletes the row, because{" "}
              <code className="font-mono">ventures</code> models publication as a
              single boolean and has no third &ldquo;rejected&rdquo; state — a
              flagged-but-kept row would sit in this queue forever and be
              re-reviewed at every sitting. The mutation returns the full submission
              so the terminal holds the record, and the founder&rsquo;s email comes
              back with it so they can be told why. A{" "}
              <code className="font-mono">status</code> field plus an action log is
              the permanent fix, and both are schema changes.
            </p>
          </Card>

          <div className="mt-8">
            {pendingVentures === undefined ? (
              <LoadingRows rows={3} />
            ) : pendingVentures.length === 0 ? (
              <Empty
                title="No venture is waiting for review."
                hint="Submissions from /race#submit arrive here unapproved. This list is a live subscription, so a new one appears without a refresh."
              />
            ) : (
              <TableFrame
                caption={`Moderation queue · ${pendingVentures.length} awaiting review · oldest first`}
                minWidth="min-w-[64rem]"
              >
                <thead>
                  <tr className="border-b border-line">
                    <Th numeric>Days</Th>
                    <Th>Submission</Th>
                    <Th>Stage</Th>
                    <Th>Category</Th>
                    <Th>Founder</Th>
                    <Th>Copy action command</Th>
                  </tr>
                </thead>
                <tbody>
                  {pendingVentures.map((row) => (
                    <tr key={row._id} className="border-b border-line last:border-0">
                      <Td numeric tone="maroon">
                        {daysSince(row.createdAt)}
                      </Td>
                      <RowTh>
                        <span className="block text-[0.9rem] text-ink">
                          {row.businessName}
                        </span>
                        <span className="font-mono mt-0.5 block text-[0.68rem] text-slate-ink">
                          {formatDate(row.createdAt)} · {row.location} ·{" "}
                          {row.imageCount} image
                          {row.imageCount === 1 ? "" : "s"}
                          {row.website ? " · website supplied" : ""}
                        </span>
                        {/* line-clamp sets its own display; adding `block`
                            would fight it, so it is left off deliberately. */}
                        <span className="mt-1.5 line-clamp-3 max-w-[24rem] text-[0.78rem] font-normal leading-relaxed text-slate-ink">
                          {row.description}
                        </span>
                      </RowTh>
                      <Td>
                        <Pill tone={row.stage === "established" ? "brass" : "quiet"}>
                          {row.stage}
                        </Pill>
                      </Td>
                      <Td tone="quiet">{row.category}</Td>
                      <Td>
                        {row.founderName}
                        <span className="font-mono mt-0.5 block break-all text-[0.68rem] text-slate-ink">
                          {row.founderEmail}
                          {row.founderBatch ? ` · '${String(row.founderBatch).slice(2)}` : ""}
                        </span>
                      </Td>
                      <Td>
                        <span className="flex gap-2">
                          <CopyButton
                            text={approveVentureCmd(row._id)}
                            label="Copy approve"
                          />
                          <CopyButton
                            text={rejectVentureCmd(row._id)}
                            label="Copy reject"
                          />
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableFrame>
            )}
          </div>

          <div className="mt-10">
            <TableFrame
              caption="Published content inventory"
              minWidth="min-w-[44rem]"
            >
              <thead>
                <tr className="border-b border-line">
                  <Th>Content</Th>
                  <Th numeric>Live count</Th>
                  <Th>Source query</Th>
                  <Th>Visibility</Th>
                </tr>
              </thead>
              <tbody>
                {contentRows.map((row) => (
                  <tr key={row.label} className="border-b border-line last:border-0">
                    <RowTh>{row.label}</RowTh>
                    <Td numeric tone={row.urgent ? "maroon" : "ink"}>
                      {row.count ?? "—"}
                    </Td>
                    <Td tone="quiet">
                      <span className="font-mono text-[0.72rem]">{row.source}</span>
                    </Td>
                    <Td>
                      <Pill tone={row.urgent ? "maroon" : "quiet"}>{row.scope}</Pill>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          </div>

          <p className="mt-6 max-w-3xl text-[0.85rem] leading-relaxed text-slate-ink">
            Unpublishing a story or closing a job post is not wired anywhere yet.
            Both are one mutation each, and both belong behind the same admin gate
            as the two queues above rather than being added as public writes.
          </p>
        </section>
      </Shell>

      {/* ---- Campaign tracking ------------------------------------------ */}
      <section className="border-y border-line bg-white">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Campaign tracking"
            title="Where every rupee stands"
            lede="Raised against goal, donor counts, and how much of what came in has actually been allocated by the fund usage tracker."
            action={
              <Button
                variant="outline"
                onClick={exportCampaignPerformance}
                disabled={!campaigns}
              >
                Export campaigns (CSV)
              </Button>
            }
          />

          <div className="grid gap-px bg-line sm:grid-cols-3">
            <div className="bg-white p-7">
              <Stat
                value={campaigns ? inr(raisedTotal, { compact: true }) : "—"}
                label="Raised across all campaigns"
              />
            </div>
            <div className="bg-white p-7">
              <Stat
                value={campaigns ? inr(allocatedTotal, { compact: true }) : "—"}
                label="Allocated to a named line item"
              />
            </div>
            <div className="bg-white p-7">
              <Stat
                value={campaigns ? inr(unallocatedTotal, { compact: true }) : "—"}
                label="Received but not yet allocated"
              />
            </div>
          </div>

          <div className="mt-10">
            {campaigns === undefined ? (
              <LoadingRows rows={3} />
            ) : campaigns.length === 0 ? (
              <Empty
                title="No campaigns on the ledger yet."
                hint="Create a campaign in the Convex dashboard and it appears here, on the giving page and in this export, immediately."
              />
            ) : (
              <ul className="grid gap-px bg-line lg:grid-cols-2">
                {campaigns.map((campaign) => {
                  const unallocated = campaign.raisedInr - campaign.allocated;
                  return (
                    <li key={campaign._id} className="bg-white p-7">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone={campaign.active ? "jade" : "quiet"}>
                          {campaign.active ? "Active" : "Closed"}
                        </Pill>
                        <Pill tone="brass">{campaign.cause}</Pill>
                        {campaign.batch ? (
                          <Pill>Batch {campaign.batch}</Pill>
                        ) : null}
                      </div>

                      <h3 className="font-display mt-4 text-xl leading-snug text-ink">
                        {campaign.title}
                      </h3>
                      <p className="mt-2 text-[0.875rem] leading-relaxed text-slate-ink">
                        {campaign.summary}
                      </p>

                      <div className="mt-6">
                        <div className="flex items-baseline justify-between">
                          <span className="font-mono text-lg tabular-nums text-maroon">
                            {inr(campaign.raisedInr, { compact: true })}
                          </span>
                          <span className="font-mono text-[0.72rem] tabular-nums text-slate-ink">
                            of {inr(campaign.goalInr, { compact: true })}
                          </span>
                        </div>
                        <div className="mt-2">
                          <Meter
                            value={campaign.progress}
                            label="Against goal"
                            tone={campaign.active ? "jade" : "brass"}
                          />
                        </div>
                      </div>

                      <dl className="font-mono mt-5 space-y-1 text-[0.72rem]">
                        <div className="flex justify-between gap-3">
                          <dt className="text-slate-ink">Donors</dt>
                          <dd className="tabular-nums text-ink">
                            {campaign.donorCount}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-slate-ink">Allocated</dt>
                          <dd className="tabular-nums text-ink">
                            {inr(campaign.allocated)}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-slate-ink">Unallocated</dt>
                          <dd
                            className={cx(
                              "tabular-nums",
                              unallocated > 0 ? "text-brass" : "text-jade",
                            )}
                          >
                            {inr(unallocated)}
                          </dd>
                        </div>
                        {campaign.closesAt ? (
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-ink">Closes</dt>
                            <dd className="tabular-nums text-ink">
                              {formatDate(campaign.closesAt)}
                            </dd>
                          </div>
                        ) : null}
                      </dl>

                      {campaign.allocations.length > 0 ? (
                        <ul className="mt-5 space-y-1 border-t border-line pt-4">
                          {campaign.allocations.map((allocation) => (
                            <li
                              key={allocation.label}
                              className="font-mono flex justify-between gap-3 text-[0.72rem]"
                            >
                              <span className="text-slate-ink">
                                {allocation.label}
                              </span>
                              <span className="tabular-nums text-ink">
                                {inr(allocation.amountInr)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-5 border-t border-line pt-4 text-[0.8rem] text-slate-ink">
                          No allocations recorded yet — the whole amount raised is
                          still unassigned in the usage tracker.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Shell>
      </section>

      {/* ---- Notification tools ----------------------------------------- */}
      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Notification tools"
            title="What would send, and what is actually wired"
            lede="The brief asks for email, SMS and push. One of the three has a gateway in this deployment, and its status is read live rather than asserted. No send button is rendered for a channel that would fail."
          />

          <TableFrame caption="Notification channels" minWidth="min-w-[56rem]">
            <thead>
              <tr className="border-b border-line">
                <Th>Channel</Th>
                <Th>Gateway</Th>
                <Th>Status</Th>
                <Th>What it would send</Th>
              </tr>
            </thead>
            <tbody>
              {channels.map((row) => (
                <tr key={row.channel} className="border-b border-line last:border-0">
                  <RowTh>
                    <span className="text-[0.9rem]">{row.channel}</span>
                  </RowTh>
                  <Td tone="quiet">
                    <span className="font-mono text-[0.75rem]">{row.gateway}</span>
                  </Td>
                  <Td>
                    {row.ready === undefined ? (
                      <Pill>Checking</Pill>
                    ) : row.ready ? (
                      <Pill tone="jade">Key configured</Pill>
                    ) : (
                      <Pill tone="maroon">Not configured</Pill>
                    )}
                  </Td>
                  <Td>
                    <span className="block max-w-[26rem] leading-relaxed">
                      {row.would}
                    </span>
                    <span className="mt-1.5 block max-w-[26rem] text-[0.75rem] leading-relaxed text-slate-ink">
                      {row.blocker}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>

          <p className="mt-6 max-w-3xl text-[0.875rem] leading-relaxed text-slate-ink">
            The email row reads{" "}
            <code className="font-mono">api.eventAdmin.mailerStatus()</code>, which
            is <code className="font-mono">Boolean(RESEND_API_KEY)</code> on the
            Convex deployment — the key{" "}
            <code className="font-mono">eventAdmin.sendReminder</code> needs before a
            queued reminder can leave the building.{" "}
            {emailGateway === undefined
              ? "Reading it now."
              : emailGateway
                ? "It is set, so the transport works — a broadcast composer is UI work, not integration work."
                : "It is not set, so nothing on this deployment can send mail today."}
          </p>

          <div className="mt-8 grid gap-px bg-line sm:grid-cols-3">
            <div className="bg-white p-7">
              <Stat value={stats?.alumni ?? "—"} label="Addressable members" />
              <p className="font-mono mt-3 text-[0.7rem] text-slate-ink">
                Everyone in the directory
              </p>
            </div>
            <div className="bg-white p-7">
              <Stat value={batchCounts?.length ?? "—"} label="Batch segments" />
              <p className="font-mono mt-3 text-[0.7rem] text-slate-ink">
                A broadcast can target one cohort
              </p>
            </div>
            <div className="bg-white p-7">
              <Stat
                value={departmentCounts?.length ?? "—"}
                label="Department segments"
              />
              <p className="font-mono mt-3 text-[0.7rem] text-slate-ink">
                Or one department across all batches
              </p>
            </div>
          </div>
        </section>
      </Shell>

      {/* ---- Downloadable reports --------------------------------------- */}
      <section className="border-y border-line bg-white">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Downloadable reports"
            title="Five exports that work right now"
            lede="Each file is built in the browser from the data already on this page and saved through a Blob object URL. No server round trip, and no spreadsheet plugin."
          />
          <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {reports.map((report) => (
              <div key={report.title} className="bg-white p-7">
                <h3 className="font-display text-xl text-ink">{report.title}</h3>
                <p className="mt-2.5 text-[0.875rem] leading-relaxed text-slate-ink">
                  {report.copy}
                </p>
                <p className="font-mono mt-4 text-[0.7rem] tabular-nums uppercase tracking-[0.1em] text-brass">
                  {report.ready
                    ? `${report.rows ?? 0} row${report.rows === 1 ? "" : "s"} ready`
                    : "Loading data"}
                </p>
                <div className="mt-5">
                  <Button onClick={report.action} disabled={!report.ready}>
                    Download CSV
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-8 max-w-3xl text-[0.875rem] leading-relaxed text-slate-ink">
            Values containing commas, quotation marks or line breaks — campaign
            titles, usage line items, a founder&rsquo;s description — are quoted and
            escaped to RFC 4180, rows are CRLF-terminated, and each file carries a
            UTF-8 byte-order mark so Excel opens rupee amounts and Tamil names
            correctly.
          </p>
        </Shell>
      </section>

      {/* ---- Role-based permissions ------------------------------------- */}
      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Role-based permissions"
            title="Four roles, and how an address resolves to one"
            lede="The brief names Alumni, Entrepreneurs, Admins and Guests. api.access.roleFor resolves any email to exactly one of them and reports why — an explicit grant, an inferred one, or the least-privileged default."
          />

          <TableFrame caption="The four roles" minWidth="min-w-[52rem]">
            <thead>
              <tr className="border-b border-line">
                <Th>Role</Th>
                <Th>Reaches</Th>
                <Th>How it is granted</Th>
              </tr>
            </thead>
            <tbody>
              {ROLES.map((role) => (
                <tr key={role.id} className="border-b border-line last:border-0">
                  <RowTh>
                    <span className="text-[0.9rem]">{role.label}</span>
                    <span className="font-mono mt-0.5 block text-[0.68rem] text-brass">
                      {role.id}
                    </span>
                  </RowTh>
                  <Td>
                    <span className="block max-w-[20rem] leading-relaxed">
                      {role.blurb}
                    </span>
                  </Td>
                  <Td tone="quiet">
                    <span className="block max-w-[24rem] leading-relaxed">
                      {ROLE_GRANTS[role.id]}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>

          <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_1.1fr]">
            <Card className="hover:border-line">
              <Eyebrow>Resolve a role</Eyebrow>
              <p className="mt-3 text-[0.875rem] leading-relaxed text-slate-ink">
                Look up what the server would decide for any address. This is a
                read: it changes nothing.
              </p>
              <form
                className="mt-5 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  setLookupEmail(roleInput.trim().toLowerCase());
                }}
              >
                <div>
                  <label className={labelClass} htmlFor="role-lookup-email">
                    Email address
                  </label>
                  <input
                    id="role-lookup-email"
                    name="email"
                    type="email"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="member@example.com"
                    value={roleInput}
                    onChange={(e) => setRoleInput(e.target.value)}
                    className={cx(inputClass, "mt-1.5")}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={!roleInput.trim()}>
                    Resolve role
                  </Button>
                  {lookupEmail ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setLookupEmail("");
                        setRoleInput("");
                      }}
                    >
                      Clear
                    </Button>
                  ) : null}
                </div>
              </form>
            </Card>

            <div className="border border-line bg-white p-6">
              <Eyebrow>Result</Eyebrow>
              {!lookupEmail ? (
                <p className="mt-3 text-[0.875rem] leading-relaxed text-slate-ink">
                  Nothing looked up yet. Every address that is not explicitly
                  granted a role, has not founded a venture and has no approved
                  verification resolves to <strong>Guest</strong> — the least
                  privileged answer is the safe default.
                </p>
              ) : resolvedRole === undefined ? (
                <p className="font-mono mt-3 text-[0.8rem] text-slate-ink">
                  Resolving {lookupEmail}…
                </p>
              ) : (
                <>
                  <p className="font-mono mt-3 break-all text-[0.8rem] text-ink">
                    {lookupEmail}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <span className="font-mono text-2xl tabular-nums text-maroon">
                      {ROLES.find((r) => r.id === resolvedRole.role)?.label ??
                        resolvedRole.role}
                    </span>
                    <Pill tone={resolvedRole.role === "admin" ? "maroon" : "quiet"}>
                      {resolvedRole.role}
                    </Pill>
                  </div>
                  <p className="mt-3 text-[0.875rem] leading-relaxed text-slate-ink">
                    {ROLE_SOURCES[resolvedRole.source] ?? resolvedRole.source}
                  </p>
                  <div className="mt-5 border-t border-line pt-4">
                    <p className={labelClass}>Copy a grant command</p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {ROLES.map((role) => (
                        <CopyButton
                          key={role.id}
                          text={setRoleCmd(lookupEmail, role.id)}
                          label={`Copy ${role.id}`}
                        />
                      ))}
                    </div>
                    <p className="mt-3 text-[0.8rem] leading-relaxed text-slate-ink">
                      <code className="font-mono">access:setRole</code> is an
                      internal mutation, so it runs from{" "}
                      <code className="font-mono">{CLI_CWD}</code> and never from a
                      browser. That is the whole reason nobody can grant themselves
                      the Admin role on an ungated route.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="mt-10 border-l-2 border-maroon bg-white p-6">
            <Eyebrow>Still required before deployment</Eyebrow>
            <p className="mt-3 max-w-3xl text-[0.95rem] leading-relaxed text-ink">
              Resolving a role is not the same as enforcing one.{" "}
              <code className="font-mono">/admin</code> renders for anybody, and the
              queries feeding it answer anybody. Enforcement means three things: an
              admin-only server wrapper that refuses the read for every other role,
              a redirect on this route, and the same check on the moderation
              mutations so they can graduate from the CLI to real buttons.
            </p>
          </div>
        </section>
      </Shell>

      {/* ---- Honest backlog --------------------------------------------- */}
      <section className="border-t border-line bg-bone-deep">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Not yet wired"
            title="What this panel still needs"
            lede="Listed as work rather than rendered as buttons that would do nothing."
          />
          <div className="grid gap-px bg-line sm:grid-cols-2">
            {[
              {
                t: "The access gate",
                c: "An admin-only query wrapper on the server plus a redirect on this route. Until it exists, the two queues on this page are world-readable — including roll numbers. This is the release blocker.",
              },
              {
                t: "Moderation as buttons",
                c: "Approve and reject already exist as internal mutations. Promoting them to guarded public mutations is a small change — but only after the gate above, and it should write an audit row naming who acted and when.",
              },
              {
                t: "SMS and push transports",
                c: "Email has a gateway. SMS has no provider at all and needs DLT-registered templates for India; push needs a service worker, a VAPID key pair and a subscription table that schema.ts does not have.",
              },
              {
                t: "Admin count queries",
                c: `The verified and mentoring splits still come off a ${SAMPLE_LIMIT}-row sample of the directory. Server-side counts would make them a census, and would also let member editing — verify, correct a batch, feature someone — live here.`,
              },
            ].map((item) => (
              <div key={item.t} className="bg-bone-deep p-7">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-display text-xl leading-snug text-ink">
                    {item.t}
                  </h3>
                  <Pill tone="maroon">Pending</Pill>
                </div>
                <p className="mt-2.5 text-[0.875rem] leading-relaxed text-slate-ink">
                  {item.c}
                </p>
              </div>
            ))}
          </div>
          <p className="font-mono mt-10 text-[0.72rem] uppercase tracking-[0.14em] text-slate-ink">
            {RITAA.shortName} · Admin panel · {RITAA.email}
          </p>
        </Shell>
      </section>
    </>
  );
}
