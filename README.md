# Case Competition Judging Portal

Serverless judging platform for ~22 judges, each marking ~20 team solutions. Hosted on **Netlify** with **CockroachDB** via Netlify Functions.

## Features

- **Judges**: Login with pre-assigned credentials; see greeting, title, progress (completed vs assigned); view case PDF; mark 10 criteria (100 pts total); mandatory team feedback; optional per-criterion feedback; save drafts or submit; edit submitted marks.
- **Admin**: Import teams via CSV (name + Google Drive PDF link); create/bulk-create judges; random assign, bulk assign all teams to one judge, or auto-distribute N teams per judge; download ZIP of PDF scorecards.
- **Leaderboard**: Public ranking by average total score.

## Marking criteria (100 points)

| Criterion | Max |
|-----------|-----|
| Situation Analysis | 10 |
| Problem Analysis | 10 |
| Target Group Analysis | 5 |
| Branding Justification | 10 |
| Big Idea | 15 |
| Marketing Strategy | 15 |
| Feasibility | 10 |
| Financials & Timeline | 5 |
| Monitoring & Evaluation | 5 |
| Idea Creativity | 15 |

## Local setup

```bash
npm install
cp .env.example .env
# Edit .env with DATABASE_URL, DB_CA_CERT, JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD
npm run db:init
npm run dev
```

For local API testing, install Netlify CLI and run:

```bash
npx netlify dev
```

(Vite proxies `/api` to port 8888 when using `netlify dev`.)

## Database (CockroachDB)

1. Download cluster CA cert (Windows PowerShell):

```powershell
mkdir -p $env:appdata\postgresql\
Invoke-WebRequest -Uri https://cockroachlabs.cloud/clusters/db892df1-965e-49fa-aa19-4b5adc0438c4/cert -OutFile $env:appdata\postgresql\root.crt
```

2. Build `DATABASE_URL` from Cockroach Cloud (SQL user, password, host, `defaultdb`).

3. Initialize schema:

```bash
npm run db:init
```

## Deploy to Netlify + GitHub

1. Push this repo to GitHub.
2. In [Netlify](https://app.netlify.com): **Add new site** → Import from GitHub.
3. Build settings (from `netlify.toml`): build `npm run build`, publish `dist`, functions `netlify/functions`.
4. Set **Environment variables** (Site settings → Environment variables):

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | `postgresql://USER:PASSWORD@HOST:26257/defaultdb?sslmode=verify-full` |
| `DB_CA_CERT` | Full contents of `root.crt` (paste as multiline) |
| `JWT_SECRET` | Long random string |
| `ADMIN_USERNAME` | Admin login (optional; run `db:init` locally first or set and redeploy) |
| `ADMIN_PASSWORD` | Admin password |

5. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in Netlify env vars. Tables are created automatically on the first API request (login). Or run locally once: `npm run db:init`.

6. Deploy. Judges log in at `/` (role: Judge). Admin at `/` (role: Admin).

### "relation admins does not exist"

The database schema was not created. Either:

- **Redeploy** after setting `DATABASE_URL`, `DB_CA_CERT`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` in Netlify — the API will create tables on the first request, or
- Run locally: `npm run db:init` (with `.env` configured).

## Admin workflow

1. **Import teams**: CSV with `team_name,pdf_drive_link,late_penalty` per line (`late_penalty` = points deducted, 0 if on time).
2. **Create judges**: Single form or bulk lines: `username,password,Display Name,Title`
3. **Assign**: Random N teams to one judge, assign all teams to one judge, or auto-distribute 20 per judge across all judges.
4. **Manage**: Delete judges or teams (single or all teams); remove assignments (and their marks); clear scores only (keeps assignment so the judge can mark again).
5. **Export**: Download ZIP of per-team PDF scorecards when marks are submitted.

## Security notes

- Never commit `.env` or passwords to GitHub.
- Store `DATABASE_URL`, `DB_CA_CERT`, and `JWT_SECRET` only in Netlify env vars.
- Rotate the SQL password if it was shared in chat.
- Netlify **secrets scanning** fails if real secrets appear in the repo or in built JS. This project keeps secrets only in serverless functions via runtime `env()` (not inlined at build). Do not add `VITE_` variables for secrets.
- If a deploy was blocked after secrets were committed, rotate `JWT_SECRET`, `ADMIN_PASSWORD`, and the DB password, then push the cleaned repo and redeploy.

### Netlify secrets scanner blocked the build?

1. Ensure `.env` is not tracked: `git rm --cached .env` if needed.
2. Never commit real passwords in `scripts/generate-env.mjs` or elsewhere.
3. Set secrets only in Netlify UI → Environment variables (scoped to Functions / Runtime, not exposed to the Vite build).
4. Clear cache and redeploy after pushing fixes.

## CSV example

See `sample-teams.csv`.
