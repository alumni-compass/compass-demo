# RIT-ALUMINI

This project is a TypeScript monorepo for the Ramco Institute of Technology Alumni Association. The web app is a standalone Next.js UI on sample data. The mobile app is an Expo shell. The backend is being replaced and is not in this repository.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **React Native** - Build mobile apps using React
- **Expo** - Tools for React Native development
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Turborepo** - Optimized monorepo build system

## Signing in

The web preview opens already signed in as a sample admin. Sign-out is stored in
the browser. Google and LinkedIn buttons on the join page return to that same
sample session. A real provider sign-in arrives with the new backend.

## The network

`/directory` finds members; `/network` and `/messages` are what make it two-way.

- Connecting is a **mutual edge** — a request does nothing until the other member
  accepts, and either side can withdraw or remove it afterwards.
- Accepting opens a **direct thread** inside the portal. No phone number or email
  changes hands: the sample layer never returns a private address to another
  member, and the handles on screen are an `alumniId` and a `connectionId`.
- Where a member you know also knows the one you are viewing, the portal **names
  them** instead of showing an abstract degree — that is who to ask for the
  introduction.

## Getting Started

First, install the dependencies:

```bash
npm install
```

Then start the web app:

```bash
npm run dev:web
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

Start the mobile app with:

```bash
npm run dev:native
```

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
```

## Available Scripts

- `npm run dev`: Start all applications in development mode
- `npm run build`: Build all applications
- `npm run dev:web`: Start only the web application
- `npm run check-types`: Check TypeScript types across all apps
- `npm run dev:native`: Start the React Native/Expo development server
