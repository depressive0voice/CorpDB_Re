# CorpDB — установка через Docker

Docker Compose — рекомендуемый способ запуска CorpDB для обычной self-hosted установки.

## Требования

Нужны:

- Docker Engine;
- Docker Compose v2 (`docker compose`);
- Discord application с bot user;
- EVE Online application для SSO;
- доступ сервера к Discord, EVE SSO/ESI и дополнительным API используемых модулей.

## 1. Получение файлов

```bash
git clone https://github.com/depressive0voice/CorpDB_Re.git
cd CorpDB_Re
cp .env.example .env
```

В Windows PowerShell:

```powershell
git clone https://github.com/depressive0voice/CorpDB_Re.git
cd CorpDB_Re
Copy-Item .env.example .env
```

## 2. Настройка `.env`

Минимально заполните:

```dotenv
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
BOT_OWNER_IDS=...

EVE_SSO_CLIENT_ID=...
EVE_SSO_REDIRECT_URI=...
```

`BOT_OWNER_IDS` — Discord user ID владельцев через запятую.

`EVE_SSO_REDIRECT_URI` должен символ в символ совпадать с URL возврата, зарегистрированным в EVE Developers.

Для локального доступа пример может выглядеть так:

```dotenv
EVE_SSO_REDIRECT_URI=http://127.0.0.1:3000/auth/eve/callback
```

Для сервера за доменом или reverse proxy используйте реальный внешний URL, например:

```dotenv
EVE_SSO_REDIRECT_URI=https://corpdb.example.com/auth/eve/callback
```

В стандартном `compose.yaml` значения `HTTP_HOST` и `CORPDB_STORAGE_DIR` внутри контейнера задаются автоматически:

```text
HTTP_HOST=0.0.0.0
CORPDB_STORAGE_DIR=/app/storage
```

Это необходимо, чтобы HTTP endpoint был доступен через опубликованный Docker-порт и чтобы постоянные данные сохранялись в Docker volume.

## 3. Запуск

Соберите образ и запустите контейнер:

```bash
docker compose up -d --build
```

Проверить состояние:

```bash
docker compose ps
```

Посмотреть журнал:

```bash
docker compose logs -f corpdb
```

Остановить просмотр журнала можно `Ctrl+C`; контейнер продолжит работу.

## 4. Проверка HTTP

По умолчанию опубликован порт `3000`:

```bash
curl http://127.0.0.1:3000/health
```

Ожидаемый ответ:

```json
{"ok":true,"service":"corpdb"}
```

Docker image также содержит встроенный healthcheck. В `docker compose ps` контейнер после запуска должен перейти в состояние `healthy`.

Если в `.env` изменён `HTTP_PORT`, Compose публикует тот же номер порта на хосте и внутри контейнера.

## 5. Первая настройка CorpDB

После успешного запуска:

1. Пригласите бота на нужный Discord-сервер.
2. Убедитесь, что slash-команды зарегистрировались.
3. Выполните `/auth setup` от пользователя из `BOT_OWNER_IDS`.
4. Авторизуйте сервисного EVE-персонажа нужной корпорации.
5. Проверьте `/auth status`.
6. Выполните `/members sync`.
7. Настройте роли, Main/Alt binding, onboarding и необходимые дополнительные модули.
8. Выполните `/system status`.

Полное описание настройки находится в [USER_GUIDE_RU.md](USER_GUIDE_RU.md), команды — в [COMMAND_REFERENCE_RU.md](COMMAND_REFERENCE_RU.md).

## 6. Постоянные данные

`compose.yaml` подключает Docker volume:

```text
corpdb-storage → /app/storage
```

По умолчанию физическое имя volume — `corpdb-storage`.

В нём находятся:

- настройки экземпляра;
- данные корпораций;
- состояния модулей;
- EVE OAuth refresh tokens в `secrets/`.

Команда:

```bash
docker compose down
```

удаляет контейнер и сеть, но **не удаляет volume**. Не используйте `docker compose down -v`, если хотите сохранить данные.

## 7. Резервная копия

`/system storage export` не содержит `storage/secrets/**`, поэтому не является полной резервной копией Docker volume.

Для полной резервной копии остановите CorpDB:

```bash
docker compose stop corpdb
```

После этого сохраните volume `corpdb-storage` средствами Docker или вашей системы резервного копирования. После копирования запустите сервис снова:

```bash
docker compose start corpdb
```

Для нескольких экземпляров CorpDB имя volume можно переопределить переменной Compose `CORPDB_VOLUME_NAME`.

## 8. Обновление

Получите новую версию исходников:

```bash
git pull
```

Затем пересоберите контейнер:

```bash
docker compose up -d --build
```

Persistent volume при пересборке сохраняется.

После обновления проверьте:

```bash
docker compose ps
docker compose logs --tail=100 corpdb
```

и выполните в Discord:

```text
/system status
```

## 9. Остановка и удаление контейнера

Остановить сервис без удаления контейнера:

```bash
docker compose stop
```

Запустить снова:

```bash
docker compose start
```

Удалить контейнер и сеть с сохранением данных:

```bash
docker compose down
```

Полное удаление вместе с persistent volume выполняйте только если данные действительно больше не нужны.

## 10. Reverse proxy и HTTPS

Встроенный HTTP server CorpDB обслуживает `/health` и EVE OAuth callback. Для публичной установки рекомендуется завершать TLS на reverse proxy перед CorpDB.

При этом:

- контейнер продолжает слушать внутренний HTTP порт;
- reverse proxy передаёт запросы на опубликованный порт CorpDB;
- `EVE_SSO_REDIRECT_URI` содержит внешний HTTPS URL;
- тот же URL должен быть зарегистрирован в EVE Developers.

Не используйте `0.0.0.0` в `EVE_SSO_REDIRECT_URI`: это адрес привязки сервера, а не публичный URL возврата OAuth.
