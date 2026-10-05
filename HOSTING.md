# Hosting Voxly for free, 24/7 (Render + Supabase)

This makes Voxly run in the cloud, always on, with no device of yours required —
free, no credit card. Stack: **Render** (free web service) + **Supabase** (free
Postgres database) + a free **uptime pinger** to stop Render sleeping.

The code already supports this: when `DATABASE_URL` is set, Voxly stores
everything in Postgres instead of a local file (so nothing is lost on restart).

---

## 1. Free database — Supabase (5 min, no card)
1. Go to https://supabase.com → sign up (GitHub login is easiest) → **New project**.
2. Name it `voxly`, pick a strong DB password, choose the nearest region → **Create**.
3. When it's ready: **Project Settings → Database → Connection string → URI**.
   Copy it. It looks like:
   `postgresql://postgres:[YOUR-PASSWORD]@db.xxxx.supabase.co:5432/postgres`
   (Replace `[YOUR-PASSWORD]` with the DB password you set.)
   Keep this — it's your `DATABASE_URL`.

## 2. Bring your existing accounts over (optional, 1 command)
On your Mac, with the connection string from step 1:
```bash
cd ~/discord-clone
DATABASE_URL='postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres' node server/migrate.mjs
```
This copies your current accounts (AttackStudioYT, etc.), messages, and images into
Supabase. (Skip this if you'd rather start fresh — then use `DC_SEED_OWNER` in step 4.)

## 3. Put the code on GitHub (Render deploys from Git)
Render pulls from a Git repo, so the project needs to be on GitHub.
- If `git` errors with an Xcode-license message, run once (in the prompt, with `!`):
  `! sudo xcodebuild -license accept`
- Create an empty repo at https://github.com/new (e.g. `voxly`), then:
```bash
cd ~/discord-clone
git init && git add -A && git commit -m "Voxly"
git branch -M main
git remote add origin https://github.com/<you>/voxly.git
git push -u origin main
```
(`.gitignore` already excludes `server/data/`, `node_modules`, and build output.)

## 4. Deploy on Render (free, no card)
1. Go to https://render.com → sign up → **New → Blueprint**.
2. Connect your GitHub and pick the `voxly` repo. Render reads `render.yaml`.
3. Before the first deploy, set the env vars it asks for:
   - `DATABASE_URL` → the Supabase URI from step 1.
   - `DC_SEED_OWNER` → **only if you skipped step 2**, e.g. `owner@voxly.local::voxly123::Owner`.
   - (`JWT_SECRET` is auto-generated; leave it.)
4. **Create / Deploy.** First build takes a few minutes. You'll get a URL like
   `https://voxly-xxxx.onrender.com` — that's your permanent link. Open it, log in.

## 5. Stop it from sleeping (free)
Render's free tier sleeps after ~15 min idle. Keep it awake:
1. Go to https://uptimerobot.com (free) → add a **HTTP(s) monitor**.
2. URL: `https://voxly-xxxx.onrender.com/api/health`, interval **5 minutes**.
That ping keeps the server up 24/7 within the free hours.

---

## Managing accounts on the cloud
Create/manage hosted accounts from your Mac by pointing the admin tool at Supabase:
```bash
DATABASE_URL='postgresql://...supabase...' npm run admin -- create-user friend@x.com 'pass' 'Friend'
DATABASE_URL='postgresql://...supabase...' npm run admin -- list-users
```

## Notes
- WebRTC calls work because Render gives a valid HTTPS URL (camera/mic need that).
- Images are stored in Postgres; Supabase free is 500 MB — plenty for a friend group.
- The desktop apps (Mac/Windows) can point at the Render URL later via `VITE_API_BASE`.
- Local development is unchanged: with no `DATABASE_URL`, Voxly uses the local file DB.
