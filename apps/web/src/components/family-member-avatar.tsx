"use client";

import { Avatar } from "@/components/avatar";
import { DEFAULT_MEMBER_PRIMARY_COLOR } from "@/lib/theme/member-primary-color";

type FamilyMemberAvatarProps = {
  name: string;
  avatarId?: string;
  avatarPhotoUrl?: string;
  primaryColor?: string;
  size?: number;
  borderWidth?: number;
  className?: string;
  ariaHidden?: boolean;
  isFamily?: boolean;
};

export function FamilyAvatarIcon() {
  return (
    <svg
      className="app-avatar-family-icon"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      <circle cx="7" cy="7" r="2" />
      <circle cx="13.25" cy="8" r="1.75" />
      <path d="M3.75 15a3.5 3.5 0 0 1 6.5 0" />
      <path d="M11 14.75a3 3 0 0 1 5-.75" />
    </svg>
  );
}

export function FamilyMemberAvatar({
  name,
  avatarId,
  avatarPhotoUrl,
  primaryColor,
  size = 32,
  borderWidth = 1,
  className,
  ariaHidden = false,
  isFamily = false,
}: FamilyMemberAvatarProps) {
  const resolvedPrimaryColor = primaryColor?.trim() || (isFamily ? DEFAULT_MEMBER_PRIMARY_COLOR : undefined);
  const resolvedFallbackColor = resolvedPrimaryColor ? "#ffffff" : undefined;

  return (
    <Avatar
      className={className}
      size={size}
      borderWidth={borderWidth}
      name={name}
      avatarId={isFamily ? undefined : avatarId}
      photoUrl={isFamily ? undefined : avatarPhotoUrl}
      primaryColor={resolvedPrimaryColor}
      secondaryColor={resolvedPrimaryColor}
      fallbackColor={resolvedFallbackColor}
      fallback={isFamily ? <FamilyAvatarIcon /> : undefined}
      ariaHidden={ariaHidden}
      referrerPolicy="no-referrer"
    />
  );
}
