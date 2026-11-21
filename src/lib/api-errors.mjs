const sessionErrors = {
  'not authorized': { status: 403, code: 'forbidden', errorId: 'ADP-AUTH-003' },
  session_expired: { status: 409, code: 'session_expired', errorId: 'ADP-PRG-002' },
  session_inactive: { status: 409, code: 'session_inactive', errorId: 'ADP-PRG-003' },
  training_locked: { status: 403, code: 'training_locked', errorId: 'ADP-PRG-011' },
}

export function safeSessionRpcError(error) {
  return sessionErrors[error?.message] ?? { status: 503, code: 'session_unavailable', errorId: 'ADP-PRG-004' }
}

export function sameOriginMutation(request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}

export function sanitizeHeartbeatRejection(data, correlationId) {
  const code = typeof data?.code === 'string' && /^[a-z_]{1,48}$/.test(data.code) ? data.code : 'heartbeat_rejected'
  const receipt = { accepted: false, code, error: 'Playback event was not accepted.', errorId: 'ADP-PRG-006', correlationId }
  for (const key of ['version', 'lastEventSequence', 'currentLastEventSequence']) {
    if (Number.isSafeInteger(data?.[key]) && data[key] >= 0) receipt[key] = data[key]
  }
  for (const key of ['acceptedPosition', 'currentAcceptedPosition']) {
    if (typeof data?.[key] === 'number' && Number.isFinite(data[key]) && data[key] >= 0) receipt[key] = data[key]
  }
  for (const key of ['serverIsPlaying', 'currentServerIsPlaying']) {
    if (typeof data?.[key] === 'boolean') receipt[key] = data[key]
  }
  return receipt
}
