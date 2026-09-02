const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

function normalizeCharacterId(value) {
  const characterId = String(value ?? '').trim();
  if (!/^\d+$/.test(characterId)) {
    throw new Error(`Invalid EVE characterId: ${characterId || '<empty>'}`);
  }
  return characterId;
}

function normalizeOptionalId(value) {
  const normalized = String(value ?? '').trim();
  return /^\d+$/.test(normalized) ? normalized : '';
}

function normalizeMember(corporationId, value, previous = {}) {
  const normalizedCorporationId = normalizeCorporationId(corporationId);
  const characterId = normalizeCharacterId(value?.characterId ?? previous?.characterId);
  const isCorporationMember = value?.isCorporationMember === undefined
    ? Boolean(previous?.isCorporationMember)
    : Boolean(value.isCorporationMember);

  return {
    characterId,
    name: String(value?.name ?? previous?.name ?? '').trim(),
    corporationId: normalizedCorporationId,
    corporationName: String(value?.corporationName ?? previous?.corporationName ?? '').trim(),
    isCorporationMember,
    status: String(
      value?.status ?? previous?.status ?? (isCorporationMember ? 'active' : 'left-corporation')
    ).trim(),
    source: 'corporation-sync',
    corporationJoinDate: String(
      value?.corporationJoinDate ?? previous?.corporationJoinDate ?? ''
    ).trim(),
    lastLogonAt: String(value?.lastLogonAt ?? previous?.lastLogonAt ?? '').trim(),
    lastLogoffAt: String(value?.lastLogoffAt ?? previous?.lastLogoffAt ?? '').trim(),
    locationId: normalizeOptionalId(value?.locationId ?? previous?.locationId),
    shipTypeId: normalizeOptionalId(value?.shipTypeId ?? previous?.shipTypeId),
    leftAt: String(value?.leftAt ?? previous?.leftAt ?? '').trim(),
    firstSeenAt: String(value?.firstSeenAt ?? previous?.firstSeenAt ?? '').trim(),
    updatedAt: String(value?.updatedAt ?? previous?.updatedAt ?? '').trim(),
  };
}

function normalizeMembers(corporationId, values) {
  const seen = new Set();
  const members = [];

  for (const value of Array.isArray(values) ? values : []) {
    const member = normalizeMember(corporationId, value);
    if (seen.has(member.characterId)) {
      throw new Error(`Duplicate characterId ${member.characterId} in corporation member storage.`);
    }
    seen.add(member.characterId);
    members.push(member);
  }

  return members.sort((left, right) =>
    left.name.localeCompare(right.name) || left.characterId.localeCompare(right.characterId)
  );
}

async function readMembers(storageRoot, corporationId) {
  const normalizedCorporationId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const values = await readJson(paths.corporationMembersFile(normalizedCorporationId), {
    defaultFactory: () => [],
  });
  return normalizeMembers(normalizedCorporationId, values);
}

async function writeMembers(storageRoot, corporationId, values) {
  const normalizedCorporationId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeMembers(normalizedCorporationId, values);
  await writeJsonAtomic(paths.corporationMembersFile(normalizedCorporationId), normalized);
  return normalized;
}

function comparableMember(member) {
  const { updatedAt, ...value } = member;
  return value;
}

async function applyCorporationMemberSnapshot(storageRoot, corporationId, snapshot, options = {}) {
  const normalizedCorporationId = normalizeCorporationId(corporationId);
  const now = options.now instanceof Date ? options.now : new Date();
  const nowIso = now.toISOString();
  const existing = await readMembers(storageRoot, normalizedCorporationId);
  const existingById = new Map(existing.map((member) => [member.characterId, member]));
  const activeById = new Map();

  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  for (const rawMember of Array.isArray(snapshot) ? snapshot : []) {
    const characterId = normalizeCharacterId(rawMember?.characterId);
    const previous = existingById.get(characterId) || {};
    const next = normalizeMember(normalizedCorporationId, {
      ...rawMember,
      characterId,
      isCorporationMember: true,
      status: 'active',
      leftAt: '',
      firstSeenAt: previous.firstSeenAt || nowIso,
      updatedAt: nowIso,
    }, previous);

    if (!previous.characterId) {
      addedCount += 1;
    } else if (
      JSON.stringify(comparableMember(previous)) === JSON.stringify(comparableMember(next))
    ) {
      next.updatedAt = previous.updatedAt;
      unchangedCount += 1;
    } else {
      updatedCount += 1;
    }

    activeById.set(characterId, next);
  }

  let leftCount = 0;
  for (const previous of existing) {
    if (activeById.has(previous.characterId)) continue;

    if (!previous.isCorporationMember && previous.status === 'left-corporation') {
      activeById.set(previous.characterId, previous);
      continue;
    }

    const left = normalizeMember(normalizedCorporationId, {
      ...previous,
      isCorporationMember: false,
      status: 'left-corporation',
      leftAt: previous.leftAt || nowIso,
      updatedAt: nowIso,
    }, previous);
    activeById.set(previous.characterId, left);
    leftCount += 1;
  }

  const members = await writeMembers(
    storageRoot,
    normalizedCorporationId,
    [...activeById.values()]
  );

  return {
    corporationId: normalizedCorporationId,
    totalCount: members.length,
    activeCount: members.filter((member) => member.isCorporationMember).length,
    addedCount,
    updatedCount,
    unchangedCount,
    leftCount,
    members,
  };
}

async function getMemberSummary(storageRoot, corporationId) {
  const members = await readMembers(storageRoot, corporationId);
  const active = members.filter((member) => member.isCorporationMember);
  const left = members.filter((member) => !member.isCorporationMember);
  const updatedAt = members
    .map((member) => Date.parse(member.updatedAt || ''))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];

  return {
    corporationId: normalizeCorporationId(corporationId),
    totalCount: members.length,
    activeCount: active.length,
    leftCount: left.length,
    lastUpdatedAt: updatedAt ? new Date(updatedAt).toISOString() : '',
  };
}

module.exports = {
  normalizeCharacterId,
  normalizeMember,
  normalizeMembers,
  readMembers,
  writeMembers,
  applyCorporationMemberSnapshot,
  getMemberSummary,
};
