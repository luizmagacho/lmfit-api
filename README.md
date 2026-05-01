# lmfit-api

NestJS control API for LM FIT: MongoDB (Mongoose), JWT access + rotating refresh tokens, OpenAPI at `/docs`.

## Prerequisites

- Node 20+
- MongoDB reachable at `MONGODB_URI`

## Database with Docker

Start MongoDB 7 in the background (data persisted in a named volume):

```bash
docker compose up -d
```

Stop (keeps data):

```bash
docker compose down
```

Remove the volume as well (wipes the database):

```bash
docker compose down -v
```

Default connection string matches `.env.example`: `mongodb://127.0.0.1:27017/lmfit`.

## Setup

```bash
cp .env.example .env
# Set JWT_ACCESS_SECRET (long random string) and optional SEED_ADMIN_* values
npm install
npm run start:dev
```

API listens on `PORT` (default **4000**). Health: `GET /health`. Swagger: `http://localhost:4000/docs`.

On first empty database, an admin user is created from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (see `.env.example`).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run start:dev` | Watch mode |
| `npm run build` | Production build |
| `npm test` | Jest unit tests |
| `npm run test:vitest` | Vitest smoke tests |
| `npm run test:e2e` | Jest e2e (requires Mongo) |

## CORS

Set `WEB_ORIGIN` to your Next app URL (e.g. `http://localhost:3000`).

## Inbound WhatsApp + Gemini (spec)

Meta Cloud API + Gemini **auto-post** technical spec (endpoints, DTOs, env vars, modules): [`docs/whatsapp-meta-gemini-spec.md`](docs/whatsapp-meta-gemini-spec.md). Placeholder env keys are commented in [`.env.example`](.env.example).
