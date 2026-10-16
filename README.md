# Dispatch

Al Liwan Group geography reporting. Team members log updates as they go (typed or dictated, structured by Claude), send a report every two weeks, and managers review and comment.

- **App:** Next.js on Vercel
- **Logins:** Clerk
- **Data and access rules:** Convex (`convex/`)
- **Voice to report:** browser dictation, then the Claude API from a Convex action

Setup: see [SETUP.md](SETUP.md).

Development: `npm install`, then `npx convex dev` in one terminal and `npm run dev` in another. Backend permission tests: `npm test`.
