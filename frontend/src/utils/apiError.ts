// Pulls a human-readable message out of an Axios-style error, falling back to a
// caller-supplied default. Centralised so the `{ response: { data: { message } } }`
// shape lives in one place — if the API error envelope ever changes, only this
// helper needs updating instead of every catch block.
export function getApiErrorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { message?: string } } }).response?.data?.message || fallback;
}
