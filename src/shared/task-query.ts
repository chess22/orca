export type ParsedTaskQuery = {
  scope: 'all' | 'issue' | 'pr'
  state: 'open' | 'closed' | 'all' | 'merged' | null
  draft: boolean
  assignee: string | null
  author: string | null
  reviewRequested: string | null
  reviewedBy: string | null
  labels: string[]
  freeText: string
}

export function tokenizeSearchQuery(rawQuery: string): string[] {
  const tokens: string[] = []
  let index = 0

  while (index < rawQuery.length) {
    while (index < rawQuery.length && /\s/.test(rawQuery[index])) {
      index += 1
    }
    if (index >= rawQuery.length) {
      break
    }

    let token = ''
    let quote: '"' | "'" | null = null
    const startingQuote = rawQuery[index] === '"' || rawQuery[index] === "'"
    if (startingQuote) {
      quote = rawQuery[index] as '"' | "'"
      index += 1
    }

    while (index < rawQuery.length) {
      const char = rawQuery[index]
      if (quote) {
        if (char === quote) {
          quote = null
          index += 1
          if (startingQuote) {
            break
          }
          continue
        }
        token += char
        index += 1
        continue
      }
      if (/\s/.test(char)) {
        break
      }
      if (char === '"' || char === "'") {
        quote = char
        index += 1
        continue
      }
      token += char
      index += 1
    }

    if (token) {
      tokens.push(token)
    }
  }
  return tokens
}

export function parseTaskQuery(rawQuery: string): ParsedTaskQuery {
  const query: ParsedTaskQuery = {
    scope: 'all',
    state: null,
    draft: false,
    assignee: null,
    author: null,
    reviewRequested: null,
    reviewedBy: null,
    labels: [],
    freeText: ''
  }

  const freeTextTokens: string[] = []
  for (const token of tokenizeSearchQuery(rawQuery.trim())) {
    const normalized = token.toLowerCase()
    if (normalized === 'is:issue' || normalized === 'type:issue') {
      if (query.scope === 'pr') {
        continue
      }
      query.scope = 'issue'
      continue
    }
    if (
      normalized === 'is:pr' ||
      normalized === 'is:pull-request' ||
      normalized === 'type:pr' ||
      normalized === 'type:pull-request'
    ) {
      query.scope = query.scope === 'issue' ? 'all' : 'pr'
      continue
    }
    if (normalized === 'is:open' || normalized === 'state:open') {
      query.state = 'open'
      continue
    }
    if (normalized === 'is:closed' || normalized === 'state:closed') {
      query.state = 'closed'
      continue
    }
    if (normalized === 'is:merged' || normalized === 'state:merged') {
      query.state = 'merged'
      continue
    }
    if (normalized === 'state:all') {
      query.state = 'all'
      continue
    }
    if (normalized === 'is:draft' || normalized === 'draft:true') {
      query.scope = 'pr'
      query.state = 'open'
      query.draft = true
      continue
    }

    const [rawKey, ...rest] = token.split(':')
    const value = rest.join(':').trim()
    const key = rawKey.toLowerCase()
    if (!value) {
      freeTextTokens.push(token)
      continue
    }
    if (key === 'sort') {
      continue
    }

    if (key === 'assignee') {
      query.assignee = value
      continue
    }
    if (key === 'author') {
      query.author = value
      continue
    }
    if (key === 'review-requested') {
      query.scope = 'pr'
      query.reviewRequested = value
      continue
    }
    if (key === 'reviewed-by') {
      query.scope = 'pr'
      query.reviewedBy = value
      continue
    }
    if (key === 'label') {
      query.labels.push(value)
      continue
    }

    freeTextTokens.push(token)
  }

  query.freeText = freeTextTokens.join(' ').trim()
  return query
}

/**
 * Strip any `repo:owner/name` qualifiers from a raw search string.
 *
 * Why: in cross-repo mode the renderer fans the search out to each selected
 * repo via IPC. A stray `repo:` qualifier would pin every fan-out call to one
 * repo and silently zero out the others, so it must be removed before dispatch.
 * Tokens containing whitespace are re-quoted so quoted-label values like
 * `label:"needs review"` round-trip cleanly.
 */
export function stripRepoQualifiers(rawQuery: string): string {
  const kept: string[] = []
  for (const token of tokenizeSearchQuery(rawQuery.trim())) {
    if (/^repo:[^\s]+$/i.test(token)) {
      continue
    }
    if (/\s/.test(token)) {
      const [rawKey, ...rest] = token.split(':')
      if (rest.length > 0) {
        kept.push(`${rawKey}:"${rest.join(':')}"`)
      } else {
        kept.push(`"${token}"`)
      }
    } else {
      kept.push(token)
    }
  }
  return kept.join(' ')
}
