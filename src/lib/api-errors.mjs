const sessionErrors = {
  'not authorized': { status: 403, code: 'forbidden', errorId: 'ADP-AUTH-003' },
  session_expired: { status: 409, code: 'session_expired', errorId: 'ADP-PRG-002' },
  session_inactive: { status: 409, code: 'session_inactive', errorId: 'ADP-PRG-003' },
}

export function safeSessionRpcError(error) {
  return sessionErrors[error?.message] ?? { status: 503, code: 'session_unavailable', errorId: 'ADP-PRG-004' }
}

export function sameOriginMutation(request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}
