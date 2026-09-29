# Orbit Tabs

Orbit Tabs is a self-hosted Chrome tab manager for keeping named browser sessions in sync across devices. A session contains one or more **window slots**, so a two- or three-monitor layout is saved and restored as separate Chrome windows instead of being flattened into one tab list.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/m0peterson/bookmark-sync-gpt/tree/main/cloudflare)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/m0peterson/bookmark-sync-gpt)

**Cloudflare is the recommended no-card option.** Click **Deploy to Cloudflare**, authorize GitHub, and confirm the deployment. The Worker uses a D1 database and creates its tables and signing secret automatically. When deployment finishes, copy its `workers.dev` URL into the extension's **Server URL** field. Render remains available as an alternative.

## What is included

- Manifest V3 Chrome extension with a full-page dashboard.
- Email/password accounts and per-device identity.
- Multiple named sessions, multiple independently synchronized window slots, and one-click session restore.
- Optional live sync: debounced tab/window changes are pushed to the currently assigned session.
- Conflict-aware API writes using monotonically increasing session revisions.
- Node.js API backed by PostgreSQL.
- Dependency-free Cloudflare Worker API backed by D1.
- Render Blueprint plus a GitHub Actions deploy-hook workflow.

## Local development

### API

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

Create a PostgreSQL database first and put its connection URL in `server/.env`. The API creates its tables on startup. Check it with:

```bash
curl http://localhost:8787/health
```

### Chrome extension

1. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
2. Select the `extension/` directory.
3. Open Orbit Tabs, enter `http://localhost:8787`, and create an account.
4. Create a session, add one slot per monitor, assign each open Chrome window to a slot, then save or enable live sync.

Chrome-internal pages (`chrome://…`), the Chrome Web Store, and other privileged URLs cannot be reopened by extensions and are skipped during restore.

## Deploy to Cloudflare without a payment card

1. Click **Deploy to Cloudflare** at the top of this page and sign in with a free Cloudflare account.
2. Authorize the GitHub repository and confirm creation of the Worker and its `DB` D1 binding.
3. Open the generated `workers.dev/health` address. A response containing `"ok": true` means it is ready.
4. Copy the URL without `/health` into the extension's **Server URL** field.

The Cloudflare implementation lives in `cloudflare/`, has no runtime npm dependencies, and lazily creates its D1 schema. Its private token-signing secret is generated inside D1 on the first API request, so there are no secrets to copy into a dashboard.

## Deploy through GitHub to Render (alternative)

### One-click setup

1. Click the **Deploy to Render** button above and sign in to Render with GitHub.
2. Confirm the Blueprint. It provisions the web service and PostgreSQL database described by `render.yaml`; no database URL or JWT secret needs to be entered manually.
3. Wait for the health check to turn green, then copy the public `orbit-tabs-api` URL into the extension sign-in screen.

The button deploys from the canonical repository. To deploy your own changes, fork the repository and change the `repo=` value in the button URL to the URL of your fork before clicking it.

### Automatic updates

Render watches the linked GitHub branch and deploys new commits automatically. Alternatively, disable Render's native auto-deploy, create a Render **Deploy Hook**, save it as the GitHub Actions secret `RENDER_DEPLOY_HOOK_URL`, and keep `.github/workflows/deploy.yml` enabled. The workflow runs the test suite before triggering the hook.

The extension intentionally does not ship with a hard-coded hosted backend. This keeps account and browsing data in infrastructure you control.

## Data and security notes

- Passwords are stored as salted slow hashes (`scrypt` on Node/PostgreSQL or PBKDF2-SHA256 on Cloudflare); access tokens are signed, expire after 30 days, and are revocable by changing the account password.
- Only tab title, URL, pinned state, order, session/window names, and sync timestamps are sent to the server.
- Use HTTPS in production (both deployment options provide it). On Render, rotate `JWT_SECRET` if it is ever exposed; doing so signs out every device. Cloudflare keeps its generated signing key inside D1.
- Treat a restored session as navigation: URLs in that session will be opened by Chrome.

## Commands

```bash
cd server && npm test
cd server && npm run check
cd cloudflare && npm test
cd cloudflare && npm run check
```
