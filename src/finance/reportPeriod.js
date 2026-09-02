const REPORT_PERIODS = Object.freeze({
  CURRENT_MONTH: 'current-month',
  PREVIOUS_MONTH: 'previous-month',
  MONTH: 'month',
  ALL: 'all',
});

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatMonthLabelFromDate(date) {
  return `${pad2(date.getUTCMonth() + 1)}-${date.getUTCFullYear()}`;
}

function parseMonthLabel(value) {
  const match = String(value || '').trim().match(/^(0[1-9]|1[0-2])-(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const year = Number(match[2]);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { label: `${pad2(month)}-${year}`, start, end };
}

function buildReportPeriod(period = REPORT_PERIODS.CURRENT_MONTH, monthLabel = '', now = new Date()) {
  const normalized = String(period || REPORT_PERIODS.CURRENT_MONTH).trim().toLowerCase();
  if (normalized === REPORT_PERIODS.ALL) {
    return {
      period: REPORT_PERIODS.ALL,
      periodLabel: REPORT_PERIODS.ALL,
      month: '',
      isAll: true,
      rangeStart: null,
      rangeEnd: null,
    };
  }

  let targetLabel = '';
  if (normalized === REPORT_PERIODS.CURRENT_MONTH) {
    targetLabel = formatMonthLabelFromDate(now);
  } else if (normalized === REPORT_PERIODS.PREVIOUS_MONTH) {
    targetLabel = formatMonthLabelFromDate(new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - 1,
      1
    )));
  } else if (normalized === REPORT_PERIODS.MONTH) {
    targetLabel = String(monthLabel || '').trim();
  } else {
    throw new Error('Invalid finance report period.');
  }

  const range = parseMonthLabel(targetLabel);
  if (!range) {
    throw new Error('Invalid month. Use MM-YYYY, for example 05-2026.');
  }

  return {
    period: normalized,
    periodLabel: range.label,
    month: range.label,
    isAll: false,
    rangeStart: range.start,
    rangeEnd: range.end,
  };
}

function isEntryInReportPeriod(entry, reportPeriod) {
  if (reportPeriod.isAll) return true;
  const timestamp = Date.parse(entry?.date || entry?.retrievedAt || '');
  if (!Number.isFinite(timestamp)) return false;
  return timestamp >= reportPeriod.rangeStart.getTime()
    && timestamp < reportPeriod.rangeEnd.getTime();
}

module.exports = {
  REPORT_PERIODS,
  formatMonthLabelFromDate,
  parseMonthLabel,
  buildReportPeriod,
  isEntryInReportPeriod,
};
