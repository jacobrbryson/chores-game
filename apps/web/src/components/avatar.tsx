"use client";

import { CSSProperties, type ImgHTMLAttributes, type ReactNode, useEffect, useState } from "react";
import { resolveAvatarSrc, resolveInitial } from "@/lib/avatar/resolve";

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

function normalizeColorValue(value?: string) {
  return value?.trim().toLowerCase() ?? "";
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
  // Gracefully fall back to initials/fallback when the image fails to load (e.g. an
  // expired or referrer-blocked Google profile photo) instead of showing a broken image.
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [src]);
  const showImage = Boolean(src) && !imageFailed;
  const normalizedPrimaryColor = normalizeColorValue(primaryColor);
  const normalizedSecondaryColor = normalizeColorValue(secondaryColor);
  const resolvedSecondaryColor =
    !src && normalizedPrimaryColor && normalizedPrimaryColor === normalizedSecondaryColor
      ? `color-mix(in srgb, ${primaryColor} 72%, white)`
      : secondaryColor;
  const avatarStyle = {
    ...style,
    ...(size ? { "--avatar-size": `${size}px` } : {}),
    ...(borderWidth ? { "--avatar-border-width": `${borderWidth}px` } : {}),
    ...(primaryColor ? { "--avatar-primary": primaryColor } : {}),
    ...(resolvedSecondaryColor ? { "--avatar-secondary": resolvedSecondaryColor } : {}),
    ...(fallbackColor ? { "--avatar-fallback-color": fallbackColor } : {}),
  } as CSSProperties;

  return (
    <span
      className={joinClassNames("app-avatar", className)}
      style={avatarStyle}
      aria-hidden={ariaHidden ? true : undefined}
      aria-label={ariaHidden ? undefined : alt || `${name || "User"} avatar`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={joinClassNames("app-avatar-image", imageClassName)}
          src={src}
          alt={ariaHidden ? "" : alt || `${name || "User"} avatar`}
          loading={loading}
          decoding={decoding}
          referrerPolicy={referrerPolicy}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className={joinClassNames("app-avatar-fallback", fallbackClassName)}>
          {fallback ?? fallbackText}
        </span>
      )}
    </span>
  );
}
