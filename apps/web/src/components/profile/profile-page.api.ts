export async function postStoreAction(body: Record<string, unknown>, errorPrefix: string) {
  const response = await fetch("/api/store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? `${errorPrefix}_${response.status}`);
  }
}

export async function postGoogleTasksAction(body: Record<string, unknown>) {
  const response = await fetch("/api/google-tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? `GOOGLE_TASKS_ACTION_HTTP_${response.status}`);
  }
}

export async function patchProfileAction(body: Record<string, unknown>) {
  const response = await fetch("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { error?: string; name?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `PROFILE_ACTION_HTTP_${response.status}`);
  }
  return payload;
}
