# Dispatch: setup guide

About 30 minutes, once. You copy keys between four dashboards; no code.

Keep a private note open while you work. You'll collect six values:

| Value | Where it comes from |
|---|---|
| Clerk publishable key (`pk_...`) | Clerk |
| Clerk secret key (`sk_...`) | Clerk |
| Clerk issuer URL (`https://...`) | Clerk |
| Convex deploy key | Convex |
| Claude API key (`sk-ant-...`) | Anthropic Console |
| Your email for the owner account | You |

Never paste these keys into a chat, email or document anyone else can see.

---

## 1. Clerk (logins)

1. Open dashboard.clerk.com and create an application called **Dispatch**.
2. Sign-in options: turn on **Email** (with email verification code), **Google** and **Microsoft**. Turn off passwords if offered.
3. Go to **Integrations**, find **Convex**, and activate it. Copy the **Frontend API URL** it shows. That is your **issuer URL**.
4. Go to **API keys**. Copy the **publishable key** and the **secret key**.

## 2. Convex (database)

1. Open dashboard.convex.dev and create a project called **dispatch**.
2. Open the **Production** deployment, then **Settings > Environment Variables**. Add:

   | Name | Value |
   |---|---|
   | `CLERK_JWT_ISSUER_DOMAIN` | your Clerk issuer URL |
   | `CLERK_SECRET_KEY` | your Clerk secret key |
   | `OWNER_EMAIL` | the email you will sign in with |
   | `ANTHROPIC_API_KEY` | your Claude API key |

3. Still in Production **Settings**, click **Generate Production Deploy Key**. Copy it. That is your **Convex deploy key**.

## 3. Vercel (hosting)

1. In vercel.com, click **Add New > Project** and import the **alg-dispatch** GitHub repo.
2. Before clicking Deploy, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
   | `CLERK_SECRET_KEY` | Clerk secret key |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
   | `CONVEX_DEPLOY_KEY` | Convex deploy key |

3. Click **Deploy**. The build command is already set in the repo. You get a link like `alg-dispatch.vercel.app`.

## 4. First sign-in

1. Open the link and sign in with the email you set as `OWNER_EMAIL`.
2. The first owner sign-in creates the seven geographies and the team: Amy, Laurie, Ken, Zain, Nancy.
3. Go to **Team**, click **Edit** on each person and add their work email.
4. Send them the link. They sign in with that email and land in their own view.

Anyone who signs in with an email that isn't on the Team page sees "not on the team list" and nothing else.

## 5. Your own domain (when ready)

1. In Vercel: **Project > Settings > Domains**, add e.g. `reporting.alliwan.com`. Vercel shows one DNS record. Send that to whoever manages ALG's domain.
2. In Clerk: switch the app to **Production**, add the same domain, and follow the DNS records it lists. Production gives you new keys: update `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in Vercel, and `CLERK_SECRET_KEY` and `CLERK_JWT_ISSUER_DOMAIN` in Convex, then redeploy.

---

## If something goes wrong

| What you see | Fix |
|---|---|
| "The app can't find its database address" | `CONVEX_DEPLOY_KEY` is missing in Vercel. Add it and redeploy. |
| Stuck on "Checking your access" or "Sign-in isn't fully set up" | Check `CLERK_JWT_ISSUER_DOMAIN` and `CLERK_SECRET_KEY` in Convex. The Convex integration must be active in Clerk. |
| "You're not on the team list" when you are the owner | `OWNER_EMAIL` in Convex must match your sign-in email exactly. |
| "Voice structuring isn't set up yet" | Add `ANTHROPIC_API_KEY` in Convex. |
| Mic button missing | The browser doesn't support dictation (Firefox). Use Chrome, Edge or Safari, or the mic on the phone keyboard. |

## Who can do what

| | Owner (Hela) | Manager (Amy) | Reporter |
|---|---|---|---|
| See all geographies | Yes | Yes | Only their own |
| Log updates | Any geography | Any geography | Their geographies |
| Edit or delete others' updates | Yes | No | No |
| Send biweekly reports | Yes | Yes | Yes |
| Review reports, comment, send back | Yes | Yes | Comment on their own |
| Manage team, geographies, cycle dates | Yes | No | No |

Access rules are enforced in the database, not just hidden in the screens.
