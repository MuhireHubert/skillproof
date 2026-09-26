// Central place for environment configuration. Nothing else reads process.env.
export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 8787),
    databaseUrl: env.DATABASE_URL,
    // Supabase signs user tokens with either a shared secret (HS256) or a JWKS endpoint.
    jwtSecret: env.SUPABASE_JWT_SECRET,
    jwksUrl: env.SUPABASE_JWKS_URL,
    supabaseUrl: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5',
    atUsername: env.AT_USERNAME,
    atApiKey: env.AT_API_KEY,
    atSenderId: env.AT_SENDER_ID,
    resendApiKey: env.RESEND_API_KEY,
    emailFrom: env.EMAIL_FROM || 'SkillProof <no-reply@example.com>',
    corsOrigin: (env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
    ussdSecret: env.USSD_SHARED_SECRET,
    enableJobs: env.ENABLE_JOBS === 'true',
  };
}
