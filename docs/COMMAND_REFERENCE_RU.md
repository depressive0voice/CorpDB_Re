# CorpDB — полный справочник команд

Этот файл описывает текущий slash-command surface CorpDB. Общая установка и описание функций находятся в [USER_GUIDE_RU.md](USER_GUIDE_RU.md).

## Уровни доступа

- **User** — обычный пользователь.
- **Admin** — CorpDB admin или участник Discord с ролью, добавленной через `/admin access add-admin-role`.
- **Master-admin** — пользователь из `BOT_OWNER_IDS` или операция, для которой явно требуется master-admin.
- **Owner-only** — только Discord user ID, указанный в `BOT_OWNER_IDS`. Понижение общего command level не отменяет такую внутреннюю проверку.
- **Approver** — право определяется policy конкретной access group.

Optional-команды регистрируются в Discord только когда соответствующий module включён.

---

## `/access`

### `/access whoami`
**Доступ:** User.

Показывает эффективный уровень CorpDB, причину его получения и совпавшие admin roles.

---

## `/language`

### `/language language:<language>`
**Доступ:** User.

Сохраняет личный язык ответов. Возможные языки ограничены `ENABLED_LANGUAGES`. В поставке поддерживаются `en`, `ru`.

---

## `/auth`

### `/auth setup`
**Доступ:** Owner-only.

Начинает EVE SSO + PKCE авторизацию corporation service character. Корпорация определяется автоматически по персонажу.

### `/auth status`
**Доступ:** Owner-only.

Показывает все зарегистрированные corporation authorizations, service character, scopes и обнаруженные corporation roles.

### `/auth import-html file:<attachment>`
**Доступ:** Admin.

Импортирует Main/Alt auth data из HTML-файла.

### `/auth sync-main-alt mode:<preview|apply>`
**Доступ:** Admin.

`preview` только показывает изменения. `apply` записывает пересобранные Main/Alt relationships.

### `/auth reconcile`
**Доступ:** Admin.

Сравнивает текущий EVE corporation membership с импортированными auth-данными.

### `/auth show main-alt`
**Доступ:** Admin.

Показывает полный список `Alt → Main`.

---

## `/members`

Команда имеет дополнительную owner-only проверку.

### `/members sync [corporation:<id>]`
**Доступ:** Owner-only.

Немедленно синхронизирует состав одной корпорации или всех подходящих корпораций при отсутствии явного ID согласно текущему context resolver.

### `/members status [corporation:<id>]`
**Доступ:** Owner-only.

Показывает состояние локального member snapshot.

---

## `/roles`

Все подкоманды owner-only.

### `/roles list`
Показывает logical role bindings.

### `/roles bind key:<logical-key> role:<Discord role>`
Привязывает logical key к существующей Discord role.

### `/roles unbind key:<logical-key>`
Удаляет mapping. Discord role не удаляется.

### `/roles status`
Показывает текущее состояние role policy и доступность настроенных ролей.

### `/roles set-guest role:<Discord role>`
Задаёт fallback Guest role.

### `/roles sweep`
Запускает ручной Guest fallback sweep по guild.

---

## `/request-main`

### `/request-main main:<EVE main name>`
**Доступ:** User.

Создаёт запрос на связывание Discord user с EVE main из импортированных auth-данных.

---

## `/binding-config`

Все подкоманды owner-only.

### `/binding-config show`
Показывает Main binding configuration.

### `/binding-config set-approval-channel channel:<channel>`
Задаёт Discord channel для approval requests.

### `/binding-config set-approved-role role:<role>`
Задаёт post-approval trial role. Для новой конфигурации используйте Rookie как trial role.

---

## `/binding-admin`

По умолчанию требует Admin. `unlink-user` и `unlink-main` дополнительно требуют Master-admin.

### `/binding-admin status`
Показывает summary pending/approved bindings и approval channel.

### `/binding-admin show-user user:<user>`
Показывает binding/request для Discord user.

### `/binding-admin show-main main:<name>`
Показывает binding/request для EVE main.

### `/binding-admin show-request request-id:<id>`
Показывает конкретный binding request.

### `/binding-admin list-pending`
Показывает pending requests.

### `/binding-admin approve request-id:<id>`
Одобряет pending request и выполняет configured post-approval actions.

### `/binding-admin bind-user user:<user> main:<name> [manage-roles:<bool>]`
Создаёт approved binding вручную. `manage-roles=true` разрешает выполнить role/nickname actions, предусмотренные binding workflow.

### `/binding-admin reject request-id:<id>`
Отклоняет request.

### `/binding-admin repost-request request-id:<id>`
Повторно публикует approval card, не создавая новый request.

### `/binding-admin list-approved`
Показывает approved bindings.

### `/binding-admin unlink-user user:<user>`
**Доступ:** Master-admin.

Удаляет approved binding по Discord user.

### `/binding-admin unlink-main main:<name>`
**Доступ:** Master-admin.

Удаляет approved binding по EVE main.

---

## `/admin`

### `/admin binding-audit`
**Доступ:** Admin.

Read-only audit Discord ↔ Main integrity. Ничего не исправляет автоматически.

### `/admin access list`
**Доступ:** Admin.

Показывает admin roles и command-level policy.

### `/admin access add-admin-role role:<role>`
**Доступ:** Master-admin.

Добавляет Discord role в список CorpDB admin roles.

### `/admin access remove-admin-role role:<role>`
**Доступ:** Master-admin.

Удаляет Discord role из списка admin roles.

### `/admin access set-command-level command:<name> level:<user|admin|master-admin>`
**Доступ:** Master-admin.

Меняет общий требуемый access level для поддерживаемой команды.

### `/admin access reset-command-level command:<name>`
**Доступ:** Master-admin.

Возвращает command level к встроенному default.

### `/admin access reset-all`
**Доступ:** Master-admin.

Сбрасывает access configuration к встроенным defaults, включая admin-role mappings и overrides.

---

## `/admin onboarding`

Все подкоманды требуют Master-admin.

### Профили

- `/admin onboarding show` — показывает welcome settings, profiles и corporation mappings.
- `/admin onboarding profile-create profile:<id>` — создаёт profile.
- `/admin onboarding map-corporation corporation:<id> profile:<id>` — связывает corporation с profile.
- `/admin onboarding unmap-corporation corporation:<id>` — удаляет явный mapping.

### Welcome

- `/admin onboarding set-welcome-channel channel:<channel>`
- `/admin onboarding clear-welcome-channel`
- `/admin onboarding set-welcome-recruiter-role role:<role>`
- `/admin onboarding clear-welcome-recruiter-role`
- `/admin onboarding set-welcome-text text:<template>`
- `/admin onboarding reset-welcome-text`
- `/admin onboarding preview [user:<user>]`
- `/admin onboarding send-test [user:<user>] [channel:<channel>]`

Поддерживаемые placeholders: `{member}`, `{server_name}`, `{request_main_command}`, `{guest_role}`, `{rookie_role}`, `{main_role}`, `{recruiter_role}`. `{probation_role}` поддерживается как compatibility alias Rookie.

### Profile roles

Для каждой команды `[profile:<id>]` необязателен; без него используется `default`.

- `/admin onboarding set-rookie-role role:<role> [profile]`
- `/admin onboarding clear-rookie-role [profile]`
- `/admin onboarding set-main-role role:<role> [profile]`
- `/admin onboarding clear-main-role [profile]`
- `/admin onboarding set-recruiter-role role:<role> [profile]`
- `/admin onboarding clear-recruiter-role [profile]`
- `/admin onboarding set-probation-role role:<role> [profile]` — compatibility surface; Rookie является канонической trial role.
- `/admin onboarding clear-probation-role [profile]` — compatibility surface.

### Promotion policy

- `/admin onboarding set-promotion-channel channel:<channel> [profile]`
- `/admin onboarding clear-promotion-channel [profile]`
- `/admin onboarding set-probation-months months:<1-24> [profile]`
- `/admin onboarding check-promotions`
- `/admin onboarding promotion-status`

---

## `/promote`

### `/promote role:MAIN [user:<user>] [name:<EVE main or alt>]`
**Доступ:** Admin.

Завершает Rookie probation и выдаёт Main. Target должен быть однозначно найден по Discord user или EVE character name. При успешной операции снимаются Guest/Rookie, где применимо.

---

## `/applications`

Applications — Core.

### `/applications show-config [corporation]`
**Доступ:** Admin.

Показывает alert channel и application source configuration.

### `/applications set-alert-channel channel:<channel> [corporation]`
**Доступ:** Master-admin.

Задаёт channel для application cards.

### `/applications clear-alert-channel [corporation]`
**Доступ:** Master-admin.

Удаляет alert channel setting.

### `/applications reset-cache [corporation]`
**Доступ:** Master-admin.

Сбрасывает tracked application state. Для операций, где resolver предлагает `all`, может обрабатывать все подходящие corporations.

### `/applications check [corporation]`
**Доступ:** Master-admin.

Немедленно запускает application processing и Discord card delivery/update.

---

## `/track`

**Доступ:** Admin.

### `/track member [name] [user] [period] [month] [fat-month]`

Показывает unified member card.

- `name` — EVE character name;
- `user` — Discord user с approved binding;
- `period` — `current-month`, `previous-month` или `month`;
- `month` — `MM-YYYY` для `period=month`;
- `fat-month` — необязательный закрытый FAT month.

### `/track activity import month:<MM-YYYY> file:<XLSX> [corporation]`
Импортирует FAT Activity. Текущий месяц — preview-only.

### `/track activity report [month:<MM-YYYY>] [corporation]`
Показывает FAT control report закрытого месяца.

### `/track activity rookies [month:<MM-YYYY>] [corporation]`
Показывает FAT report для Discord Rookie role.

### `/track activity three-months [month:<MM-YYYY>] [corporation]`
Показывает участников ниже норматива три закрытых месяца подряд.

### `/track activity months [corporation]`
Показывает сохранённые закрытые FAT months.

---

## `/system`

Все подкоманды требуют Master-admin.

### `/system ping`
Показывает gateway latency, uptime и Node.js version.

### `/system status`
Показывает общую deployment/configuration diagnostics.

### `/system run-job job:<job> [corporation:<id>] [max-journal-pages:<1-100>]`

Ручной запуск job.

Core job values:

```text
members
applications
promotion
```

Optional job values, когда module включён:

```text
finance
structure-fuel
fat-rewards-reminder
role-expiry
```

`promotion` и `role-expiry` instance-scoped. `max-journal-pages` применяется только к Finance.

### `/system storage status`
Показывает размер/число обычных data files и число secret files.

### `/system storage export`
Создаёт `.json.gz` export без `storage/secrets/**`. Максимальный Discord attachment для этой операции — 24 MiB.

---

# Optional modules

## `/groups` — `advanced-roles`

### `/groups list`
**Доступ:** User.

Показывает доступные groups и eligibility.

### `/groups request group:<id>`
**Доступ:** User, при выполнении eligibility policy.

Создаёт group request.

### `/groups pending`
**Доступ:** Approver.

Показывает requests, которые текущий пользователь вправе рассматривать.

### `/groups approve request:<id>`
**Доступ:** Approver.

Добавляет approval. После достижения required approval count выдаются configured grant roles.

### `/groups reject request:<id> [reason]`
**Доступ:** Approver.

Отклоняет request.

### `/groups revoke group:<id> user:<user> [reason]`
**Доступ:** authorized reviewer согласно group policy.

Отзывает granted group roles, не удаляя unrelated manual roles.

### `/groups create ...`
**Доступ:** Owner-only.

Параметры:

- `id` — stable group ID;
- `name` — display name;
- `grant_role` — роль после final approval;
- `approver_role` — роль approver;
- `description` — optional;
- `required_role` — optional prerequisite;
- `forbidden_role` — optional blocking role;
- `scope` — `instance` или `corporation`;
- `corporation` — corporation ID при corporation scope;
- `approvals` — 1–10;
- `revoke_policy` — `manual`, `prerequisite-loss`, `corporation-leave`.

### `/groups role-add group:<id> kind:<kind> role:<role>`
**Доступ:** Owner-only.

`kind`: `grant`, `required-all`, `required-any`, `forbidden`, `approver`.

### `/groups role-remove group:<id> kind:<kind> role:<role>`
**Доступ:** Owner-only.

Удаляет role rule.

### `/groups enable group:<id> enabled:<bool>`
**Доступ:** Owner-only.

Включает/выключает конкретную access group.

---

## `/finance` — `finance`

Все top-level Finance reports требуют Admin.

### `/finance wallet [corporation]`
Показывает wallet division balances.

### `/finance income [period] [month:<MM-YYYY>] [corporation]`
Показывает income/tax report.

`period`: current month, previous month, specified month, all history. `month` имеет приоритет.

### `/finance donations [period] [month:<MM-YYYY>] [corporation]`
Показывает `player_donation` summary и recent entries.

### `/admin finance show [corporation]`
**Доступ:** Master-admin.

Показывает finance policy.

### `/admin finance set-alliance-tax rate:<0-100> [corporation]`
**Доступ:** Master-admin.

### `/admin finance taxable-add ref-type:<value> [corporation]`
**Доступ:** Master-admin.

### `/admin finance taxable-remove ref-type:<value> [corporation]`
**Доступ:** Master-admin.

### `/admin finance wallet-exclude division:<1-7> [corporation]`
**Доступ:** Master-admin.

### `/admin finance wallet-include division:<1-7> [corporation]`
**Доступ:** Master-admin.

### `/admin finance donation-alert-set user:<user> division:<1-7> [corporation]`
**Доступ:** Master-admin.

### `/admin finance donation-alert-disable [corporation]`
**Доступ:** Master-admin.

---

## `/structure-fuel` — `structure-fuel`

### `/structure-fuel show [corporation] [class] [group] [type] [structure] [only-critical]`
**Доступ:** Admin.

Показывает fuel state с optional selector filters.

### `/structure-fuel show-config [corporation]`
**Доступ:** Admin.

Показывает alert channel, ping role, threshold и filters.

### `/structure-fuel alert-filters [corporation]`
**Доступ:** Admin.

Read-only список disabled alert filters.

### `/structure-fuel alert-disable [corporation] [class] [group] [type] [structure]`
**Доступ:** Master-admin.

Добавляет disabled alert filter.

### `/structure-fuel alert-enable [corporation] [class] [group] [type] [structure]`
**Доступ:** Master-admin.

Удаляет matching disabled filter.

### `/structure-fuel set-alert-channel channel:<channel> [corporation]`
**Доступ:** Master-admin.

### `/structure-fuel clear-alert-channel [corporation]`
**Доступ:** Master-admin.

### `/structure-fuel set-alert-role role:<role> [corporation]`
**Доступ:** Master-admin.

### `/structure-fuel clear-alert-role [corporation]`
**Доступ:** Master-admin.

### `/structure-fuel check-alerts [corporation]`
**Доступ:** Master-admin.

Немедленно выполняет structure check и текущий alert workflow.

---

## `/blacklist` — `blacklist`

**Доступ:** Admin.

Ровно один из параметров обязателен:

### `/blacklist character:<name|ID|EveWho URL>`
Проверяет одного character.

### `/blacklist corporation:<ID|EveWho URL>`
Получает corporation members, проверяет их и возвращает attachment с результатами.

---

## `/fat-rewards` — `fat-rewards`

**Доступ:** Admin.

### `/fat-rewards import month:<MM-YYYY> file:<XLSX> [corporation]`
Сохраняет final FAT Summary закрытого месяца.

### `/fat-rewards calculate amount:<ISK> month:<MM-YYYY> [file:<XLSX>] [corporation]`
Рассчитывает payouts, создаёт workbook и записывает закрытый месяц в Core Activity.

### `/fat-rewards status [corporation]`
Показывает latest summary, age/reminder и payout rules.

### `/fat-rewards set-reminder channel:<channel> [days:<1-90>] [corporation]`
Настраивает stale-summary reminder. Если `days` не указан, используется 31 день.

---

## `/admin modules` — optional module management

Все подкоманды требуют Master-admin.

### `/admin modules list`
Показывает states всех optional modules.

### `/admin modules set module:<key> enabled:<bool>`
Включает/выключает module и сразу обновляет runtime + guild slash registration.

Keys:

```text
advanced-roles
finance
structure-fuel
blacklist
fat-rewards
role-expiry
```

### `/admin modules fat-rewards enabled:<bool>`
Compatibility alias для изменения состояния `fat-rewards`.

### `/admin modules role-expiry-status`
Показывает policy и количество tracked candidates.

### `/admin modules role-expiry-configure trigger-role:<role> timeout-days:<1-3650> [check-interval-minutes:<5-1440>] [log-channel:<channel>]`
Задаёт trigger role, timeout, interval и optional log channel.

### `/admin modules role-expiry-safe-add role:<role>`
Добавляет qualifying role.

### `/admin modules role-expiry-safe-remove role:<role>`
Удаляет qualifying role.

### `/admin modules role-expiry-clear-log`
Отключает channel logging Role Expiry.

### `/admin modules role-expiry-candidates`
Read-only список текущих candidates, их assigned/expires time и source timestamp.
