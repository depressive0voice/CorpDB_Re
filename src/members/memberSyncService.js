const {
  getCorporationMemberIds,
  getCorporationMemberTracking,
  resolveUniverseNames,
} = require('../eve/eveEsiClient');
const { getCorporationAccessContext } = require('../eve/eveAuthorizationService');
const { readCorporationProfile } = require('../corporations/corporationProfileRepository');
const {
  applyCorporationMemberSnapshot,
  getMemberSummary,
} = require('./memberRepository');

function buildTrackingMap(values) {
  const map = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const characterId = String(value?.character_id ?? '').trim();
    if (characterId) map.set(characterId, value);
  }
  return map;
}

function buildNameMap(values) {
  const map = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    if (String(value?.category || '') !== 'character') continue;
    const characterId = String(value?.id ?? '').trim();
    if (characterId) map.set(characterId, String(value?.name ?? '').trim());
  }
  return map;
}

function toMemberSnapshotEntry(corporationId, corporationName, characterId, tracking, name) {
  return {
    characterId,
    name: name || characterId,
    corporationId,
    corporationName,
    corporationJoinDate: String(tracking?.start_date ?? '').trim(),
    lastLogonAt: String(tracking?.logon_date ?? '').trim(),
    lastLogoffAt: String(tracking?.logoff_date ?? '').trim(),
    locationId: String(tracking?.location_id ?? '').trim(),
    shipTypeId: String(tracking?.ship_type_id ?? '').trim(),
  };
}

async function syncCorporationMembers(config, storageRoot, corporationId, options = {}) {
  const access = await getCorporationAccessContext(
    config,
    storageRoot,
    corporationId,
    options
  );
  const profile = await readCorporationProfile(storageRoot, corporationId, {
    createIfMissing: false,
  });

  const [memberIds, tracking] = await Promise.all([
    getCorporationMemberIds(config, corporationId, access.accessToken, options),
    getCorporationMemberTracking(config, corporationId, access.accessToken, options),
  ]);

  const names = await resolveUniverseNames(config, memberIds, options);
  const nameMap = buildNameMap(names);
  const trackingMap = buildTrackingMap(tracking);
  const snapshot = memberIds.map((characterId) =>
    toMemberSnapshotEntry(
      corporationId,
      profile.name,
      characterId,
      trackingMap.get(characterId),
      nameMap.get(characterId)
    )
  );

  const result = await applyCorporationMemberSnapshot(
    storageRoot,
    corporationId,
    snapshot,
    options
  );

  return {
    ...result,
    corporationName: profile.name,
    corporationTicker: profile.ticker,
    authorizedCharacterId: access.characterId,
    authorizedCharacterName: access.characterName,
    trackingCount: trackingMap.size,
    unresolvedNameCount: snapshot.filter((member) => member.name === member.characterId).length,
  };
}

module.exports = {
  buildTrackingMap,
  buildNameMap,
  toMemberSnapshotEntry,
  syncCorporationMembers,
  getMemberSummary,
};
