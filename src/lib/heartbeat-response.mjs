/** Parse the complete receipt without retaining raw response text in diagnostics. */
export async function readHeartbeatResponse(response) {
  const text = await response.text()
  return {
    contentType: response.headers.get('content-type') || '(missing)',
    data: JSON.parse(text),
  }
}
