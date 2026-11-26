// ADP_UPLOADS_ENABLED defaults closed; only the exact value true enables uploads.
export function uploadsEnabled(env = process.env) {
  return env.ADP_UPLOADS_ENABLED === 'true'
}
