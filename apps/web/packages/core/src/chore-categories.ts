// Which chore Categories the chore editor should offer, given who the chore is
// assigned to. Shared by the web add/edit dialog and the mobile chore editor so
// the two never disagree about what a family sees.
//
// Rule: whole-family categories are always available; member-specific
// categories appear only when that member is among the assignees. Categories
// already selected on the chore stay visible so an existing selection is never
// silently dropped.

export type ChoreCategoryLike = {
  id: string;
  name: string;
  color?: string;
  memberIds?: string[];
  memberId?: string;
};

export function categoryMemberIds(category: ChoreCategoryLike): string[] {
  if (category.memberIds && category.memberIds.length > 0) {
    return category.memberIds;
  }
  return category.memberId ? [category.memberId] : [];
}

export function visibleChoreCategories<T extends ChoreCategoryLike>(input: {
  categories: T[];
  // Every member id in the family, used to tell a real member-scoped category
  // from one whose members have since left (those read as family-wide).
  familyMemberIds: string[];
  // Currently selected assignee ids, excluding any "family" sentinel option.
  selectedAssigneeIds: string[];
  selectedCategoryIds: string[];
}): T[] {
  const familyIds = new Set(input.familyMemberIds);
  const assigneeIds = new Set(input.selectedAssigneeIds);
  const selectedIds = new Set(input.selectedCategoryIds);
  return input.categories.filter((category) => {
    const memberIds = categoryMemberIds(category);
    const isFamilyWide =
      memberIds.length === 0 || memberIds.every((memberId) => !familyIds.has(memberId));
    return (
      isFamilyWide ||
      memberIds.some((memberId) => assigneeIds.has(memberId)) ||
      selectedIds.has(category.id)
    );
  });
}

// Case-insensitive substring filter for the category picker's search box. Kept
// here so mobile's inline search and any future web search behave identically.
export function filterChoreCategoriesByQuery<T extends ChoreCategoryLike>(
  categories: T[],
  query: string,
): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return categories;
  }
  return categories.filter((category) => category.name.toLowerCase().includes(normalized));
}
