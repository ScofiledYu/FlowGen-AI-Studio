# FlowGen AI Studio Deployment

> **生产（Windows Server + MySQL）** 请以 [`docs/Windows-Server-2012R2-离线部署说明.md`](docs/Windows-Server-2012R2-离线部署说明.md) 与 [`docs/mysql-deployment.md`](docs/mysql-deployment.md) 为准。  
> **多客户端容量 / 硬件 / 压测**：[`docs/capacity-and-hardware.md`](docs/capacity-and-hardware.md)

This document is for server deployment with app port fixed to `3000` (or `3001` on current production).

## 1) Prepare server

- Node.js `18+` (recommended `20 LTS`)
- npm `9+`
- Open firewall/security-group for:
  - `3000` (if direct exposure), or
  - only `80/443` when behind Nginx reverse proxy

## 2) Upload project and install dependencies

```bash
npm ci
```

If you only run production service:

```bash
npm ci --omit=dev
```

> If build is required on server, keep dev deps and run full `npm ci`.

## 3) Build frontend

```bash
npm run build
```

This generates static assets into `dist/`.

## 4) Start server on port 3000

`server.js` already uses:

- `PORT` env if provided
- fallback default `3000`

So you can run:

```bash
npm run start
```

Or explicitly:

```bash
PORT=3000 npm run start
```

On Windows PowerShell:

```powershell
$env:PORT=3000; npm run start
```

## 5) Keep process alive (recommended: PM2)

Install PM2 once:

```bash
npm i -g pm2
```

Start app:

```bash
pm2 start npm --name flowgen-ai-studio -- run start
```

Useful commands:

```bash
pm2 status
pm2 logs flowgen-ai-studio
pm2 restart flowgen-ai-studio
pm2 save
```

## 6) Nginx reverse proxy (optional, recommended)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

For HTTPS, add cert config (Let's Encrypt recommended).

## 7) Required env vars

- `AITOP_API_KEY` (strongly recommended in production)
- `PORT` (optional, defaults to `3000`; production often `3001`)
- `MYSQL_PASSWORD` and related `MYSQL_*` when using MySQL (see `docs/mysql-deployment.md`)
- `NODE_OPTIONS=--max-old-space-size=8192` recommended for multi-editor or large projects (see `docs/capacity-and-hardware.md`)

Example:

```bash
export AITOP_API_KEY="your-real-key"
export PORT=3000
npm run start
```

## 8) Quick health check

After startup:

- Open `http://<server-ip>:3000`
- Verify:
  - canvas loads
  - `/whoami` responds
  - video proxy endpoints work:
    - `/proxy-file?url=...`
    - `/task-status?taskId=...`
    - `/download-task-file?taskId=...`

## 9) Upgrade steps

For each update:

```bash
git pull
npm ci
npm run build
pm2 restart flowgen-ai-studio
```

