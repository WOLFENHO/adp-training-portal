/** Parse the complete receipt; truncate only the copy used for diagnostics. */
export async function readHeartbeatResponse(response) {
  const text = await response.text()
  return {
    contentType: response.headers.get('content-type') || '(missing)',
    rawBody: text.slice(0, 1600),
    data: JSON.parse(text),
  }
}
