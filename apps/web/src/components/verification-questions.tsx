"use client";

import { api, useMutation, useQuery } from "@/lib/standalone";

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
 * Admin: the questions every member answers when asking to be verified.
 *
 * The third of the three question scopes. Portal admins author these, because
 * unlike a community's screening questions they gate the whole directory — a
 * community admin must not be able to add one, and `questions.authorizeScope`
 * enforces that on the server.
 *
 * Retire rather than delete. Answers already given point at the question, and a
 * pending request would otherwise show an answer beside "Question retired" for
 * an admin who still has to read it to make a decision.
 */
export default function VerificationQuestions() {
  const questions = useQuery(api.questions.allVerificationQuestions);
  const addQuestion = useMutation(api.questions.addQuestion);
  const setActive = useMutation(api.questions.setQuestionActive);
  const reorder = useMutation(api.questions.reorderQuestion);

  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<"text" | "longText" | "choice">("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(true);
  const [busy, setBusy] = useState(false);

  function fail(error: unknown) {
    toast.error(actionErrorMessage(error));
  }

  return (
    <div className="space-y-5">
      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            addQuestion({
              scope: "verification",
              prompt,
              kind,
              options:
                kind === "choice"
                  ? options.split("\n").map((l) => l.trim()).filter(Boolean)
                  : undefined,
              required,
            })
              .then(() => {
                setPrompt("");
                setOptions("");
                toast.success("Question added to the verification form.");
              })
              .catch(fail)
              .finally(() => setBusy(false));
          }}
        >
          <Eyebrow>Add a verification question</Eyebrow>
          <p className="mt-2 max-w-2xl text-[0.875rem] leading-relaxed text-slate-ink">
            Asked on <code className="font-mono">/join</code>, underneath the fixed
            roll number and batch fields. Answers appear beside each request in the
            verification queue, so ask things the office can actually check —
            a hostel block, a staff member&rsquo;s name, the year of a particular
            event.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_10rem]">
            <div>
              <label className={labelClass} htmlFor="vq-prompt">
                Question
              </label>
              <input
                id="vq-prompt"
                required
                maxLength={300}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Which hostel block were you in, or which bus route did you take?"
                className={`${inputClass} mt-2`}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="vq-kind">
                Answer type
              </label>
              <select
                id="vq-kind"
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as "text" | "longText" | "choice")
                }
                className={`${inputClass} mt-2`}
              >
                <option value="text">Short text</option>
                <option value="longText">Long text</option>
                <option value="choice">Multiple choice</option>
              </select>
            </div>
          </div>

          {kind === "choice" ? (
            <div className="mt-4">
              <label className={labelClass} htmlFor="vq-options">
                Options, one per line
              </label>
              <textarea
                id="vq-options"
                rows={4}
                value={options}
                onChange={(event) => setOptions(event.target.value)}
                placeholder={"Day scholar\nHostel\nNeither"}
                className={`${inputClass} mt-2 resize-none`}
              />
            </div>
          ) : null}

          <label className="mt-4 flex items-center gap-2.5 text-[0.875rem] text-ink">
            <input
              type="checkbox"
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
              className="size-4 accent-maroon"
            />
            An answer is required to submit a verification request
          </label>

          <div className="mt-5 border-t border-line pt-4">
            <Button type="submit" size="sm" disabled={busy || !prompt.trim()}>
              {busy ? "Adding…" : "Add question"}
            </Button>
          </div>
        </form>
      </Card>

      {questions === undefined ? (
        <LoadingRows rows={2} />
      ) : questions.length === 0 ? (
        <Empty
          title="No extra questions yet."
          hint="Without any, a verification request carries the name, batch, department, roll number and graduation year — and nothing the office can cross-check beyond the roster."
        />
      ) : (
        <ul className="space-y-3">
          {questions.map((question, index) => (
            <Card as="li" key={question._id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[0.68rem] tabular-nums text-slate-ink">
                      {index + 1}
                    </span>
                    {question.required ? (
                      <Pill tone="maroon">Required</Pill>
                    ) : (
                      <Pill>Optional</Pill>
                    )}
                    <Pill tone="quiet">{question.kind}</Pill>
                    {!question.active ? <Pill tone="brass">Retired</Pill> : null}
                  </div>
                  <p className="mt-2 text-[0.95rem] leading-snug text-ink">
                    {question.prompt}
                  </p>
                  {question.options.length > 0 ? (
                    <p className="mt-1.5 text-[0.8rem] text-slate-ink">
                      {question.options.join(" · ")}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      void reorder({
                        questionId: question._id,
                        direction: "up",
                      }).catch(fail);
                    }}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      void reorder({
                        questionId: question._id,
                        direction: "down",
                      }).catch(fail);
                    }}
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void setActive({
                        questionId: question._id,
                        active: !question.active,
                      }).catch(fail);
                    }}
                  >
                    {question.active ? "Retire" : "Restore"}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
