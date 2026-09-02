# CorpDB — Docker installation

Docker Compose is the recommended way to run CorpDB for a normal self-hosted installation.

## Requirements

You need:

- Docker Engine;
- Docker Compose v2 (`docker compose`);
- a Discord application with a bot user;
- an EVE Online application for SSO;
- outbound access to Discord, EVE SSO/ESI and any additional APIs used by enabled modules.

## 1. Get the files

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

## 2. Configure `.env`

At minimum, set:

```dotenv
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
BOT_OWNER_IDS=...

EVE_SSO_CLIENT_ID=...
EVE_SSO_REDIRECT_URI=...
```

`BOT_OWNER_IDS` is a comma-separated list of owner Discord user IDs.

`EVE_SSO_REDIRECT_URI` must exactly match the callback URL registered in EVE Developers.

A local example is:

```dotenv
EVE_SSO_REDIRECT_URI=http://127.0.0.1:3000/auth/eve/callback
```

For a server behind a domain or reverse proxy, use the real external URL, for example:

```dotenv
EVE_SSO_REDIRECT_URI=https://corpdb.example.com/auth/eve/callback
```

The standard `compose.yaml` overrides these values inside the container:

```text
HTTP_HOST=0.0.0.0
CORPDB_STORAGE_DIR=/app/storage
```

This makes the HTTP endpoint reachable through the published Docker port and keeps persistent data in a Docker volume.

## 3. Start CorpDB

Build the image and start the container:

```bash
docker compose up -d --build
```

Check status:

```bash
docker compose ps
```

Follow logs:

```bash
docker compose logs -f corpdb
```

`Ctrl+C` stops log following only; the container continues running.

## 4. Check HTTP health

Port `3000` is published by default:

```bash
curl http://127.0.0.1:3000/health
```

Expected response:

```json
{"ok":true,"service":"corpdb"}
```

The Docker image also contains a built-in healthcheck. After startup, `docker compose ps` should report the container as `healthy`.

If `HTTP_PORT` is changed in `.env`, Compose publishes the same port number on the host and inside the container.

## 5. Initial CorpDB setup

After the container is healthy:

1. Invite the bot to the Discord server it will manage.
2. Confirm slash commands are registered.
3. Run `/auth setup` as a user listed in `BOT_OWNER_IDS`.
4. Authorize the corporation service character.
5. Check `/auth status`.
6. Run `/members sync`.
7. Configure roles, Main/Alt binding, onboarding and required optional modules.
8. Run `/system status`.

See [USER_GUIDE_EN.md](USER_GUIDE_EN.md) for full configuration and [COMMAND_REFERENCE_EN.md](COMMAND_REFERENCE_EN.md) for the command reference.

## 6. Persistent data

`compose.yaml` mounts a Docker volume:

```text
corpdb-storage → /app/storage
```

The default physical volume name is `corpdb-storage`.

It contains:

- instance configuration;
- corporation data;
- module state;
- EVE OAuth refresh tokens under `secrets/`.

Running:

```bash
docker compose down
```

removes the container and Compose network but **does not remove the volume**. Do not use `docker compose down -v` if you need to retain your data.

## 7. Backups

`/system storage export` excludes `storage/secrets/**`, so it is not a complete backup of the Docker volume.

For a full backup, stop CorpDB first:

```bash
docker compose stop corpdb
```

Back up the `corpdb-storage` volume with Docker or your host backup system, then start the service again:

```bash
docker compose start corpdb
```

For multiple CorpDB instances on one Docker host, the volume name can be overridden with the Compose variable `CORPDB_VOLUME_NAME`.

## 8. Updating

Pull the new source version:

```bash
git pull
```

Rebuild and restart:

```bash
docker compose up -d --build
```

The persistent volume is retained across image rebuilds.

After updating, check:

```bash
docker compose ps
docker compose logs --tail=100 corpdb
```

and run in Discord:

```text
/system status
```

## 9. Stop or remove the container

Stop without removing the container:

```bash
docker compose stop
```

Start it again:

```bash
docker compose start
```

Remove the container and network while retaining data:

```bash
docker compose down
```

Only remove the persistent volume when the stored CorpDB data is no longer needed.

## 10. Reverse proxy and HTTPS

CorpDB's built-in HTTP server provides `/health` and the EVE OAuth callback. For a public deployment, terminate TLS at a reverse proxy in front of CorpDB.

In that setup:

- the container continues to listen on its internal HTTP port;
- the reverse proxy forwards requests to the published CorpDB port;
- `EVE_SSO_REDIRECT_URI` contains the external HTTPS URL;
- the same URL is registered in EVE Developers.

Do not use `0.0.0.0` in `EVE_SSO_REDIRECT_URI`: it is a server bind address, not a public OAuth callback URL.
