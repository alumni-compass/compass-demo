# Deploying the RITAA portal

Two things get deployed, and they are separate:

| Part | Where | How |
| --- | --- | --- |
| Web app (`apps/web`) | Vercel | Git push, auto-build |
| Backend + database (`packages/backend`) | Convex Cloud | `npx convex deploy` |

Vercel never runs the database. If you deploy only the website, it will build and
then fail to load data, because it will still be pointing at whichever Convex
deployment its environment variables name.

---

## 1. Vercel project settings

When you import `kaliappan20/RIT-ALUMINI`, Vercel will detect a monorepo. Set:

| Setting | Value |
| --- | --- |
| **Root Directory** | `apps/web` |
| Framework Preset | Next.js (auto-detected) |
| Build Command | leave default (`next build`) |
| Install Command | leave default |
| Node.js Version | 20.x or later |

**Root Directory is the one that matters.** Left at the repository root, Vercel
looks for a Next.js app beside `package.json`, finds a Turborepo instead, and the
build fails. Vercel installs the npm workspace from the repo root on its own.

`apps/web/vercel.json` pins the framework and sets the Mumbai region (`bom1`), so
requests from Tamil Nadu are not served from the United States.

---

## 2. Environment variables to add in Vercel

Settings → Environment Variables. Add both, for **Production, Preview and
Development**:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | `https://terrific-bird-760.convex.cloud` |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | `https://terrific-bird-760.convex.site` |

Both are read at **build** time by `packages/env/src/web.ts`, which validates that
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
cd packages/backend
npx convex deploy          # creates/updates the prod deployment, prints its URL
```

Then set the **production** deployment's own environment variables — these live on
Convex, not on Vercel, and are not copied over from dev:

```bash
npx convex env set BETTER_AUTH_SECRET  <a fresh 32+ char random string>
npx convex env set SITE_URL            https://<your-vercel-domain>

# Optional, each enables a feature that is otherwise gated off in the UI:
npx convex env set RESEND_API_KEY      re_xxx      # OTP codes + event reminders
npx convex env set OTP_FROM_EMAIL      "RITAA <alumni@ritrjpm.ac.in>"
npx convex env set GOOGLE_CLIENT_ID        xxx    # Google sign-in
npx convex env set GOOGLE_CLIENT_SECRET    xxx
npx convex env set LINKEDIN_CLIENT_ID      xxx    # LinkedIn sign-in
npx convex env set LINKEDIN_CLIENT_SECRET  xxx
```

**`SITE_URL` must be the real HTTPS Vercel domain.** Better Auth uses it as its
`baseURL` and trusted origin (`packages/backend/convex/auth.ts`). Left as
`http://localhost:3001`, sign-in fails in production and cookies are issued
against a plaintext origin.

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
cd packages/backend
npx convex run seed:run
```

This seeds **only** real content: the three office bearers from the association's
brief, and two photograph albums built from the college's own convocation images.
The directory, careers board, mentorship roster, RACE feed, events calendar,
stories and campaigns are left empty on purpose — they show their empty states
until the association enters real records. See the header comment in
`packages/backend/convex/seed.ts`.

`seed:run` **deletes** every row in those tables before inserting. Never run it
against a production deployment that holds real member data.

---

## 5. Before this is public

Three things are genuinely unfinished, and the portal will hold real people's
personal data:

1. **`/admin` is not access-gated.** The privileged queues return empty for
   non-admins and every destructive mutation is `internalMutation`, so no visitor
   can approve content or change a role. But the route itself is a public URL and
   still discloses association-wide figures. Gate it with `authz.requireRole`
   before launch.
2. **No activity logging.** Nothing records who approved a venture, changed a
   role or edited a profile. There is currently no way to establish after the fact
   whether a record was tampered with.
3. **Push notifications are not implemented** on web or native, despite being
   named in the brief.

Granting the first admin (there is no UI for this, by design):

```bash
cd packages/backend
npx convex run access:setRole '{"email":"alumni@ritrjpm.ac.in","role":"admin"}'
```

Approving a member's verification, or a RACE venture:

```bash
npx convex run access:reviewVerification '{"email":"...","decision":"approved"}'
npx convex run adminOps:approveVenture   '{"ventureId":"..."}'
```

---

## 6. Android app

`apps/native` is an Expo app sharing the same Convex backend. The generated
`android/` project is committed because it carries two fixes that `expo prebuild`
would otherwise discard:

- `android/app/build.gradle` — `-DCMAKE_OBJECT_PATH_MAX=240` and a short `.cxx`
  staging directory, which are what make the native build survive the Windows
  260-character path limit.
- `android/gradle.properties` — JVM heap raised to 8 GB.

If you ever re-run `expo prebuild`, re-apply both. Build with:

```bash
cd apps/native/android
./gradlew assembleRelease
```

The release APK is signed with Expo's **debug** keystore. It installs and runs,
but it cannot go to the Play Store — generate a real keystore first, and note
that the signing key cannot be changed later without breaking updates.
