"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import type { Id } from "@RIT-ALUMINI/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import {
  actionErrorMessage,
  Button,
  Card,
  Empty,
  Eyebrow,
  inputClass,
  labelClass,
  LoadingRows,
  Pill,
} from "@/components/kit";

/**
 * Admin: the member details form.
 *
 * TWO LISTS, BECAUSE THEY ARE TWO DIFFERENT THINGS.
 *
 *   The eleven fields are columns on the profile. The directory filters on
 *   batch and department, the search index covers company, mentorship reads the
 *   position — so an answer has to land in a typed column, and what is
 *   configurable is the presentation: label, help text, required or optional,
 *   order, asked or retired, and for the two dropdowns the option list itself.
 *   Adding next year's batch here is all it takes; there is no deploy and no
 *   constant in the code to edit, because `profiles.upsertProfile` validates
 *   against exactly this list.
 *
 *   The extra questions are free-form. Anything the association wants to ask
 *   that has no column — a hostel block, a willingness to speak at an event —
 *   goes here, and the answers are stored against the question rather than as a
 *   profile field. They can be added, edited, reordered and retired.
 *
 * WHY SOME ROWS CANNOT BE RETIRED. Five of the eleven are marked locked: both
 * name parts, the address, the batch and the department. The portal cannot key
 * a profile on an address it never asked for, a directory of people with no
 * surname is not a directory, and batch and department are indexed — the table
 * itself requires them. Those five can be relabelled and reordered like any
 * other; they cannot be made optional or removed. The server refuses it too,
 * not just this console.
 *
 * RETIRE RATHER THAN DELETE, throughout. Answers already given point at a
 * question, and a member's existing department stays on their record even after
 * an admin removes that option from the list — they are simply asked to pick
 * again next time they open the form. Silently blanking someone's answer to
 * tidy up a list is the kind of quiet data loss nobody discovers for a year.
 */

const KIND_COPY: Record<string, string> = {
  text: "Short text",
  email: "From the sign-in",
  phone: "Phone number",
  longText: "Long text",
  select: "Dropdown",
  company: "Company, with worldwide suggestions",
  position: "Position, with worldwide suggestions",
  location: "Location, detectable from the browser",
};

/* ------------------------------------------------------------------ */
/* One configured field                                                */
/* ------------------------------------------------------------------ */

function FieldRow({
  field,
  first,
  last,
}: {
  field: {
    key: string;
    label: string;
    help: string | null;
    kind: string;
    options: string[];
    required: boolean;
    active: boolean;
    locked: boolean;
  };
  first: boolean;
  last: boolean;
}) {
  const updateField = useMutation(api.profileFields.updateField);
  const setOptions = useMutation(api.profileFields.setOptions);
  const moveField = useMutation(api.profileFields.moveField);

  const [label, setLabel] = useState(field.label);
  const [help, setHelp] = useState(field.help ?? "");
  const [options, setOptionText] = useState(field.options.join("\n"));
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const dirty =
    label !== field.label ||
    help !== (field.help ?? "") ||
    options !== field.options.join("\n");

  function run(work: Promise<unknown>, done: string) {
    setBusy(true);
    work
      .then(() => toast.success(done))
      .catch((error) => toast.error(actionErrorMessage(error)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="rounded-[12px] border border-line bg-bone/40 p-4 transition-colors hover:border-line-strong hover:bg-bone">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[0.75rem] text-slate-soft">
          {field.key}
        </span>
        <span className="text-[1.0625rem] font-medium text-ink">
          {field.label}
        </span>
        {field.required ? <Pill tone="maroon">Required</Pill> : <Pill>Optional</Pill>}
        {field.locked ? <Pill tone="brass">Locked</Pill> : null}
        {field.active ? null : <Pill tone="quiet">Retired</Pill>}
        <span className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            aria-label={`Move ${field.label} up`}
            disabled={first || busy}
            onClick={() =>
              run(moveField({ key: field.key, direction: "up" }), "Moved up.")
            }
            className="font-mono size-8 rounded-control border border-line text-[0.7rem] text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-35"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Move ${field.label} down`}
            disabled={last || busy}
            onClick={() =>
              run(moveField({ key: field.key, direction: "down" }), "Moved down.")
            }
            className="font-mono size-8 rounded-control border border-line text-[0.7rem] text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-35"
          >
            ↓
          </button>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Close" : "Edit"}
          </Button>
        </span>
      </div>

      <p className="mt-1.5 text-[0.875rem] leading-snug text-slate-ink">
        {KIND_COPY[field.kind] ?? field.kind}
        {field.kind === "select" ? ` · ${field.options.length} options` : ""}
        {field.help ? ` — ${field.help}` : ""}
      </p>

      {open ? (
        <div className="mt-4 space-y-4 rounded-card border border-line bg-bone p-4">
          <div>
            <label className={labelClass} htmlFor={`label-${field.key}`}>
              Label the member sees
            </label>
            <input
              id={`label-${field.key}`}
              className={inputClass}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor={`help-${field.key}`}>
              Help text (optional)
            </label>
            <input
              id={`help-${field.key}`}
              className={inputClass}
              value={help}
              placeholder="Shown under the box, in smaller type."
              onChange={(event) => setHelp(event.target.value)}
            />
          </div>

          {field.kind === "select" ? (
            <div>
              <label className={labelClass} htmlFor={`options-${field.key}`}>
                Options — one per line
              </label>
              <textarea
                id={`options-${field.key}`}
                className={`${inputClass} min-h-32 font-mono text-[0.8rem]`}
                value={options}
                onChange={(event) => setOptionText(event.target.value)}
              />
              <p className="mt-1.5 text-[0.8rem] leading-snug text-slate-ink">
                Removing a line removes the option. A member who already chose it
                keeps it on their record and is asked to choose again next time
                they open the form.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy || !dirty}
              onClick={() => {
                const work = async () => {
                  await updateField({ key: field.key, label, help });
                  if (field.kind === "select") {
                    await setOptions({
                      key: field.key,
                      options: options.split("\n"),
                    });
                  }
                };
                run(work(), "Field updated.");
              }}
            >
              {busy ? "Saving…" : "Save changes"}
            </Button>

            <Button
              size="sm"
              variant="outline"
              disabled={busy || field.locked}
              title={
                field.locked
                  ? "The portal needs this field, so it stays required."
                  : undefined
              }
              onClick={() =>
                run(
                  updateField({ key: field.key, required: !field.required }),
                  field.required ? "Now optional." : "Now required.",
                )
              }
            >
              {field.required ? "Make optional" : "Make required"}
            </Button>

            <Button
              size="sm"
              variant="ghost"
              disabled={busy || field.locked}
              title={
                field.locked
                  ? "The portal needs this field, so it cannot be retired."
                  : undefined
              }
              onClick={() =>
                run(
                  updateField({ key: field.key, active: !field.active }),
                  field.active ? "Retired from the form." : "Asked again.",
                )
              }
            >
              {field.active ? "Retire this field" : "Ask this again"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Extra questions                                                     */
/* ------------------------------------------------------------------ */

function QuestionRow({
  question,
  first,
  last,
}: {
  question: {
    _id: Id<"questions">;
    prompt: string;
    kind: "text" | "longText" | "choice";
    options: string[];
    required: boolean;
    active: boolean;
  };
  first: boolean;
  last: boolean;
}) {
  const editQuestion = useMutation(api.questions.editQuestion);
  const setActive = useMutation(api.questions.setQuestionActive);
  const reorder = useMutation(api.questions.reorderQuestion);

  const [prompt, setPrompt] = useState(question.prompt);
  const [options, setOptions] = useState(question.options.join("\n"));
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  function run(work: Promise<unknown>, done: string) {
    setBusy(true);
    work
      .then(() => toast.success(done))
      .catch((error) => toast.error(actionErrorMessage(error)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="rounded-[12px] border border-line bg-bone/40 p-4 transition-colors hover:border-line-strong hover:bg-bone">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[1.0625rem] font-medium text-ink">
          {question.prompt}
        </span>
        {question.required ? (
          <Pill tone="maroon">Required</Pill>
        ) : (
          <Pill>Optional</Pill>
        )}
        <Pill tone="quiet">
          {question.kind === "choice"
            ? `${question.options.length} choices`
            : question.kind === "longText"
              ? "Long text"
              : "Short text"}
        </Pill>
        {question.active ? null : <Pill tone="brass">Retired</Pill>}
        <span className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Move question up"
            disabled={first || busy}
            onClick={() =>
              run(
                reorder({ questionId: question._id, direction: "up" }),
                "Moved up.",
              )
            }
            className="font-mono size-8 rounded-control border border-line text-[0.7rem] text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-35"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Move question down"
            disabled={last || busy}
            onClick={() =>
              run(
                reorder({ questionId: question._id, direction: "down" }),
                "Moved down.",
              )
            }
            className="font-mono size-8 rounded-control border border-line text-[0.7rem] text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-35"
          >
            ↓
          </button>
          <Button size="sm" variant="quiet" onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "Edit"}
          </Button>
        </span>
      </div>

      {open ? (
        <div className="mt-4 space-y-4 rounded-card border border-line bg-bone p-4">
          <div>
            <label className={labelClass} htmlFor={`prompt-${question._id}`}>
              Question
            </label>
            <input
              id={`prompt-${question._id}`}
              className={inputClass}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </div>

          {question.kind === "choice" ? (
            <div>
              <label className={labelClass} htmlFor={`opts-${question._id}`}>
                Choices — one per line
              </label>
              <textarea
                id={`opts-${question._id}`}
                className={`${inputClass} min-h-28 font-mono text-[0.8rem]`}
                value={options}
                onChange={(event) => setOptions(event.target.value)}
              />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                run(
                  editQuestion({
                    questionId: question._id,
                    prompt,
                    options:
                      question.kind === "choice"
                        ? options.split("\n")
                        : undefined,
                  }),
                  "Question updated.",
                )
              }
            >
              {busy ? "Saving…" : "Save changes"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(
                  editQuestion({
                    questionId: question._id,
                    required: !question.required,
                  }),
                  question.required ? "Now optional." : "Now required.",
                )
              }
            >
              {question.required ? "Make optional" : "Make required"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                run(
                  setActive({
                    questionId: question._id,
                    active: !question.active,
                  }),
                  question.active ? "Retired." : "Asked again.",
                )
              }
            >
              {question.active ? "Retire this question" : "Ask this again"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AddQuestion() {
  const addQuestion = useMutation(api.questions.addQuestion);
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<"text" | "longText" | "choice">("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        addQuestion({
          scope: "profile",
          prompt,
          kind,
          options: kind === "choice" ? options.split("\n") : undefined,
          required,
        })
          .then(() => {
            setPrompt("");
            setOptions("");
            toast.success("Question added to the details form.");
          })
          .catch((error) => toast.error(actionErrorMessage(error)))
          .finally(() => setBusy(false));
      }}
    >
      <Eyebrow>Add a question</Eyebrow>
      <p className="mt-2 max-w-2xl text-[0.875rem] leading-relaxed text-slate-ink">
        Asked on the details form, under the eleven fields above. Use this for
        anything that has no column of its own — the answers are stored against
        the question, so they are not searchable in the directory.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div>
          <label className={labelClass} htmlFor="new-profile-question">
            Question
          </label>
          <input
            id="new-profile-question"
            className={inputClass}
            value={prompt}
            required
            placeholder="Which hostel block were you in?"
            onChange={(event) => setPrompt(event.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="new-profile-kind">
            Answer type
          </label>
          <select
            id="new-profile-kind"
            className={`${inputClass} font-mono text-[0.8rem]`}
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as "text" | "longText" | "choice")
            }
          >
            <option value="text">Short text</option>
            <option value="longText">Long text</option>
            <option value="choice">Multiple choice</option>
          </select>
        </div>
      </div>

      {kind === "choice" ? (
        <div className="mt-4">
          <label className={labelClass} htmlFor="new-profile-options">
            Choices — one per line, at least two
          </label>
          <textarea
            id="new-profile-options"
            className={`${inputClass} min-h-28 font-mono text-[0.8rem]`}
            value={options}
            onChange={(event) => setOptions(event.target.value)}
          />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-[0.875rem] text-ink">
          <input
            type="checkbox"
            className="size-4 accent-[#9b1c31]"
            checked={required}
            onChange={(event) => setRequired(event.target.checked)}
          />
          An answer is required
        </label>
        <Button type="submit" disabled={busy || !prompt.trim()}>
          {busy ? "Adding…" : "Add question"}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* The panel                                                           */
/* ------------------------------------------------------------------ */

export default function DetailsFormAdmin() {
  const config = useQuery(api.profileFields.listAll);
  const questions = useQuery(api.questions.allProfileQuestions);
  const ensureDefaults = useMutation(api.profileFields.ensureDefaults);
  const [busy, setBusy] = useState(false);

  if (config === undefined || questions === undefined) {
    return (
      <Card>
        <LoadingRows rows={5} />
      </Card>
    );
  }

  // `listAll` refuses softly rather than throwing, because a throwing query
  // would take this whole route down and /admin has no access gate yet. An
  // empty field list from a refusal and an empty one from an unseeded
  // deployment look identical, so the flag is what tells them apart.
  if (!config.authorized) {
    return (
      <Card>
        <Eyebrow>Admins only</Eyebrow>
        <p className="mt-2 max-w-2xl text-[0.875rem] leading-relaxed text-slate-ink">
          The member details form is configured by portal admins. Sign in with an
          admin account to change what members are asked. Nothing on this panel
          is readable without that role — the query behind it returns nothing
          rather than an empty form that would look like a configuration.
        </p>
        <p className="font-mono mt-3 text-[0.75rem] leading-relaxed text-slate-ink">
          npx convex run access:setRole
        </p>
      </Card>
    );
  }

  const fields = config.fields;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Eyebrow>The eleven fields</Eyebrow>
          <div className="flex items-center gap-2">
            {config.seeded ? (
              <Pill tone="jade">Configured</Pill>
            ) : (
              <Pill tone="brass">Using defaults</Pill>
            )}
            {config.missing.length > 0 || !config.seeded ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  ensureDefaults({})
                    .then((result) =>
                      toast.success(
                        result.added === 0
                          ? "Nothing was missing."
                          : `${result.added} field${result.added === 1 ? "" : "s"} restored.`,
                      ),
                    )
                    .catch((error) => toast.error(actionErrorMessage(error)))
                    .finally(() => setBusy(false));
                }}
              >
                {busy
                  ? "Working…"
                  : config.seeded
                    ? `Restore ${config.missing.length} missing`
                    : "Save this configuration"}
              </Button>
            ) : null}
          </div>
        </div>

        <p className="mt-2 max-w-3xl text-[0.875rem] leading-relaxed text-slate-ink">
          Every label, help text, option list and ordering below is what members
          see on their details form. Batch and department are validated against
          these option lists on save, so adding a year here is all that is needed
          — there is no constant in the code to change.
        </p>

        {fields.length === 0 ? (
          <div className="mt-5">
            <Empty
              title="Not saved yet"
              hint="Members are seeing the built-in defaults. Save the configuration to start editing labels, options and ordering."
            />
          </div>
        ) : (
          <div className="mt-5 space-y-2.5">
            {fields.map((field, index) => (
              <FieldRow
                key={field.key}
                field={field}
                first={index === 0}
                last={index === fields.length - 1}
              />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <AddQuestion />
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Eyebrow>Extra questions</Eyebrow>
          <Pill tone="quiet">
            {questions.filter((q) => q.active).length} asked ·{" "}
            {questions.filter((q) => !q.active).length} retired
          </Pill>
        </div>
        {questions.length === 0 ? (
          <div className="mt-5">
            <Empty
              title="No extra questions"
              hint="The details form is the eleven fields above. Add a question when the association needs to ask something that has no field of its own."
            />
          </div>
        ) : (
          <div className="mt-5 space-y-2.5">
            {questions.map((question, index) => (
              <QuestionRow
                key={String(question._id)}
                question={question}
                first={index === 0}
                last={index === questions.length - 1}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
