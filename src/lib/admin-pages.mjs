/** Explicitly fetch every dashboard row; fail closed on an inconsistent scan. */
export async function collectPages(fetchPage, pageSize = 500, maximumRows = 20000) {
  const rows = []
  let total = null
  for (let from = 0; from <= maximumRows; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1)
    if (page.error || !Array.isArray(page.data) || !Number.isSafeInteger(page.count)) throw new Error('dashboard query failed')
    if (total === null) total = page.count
    else if (page.count !== total) throw new Error('dashboard changed during pagination')
    rows.push(...page.data)
    if (rows.length > maximumRows) throw new Error('dashboard result exceeds safe limit')
    if (rows.length >= total) {
      if (rows.length !== total) throw new Error('dashboard changed during pagination')
      return rows
    }
    if (page.data.length !== pageSize) throw new Error('dashboard query truncated a page')
  }
  throw new Error('dashboard result exceeds safe limit')
}
