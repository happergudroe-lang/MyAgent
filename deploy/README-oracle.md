# Oracle Cloud Always Free deployment

This repository can run on an Oracle Cloud Infrastructure (OCI) Ubuntu ARM64 VM using the Always Free Ampere A1 allowance.

## Intended free-tier shape

- Shape: `VM.Standard.A1.Flex`
- Total tenancy allowance: up to 2 OCPUs and 12 GB RAM across A1 instances
- Image: Ubuntu 22.04 or 24.04, ARM64 / aarch64, marked Always Free Eligible
- Boot volume: keep within the tenancy's 200 GB combined Always Free block-volume allowance
- Region: the tenancy home region

OCI capacity is not guaranteed. If A1 capacity is unavailable, retry later rather than selecting a billable shape. Always verify the console labels each selected resource **Always Free Eligible** before creating it.

## 1. Create the VM

In OCI Console:

1. Open **Compute → Instances → Create instance**.
2. Name it `myagent-vm`.
3. Select the home region and an Ubuntu ARM64 image marked **Always Free Eligible**.
4. Select `VM.Standard.A1.Flex`, allocate 2 OCPUs and 12 GB memory (or a smaller amount if desired).
5. Use a public subnet and assign a public IPv4 address.
6. Add your SSH public key. Never upload or share your private key.
7. Keep the boot volume at its default size and confirm it is Always Free eligible.
8. Create the instance.

## 2. Configure OCI network ingress

In the VM's VCN security list or Network Security Group, add ingress rules:

- TCP 22 from **your own public IP** (preferred; do not expose SSH to everyone).
- TCP 80 from `0.0.0.0/0` and `::/0`.
- TCP 443 from `0.0.0.0/0` and `::/0`.

Do not expose port 3001 publicly. Nginx proxies requests to the app on localhost.

## 3. Bootstrap the application

SSH into the VM using the private key stored on your own computer:

```bash
ssh -i /path/to/private-key ubuntu@YOUR_PUBLIC_IP
```

Then run:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/happergudroe-lang/MyAgent.git
cd MyAgent
sudo bash deploy/oracle-cloud-setup.sh
```

The script installs Node.js 22, Nginx and build tools, builds the frontend, creates a restricted `myagent` system user, stores SQLite at `/var/lib/myagent/myagent.sqlite`, and registers a systemd service.

## 4. Configure a model key

Edit the root-only environment file on the VM:

```bash
sudo nano /etc/myagent/myagent.env
```

Uncomment and set at least one provider key, for example `OPENAI_API_KEY` or `DEEPSEEK_API_KEY`. Add `TAVILY_API_KEY` only if web search is required. Do not put secrets in GitHub, browser variables, screenshots, or chat messages.

Restart and inspect:

```bash
sudo systemctl restart myagent
sudo systemctl status myagent --no-pager
curl http://127.0.0.1:3001/api/health
```

The initial HTTP test is for setup only. Do not invite users until HTTPS is configured.

## 5. Domain and HTTPS

Point an A record for your domain to the VM public IPv4 address. Then configure a trusted TLS certificate (for example, Certbot with the Nginx plugin) and verify automatic renewal. After HTTPS is active, the app sets Secure session cookies in production.

## 6. Updating the app

```bash
cd /opt/myagent
sudo -u myagent git pull --ff-only
sudo -u myagent npm install
sudo -u myagent npm run build
sudo systemctl restart myagent
```

## 7. SQLite backup

Back up the database regularly. For a consistent live backup, use SQLite's backup command via Node/better-sqlite3 or stop the service briefly before copying the database. Store backups somewhere separate from the VM (for example, encrypted object storage or a local offline copy).

## Cost and availability safeguards

- Use only resources explicitly labeled **Always Free Eligible**. Do not create paid load balancers, paid compute shapes, paid block volumes, or extra public IP resources without checking pricing.
- Set an OCI budget and alerts, but note that budgets/alerts are notifications, not hard spending caps.
- A1 Always Free capacity may be unavailable in some home regions.
- Oracle's published idle-instance reclamation policy can apply to Always Free compute. A free-tier service is not an uptime guarantee.
- Keep provider API spending limits low for public testing. All users share server-configured provider credentials.
- This is a small single-VM deployment, not high availability. Keep off-VM backups.
