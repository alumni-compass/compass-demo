# Deploying the RITAA portal

Two things get deployed, and they are separate:

| Part | Where | How |
| --- | --- | --- |
| Web app (repository root) | Vercel | Git push, auto-build |
| Backend + database (`convex/`) | Convex Cloud | `npx convex deploy` |

Vercel never runs the database. If you deploy only the website, it will build and
then fail to load data, because it will still be pointing at whichever Convex
deployment its environment variables name.

---

## 1. Vercel project settings

When you import `kaliappan20/RIT-ALUMINI`, leave the root directory as the
repository root. The Next.js app lives beside `package.json`.

| Setting | Value |
| --- | --- |
| **Root Directory** | `.` (repository root) |
| Framework Preset | Next.js (auto-detected) |
| Build Command | leave default (`next build`) |
| Install Command | leave default |
| Node.js Version | 20.x or later |

`vercel.json` pins the framework and sets the Mumbai region (`bom1`), so
requests from Tamil Nadu are not served from the United States. The Expo app in
`native/` is not part of this build.

---

## 2. Environment variables to add in Vercel

Settings → Environment Variables. Add both, for **Production, Preview and
Development**:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | `https://terrific-bird-760.convex.cloud` |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | `https://terrific-bird-760.convex.site` |

> `npx convex codegen` regenerates TypeScript bindings **without deploying**. A
> local build can therefore typecheck cleanly against functions that are not on the
> deployment yet. Use `npx convex dev --once` (dev) or `npx convex deploy` (prod) to
> actually push, and `npx convex run <module>:<fn>` to confirm a function is live.

Both are read at **build** time by `src/lib/env.ts`, which validates that
each is a real URL and explicitly rejects the `example.convex.cloud` placeholder.
If either is missing or still a placeholder, the Vercel build fails with a message
naming the variable — deliberately, so a broken site is never published.

> The two values above are the **development** Convex deployment. It works, but
> anyone can read and write it and it is wiped by `seed:run`. For a real launch,
> create the production deployment first (step 3) and use its URLs here instead.

---

## 3. Convex production deployment

The backend currently runs on the dev deployment `terrific-bird-760`. For
production:

```bash
npx convex deploy          # creates/updates the prod deployment, prints its URL
```

Then set the **production** deployment's own environment variables — these live on
Convex, not on Vercel, and are not copied over from dev:

```bash
npx convex env set BETTER_AUTH_SECRET  <a fresh 32+ char random string>
npx convex env set SITE_URL            https://<your-domain>

# Every OTHER origin the site is served from, comma separated. Optional, but
# omitting one is how you get "Invalid origin" the moment somebody clicks a
# provider button: Better Auth refuses any request whose Origin header is not
# trusted, and SITE_URL only covers one. localhost and 127.0.0.1 on the same
# port are paired automatically; a deployed domain is not guessed.
npx convex env set TRUSTED_ORIGINS     "https://<your-domain>,http://localhost:3001"

# REQUIRED — at least one of these two pairs. See the warning below.
npx convex env set GOOGLE_CLIENT_ID        xxx    # Google sign-in
npx convex env set GOOGLE_CLIENT_SECRET    xxx
npx convex env set LINKEDIN_CLIENT_ID      xxx    # LinkedIn sign-in
npx convex env set LINKEDIN_CLIENT_SECRET  xxx

# Optional — enables event reminder emails, which are otherwise queued but never
# delivered (eventAdmin.sendReminder throws rather than reporting a false send).
npx convex env set RESEND_API_KEY   re_xxx
npx convex env set EVENT_FROM_EMAIL "RITAA <alumni@ritrjpm.ac.in>"
```

> ### Without a provider, nobody can sign in
>
> **Google and LinkedIn are the only two ways into the portal.** Email-and-password
> and one-time codes were removed: a members' directory is only worth joining if
> the people in it are who they say they are, and a provider-confirmed identity
> arrives with a real name and a working address attached. LinkedIn additionally
> brings across the employer and designation the directory asks for.
>
> The consequence is that there is **no fallback**. With neither provider's
> credentials set, no one can open a session — not members, and not the
> association. `auth.configuredAuthMethods` reports this; `/join` says it in plain
> words instead of showing two buttons that fail on click, and `/admin` shows it as
> a release blocker beside the access-control one.
>
> Set at least one pair before announcing the site.

**`SITE_URL` must be the real HTTPS Vercel domain.** Better Auth uses it as its
`baseURL` and trusted origin (`convex/auth.ts`). Left as
`http://localhost:3001`, sign-in fails in production and cookies are issued
against a plaintext origin.

### The two errors these produce, in the order you meet them

`INVALID_ORIGIN` on click means the browser's address is not `SITE_URL` and not
in `TRUSTED_ORIGINS`. `redirect_uri does not match the registered value` on the
provider's own page means the opposite half: the request got through, and the
URL below is not registered on the provider. Both are configuration, never code.

OAuth redirect URLs to register with each provider:

```
https://<your-vercel-domain>/api/auth/callback/google
https://<your-vercel-domain>/api/auth/callback/linkedin
```

Finally, point Vercel's two `NEXT_PUBLIC_*` variables at the production Convex
URLs and redeploy.

---

## 4. Seeding

```bash
npx convex run seed:run
```

This seeds **only** real content: the three office bearers from the association's
brief, and two photograph albums built from the college's own convocation images.
The directory, careers board, mentorship roster, RACE feed, events calendar,
stories and campaigns are left empty on purpose — they show their empty states
until the association enters real records. See the header comment in
`convex/seed.ts`.

`seed:run` **deletes** every row in those tables before inserting. Never run it
against a production deployment that holds real member data.

---

## 5. Before this is public

Four things are genuinely unfinished, and the portal will hold real people's
personal data:

1. **No sign-in provider may be configured.** See the warning in step 3 — this is
   the difference between a site people can join and one nobody can. Check it with
   `npx convex run auth:configuredAuthMethods`; `anyConfigured: false` means the
   portal is closed.
2. **`/admin` is not access-gated.** The privileged queues return empty for
   non-admins and every destructive mutation is `internalMutation`, so no visitor
   can approve content or change a role. But the route itself is a public URL and
   still discloses association-wide figures. Gate it with `authz.requireRole`
   before launch.
3. **No activity logging.** Nothing records who approved a venture, changed a
   role or edited a profile. There is currently no way to establish after the fact
   whether a record was tampered with.
4. **Push notifications are not implemented** on web or native, despite being
   named in the brief. The two header counters — pending connection requests and
   unread messages — are read live from the source tables, so nothing is missed
   while a member is on the site; they just are not pushed when they are away.

### The connection graph

Connecting is a mutual, two-party edge in `connections`, and messaging in
`conversations` / `directMessages`. Two properties are worth knowing before
operating this:

- **No email address is ever returned to a browser** by `network.ts` or
  `messaging.ts`. The client's handles are an `alumniId` (to ask someone new) and a
  `connectionId` (to answer, withdraw, remove, or open a thread); both are resolved
  server-side. That is what lets a member keep their address private under module
  2's opt-in rules and still be reachable. If you extend either module, keep that
  invariant — the note at the top of `network.ts` explains it.
- **Mutual-connection names come from a bounded walk** (`MAX_MUTUAL_WALK`, 250).
  Past that ceiling the names are incomplete, and every query that can be truncated
  returns `mutualsComplete: false` so the UI says "at least" rather than
  under-reporting.

`otpChallenges` survives in `schema.ts` with nothing writing to it, so an existing
deployment can be pushed to without a destructive migration. Drop the table once
you have confirmed it is empty on every deployment.

Granting the first admin (there is no UI for this, by design):

```bash
npx convex run access:setRole '{"email":"alumni@ritrjpm.ac.in","role":"admin"}'
```

Approving a member's verification, or a RACE venture:

```bash
npx convex run access:reviewVerification '{"email":"...","decision":"approved"}'
npx convex run adminOps:approveVenture   '{"ventureId":"..."}'
```

---

## 6. Android app

`native/` is an Expo app sharing the same Convex backend. The generated
`android/` project is committed because it carries two fixes that `expo prebuild`
would otherwise discard:

- `android/app/build.gradle` — `-DCMAKE_OBJECT_PATH_MAX=240` and a short `.cxx`
  staging directory, which are what make the native build survive the Windows
  260-character path limit.
- `android/gradle.properties` — JVM heap raised to 8 GB.

If you ever re-run `expo prebuild`, re-apply both. Build with:

```bash
cd native/android
./gradlew assembleRelease
```

The release APK is signed with Expo's **debug** keystore. It installs and runs,
but it cannot go to the Play Store — generate a real keystore first, and note
that the signing key cannot be changed later without breaking updates.
