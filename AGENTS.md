# AGENTS.md

Guidance for AI coding assistants working on this repository.

## Project Summary

**Transferencia por QR Code** is a Node.js web app for sending files from a phone to a computer on the same local network. The desktop browser shows a QR code; the phone opens `/send` and uploads files with progress tracked via Server-Sent Events.

## Stack

- **Runtime:** Node.js (no Express)
- **Frontend:** Static HTML/CSS/JS in `public/`
- **Dependency:** `qrcode` only
- **Entry point:** `server.js`
- **Start:** `npm start` or `start.bat` on Windows

## Key Files

| File | Purpose |
| --- | --- |
| `server.js` | HTTP server, upload API, SSE, QR config |
| `public/index.html` + `public/app.js` | Desktop receiver UI |
| `public/send.html` + `public/send.js` | Mobile sender UI |
| `transferencia-config.json` | Saved destination folder (gitignored) |
| `recebidos/` | Default upload directory (gitignored) |

## Conventions

- User-facing text is in **Brazilian Portuguese**.
- Keep changes minimal and focused.
- Prefer extending existing patterns over adding frameworks.
- Local-only actions (folder picker, destination API) must stay restricted to loopback requests via `requireLocalRequest`.
- Upload security relies on a per-session token in the QR link (`?key=`).

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `RENDER` / `RENDER_*` | — | Detected for hosted deployment behavior |

## Testing

```bash
npm test
```

Smoke tests in `test/smoke.test.js` spawn the server and verify core HTTP endpoints.

## When Changing Upload Logic

- Chunk size is `CHUNK_SIZE` (1 MB) in `server.js`.
- Partial uploads use `.upload-*.part` and `.upload-*.json` in the destination folder.
- Resume flow: `/upload/start` → `/upload/chunk` → `/upload/finish`.

## Do Not

- Commit `node_modules/`, `recebidos/`, or `transferencia-config.json`.
- Break mobile upload compatibility without updating both server and `public/send.js`.
- Remove token validation from `/send` or upload routes.
