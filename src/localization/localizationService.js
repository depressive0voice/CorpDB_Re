const en = require('./locales/en');
const ru = require('./locales/ru');
const accessLocales = require('./accessLocales');
const authLocales = require('./authLocales');
const financeLocales = require('./financeLocales');
const financeAdminLocales = require('./financeAdminLocales');
const applicationsLocales = require('./applicationsLocales');
const structureLocales = require('./structureLocales');
const structureSelectorLocales = require('./structureSelectorLocales');
const onboardingLocales = require('./onboardingLocales');
const onboardingBindingLocales = require('./onboardingBindingLocales');
const trackLocales = require('./trackLocales');
const trackImportLocales = require('./trackImportLocales');
const fatRewardsLocales = require('./fatRewardsLocales');
const blacklistLocales = require('./blacklistLocales');
const bindingAdminLocales = require('./bindingAdminLocales');
const bindingAuditLocales = require('./bindingAuditLocales');
const systemLocales = require('./systemLocales');
const directMessageLocales = require('./directMessageLocales');
const { DEFAULT_LANGUAGE } = require('../config/env');
const { getUserLanguage } = require('./userLanguageRepository');

const dictionaries = Object.freeze({
  en: Object.freeze({
    ...en,
    ...accessLocales.en,
    ...authLocales.en,
    ...financeLocales.en,
    ...financeAdminLocales.en,
    ...applicationsLocales.en,
    ...structureLocales.en,
    ...structureSelectorLocales.en,
    ...onboardingLocales.en,
    ...onboardingBindingLocales.en,
    ...trackLocales.en,
    ...trackImportLocales.en,
    ...fatRewardsLocales.en,
    ...blacklistLocales.en,
    ...bindingAdminLocales.en,
    ...bindingAuditLocales.en,
    ...systemLocales.en,
    ...directMessageLocales.en,
  }),
  ru: Object.freeze({
    ...ru,
    ...accessLocales.ru,
    ...authLocales.ru,
    ...financeLocales.ru,
    ...financeAdminLocales.ru,
    ...applicationsLocales.ru,
    ...structureLocales.ru,
    ...structureSelectorLocales.ru,
    ...onboardingLocales.ru,
    ...onboardingBindingLocales.ru,
    ...trackLocales.ru,
    ...trackImportLocales.ru,
    ...fatRewardsLocales.ru,
    ...blacklistLocales.ru,
    ...bindingAdminLocales.ru,
    ...bindingAuditLocales.ru,
    ...systemLocales.ru,
    ...directMessageLocales.ru,
  }),
});

function interpolate(template, params = {}) {
  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  ));
}

function translate(language, key, params = {}, options = {}) {
  const fallbackLanguage = options.fallbackLanguage || DEFAULT_LANGUAGE;
  const dictionary = dictionaries[language] || dictionaries[fallbackLanguage] || dictionaries.en;
  const fallbackDictionary = dictionaries[fallbackLanguage] || dictionaries.en;
  const template = dictionary[key] ?? fallbackDictionary[key] ?? dictionaries.en[key] ?? key;
  return interpolate(template, params);
}

async function resolveUserLanguage(storageRoot, config, discordUserId) {
  const storedLanguage = await getUserLanguage(storageRoot, discordUserId).catch(() => null);
  const enabledLanguages = config.localization.enabledLanguages;

  if (storedLanguage && enabledLanguages.includes(storedLanguage)) {
    return storedLanguage;
  }

  if (enabledLanguages.includes(config.localization.defaultLanguage)) {
    return config.localization.defaultLanguage;
  }

  if (enabledLanguages.includes(DEFAULT_LANGUAGE)) {
    return DEFAULT_LANGUAGE;
  }

  return enabledLanguages[0] || DEFAULT_LANGUAGE;
}

function createTranslator(language, config) {
  return (key, params = {}) => translate(language, key, params, {
    fallbackLanguage: config.localization.defaultLanguage || DEFAULT_LANGUAGE,
  });
}

module.exports = {
  dictionaries,
  interpolate,
  translate,
  resolveUserLanguage,
  createTranslator,
};
