const CORPORATION_AUTH_SCOPES = Object.freeze([
  'esi-corporations.read_corporation_membership.v1',
  'esi-corporations.track_members.v1',
  'esi-characters.read_corporation_roles.v1',
  'esi-wallet.read_corporation_wallets.v1',
  'esi-assets.read_corporation_assets.v1',
  'esi-corporations.read_structures.v1',
  'esi-corporations.read_starbases.v1',
  'esi-universe.read_structures.v1',
  'esi-characters.read_notifications.v1',
]);

module.exports = {
  CORPORATION_AUTH_SCOPES,
};
