# CorpDB — Complete Command Reference

This file describes the current CorpDB slash-command surface. Installation and functional documentation are in [USER_GUIDE_EN.md](USER_GUIDE_EN.md).

## Access terminology

- **User** — normal user.
- **Admin** — CorpDB admin or a member with a Discord role added through `/admin access add-admin-role`.
- **Main-admin** — instance owner for critical configuration. Users listed in `BOT_OWNER_IDS` receive this level.
- **Owner-only** — only Discord user IDs listed in `BOT_OWNER_IDS`. Lowering a general command level does not bypass this internal check.
- **Approver** — permission is determined by the policy of the specific access group.

`main-admin` is the canonical highest access-level value. Existing stored `master-admin` values are accepted as a backward-compatibility alias and normalized to `main-admin` when access configuration is loaded or written.

Optional commands are registered in Discord only while their module is enabled.

---

## `/access`

### `/access whoami`
**Access:** User.

Shows the caller's effective CorpDB level, the reason for that level and matched admin roles.

---

## `/language`

### `/language language:<language>`
**Access:** User.

Stores the user's response-language preference. Available values are restricted by `ENABLED_LANGUAGES`. Built-in languages are `en` and `ru`.

---

## `/auth`

### `/auth setup`
**Access:** Owner-only.

Starts EVE SSO + PKCE authorization for a corporation service character. The corporation is detected automatically.

### `/auth status`
**Access:** Owner-only.

Shows registered corporation authorizations, service characters, granted scopes and detected corporation roles.

### `/auth import-html file:<attachment>`
**Access:** Admin.

Imports Main/Alt auth data from an HTML file.

### `/auth sync-main-alt mode:<preview|apply>`
**Access:** Admin.

`preview` reports changes only. `apply` persists rebuilt Main/Alt relationships.

### `/auth reconcile`
**Access:** Admin.

Compares current EVE corporation membership with imported auth data.

### `/auth show main-alt`
**Access:** Admin.

Shows the complete `Alt → Main` relationship list.

---

## `/members`

The command has an additional owner-only check. The `corporation` field uses autocomplete and shows only enabled registered corporations for which member synchronization is enabled. It may be omitted when the default corporation is eligible or only one eligible corporation exists.

### `/members sync [corporation:<id>]`
**Access:** Owner-only.

Immediately synchronizes corporation membership.

### `/members status [corporation:<id>]`
**Access:** Owner-only.

Shows local member-snapshot status.

---

## `/roles`

All subcommands are owner-only.

### `/roles list`
Shows logical role bindings.

### `/roles bind key:<logical-key> role:<Discord role>`
Maps a logical key to an existing Discord role.

### `/roles unbind key:<logical-key>`
Removes the mapping. The Discord role is not deleted.

### `/roles status`
Shows role-policy state and configured-role availability.

### `/roles set-guest role:<Discord role>`
Sets the fallback Guest role.

### `/roles sweep`
Runs a manual Guest fallback sweep over the bound guild.

---

## `/request-main`

### `/request-main main:<EVE main name>`
**Access:** User.

Creates a request to bind the Discord user to an EVE main from imported auth data.

---

## `/binding-config`

All subcommands are owner-only.

### `/binding-config show`
Shows Main-binding configuration.

### `/binding-config set-approval-channel channel:<channel>`
Sets the Discord channel used for approval requests.

### `/binding-config set-approved-role role:<role>`
Sets the post-approval trial role. On a new configuration, use Rookie as the trial role.

---

## `/binding-admin`

Requires Admin by default. `unlink-user` and `unlink-main` additionally require Main-admin.

### `/binding-admin status`
Shows pending/approved binding counts and approval-channel status.

### `/binding-admin show-user user:<user>`
Shows a binding/request by Discord user.

### `/binding-admin show-main main:<name>`
Shows a binding/request by EVE main.

### `/binding-admin show-request request-id:<id>`
Shows one binding request.

### `/binding-admin list-pending`
Lists pending requests.

### `/binding-admin approve request-id:<id>`
Approves a pending request and performs configured post-approval actions.

### `/binding-admin bind-user user:<user> main:<name> [manage-roles:<bool>]`
Creates an approved binding manually. `manage-roles=true` permits the role/nickname actions defined by the binding workflow.

### `/binding-admin reject request-id:<id>`
Rejects a request.

### `/binding-admin repost-request request-id:<id>`
Reposts the approval card without creating a new request.

### `/binding-admin list-approved`
Lists approved bindings.

### `/binding-admin unlink-user user:<user>`
**Access:** Main-admin.

Removes an approved binding by Discord user.

### `/binding-admin unlink-main main:<name>`
**Access:** Main-admin.

Removes an approved binding by EVE main.

---

## `/admin`

### `/admin binding-audit`
**Access:** Admin.

Read-only Discord ↔ Main integrity audit. It does not repair data automatically.

### `/admin access list`
**Access:** Admin.

Shows admin roles and the configurable command-level policy.

### `/admin access add-admin-role role:<role>`
**Access:** Main-admin.

Adds a Discord role to CorpDB admin roles.

### `/admin access remove-admin-role role:<role>`
**Access:** Main-admin.

Removes a Discord role from CorpDB admin roles.

### `/admin access set-command-level command:<name> level:<user|admin|main-admin>`
**Access:** Main-admin.

Changes the general access requirement for a supported command.

### `/admin access reset-command-level command:<name>`
**Access:** Main-admin.

Restores the built-in default command level.

### `/admin access reset-all`
**Access:** Main-admin.

Resets access configuration to built-in defaults, including admin-role mappings and overrides.

---

## `/admin onboarding`

All subcommands require Main-admin.

### Profiles

- `/admin onboarding show` — shows welcome settings, profiles and corporation mappings.
- `/admin onboarding profile-create profile:<id>` — creates a profile.
- `/admin onboarding map-corporation corporation:<id> profile:<id>` — maps a corporation to a profile.
- `/admin onboarding unmap-corporation corporation:<id>` — removes an explicit mapping.

For `map-corporation` and `unmap-corporation`, the `corporation` field autocompletes enabled registered corporations for which onboarding is enabled. `map-corporation` autocompletes `profile` from existing onboarding profiles. Optional `[profile]` fields on profile-specific onboarding commands also autocomplete existing profiles; omitting the field uses `default`.

### Welcome

- `/admin onboarding set-welcome-channel channel:<channel>`
- `/admin onboarding clear-welcome-channel`
- `/admin onboarding set-welcome-recruiter-role role:<role>`
- `/admin onboarding clear-welcome-recruiter-role`
- `/admin onboarding set-welcome-text text:<template>`
- `/admin onboarding reset-welcome-text`
- `/admin onboarding preview [user:<user>]`
- `/admin onboarding send-test [user:<user>] [channel:<channel>]`

Supported placeholders: `{member}`, `{server_name}`, `{request_main_command}`, `{guest_role}`, `{rookie_role}`, `{main_role}`, `{recruiter_role}`. `{probation_role}` remains available as a compatibility alias for Rookie.

### Profile roles

For each command, `[profile:<id>]` is optional; without it the `default` profile is used.

- `/admin onboarding set-rookie-role role:<role> [profile]`
- `/admin onboarding clear-rookie-role [profile]`
- `/admin onboarding set-main-role role:<role> [profile]`
- `/admin onboarding clear-main-role [profile]`
- `/admin onboarding set-recruiter-role role:<role> [profile]`
- `/admin onboarding clear-recruiter-role [profile]`
- `/admin onboarding set-probation-role role:<role> [profile]` — compatibility surface; Rookie is the canonical trial role.
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
**Access:** Admin.

Completes Rookie probation and grants Main. The target must resolve unambiguously from a Discord user or EVE character name. Guest/Rookie roles are removed where applicable.

---

## `/applications`

Applications is Core.

### `/applications show-config [corporation]`
**Access:** Admin.

Shows alert-channel and application-source configuration.

### `/applications set-alert-channel channel:<channel> [corporation]`
**Access:** Main-admin.

Sets the channel for application cards.

### `/applications clear-alert-channel [corporation]`
**Access:** Main-admin.

Clears the application alert-channel setting.

### `/applications reset-cache [corporation]`
**Access:** Main-admin.

Resets tracked application state.

### `/applications check [corporation]`
**Access:** Main-admin.

Runs application processing and Discord card delivery/update immediately.

---

## `/track`

**Access:** Admin.

### `/track member [name] [user] [period] [month] [fat-month]`

Shows a unified member card.

- `name` — EVE character name;
- `user` — Discord user with an approved binding;
- `period` — `current-month`, `previous-month` or `month`;
- `month` — `MM-YYYY` when `period=month`;
- `fat-month` — optional closed FAT month.

### `/track activity import month:<MM-YYYY> file:<XLSX> [corporation]`
Imports FAT Activity. The current month is preview-only.

### `/track activity report [month:<MM-YYYY>] [corporation]`
Shows the FAT control report for a closed month.

### `/track activity rookies [month:<MM-YYYY>] [corporation]`
Shows the FAT report for the Discord Rookie role.

### `/track activity three-months [month:<MM-YYYY>] [corporation]`
Lists members below the minimum for three consecutive closed months.

### `/track activity months [corporation]`
Lists stored closed FAT months.

---

## `/system`

All subcommands require Main-admin.

### `/system ping`
Shows gateway latency, uptime and Node.js version.

### `/system status`
Shows combined deployment/configuration diagnostics.

### `/system run-job job:<job> [corporation:<id>] [max-journal-pages:<1-100>]`

Runs a background job manually.

Core job values:

```text
members
applications
promotion
```

Optional job values while the corresponding module is enabled:

```text
finance
structure-fuel
fat-rewards-reminder
role-expiry
```

`promotion` and `role-expiry` are instance-scoped. `max-journal-pages` applies only to Finance.

### `/system storage status`
Shows ordinary data-file count/size and secret-file count.

### `/system storage export`
Creates a `.json.gz` export that excludes `storage/secrets/**`. The operation uses a 24 MiB maximum Discord attachment size.

---

# Optional modules

## `/groups` — `advanced-roles`

### `/groups list`
**Access:** User.

Shows available groups and caller eligibility.

### `/groups request group:<id>`
**Access:** User, subject to eligibility policy.

Creates an access-group request.

### `/groups pending`
**Access:** Approver.

Shows requests the current member is allowed to review.

### `/groups approve request:<id>`
**Access:** Approver.

Records one approval. When the required approval count is reached, configured grant roles are assigned.

### `/groups reject request:<id> [reason]`
**Access:** Approver.

Rejects a request.

### `/groups revoke group:<id> user:<user> [reason]`
**Access:** authorized reviewer according to group policy.

Revokes group-granted roles without removing unrelated manual roles.

### `/groups create ...`
**Access:** Owner-only.

Parameters:

- `id` — stable group ID;
- `name` — display name;
- `grant_role` — role granted after final approval;
- `approver_role` — approver role;
- `description` — optional;
- `required_role` — optional prerequisite;
- `forbidden_role` — optional blocking role;
- `scope` — `instance` or `corporation`;
- `corporation` — corporation ID when corporation-scoped;
- `approvals` — 1–10;
- `revoke_policy` — `manual`, `prerequisite-loss`, `corporation-leave`.

### `/groups role-add group:<id> kind:<kind> role:<role>`
**Access:** Owner-only.

`kind`: `grant`, `required-all`, `required-any`, `forbidden`, `approver`.

### `/groups role-remove group:<id> kind:<kind> role:<role>`
**Access:** Owner-only.

Removes a role rule.

### `/groups enable group:<id> enabled:<bool>`
**Access:** Owner-only.

Enables or disables one access group.

---

## `/finance` — `finance`

All top-level Finance reports require Admin.

### `/finance wallet [corporation]`
Shows wallet-division balances.

### `/finance income [period] [month:<MM-YYYY>] [corporation]`
Shows the income/tax report.

`period`: current month, previous month, specified month or all history. `month` overrides it.

### `/finance donations [period] [month:<MM-YYYY>] [corporation]`
Shows the `player_donation` summary and recent entries.

### `/admin finance show [corporation]`
**Access:** Main-admin.

Shows finance policy.

### `/admin finance set-alliance-tax rate:<0-100> [corporation]`
**Access:** Main-admin.

### `/admin finance taxable-add ref-type:<value> [corporation]`
**Access:** Main-admin.

### `/admin finance taxable-remove ref-type:<value> [corporation]`
**Access:** Main-admin.

### `/admin finance wallet-exclude division:<1-7> [corporation]`
**Access:** Main-admin.

### `/admin finance wallet-include division:<1-7> [corporation]`
**Access:** Main-admin.

### `/admin finance donation-alert-set user:<user> division:<1-7> [corporation]`
**Access:** Main-admin.

### `/admin finance donation-alert-disable [corporation]`
**Access:** Main-admin.

---

## `/structure-fuel` — `structure-fuel`

### `/structure-fuel show [corporation] [class] [group] [type] [structure] [only-critical]`
**Access:** Admin.

Shows current fuel state with optional selector filters.

### `/structure-fuel show-config [corporation]`
**Access:** Admin.

Shows alert channel, ping role, threshold and filters.

### `/structure-fuel alert-filters [corporation]`
**Access:** Admin.

Read-only list of disabled alert filters.

### `/structure-fuel alert-disable [corporation] [class] [group] [type] [structure]`
**Access:** Main-admin.

Adds a disabled alert filter.

### `/structure-fuel alert-enable [corporation] [class] [group] [type] [structure]`
**Access:** Main-admin.

Removes a matching disabled filter.

### `/structure-fuel set-alert-channel channel:<channel> [corporation]`
**Access:** Main-admin.

### `/structure-fuel clear-alert-channel [corporation]`
**Access:** Main-admin.

### `/structure-fuel set-alert-role role:<role> [corporation]`
**Access:** Main-admin.

### `/structure-fuel clear-alert-role [corporation]`
**Access:** Main-admin.

### `/structure-fuel check-alerts [corporation]`
**Access:** Main-admin.

Runs the structure check and current alert workflow immediately.

---

## `/blacklist` — `blacklist`

**Access:** Admin.

Exactly one lookup parameter is required.

### `/blacklist character:<name|ID|EveWho URL>`
Checks one character.

### `/blacklist corporation:<ID|EveWho URL>`
Retrieves corporation members, checks them and returns a result attachment.

---

## `/fat-rewards` — `fat-rewards`

**Access:** Admin.

### `/fat-rewards import month:<MM-YYYY> file:<XLSX> [corporation]`
Stores the final FAT Summary for a closed month.

### `/fat-rewards calculate amount:<ISK> month:<MM-YYYY> [file:<XLSX>] [corporation]`
Calculates payouts, creates the workbook and persists the closed month into Core Activity.

### `/fat-rewards status [corporation]`
Shows the latest summary, age/reminder status and payout rules.

### `/fat-rewards set-reminder channel:<channel> [days:<1-90>] [corporation]`
Configures the stale-summary reminder. When `days` is omitted, 31 days is used.

---

## `/admin modules` — optional module management

All subcommands require Main-admin.

### `/admin modules list`
Shows all optional-module states.

### `/admin modules set module:<key> enabled:<bool>`
Enables/disables a module and immediately updates runtime and guild slash-command registration.

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
Compatibility alias for changing the `fat-rewards` module state.

### `/admin modules role-expiry-status`
Shows Role Expiry policy and tracked-candidate count.

### `/admin modules role-expiry-configure trigger-role:<role> timeout-days:<1-3650> [check-interval-minutes:<5-1440>] [log-channel:<channel>]`
Sets trigger role, timeout, interval and optional log channel.

### `/admin modules role-expiry-safe-add role:<role>`
Adds a qualifying role.

### `/admin modules role-expiry-safe-remove role:<role>`
Removes a qualifying role.

### `/admin modules role-expiry-clear-log`
Disables Role Expiry channel logging.

### `/admin modules role-expiry-candidates`
Read-only list of current candidates, assigned/expiry times and timestamp source.
