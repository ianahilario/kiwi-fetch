export function formatRelative(iso: string, now = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) {
    return iso
  }
  const diffMs = Math.max(0, now - then)
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  }
  const days = Math.round(hours / 24)
  if (days < 30) {
    return days === 1 ? '1 day ago' : `${days} days ago`
  }
  const months = Math.round(days / 30)
  if (months < 12) {
    return months === 1 ? '1 month ago' : `${months} months ago`
  }
  const years = Math.round(days / 365)
  return years === 1 ? '1 year ago' : `${years} years ago`
}

export function formatLocalDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}`
}

export function formatPulled(iso: string, now = Date.now()): string {
  return `last pulled ${formatRelative(iso, now)} (${formatLocalDateTime(iso)})`
}

export function formatAdded(iso: string, now = Date.now()): string {
  return `added ${formatRelative(iso, now)} (${formatLocalDateTime(iso)})`
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}
