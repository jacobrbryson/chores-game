export type FamilySnapshotMember = {
  id: string;
  uid?: string;
  name: string;
  email: string;
  role: "admin" | "player";
  status: "active" | "invited";
  lastSignInAt?: string;
};

export type FamilySnapshotChore = {
  id: string;
  title: string;
  status: "Open" | "Submitted" | "Approved" | "Rejected" | "Unknown";
  assigneeName: string;
  dueDate: string;
  coinValue: number;
};

export type FamilySummaryResponse = {
  viewerUid: string;
  noFamily: boolean;
  family: null | {
    id: string;
    name: string;
  };
  members: FamilySnapshotMember[];
  choresToday: FamilySnapshotChore[];
};
