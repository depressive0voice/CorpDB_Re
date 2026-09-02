function normalizeText(value) {
  return String(value || '').trim();
}

function filterCorporationIds(corporationIds, requestedCorporationId) {
  const values = [...new Set((Array.isArray(corporationIds) ? corporationIds : [])
    .map(normalizeText)
    .filter(Boolean))];
  const requested = normalizeText(requestedCorporationId);
  if (!requested) return values;
  return values.filter((corporationId) => corporationId === requested);
}

function filterRegistrations(registrations, requestedCorporationId) {
  const requested = normalizeText(requestedCorporationId);
  const values = Array.isArray(registrations) ? registrations : [];
  if (!requested) return values;
  return values.filter((entry) => normalizeText(entry?.corporationId) === requested);
}

module.exports = {
  filterCorporationIds,
  filterRegistrations,
};
