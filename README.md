# TipSplit

A mobile-first PWA for post-shift restaurant tip calculation and distribution. Enter gross tips and liquor sales, confirm who worked, and get whole-dollar per-person amounts in seconds. Exports to Google Sheets and generates a screenshot-ready share card for group chats.

**[Report an issue](../../issues)**

---

## Features

- PIN-only login — no username, no app store
- Configurable split logic (CC fees, kitchen %, bar liquor %)
- Whole-dollar payouts with random remainder distribution
- Separate Lunch / Dinner calculations with configurable cutoff time
- Google Sheets export (append-only audit log)
- Screenshot-friendly share card
- Installable PWA — Add to Home Screen on iOS and Android

---

## Self-Hosted Setup

Runs as a single rootless Podman container on any Linux host. No external services required.

### Prerequisites

- Linux host (RHEL 9+, Rocky Linux 9+, Fedora, Ubuntu, Debian, etc.)
- [Podman](https://podman.io/getting-started/installation) — or Docker (compose file included)
- [Git](https://git-scm.com/)
- Port 4000 accessible from your reverse proxy

The steps below are the portable self-hosted path. Brady's production environment has a separate GCP deployment command documented later in this file.

### Manual path

**1. Clone and configure**

```bash
git clone https://github.com/bradydibble/tip-split ~/tipsplit
cd ~/tipsplit
cp .env.example .env
```

Edit `.env` — at minimum:

```bash
INITIAL_MANAGER_PIN=1234   # remove after first login
```

**2. Create the systemd user service**

```bash
mkdir -p ~/.config/systemd/user
cp deploy/tipsplit.service.example ~/.config/systemd/user/tipsplit.service
```

Update the `--env-file` path in the service file if you cloned somewhere other than `~/tipsplit`. Then:

```bash
sudo loginctl enable-linger $USER
```

**3. Build and start**

```bash
podman build -t tipsplit:latest .
systemctl --user daemon-reload
systemctl --user enable --now tipsplit.service
```

Verify: `systemctl --user status tipsplit.service`

**4. Reverse proxy**

Point your proxy at `localhost:4000`. Caddy example:

```
http://tipsplit.yourdomain.com {
    reverse_proxy localhost:4000
}
```

**5. First login**

Enter your `INITIAL_MANAGER_PIN`. Go to **Settings → Staff Roster** to add staff, then **Settings → Users** to create shift lead accounts. Remove `INITIAL_MANAGER_PIN` from `.env` and restart once you have permanent accounts.

---

## Docker / Podman Compose

If you prefer Compose over systemd:

```bash
cp .env.example .env   # edit as above
docker compose -f deploy/compose.yaml up -d
```

---

## Brady's Production Deployment

Production is a GCE VM named `tipsplit-vm` in Brady's personal GCP project `homelab-personal-502823`. It is not Cloud Run and it is not on cairn-02. GitHub Actions runs tests only; merging `main` does not deploy automatically.

From any checkout, including a dirty feature branch, deploy the current `origin/main` with one command:

```bash
npm run deploy:gcp
```

The command fetches `origin/main` into a clean temporary worktree, builds and tags that exact commit in Cloud Build, resolves the immutable Artifact Registry digest, and deploys it to the VM through IAP. The VM-side step authenticates with its attached service account, creates an online SQLite backup, preserves runtime application settings, applies the required SELinux volume label, checks SQLite integrity and HTTPS health, and automatically rolls back the container if verification fails.

Required local access: `gcloud` authenticated as `bradydibble@gmail.com` with access to the personal project. The production target is intentionally fixed in the script so an old homelab inventory cannot redirect a deployment.

---

## Google Sheets Export

1. Create a [Google Cloud service account](https://console.cloud.google.com/iam-admin/serviceaccounts) with the **Google Sheets API** enabled
2. Download the JSON key file
3. Share your target spreadsheet with the service account email (`...@...iam.gserviceaccount.com`)
4. In TipSplit **Settings**, enter the spreadsheet ID and sheet name
5. Add `GOOGLE_SERVICE_ACCOUNT_JSON` to your `.env` (paste the JSON as a single line)

Each exported calculation appends one row with the full breakdown.

---

## Development

```bash
npm install
cp .env.example .env    # set INITIAL_MANAGER_PIN
npm run dev             # http://localhost:5173
npm test                # unit tests
npm run check           # TypeScript
```

---

## Phase 2: Square Integration

Phase 2 will pull tip totals and liquor sales directly from Square, auto-assign staff to shifts from clock-in data, and eliminate all manual data entry. The Square API has been validated against the sandbox — see the PRD for details.

---

## License

MIT
