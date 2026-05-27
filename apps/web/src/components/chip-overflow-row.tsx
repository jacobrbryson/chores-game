"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { MenuActionButton } from "@/components/menu-action-button";

export type ChipOverflowItem = {
  id: string;
  label: string;
  active?: boolean;
  onSelect: () => void;
};

type ChipOverflowRowProps = {
  items: ChipOverflowItem[];
  maxVisible?: number;
};

export function ChipOverflowRow({ items, maxVisible = 3 }: ChipOverflowRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const visibleItems = useMemo(() => items.slice(0, maxVisible), [items, maxVisible]);
  const overflowItems = useMemo(() => items.slice(maxVisible), [items, maxVisible]);
  const overflowActive = overflowItems.some((item) => item.active);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (!target || containerRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [menuOpen]);

  return (
    <div className="chip-overflow-row" ref={containerRef}>
      <div className="chip-overflow-row-main">
        {visibleItems.map((item) => (
          <Button
            key={item.id}
            type="button"
            className={item.active ? "btn btn-primary" : "btn btn-secondary"}
            onClick={item.onSelect}>
            {item.label}
          </Button>
        ))}
        {overflowItems.length > 0 ? (
          <div className="chip-overflow-menu-anchor">
            <Button
              type="button"
              aria-expanded={menuOpen}
              className={menuOpen || overflowActive ? "btn btn-primary" : "btn btn-secondary"}
              onClick={() => setMenuOpen((current) => !current)}>
              +{overflowItems.length} more...
            </Button>
            {menuOpen ? (
              <div className="chip-overflow-menu" role="menu">
                {overflowItems.map((item) => (
                  <MenuActionButton
                    key={item.id}
                    fullWidth
                    className={item.active ? "chip-overflow-menu-item-active" : ""}
                    onClick={() => {
                      setMenuOpen(false);
                      item.onSelect();
                    }}>
                    {item.label}
                  </MenuActionButton>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
