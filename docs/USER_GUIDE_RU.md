# CorpDB — руководство администратора

## 1. Назначение

CorpDB — self-hosted Discord-бот для управления корпорацией в EVE Online. Один экземпляр CorpDB может обслуживать одну или несколько корпораций и один привязанный Discord-сервер.

Основные функции:

- регистрация корпораций через EVE SSO и работа с ESI;
- синхронизация состава корпорации;
- импорт Main/Alt данных и привязка Discord-пользователя к основному персонажу;
- первичная настройка новых участников (onboarding);
- модель ролей `Гость → Новичок → Основной состав`;
- контроль окончания испытательного срока и повышения `Новичок → Основной состав`;
- карточка участника, фарм и FAT Activity;
- уведомления о заявках в корпорацию;
- базовое управление Discord-ролями;
- уровни доступа CorpDB;
- системная диагностика, ручной запуск фоновых задач и безопасный экспорт данных;
- опциональные модули Advanced Roles (расширенные роли), Finance (Финансы), Structure Fuel (Топливо в структурах), Blacklist (Черный список), FAT Rewards (FAT-награды) и Role Expiry (Истечение роли) / Autokick.

CorpDB не требует заранее указывать `corporationId` в `.env`. Корпорация определяется по персонажу, авторизованному через `/auth setup`.

---

## 2. Требования

### 2.1. Сервер

Для запуска без Docker необходимы:

- Git;
- Node.js 22 или новее;
- npm;
- постоянный каталог для `storage/`;
- исходящее HTTPS-соединение к Discord, EVE SSO/ESI и, при использовании Blacklist, Google Sheets API и EveWho.

Проверить версии:

```bash
node --version
npm --version
git --version
```

### 2.2. Discord application

Нужно отдельное Discord-приложение с ботом.

В Discord Developer Portal (сделать ссылкой):

1. Создайте Application.
2. На странице **Bot** создайте bot user.
3. Скопируйте bot token — он используется как `DISCORD_TOKEN`.
4. Скопируйте Application ID — он используется как `DISCORD_CLIENT_ID`.
5. Включите **Server Members Intent**. CorpDB использует `GuildMembers` для первичной настройки участников, управления ролями, Main/Alt-процессов и Role Expiry.
6. Создайте приглашение для сервера со следующими правами доступа:
   - `bot`;
   - `applications.commands`.

Рекомендуемые Discord разрешения для полного набора функций:

- View Channels;
- Send Messages;
- Embed Links;
- Attach Files;
- Read Message History;
- Manage Roles;
- Manage Nicknames — если используется синхронизация никнеймов;
- Kick Members — если используется Role Expiry / Autokick;
- View Audit Log — для восстановления времени назначения trigger-роли в Role Expiry.

Роль самого бота в Discord должна находиться **выше всех ролей, которые CorpDB должен выдавать или снимать**. Discord не позволит боту управлять ролью, стоящей выше или на одном уровне с его собственной максимальной ролью.

Не требуется задавать `DISCORD_GUILD_ID`. CorpDB сам привязывается к Discord-серверу после запуска.

### 2.3. EVE Online application

Создайте приложение в EVE Developers(сделать ссылкой) и укажите callback URL, совпадающий с `EVE_SSO_REDIRECT_URI` **символ в символ**.

Пример для локального запуска:

```text
http://127.0.0.1:3000/auth/eve/callback
```

CorpDB использует OAuth Authorization Code + PKCE. `EVE_SSO_CLIENT_SECRET` не нужен и приложением не используется.

При `/auth setup` запрашиваются следующие права доступа в ESI:

```text
esi-corporations.read_corporation_membership.v1
esi-corporations.track_members.v1
esi-characters.read_corporation_roles.v1
esi-wallet.read_corporation_wallets.v1
esi-assets.read_corporation_assets.v1
esi-corporations.read_structures.v1
esi-corporations.read_starbases.v1
esi-universe.read_structures.v1
esi-characters.read_notifications.v1
```

Авторизованный персонаж используется как сервисный персонаж конкретной корпорации. У него должны быть роли, достаточные для ESI эндпоинтов, которые вы собираетесь использовать. Если персонаж позже перейдёт в другую корпорацию, CorpDB не перенесёт регистрацию автоматически: потребуется повторная авторизация корректного сервисного персонажа.

---

## 3. Установка

### 3.1. Получение исходников

Linux/macOS:

```bash
git clone https://github.com/depressive0voice/CorpDB_Re.git
cd CorpDB_Re
npm ci
cp .env.example .env
```

Windows PowerShell:

```powershell
git clone https://github.com/depressive0voice/CorpDB_Re.git
cd CorpDB_Re
npm ci
Copy-Item .env.example .env
```

`npm ci` использует версии из `package-lock.json` и предпочтителен для обычной установки.

### 3.2. Базовая конфигурация `.env`

Минимально заполните:

```dotenv
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
BOT_OWNER_IDS=...

EVE_SSO_CLIENT_ID=...
EVE_SSO_REDIRECT_URI=http://127.0.0.1:3000/auth/eve/callback
```

`BOT_OWNER_IDS` — список Discord user ID через запятую. Эти пользователи получают уровень доступа `main-admin` независимо от Discord-ролей.

Пример:

```dotenv
BOT_OWNER_IDS=123456789012345678,987654321098765432
```

### 3.3. Полный список переменных окружения

| Переменная | Назначение | Значение по умолчанию |
|---|---|---|
| `DISCORD_TOKEN` | Bot token Discord | обязательно |
| `DISCORD_CLIENT_ID` | Discord Application ID | обязательно |
| `BOT_OWNER_IDS` | Discord user ID владельцев через запятую | обязательно |
| `EVE_SSO_CLIENT_ID` | Client ID EVE application | обязательно |
| `EVE_SSO_REDIRECT_URI` | OAuth callback | обязательно |
| `EVE_ESI_DATASOURCE` | ESI datasource | `tranquility` |
| `EVE_ESI_COMPATIBILITY_DATE` | compatibility date для ESI | текущая дата, заданная в `.env.example` |
| `HTTP_HOST` | адрес встроенного HTTP сервера | `127.0.0.1` |
| `HTTP_PORT` | порт HTTP сервера | `3000` |
| `CORPDB_STORAGE_DIR` | каталог постоянных данных | `storage` |
| `DEFAULT_LANGUAGE` | язык ответа по умолчанию | `en` |
| `ENABLED_LANGUAGES` | разрешённые языки через запятую | `ru,en` |
| `BLACKLIST_SPREADSHEET_ID` | ID таблицы Google Sheets для Blacklist | пусто |
| `BLACKLIST_BLACK_RANGE` | диапазон Black List | `'The List'!A:J` |
| `BLACKLIST_GREY_RANGE` | диапазон Grey List | `'Grey List'!A:J` |
| `GOOGLE_SHEETS_API_KEY` | API ключ для Google Sheets | пусто |
| `BLACKLIST_CACHE_TTL_MS` | срок жизни кэша таблиц в миллисекундах | `300000` |
| `EVEWHO_BASE_URL` | Базовый URL EveWho API| `https://evewho.com/api` |
| `EVEWHO_PAGE_DELAY_MS` | задержка между страницами EveWho в миллисекундах | `3200` |
| `EVEWHO_CACHE_TTL_MS` | срок жизни кэша EveWho в миллисекундах | `120000` |
| `ENABLE_BACKGROUND_JOBS` | глобальное включение фоновых задач | `true` |
| `MEMBER_SYNC_INTERVAL_MINUTES` | синхронизация состава в минутах| `30` |
| `ENABLE_PROMOTION_JOB` | автоматическая проверка испытательного срока новичка | `true` |
| `PROMOTION_CHECK_INTERVAL_MINUTES` | интервал promotion проверок в минутах | `360` |
| `ENABLE_FINANCE_JOB` | фоновое обновление Finance | `true` |
| `FINANCE_REFRESH_INTERVAL_MINUTES` | интервал Finance | `15` |
| `ENABLE_APPLICATIONS_JOB` | проверка заявок | `true` |
| `APPLICATIONS_CHECK_INTERVAL_MINUTES` | интервал проверки заявок в минутах | `15` |
| `ENABLE_STRUCTURE_FUEL_JOB` | фоновая проверка Structure Fuel | `true` |
| `STRUCTURE_FUEL_CHECK_INTERVAL_MINUTES` | интервал проверки Structure Fuel в минутах| `60` |
| `ENABLE_FAT_REWARDS_REMINDER_JOB` | FAT Summary напоминание | `true` |
| `FAT_REWARDS_REMINDER_INTERVAL_MINUTES` | интервал напоминания в минутах | `360` |

Role Expiry имеет собственный интервал в сохранённой политикой и не настраивается через `.env`.

Если `BLACKLIST_SPREADSHEET_ID` не указан, конфигурация остаётся валидной, но `/blacklist` не сможет выполнять проверки.

### 3.4. Проверка перед запуском

```bash
npm run config:check
npm run check
npm test
```

- `config:check` проверяет обязательные переменные и формат значений;
- `check` выполняет проверку синтаксиса исходников;
- `test` запускает регрессионные тесты.

### 3.5. Запуск

```bash
npm start
```

При штатном запуске CorpDB:

1. инициализирует хранилище (storage);
2. запускает HTTP server;
3. подключается к Discord;
4. определяет привязанный сервер;
5. автоматически регистрирует slash-команды;
6. запускает основные фоновые задачи (Core background jobs);
7. запускает сервисы включённых дополнительных (optional) модулей.

Остановка по `SIGINT` или `SIGTERM` выполняется штатно: задачи останавливаются, Discord клиент закрывается, HTTP сервер останавливается.

### 3.6. Проверка HTTP

```bash
curl http://127.0.0.1:3000/health
```

Ожидаемый ответ:

```json
{"ok":true,"service":"corpdb"}
```

---

## 4. Первый запуск и первичная настройка

Рекомендуемый порядок для чистой установки:

1. Запустить CorpDB с корректным `.env`.
2. Пригласить бота ровно на тот Discord-сервер, который будет обслуживаться этим экземпляром.
3. Убедиться, что slash-команды появились на сервере.
4. Выполнить `/auth setup` от одного из `BOT_OWNER_IDS`.
5. Авторизовать сервисного персонажа нужной корпорации.
6. Проверить `/auth status` и `/members sync`.
7. Настроить привязки ролей Discord и первичной настройки.
8. Настроить Main/Alt источник и канал для подтверждений (approval channel).
9. Настроить Заявки.
10. Включить/Отключить ненужные опциональные модули и настроить используемые.
11. Выполнить `/system status` и устранить отмеченные ошибки/предупреждения.

### 4.1. Привязка Discord сервера

CorpDB хранит одну привязку сервера на экземпляр.

Поведение:

- если бот не состоит ни в одном сервере — он ждёт приглашения;
- если доступен ровно один сервер и привязкаи ещё нет — он выбирается автоматически;
- если до первой привязки бот уже находится в нескольких серверах — CorpDB не выбирает сервер наугад;
- после создания привязки, приглашение бота на другие сервера не меняет существующую привязку;
- если привязанный сервер временно недоступен, CorpDB сохраняет его ID и не переключается на другой сервер.

### 4.2. Первая EVE-авторизация

Выполнить:

```text
/auth setup
```

Команда возвращает ссылку EVE SSO. Сессия действует 15 минут и одноразовая.

После успешного возврата (callback) CorpDB:

- определяет `corporationId`, имя и тикер корпорации;
- регистрирует корпорацию;
- создаёт её хранилище (storage);
- сохраняет refresh token в `storage/secrets/eveOAuth.json`;
- сохраняет список выданных разрешений (scopes) и обнаруженные корпоративные роли;
- отправляет инициатору краткий результат в Discord ЛС, если ЛС доступны.

Проверка:

```text
/auth status
/members sync
/system status
```

Для добавления второй и последующих корпораций снова выполните `/auth setup` и авторизуйте сервисных персонажей.

---

## 5. Модель данных и хранилище

По умолчанию хранилище (storage) находится в каталоге `storage/`.

Основная структура:

```text
storage/
├── instance/
│   ├── access.json
│   ├── modules.json
│   ├── discord.json
│   ├── managedRoles.json
│   ├── mainBindings.json
│   ├── authCharacters.json
│   ├── authMainAlt.json
│   ├── onboarding.json
│   ├── promotionState.json
│   ├── roleExpiry.json
│   ├── roleExpiryState.json
│   └── ...
├── corporations/
│   ├── registry.json
│   └── <corporationId>/
│       ├── profile.json
│       ├── members.json
│       ├── finance/
│       ├── applications/
│       ├── structures/
│       └── activity/
└── secrets/
    ├── eveOAuth.json
    └── eveOAuthPending.json
```

`instance/` содержит настройки всего экземпляра. `corporations/<corporationId>/` содержит данные конкретной корпорации. `secrets/` содержит постоянные конфиденциальные данные OAuth.

`.env` и `storage/` исключены из Git.

### Резервное копирование

Для полной резервной копии при остановленном боте необходимо сохранять **весь** `CORPDB_STORAGE_DIR`, включая `storage/secrets/`, а также отдельно безопасно хранить `.env`.

Команда:

```text
/system storage export
```

создаёт переносимый диагностический/операционный экспорт обычных данных, но намеренно **не включает `storage/secrets/**`**. Такой export не является полной резервной копией данных авторизации EVE OAuth.

---

## 6. Доступы CorpDB

CorpDB использует три уровня:

| Уровень | Назначение |
|---|---|
| `user` | обычный пользователь |
| `admin` | офицер/администратор функций |
| `main-admin` | владелец экземпляра и критическая конфигурация |

Все ID из `BOT_OWNER_IDS` всегда получают `main-admin`.

`main-admin` — каноническое название максимального уровня доступа. Старые `storage/instance/access.json`, в которых ещё сохранено значение `master-admin`, остаются совместимыми: старое значение принимается как alias и при чтении/записи access configuration нормализуется в `main-admin`.

Discord-роли можно назначить как административные:

```text
/admin access add-admin-role role:@Officers
```

Проверить собственный уровень:

```text
/access whoami
```

Показать текущую конфигурацию:

```text
/admin access list
```

Изменить требуемый уровень команды:

```text
/admin access set-command-level command:track level:user
```

Некоторые команды дополнительно защищены внутри самой команды. Например `/roles`, `/binding-config`, `/auth setup` и `/auth status` остаются owner-only даже если общий уровень команды был ослаблен.

### Стандартные command levels

Основные значения по умолчанию:

- `user`: `/access`, `/request-main`;
- `admin`: `/track`, `/fat-rewards`, `/blacklist`, `/auth`, `/finance`, `/applications`, `/structure-fuel`, `/binding-admin`, `/promote`, `/admin`;
- `main-admin`: `/system`.

`/members` формально зарегистрирован на уровне `user`, но сама команда разрешает выполнение только owner. `/language` доступен пользователям. `/groups` применяет собственные eligibility/approver/owner checks.

---

## 7. Ядро: EVE авторизация и состав корпорации

### `/auth`

#### `/auth setup`
Owner-only. Начинает EVE SSO авторизацию сервисного персонажа. Корпорация определяется автоматически.

#### `/auth status`
Owner-only. Показывает зарегистрированные авторизации, сервисного персонажа, количество разрешений и обнаруженные корпоративные роли.

#### `/auth import-html file:<HTML>`
Admin+. Импортирует Main/Alt auth-данные из HTML файла. После импорта CorpDB строит семейства main/alt.

#### `/auth sync-main-alt mode:preview|apply`
Admin+.

- `preview` показывает, какие Main/Alt связи будут созданы/удалены и какие конфликты обнаружены;
- `apply` сохраняет пересобранные связи.

#### `/auth show main-alt`
Admin+. Показывает полный список связей `Alt → Main`.

#### `/auth reconcile`
Admin+. Сравнивает текущий состав зарегистрированных корпораций с импортированными auth-данными и показывает расхождения: отсутствующие auth-записи, персонажей вне корпорации, несовпадение корпорации и другие проблемы.

### `/members`

Owner-only.

```text
/members sync [corporation]
/members status [corporation]
```

`sync` получает состав из ESI, обновляет существующих персонажей, добавляет новых и отмечает ушедших. `status` показывает размер локальной базы и время последней синхронизации.

Параметр `corporation` использует Discord autocomplete и показывает только включённые зарегистрированные корпорации, для которых включена синхронизация состава. Его можно не указывать, если подходит default corporation или доступна только одна подходящая корпорация.

---

## 8. Ядро: Discord роли

CorpDB не создаёт необходимые организационные роли автоматически. Администратор создаёт роли в Discord и затем привязывает их к логическим именам.

Основные роли жизненного цикла:

- `guest` — новый участник без подтверждённой привязки;
- `rookie` — участник на испытательном сроке;
- `main` — полный участник после promotion.

### `/roles`

Owner-only.

```text
/roles list
/roles bind key:<name> role:<role>
/roles unbind key:<name>
/roles status
/roles set-guest role:<role>
/roles sweep
```

`bind` сохраняет соответствие между логическим ключом CorpDB и существующей Discord-ролью. `unbind` удаляет только привязку к роли, не саму Discord роль.

`set-guest` — специализированная настройка fallback гостя.

`sweep` проходит по участникам сервера и выдаёт роль гостя тем, у кого нет роли, которой бот может управлять согласно своей иерархии. Системные роли и роли, управляемые интеграциями Discord, не считаются обычными управляемыми ролями CorpDB.

---

## 9. Ядро: Main ↔ Alt и Discord привязка

CorpDB различает:

1. Main/Alt отношения внутри EVE auth data;
2. Связку между Discord пользователем и основным персонажем.

Один Discord аккаунт связывается с main. После этого `/track` может находить пользователя по Discord, первичная настройка/повышение получает однозначную EVE сущность.

### Пользовательская заявка

```text
/request-main main:<EVE main name>
```

Main должен присутствовать в импортированных auth-данных. Создаётся входящий запрос и карточка подтверждения для администрации.

### `/binding-config`

Owner-only.

```text
/binding-config show
/binding-config set-approval-channel channel:<channel>
/binding-config set-approved-role role:<role>
```

`set-approval-channel` задаёт канал заявок.

`set-approved-role` — совместимая настройка роли, выдаваемой после подтверждения. В новой конфигурации используйте Rookie как начальную роль и настраивайте её также через `/admin onboarding set-rookie-role`.

### `/binding-admin`

Команды администрирования Main привязок:

```text
/binding-admin status
/binding-admin show-user user:<user>
/binding-admin show-main main:<name>
/binding-admin show-request request-id:<id>
/binding-admin list-pending
/binding-admin approve request-id:<id>
/binding-admin bind-user user:<user> main:<name> [manage-roles:true|false]
/binding-admin reject request-id:<id>
/binding-admin repost-request request-id:<id>
/binding-admin list-approved
/binding-admin unlink-user user:<user>
/binding-admin unlink-main main:<name>
```

`bind-user` позволяет выполнить привязку вручную. При управлении ролями CorpDB может выдать начальную рооль, снять гостевую и синхронизировать никнейм, если это возможно по разрешениям Discord и иерархии.

### Binding audit

```text
/admin binding-audit
```

Admin+. Read-only проверка целостности. Показывает несвязанных Discord пользователей, устаревшие привязки, main-персонажей, отсутствующих в Auth, некорректные корпоративные связи и отсутствующие onboarding профили. Данные не изменяет.

---

## 10. Ядро: Onboarding (первичная настройка) и Повышение (Promotion)

### 10.1. Жизненный цикл

Основной сценарий:

```text
Присоединение к серверу
    ↓
Гость
    ↓
Main привязка одобрена
    ↓
Новичок
    ↓
Испытательный срок
    ↓
Основной состав
```

`Rookie` является ролью участника на испытательном сроке. Probation — временное состояние/срок, а не обязательная отдельная стадия после Rookie.

Допустим fast-track:

```text
Гость → Основной состав
```

или досрочный:

```text
Новичок → Основной состав
```

### 10.2. Onboarding профили

Профиль `default` создаётся автоматически, существует всегда и не может быть удалён. Любая корпорация с включённым onboarding, для которой не назначен другой профиль, использует `default` — это правило одинаково работает и для одной, и для нескольких корпораций.

Несколько корпораций могут использовать один custom profile. Явный mapping нужен только тогда, когда конкретная корпорация должна использовать профиль, отличный от `default`.

Основные команды main-admin:

```text
/admin onboarding show
/admin onboarding profile action:create profile:<id>
/admin onboarding profile action:delete profile:<id>
/admin onboarding map-corporation corporation:<id> profile:<id>
/admin onboarding unmap-corporation corporation:<id>
```

`profile action:create` создаёт новый custom profile; его ID вводится вручную. `profile action:delete` удаляет существующий custom profile; `default` защищён от удаления и не предлагается в autocomplete. При удалении custom profile все привязки корпораций к нему также удаляются, поэтому эти корпорации автоматически возвращаются на `default`.

В `map-corporation` и `unmap-corporation` поле `corporation` использует autocomplete по включённым зарегистрированным корпорациям, для которых включён onboarding. В `map-corporation` поле `profile` выбирается из уже созданных onboarding profiles. `unmap-corporation` снимает явный mapping и тем самым возвращает корпорацию на `default`. Необязательное поле `[profile]` в profile-specific onboarding-командах также использует autocomplete существующих профилей; если оно не указано, используется `default`.

Если у уже существующей main binding был сохранён профиль, который позже удалили, promotion пытается разрешить актуальный профиль через корпорацию и при отсутствии другого mapping использует `default`.

Роли профиля:

```text
/admin onboarding set-rookie-role role:<role> [profile]
/admin onboarding clear-rookie-role [profile]
/admin onboarding set-main-role role:<role> [profile]
/admin onboarding clear-main-role [profile]
/admin onboarding set-recruiter-role role:<role> [profile]
/admin onboarding clear-recruiter-role [profile]
```

Команды `set-probation-role` / `clear-probation-role` сохранены как совместимый конфигурационный интерфейс. Для новой установки канонической ролью новичка является `Rookie`.

### 10.3. Probation и promotion

```text
/admin onboarding set-probation-months months:<1-24> [profile]
/admin onboarding set-promotion-channel channel:<channel> [profile]
/admin onboarding clear-promotion-channel [profile]
/admin onboarding check-promotions
/admin onboarding promotion-status
```

Background promotion job периодически проверяет Rookie, у которых истёк испытательный срок, и создаёт уведомление/запрос для рекрутеров. Он не обязан автоматически выдавать Main без решения администратора.

Ручное завершение испытательного срока:

```text
/promote role:MAIN user:<Discord user>
```

или по EVE main/alt имени:

```text
/promote role:MAIN name:<character>
```

При успешном повышении CorpDB выдаёт Main, снимает Guest/Rookie, где это применимо, сохраняет результат и пытается уведомить участника через ЛС.

### 10.4. Приветственное сообщение

Настройки:

```text
/admin onboarding set-welcome-channel channel:<channel>
/admin onboarding clear-welcome-channel
/admin onboarding set-welcome-recruiter-role role:<role>
/admin onboarding clear-welcome-recruiter-role
/admin onboarding set-welcome-text text:<text>
/admin onboarding reset-welcome-text
/admin onboarding preview [user]
/admin onboarding send-test [user] [channel]
```

Если канал не задан или недоступен, CorpDB пытается отправить приветствие через ЛС. Боты игнорируются.

Поддерживаемые заглушки:

```text
{member}
{server_name}
{request_main_command}
{guest_role}
{rookie_role}
{main_role}
{recruiter_role}
```

`{probation_role}` также распознаётся как совместимый алиас Rookie.

Флаг `welcome.enabled` хранится в `storage/instance/onboarding.json`. Значение `false` полностью отключает автоматическое приветственное сообщение, не отключая остальной Onboarding.

---

## 11. Ядро: Applications (Заявки)

Applications отслеживает уведомления о заявках в корпорацию, хранит состояние заявок и может публиковать/обновлять Discord карточку без дублирования одной и той же заявки.

Команды:

```text
/applications show-config [corporation]
/applications set-alert-channel channel:<channel> [corporation]
/applications clear-alert-channel [corporation]
/applications reset-cache [corporation]
/applications check [corporation]
```

`show-config` показывает текущую настройку. Изменение channel, reset и ручной check требуют `main-admin`.

При check CorpDB:

- получает уведомления EVE;
- выделяет corporation application events (заявки в корпорацию);
- сопоставляет кандидатов с Auth, когда данные доступны;
- создаёт новые Discord карточки;
- редактирует существующую карточку при изменении состояния или появлении данных в Auth;
- не публикует повторно уже обработанную заявку.

Applications входит в Ядро и не отключается через optional modules.

---

## 12. Ядро: Track / Activity

### 12.1. Карточка участника

```text
/track member [name:<character>] [user:<Discord user>] [period:<...>] [month:MM-YYYY] [fat-month:MM-YYYY]
```

Можно искать по персонажу или Discord пользователю с одобренной привязкой.

Карточка объединяет:

- текущий статус персонажа в корпорации;
- main и alts;
- Discord привязку;
- последний логин / срок в корпорации;
- FAT активность;
- Данные по фарму из журнала корпорации;
- данные main семьи, даже если запрос сделан по alt.

Фарм период:

- `current-month`;
- `previous-month`;
- `month` + `month:MM-YYYY`.

### 12.2. FAT Активность

```text
/track activity import month:MM-YYYY file:<xlsx> [corporation]
/track activity report [month:MM-YYYY] [corporation]
/track activity rookies [month:MM-YYYY] [corporation]
/track activity three-months [month:MM-YYYY] [corporation]
/track activity months [corporation]
```

Import ожидает XLSX с колонками `Character` и `FAT`.

Правило хранения:

- текущий календарный месяц импортируется только как превью и не фиксируется как закрытый отчёт;
- закрытые месяцы сохраняются в Activity history.

`report` строит общий контроль FAT. `rookies` ограничивает отчёт участниками Discord с ролью новичка. `three-months` показывает участников ниже норматива три закрытых месяца подряд. `months` показывает доступную историю закрытых месяцев.

---

## 13. Optional modules

Управление:

```text
/admin modules list
/admin modules set module:<module> enabled:<true|false>
```

Доступные модуль-ключи:

```text
advanced-roles
finance
structure-fuel
blacklist
fat-rewards
role-expiry
```

При выключении дополнительных модулей:

- его slash-команда верхнего уровня удаляется из списка команд, если он есть;
- связанная `/admin` группа скрывается, если она есть;
- связанная background job останавливается;
- job исчезает из `/system run-job`;
- ручной запуск отключённого job отклоняется на сервисном уровне;
- сохранённые данные модуля не удаляются.

Повторное включение использует существующую конфигурацию и состояние.

Все дополнительные модули при чистой конфигурации имеют состояние enabled (включено), но выполняют только то, для чего выполнена необходимая дополнительная настройка.

---

## 14. Опционально: Advanced Roles (Расширенные роли)

Ключ модуля: `advanced-roles`.

Команда верхнего уровня: `/groups`.

Назначение — группы доступа, в которых выдача одной или нескольких Discord ролей происходит через заявку и одобряется офицерами.

### Пользовательские/approver команды

```text
/groups list
/groups request group:<id>
/groups pending
/groups approve request:<id>
/groups reject request:<id> [reason]
/groups revoke group:<id> user:<user> [reason]
```

`list` показывает соответствие требованиям пользователя и может включать:

- required-all roles;
- required-any roles;
- forbidden roles.

Approver должен иметь одну из заданных approver ролей. Группа может требовать от 1 до 10 независимых подтверждений.

### Owner configuration

```text
/groups create ...
/groups role-add group:<id> kind:<kind> role:<role>
/groups role-remove group:<id> kind:<kind> role:<role>
/groups enable group:<id> enabled:<true|false>
```

`create` принимает стабильный идентификатор, отображаемое имя, выдаваемую роль, approver role и дополнительные параметры scope/eligibility/approval.

Типы правил ролей:

```text
grant
required-all
required-any
forbidden
approver
```

Scope может быть instance-wide (на экземпляр) или corporation-specific (на корпорацию).

---

## 15. Опционально: Finance

Ключ модуля: `finance`.

Finance получает данные кошелька корпорации, сохраняет журнал и строит отчёты с учётом политики финансов.

### Отчёты

```text
/finance wallet [corporation]
/finance income [period] [month:MM-YYYY] [corporation]
/finance donations [period] [month:MM-YYYY] [corporation]
```

Periods:

- Current month;
- Previous month;
- Specified month;
- All history.

Если указан `month`, он имеет приоритет над `period`.

`wallet` показывает баланс по дивизионам. `income` разбивает taxable income (облагаемый налогом доход), alliance tax due (сумма к уплате альянсу), retained amount (сумма, остающаяся корпорации), прочие входящие платежи и расходы. `donations` показывает `player_donation` записи и итоговые суммы.

### Finance policy (финансовая политика)

Main-admin:

```text
/admin finance show [corporation]
/admin finance set-alliance-tax rate:<0-100> [corporation]
/admin finance taxable-add ref-type:<ESI ref_type> [corporation]
/admin finance taxable-remove ref-type:<ESI ref_type> [corporation]
/admin finance wallet-exclude division:<1-7> [corporation]
/admin finance wallet-include division:<1-7> [corporation]
/admin finance donation-alert-set user:<user> division:<1-7> [corporation]
/admin finance donation-alert-disable [corporation]
```

Политика применяется к новым записям в журнале. Изменение политики не должно задним числом переопределять policy context уже сохранённых записей.

---

## 16. Опционально: Structure Fuel (топливо структур)

Ключ модуля: `structure-fuel`.

Поддерживает Upwell структуры и POS. Стандартный критический уровень — 72 часа топлива.

```text
/structure-fuel show [corporation] [class] [group] [type] [structure] [only-critical]
/structure-fuel show-config [corporation]
/structure-fuel alert-disable [corporation] [class] [group] [type] [structure]
/structure-fuel alert-enable [corporation] [class] [group] [type] [structure]
/structure-fuel alert-filters [corporation]
/structure-fuel set-alert-channel channel:<channel> [corporation]
/structure-fuel clear-alert-channel [corporation]
/structure-fuel set-alert-role role:<role> [corporation]
/structure-fuel clear-alert-role [corporation]
/structure-fuel check-alerts [corporation]
```

Фильтры строятся по иерархии:

```text
Класс → Группа → Тип → конкретная структура
```

`alert-disable` исключает совпадающие структуры только из автоматических уведомлений по заданному селектору. `alert-enable` удаляет соответствующий выключенный фильтр.

Metenox Moon Drill (`typeID 81826`) отключён в стандартной Structure Fuel политике и не участвует в обычном отчёте/аллертах, пока политика не изменена.

---

## 17. Опционально: Blacklist (Черный список)

Ключ модуля: `blacklist`.

Требует настройки источника Google Sheets:

```dotenv
BLACKLIST_SPREADSHEET_ID=...
GOOGLE_SHEETS_API_KEY=...
```

По умолчанию используются ranges:

```text
'The List'!A:J
'Grey List'!A:J
```

Проверка персонажа:

```text
/blacklist character:<name|character ID|EveWho URL>
```

Проверка корпорации:

```text
/blacklist corporation:<corporation ID|EveWho URL>
```

Указывать одновременно `character` и `corporation` нельзя.

Поиск персонажа возвращает статус. Поиск корпорации  получает список участников через EveWho, проверяет их по источнику blacklist и возвращает итоговое число с результатом.

---

## 18. Опционально: FAT Rewards (FAT награды)

Ключ модуля: `fat-rewards`.

FAT Rewards работает с **финальным FAT Summary закрытого месяца** и рассчитывает распределение заданного ISK бюджета.

```text
/fat-rewards import month:MM-YYYY file:<xlsx> [corporation]
/fat-rewards calculate amount:<ISK> month:MM-YYYY [file:<xlsx>] [corporation]
/fat-rewards status [corporation]
/fat-rewards set-reminder channel:<channel> [days] [corporation]
```

`import` сохраняет финальную сводку. `calculate` может сначала принять новый XLSX, затем рассчитывает выплаты, создаёт результирующую книгу и сохраняет закрытый месяц в Core Activity. `status` показывает текущую сводку, срок/напоминание и действующие payout rules.

`amount` задаётся целым положительным количеством ISK. Пробелы, `_`, запятые и точки могут использоваться как разделители при вводе.

Reminder сообщает, когда сохранённый FAT Summary старше настроенного числа дней.

---

## 19. Опционально: Role Expiry / Autokick (истечение ролей)

Module key: `role-expiry`.

Модуль предназначен для автоматического удаления из Discord пользователей, которые слишком долго остаются с определённой trigger-role и не получают ни одну из подходящих ролей.

Пример:

```text
Trigger: Guest
Qualifying: Rookie, Main
Timeout: 7 days
```

Пользователь с Guest получает таймер. Как только появляется Rookie или Main, кандидат удаляется из Role Expiry state. Если подходящая роль так и не появилась до таймаута, CorpDB выполняет финальную проверку и может выгнать пользователя.

### Настройка

```text
/admin modules role-expiry-configure trigger-role:<role> timeout-days:<days> [check-interval-minutes] [log-channel]
/admin modules role-expiry-safe-add role:<role>
/admin modules role-expiry-safe-remove role:<role>
/admin modules role-expiry-status
/admin modules role-expiry-candidates
/admin modules role-expiry-clear-log
```

Автоматическое исключение считается настроенным только когда существуют:

- trigger role;
- минимум одна подходящая роль.

### Защита от ошибочного исключения

Role Expiry:

1. записывает время появления trigger role через `guildMemberUpdate`;
2. при необходимости пытается восстановить пропущенное назначение по Discord audit log;
3. если достоверное старое время определить нельзя, начинает полный timeout с текущего момента вместо предположения;
4. перед каждым исключением заново загружает пользователей из Discord;
5. повторно проверяет trigger роль и все подходящие роли;
6. не использует timestamp от старой trigger-роли после изменения политики;
7. указывает явную причину исключения в журнале аудита Discord.

`role-expiry-candidates` — read-only preview текущих кандидатов.

Для audit backfill нужен `View Audit Log`; для автоматического исключения — `Kick Members`.

---

## 20. Background jobs

Глобальный переключатель:

```dotenv
ENABLE_BACKGROUND_JOBS=true
```

Core jobs:

| Job | По умолчанию |
|---|---:|
| Members sync | каждые 30 минут |
| Applications | каждые 15 минут |
| Promotion | каждые 360 минут |

Optional jobs работают только если одновременно включены соответствующий модуль и job switch:

| Job | Module | По умолчанию |
|---|---|---:|
| Finance refresh | `finance` | 15 минут |
| Structure Fuel | `structure-fuel` | 60 минут |
| FAT Rewards reminder | `fat-rewards` | 360 минут |
| Role Expiry | `role-expiry` | из Role Expiry policy |

ESI-запросы защищены от коротких временных сбоев. CorpDB повторяет сетевые ошибки fetch и HTTP-ответы `429`, `502`, `503`, `504`, выполняя до трёх попыток всего. По умолчанию используется exponential backoff (`500 ms`, затем `1000 ms`), а корректный заголовок `Retry-After` имеет приоритет и ограничивается 30 секундами. Постоянные HTTP-ошибки вроде `400`, `401`, `403`, `404` повторно не отправляются.

Ручной запуск:

```text
/system run-job job:<job> [corporation] [max-journal-pages]
```

Доступные значения формируются динамически. Job отключённого опционального модуля не показывается.

---

## 21. `/system`

`/system` по умолчанию требует `main-admin`.

### `/system ping`

Показывает:

- Discord gateway latency;
- process uptime;
- Node.js version.

### `/system status`

Сводная диагностика:

- health status;
- Discord guild binding;
- EVE datasource и compatibility date;
- EVE authorizations;
- зарегистрированные корпорации;
- module states;
- background job states/intervals;
- storage size;
- обнаруженные configuration issues.

После установки и после существенного изменения конфигурации эту команду следует считать основной проверкой состояния.

### `/system run-job`

Ручной запуск background job. Для corporation-scoped jobs можно указать одну корпорацию или оставить параметр пустым для всех подходящих корпораций.

`max-journal-pages` относится только к Finance refresh.

### `/system storage status`

Показывает количество/размер обычных storage files и количество secret files.

### `/system storage export`

Создаёт gzip-compressed JSON export обычного runtime storage. Содержимое `storage/secrets/**` не попадает в файл. Максимальный attachment для этой операции ограничен 24 MiB.

---

## 22. Языки

Поддерживаются:

```text
en
ru
```

Пользователь меняет язык:

```text
/language language:Русский
```

или выбирает другой доступный вариант Discord autocomplete/choices.

`DEFAULT_LANGUAGE` должен присутствовать в `ENABLED_LANGUAGES`.

---

## 23. Multi-corporation

Один экземпляр CorpDB может хранить несколько корпораций.

Основные правила:

- corporation identity всегда основан на числовом EVE `corporationId`;
- каждая корпорация получает собственный профиль, member snapshot и module-specific data;
- EVE authorization хранится отдельно на corporation ID;
- команды с параметром `corporation` предлагают только зарегистрированные подходящие корпорации;
- `/members sync` и `/members status` используют тот же autocomplete корпораций и не показывают отключённые/неподходящие для members корпорации;
- onboarding corporation selectors предлагают включённые корпорации с включённым onboarding, а profile selectors предлагают уже созданные onboarding profiles;
- при одной корпорации большинство команд могут использовать её без явного параметра;
- каждая onboarding-корпорация без явного mapping автоматически использует `default`, в том числе при нескольких корпорациях;
- явный `corporation → onboarding profile` mapping нужен только для корпораций, которым требуется профиль, отличный от `default`;
- один onboarding profile можно использовать для нескольких корпораций;
- `default` удалить нельзя; удаление custom profile снимает mappings на него и возвращает затронутые корпорации на `default`.

---

## 24. Эксплуатация и безопасность

1. Не коммитьте `.env` и `storage/` в Git.
2. Ограничьте доступ к `storage/secrets/` на уровне ОС.
3. Не передавайте Discord bot token и EVE refresh tokens в Discord сообщениях или логах.
4. Делайте host-level backup всего `CORPDB_STORAGE_DIR`.
5. Перед изменением иерархии Discord ролей убедитесь, что роль бота останется выше Guest/Rookie/Main и access-group ролей.
6. После изменения `.env` перезапустите процесс и выполните `/system status`.
7. После изменения опциональных модулей через `/admin modules set` перезапуск не нужен: CorpDB обновляет runtime и guild command registration сразу.
8. Для production HTTP callback используйте корректный внешний URL и TLS termination/reverse proxy согласно вашей инфраструктуре. `EVE_SSO_REDIRECT_URI` должен совпадать с URL, зарегистрированным у EVE.

---

## 25. Диагностика типовых проблем

### Slash-команды не появились

Проверьте:

- бот действительно находится на привязанном сервере;
- приглашение включало `applications.commands`;
- в log есть строка регистрации guild commands;
- `/system status` не сообщает о guild binding issue.

### CorpDB пишет guild mismatch

Команда выполняется не на том Discord сервере, который записан в `storage/instance/discord.json`. Один экземпляр обслуживает один привязанный сервер.

### `/auth setup` открывает неправильный callback или callback завершается ошибкой

Проверьте точное совпадение `EVE_SSO_REDIRECT_URI` с callback URL EVE application, доступность HTTP endpoint и корректность `EVE_SSO_CLIENT_ID`.

### EVE authorization перестала работать после перехода сервисного персонажа

Если сервисный персонаж сменил корпорацию, reauthorization обязательна. CorpDB специально не переносит корпоративный профиль на другую корпорацию автоматически.

### Бот не может выдать или снять Discord роль

Проверьте:

- `Manage Roles`;
- роль бота находится выше целевой;
- роль бота не является Discord managed/integration role.

### Приветствие не приходит в канал

Проверьте welcome channel и права Send Messages/Embed Links. Если канал недоступен, CorpDB пытается использовать ЛС. Также проверьте `welcome.enabled` в onboarding конфигурации.

### Applications не публикует карточки

Проверьте:

- EVE authorization и notifications scope;
- application alert канал;
- права бота на Send Messages/Embed Links;
- `/applications check`;
- `/system status`.

### Finance пустой

Сначала выполните ручной refresh:

```text
/system run-job job:finance
```

Затем проверьте `/finance income` и finance policy. Убедитесь, что Finance модуль включён и сервисный персонаж имеет нужные корпоративные права.

Одиночная временная ошибка ESI `429`, `502`, `503` или `504` обычно не требует действий администратора: ESI client повторяет запрос автоматически. Если job всё же завершился ошибкой после исчерпания retry budget, проверьте финальную ошибку и повторите job после восстановления ESI.

### Role Expiry не выполняет автоматическое исключение

Проверьте:

```text
/admin modules role-expiry-status
```

Должны быть настроены trigger role и минимум одна qualifying role. Также проверьте module state, `Kick Members`, role hierarchy и при необходимости `View Audit Log`.

### Optional command пропала

Проверьте:

```text
/admin modules list
```

При выключенном module его command намеренно удаляется из guild slash-command registration.

---

## 26. Краткий checklist после установки

```text
[ ] Discord Bot создан, Server Members Intent включён
[ ] Bot приглашён со scopes bot + applications.commands
[ ] Bot role выше ролей, которыми должен управлять CorpDB
[ ] EVE application создан, callback совпадает с EVE_SSO_REDIRECT_URI
[ ] .env заполнен
[ ] npm run config:check проходит
[ ] npm run check проходит
[ ] npm test проходит
[ ] npm start работает
[ ] /health отвечает 200
[ ] Discord guild bound
[ ] /auth setup завершён
[ ] /members sync выполнен
[ ] Guest/Rookie/Main настроены
[ ] Main binding approval channel настроен
[ ] Onboarding profile настроен
[ ] Applications channel настроен, если используется
[ ] Ненужные optional modules отключены
[ ] Используемые optional modules настроены
[ ] /system status не показывает критических проблем
[ ] Организован backup .env и полного storage, включая secrets
```
