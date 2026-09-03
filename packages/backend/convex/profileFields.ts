import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireRole } from "./authz";
import { DEPARTMENTS } from "./schema";

/**
 * The member details form, as the association configures it.
 *
 * WHAT AN ADMIN CONTROLS HERE. The label, the help text, whether an answer is
 * required, the order the fields appear in, whether a field is asked at all,
 * and — for the two dropdowns — the exact list of options. What an admin does
 * not control is which column an answer lands in (`key`) or how the control
 * behaves (`kind`); both are properties of the data, not of the form, and
 * making them editable would let the console break the directory.
 *
 * THE OPTION LISTS ARE THE VALIDATOR. `profiles.upsertProfile` checks batch and
 * department against the rows in this table, not against a constant in the
 * code. That is the whole point of letting an admin edit them: adding the 2027
 * batch in the console has to be enough, with no deploy. It also means the
 * check has to happen on the server — a dropdown is a suggestion to a browser
 * and nothing more, so a crafted call would otherwise write any batch it liked.
 *
 * ANYTHING ELSE THE ASSOCIATION WANTS TO ASK goes in `questions` with scope
 * `profile`: free-form prompts, admin-authored, answered into `questionAnswers`.
 * Those have no typed column and are not indexed, which is exactly why the
 * eleven fixed fields are not modelled that way. See the note on the
 * `profileFields` table in schema.ts.
 */

/* ------------------------------------------------------------------ */
/* The defaults                                                        */
/* ------------------------------------------------------------------ */

/** RITAA was established in 2017, so there is no earlier cohort. */
const FIRST_BATCH = 2017;

/**
 * Batch options, generated rather than typed out, from 2017 to next year.
 *
 * Seeded once. After that the list belongs to the admin — `setOptions` can add
 * 2028 or drop a year that never graduated, and nothing here overwrites it.
 */
function defaultBatchOptions() {
  const last = new Date().getFullYear() + 1;
  const years: string[] = [];
  for (let year = last; year >= FIRST_BATCH; year -= 1) years.push(String(year));
  return years;
}

type FieldKind = Doc<"profileFields">["kind"];

type FieldSeed = {
  key: string;
  label: string;
  help?: string;
  kind: FieldKind;
  options: string[];
  required: boolean;
  locked: boolean;
};

/**
 * The eleven fields, in the order the association asked for them.
 *
 * `email` is locked and never editable by the member: it arrives from the OAuth
 * provider, which is the only reason the directory can claim its addresses are
 * real. Rendering it as an editable box would quietly undo that.
 */
export function defaultFields(): FieldSeed[] {
  return [
    {
      key: "firstName",
      label: "First name",
      help: "Prefilled from your Google or LinkedIn account. Correct it if it is wrong.",
      kind: "text",
      options: [],
      required: true,
      locked: true,
    },
    {
      key: "lastName",
      label: "Last name",
      kind: "text",
      options: [],
      required: true,
      locked: true,
    },
    {
      key: "email",
      label: "Email",
      help: "Confirmed by your sign-in provider, so it cannot be edited here.",
      kind: "email",
      options: [],
      required: true,
      locked: true,
    },
    {
      key: "phone",
      label: "Phone number",
      help: "Kept private unless you publish it from your profile.",
      kind: "phone",
      options: [],
      required: true,
      locked: false,
    },
    {
      key: "location",
      label: "Current location",
      help: "Detected from your browser when you allow it, and refreshed each time you sign in. You can always type it yourself.",
      kind: "location",
      options: [],
      required: true,
      locked: false,
    },
    {
      key: "address",
      label: "Address",
      help: "Never shown in the directory. The association uses it for post.",
      kind: "longText",
      options: [],
      required: false,
      locked: false,
    },
    {
      key: "batch",
      label: "Graduating batch",
      help: "The year you graduated.",
      kind: "select",
      options: defaultBatchOptions(),
      required: true,
      locked: true,
    },
    {
      key: "department",
      label: "Department",
      kind: "select",
      options: [...DEPARTMENTS],
      required: true,
      locked: true,
    },
    {
      key: "company",
      label: "Current company",
      help: "Start typing and pick your employer, or type it in full if it is not listed.",
      kind: "company",
      options: [],
      required: false,
      locked: false,
    },
    {
      key: "workLocation",
      label: "Current working place",
      help: "The city or office you work from.",
      kind: "text",
      options: [],
      required: false,
      locked: false,
    },
    {
      key: "designation",
      label: "Position",
      help: "Start typing your role and pick the closest match, or type your own title.",
      kind: "position",
      options: [],
      required: false,
      locked: false,
    },
  ];
}

/** Every key this module knows about. A row with any other key is ignored. */
export const FIELD_KEYS = defaultFields().map((f) => f.key);

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

function view(row: Doc<"profileFields">) {
  return {
    _id: row._id,
    key: row.key,
    label: row.label,
    help: row.help ?? null,
    kind: row.kind,
    options: row.options,
    required: row.required,
    active: row.active,
    order: row.order,
    locked: row.locked,
  };
}

export type ProfileFieldView = ReturnType<typeof view>;

async function allRows(ctx: QueryCtx | MutationCtx) {
  const rows = await ctx.db.query("profileFields").withIndex("by_order").collect();
  return rows.sort((a, b) => a.order - b.order);
}

/**
 * The form, as a member should see it.
 *
 * Public on purpose: it carries labels and option lists, no personal data, and
 * the member needs it before they have a profile to be gated against. It falls
 * back to the defaults when the table has never been seeded, so the form is
 * never blank on a fresh deployment — `configured` says which of the two the
 * caller is looking at.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await allRows(ctx);
    if (rows.length === 0) {
      return {
        configured: false,
        fields: defaultFields().map((seed, index) => ({
          _id: null,
          key: seed.key,
          label: seed.label,
          help: seed.help ?? null,
          kind: seed.kind,
          options: seed.options,
          required: seed.required,
          active: true,
          order: index,
          locked: seed.locked,
        })),
      };
    }
    return { configured: true, fields: rows.filter((r) => r.active).map(view) };
  },
});

/**
 * Every row including the retired ones. The console needs both.
 *
 * REFUSES SOFTLY, returning `authorized: false` rather than throwing. A query
 * that throws propagates into the React render and takes the whole `/admin`
 * route down, and that route is still a public URL — see the read/write split
 * documented at the top of `adminOps.ts`. The panel renders an access notice
 * instead, which is also the only way to tell "you are not an admin" apart
 * from "the form has no fields", and reporting the second when the first is
 * true is the most dangerous kind of wrong: it looks like information.
 */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireRole(ctx, ["admin"]);
    } catch {
      return {
        authorized: false as const,
        seeded: false,
        missing: [] as string[],
        fields: [] as ProfileFieldView[],
      };
    }
    const rows = await allRows(ctx);
    return {
      authorized: true as const,
      seeded: rows.length > 0,
      missing: FIELD_KEYS.filter((key) => !rows.some((r) => r.key === key)),
      fields: rows.map(view),
    };
  },
});

/**
 * The option list for one field, resolved the way a save must resolve it.
 *
 * Shared with `profiles.upsertProfile` so the validator and the dropdown can
 * never disagree: both call this, and an unseeded deployment falls back to the
 * same defaults the form rendered.
 */
export async function optionsFor(
  ctx: QueryCtx | MutationCtx,
  key: string,
): Promise<{ options: string[]; required: boolean; active: boolean }> {
  const row = await ctx.db
    .query("profileFields")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (row) {
    return { options: row.options, required: row.required, active: row.active };
  }
  const seed = defaultFields().find((f) => f.key === key);
  return {
    options: seed?.options ?? [],
    required: seed?.required ?? false,
    active: true,
  };
}

/** Every active field, for the server-side required check on a new profile. */
export async function activeFields(ctx: QueryCtx | MutationCtx) {
  const rows = await allRows(ctx);
  if (rows.length === 0) {
    return defaultFields().map((seed) => ({
      key: seed.key,
      label: seed.label,
      required: seed.required,
      options: seed.options,
    }));
  }
  return rows
    .filter((r) => r.active)
    .map((r) => ({
      key: r.key,
      label: r.label,
      required: r.required,
      options: r.options,
    }));
}

/* ------------------------------------------------------------------ */
/* Writes — admin only                                                */
/* ------------------------------------------------------------------ */

const MAX_LABEL = 80;
const MAX_HELP = 300;
const MAX_OPTIONS = 200;
const MAX_OPTION = 80;

/** Trims, drops blanks, refuses duplicates. The list an admin typed, cleaned. */
function cleanOptions(raw: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const label = value.trim().replace(/\s+/g, " ");
    if (!label) continue;
    if (label.length > MAX_OPTION) {
      throw new ConvexError(`Keep each option under ${MAX_OPTION} characters.`);
    }
    const key = label.toLowerCase();
    if (seen.has(key)) {
      throw new ConvexError(`"${label}" is listed twice — every option must differ.`);
    }
    seen.add(key);
    out.push(label);
  }
  if (out.length > MAX_OPTIONS) {
    throw new ConvexError(`That is more than ${MAX_OPTIONS} options.`);
  }
  return out;
}

/**
 * Writes any default rows the table is missing, and leaves existing ones alone.
 *
 * Idempotent, so it is safe to run on every deployment and safe to offer as a
 * button in the console. It never overwrites a label an admin has edited or an
 * option list they have curated — a "restore defaults" that discarded their
 * work would be a trap.
 */
async function ensure(ctx: MutationCtx, byEmail?: string) {
  const existing = await allRows(ctx);
  const have = new Set(existing.map((r) => r.key));
  let highest = existing.reduce((max, r) => Math.max(max, r.order), -1);

  let added = 0;
  for (const seed of defaultFields()) {
    if (have.has(seed.key)) continue;
    highest += 1;
    await ctx.db.insert("profileFields", {
      key: seed.key,
      label: seed.label,
      help: seed.help,
      kind: seed.kind,
      options: seed.options,
      required: seed.required,
      active: true,
      order: highest,
      locked: seed.locked,
      updatedAt: Date.now(),
      updatedByEmail: byEmail,
    });
    added += 1;
  }
  return { added, total: existing.length + added };
}

/** For the CLI: `npx convex run profileFields:seedDefaults`. */
export const seedDefaults = internalMutation({
  args: {},
  handler: async (ctx) => ensure(ctx),
});

/** The same thing, as a button in the console. */
export const ensureDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    const { email } = await requireRole(ctx, ["admin"]);
    return ensure(ctx, email);
  },
});

async function fieldByKey(ctx: MutationCtx, key: string) {
  const row = await ctx.db
    .query("profileFields")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!row) {
    throw new ConvexError(
      `No field named "${key}". Run "Restore missing fields" first.`,
    );
  }
  return row;
}

/**
 * Relabel a field, change its help text, or make it required or optional.
 *
 * A locked field can be relabelled but not made optional and not retired: the
 * portal cannot key a profile on an address it did not ask for, and a directory
 * of members with no surname is not a directory. The refusal is here rather
 * than only in the console, because the console is not the security boundary.
 */
export const updateField = mutation({
  args: {
    key: v.string(),
    label: v.optional(v.string()),
    help: v.optional(v.string()),
    required: v.optional(v.boolean()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { email } = await requireRole(ctx, ["admin"]);
    const row = await fieldByKey(ctx, args.key);

    const patch: Partial<Doc<"profileFields">> = {
      updatedAt: Date.now(),
      updatedByEmail: email,
    };

    if (args.label !== undefined) {
      const label = args.label.trim().replace(/\s+/g, " ");
      if (!label) throw new ConvexError("A field needs a label.");
      if (label.length > MAX_LABEL) {
        throw new ConvexError(`Keep the label under ${MAX_LABEL} characters.`);
      }
      patch.label = label;
    }

    if (args.help !== undefined) {
      const help = args.help.trim();
      if (help.length > MAX_HELP) {
        throw new ConvexError(`Keep the help text under ${MAX_HELP} characters.`);
      }
      patch.help = help || undefined;
    }

    if (args.required !== undefined) {
      if (row.locked && !args.required) {
        throw new ConvexError(
          `"${row.label}" is one of the fields the portal cannot work without, so it stays required.`,
        );
      }
      patch.required = args.required;
    }

    if (args.active !== undefined) {
      if (row.locked && !args.active) {
        throw new ConvexError(
          `"${row.label}" cannot be removed from the form — the portal needs it.`,
        );
      }
      patch.active = args.active;
    }

    await ctx.db.patch(row._id, patch);
    return { key: row.key };
  },
});

/**
 * Replaces a dropdown's options.
 *
 * Replace rather than append, because the console edits the list as text — one
 * option per line — and that is the only editing model where removing a line
 * means removing an option. Existing answers are NOT rewritten: a member who
 * chose a batch that has since been deleted keeps it on their record, and the
 * next time they save the form they are asked to pick again. Silently blanking
 * their department to keep the list tidy would be worse.
 */
export const setOptions = mutation({
  args: { key: v.string(), options: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const row = await fieldByKey(ctx, args.key);
    if (row.kind !== "select") {
      throw new ConvexError(
        `"${row.label}" is not a dropdown, so it has no option list.`,
      );
    }
    const options = cleanOptions(args.options);
    if (options.length === 0) {
      throw new ConvexError(
        "A dropdown with no options cannot be answered. Add at least one, or retire the field.",
      );
    }
    await ctx.db.patch(row._id, { options, updatedAt: Date.now() });
    return { key: row.key, count: options.length };
  },
});

/**
 * Moves a field one place up or down.
 *
 * Swaps the two `order` values rather than renumbering the table, so a move is
 * two writes whatever the length of the form.
 */
export const moveField = mutation({
  args: { key: v.string(), direction: v.union(v.literal("up"), v.literal("down")) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const rows = await allRows(ctx);
    const index = rows.findIndex((r) => r.key === args.key);
    if (index === -1) throw new ConvexError(`No field named "${args.key}".`);

    const target = args.direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= rows.length) {
      return { moved: false };
    }

    const a = rows[index];
    const b = rows[target];
    await ctx.db.patch(a._id, { order: b.order, updatedAt: Date.now() });
    await ctx.db.patch(b._id, { order: a.order, updatedAt: Date.now() });
    return { moved: true };
  },
});
