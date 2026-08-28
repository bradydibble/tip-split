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

There are two paths: **manual** (do everything yourself) or **CI/CD** (GitHub Actions handles builds and deploys after a one-time server setup). If you're using CI/CD, skip to that section — the steps below are for the manual path only.

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

## CI/CD Auto-Deploy (GitHub Actions)

Every merge to `main` automatically builds and deploys to your server. The workflow uses [tailscale/github-action](https://github.com/tailscale/github-action) — the runner joins your Tailscale network ephemerally, deploys, then disappears. Your server needs no public IP and no open firewall ports.

### One-time server setup

GitHub Actions handles cloning, building, writing `.env`, and restarting the service on every deploy. Before the first deploy you need to create the systemd service file and enable it — that's it.

**On your server, run:**

```bash
# Allow user services to run without an active login session
sudo loginctl enable-linger $USER

# Create the systemd service file
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/tipsplit.service << 'EOF'
[Unit]
Description=TipSplit App
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Restart=always
RestartSec=10
ExecStart=/usr/bin/podman run --rm --name tipsplit \
  -p 4000:3000 \
  -v tipsplit-data:/app/data \
  --env-file %h/tipsplit/.env \
  localhost/tipsplit:latest
ExecStop=/usr/bin/podman stop -t 10 tipsplit
TimeoutStopSec=30

[Install]
WantedBy=default.target
EOF

# Register and enable it (first deploy will start it)
systemctl --user daemon-reload
systemctl --user enable tipsplit.service
```

That's all. Do not clone the repo or create `.env` manually — the workflow does both.

### Generate a deploy key

```bash
# On your local machine
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_tipsplit -N ""

# Add the public key to the server
cat ~/.ssh/id_ed25519_tipsplit.pub | ssh user@yourserver "cat >> ~/.ssh/authorized_keys"
```

### Add GitHub secrets

Go to your repo → **Settings → Secrets and variables → Actions → Repository secrets** → **New repository secret**.

| Secret | Value |
|--------|-------|
| `TAILSCALE_AUTHKEY` | From [Tailscale admin → Settings → Auth Keys](https://login.tailscale.com/admin/settings/authkeys) — check **Ephemeral** |
| `DEPLOY_KEY` | Contents of `~/.ssh/id_ed25519_tipsplit` (the private key) |
| `DEPLOY_HOST` | Server's Tailscale IP |
| `DEPLOY_USER` | SSH username on the server |
| `ENV_FILE` | Full contents of your production `.env` (see `.env.example`) |

The `ENV_FILE` secret replaces the manual `.env` file — the workflow copies it to the server on every deploy, so your config is always in sync with what GitHub holds.

### After the first deploy

```bash
# SSH into your server and verify the service is running
systemctl --user status tipsplit.service
```

Open the app, log in with your `INITIAL_MANAGER_PIN`, create permanent user accounts, then remove `INITIAL_MANAGER_PIN` from your `ENV_FILE` secret.

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
