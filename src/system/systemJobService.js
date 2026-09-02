const { runMemberSyncJob } = require('../jobs/memberSyncJob');
const { runFinanceJob } = require('../jobs/financeJob');
const { runApplicationJob } = require('../jobs/applicationJob');
const { runStructureFuelJob } = require('../jobs/structureFuelJob');
const { runPromotionJob } = require('../jobs/promotionJob');
const { runFatRewardsReminderJob } = require('../jobs/fatRewardsReminderJob');
const { runRoleExpiryJob } = require('../jobs/roleExpiryJob');
const { getModuleForSystemJob } = require('../modules/moduleRegistry');
const { isModuleEnabled } = require('../modules/moduleConfigRepository');

const SYSTEM_JOB_KEYS = Object.freeze({
  MEMBERS: 'members',
  FINANCE: 'finance',
  APPLICATIONS: 'applications',
  STRUCTURE_FUEL: 'structure-fuel',
  PROMOTION: 'promotion',
  FAT_REWARDS_REMINDER: 'fat-rewards-reminder',
  ROLE_EXPIRY: 'role-expiry',
});

const SCOPED_JOB_KEYS = new Set([
  SYSTEM_JOB_KEYS.MEMBERS,
  SYSTEM_JOB_KEYS.FINANCE,
  SYSTEM_JOB_KEYS.APPLICATIONS,
  SYSTEM_JOB_KEYS.STRUCTURE_FUEL,
  SYSTEM_JOB_KEYS.FAT_REWARDS_REMINDER,
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function createError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

async function ensureJobModuleEnabled(config, job) {
  const moduleKey = getModuleForSystemJob(job);
  if (!moduleKey) return '';
  if (await isModuleEnabled(config.storage.rootDir, moduleKey)) return moduleKey;
  throw createError(
    `The ${job} job belongs to disabled module ${moduleKey}.`,
    'system_job_module_disabled',
    { job, moduleKey }
  );
}

async function runSystemJob(config, client, jobName, options = {}) {
  const job = normalizeText(jobName).toLowerCase();
  const corporationId = normalizeText(options.corporationId);
  await ensureJobModuleEnabled(config, job);

  const commonOptions = {
    silent: true,
    corporationId,
  };

  let result;
  if (job === SYSTEM_JOB_KEYS.MEMBERS) {
    result = await runMemberSyncJob(config, commonOptions);
  } else if (job === SYSTEM_JOB_KEYS.FINANCE) {
    result = await runFinanceJob(config, client, {
      ...commonOptions,
      maxJournalPages: options.maxJournalPages,
      maxPages: options.maxJournalPages,
    });
  } else if (job === SYSTEM_JOB_KEYS.APPLICATIONS) {
    result = await runApplicationJob(config, client, commonOptions);
  } else if (job === SYSTEM_JOB_KEYS.STRUCTURE_FUEL) {
    result = await runStructureFuelJob(config, client, commonOptions);
  } else if (job === SYSTEM_JOB_KEYS.PROMOTION) {
    if (corporationId) {
      throw createError('The promotion job is instance-scoped and does not accept a corporation.', 'system_job_not_corporation_scoped');
    }
    result = await runPromotionJob(config, client);
  } else if (job === SYSTEM_JOB_KEYS.FAT_REWARDS_REMINDER) {
    result = await runFatRewardsReminderJob(config, client, commonOptions);
  } else if (job === SYSTEM_JOB_KEYS.ROLE_EXPIRY) {
    if (corporationId) {
      throw createError('The role-expiry job is instance-scoped and does not accept a corporation.', 'system_job_not_corporation_scoped');
    }
    result = await runRoleExpiryJob(config, client, { silent: true });
  } else {
    throw createError(`Unknown system job: ${jobName}.`, 'system_job_unknown');
  }

  if (corporationId && SCOPED_JOB_KEYS.has(job)) {
    const checkedCount = Number.isFinite(Number(result?.checkedCorporations))
      ? Number(result.checkedCorporations)
      : Array.isArray(result?.results) ? result.results.length : 0;
    if (checkedCount === 0 && result?.enabled !== false) {
      throw createError(
        `Corporation ${corporationId} is not eligible for the ${job} job.`,
        'system_job_corporation_not_eligible'
      );
    }
  }

  return {
    job,
    corporationId,
    result,
  };
}

module.exports = {
  SYSTEM_JOB_KEYS,
  SCOPED_JOB_KEYS,
  ensureJobModuleEnabled,
  runSystemJob,
};
