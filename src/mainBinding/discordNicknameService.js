function normalizeText(value) {
  return String(value || '').trim();
}

async function syncGuildMemberNicknameToMain(context) {
  const guild = context?.guild || null;
  const discordUserId = normalizeText(context?.discordUserId);
  const mainName = normalizeText(context?.mainName);

  if (!guild) {
    return { ok: false, changed: false, status: 'guild_missing', targetNickname: mainName, currentNickname: '', errorMessage: '' };
  }
  if (!discordUserId) {
    return { ok: false, changed: false, status: 'discord_user_missing', targetNickname: mainName, currentNickname: '', errorMessage: '' };
  }
  if (!mainName) {
    return { ok: false, changed: false, status: 'main_name_missing', targetNickname: '', currentNickname: '', errorMessage: '' };
  }

  const guildMember = await guild.members.fetch(discordUserId).catch(() => null);
  if (!guildMember) {
    return { ok: false, changed: false, status: 'member_not_found', targetNickname: mainName, currentNickname: '', errorMessage: '' };
  }

  const currentNickname = normalizeText(guildMember.nickname);
  if (currentNickname === mainName) {
    return { ok: true, changed: false, status: 'already_set', targetNickname: mainName, currentNickname, errorMessage: '' };
  }
  if (!guildMember.manageable) {
    return { ok: false, changed: false, status: 'not_manageable', targetNickname: mainName, currentNickname, errorMessage: '' };
  }

  try {
    await guildMember.setNickname(mainName, `Sync nickname to main: ${mainName}`);
    return { ok: true, changed: true, status: 'updated', targetNickname: mainName, currentNickname, errorMessage: '' };
  } catch (error) {
    return {
      ok: false,
      changed: false,
      status: 'failed',
      targetNickname: mainName,
      currentNickname,
      errorMessage: error?.message || String(error || ''),
    };
  }
}

function formatNicknameSyncLine(result, t) {
  const value = result && typeof result === 'object' ? result : {};
  const targetNickname = normalizeText(value.targetNickname);
  const key = `binding.nickname.${value.status || 'unchanged'}`;
  return t(key, {
    nickname: targetNickname,
    message: normalizeText(value.errorMessage),
  });
}

module.exports = {
  syncGuildMemberNicknameToMain,
  formatNicknameSyncLine,
};
