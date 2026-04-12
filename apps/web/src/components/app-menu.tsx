"use client";

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/button";

type AppMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  triggerClassName: string;
  triggerTitle?: string;
  triggerAriaLabel?: string;
  triggerDisabled?: boolean;
  wrapperClassName?: string;
  panelClassName?: string;
  children: ReactNode;
  offset?: number;
};

type MenuPosition = {
  top: number;
  left: number;
};

const VIEWPORT_MARGIN = 12;

export function AppMenu({
  open,
  onOpenChange,
  trigger,
  triggerClassName,
  triggerTitle,
  triggerAriaLabel,
  triggerDisabled = false,
  wrapperClassName = "",
  panelClassName = "",
  children,
  offset = 8,
}: AppMenuProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ top: 0, left: 0 });
  const [positionReady, setPositionReady] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setPositionReady(false);
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    function updatePosition() {
      const triggerElement = triggerRef.current;
      const panelElement = panelRef.current;
      if (!triggerElement || !panelElement) {
        return;
      }

      const triggerRect = triggerElement.getBoundingClientRect();
      const panelRect = panelElement.getBoundingClientRect();

      if (panelRect.width <= 0 || panelRect.height <= 0) {
        setPositionReady(false);
        return;
      }

      let left = triggerRect.right - panelRect.width;
      let top = triggerRect.bottom + offset;

      left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - panelRect.width - VIEWPORT_MARGIN));

      if (top + panelRect.height > window.innerHeight - VIEWPORT_MARGIN) {
        top = triggerRect.top - panelRect.height - offset;
      }

      top = Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - panelRect.height - VIEWPORT_MARGIN));

      setPosition({ top, left });
      setPositionReady(true);
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      onOpenChange(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }

    const animationFrameId = window.requestAnimationFrame(updatePosition);
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            updatePosition();
          })
        : null;

    if (resizeObserver) {
      if (triggerRef.current) {
        resizeObserver.observe(triggerRef.current);
      }
      if (panelRef.current) {
        resizeObserver.observe(panelRef.current);
      }
    }

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [offset, onOpenChange, open]);

  return (
    <>
      <div className={wrapperClassName}>
        <Button
          ref={triggerRef}
          type="button"
          className={triggerClassName}
          disabled={triggerDisabled}
          onClick={() => onOpenChange(!open)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={triggerAriaLabel}
          title={triggerTitle}>
          {trigger}
        </Button>
      </div>
      {mounted && open
        ? createPortal(
            <div
              ref={panelRef}
              className={panelClassName}
              role="menu"
              style={{
                position: "fixed",
                top: `${position.top}px`,
                left: `${position.left}px`,
                visibility: positionReady ? "visible" : "hidden",
              }}>
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
