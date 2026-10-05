# RIT-ALUMINI

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Convex, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **React Native** - Build mobile apps using React
- **Expo** - Tools for React Native development
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Convex** - Reactive backend-as-a-service platform
- **Authentication** - Better-Auth, **Google and LinkedIn only**
- **Turborepo** - Optimized monorepo build system

## Signing in

The portal has exactly two ways in: **Continue with Google** and **Continue with
LinkedIn**. There is no password and no one-time code — a members' directory is
only worth joining if the people in it are who they say they are, and a
provider-confirmed identity arrives with a real name and a working address.

Each provider registers itself only when both of its credentials are present on
the Convex deployment, so **with neither set, nobody can sign in**:

```bash
cd packages/backend
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
```

## Convex Setup

This project uses Convex as a backend. You'll need to set up Convex before running the app:

```bash
npm run dev:setup
```

Follow the prompts to create a new Convex project and connect it to your application.

Copy environment variables from `packages/backend/.env.local` to `apps/*/.env`.

Then, run the development server:

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
Use the Expo Go app to run the mobile application.
Your app will connect to the Convex cloud backend automatically.

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@RIT-ALUMINI/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Project Structure

```
RIT-ALUMINI/
├── apps/
│   ├── web/         # Frontend application (Next.js)
│   ├── native/      # Mobile application (React Native, Expo)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── backend/     # Convex backend functions and schema
```

## Available Scripts

- `npm run dev`: Start all applications in development mode
- `npm run build`: Build all applications
- `npm run dev:web`: Start only the web application
- `npm run dev:setup`: Setup and configure your Convex project
- `npm run check-types`: Check TypeScript types across all apps
- `npm run dev:native`: Start the React Native/Expo development server
