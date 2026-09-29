# Orbit Tabs

Orbit Tabs is a self-hosted Chrome tab manager for keeping named browser sessions in sync across devices. A session contains one or more **window slots**, so a two- or three-monitor layout is saved and restored as separate Chrome windows instead of being flattened into one tab list.

## What is included

- Manifest V3 Chrome extension with a full-page dashboard.
- Email/password accounts and per-device identity.
- Multiple named sessions, multiple independently synchronized window slots, and one-click session restore.
- Optional live sync: debounced tab/window changes are pushed to the currently assigned session.
- Conflict-aware API writes using monotonically increasing session revisions.
- Node.js API backed by PostgreSQL.
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

## Deploy through GitHub to Render

1. Push this repository to GitHub.
2. In Render, create a **Blueprint** from that repository. `render.yaml` provisions the web service and PostgreSQL database and connects them automatically.
3. After the first deploy, copy the service's public URL into the extension sign-in screen.
4. For deploy-on-push, Render already watches the linked branch. Alternatively, disable Render's native auto-deploy, create a Render **Deploy Hook**, save it as the GitHub Actions secret `RENDER_DEPLOY_HOOK_URL`, and keep `.github/workflows/deploy.yml` enabled.

The extension intentionally does not ship with a hard-coded hosted backend. This keeps account and browsing data in infrastructure you control.

## Data and security notes

- Passwords are stored as salted `scrypt` hashes; access tokens are signed, expire after 30 days, and are revocable by changing the account password.
- Only tab title, URL, pinned state, order, session/window names, and sync timestamps are sent to the server.
- Use HTTPS in production (Render provides it). Rotate `JWT_SECRET` if it is ever exposed; doing so signs out every device.
- Treat a restored session as navigation: URLs in that session will be opened by Chrome.

## Commands

```bash
cd server && npm test
cd server && npm run check
```

