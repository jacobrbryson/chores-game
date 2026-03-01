"use client";

import { CSSProperties, type ImgHTMLAttributes, type ReactNode } from "react";

type AvatarProps = {
  name?: string;
  initial?: string;
  avatarId?: string;
  photoUrl?: string;
  alt?: string;
  size?: number;
  borderWidth?: number;
  primaryColor?: string;
  secondaryColor?: string;
  fallbackColor?: string;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
  ariaHidden?: boolean;
  referrerPolicy?: ImgHTMLAttributes<HTMLImageElement>["referrerPolicy"];
  loading?: ImgHTMLAttributes<HTMLImageElement>["loading"];
  decoding?: ImgHTMLAttributes<HTMLImageElement>["decoding"];
  style?: CSSProperties;
  fallback?: ReactNode;
};

function joinClassNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

function resolveAvatarSrc(avatarId?: string, photoUrl?: string) {
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

function resolveInitial(name?: string, initial?: string) {
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

export function Avatar({
  name,
  initial,
  avatarId,
  photoUrl,
  alt,
  size,
  borderWidth,
  primaryColor,
  secondaryColor,
  fallbackColor,
  className,
  imageClassName,
  fallbackClassName,
  ariaHidden = false,
  referrerPolicy,
  loading = "lazy",
  decoding = "async",
  style,
  fallback,
}: AvatarProps) {
  const src = resolveAvatarSrc(avatarId, photoUrl);
  const fallbackText = resolveInitial(name, initial);
  const avatarStyle = {
    ...style,
    ...(size ? { "--avatar-size": `${size}px` } : {}),
    ...(borderWidth ? { "--avatar-border-width": `${borderWidth}px` } : {}),
    ...(primaryColor ? { "--avatar-primary": primaryColor } : {}),
    ...(secondaryColor ? { "--avatar-secondary": secondaryColor } : {}),
    ...(fallbackColor ? { "--avatar-fallback-color": fallbackColor } : {}),
  } as CSSProperties;

  return (
    <span
      className={joinClassNames("app-avatar", className)}
      style={avatarStyle}
      aria-hidden={ariaHidden ? true : undefined}
      aria-label={ariaHidden ? undefined : alt || `${name || "User"} avatar`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={joinClassNames("app-avatar-image", imageClassName)}
          src={src}
          alt={ariaHidden ? "" : alt || `${name || "User"} avatar`}
          loading={loading}
          decoding={decoding}
          referrerPolicy={referrerPolicy}
        />
      ) : (
        <span className={joinClassNames("app-avatar-fallback", fallbackClassName)}>
          {fallback ?? fallbackText}
        </span>
      )}
    </span>
  );
}
