export interface LocalDraft {
  version: 1
  content: string
  savedAt: string
  baseUpdatedAt?: string
}

const PUBLISH_DRAFT_KEY = "moments:draft:publish:v1"

export function publishDraftKey(): string {
  return PUBLISH_DRAFT_KEY
}

export function editDraftKey(id: string): string {
  return `moments:draft:edit:${id}:v1`
}

export function readDraft(key: string): LocalDraft | null {
  try {
    const value = window.localStorage.getItem(key)
    if (!value) return null
    const parsed: unknown = JSON.parse(value)
    if (
      typeof parsed !== "object"
      || parsed === null
      || !("version" in parsed)
      || parsed.version !== 1
      || !("content" in parsed)
      || typeof parsed.content !== "string"
      || !("savedAt" in parsed)
      || typeof parsed.savedAt !== "string"
    ) return null
    return parsed as LocalDraft
  } catch {
    return null
  }
}

export function writeDraft(
  key: string,
  content: string,
  baseUpdatedAt?: string
): boolean {
  try {
    const value: LocalDraft = {
      version: 1,
      content,
      savedAt: new Date().toISOString(),
      ...(baseUpdatedAt ? { baseUpdatedAt } : {}),
    }
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeDraft(key: string): boolean {
  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}
