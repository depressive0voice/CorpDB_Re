module.exports = Object.freeze({
  en: Object.freeze({
    'onboarding.welcome.title': 'Welcome!',
    'binding.error.onboardingUnconfigured': 'Multiple corporations are enabled and the applicant corporation has no explicit onboarding profile.',
    'binding.error.onboardingUnresolved': 'The applicant auth family could not be matched to an enabled CorpDB corporation. Synchronize members and try again.',
    'binding.error.onboardingAmbiguous': 'The applicant auth family belongs to corporations that use different onboarding profiles. Fix the corporation-to-profile mapping before approval.',
  }),
  ru: Object.freeze({
    'onboarding.welcome.title': 'Добро пожаловать!',
    'binding.error.onboardingUnconfigured': 'Включено несколько корпораций, но для корпорации заявителя не назначен onboarding-профиль.',
    'binding.error.onboardingUnresolved': 'Auth-семью заявителя не удалось сопоставить с включённой корпорацией CorpDB. Синхронизируй участников и повтори попытку.',
    'binding.error.onboardingAmbiguous': 'Auth-семья заявителя относится к корпорациям с разными onboarding-профилями. Исправь привязку корпораций к профилям перед одобрением.',
  }),
});
