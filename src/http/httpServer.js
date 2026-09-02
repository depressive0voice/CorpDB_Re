const http = require('http');
const {
  completeCorporationAuthorization,
  getAuthorizationRedirectUrl,
} = require('../eve/eveAuthorizationService');

function sendHtml(response, statusCode, title, message) {
  const safeTitle = String(title || '').replace(/[<>&"']/g, '');
  const safeMessage = String(message || '').replace(/[<>&"']/g, '');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title></head><body><h1>${safeTitle}</h1><p>${safeMessage}</p><p>You can close this tab and return to Discord.</p></body></html>`;
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(html);
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function sendRedirect(response, location) {
  response.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
  });
  response.end();
}

async function notifyDiscordAuthorizationComplete(client, result) {
  const userId = String(result?.session?.initiatedByDiscordUserId || '');
  if (!userId || !client) return;

  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return;

  const roles = result.authorization.corporationRoles || [];
  const roleSummary = roles.length > 0 ? roles.join(', ') : 'not detected';
  await user.send([
    `EVE authorization completed for **${result.profile.name} [${result.profile.ticker}]**.`,
    `Character: **${result.authorization.characterName || result.authorization.characterId}**`,
    `Corporation ID: \`${result.profile.corporationId}\``,
    `Corporation roles: ${roleSummary}`,
  ].join('\n')).catch(() => null);
}

function createHttpServer({ config, storageRoot, discordClient }) {
  const callbackUrl = new URL(config.eve.redirectUri);
  const callbackPath = callbackUrl.pathname;
  const authorizationStartPath = '/auth/eve/start';

  return http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        sendJson(response, 200, { ok: true, service: 'corpdb' });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === authorizationStartPath) {
        const authorizationUrl = await getAuthorizationRedirectUrl(
          storageRoot,
          requestUrl.searchParams.get('state')
        );
        sendRedirect(response, authorizationUrl);
        return;
      }

      if (request.method !== 'GET' || requestUrl.pathname !== callbackPath) {
        sendJson(response, 404, { ok: false, error: 'not_found' });
        return;
      }

      const oauthError = requestUrl.searchParams.get('error');
      if (oauthError) {
        const description = requestUrl.searchParams.get('error_description') || oauthError;
        sendHtml(response, 400, 'EVE authorization cancelled', description);
        return;
      }

      const result = await completeCorporationAuthorization(config, storageRoot, {
        code: requestUrl.searchParams.get('code'),
        state: requestUrl.searchParams.get('state'),
      });

      console.log(
        `[eve-auth] authorized ${result.authorization.characterName || result.authorization.characterId} for ${result.profile.name} [${result.profile.ticker}] (${result.profile.corporationId})`
      );
      await notifyDiscordAuthorizationComplete(discordClient, result);
      sendHtml(
        response,
        200,
        'EVE authorization complete',
        `${result.profile.name} [${result.profile.ticker}] is now registered in CorpDB.`
      );
    } catch (error) {
      console.error('[http:eve-auth] failed:', error?.stack || error);
      sendHtml(response, 400, 'EVE authorization failed', error?.message || 'Unknown error');
    }
  });
}

async function startHttpServer(options) {
  const server = createHttpServer(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.config.http.port, options.config.http.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  console.log(`[http] listening on http://${options.config.http.host}:${options.config.http.port}`);
  return server;
}

async function stopHttpServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve) => server.close(() => resolve()));
}

module.exports = {
  createHttpServer,
  startHttpServer,
  stopHttpServer,
};
