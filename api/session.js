// GET /api/session
// Returns the currently logged-in user (from the session cookie), or
// { loggedIn: false } if there isn't one / it's invalid or expired.
import { getSessionUser, effectiveRole } from './_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(200).json({ loggedIn: false });

    const role = effectiveRole(user);

    res.status(200).json({
      loggedIn: true,
      discordUsername: user.discord_username,
      email: user.email,
      avatarUrl: user.avatar_url,
      robloxUsername: user.roblox_username || null,
      robloxVerified: !!user.roblox_id,
      role,
      isAdmin: role === 'admin',
      isStaff: role === 'staff',
      blocked: !!user.blocked,
      blockedReason: user.blocked ? user.blocked_reason || '' : ''
    });
  } catch (err) {
    res.status(200).json({ loggedIn: false });
  }
}
