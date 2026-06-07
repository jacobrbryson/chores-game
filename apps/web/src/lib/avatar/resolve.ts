// Pure, framework-agnostic avatar resolution shared by the in-app <Avatar />
// component and server-side consumers that can't render React (e.g. HTML email
// templates). Keep this free of "use client" / React imports.

export function resolveAvatarSrc(avatarId?: string, photoUrl?: string) {
  const trimmedAvatarId = avatarId?.trim() ?? "";
  if (trimmedAvatarId) {
    return `/avatars/default/${encodeURIComponent(trimmedAvatarId)}`;
  }
  const trimmedPhotoUrl = photoUrl?.trim() ?? "";
  if (trimmedPhotoUrl) {
    return trimmedPhotoUrl;
  }
  return "";
}

export function resolveInitial(name?: string, initial?: string) {
  const fromInitial = initial?.trim().charAt(0).toUpperCase();
  if (fromInitial) {
    return fromInitial;
  }
  const fromName = name?.trim().charAt(0).toUpperCase();
  if (fromName) {
    return fromName;
  }
  return "?";
}
