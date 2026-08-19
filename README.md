# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Tech Stack

### 📱 Frontend

- **React Native** – Cross-platform mobile development (iOS & Android)
- **TypeScript** – Strongly typed JavaScript for safer and more scalable code
- **Tailwind CSS** – Utility-first styling framework for fast and consistent UI design

### 🗄️ Backend & Infrastructure

- **SQL Database** – Structured data storage for users, app content, and analytics
- **Cloudflare** – Edge computing, serverless functions, API routing, security, and global performance optimization

## 🏗️ Architecture Overview

- React Native handles the mobile interface.
- TypeScript ensures type safety across the codebase.
- Tailwind provides consistent and maintainable styling.
- SQL stores structured application data.
- Cloudflare powers serverless backend logic, API endpoints, authentication, and global content delivery.

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

## Pointing the app at a backend

Nothing to configure. A fresh clone plus `npm install` and `npx expo start`
talks to the deployed Worker — no wrangler, no local database, no Cloudflare
account. Verification codes arrive in your real UT inbox, which is what a beta
tester experiences.

On startup the app prints which backend it picked:

```
[api] https://loop-db.longhorn-developers.workers.dev  (default)
```

**This writes to the production database.** Accounts you create and events you
post are real and other people will see them. That is the right default while
the team is testing flows end to end, and the wrong one if you are
experimenting — run the backend locally for that (below), which needs
`EXPO_PUBLIC_USE_LOCAL_API=1` in a `.env`. See `.env.example`.

`EXPO_PUBLIC_*` is inlined into the bundle at build time, so after editing
`.env` you must restart with `npx expo start --clear` **and** reload the app.
Editing it with Metro running has no effect.

## Starting the Server

The backend is a Cloudflare Worker, not a plain Node server. In development
`app/config/api.ts` points the app at whichever machine started Expo, on port
8787 — so the Worker has to be running locally or every request fails.

1. Open a second terminal, keeping the one running Expo open.

2. Set it up (once):

   ```bash
   cd server
   npm install
   cp .dev.vars.example .dev.vars
   npx wrangler d1 execute loop-db --local --file=schema.sql
   ```

   `.dev.vars` is git-ignored and its defaults work as-is. It is optional now —
   `[env.local]` already sends verification codes to this terminal rather than
   to an inbox, so you can sign in without it. Copy it anyway if you want to
   set a real `RESEND_API_KEY` or the R2 image base URL.

   The `d1 execute` line builds your own local SQLite copy of the database.
   Nothing you do locally touches production, and you do not need a Cloudflare
   account — the dev scripts run against `[env.local]`, which leaves out the two
   bindings that would otherwise require one.

3. Start it:

   ```bash
   npm run dev:lan
   ```

   `dev:lan` binds to `0.0.0.0` so a real phone on your wifi can reach it.
   `npm run dev` binds to localhost only, which is fine for Expo web and the
   iOS simulator but unreachable from a device.

See [`server/README.md`](server/README.md) for the rest — resetting the local
database, running migrations, and deploying.
