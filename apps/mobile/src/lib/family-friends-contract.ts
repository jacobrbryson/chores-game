export const mobileFamilyFriendsPath = "/family-friends";

export function mobileFamilyFriendInvitationPath(inviteId: string) {
  return `${mobileFamilyFriendsPath}/invitations/${encodeURIComponent(inviteId)}`;
}

export function mobileFamilyFriendPath(familyId: string) {
  return `${mobileFamilyFriendsPath}/${encodeURIComponent(familyId)}`;
}

export const mobileFamilyFriendAwardCopyPath = `${mobileFamilyFriendsPath}/awards/copy`;

export function mobileFamilyFriendInviteRequest(email: string) {
  return { method: "POST", body: JSON.stringify({ email }) };
}

export function mobileFamilyFriendInvitationRequest(action: "accept" | "resend" | "cancel") {
  return action === "cancel"
    ? { method: "DELETE" }
    : { method: "POST", body: JSON.stringify({ action }) };
}

export function mobileFamilyFriendRemoveRequest() {
  return { method: "DELETE" };
}
