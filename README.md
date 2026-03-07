<h1 align="center">
  🍳 LetMeCook
</h1>

<p align="center">
  <strong>A self-hosted developer operating system — manage projects, write code, track activity, and ship faster from one dashboard.</strong>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-features">Features</a> •
  <a href="#%EF%B8%8F-architecture">Architecture</a> •
  <a href="#-configuration">Configuration</a> •
  <a href="#-roadmap">Roadmap</a>
</p>

---

## What is LetMeCook?

LetMeCook is a **fully self-hosted personal developer dashboard** that brings together everything you need in one place:

- **Browser-based IDE** (code-server) with a built-in VS Code extension
- **Project management** with tasks, milestones, and kanban boards
- **Activity tracking** with a GitHub-style heatmap and weekly wrapped summaries
- **Background jobs** for git cloning, scaffolding, backups, and AI tasks
- **AI copilot** for generating tasks, commit messages, repo chat, and more
- **Google Drive backups**, **Cloudflare Tunnel** integration, and **dev journal**

Deploy it on any Linux server with Docker and you're ready to go.

---

## 🚀 Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/) (v2+)
- A Linux server (bare metal, VPS, or even a Raspberry Pi)

### 1. Clone the repo

```bash
git clone https://github.com/sciboyrocks/letmecook.git
cd letmecook
```

### 2. Create your environment file

```bash
cp .env.example .env
```

Generate the required secrets:

```bash
# Generate SESSION_SECRET
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env

# Generate API_KEY
echo "API_KEY=$(openssl rand -hex 32)" >> .env
```

### 3. Start everything

```bash
docker compose up -d --build
```

### 4. Open LetMeCook

| Service         | URL                        |
|-----------------|----------------------------|
| **Dashboard**   | `http://localhost:3001`     |
| **API**         | `http://localhost:3000`     |
| **Code Server** | `http://localhost:8080`     |

On first visit you'll be guided through **TOTP setup** — scan the QR code with any authenticator app (Google Authenticator, Authy, etc.) and you're in.

---

## ✨ Features

### 📊 Dashboard
- Project cards with status badges, tech stack icons, and quick actions
- GitHub-style **activity heatmap** tracking your coding time
- **Pick-up banner** — shows your last active project so you can jump right back in
- **Weekly Wrapped** — a dev recap of your week every Sunday
- Global **scratchpad** for quick notes

### 📁 Project Management
- Create projects from scratch, clone from GitHub, or scaffold from templates (Next.js, Express, Vite, Go, Python)
- Per-project **task boards** with drag-and-drop, priorities, and milestones
- **Quest Log** — a daily priority view showing one top task per active project
- Open any project directly in code-server from the dashboard

### 💻 Integrated Code Server
- Full VS Code experience in the browser (code-server)
- Pre-installed **LetMeCook VS Code extension** with:
  - Activity heartbeat tracking (auto-tracks coding time)
  - Task sidebar and quick actions
  - One-click Cloudflare tunnel to expose ports
  - Git commit & push from the command palette
  - AI commands (generate tasks, explain errors, commit messages)

### 🤖 AI Copilot
- Multi-provider support: **Gemini**, **OpenAI**, **Anthropic**
- Generate task checklists from a goal sentence
- Auto-generate commit messages from staged diffs
- Chat with your repo (AI reads your code for context)
- Bootstrap entire projects from a PRD
- Session recaps → auto-drafted journal entries
- Built-in rate limiting and safety guardrails

### 📓 Dev Journal
- Write daily entries documenting what you built
- Attach images (up to 10 MB)
- AI can auto-draft journal entries from your session activity

### 🔧 Infrastructure
- **Cloudflare Tunnel** management — expose ports publicly with one click
- **System monitor** — live CPU, RAM, disk, and container stats
- **Google Drive backups** — automatic project backups (keeps last 7)
- **Audit logging** for security-sensitive operations

### 🔒 Security
- TOTP-only authentication (no passwords to leak)
- Session cookies with configurable secrets
- Helmet CSP + CORS hardening
- Rate-limited login (5 attempts per 15 min)
- API key auth for extension requests

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────┐
│  Next.js 15 (Web Dashboard)        :3001         │
│  App Router · TanStack Query · Tailwind · shadcn │
└──────────────────┬───────────────────────────────┘
                   │ /api/* proxy
┌──────────────────▼───────────────────────────────┐
│  Fastify v5 (API Server)            :3000        │
│  Zod validation · Pino logging · TOTP auth       │
│  18 route modules · HTTP+WS proxy to code-server │
└──────────┬───────────────────┬───────────────────┘
           │ enqueue           │ proxy
    ┌──────▼──────┐    ┌──────▼──────┐
    │    Redis    │    │ code-server │
    │  (BullMQ)  │    │    :8080    │
    └──────┬──────┘    └─────────────┘
           │ process
    ┌──────▼──────────────────────────────┐
    │  Worker (separate Node.js process)  │
    │  clone · scaffold · backup · AI    │
    │  export-zip · progress via SSE     │
    └─────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui, TanStack Query |
| Backend | Fastify v5, TypeScript, Zod, Pino |
| Database | SQLite (better-sqlite3) with versioned migrations |
| Job Queue | BullMQ + Redis |
| Auth | TOTP (otplib) + session cookies |
| IDE | code-server (VS Code in browser) |
| Extension | Custom VS Code extension (TypeScript + esbuild) |
| Containers | Docker Compose (4 services) |

### Monorepo Structure

```
letmecook/
├── apps/
│   ├── api/          ← Fastify backend (TypeScript)
│   │   └── src/
│   │       ├── routes/       18 route modules
│   │       ├── plugins/      auth + security
│   │       ├── db/           SQLite + migrations
│   │       ├── lib/          utilities + AI providers
│   │       └── worker.ts     BullMQ job processor
│   └── web/          ← Next.js frontend
│       ├── app/              pages (dashboard, projects, quest, journal, monitor)
│       ├── components/       UI components
│       └── lib/              typed API client
├── letmecook-extension/  ← VS Code extension
│   └── src/
│       ├── commands/         dashboard, clone, expose port, AI
│       └── providers/        task tree + webview
├── docker-compose.yml
├── Dockerfile            ← API image
├── Dockerfile.web        ← Next.js image
└── Dockerfile.code-server ← code-server + extension
```

---

## ⚙️ Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `SESSION_SECRET` | ✅ | Min 32 chars. Signs session cookies. `openssl rand -hex 32` |
| `API_KEY` | ✅ | Authenticates VS Code extension requests. `openssl rand -hex 32` |
| `DATA_DIR` | — | Data storage path (default: `/app/data`) |
| `PROJECTS_DIR` | — | Project files path (default: `/app/data/projects`) |
| `CODE_SERVER_HOST` | — | Code-server hostname (default: `code-server`) |
| `CODE_SERVER_PORT` | — | Code-server port (default: `8080`) |
| `REDIS_URL` | — | Redis URL (default: `redis://redis:6379`) |
| `DOMAIN` | — | Your public domain for CORS/tunnels (default: `localhost`) |

#### Optional: Google Drive Backups

| Variable | Description |
|----------|-------------|
| `GDRIVE_OAUTH_CLIENT_ID` | OAuth2 Client ID from Google Cloud Console |
| `GDRIVE_OAUTH_CLIENT_SECRET` | OAuth2 Client Secret |
| `GDRIVE_FOLDER_ID` | Target folder ID in Google Drive |

#### Optional: AI Providers

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `*_MODEL` | Override default model for any provider |

See [.env.example](.env.example) for the full list with comments.

---

## 🐳 Docker Services

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| `redis` | redis:7-alpine | 6379 | Job queue + caching |
| `api` | Custom (Node 22) | 3000 | Fastify API server |
| `web` | Custom (Node 22) | 3001 | Next.js dashboard |
| `code-server` | Custom (code-server) | 8080 | Browser IDE with LetMeCook extension |

### Useful Commands

```bash
# Start all services
docker compose up -d --build

# View logs
docker compose logs -f api

# Rebuild a single service
docker compose up -d --build api

# Stop everything
docker compose down

# Stop and remove all data (⚠️ destructive)
docker compose down -v
```

### Data Persistence

| Volume | Contents |
|--------|----------|
| `redis-data` | Job queue state |
| `api-data` | SQLite database, project files |
| `code-server-data` | IDE state, settings |
| `code-server-extensions` | VS Code extensions |

---

## 🌐 Public Access (Optional)

To expose LetMeCook publicly, use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

1. [Install cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
2. Authenticate: `cloudflared tunnel login`
3. Create a tunnel: `cloudflared tunnel create letmecook`
4. Update `cloudflared-config.yml` with your tunnel ID and hostname
5. Route DNS: `cloudflared tunnel route dns letmecook yourdomain.com`
6. Run: `cloudflared tunnel --config cloudflared-config.yml run`

Or use any reverse proxy (Caddy, nginx, Traefik) to expose port `3001`.

---

## 🛠 Local Development

### Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io/installation) 9+
- Redis running locally (`redis-server` or Docker)
- [code-server](https://coder.com/docs/code-server/install) (optional, for IDE features)

### Setup

```bash
# Install dependencies
pnpm install

# Copy and edit env vars
cp .env.example .env
# Edit .env — set DATA_DIR, PROJECTS_DIR, SESSION_SECRET, etc.

# Run all services in dev mode
pnpm dev
```

This starts the API (port 3000) and web frontend (port 3001) concurrently with hot reload.

---

## 🗺 Roadmap

See [ROADMAP.md](ROADMAP.md) for the full implementation plan.

**Completed:**
- ✅ Monorepo scaffold (TypeScript, Fastify, Next.js, pnpm, Docker)
- ✅ Auth & Core API (TOTP, project CRUD, code-server proxy)
- ✅ Dashboard UI (project cards, search, pinning, dark mode)
- ✅ Background Jobs (BullMQ worker, clone, scaffold, export, SSE progress)
- ✅ Tasks & Quest Log (kanban, daily priorities, milestones)
- ✅ Activity Tracking (heartbeat, heatmap, weekly wrapped, journal)
- ✅ Infrastructure (tunnels, monitor, backups, audit logs)
- ✅ VS Code Extension (dashboard, tasks, heartbeat, AI commands)
- ✅ AI Copilot Layer (multi-provider, task gen, commit messages, repo chat)

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
