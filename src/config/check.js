const { loadConfig } = require('./env');

function printCheckResult() {
  try {
    const config = loadConfig();

    console.log('[config] validation passed');
    console.log(`[config] storage: ${config.storage.rootDir}`);
    console.log(`[config] HTTP: ${config.http.host}:${config.http.port}`);
    console.log(`[config] EVE OAuth callback: ${config.eve.redirectUri}`);
    console.log(`[config] ESI compatibility date: ${config.eve.compatibilityDate}`);
    console.log(
      `[config] locales: default=${config.localization.defaultLanguage}; enabled=${config.localization.enabledLanguages.join(',')}`
    );
    console.log(`[config] background jobs: ${config.jobs.enabled ? 'enabled' : 'disabled'}`);

    for (const warning of config.validation.warnings) {
      console.warn(`[config] warning: ${warning}`);
    }
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

printCheckResult();
