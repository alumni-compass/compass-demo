"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";

import {
  Button,
  Card,
  Empty,
  Eyebrow,
  LoadingRows,
  Meter,
  Monogram,
  PageHeader,
  Pill,
  SectionHead,
  Shell,
  Stat,
} from "@/components/kit";
import { BATCH_YEARS, formatDate, inr, RITAA } from "@/lib/site";

/**
 * Module 8 — Fundraising & Giving.
 *
 * Four jobs, in this order: show what is being raised, show where the last rupee
 * went, publish the reports that let anyone check that claim, then ask. The
 * tracker and the reporting section both sit above the donation panel on
 * purpose — the brief's transparency requirement is the reason anyone gives
 * twice.
 *
 * Reporting reads from `givingReports.ts`, which is query-only and applies the
 * same anonymity rule as `giving.donorWall`: an anonymous gift keeps its amount
 * and its date, and never publishes a name or a cohort. Batch totals put those
 * gifts in a withheld row rather than under the donor's real batch, so a cohort
 * with one anonymous gift cannot be worked backwards.
 *
 * On payments: this portal has no gateway wired up. `giving.recordDonation` is a
 * ledger write meant for a verified gateway webhook, so calling it from the
 * browser would let anybody fabricate a gift and inflate the campaign totals.
 * The panel below therefore collects the donor's intent and hands it to the
 * association by email. Nothing here charges a card or claims to.
 */

type Campaign = FunctionReturnType<typeof api.giving.listCampaigns>[number];
type Donor = FunctionReturnType<typeof api.giving.donorWall>[number];
type FundSummary = FunctionReturnType<typeof api.givingReports.fundUsageSummary>;
type BatchReport = FunctionReturnType<typeof api.givingReports.givingByBatch>;
type Timeline = FunctionReturnType<typeof api.givingReports.givingTimeline>;

/** The methods the brief names: UPI, credit/debit and wallets, plus netbanking. */
const METHODS = [
  { id: "upi", label: "UPI", hint: "GPay, PhonePe, Paytm, any BHIM app" },
  { id: "card", label: "Credit / debit card", hint: "Visa, Mastercard or RuPay" },
  { id: "netbanking", label: "Netbanking", hint: "NEFT, IMPS or a bank transfer" },
  { id: "wallet", label: "Wallet", hint: "Amazon Pay, Mobikwik and similar" },
] as const;

type MethodId = (typeof METHODS)[number]["id"];

const PRESET_AMOUNTS = [500, 1000, 2500, 5000];

/** Used when a donor would rather the association decide the allocation. */
const UNRESTRICTED = "Wherever it is needed most";

const FIELD =
  "w-full border border-line bg-bone px-3 py-2.5 text-[0.9rem] text-ink placeholder:text-slate-ink/60";
const FIELD_LABEL =
  "font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink";
const TH =
  "font-mono px-5 py-3 text-[0.68rem] font-normal uppercase tracking-[0.12em] text-slate-ink";
const TD = "px-5 py-3 text-[0.84rem]";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function methodLabel(id: MethodId) {
  return METHODS.find((m) => m.id === id)?.label ?? id;
}

/**
 * Builds the message the donor sends to the association. Deliberately phrased as
 * a request for payment details — never as a receipt.
 */
function giftMailto(input: {
  amountInr: number;
  method: MethodId;
  campaign: string;
  donorName: string;
  batch: string;
  anonymous: boolean;
  message: string;
}) {
  const subject = `Gift of ${inr(input.amountInr)} — ${input.campaign}`;
  const body = [
    `I would like to give ${inr(input.amountInr)} to ${RITAA.shortName}.`,
    "",
    `Campaign: ${input.campaign}`,
    `Amount: ${inr(input.amountInr)}`,
    `Preferred payment method: ${methodLabel(input.method)}`,
    `Donor wall name: ${
      input.anonymous
        ? "Withheld — please list this gift as anonymous"
        : input.donorName.trim() || "(not given)"
    }`,
    `Batch: ${input.batch || "(not stated)"}`,
    `Message for the donor wall: ${input.message.trim() || "(none)"}`,
    "",
    "Please send me the payment details for that method and confirm once the gift has been received.",
  ].join("\n");
  return `mailto:${RITAA.email}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

/** Fully funded outranks closed: a campaign that hit its goal reads as a win. */
function StatusPill({ active, progress }: { active: boolean; progress: number }) {
  if (progress >= 1) return <Pill tone="jade">Fully funded</Pill>;
  if (!active) return <Pill tone="quiet">Closed</Pill>;
  return null;
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "font-mono inline-flex items-center gap-2 border px-3 py-1.5 text-[0.7rem] uppercase tracking-[0.12em] transition-colors",
        active
          ? "border-maroon bg-maroon text-bone"
          : "border-line bg-white text-slate-ink hover:border-brass hover:text-ink",
      )}
    >
      {label}
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const closed = !campaign.active;
  return (
    <article className={cx("p-7", closed ? "bg-bone-deep" : "bg-white")}>
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>{campaign.cause}</Eyebrow>
        {/* Both halves of the brief's "by batch/cause" are stated outright, so a
            batch fund is never mistaken for an institute-wide appeal. */}
        {campaign.batch ? (
          <Pill tone="brass">{campaign.batch} batch fund</Pill>
        ) : (
          <Pill tone="quiet">Institute-wide</Pill>
        )}
        <StatusPill active={campaign.active} progress={campaign.progress} />
      </div>

      <h4 className="font-display mt-3 text-xl leading-snug text-ink">
        <Link href={`/giving/${campaign.slug}`} className="hover:text-maroon">
          {campaign.title}
        </Link>
      </h4>
      <p className="mt-2.5 text-[0.9rem] leading-relaxed text-slate-ink">
        {campaign.summary}
      </p>

      <div className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
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
            tone={campaign.progress >= 1 ? "jade" : closed ? "maroon" : "jade"}
          />
        </div>
        <dl className="font-mono mt-3 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[0.72rem] text-slate-ink">
          <div className="flex gap-2">
            <dt>Donors</dt>
            <dd className="tabular-nums text-ink">{campaign.donorCount}</dd>
          </div>
          <div className="flex gap-2">
            <dt>Raised</dt>
            <dd className="tabular-nums text-ink">{inr(campaign.raisedInr)}</dd>
          </div>
          {campaign.closesAt ? (
            <div className="flex gap-2">
              <dt>{closed ? "Closed" : "Closes"}</dt>
              <dd className="tabular-nums text-ink">
                {formatDate(campaign.closesAt)}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="mt-5">
        <Link
          href={`/giving/${campaign.slug}`}
          className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-brass hover:text-maroon"
        >
          Campaign page &amp; fund usage →
        </Link>
      </div>
    </article>
  );
}

/**
 * The transparency centrepiece: every line the association has spent, with the
 * unspent remainder stated plainly rather than left to arithmetic.
 */
function AllocationBreakdown({
  raisedInr,
  allocated,
  allocations,
}: {
  raisedInr: number;
  allocated: number;
  allocations: readonly { label: string; amountInr: number }[];
}) {
  // Bars are drawn against whichever is larger so no line ever overflows the
  // track, and an over-allocated campaign still reads honestly. The `1` floor is
  // what keeps a campaign that has raised nothing from dividing by zero.
  const scale = Math.max(raisedInr, allocated, 1);
  const unallocated = raisedInr - allocated;
  const overBy = Math.max(0, -unallocated);

  return (
    <div>
      {allocations.length === 0 ? (
        <p className="text-[0.88rem] leading-relaxed text-slate-ink">
          Nothing has been spent from this fund yet. Each disbursement is published
          here — line item, amount and share of the total — as the association
          releases it.
        </p>
      ) : (
        <ul className="space-y-4">
          {allocations.map((line, i) => {
            const share = line.amountInr / scale;
            return (
              <li key={`${line.label}-${i}`}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[0.9rem] leading-snug text-ink">
                    {line.label}
                  </span>
                  <span className="font-mono shrink-0 text-[0.8rem] tabular-nums text-ink">
                    {inr(line.amountInr)}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-1.5 flex-1 bg-bone-deep">
                    <div
                      className="h-full bg-brass"
                      style={{ width: `${Math.min(100, share * 100)}%` }}
                    />
                  </div>
                  <span className="font-mono w-9 shrink-0 text-right text-[0.7rem] tabular-nums text-slate-ink">
                    {Math.round(share * 100)}%
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <dl className="font-mono mt-6 space-y-2 border-t border-line pt-4 text-[0.75rem]">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-ink">Raised</dt>
          <dd className="tabular-nums text-ink">{inr(raisedInr)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-ink">Allocated &amp; spent</dt>
          <dd className="tabular-nums text-ink">{inr(allocated)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-ink">
            {overBy > 0 ? "Committed beyond funds raised" : "Still unallocated"}
          </dt>
          <dd
            className={cx("tabular-nums", overBy > 0 ? "text-maroon" : "text-jade")}
          >
            {inr(Math.abs(unallocated))}
          </dd>
        </div>
      </dl>

      {/* Over-allocation is a finding, not a rendering bug: say so in words and
          keep the meter honest rather than letting a bar run off its track. */}
      {overBy > 0 ? (
        <p
          role="status"
          className="mt-4 border border-maroon/30 bg-maroon/8 p-3 text-[0.82rem] leading-relaxed text-ink"
        >
          <span className="font-mono block text-[0.68rem] uppercase tracking-[0.12em] text-maroon">
            Over-allocated
          </span>
          <span className="mt-1 block">
            Published spending is {inr(overBy)} more than this campaign has
            received. Either a gift is still to be reconciled against the ledger,
            or the balance is being met from another fund. Ask the association at{" "}
            {RITAA.email} which applies here.
          </span>
        </p>
      ) : null}

      {raisedInr > 0 ? (
        <div className="mt-4">
          <Meter
            value={allocated / raisedInr}
            label={
              overBy > 0
                ? "Spent of funds raised — over-committed"
                : "Spent of funds raised"
            }
            tone={overBy > 0 ? "maroon" : "brass"}
          />
        </div>
      ) : (
        <p className="font-mono mt-4 text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink">
          Nothing raised yet — no share to report
        </p>
      )}
    </div>
  );
}

/* ---- Transparent reporting ---------------------------------------- */

/** Zero stays flat; anything given gets a visible mark however small it is. */
function barHeight(share: number, totalInr: number) {
  if (totalInr <= 0) return 0;
  return Math.max(2, Math.min(100, share * 100));
}

/**
 * Month-by-month momentum, drawn from plain divs — no charting dependency.
 * `givingTimeline` returns contiguous months with each one already measured
 * against the peak, so an empty month keeps its slot on the axis instead of
 * silently closing the gap.
 */
function GivingMomentum({ report }: { report: Timeline }) {
  return (
    <div className="border border-line bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line p-6 sm:p-7">
        <h3 className="font-display text-xl text-ink">Month by month</h3>
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] tabular-nums text-slate-ink">
          Last {report.windowMonths} months · {inr(report.totalInr)}
        </span>
      </div>

      {report.giftCount === 0 ? (
        <p className="p-6 text-[0.88rem] leading-relaxed text-slate-ink sm:p-7">
          No gifts have been itemised in the last {report.windowMonths} months.
          Campaign totals can still move — money received in bulk is recorded
          against the campaign rather than gift by gift.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto p-6 sm:p-7">
            <ul className="flex min-w-[38rem] items-end gap-2">
              {report.months.map((month, i) => {
                const yearChanged =
                  i === 0 || report.months[i - 1]?.year !== month.year;
                return (
                  <li
                    key={month.key}
                    className="flex flex-1 flex-col items-center gap-1.5"
                  >
                    <span className="font-mono text-[0.65rem] tabular-nums text-ink">
                      {month.totalInr > 0
                        ? inr(month.totalInr, { compact: true })
                        : "—"}
                    </span>
                    <div
                      aria-hidden
                      className="flex h-32 w-full items-end bg-bone-deep"
                    >
                      <div
                        className="w-full bg-maroon"
                        style={{
                          height: `${barHeight(month.share, month.totalInr)}%`,
                        }}
                      />
                    </div>
                    <span className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-slate-ink">
                      {month.shortLabel}
                    </span>
                    <span className="font-mono text-[0.6rem] tabular-nums text-brass">
                      {/* A blank line still occupies a line box, so every column keeps
                          the same height and the bars share one baseline. */}
                      {yearChanged ? month.year : "\u00a0"}
                    </span>
                    <span className="sr-only">
                      {month.label}: {inr(month.totalInr)} from {month.giftCount}{" "}
                      gift{month.giftCount === 1 ? "" : "s"}.
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <dl className="font-mono grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line px-6 py-4 text-[0.72rem] sm:grid-cols-3 sm:px-7">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-ink">Best month</dt>
              <dd className="tabular-nums text-ink">
                {report.peakLabel ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-ink">Peak</dt>
              <dd className="tabular-nums text-ink">{inr(report.peakInr)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-ink">Months with gifts</dt>
              <dd className="tabular-nums text-ink">
                {report.activeMonths} of {report.windowMonths}
              </dd>
            </div>
          </dl>

          {report.beforeWindowCount > 0 ? (
            <p className="border-t border-line px-6 py-4 text-[0.82rem] leading-relaxed text-slate-ink sm:px-7">
              A further {inr(report.beforeWindowInr)} across{" "}
              {report.beforeWindowCount} gift
              {report.beforeWindowCount === 1 ? "" : "s"} predates this window and
              is not drawn above. It is still counted in the campaign totals.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Giving by cohort — the figure a batch representative actually asks for.
 * Anonymous gifts sit in their own withheld row; see the note under the table.
 */
function BatchGivingTable({ report }: { report: BatchReport }) {
  return (
    <div className="border border-line bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line p-6 sm:p-7">
        <h3 className="font-display text-xl text-ink">Giving by batch</h3>
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] tabular-nums text-slate-ink">
          {report.batchesRepresented} cohort
          {report.batchesRepresented === 1 ? "" : "s"} · {inr(report.totalInr)}
        </span>
      </div>

      {report.rows.length === 0 ? (
        <p className="p-6 text-[0.88rem] leading-relaxed text-slate-ink sm:p-7">
          No gifts have been itemised yet, so there is nothing to break down by
          cohort. The table fills itself in as the treasurer records gifts against
          donors.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left">
            <caption className="sr-only">
              Total given, donors, gifts and share of all itemised giving, by
              graduating batch.
            </caption>
            <thead>
              <tr className="border-b border-line bg-bone">
                <th scope="col" className={TH}>
                  Batch
                </th>
                <th scope="col" className={cx(TH, "text-right")}>
                  Given
                </th>
                <th scope="col" className={cx(TH, "text-right")}>
                  Donors
                </th>
                <th scope="col" className={cx(TH, "text-right")}>
                  Gifts
                </th>
                <th scope="col" className={TH}>
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.key} className="border-b border-line last:border-0">
                  <th
                    scope="row"
                    className={cx(TD, "font-normal text-ink whitespace-nowrap")}
                  >
                    {row.label}
                  </th>
                  <td
                    className={cx(
                      TD,
                      "font-mono text-right tabular-nums text-maroon",
                    )}
                  >
                    {inr(row.totalInr)}
                  </td>
                  <td
                    className={cx(TD, "font-mono text-right tabular-nums text-ink")}
                  >
                    {row.donorCount}
                  </td>
                  <td
                    className={cx(TD, "font-mono text-right tabular-nums text-ink")}
                  >
                    {row.giftCount}
                  </td>
                  <td className={TD}>
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 w-24 shrink-0 bg-bone-deep sm:w-32">
                        <div
                          className="h-full bg-brass"
                          style={{
                            width: `${Math.min(100, row.peakShare * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="font-mono w-9 shrink-0 text-right text-[0.7rem] tabular-nums text-slate-ink">
                        {Math.round(row.share * 100)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-bone">
                <th scope="row" className={TH}>
                  All rows
                </th>
                <td
                  className={cx(TD, "font-mono text-right tabular-nums text-ink")}
                >
                  {inr(report.totalInr)}
                </td>
                <td
                  className={cx(
                    TD,
                    "font-mono text-right tabular-nums text-slate-ink",
                  )}
                >
                  —
                </td>
                <td
                  className={cx(TD, "font-mono text-right tabular-nums text-ink")}
                >
                  {report.giftCount}
                </td>
                <td className={TD} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="border-t border-line px-6 py-4 text-[0.82rem] leading-relaxed text-slate-ink sm:px-7">
        Gifts given anonymously are counted under <em>Batch withheld</em>, never
        under the donor&rsquo;s own cohort — a batch with a single anonymous gift
        would otherwise publish that donor&rsquo;s year and amount in the same
        row. Donors are counted once per batch however many times they gave.
      </p>
    </div>
  );
}

/** Fund-wide statement: raised, spent, and what is left of the difference. */
function FundStatement({ summary }: { summary: FundSummary }) {
  return (
    <>
      <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white p-6">
          <Stat
            value={inr(summary.reportedRaisedInr)}
            label="Raised across every campaign"
          />
        </div>
        <div className="bg-white p-6">
          <Stat value={inr(summary.allocatedInr)} label="Allocated and spent" />
        </div>
        <div className="bg-white p-6">
          <Stat
            value={inr(summary.unallocatedInr)}
            label="Raised and not yet spent"
          />
        </div>
        <div className="bg-white p-6">
          <Stat
            value={summary.allocationLineCount}
            label="Spending lines published"
          />
        </div>
      </div>

      <div className="mt-8 border border-line bg-white p-6 sm:p-7">
        <Meter
          value={summary.allocationShare}
          label="Spent of everything raised"
          tone="brass"
        />
        <p className="mt-5 text-[0.88rem] leading-relaxed text-slate-ink">
          {inr(summary.itemisedInr)} of that total is listed gift by gift on the
          donor wall, across {summary.itemisedGiftCount} recorded gift
          {summary.itemisedGiftCount === 1 ? "" : "s"}.{" "}
          {summary.aggregateInr > 0
            ? `The remaining ${inr(
                summary.aggregateInr,
              )} reached the association in bulk — batch collections, cheques and drives that the treasurer records against the campaign rather than as individual donors.`
            : "Every rupee on the register is accounted for gift by gift."}
        </p>

        {summary.overAllocated.length > 0 ? (
          <div
            role="status"
            className="mt-5 border border-maroon/30 bg-maroon/8 p-4"
          >
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-maroon">
              {summary.overAllocated.length} campaign
              {summary.overAllocated.length === 1 ? "" : "s"} over-allocated
            </p>
            <ul className="mt-3 space-y-1.5">
              {summary.overAllocated.map((c) => (
                <li key={c.slug} className="text-[0.85rem] leading-snug text-ink">
                  <Link
                    href={`/giving/${c.slug}`}
                    className="text-maroon underline decoration-brass/50 underline-offset-4"
                  >
                    {c.title}
                  </Link>{" "}
                  has published {inr(c.overByInr)} more in spending than it has
                  raised.
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * Donation panel. Collects amount, method and recognition preferences, then
 * hands them to the association by email. It never writes to the ledger.
 */
function DonatePanel({ campaignTitles }: { campaignTitles: string[] }) {
  const [campaign, setCampaign] = useState("");
  const [amount, setAmount] = useState("1000");
  const [method, setMethod] = useState<MethodId>("upi");
  const [anonymous, setAnonymous] = useState(false);
  const [donorName, setDonorName] = useState("");
  const [batch, setBatch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draftHref, setDraftHref] = useState<string | null>(null);

  // Campaign choices arrive asynchronously, so resolve rather than sync state:
  // an untouched select simply follows the first campaign once it loads.
  const choices = [...new Set(campaignTitles), UNRESTRICTED];
  const selectedCampaign = choices.includes(campaign)
    ? campaign
    : (choices[0] ?? UNRESTRICTED);

  const parsed = Number(amount);
  const amountValid = Number.isFinite(parsed) && parsed > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!amountValid) {
      setDraftHref(null);
      setError(
        "Enter an amount greater than ₹0 — a whole number of rupees, for example 1000.",
      );
      return;
    }
    setError(null);
    const href = giftMailto({
      amountInr: Math.round(parsed),
      method,
      campaign: selectedCampaign,
      donorName,
      batch,
      anonymous,
      message,
    });
    setDraftHref(href);
    window.location.href = href;
  }

  return (
    <Card className="p-6 sm:p-8">
      <form onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="gift-campaign" className={FIELD_LABEL}>
            Campaign
          </label>
          <select
            id="gift-campaign"
            name="campaign"
            value={selectedCampaign}
            onChange={(e) => setCampaign(e.target.value)}
            className={cx(FIELD, "mt-2")}
          >
            {choices.map((title) => (
              <option key={title} value={title}>
                {title}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="mt-6">
          <legend className={FIELD_LABEL}>Amount</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESET_AMOUNTS.map((preset) => {
              const active = Math.round(parsed) === preset && amountValid;
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setAmount(String(preset));
                    setError(null);
                  }}
                  className={cx(
                    "font-mono border px-3 py-1.5 text-[0.72rem] tabular-nums uppercase tracking-[0.12em] transition-colors",
                    active
                      ? "border-maroon bg-maroon text-bone"
                      : "border-line bg-bone text-slate-ink hover:border-brass hover:text-ink",
                  )}
                >
                  {inr(preset)}
                </button>
              );
            })}
          </div>
          <label htmlFor="gift-amount" className="mt-4 block">
            <span className={FIELD_LABEL}>Or another amount (₹)</span>
          </label>
          <input
            id="gift-amount"
            name="amount"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "gift-amount-error" : undefined}
            className={cx(FIELD, "font-mono mt-2 tabular-nums")}
          />
          {error ? (
            <p
              id="gift-amount-error"
              role="alert"
              className="mt-2 text-[0.82rem] leading-snug text-maroon"
            >
              {error}
            </p>
          ) : null}
        </fieldset>

        <fieldset className="mt-6">
          <legend className={FIELD_LABEL}>Payment method</legend>
          <p className="mt-1 text-[0.82rem] leading-snug text-slate-ink">
            Whichever you pick is carried into the request, so the association
            replies with the details for that rail rather than a generic account
            number.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {METHODS.map((option) => (
              <label
                key={option.id}
                className={cx(
                  "flex cursor-pointer items-start gap-2.5 border p-3 transition-colors",
                  method === option.id
                    ? "border-maroon bg-bone"
                    : "border-line bg-bone hover:border-brass",
                )}
              >
                <input
                  type="radio"
                  name="method"
                  value={option.id}
                  checked={method === option.id}
                  onChange={() => setMethod(option.id)}
                  className="mt-0.5 accent-maroon"
                />
                <span>
                  <span className="font-mono block text-[0.72rem] uppercase tracking-[0.12em] text-ink">
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[0.78rem] leading-snug text-slate-ink">
                    {option.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="gift-name" className={FIELD_LABEL}>
              Name for the donor wall
            </label>
            <input
              id="gift-name"
              name="donorName"
              type="text"
              autoComplete="name"
              value={donorName}
              onChange={(e) => setDonorName(e.target.value)}
              disabled={anonymous}
              placeholder={anonymous ? "Withheld" : "Optional"}
              className={cx(FIELD, "mt-2 disabled:opacity-50")}
            />
          </div>
          <div>
            <label htmlFor="gift-batch" className={FIELD_LABEL}>
              Your batch
            </label>
            <select
              id="gift-batch"
              name="batch"
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              className={cx(FIELD, "font-mono mt-2 tabular-nums")}
            >
              <option value="">Prefer not to say</option>
              {[...BATCH_YEARS].reverse().map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="mt-5 flex items-start gap-2.5">
          <input
            type="checkbox"
            name="anonymous"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
            className="mt-1 accent-maroon"
          />
          <span className="text-[0.88rem] leading-snug text-ink">
            Give anonymously — the gift still counts on the wall, the name does not
            appear.
          </span>
        </label>

        <div className="mt-5">
          <label htmlFor="gift-message" className={FIELD_LABEL}>
            Message for the donor wall
          </label>
          <textarea
            id="gift-message"
            name="message"
            rows={3}
            maxLength={240}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Optional. A line about why you gave."
            className={cx(FIELD, "mt-2 resize-y")}
          />
          <p className="font-mono mt-1 text-right text-[0.68rem] tabular-nums text-slate-ink">
            {message.length}/240
          </p>
        </div>

        <div className="mt-6 border-t border-line pt-6">
          <p className="font-mono text-[0.72rem] tabular-nums text-ink">
            {amountValid ? inr(Math.round(parsed)) : "₹—"} ·{" "}
            {methodLabel(method)} · {selectedCampaign}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="submit">Send my gift details</Button>
            <span className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-slate-ink">
              No payment on this page
            </span>
          </div>
        </div>

        {draftHref ? (
          <div className="mt-5 border border-jade/30 bg-jade/5 p-4">
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-jade">
              Email draft opened
            </p>
            <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
              Your mail app should now hold a message to {RITAA.email} with these
              details. Nothing has been charged. The association replies with the
              payment details for {methodLabel(method)}, and the gift joins the
              totals once the payment is confirmed. If no draft opened,{" "}
              <a
                href={draftHref}
                className="text-maroon underline decoration-brass/50 underline-offset-4"
              >
                open it again
              </a>{" "}
              or write to {RITAA.email} directly.
            </p>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

function DonorEntry({ donor }: { donor: Donor }) {
  // `donorWall` already substitutes this exact label for anonymous gifts, and
  // withholds the batch — so there is no real name here to derive initials from.
  const anonymous = donor.donorName === "Anonymous donor";

  return (
    <li className="bg-white p-6">
      <div className="flex items-start gap-4">
        {anonymous ? (
          <span
            aria-hidden
            className="font-mono inline-flex size-12 shrink-0 items-center justify-center border border-line bg-bone text-slate-ink"
          >
            ·
          </span>
        ) : (
          <Monogram name={donor.donorName} />
        )}
        <div className="min-w-0">
          <p className="text-[0.95rem] leading-snug text-ink">{donor.donorName}</p>
          <p className="font-mono mt-1 text-[0.7rem] tabular-nums text-brass">
            {donor.batch ? `Batch ${donor.batch}` : "Batch withheld"} ·{" "}
            {formatDate(donor.createdAt)}
          </p>
        </div>
        <span className="font-mono ml-auto shrink-0 text-[0.9rem] tabular-nums text-maroon">
          {inr(donor.amountInr)}
        </span>
      </div>
      {donor.message ? (
        <p className="mt-4 border-l-2 border-brass/40 pl-3 text-[0.86rem] leading-relaxed text-slate-ink">
          {donor.message}
        </p>
      ) : null}
    </li>
  );
}

export default function GivingPage() {
  // Everything is fetched — closed campaigns included — because the fund usage
  // tracker is most useful for the campaigns that have finished spending.
  const campaigns = useQuery(api.giving.listCampaigns, {});
  const totals = useQuery(api.giving.givingTotals);
  const donors = useQuery(api.giving.donorWall, { limit: 24 });

  // Transparent reporting — read-only, anonymity applied server side.
  const fund = useQuery(api.givingReports.fundUsageSummary, {});
  const byBatch = useQuery(api.givingReports.givingByBatch, {});
  const timeline = useQuery(api.givingReports.givingTimeline, { months: 12 });

  const [status, setStatus] = useState<"all" | "open" | "closed">("all");
  const [cause, setCause] = useState<string>("all");
  const [batch, setBatch] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<"cause" | "batch">("cause");

  const all = campaigns ?? [];

  const {
    byStatus,
    causeCounts,
    batchCounts,
    visible,
    groups,
    openCount,
    closedCount,
    causeGroupCount,
    batchGroupCount,
  } = useMemo(() => {
    const openCount = all.filter((c) => c.active).length;

    const byStatus = all.filter((c) =>
      status === "all" ? true : status === "open" ? c.active : !c.active,
    );

    const causeCounts = new Map<string, number>();
    for (const c of byStatus) {
      causeCounts.set(c.cause, (causeCounts.get(c.cause) ?? 0) + 1);
    }

    const byCause = byStatus.filter((c) => cause === "all" || c.cause === cause);

    const batchCounts = new Map<string, number>();
    for (const c of byCause) {
      const key = c.batch ? String(c.batch) : "none";
      batchCounts.set(key, (batchCounts.get(key) ?? 0) + 1);
    }

    const visible = byCause.filter((c) => {
      if (batch === "all") return true;
      if (batch === "none") return !c.batch;
      return String(c.batch) === batch;
    });

    // The brief asks for campaign pages "by batch/cause", so both are real
    // groupings rather than one axis with the other left to a filter.
    const grouped = new Map<string, Campaign[]>();
    for (const c of visible) {
      const key =
        groupBy === "batch"
          ? c.batch
            ? `${c.batch} batch`
            : "Institute-wide"
          : c.cause;
      const list = grouped.get(key);
      if (list) list.push(c);
      else grouped.set(key, [c]);
    }

    // Causes read alphabetically; cohorts read newest first with the
    // institute-wide bucket last, which is how the association lists them.
    const groups = [...grouped.entries()].sort((a, b) => {
      if (groupBy === "cause") return a[0].localeCompare(b[0]);
      const yearA = Number.parseInt(a[0], 10);
      const yearB = Number.parseInt(b[0], 10);
      if (Number.isNaN(yearA)) return 1;
      if (Number.isNaN(yearB)) return -1;
      return yearB - yearA;
    });

    return {
      byStatus,
      causeCounts,
      batchCounts,
      visible,
      groups,
      openCount,
      closedCount: all.length - openCount,
      causeGroupCount: new Set(visible.map((c) => c.cause)).size,
      batchGroupCount: new Set(
        visible.map((c) => (c.batch ? String(c.batch) : "none")),
      ).size,
    };
  }, [all, status, cause, batch, groupBy]);

  const filtered = status !== "all" || cause !== "all" || batch !== "all";

  function clearFilters() {
    setStatus("all");
    setCause("all");
    setBatch("all");
  }

  const campaignTitles = all.filter((c) => c.active).map((c) => c.title);
  const overall =
    totals && totals.goalInr > 0
      ? Math.min(1, totals.raisedInr / totals.goalInr)
      : 0;

  return (
    <>
      <PageHeader
      image="/campus-5.jpg"
        module="Module 8 · Fundraising & Giving"
        title="Fund a scholarship, a lab, or a batch's promise — then watch it get spent."
        lede="RITAA runs campaigns by cause and by batch. Every campaign publishes its goal, its donors and a line-by-line record of what the money paid for — alongside batch-wise and month-by-month reports anyone can check against the ledger."
      >
        <div className="flex flex-wrap gap-3">
          <Button href="#donate" variant="onDark">
            Give now
          </Button>
          <Button
            href="#tracker"
            variant="ghost"
            className="!text-brass-soft hover:!text-bone"
          >
            See where the money went →
          </Button>
        </div>
      </PageHeader>

      {/* ---- Totals across every campaign -------------------------------- */}
      <section className="border-b border-line bg-white">
        <Shell>
          <div className="grid grid-cols-2 gap-8 py-10 sm:grid-cols-4">
            <Stat
              value={totals ? inr(totals.raisedInr) : "—"}
              label="Raised across all campaigns"
            />
            <Stat
              value={totals ? inr(totals.goalInr) : "—"}
              label="Combined goal"
            />
            <Stat value={totals?.donors ?? "—"} label="Gifts recorded" />
            <Stat
              value={totals?.activeCampaigns ?? "—"}
              label="Campaigns open now"
            />
          </div>
          <div className="pb-10">
            <Meter value={overall} label="Total raised against total goal" />
          </div>
        </Shell>
      </section>

      {/* ---- Campaigns, grouped by cause and filterable by batch ---------- */}
      <Shell>
        <section id="campaigns" className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Campaigns"
            title="Every campaign, by cause and by batch"
            lede="Batch funds are raised by a single cohort for their juniors. Institute-wide campaigns are open to everyone."
          />

          {campaigns === undefined ? (
            <LoadingRows rows={4} />
          ) : all.length === 0 ? (
            <Empty
              title="No campaigns are open yet"
              hint="The association announces new funds at the general body meeting. Until then, an unrestricted gift still helps."
              action={<Button href="#donate">Give to the general fund</Button>}
            />
          ) : (
            <>
              <div className="space-y-4 border-y border-line py-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono mr-1 text-[0.68rem] uppercase tracking-[0.14em] text-slate-ink">
                    Status
                  </span>
                  <FilterChip
                    label="All"
                    count={all.length}
                    active={status === "all"}
                    onClick={() => setStatus("all")}
                  />
                  <FilterChip
                    label="Open"
                    count={openCount}
                    active={status === "open"}
                    onClick={() => setStatus("open")}
                  />
                  <FilterChip
                    label="Closed"
                    count={closedCount}
                    active={status === "closed"}
                    onClick={() => setStatus("closed")}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono mr-1 text-[0.68rem] uppercase tracking-[0.14em] text-slate-ink">
                    Cause
                  </span>
                  <FilterChip
                    label="All causes"
                    count={byStatus.length}
                    active={cause === "all"}
                    onClick={() => setCause("all")}
                  />
                  {[...causeCounts.entries()]
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([name, count]) => (
                      <FilterChip
                        key={name}
                        label={name}
                        count={count}
                        active={cause === name}
                        onClick={() => setCause(name)}
                      />
                    ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono mr-1 text-[0.68rem] uppercase tracking-[0.14em] text-slate-ink">
                    Batch
                  </span>
                  <FilterChip
                    label="Any batch"
                    count={[...batchCounts.values()].reduce((s, n) => s + n, 0)}
                    active={batch === "all"}
                    onClick={() => setBatch("all")}
                  />
                  {batchCounts.has("none") ? (
                    <FilterChip
                      label="Institute-wide"
                      count={batchCounts.get("none") ?? 0}
                      active={batch === "none"}
                      onClick={() => setBatch("none")}
                    />
                  ) : null}
                  {[...BATCH_YEARS]
                    .reverse()
                    .filter((year) => batchCounts.has(String(year)))
                    .map((year) => (
                      <FilterChip
                        key={year}
                        label={String(year)}
                        count={batchCounts.get(String(year)) ?? 0}
                        active={batch === String(year)}
                        onClick={() => setBatch(String(year))}
                      />
                    ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono mr-1 text-[0.68rem] uppercase tracking-[0.14em] text-slate-ink">
                    Group by
                  </span>
                  <FilterChip
                    label="Cause"
                    count={causeGroupCount}
                    active={groupBy === "cause"}
                    onClick={() => setGroupBy("cause")}
                  />
                  <FilterChip
                    label="Batch"
                    count={batchGroupCount}
                    active={groupBy === "batch"}
                    onClick={() => setGroupBy("batch")}
                  />
                </div>
              </div>

              {visible.length === 0 ? (
                <div className="mt-10">
                  <Empty
                    title="Nothing matches that combination"
                    hint="Try a different cause or batch — or clear the filters to see every campaign the association has run."
                    action={
                      <Button variant="outline" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    }
                  />
                </div>
              ) : (
                <div className="mt-10">
                  {groups.map(([groupLabel, list]) => (
                    <div key={groupLabel} className="mt-12 first:mt-0">
                      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
                        <h3 className="font-display text-xl text-ink">
                          {groupLabel}
                        </h3>
                        <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] tabular-nums text-slate-ink">
                          {list.length} campaign{list.length === 1 ? "" : "s"} ·{" "}
                          {inr(
                            list.reduce((s, c) => s + c.raisedInr, 0),
                            { compact: true },
                          )}{" "}
                          raised
                        </span>
                      </div>
                      <div className="mt-6 grid gap-px bg-line lg:grid-cols-2">
                        {list.map((c) => (
                          <CampaignCard key={c._id} campaign={c} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </Shell>

      {/* ---- Fund usage tracker ------------------------------------------ */}
      <section id="tracker" className="border-y border-line bg-white">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Fund usage tracker"
            title="Where every rupee went"
            lede="Published by the treasurer, campaign by campaign. Shares are measured against the amount raised, so anything not yet spent shows up as unallocated rather than disappearing."
            action={
              <Button href="#reporting" variant="outline">
                Batch &amp; monthly report
              </Button>
            }
          />

          {campaigns === undefined ? (
            <LoadingRows rows={3} />
          ) : visible.length === 0 ? (
            <Empty
              title="No spending to report under these filters"
              hint={
                filtered
                  ? "Clear the campaign filters above to see the full ledger."
                  : "Allocations appear here as soon as the first campaign disburses funds."
              }
              action={
                filtered ? (
                  <Button variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-px bg-line lg:grid-cols-2">
              {visible.map((c) => (
                <div key={c._id} className="bg-white p-7">
                  <div className="flex flex-wrap items-center gap-2">
                    <Eyebrow>{c.cause}</Eyebrow>
                    {c.batch ? (
                      <Pill tone="brass">{c.batch} batch fund</Pill>
                    ) : (
                      <Pill tone="quiet">Institute-wide</Pill>
                    )}
                    <StatusPill active={c.active} progress={c.progress} />
                  </div>
                  <h3 className="font-display mt-3 text-xl leading-snug text-ink">
                    <Link
                      href={`/giving/${c.slug}`}
                      className="hover:text-maroon"
                    >
                      {c.title}
                    </Link>
                  </h3>
                  <p className="font-mono mt-2 text-[0.72rem] tabular-nums text-slate-ink">
                    {c.allocations.length} line
                    {c.allocations.length === 1 ? "" : "s"} · {c.donorCount} donors
                  </p>
                  <div className="mt-5">
                    <AllocationBreakdown
                      raisedInr={c.raisedInr}
                      allocated={c.allocated}
                      allocations={c.allocations}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Shell>
      </section>

      {/* ---- Transparent reporting --------------------------------------- */}
      <Shell>
        <section id="reporting" className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Transparent reporting"
            title="The whole fund, open to inspection"
            lede="Three reports the association publishes without being asked: what has been raised against what has been spent, which cohorts gave it, and when it arrived. All of it is read-only and computed from the same ledger the donor wall is drawn from."
          />

          {fund === undefined ? (
            <LoadingRows rows={2} />
          ) : (
            <FundStatement summary={fund} />
          )}

          <div className="mt-10 grid gap-10">
            {timeline === undefined ? (
              <LoadingRows rows={2} />
            ) : (
              <GivingMomentum report={timeline} />
            )}

            {byBatch === undefined ? (
              <LoadingRows rows={3} />
            ) : (
              <BatchGivingTable report={byBatch} />
            )}
          </div>

          <p className="mt-8 max-w-3xl text-[0.88rem] leading-relaxed text-slate-ink">
            Figures are drawn live from the register, not typed up for a
            newsletter. Anything that looks wrong is worth an email to{" "}
            <a
              href={`mailto:${RITAA.email}`}
              className="text-maroon underline decoration-brass/50 underline-offset-4"
            >
              {RITAA.email}
            </a>{" "}
            — the treasurer would rather correct a figure than defend one.
          </p>
        </section>
      </Shell>

      {/* ---- Donate panel: intent only, no gateway ----------------------- */}
      <section id="donate" className="border-b border-line bg-bone-deep">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Make a gift"
            title="UPI, card, netbanking or wallet"
            lede="Pick an amount and the way you would rather pay. The association sends you the payment details for that method."
          />
          <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-14">
            <div>
              <div className="border border-line bg-white p-6">
                <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-maroon">
                  Read this first
                </p>
                <p className="mt-3 text-[0.92rem] leading-relaxed text-ink">
                  This page does not take payments. There is no payment gateway
                  connected to the portal yet, so nothing you do here charges a
                  card or debits an account.
                </p>
                <p className="mt-3 text-[0.92rem] leading-relaxed text-slate-ink">
                  What the button does: it opens an email to the association with
                  your amount, method and campaign filled in. RITAA replies with
                  the payment details, you pay through that channel, and your gift
                  is added to the campaign total and the donor wall only after the
                  treasurer confirms the payment has arrived.
                </p>
              </div>

              <dl className="mt-6 divide-y divide-line border-y border-line">
                {METHODS.map((option) => (
                  <div
                    key={option.id}
                    className="flex items-baseline justify-between gap-4 py-3"
                  >
                    <dt className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-ink">
                      {option.label}
                    </dt>
                    <dd className="text-right text-[0.82rem] leading-snug text-slate-ink">
                      {option.hint}
                    </dd>
                  </div>
                ))}
              </dl>

              <p className="mt-6 text-[0.85rem] leading-relaxed text-slate-ink">
                Questions about a gift, a receipt or an 80G certificate go to{" "}
                <a
                  href={`mailto:${RITAA.email}`}
                  className="text-maroon underline decoration-brass/50 underline-offset-4"
                >
                  {RITAA.email}
                </a>{" "}
                or {RITAA.phone}.
              </p>
            </div>

            <DonatePanel campaignTitles={campaignTitles} />
          </div>
        </Shell>
      </section>

      {/* ---- Donor wall -------------------------------------------------- */}
      <Shell>
        <section id="wall" className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Donor wall"
            title="The people who gave"
            lede="The most recent gifts recorded by the association. Anonymous donors are listed without a name — the amount still counts."
          />
          {donors === undefined ? (
            <LoadingRows rows={4} />
          ) : donors.length === 0 ? (
            <Empty
              title="The wall starts with the first gift"
              hint="Once a payment is confirmed, the donor, the batch and the amount appear here."
              action={<Button href="#donate">Make the first gift</Button>}
            />
          ) : (
            <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
              {donors.map((donor) => (
                <DonorEntry key={donor._id} donor={donor} />
              ))}
            </ul>
          )}
        </section>
      </Shell>
    </>
  );
}
