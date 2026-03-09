"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import type { FamilyCategory } from "@/lib/family/types";

type ChoreCategoriesChipProps = {
  categories?: FamilyCategory[];
  className?: string;
  emptyLabel?: string;
};

function toSafeHexColor(value: string | undefined) {
  if (!value) {
    return "#64748b";
  }
  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : "#64748b";
}

export function ChoreCategoriesChip({
  categories = [],
  className = "",
  emptyLabel = "-",
}: ChoreCategoriesChipProps) {
  const [expanded, setExpanded] = useState(false);

  if (categories.length === 0) {
    return <span className={`chore-category-empty${className ? ` ${className}` : ""}`}>{emptyLabel}</span>;
  }

  const tooltip = categories.map((category) => category.name).join(", ");
  const firstCategory = categories[0];
  const additionalCount = Math.max(0, categories.length - 1);

  return (
    <button
      type="button"
      title={tooltip}
      className={`chore-category-toggle${expanded ? " is-expanded" : ""}${
        className ? ` ${className}` : ""
      }`}
      onClick={() => setExpanded((current) => !current)}>
      {expanded ? (
        <span className="chore-category-pill-list">
          {categories.map((category) => (
            <span
              key={category.id}
              className="chore-category-pill"
              style={
                {
                  "--category-color": toSafeHexColor(category.color),
                } as CSSProperties
              }>
              [{category.name}]
            </span>
          ))}
        </span>
      ) : (
        <span
          className="chore-category-pill"
          style={
            {
              "--category-color": toSafeHexColor(firstCategory?.color),
            } as CSSProperties
          }>
          [{firstCategory?.name}]
          {additionalCount > 0 ? ` +${additionalCount}` : ""}
        </span>
      )}
    </button>
  );
}

