# Deploying the Rental Platform

This app runs on two services: **Turso** (hosted database) and **Vercel**
(hosted app). Both need your own account — nobody else's login works for
your data. Local development keeps using a plain SQLite file (`dev.db`) and
is unaffected by any of this.

## 1. Create the database (Turso)

1. Go to [turso.tech](https://turso.tech) and sign in (sign up if you don't have an account).
2. Click **Create Database**. Name it (e.g. `rental-platform`), pick a region, create it.
3. On the database page, copy the **libsql URL** — looks like
   `libsql://rental-platform-yourname.aws-eu-west-1.turso.io`.
4. Create a token (**Tokens → Create Token**) and copy it — it's shown once.

## 2. Generate a session secret

Run this once, anywhere with Node installed, and save the output:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Apply the database schema to Turso

In the project folder, create a file named `.env.production` (this file is
git-ignored — it never gets committed) with:

```
DATABASE_URL="libsql://your-db-url-from-step-1"
DATABASE_AUTH_TOKEN="your-token-from-step-1"
```

Then run:

```bash
npx dotenv -e .env.production -- npm run db:deploy
```

This creates every table the app needs on the live database. You only need
to re-run this after a future schema change, not on every deploy.

## 4. Deploy the app (Vercel)

1. `npm install -g vercel` (if you don't have the CLI), then `vercel login`
   — this opens a browser to sign into your Vercel account.
2. From the project folder: `vercel link` — creates/links a Vercel project.
3. Add the three environment variables in the Vercel dashboard (Project →
   Settings → Environment Variables), or via CLI:
   ```bash
   vercel env add DATABASE_URL production
   vercel env add DATABASE_AUTH_TOKEN production
   vercel env add AUTH_SECRET production
   ```
   (paste the Turso URL/token from step 1, and the secret from step 2)
4. Deploy: `vercel --prod`

## 5. First login

Visit the URL Vercel gives you. Since the database is empty, you'll land on
the first-run setup screen — that account becomes the **Platform
Administrator**. From there, use "Onboard a new organization" to create your
first landlord customer.

## Notes

- **Future schema changes**: after editing `prisma/schema.prisma` and running
  a local migration (`npx prisma migrate dev`), re-run step 3's command
  against `.env.production` to bring Turso up to date before deploying the
  new code.
- **`prisma migrate deploy` does not work against Turso** — the `libsql://`
  URL scheme isn't one the Prisma CLI understands directly. `npm run
  db:deploy` (via `prisma/deploy-turso.ts`) does the same job by applying
  each migration's SQL through the libsql client itself and recording it in
  Prisma's own migrations table, so `prisma migrate status` still works
  correctly for diagnostics.
- **Backups**: Turso has its own backup/point-in-time-restore features in
  its dashboard — worth checking before this holds any real customer data.
- **Compliance**: once any organization loads real tenant PII, check
  Kenya's ODPC (Data Protection) registration requirements (or the
  equivalent for wherever your customers are).
