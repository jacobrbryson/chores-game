import { randomUUID } from "node:crypto";
import {
  boolField,
  createOrReplaceDocument,
  integerField,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";

type SeedStarterContentInput = {
  familyId: string;
  uid: string;
  userName: string;
  idToken: string;
};

type StarterCategory = {
  key: string;
  name: string;
  color: string;
};

type StarterChore = {
  title: string;
  details: string;
  coinValue: number;
  categoryKeys: string[];
  // Optional in-app deep link surfaced on the dashboard card so the parent can
  // jump straight to the page each getting-started task references.
  actionHref?: string;
  actionLabel?: string;
};

// Lightweight, editable starter content so a brand-new family lands on a live
// dashboard instead of an empty room. Everything here is ordinary family data
// (not UI copy): parents can edit, reassign, or delete any of it immediately.
// Seeded in DEFAULT_LOCALE (en-US); families on other locales can adjust freely.
const STARTER_CATEGORIES: StarterCategory[] = [
  { key: "getting_started", name: "Getting Started", color: "#6366f1" },
  { key: "kitchen", name: "Kitchen", color: "#f97316" },
  { key: "bedroom", name: "Bedroom", color: "#3b82f6" },
  { key: "outdoor", name: "Outdoor", color: "#22c55e" },
];

// A guided getting-started checklist disguised as chores. Completing each one
// walks the new parent through the core of the app and earns coins along the way
// (so the final "purchase an item" task is actually affordable).
const STARTER_CHORES: StarterChore[] = [
  {
    title: "Add a family member",
    details: "Open the Family page and add your first child or co-parent.",
    coinValue: 10,
    categoryKeys: ["getting_started"],
    actionHref: "/family",
    actionLabel: "Open Family",
  },
  {
    title: "Assign your first chore",
    details: "Create a chore and assign it to a family member.",
    coinValue: 10,
    categoryKeys: ["getting_started"],
  },
  {
    title: "Create a family award",
    details: "Add a custom reward kids can redeem with coins from the Family page.",
    coinValue: 10,
    categoryKeys: ["getting_started"],
    actionHref: "/family?tab=awards",
    actionLabel: "Open Awards",
  },
  {
    title: "Sync with Google Tasks",
    details: "Link Google from your Profile to sync chores with Google Tasks.",
    coinValue: 10,
    categoryKeys: ["getting_started"],
    actionHref: "/profile?tab=integrations",
    actionLabel: "Open Integrations",
  },
  {
    title: "Purchase an item in the store",
    details: "Spend the coins you just earned on a theme, avatar, or confetti.",
    coinValue: 10,
    categoryKeys: ["getting_started"],
    actionHref: "/store",
    actionLabel: "Open Store",
  },
];

const STARTER_REWARD = {
  description: "Extra screen time (30 minutes)",
  coinCost: 50,
  imageId: "screen_time",
};

/**
 * Seeds starter categories, chores, and one family reward for a freshly created
 * family. Best-effort: failures are swallowed by the caller so a seeding hiccup
 * never blocks the user's first sign-in.
 */
export async function seedStarterContent({
  familyId,
  uid,
  userName,
  idToken,
}: SeedStarterContentInput) {
  const now = new Date().toISOString();
  const assigneeName = userName || "Parent";

  const categoryIdByKey = new Map<string, string>();
  await Promise.all(
    STARTER_CATEGORIES.map((category) => {
      const categoryId = randomUUID();
      categoryIdByKey.set(category.key, categoryId);
      return createOrReplaceDocument(
        `families/${familyId}/categories/${categoryId}`,
        {
          name: stringField(category.name),
          color: stringField(category.color),
          deleted: boolField(false),
          createdBy: stringField(uid),
          createdAt: timestampField(now),
          updatedAt: timestampField(now),
        },
        idToken,
      );
    }),
  );

  await Promise.all(
    STARTER_CHORES.map((chore, index) => {
      const choreId = randomUUID();
      const categoryIds = chore.categoryKeys
        .map((key) => categoryIdByKey.get(key) ?? "")
        .filter(Boolean);
      return createOrReplaceDocument(
        `families/${familyId}/chores/${choreId}`,
        {
          title: stringField(chore.title),
          choreType: stringField("normal"),
          status: stringField("Open"),
          assigneeId: stringField(uid),
          assigneeIds: stringArrayField([uid]),
          assigneeScope: stringField("single"),
          assigneeName: stringField(assigneeName),
          details: stringField(chore.details),
          categoryIds: stringArrayField(categoryIds),
          dueDate: stringField(""),
          coinValue: integerField(chore.coinValue),
          requireApproval: boolField(false),
          recurrenceType: stringField("none"),
          recurrenceInterval: integerField(0),
          recurrenceUnit: stringField(""),
          deleted: boolField(false),
          createdBy: stringField(uid),
          createdAt: timestampField(now),
          sortOrder: integerField(index),
          source: stringField("manual"),
          actionHref: stringField(chore.actionHref ?? ""),
          actionLabel: stringField(chore.actionLabel ?? ""),
        },
        idToken,
      );
    }),
  );

  const rewardId = randomUUID();
  await createOrReplaceDocument(
    `families/${familyId}/rewards/${rewardId}`,
    {
      description: stringField(STARTER_REWARD.description),
      coinCost: integerField(STARTER_REWARD.coinCost),
      imageId: stringField(STARTER_REWARD.imageId),
      individualLimit: integerField(0),
      familyLimit: integerField(0),
      familyRedeemedCount: integerField(0),
      disabled: boolField(false),
      deleted: boolField(false),
      createdBy: stringField(uid),
      createdAt: timestampField(now),
      updatedAt: timestampField(now),
    },
    idToken,
  );
}
