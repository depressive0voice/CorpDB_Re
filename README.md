# CorpDB

Self-hosted Discord bot for EVE Online corporation management.

CorpDB combines corporation member synchronization, Discord-to-main bindings, onboarding and promotion, activity/FAT reporting, application alerts, role management, system diagnostics, and optional operational modules. One installation can manage one or several EVE corporations and one bound Discord server.

## Documentation

- [Docker installation — English](docs/DOCKER_EN.md)
- [Administrator guide — English](docs/USER_GUIDE_EN.md)
- [Command reference — English](docs/COMMAND_REFERENCE_EN.md)
- [Установка через Docker — русский](docs/DOCKER_RU.md)
- [Руководство администратора — русский](docs/USER_GUIDE_RU.md)
- [Справочник команд — русский](docs/COMMAND_REFERENCE_RU.md)

## Recommended installation: Docker

Requirements:

- Docker Engine;
- Docker Compose v2;
- a Discord application/bot;
- an EVE Online developer application for SSO.

Clone the repository and create the local environment file:

```bash
git clone https://github.com/depressive0voice/CorpDB_Re.git
cd CorpDB_Re
cp .env.example .env
```

Windows PowerShell:

```powershell
git clone https://github.com/depressive0voice/CorpDB_Re.git
cd CorpDB_Re
Copy-Item .env.example .env
```

Configure at least:

```dotenv
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
BOT_OWNER_IDS=...
EVE_SSO_CLIENT_ID=...
EVE_SSO_REDIRECT_URI=...
```

Then build and start CorpDB:

```bash
docker compose up -d --build
```

Check the container and HTTP health endpoint:

```bash
docker compose ps
curl http://127.0.0.1:3000/health
```

Expected health response:

```json
{"ok":true,"service":"corpdb"}
```

The Compose deployment stores CorpDB data in the persistent `corpdb-storage` Docker volume. `docker compose down` does not remove that volume; avoid `docker compose down -v` unless the stored data should be deleted.

See the Docker installation guides for callback URLs, persistent data, backups, updates and reverse proxy deployment.

## Manual Node.js installation

For a non-Docker installation, use Node.js 22 or newer and npm:

```bash
git clone https://github.com/depressive0voice/CorpDB_Re.git
cd CorpDB_Re
npm ci
cp .env.example .env
```

Configure `.env`, then validate and start:

```bash
npm run config:check
npm run check
npm test
npm start
```

The built-in HTTP service listens on `127.0.0.1:3000` by default for a manual installation.

## First setup

After CorpDB starts:

1. Invite the bot to the Discord server it will manage.
2. Confirm guild slash commands are registered.
3. Run `/auth setup` as a user listed in `BOT_OWNER_IDS`.
4. Authorize the service character for the required EVE corporation.
5. Run `/members sync` and `/system status`.
6. Configure Discord roles, Main/Alt binding, onboarding and the optional modules you intend to use.

The corporation ID does not need to be configured in `.env`; CorpDB detects it from the character authorized through `/auth setup`.

## Storage and secrets

Runtime data is stored under `CORPDB_STORAGE_DIR`:

- `instance/` — instance-wide configuration and state;
- `corporations/<corporationId>/` — corporation-scoped data;
- `secrets/` — EVE OAuth secrets.

For a manual installation the default directory is `storage/`. In the supplied Docker Compose deployment it is `/app/storage` backed by a persistent Docker volume.

`.env` and runtime storage are excluded from Git. `/system storage export` deliberately excludes `secrets/**`, so it is useful for diagnostics but is not a complete backup.

## Languages

Built-in response languages:

- English (`en`);
- Russian (`ru`).

Users can select an enabled response language with `/language`.
