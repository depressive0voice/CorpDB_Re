const { readRegistry } = require('../corporations/corporationRegistryRepository');
const { readMembers } = require('../members/memberRepository');
const { findAllAuthCharacters } = require('../auth/authCharacterRepository');

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function memberTimestamp(member) {
  return Date.parse(member?.updatedAt || member?.leftAt || member?.firstSeenAt || '') || 0;
}

function preferMember(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (Boolean(left.isCorporationMember) !== Boolean(right.isCorporationMember)) {
    return right.isCorporationMember ? right : left;
  }
  return memberTimestamp(right) > memberTimestamp(left) ? right : left;
}

async function listEnabledMemberCorporationIds(storageRoot) {
  const registry = await readRegistry(storageRoot);
  return registry.corporations
    .filter((entry) => entry.enabled && entry.features?.members !== false)
    .map((entry) => entry.corporationId);
}

async function loadStoredMembers(storageRoot, options = {}) {
  const corporationIds = Array.isArray(options.corporationIds) && options.corporationIds.length > 0
    ? options.corporationIds.map(String)
    : await listEnabledMemberCorporationIds(storageRoot);
  const values = [];
  for (const corporationId of corporationIds) {
    const members = await readMembers(storageRoot, corporationId);
    for (const member of members) {
      if (options.activeOnly && !member.isCorporationMember) continue;
      values.push(member);
    }
  }
  return values;
}

function buildAuthFamilyIndex(records) {
  const characterToMain = new Map();
  const mainToNames = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const main = normalizeText(record?.main);
    const alt = normalizeText(record?.alt);
    if (!main || !alt) continue;
    const mainKey = normalizeKey(main);
    if (!mainToNames.has(mainKey)) mainToNames.set(mainKey, new Set([main]));
    mainToNames.get(mainKey).add(alt);
    if (!characterToMain.has(normalizeKey(main))) characterToMain.set(normalizeKey(main), main);
    if (!characterToMain.has(normalizeKey(alt))) characterToMain.set(normalizeKey(alt), main);
  }
  return { characterToMain, mainToNames };
}

function resolveMainName(index, characterName) {
  const name = normalizeText(characterName);
  if (!name) return '';
  return index.characterToMain.get(normalizeKey(name)) || name;
}

function getFamilyNames(index, mainName) {
  const main = normalizeText(mainName);
  if (!main) return [];
  const names = index.mainToNames.get(normalizeKey(main));
  return [...new Set([main, ...(names ? [...names] : [])])];
}

function deduplicateMemberHistory(members) {
  const byCharacter = new Map();
  for (const member of Array.isArray(members) ? members : []) {
    const id = normalizeText(member?.characterId);
    const key = id || `name:${normalizeKey(member?.name)}`;
    if (!key) continue;
    byCharacter.set(key, preferMember(byCharacter.get(key), member));
  }
  return [...byCharacter.values()];
}

async function findManagedMemberByName(storageRoot, characterName) {
  const key = normalizeKey(characterName);
  if (!key) return null;
  const members = await loadStoredMembers(storageRoot);
  return deduplicateMemberHistory(
    members.filter((member) => normalizeKey(member?.name) === key)
  )[0] || null;
}

async function buildTrackFamily(storageRoot, member) {
  const [authRecords, storedMembers] = await Promise.all([
    findAllAuthCharacters(storageRoot),
    loadStoredMembers(storageRoot),
  ]);
  const index = buildAuthFamilyIndex(authRecords);
  const mainName = resolveMainName(index, member?.name);
  const familyNames = getFamilyNames(index, mainName);
  const familyKeys = new Set(familyNames.map(normalizeKey));
  const familyMembers = deduplicateMemberHistory(
    storedMembers.filter((entry) => familyKeys.has(normalizeKey(entry?.name)))
  ).sort((left, right) => normalizeText(left.name).localeCompare(normalizeText(right.name)));
  const mainMember = familyMembers.find((entry) => normalizeKey(entry.name) === normalizeKey(mainName))
    || member;
  const alts = familyMembers.filter((entry) => normalizeKey(entry.name) !== normalizeKey(mainName));
  const corporationIds = [...new Set(
    familyMembers.map((entry) => normalizeText(entry.corporationId)).filter(Boolean)
  )];
  return {
    mainName,
    mainMember,
    alts,
    familyMembers,
    familyNames,
    corporationIds,
  };
}

function normalizeDate(value) {
  const timestamp = Date.parse(normalizeText(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

async function buildCurrentCorporationFamilies(storageRoot, corporationId) {
  const [members, authRecords] = await Promise.all([
    readMembers(storageRoot, corporationId),
    findAllAuthCharacters(storageRoot),
  ]);
  const index = buildAuthFamilyIndex(authRecords);
  const active = members.filter((member) => member.isCorporationMember && normalizeText(member.name));
  const grouped = new Map();
  for (const member of active) {
    const mainName = resolveMainName(index, member.name);
    const key = normalizeKey(mainName);
    if (!grouped.has(key)) grouped.set(key, { mainName, activeMembers: [] });
    grouped.get(key).activeMembers.push(member);
  }

  return [...grouped.values()].map((family) => {
    const mainMember = family.activeMembers.find(
      (member) => normalizeKey(member.name) === normalizeKey(family.mainName)
    ) || null;
    const joinDates = family.activeMembers
      .map((member) => normalizeDate(member.corporationJoinDate))
      .filter(Boolean)
      .sort();
    const corporationJoinDate = mainMember
      ? normalizeDate(mainMember.corporationJoinDate) || joinDates[0] || ''
      : joinDates[0] || '';
    return {
      mainName: family.mainName,
      mainMember: mainMember || family.activeMembers[0],
      activeMembers: [...family.activeMembers].sort((left, right) => left.name.localeCompare(right.name)),
      corporationJoinDate,
    };
  }).sort((left, right) => left.mainName.localeCompare(right.mainName));
}

module.exports = {
  normalizeText,
  normalizeKey,
  listEnabledMemberCorporationIds,
  loadStoredMembers,
  buildAuthFamilyIndex,
  resolveMainName,
  getFamilyNames,
  deduplicateMemberHistory,
  findManagedMemberByName,
  buildTrackFamily,
  buildCurrentCorporationFamilies,
};
