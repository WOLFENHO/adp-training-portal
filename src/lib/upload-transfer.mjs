/** Retry only the existing direct-upload target; no database or Mux target creation. */
export async function transferExistingUpload(pending, fetcher = fetch) {
  const response = await fetcher(pending.uploadUrl, {
    method: 'PUT', body: pending.file,
    headers: { 'content-type': pending.file.type || 'application/octet-stream' },
  })
  if (!response.ok) throw new Error(`Video transfer failed (HTTP ${response.status}). Retry the existing upload target.`)
}
