const { findAllAuthCharacters } = require('./authCharacterRepository');
const { listCorporations } = require('../corporations/corporationRegistryRepository');
const { readMembers } = require('../members/memberRepository');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function sortByName(items) {
  return [...items].sort((left, right) =>
    normalizeText(left.name || left.alt || left.main).localeCompare(
      normalizeText(right.name || right.alt || right.main)
    )
  );
}

function buildAuthIndex(records) {
  const index = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const alt = normalizeText(record.alt);
    if (!alt) continue;
    const key = normalizeKey(alt);
    if (!index.has(key)) {
      index.set(key, {
        alt,
        main: normalizeText(record.main),
        corp: normalizeText(record.corp),
      });
    }
  }
  return index;
}

async function readCurrentManagedMembers(storageRoot) {
  const registrations = await listCorporations(storageRoot, { enabledOnly: true });
  const members = [];

  for (const registration of registrations) {
    if (registration.features?.members === false) continue;
    const corporationMembers = await readMembers(storageRoot, registration.corporationId);
    for (const member of corporationMembers) {
      if (!member.isCorporationMember) continue;
      members.push({
        name: normalizeText(member.name),
        corporationId: normalizeText(member.corporationId),
        corporationName: normalizeText(member.corporationName),
        characterId: normalizeText(member.characterId),
        lastLogonAt: normalizeText(member.lastLogonAt),
      });
    }
  }

  return members.filter((member) => member.name);
}

async function reconcileCorpVsAuth(storageRoot) {
  const [currentMembers, authRecords] = await Promise.all([
    readCurrentManagedMembers(storageRoot),
    findAllAuthCharacters(storageRoot),
  ]);
  const authIndex = buildAuthIndex(authRecords);
  const currentNames = new Set(currentMembers.map((member) => normalizeKey(member.name)));

  const inCorpAndInAuth = [];
  const inCorpNotInAuth = [];
  const corpMismatch = [];

  for (const member of currentMembers) {
    const authRecord = authIndex.get(normalizeKey(member.name));
    if (!authRecord) {
      inCorpNotInAuth.push(member);
      continue;
    }

    inCorpAndInAuth.push({ ...member, main: authRecord.main, authCorp: authRecord.corp });
    if (
      member.corporationName &&
      authRecord.corp &&
      normalizeKey(member.corporationName) !== normalizeKey(authRecord.corp)
    ) {
      corpMismatch.push({
        name: member.name,
        corporationName: member.corporationName,
        authCorp: authRecord.corp,
        main: authRecord.main,
      });
    }
  }

  const inAuthNotInCorp = authRecords
    .filter((record) => !currentNames.has(normalizeKey(record.alt)))
    .map((record) => ({
      main: normalizeText(record.main),
      alt: normalizeText(record.alt),
      corp: normalizeText(record.corp),
    }));

  return {
    ok: true,
    currentCorpCount: currentMembers.length,
    authRecordsCount: authRecords.length,
    inCorpAndInAuthCount: inCorpAndInAuth.length,
    inCorpNotInAuthCount: inCorpNotInAuth.length,
    inAuthNotInCorpCount: inAuthNotInCorp.length,
    corpMismatchCount: corpMismatch.length,
    inCorpAndInAuth: sortByName(inCorpAndInAuth),
    inCorpNotInAuth: sortByName(inCorpNotInAuth),
    inAuthNotInCorp: sortByName(inAuthNotInCorp),
    corpMismatch: sortByName(corpMismatch),
  };
}

module.exports = {
  buildAuthIndex,
  readCurrentManagedMembers,
  reconcileCorpVsAuth,
};
