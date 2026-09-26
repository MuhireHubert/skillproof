import { jwtVerify, createRemoteJWKSet } from 'jose';

// Verifies Supabase access tokens. Use SUPABASE_JWT_SECRET (HS256) or SUPABASE_JWKS_URL.
export function createAuth(config) {
  let verifyKey;
  if (config.jwksUrl) verifyKey = createRemoteJWKSet(new URL(config.jwksUrl));
  else if (config.jwtSecret) verifyKey = new TextEncoder().encode(config.jwtSecret);

  return async function requireUser(req, res, next) {
    try {
      if (!verifyKey) return res.status(503).json({ error: 'Authentication is not configured' });
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) return res.status(401).json({ error: 'Sign in required' });
      const { payload } = await jwtVerify(token, verifyKey, { audience: 'authenticated' });
      if (!payload.sub) return res.status(401).json({ error: 'Invalid token' });
      req.user = { id: payload.sub, email: String(payload.email || '').toLowerCase() };
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired session' });
    }
  };
}
