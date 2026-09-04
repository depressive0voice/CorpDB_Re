# CorpDB — Administrator Guide

## 1. Purpose

CorpDB is a self-hosted Discord bot for EVE Online corporation management. A single CorpDB instance can manage one or more EVE corporations and one bound Discord server.

Main functions:

- corporation registration through EVE SSO and ESI access;
- corporation member synchronization;
- Main/Alt data import and Discord-user-to-EVE-main binding;
- onboarding for new Discord members;
- `Guest → Rookie → Main` role lifecycle;
- probation completion checks and `Rookie → Main` promotion;
- member cards, farming data and FAT Activity reporting;
- corporation application alerts;
- basic Discord role management;
- CorpDB access levels;
- system diagnostics, manual background-job execution and safe storage export;
- optional Advanced Roles, Finance, Structure Fuel, Blacklist, FAT Rewards and Role Expiry / Autokick modules.

CorpDB does not require a `corporationId` in `.env`. The corporation is detected from the character authorized through `/auth setup`.

---

## 2. Requirements

### 2.1. Host

A non-Docker installation requires:

- Git;
- Node.js 22 or newer;
- npm;
- persistent writable storage for `storage/`;
- outbound HTTPS access to Discord and EVE SSO/ESI, and to Google Sheets API and EveWho when Blacklist is used.

Check installed versions:

```bash
node --version
npm --version
git --version
```

### 2.2. Discord application

Use a dedicated Discord application with a bot user.

In Discord Developer Portal:

1. Create an Application.
2. Create a bot user on the **Bot** page.
3. Copy the bot token for `DISCORD_TOKEN`.
4. Copy the Application ID for `DISCORD_CLIENT_ID`.
5. Enable **Server Members Intent**. CorpDB uses the `GuildMembers` intent for onboarding, role handling, Main/Alt workflows and Role Expiry.
6. Create a server invite with these scopes:
   - `bot`;
   - `applications.commands`.

Recommended Discord permissions for the full feature set:

- View Channels;
- Send Messages;
- Embed Links;
- Attach Files;
- Read Message History;
- Manage Roles;
- Manage Nicknames — when nickname synchronization is used;
- Kick Members — when Role Expiry / Autokick enforcement is used;
- View Audit Log — for Role Expiry assignment-time backfill.

The bot's highest Discord role must be **above every role CorpDB needs to grant or remove**. Discord does not allow a bot to manage a role that is at or above its own highest role.

Do not configure `DISCORD_GUILD_ID`. CorpDB discovers and persists its Discord server binding itself.

### 2.3. EVE Online application

Create an application in EVE Developers and register a callback URL that matches `EVE_SSO_REDIRECT_URI` **exactly**.

Example for a local installation:

```text
http://127.0.0.1:3000/auth/eve/callback
```

CorpDB uses OAuth Authorization Code + PKCE. `EVE_SSO_CLIENT_SECRET` is not required and is not used.

`/auth setup` requests these ESI scopes:

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

The authorized character acts as the service character for its corporation. It must have sufficient EVE corporation roles for the ESI endpoints used by the enabled features. If the character later moves to another corporation, CorpDB will not silently move the registered corporation profile; authorize an appropriate service character again.

---

## 3. Installation

### 3.1. Clone and install dependencies

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

`npm ci` installs the versions recorded in `package-lock.json` and is preferred for a normal deployment.

### 3.2. Minimum `.env` configuration

At minimum, set:

```dotenv
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
BOT_OWNER_IDS=...

EVE_SSO_CLIENT_ID=...
EVE_SSO_REDIRECT_URI=http://127.0.0.1:3000/auth/eve/callback
```

`BOT_OWNER_IDS` is a comma-separated list of Discord user IDs. These users always receive the `main-admin` access level regardless of Discord roles.

Example:

```dotenv
BOT_OWNER_IDS=123456789012345678,987654321098765432
```

### 3.3. Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `DISCORD_TOKEN` | Discord bot token | required |
| `DISCORD_CLIENT_ID` | Discord Application ID | required |
| `BOT_OWNER_IDS` | comma-separated owner Discord user IDs | required |
| `EVE_SSO_CLIENT_ID` | EVE application Client ID | required |
| `EVE_SSO_REDIRECT_URI` | OAuth callback URL | required |
| `EVE_ESI_DATASOURCE` | ESI datasource | `tranquility` |
| `EVE_ESI_COMPATIBILITY_DATE` | ESI compatibility date | value provided by `.env.example` |
| `HTTP_HOST` | built-in HTTP server bind address | `127.0.0.1` |
| `HTTP_PORT` | built-in HTTP server port | `3000` |
| `CORPDB_STORAGE_DIR` | persistent data directory | `storage` |
| `DEFAULT_LANGUAGE` | default response language | `en` |
| `ENABLED_LANGUAGES` | enabled languages, comma-separated | `ru,en` |
| `BLACKLIST_SPREADSHEET_ID` | Google Sheets spreadsheet ID | empty |
| `BLACKLIST_BLACK_RANGE` | Black List range | `'The List'!A:J` |
| `BLACKLIST_GREY_RANGE` | Grey List range | `'Grey List'!A:J` |
| `GOOGLE_SHEETS_API_KEY` | Google Sheets API key | empty |
| `BLACKLIST_CACHE_TTL_MS` | blacklist sheet cache TTL | `300000` |
| `EVEWHO_BASE_URL` | EveWho API base URL | `https://evewho.com/api` |
| `EVEWHO_PAGE_DELAY_MS` | delay between EveWho pages | `3200` |
| `EVEWHO_CACHE_TTL_MS` | EveWho cache TTL | `120000` |
| `ENABLE_BACKGROUND_JOBS` | global background-job switch | `true` |
| `MEMBER_SYNC_INTERVAL_MINUTES` | member synchronization interval | `30` |
| `ENABLE_PROMOTION_JOB` | automatic Rookie probation checks | `true` |
| `PROMOTION_CHECK_INTERVAL_MINUTES` | promotion check interval | `360` |
| `ENABLE_FINANCE_JOB` | Finance background refresh | `true` |
| `FINANCE_REFRESH_INTERVAL_MINUTES` | Finance interval | `15` |
| `ENABLE_APPLICATIONS_JOB` | Applications background check | `true` |
| `APPLICATIONS_CHECK_INTERVAL_MINUTES` | Applications interval | `15` |
| `ENABLE_STRUCTURE_FUEL_JOB` | Structure Fuel background check | `true` |
| `STRUCTURE_FUEL_CHECK_INTERVAL_MINUTES` | Structure Fuel interval | `60` |
| `ENABLE_FAT_REWARDS_REMINDER_JOB` | FAT Summary reminder job | `true` |
| `FAT_REWARDS_REMINDER_INTERVAL_MINUTES` | reminder-check interval | `360` |

Role Expiry uses its own persisted policy interval and is not configured through `.env`.

If `BLACKLIST_SPREADSHEET_ID` is empty, the overall configuration is still valid, but `/blacklist` cannot perform checks.

### 3.4. Validate before startup

```bash
npm run config:check
npm run check
npm test
```

- `config:check` validates required environment values and formats;
- `check` performs source syntax validation;
- `test` runs the regression test suite.

### 3.5. Start CorpDB

```bash
npm start
```

During a normal startup CorpDB:

1. initializes storage;
2. starts the HTTP server;
3. connects to Discord;
4. resolves the bound guild;
5. registers guild slash commands automatically;
6. starts Core background jobs;
7. starts runtime services for enabled optional modules.

`SIGINT` and `SIGTERM` trigger a graceful shutdown: jobs stop, the Discord client is destroyed and the HTTP server is closed.

### 3.6. HTTP health check

```bash
curl http://127.0.0.1:3000/health
```

Expected response:

```json
{"ok":true,"service":"corpdb"}
```

---

## 4. First startup and initial configuration

Recommended order for a clean installation:

1. Start CorpDB with a valid `.env`.
2. Invite the bot to the one Discord server this instance will serve.
3. Confirm that guild slash commands are registered.
4. Run `/auth setup` as a user listed in `BOT_OWNER_IDS`.
5. Authorize the service character for the required EVE corporation.
6. Verify `/auth status` and run `/members sync`.
7. Configure Discord role bindings and onboarding.
8. Configure the Main/Alt data source and binding approval channel.
9. Configure Applications.
10. Disable unused optional modules and configure the modules you intend to use.
11. Run `/system status` and resolve reported errors or warnings.

### 4.1. Discord guild binding

A CorpDB instance stores one guild binding.

Behavior:

- when the bot is in no guild, CorpDB waits for an invite;
- when exactly one guild is available and no binding exists, it is bound automatically;
- when the bot is already in multiple guilds before the first binding, CorpDB refuses to choose one implicitly;
- after a binding exists, invitations to additional guilds do not replace it;
- if the bound guild becomes unavailable, its stored ID is preserved instead of switching to another guild.

### 4.2. First EVE authorization

Run:

```text
/auth setup
```

The command returns an EVE SSO link. The setup session is single-use and expires after 15 minutes.

After a successful callback CorpDB:

- resolves the EVE `corporationId`, name and ticker;
- registers the corporation;
- initializes corporation storage;
- stores the refresh token under `storage/secrets/eveOAuth.json`;
- stores granted scopes and detected corporation roles;
- attempts to DM a short completion summary to the user who started setup.

Verify with:

```text
/auth status
/members sync
/system status
```

To add another corporation, run `/auth setup` again and authorize a service character from that corporation.

---

## 5. Data model and storage

By default, persistent data is stored in `storage/`.

Main layout:

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

`instance/` contains instance-wide state. `corporations/<corporationId>/` contains corporation-scoped data. `secrets/` contains OAuth secrets and must be treated as confidential persistent data.

`.env` and `storage/` are excluded from Git.

### Backups

A complete backup taken while the bot is stopped should include the **entire** `CORPDB_STORAGE_DIR`, including `storage/secrets/`, and a separately protected copy of `.env`.

The Discord command:

```text
/system storage export
```

exports ordinary runtime data for diagnostics or operational use, but deliberately **excludes `storage/secrets/**`**. It is therefore not a complete backup of EVE OAuth credentials.

---

## 6. CorpDB access control

CorpDB has three access levels:

| Level | Purpose |
|---|---|
| `user` | normal user |
| `admin` | officer/functional administrator |
| `main-admin` | instance owner and critical configuration |

Every ID in `BOT_OWNER_IDS` is always `main-admin`.

`main-admin` is the canonical highest access-level value. Existing `storage/instance/access.json` files that still contain `master-admin` remain compatible: the old value is accepted as an alias and normalized to `main-admin` when the access configuration is loaded or written.

A Discord role can be registered as an admin role:

```text
/admin access add-admin-role role:@Officers
```

Check your effective level:

```text
/access whoami
```

Show current configuration:

```text
/admin access list
```

Change the required level for a command:

```text
/admin access set-command-level command:track level:user
```

Some commands also contain an internal permission check. For example, `/roles`, `/binding-config`, `/auth setup` and `/auth status` remain owner-only even if their general command level is lowered.

### Default command levels

Important defaults:

- `user`: `/access`, `/request-main`;
- `admin`: `/track`, `/fat-rewards`, `/blacklist`, `/auth`, `/finance`, `/applications`, `/structure-fuel`, `/binding-admin`, `/promote`, `/admin`;
- `main-admin`: `/system`.

`/members` is registered at the general `user` level but internally requires an owner. `/language` is available to users. `/groups` uses its own eligibility, approver and owner checks.

---

## 7. Core: EVE authorization and corporation members

### `/auth`

#### `/auth setup`
Owner-only. Starts EVE SSO authorization for a corporation service character. The corporation is detected automatically.

#### `/auth status`
Owner-only. Shows registered EVE authorizations, service character, scope count and detected corporation roles.

#### `/auth import-html file:<HTML>`
Admin+. Imports Main/Alt auth data from an HTML export. CorpDB then derives main/alt families from the imported data.

#### `/auth sync-main-alt mode:preview|apply`
Admin+.

- `preview` reports Main/Alt links that would be created or removed and any conflicts;
- `apply` persists the rebuilt relationships.

#### `/auth show main-alt`
Admin+. Shows the complete `Alt → Main` relationship list.

#### `/auth reconcile`
Admin+. Compares current registered-corporation members with imported auth data and reports missing auth records, characters outside the expected corporation, corporation mismatches and related integrity issues.

### `/members`

Owner-only.

```text
/members sync [corporation]
/members status [corporation]
```

`sync` reads the corporation membership through ESI, updates existing records, adds new members and marks characters that left. `status` reports the local member database size and last synchronization time.

The `corporation` option uses Discord autocomplete and lists only enabled registered corporations for which member synchronization is enabled. It may be omitted when the configured default corporation is eligible or only one eligible corporation exists.

---

## 8. Core: Discord roles

CorpDB does not create your organizational Discord roles automatically. Create the required roles in Discord and bind them to CorpDB logical keys.

Primary lifecycle roles:

- `guest` — new member without an approved main binding;
- `rookie` — probationary member;
- `main` — full member after promotion.

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

`bind` maps a CorpDB logical role key to an existing Discord role. `unbind` removes only the mapping; it does not delete the Discord role.

`set-guest` configures the Guest fallback role.

`sweep` scans guild members and grants Guest where the member has no role that the bot can manage according to Discord hierarchy. Discord managed/integration roles are not treated as ordinary CorpDB-manageable roles.

---

## 9. Core: Main ↔ Alt and Discord binding

CorpDB keeps two related concepts separate:

1. Main/Alt relationships inside EVE auth data;
2. the binding between a Discord user and one EVE main.

A Discord account is bound to a main. Once approved, `/track` can resolve the user through Discord and onboarding/promotion has an unambiguous EVE identity.

### User request

```text
/request-main main:<EVE main name>
```

The main must exist in imported auth data. CorpDB creates a pending binding request and posts it into the configured approval workflow.

### `/binding-config`

Owner-only.

```text
/binding-config show
/binding-config set-approval-channel channel:<channel>
/binding-config set-approved-role role:<role>
```

`set-approval-channel` selects the channel used for binding requests.

`set-approved-role` is a compatibility configuration surface for the post-approval trial role. On a new installation, use Rookie as the trial role and configure it through `/admin onboarding set-rookie-role` as well.

### `/binding-admin`

Binding administration commands:

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

`bind-user` creates a binding manually. When role management is enabled, CorpDB can grant the trial/Rookie role, remove Guest and synchronize a nickname when Discord permissions and role hierarchy allow it.

### Binding audit

```text
/admin binding-audit
```

Admin+. Read-only integrity check. It reports unbound Discord users, stale bindings, mains missing from auth data, invalid corporation links and missing onboarding profiles. It does not modify data.

---

## 10. Core: Onboarding and Promotion

### 10.1. Member lifecycle

Normal path:

```text
Join Discord
    ↓
Guest
    ↓
Main binding approved
    ↓
Rookie
    ↓
probation timer
    ↓
Main
```

`Rookie` is the probationary-member role. Probation is a timed state, not a mandatory separate Discord role after Rookie.

Fast-track is allowed:

```text
Guest → Main
```

and an early promotion is also valid:

```text
Rookie → Main
```

### 10.2. Onboarding profiles

The `default` profile is created automatically, always exists and cannot be deleted. Every onboarding-enabled corporation without another explicit profile mapping uses `default`, whether the instance has one corporation or many.

Several corporations may share one custom profile. An explicit mapping is only needed when a corporation must use a profile other than `default`.

Main-admin commands:

```text
/admin onboarding show
/admin onboarding profile action:create profile:<id>
/admin onboarding profile action:delete profile:<id>
/admin onboarding map-corporation corporation:<id> profile:<id>
/admin onboarding unmap-corporation corporation:<id>
```

`profile action:create` creates a new custom profile and its ID is entered manually. `profile action:delete` removes an existing custom profile; `default` is protected and excluded from delete autocomplete. Deleting a custom profile also removes corporation mappings that pointed to it, so those corporations automatically fall back to `default`.

`corporation` on `map-corporation` and `unmap-corporation` autocompletes from enabled registered corporations for which onboarding is enabled. `profile` on `map-corporation` autocompletes from existing onboarding profiles. `unmap-corporation` removes the explicit mapping and therefore returns the corporation to `default`. Optional `[profile]` fields on profile-specific onboarding commands also autocomplete existing profiles; omitting them uses `default`.

If an existing main binding stored a profile that is later deleted, promotion resolves the current corporation profile and falls back to `default` when no other mapping is present.

Profile roles:

```text
/admin onboarding set-rookie-role role:<role> [profile]
/admin onboarding clear-rookie-role [profile]
/admin onboarding set-main-role role:<role> [profile]
/admin onboarding clear-main-role [profile]
/admin onboarding set-recruiter-role role:<role> [profile]
/admin onboarding clear-recruiter-role [profile]
```

`set-probation-role` / `clear-probation-role` remain available as a compatibility configuration surface. For a new installation, `Rookie` is the canonical trial role.

### 10.3. Probation and promotion

```text
/admin onboarding set-probation-months months:<1-24> [profile]
/admin onboarding set-promotion-channel channel:<channel> [profile]
/admin onboarding clear-promotion-channel [profile]
/admin onboarding check-promotions
/admin onboarding promotion-status
```

The background promotion job periodically checks Rookie members whose probation period has elapsed and creates a notification/request for the recruitment workflow. It does not have to grant Main automatically without an administrator decision.

Manual completion:

```text
/promote role:MAIN user:<Discord user>
```

or by EVE main/alt name:

```text
/promote role:MAIN name:<character>
```

On success CorpDB grants Main, removes Guest/Rookie where applicable, persists the result and attempts to notify the member by DM.

### 10.4. Welcome message

Configuration commands:

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

If the configured welcome channel is missing or unavailable, CorpDB attempts a DM fallback. Bot accounts are ignored.

Supported placeholders:

```text
{member}
{server_name}
{request_main_command}
{guest_role}
{rookie_role}
{main_role}
{recruiter_role}
```

`{probation_role}` is also recognized as a compatibility alias for Rookie.

The `welcome.enabled` flag is stored in `storage/instance/onboarding.json`. Setting it to `false` disables only the automatic welcome message; the rest of Onboarding remains active.

---

## 11. Core: Applications

Applications tracks EVE corporation application notifications, persists application state and can create or update Discord cards without duplicating the same application.

Commands:

```text
/applications show-config [corporation]
/applications set-alert-channel channel:<channel> [corporation]
/applications clear-alert-channel [corporation]
/applications reset-cache [corporation]
/applications check [corporation]
```

`show-config` displays configuration. Channel changes, reset and manual check require `main-admin`.

During a check CorpDB:

- reads EVE notifications;
- identifies corporation application events;
- matches applicants against Auth data when available;
- creates new Discord cards;
- edits an existing card when status or Auth matching changes;
- does not repost an already tracked application as a new one.

Applications is Core and is not controlled by the optional-module switch.

---

## 12. Core: Track / Activity

### 12.1. Member card

```text
/track member [name:<character>] [user:<Discord user>] [period:<...>] [month:MM-YYYY] [fat-month:MM-YYYY]
```

A lookup may use an EVE character name or a Discord user with an approved main binding.

The unified card combines:

- current corporation-member state;
- main and alts;
- Discord binding;
- last logon and corporation join information;
- FAT Activity;
- farming data derived from wallet journal;
- main-family context even when the query starts from an alt.

Farm periods:

- `current-month`;
- `previous-month`;
- `month` together with `month:MM-YYYY`.

### 12.2. FAT Activity

```text
/track activity import month:MM-YYYY file:<xlsx> [corporation]
/track activity report [month:MM-YYYY] [corporation]
/track activity rookies [month:MM-YYYY] [corporation]
/track activity three-months [month:MM-YYYY] [corporation]
/track activity months [corporation]
```

The import expects an XLSX file with `Character` and `FAT` columns.

Persistence rule:

- the current calendar month is preview-only and is not stored as a closed report;
- closed months are persisted in Activity history.

`report` provides the normal FAT control report. `rookies` restricts the report to members of the Discord Rookie role. `three-months` lists members below the minimum for three consecutive closed months. `months` lists stored closed months.

---

## 13. Optional modules

Manage optional modules with:

```text
/admin modules list
/admin modules set module:<module> enabled:<true|false>
```

Available module keys:

```text
advanced-roles
finance
structure-fuel
blacklist
fat-rewards
role-expiry
```

When an optional module is disabled:

- its top-level slash command is removed from guild registration when applicable;
- its mapped `/admin` group is hidden when applicable;
- its background runtime/job stops;
- its job disappears from `/system run-job`;
- service-layer manual execution of the disabled job is rejected;
- stored module configuration and data are retained.

Re-enabling a module reuses its existing data and configuration.

Optional modules are enabled in a clean module configuration, but they perform only work for which their required feature-specific configuration is present.

---

## 14. Optional: Advanced Roles

Module key: `advanced-roles`.

Top-level command: `/groups`.

Advanced Roles implements approval-based access groups that can grant one or more Discord roles after officer approval.

### User and approver commands

```text
/groups list
/groups request group:<id>
/groups pending
/groups approve request:<id>
/groups reject request:<id> [reason]
/groups revoke group:<id> user:<user> [reason]
```

`list` shows the caller's eligibility. Eligibility may contain:

- required-all roles;
- required-any roles;
- forbidden roles.

An approver must have one of the configured approver roles. A group can require between 1 and 10 independent approvals.

### Owner configuration

```text
/groups create ...
/groups role-add group:<id> kind:<kind> role:<role>
/groups role-remove group:<id> kind:<kind> role:<role>
/groups enable group:<id> enabled:<true|false>
```

`create` accepts a stable ID, display name, granted role, approver role and optional scope/eligibility/approval settings.

Role-rule kinds:

```text
grant
required-all
required-any
forbidden
approver
```

A group can be instance-wide or corporation-scoped.

---

## 15. Optional: Finance

Module key: `finance`.

Finance reads EVE corporation wallet data, persists journal history and generates reports according to the configured finance policy.

### Reports

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

If `month` is provided, it overrides `period`.

`wallet` shows balances by wallet division. `income` separates taxable income, alliance tax due, retained amount, other inflows and outflows. `donations` reports `player_donation` entries and totals.

### Finance policy

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

Policy applies to newly ingested journal entries. Changing policy does not retroactively redefine the policy context already recorded for existing entries.

---

## 16. Optional: Structure Fuel

Module key: `structure-fuel`.

Structure Fuel supports Upwell structures and POS. The standard critical threshold is 72 hours of remaining fuel.

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

Selectors follow this hierarchy:

```text
class → EVE group → EVE type → specific structure
```

`alert-disable` excludes matching structures from the automatic alert workflow for the selected scope. `alert-enable` removes the matching disabled filter.

Metenox Moon Drill (`typeID 81826`) is disabled in the default Structure Fuel policy and is excluded from normal reporting/alerts until that policy is changed.

---

## 17. Optional: Blacklist

Module key: `blacklist`.

Configure a Google Sheets source:

```dotenv
BLACKLIST_SPREADSHEET_ID=...
GOOGLE_SHEETS_API_KEY=...
```

Default ranges:

```text
'The List'!A:J
'Grey List'!A:J
```

Character lookup:

```text
/blacklist character:<name|character ID|EveWho URL>
```

Corporation lookup:

```text
/blacklist corporation:<corporation ID|EveWho URL>
```

`character` and `corporation` are mutually exclusive.

Character lookup returns a status. Corporation lookup retrieves members through EveWho, checks them against the configured blacklist source, then returns status counts and an attachment containing the detailed result.

---

## 18. Optional: FAT Rewards

Module key: `fat-rewards`.

FAT Rewards uses a **final FAT Summary for a closed month** and distributes a specified ISK budget according to the current payout rules.

```text
/fat-rewards import month:MM-YYYY file:<xlsx> [corporation]
/fat-rewards calculate amount:<ISK> month:MM-YYYY [file:<xlsx>] [corporation]
/fat-rewards status [corporation]
/fat-rewards set-reminder channel:<channel> [days] [corporation]
```

`import` stores a final summary. `calculate` can optionally import a new XLSX first, calculates payouts, creates the result workbook and persists the closed month into Core Activity. `status` shows the stored summary, its age/reminder state and the active payout rules.

`amount` must be a positive integer ISK value. Spaces, `_`, commas and dots may be used as visual separators in the input.

The reminder reports when the stored FAT Summary is older than the configured number of days.

---

## 19. Optional: Role Expiry / Autokick

Module key: `role-expiry`.

This module removes Discord members who remain on a configured trigger role for too long without acquiring any qualifying/safe role.

Example:

```text
Trigger: Guest
Qualifying: Rookie, Main
Timeout: 7 days
```

A member with Guest begins a timer. As soon as Rookie or Main appears, the candidate is removed from Role Expiry state. If no qualifying role is present when the timeout expires, CorpDB performs a final verification and may kick the member.

### Configuration

```text
/admin modules role-expiry-configure trigger-role:<role> timeout-days:<days> [check-interval-minutes] [log-channel]
/admin modules role-expiry-safe-add role:<role>
/admin modules role-expiry-safe-remove role:<role>
/admin modules role-expiry-status
/admin modules role-expiry-candidates
/admin modules role-expiry-clear-log
```

Enforcement is considered configured only when both conditions are met:

- a trigger role exists;
- at least one qualifying role exists.

### Kick-safety behavior

Role Expiry:

1. records trigger-role assignment time from `guildMemberUpdate`;
2. attempts Discord audit-log backfill for missed assignments when needed;
3. when a trustworthy historical assignment time cannot be established, starts a full timeout from the current time instead of guessing;
4. refetches the member from Discord immediately before a kick;
5. rechecks the trigger role and all qualifying roles;
6. does not reuse a timer associated with an old trigger role after the policy changes;
7. writes an explicit reason into the Discord audit log for automatic kicks.

`role-expiry-candidates` is a read-only preview of current candidates.

`View Audit Log` is required for audit backfill; `Kick Members` is required for enforcement.

---

## 20. Background jobs

Global switch:

```dotenv
ENABLE_BACKGROUND_JOBS=true
```

Core jobs:

| Job | Default interval |
|---|---:|
| Members sync | 30 minutes |
| Applications | 15 minutes |
| Promotion | 360 minutes |

Optional jobs run only when both the corresponding module and the relevant job switch are enabled:

| Job | Module | Default interval |
|---|---|---:|
| Finance refresh | `finance` | 15 minutes |
| Structure Fuel | `structure-fuel` | 60 minutes |
| FAT Rewards reminder | `fat-rewards` | 360 minutes |
| Role Expiry | `role-expiry` | stored Role Expiry policy |

ESI requests are protected against short transient failures. CorpDB retries network fetch failures and HTTP `429`, `502`, `503` and `504` responses up to three total attempts. The default retry delay uses exponential backoff (`500 ms`, then `1000 ms`), and a valid `Retry-After` response header takes precedence, capped at 30 seconds. Permanent HTTP errors such as `400`, `401`, `403` and `404` are not retried.

Manual execution:

```text
/system run-job job:<job> [corporation] [max-journal-pages]
```

Available job choices are generated dynamically. A job belonging to a disabled optional module is not shown.

---

## 21. `/system`

`/system` requires `main-admin` by default.

### `/system ping`

Reports:

- Discord gateway latency;
- process uptime;
- Node.js version.

### `/system status`

Combined diagnostics for:

- overall health;
- Discord guild binding;
- EVE datasource and compatibility date;
- EVE authorizations;
- registered corporations;
- optional-module states;
- background-job state and intervals;
- storage size;
- detected configuration issues.

Run this after installation and after substantial configuration changes.

### `/system run-job`

Runs a background job explicitly. Corporation-scoped jobs may target one corporation or all eligible corporations when the argument is omitted.

`max-journal-pages` applies only to Finance refresh.

### `/system storage status`

Shows ordinary storage file count/size and the number of secret files.

### `/system storage export`

Creates a gzip-compressed JSON export of non-secret runtime storage. `storage/secrets/**` is excluded. The Discord attachment limit for this operation is 24 MiB.

---

## 22. Languages

Built-in languages:

```text
en
ru
```

A user changes their response language with:

```text
/language language:English
```

or another language offered by the Discord command choices.

`DEFAULT_LANGUAGE` must also be included in `ENABLED_LANGUAGES`.

---

## 23. Multi-corporation operation

One CorpDB instance may manage multiple EVE corporations.

Rules:

- corporation identity is always the numeric EVE `corporationId`;
- each corporation has its own profile, member snapshot and module-specific data;
- EVE authorization is stored per corporation ID;
- commands with a `corporation` argument autocomplete only eligible registered corporations;
- `/members sync` and `/members status` use the same corporation autocomplete and filter out disabled/non-members corporations;
- onboarding corporation selectors autocomplete enabled corporations with onboarding enabled, and profile selectors autocomplete existing onboarding profiles;
- with a single corporation, many commands can resolve it without an explicit argument;
- every onboarding corporation without an explicit mapping automatically uses `default`, including multi-corporation instances;
- an explicit `corporation → onboarding profile` mapping is needed only for corporations that should use a profile other than `default`;
- one onboarding profile may be shared by several corporations;
- `default` cannot be deleted; deleting a custom profile removes mappings to it and returns affected corporations to `default`.

---

## 24. Operations and security

1. Never commit `.env` or `storage/` to Git.
2. Restrict OS-level access to `storage/secrets/`.
3. Never post the Discord bot token or EVE refresh tokens in Discord messages or logs.
4. Take host-level backups of the entire `CORPDB_STORAGE_DIR`.
5. Before changing Discord role hierarchy, make sure the bot role remains above Guest/Rookie/Main and access-group roles it manages.
6. Restart the process after changing `.env`, then run `/system status`.
7. A restart is not required after `/admin modules set`; CorpDB updates module runtime and guild command registration immediately.
8. For a production HTTP callback, expose the configured callback through your HTTPS/reverse-proxy setup. `EVE_SSO_REDIRECT_URI` must match the URL registered in the EVE application.

---

## 25. Troubleshooting

### Slash commands do not appear

Check:

- the bot is actually in the bound guild;
- the invite included `applications.commands`;
- logs contain the guild-command registration message;
- `/system status` does not report a guild-binding issue.

### CorpDB reports a guild mismatch

The command is being used in a Discord server other than the one stored in `storage/instance/discord.json`. One CorpDB instance serves one bound guild.

### `/auth setup` opens the wrong callback or callback fails

Check the exact match between `EVE_SSO_REDIRECT_URI` and the callback URL registered for the EVE application, verify the HTTP endpoint is reachable, and verify `EVE_SSO_CLIENT_ID`.

### EVE authorization stopped working after the service character moved

If the service character changed corporation, reauthorization is required. CorpDB intentionally does not move the corporation registration automatically.

### The bot cannot grant or remove a Discord role

Check:

- `Manage Roles` permission;
- the bot role is above the target role;
- the target role is not a Discord managed/integration role.

### Welcome message is not posted to the channel

Check the configured welcome channel and Send Messages/Embed Links permissions. If the channel cannot be used, CorpDB attempts a DM fallback. Also check `welcome.enabled` in the onboarding configuration.

### Applications does not post cards

Check:

- EVE authorization and notifications scope;
- application alert channel;
- Send Messages/Embed Links permissions;
- `/applications check`;
- `/system status`.

### Finance reports are empty

Run a manual refresh first:

```text
/system run-job job:finance
```

Then check `/finance income` and finance policy. Confirm that the Finance module is enabled and the service character has the required EVE permissions.

A single transient ESI `429`, `502`, `503` or `504` normally does not require operator action because the ESI client retries it automatically. If the job still fails after the retry budget is exhausted, inspect the final error and try the job again after ESI recovers.

### Role Expiry does not enforce

Check:

```text
/admin modules role-expiry-status
```

A trigger role and at least one qualifying role must be configured. Also check module state, `Kick Members`, role hierarchy and, for historical backfill, `View Audit Log`.

### An optional command disappeared

Check:

```text
/admin modules list
```

When a module is disabled, its command is intentionally removed from guild slash-command registration.

---

## 26. Post-installation checklist

```text
[ ] Discord Bot created and Server Members Intent enabled
[ ] Bot invited with bot + applications.commands scopes
[ ] Bot role is above roles managed by CorpDB
[ ] EVE application created and callback matches EVE_SSO_REDIRECT_URI
[ ] .env configured
[ ] npm run config:check succeeds
[ ] npm run check succeeds
[ ] npm test succeeds
[ ] npm start runs successfully
[ ] /health returns HTTP 200
[ ] Discord guild is bound
[ ] /auth setup completed
[ ] /members sync completed
[ ] Guest/Rookie/Main configured
[ ] Main-binding approval channel configured
[ ] Onboarding profile configured
[ ] Applications channel configured when used
[ ] Unused optional modules disabled
[ ] Enabled optional modules configured
[ ] /system status has no critical issues
[ ] .env and complete storage, including secrets, are backed up securely
```
