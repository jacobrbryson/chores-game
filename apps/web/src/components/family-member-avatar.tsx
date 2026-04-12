"use client";

import { Avatar } from "@/components/avatar";

type FamilyMemberAvatarProps = {
  name: string;
  avatarId?: string;
  avatarPhotoUrl?: string;
  primaryColor?: string;
  size?: number;
  borderWidth?: number;
  className?: string;
  ariaHidden?: boolean;
};

export function FamilyMemberAvatar({
  name,
  avatarId,
  avatarPhotoUrl,
  primaryColor,
  size = 32,
  borderWidth = 1,
  className,
  ariaHidden = false,
}: FamilyMemberAvatarProps) {
  const resolvedPrimaryColor = primaryColor?.trim() || undefined;

  return (
    <Avatar
      className={className}
      size={size}
      borderWidth={borderWidth}
      name={name}
      avatarId={avatarId}
      photoUrl={avatarPhotoUrl}
      primaryColor={resolvedPrimaryColor}
      secondaryColor={resolvedPrimaryColor}
      fallbackColor={resolvedPrimaryColor ? "#ffffff" : undefined}
      ariaHidden={ariaHidden}
      referrerPolicy="no-referrer"
    />
  );
}
