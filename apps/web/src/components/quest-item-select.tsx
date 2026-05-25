"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Button } from "@/components/button";
import type { GameItem } from "@/lib/items/catalog";

type QuestItemSelectProps = {
  items: GameItem[];
  value: string;
  onChange: (value: string) => void;
};

const PLACEHOLDER_IMAGE = "/assets/items/placeholder.png";

export function QuestItemSelect({ items, value, onChange }: QuestItemSelectProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selectedItem = items.find((item) => item.id === value) ?? null;

  useEffect(() => {
    function closeOnOutsideInteraction(event: PointerEvent | FocusEvent) {
      const details = detailsRef.current;
      if (!details?.open || !event.target || details.contains(event.target as Node)) {
        return;
      }
      details.removeAttribute("open");
    }

    document.addEventListener("pointerdown", closeOnOutsideInteraction);
    document.addEventListener("focusin", closeOnOutsideInteraction);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideInteraction);
      document.removeEventListener("focusin", closeOnOutsideInteraction);
    };
  }, []);

  function selectValue(nextValue: string) {
    onChange(nextValue);
    detailsRef.current?.removeAttribute("open");
  }

  function onSummaryKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      detailsRef.current?.removeAttribute("open");
    }
  }

  return (
    <details ref={detailsRef} className="quest-item-select">
      <summary className="quest-item-select-trigger" onKeyDown={onSummaryKeyDown}>
        {selectedItem ? (
          <>
            <img src={selectedItem.image || PLACEHOLDER_IMAGE} alt="" className="quest-item-select-image" />
            <span className="quest-item-select-copy">
              <strong>{selectedItem.name}</strong>
              <small>{selectedItem.id}</small>
            </span>
          </>
        ) : (
          <span className="quest-item-select-empty">No required item</span>
        )}
      </summary>
      <div className="quest-item-select-menu" role="listbox" aria-label="Required item">
        <Button
          type="button"
          className={`quest-item-select-option${!value ? " selected" : ""}`}
          role="option"
          aria-selected={!value}
          onClick={() => selectValue("")}>
          <span className="quest-item-select-none" aria-hidden="true" />
          <span className="quest-item-select-copy">
            <strong>No required item</strong>
            <small>Any player can choose this</small>
          </span>
        </Button>
        {items.map((item) => (
          <Button
            key={item.id}
            type="button"
            className={`quest-item-select-option${item.id === value ? " selected" : ""}`}
            role="option"
            aria-selected={item.id === value}
            onClick={() => selectValue(item.id)}>
            <img src={item.image || PLACEHOLDER_IMAGE} alt="" className="quest-item-select-image" />
            <span className="quest-item-select-copy">
              <strong>{item.name}</strong>
              <small>{item.id}</small>
            </span>
          </Button>
        ))}
      </div>
    </details>
  );
}
