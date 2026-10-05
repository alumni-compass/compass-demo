# RIT-ALUMINI

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Convex, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **React Native** - Build mobile apps using React
- **Expo** - Tools for React Native development
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **shadcn/ui** - primitives live in `src/components/ui`
- **Convex** - Reactive backend-as-a-service platform (`convex/`)
- **Authentication** - Better-Auth, **Google and LinkedIn only**

## Signing in

The portal has exactly two ways in: **Continue with Google** and **Continue with
LinkedIn**. There is no password and no one-time code — a members' directory is
only worth joining if the people in it are who they say they are, and a
provider-confirmed identity arrives with a real name and a working address.

Each provider registers itself only when both of its credentials are present on
the Convex deployment, so **with neither set, nobody can sign in**:

```bash
npx convex env set GOOGLE_CLIENT_ID        xxx
npx convex env set GOOGLE_CLIENT_SECRET    xxx
npx convex env set LINKEDIN_CLIENT_ID      xxx
npx convex env set LINKEDIN_CLIENT_SECRET  xxx

npx convex run auth:configuredAuthMethods   # anyConfigured must be true
```

Redirect URIs to register with each provider are
`<SITE_URL>/api/auth/callback/google` and `…/linkedin`. See `DEPLOYMENT.md`.

## The network

`/directory` finds members; `/network` and `/messages` are what make it two-way.

- Connecting is a **mutual edge** — a request does nothing until the other member
  accepts, and either side can withdraw or remove it afterwards.
- Accepting opens a **direct thread** inside the portal. No phone number or email
  changes hands: `network.ts` and `messaging.ts` never return an address to a
  browser, and the client's handles are an `alumniId` and a `connectionId`.
- Where a member you know also knows the one you are viewing, the portal **names
  them** instead of showing an abstract degree — that is who to ask for the
  introduction.

## Getting Started

First, install the dependencies:

```bash
npm install
npm install --prefix native
```

## Convex Setup

This project uses Convex as a backend. You'll need to set up Convex before running the app:

```bash
npm run dev:setup
```

Follow the prompts to create a new Convex project and connect it to your application. Convex writes `.env.local` at the repo root; copy the two `NEXT_PUBLIC_*` values from `.env.example` if they are not already there.

Then, run the development server:

```bash
npm run dev
```

That starts Next.js and Convex together. Open [http://localhost:3001](http://localhost:3001).

The Expo app is a separate project in `native/`:

```bash
npm run dev:native
```

## UI Customization

shadcn/ui primitives live in this app, not a shared package.

- Change design tokens and global styles in `src/styles/globals.css` and `src/index.css`
- Update primitives in `src/components/ui/*`
- Adjust shadcn aliases in `components.json`

Add more primitives from the repo root:

```bash
npx shadcn@latest add accordion dialog popover sheet table
```

```tsx
import { Button } from "@/components/ui/button";
```

## Project Structure

```
RIT-ALUMINI/
├── src/           # Next.js app
├── convex/        # Convex backend functions and schema
├── public/        # Static assets
└── native/        # Expo app (its own package.json)
```

## Available Scripts

- `npm run dev`: Start Next.js and Convex
- `npm run dev:web`: Start only Next.js
- `npm run dev:convex`: Start only Convex
- `npm run build`: Build the Next.js app
- `npm run dev:setup`: Setup and configure your Convex project
- `npm run check-types`: Check TypeScript for the web app and Convex
- `npm run dev:native`: Start the Expo development server (`native/`)
