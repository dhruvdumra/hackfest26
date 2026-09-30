export function formatErrorMessage(requestError, fallback) {
  if (requestError instanceof Error && requestError.message) {
    return requestError.message
  }

  return fallback
}

export function asText(value, fallback) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  return fallback
}

export function asCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

export function asList(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim())
    : []
}
