# Deploying P5 Client Hours

Everything runs on Render, from the Pillar 5 ICT GitHub account.

| Part | Folder | Render service | What it is |
|---|---|---|---|
| Website | `frontend/` | `p5-hours-web` | The screens people use (Next.js) |
| Server | `backend/` | `p5-hours-api` | Sign-in, rules and reports (Express). The only thing that touches the database |
| Database | | `p5-hours-db` | PostgreSQL |
| Alerts | `backend/` | `p5-hours-alerts` (cron) | Catches up on the 80% and 100% emails |
| Daily job | `backend/` | `p5-hours-daily` (cron) | End-of-cycle email to the managers, and the forgotten-timer reminder |

`render.yaml` in the repo creates all five in one go.

## Before you start

You need: a GitHub login that can create repositories in the `P5-ICT` organisation, the Render account that the ICT GitHub pays for, and a Resend account (email). Have ready: the staff list with **email addresses**, the real project names, the client name, the hours per cycle and the first day of a cycle (see section 2 of `PRODUCTION-PLAN.md`). The decisions from the team meeting are in `MEETING-CHANGES.md`.

## 1. Put the code on the ICT GitHub

The repository is `P5-ICT/p5-client-hours`.

1. On GitHub, signed in to the ICT account: **New repository**. Owner `P5-ICT`, name `p5-client-hours`, **Private**. Leave "Add a README", ".gitignore" and "licence" **unticked** (the repository must start empty).
2. In the project folder, in a terminal:

```bash
git remote set-url origin https://github.com/P5-ICT/p5-client-hours.git
git push -u origin main
```

3. The first push opens a browser window to sign in. **Sign in with the ICT account**, not a personal one.
4. On GitHub: **Settings > Branches > Add rule** for `main`, tick **Require status checks to pass** and choose **CI** (it appears after the first run, under the Actions tab).
5. Check that no secrets went up: the repository should contain `.env.example` files but never a `.env` file.

If the push is refused with a "permission" error, the signed-in account does not have write access to `P5-ICT`. Ask an owner of the organisation to add you under **People**.

## 2. Email (Resend)

1. Create a Resend account and an API key.
2. For the pilot you can send from `onboarding@resend.dev`, but it only delivers to your own address. Before inviting the team, add and verify the Pillar 5 domain in Resend and set `MAIL_FROM` to an address on it.

If you skip email, everything still works: the admin copies each "set your password" link from the **Team and settings** screen and sends it by WhatsApp. The 80% and 100% alerts, the end-of-cycle email and the timer reminder need email.

## Free trial first (costs nothing)

`render.yaml` creates paid services (about US$24.50 a month plus US$1 or more for each scheduled job, as shown on Render's Blueprint screen). To try the system without paying, use `render.free.yaml` instead:

1. Render dashboard > **New > Blueprint** > choose the repository.
2. Set **Blueprint Path** to `render.free.yaml` (the field under "Branch").
3. Fill in the three prompts (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `RESEND_API_KEY`, which can be `none`) and press **Deploy Blueprint**. Then follow steps 3 to 6 below as usual.

| | Free trial (`render.free.yaml`) | Real use (`render.yaml`) |
|---|---|---|
| Cost | $0 | about $24.50 a month, plus the scheduled jobs |
| Database | **Deleted 30 days after it is created**, no backups, 1 GB | Kept, with backups |
| Website and server | Go to sleep after 15 minutes without a visit. The next visit waits about a minute | Always on |
| 80% and 100% emails | Yes | Yes |
| End-of-cycle email and forgotten-timer reminder | No | Yes (the two scheduled jobs) |
| Use it for | Showing the team, trying it out, a short pilot with test data | Real hours that go to the client |

Render allows one free database per workspace. When the trial works and you are ready for real hours, delete the trial services and create a new Blueprint from `render.yaml`. Nothing carries over from the free database, so set up the real data again (step 4).

If your Render workspace shows a **Payment failed** banner, fix the card (or ask whoever pays for the workspace) before creating any paid service from `render.yaml`. The free trial does not need a working card.

## Test accounts for the team (free trial only)

The free trial can come with ready-made test accounts and sample data, so colleagues can try the system without using your email. It is controlled by two settings on `p5-hours-api` (Render > the service > **Environment**):

| Setting | Value |
|---|---|
| `DEMO_DATA` | `1` (already in `render.free.yaml`) |
| `DEMO_PASSWORD` | the one password everyone will use, 10 or more characters. Add it yourself: Render only asks for it when a Blueprint is first created |

Save, and the service restarts and creates the accounts. The log shows `Demo data: seeded`. Every account uses the password you chose:

| Sign in as | Email | Good for trying |
|---|---|---|
| Staff | `staff@pillar5group.com` | The timer, typing in hours, My entries |
| Second staff | `staff2@pillar5group.com` | A different person's view |
| Manager | `manager@pillar5group.com` | Approvals, reports, adding hours, typing hours in for someone else |
| Second manager | `manager2@pillar5group.com` | Approving what the first manager typed in |
| CEO | `ceo@pillar5group.com` | The same as a manager |
| Admin | `admin@pillar5group.com` | Team and settings, department hours |
| Client | `client@pillar5group.com` | What the client sees (approved hours only) |

The sample data tells the story from the guide: last cycle ended 7.5 hours over, this cycle is 33 of 50 hours with 11 hours waiting, and one entry was typed in by a manager.

Safeguards while the trial is on: a banner says it is a trial; demo accounts cannot change the shared password; a demo admin cannot deactivate or reset a real account (yours); and five wrong passwords lock an account for 5 minutes, which clears when you save the settings again.

**To start the sample data again** (after testers have left a mess): add `DEMO_RESET` = `1` to `p5-hours-api`, save, wait for the restart, then **delete `DEMO_RESET`** again. It wipes the hours and rebuilds the sample story. It refuses to run if real people (other than an admin) have been added.

**Changing the shared password:** change `DEMO_PASSWORD` and save. All demo sessions end and everyone uses the new one.

These accounts and this switch do not exist in `render.yaml` (real use). Never set `DEMO_DATA` on a system with real hours.

## 3. Deploy on Render

1. Render needs permission to read the repository. **Account Settings > GitHub > Connect**, install the Render app on the **P5-ICT** organisation and give it `p5-client-hours`. (An owner of the organisation has to approve this the first time.)
2. Render dashboard > **New > Blueprint** > choose `P5-ICT/p5-client-hours`. It reads `render.yaml` and lists the five services. Fill in the values it asks for:

| Variable | Value |
|---|---|
| `ADMIN_EMAIL` | your work email (the first admin) |
| `ADMIN_PASSWORD` | a long password, at least 10 characters |
| `RESEND_API_KEY` | the key from step 2. If you do not have it yet, type `none`: everything works except emails, and the admin copies invite links by hand. Replace it later in the service's **Environment** tab |

   Each of the two jobs asks for its own copy of `RESEND_API_KEY` (and the daily job for `APP_URL`). Use the same values. `MAIL_FROM` already has a starting value; once your domain is verified in Resend, change it in all three services.

3. Wait for the first deploy, then open `https://p5-hours-api.onrender.com/health`. It should show `{"ok":true}`.
4. **Check the two addresses.** `render.yaml` assumes the services get the addresses `https://p5-hours-api.onrender.com` and `https://p5-hours-web.onrender.com`. Look at each service's real address in Render. If one has a suffix (because the name was taken), correct these and redeploy:

| Where | Variable | Should be |
|---|---|---|
| `p5-hours-api` | `CORS_ORIGIN` and `APP_URL` | the website's real address |
| `p5-hours-web` | `NEXT_PUBLIC_API_URL` | the API's real address |
| `p5-hours-daily` | `APP_URL` | the website's real address |

   `NEXT_PUBLIC_API_URL` is built into the website, so after changing it press **Manual Deploy > Deploy latest commit** on `p5-hours-web`. No trailing slash on any of them.
5. On first start the API creates the tables and your admin account. After you have signed in once, **delete `ADMIN_PASSWORD`** from the `p5-hours-api` environment.

Region: everything is created in **Frankfurt**, the closest Render region to South Africa. Plans: `render.yaml` asks for Render's cheapest paid database (`0.1c-256mb`) and cheapest paid web plan (`0.5c-512mb`) for both web services. These names were checked against Render's Blueprint documentation in November 2026; Render also validates the file when you create the Blueprint and will say which line it does not accept. Render's free web service sleeps when idle (the first visit after a quiet period takes about a minute, and a running timer's page goes stale), and the free database is deleted after 30 days. Do not use either for real hours.

## 4. Set up the real data (as admin)

1. Open the website address and sign in with `ADMIN_EMAIL`.
2. **Management > Team and settings**:
   1. Set the client name, hours per cycle, cycle length, the shortest timer that can be submitted, and the first day of a cycle. Save.
   2. Under **Hours for each department**, share the cycle's hours between departments (for example marketing 8 of 45). Leave a box empty for no share.
   3. Add the departments and projects, then add people (or paste the team JSON with an `email` for each person).
   4. Give the managers (Mrs Candice, Mrs Gabi, Megan) the **Manager** access, the CEO the **CEO** access, and add one **Client** user for the client contact.
3. Add a **second admin**, so one person leaving does not lock the system.

## 5. Check it works (about 15 minutes)

1. Sign in as a staff member, start the timer on a phone, stop it on a laptop. The timer must follow you.
2. Submit the entry. Sign in as a manager and approve it. Try to approve your own entry: it must be refused.
3. Sign in as the client. Only the approved entry shows, and no pending hours.
4. Approve enough hours to pass 80% of the hours allocated. The managers get one email.
5. As a manager, type in hours for another person, then check you cannot approve them yourself but another manager can.
6. **Management > Reports**: switch between Cycle, Week and Month, and download the Excel file. Open it and check the totals.
7. Click your name at the top right, change your password, and check that a second device you were signed in on is asked to sign in again.
8. In Render, open `p5-hours-daily` and press **Trigger Run**. The log should say "No cycle summary to send" and "No stale timers" (or send them, if there is something to send).

## Backups

Render's paid Postgres plans keep daily backups. Before go-live, open the database on Render and confirm backups are on, and do one test restore into a scratch database.

## Local development

```bash
# Terminal 1: the API on an in-process database (nothing to install)
cd backend && npm install && npm run dev:local     # http://localhost:4000, admin@example.com / local-admin-password

# Terminal 2: the website
cd frontend && npm install && cp .env.example .env.local && npm run dev    # http://localhost:3000
```

To develop against a real Postgres instead, copy `backend/.env.example` to `backend/.env`, fill it in, and run `npm run dev`.

**Do not keep `node_modules`, `.next` or `dist` inside a OneDrive folder that two computers share.** OneDrive copies those thousands of files and, when both computers change one at once, sets one aside as `name-COMPUTERNAME.ext`. That is how conflicting copies ended up in the project. Work from a normal `git clone` outside OneDrive (for example `C:\dev\p5-client-hours`) and use Git, not OneDrive, to move changes between computers.

## Day-to-day

- **New person:** Team and settings > Add a person. Managers and the CEO can add staff and client accounts for their team; only an administrator can add managers, the CEO or other administrators. The person gets an email to choose their password.
- **Someone left:** Deactivate them. Their old entries stay. They cannot sign in at once.
- **Forgot password:** the person uses "Forgot your password?", or the admin presses **Reset password** next to their name. Reset links work for 2 hours; invites for 7 days. A reset clears a lock-out.
- **Changed password:** the person opens their name at the top right > Change password. Every other device is signed out.
- **Locked out:** five wrong passwords in a row locks that account for 5 minutes, then 15, then 60. A reset link clears it.
- **End of a cycle:** the managers get one email with the figures. Check the entries, then open the client report to copy, download or print it for the client.
- **Forgotten timer:** the person gets one email a day while a timer has been running for more than 14 hours.
- **Who did what:** every approval, rejection, deletion, extra-hours change, lock-out and settings change is in the `audit_log` table.
