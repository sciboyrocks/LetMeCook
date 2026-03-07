# Contributing to LetMeCook

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. **Fork & clone** the repository
2. **Install dependencies**: `pnpm install` (requires pnpm 9+ and Node.js 22+)
3. **Copy environment**: `cp .env.example .env` and fill in the required values
4. **Start Redis**: `docker run -d -p 6379:6379 redis:7-alpine` (or install locally)
5. **Run dev mode**: `pnpm dev`

This starts the API (port 3000) and web frontend (port 3001) with hot reload.

## Project Structure

- `apps/api/` — Fastify backend (TypeScript)
- `apps/web/` — Next.js frontend (TypeScript)
- `letmecook-extension/` — VS Code extension

## Guidelines

- **TypeScript** — All code is TypeScript. No `any` unless absolutely necessary.
- **Validation** — Use Zod schemas for all API input validation.
- **Formatting** — The project uses consistent 2-space indentation.
- **Commits** — Write clear, descriptive commit messages.
- **One thing per PR** — Keep pull requests focused on a single change.

## Reporting Issues

- Use GitHub Issues to report bugs or request features.
- Include steps to reproduce, expected behavior, and actual behavior.
- Include your OS, Docker version, and Node.js version if relevant.

## Pull Requests

1. Create a feature branch from `main`
2. Make your changes
3. Test locally with `docker compose up -d --build`
4. Submit a PR with a clear description of what changed and why

## Code of Conduct

Be respectful and constructive. This is a personal project shared with the community — treat it and its maintainers with kindness.
