export function requiredQuery(result, name) {
  if (result.error) {
    // Do not convert a backend failure into an empty library or missing video.
    throw new Error(`ADP-DATA-001:${name}`)
  }
  return result.data
}
