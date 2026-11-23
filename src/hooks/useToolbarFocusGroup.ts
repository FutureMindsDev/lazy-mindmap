import { useEffect, type RefObject } from "react";

/**
 * Installs a roving-tabindex fallback on a role="toolbar" container only when
 * native CSS/HTML `focusgroup` is unsupported by the browser.
 */
export function useToolbarFocusGroup(toolbarRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const bar = toolbarRef.current;
    if (!bar || "focusGroup" in HTMLElement.prototype) return;

    const getItems = () =>
      Array.from(bar.querySelectorAll<HTMLElement>("button, select"));

    const items = getItems();
    items.forEach((el, i) => {
      el.tabIndex = i === 0 ? 0 : -1;
    });

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      const currentItems = getItems();
      if (currentItems.includes(target)) {
        currentItems.forEach((el) => {
          el.tabIndex = el === target ? 0 : -1;
        });
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key !== "ArrowLeft" &&
        e.key !== "ArrowRight" &&
        e.key !== "Home" &&
        e.key !== "End"
      ) {
        return;
      }
      const currentItems = getItems();
      const idx = currentItems.indexOf(document.activeElement as HTMLElement);
      if (idx === -1) return;

      e.preventDefault();
      const rtl = getComputedStyle(bar).direction === "rtl";
      let nextIdx = idx;
      if (e.key === "Home") nextIdx = 0;
      else if (e.key === "End") nextIdx = currentItems.length - 1;
      else if (e.key === "ArrowRight") {
        nextIdx = (idx + (rtl ? -1 : 1) + currentItems.length) % currentItems.length;
      } else if (e.key === "ArrowLeft") {
        nextIdx = (idx + (rtl ? 1 : -1) + currentItems.length) % currentItems.length;
      }

      currentItems[nextIdx]?.focus();
    };

    bar.addEventListener("focusin", onFocusIn);
    bar.addEventListener("keydown", onKeyDown);
    return () => {
      bar.removeEventListener("focusin", onFocusIn);
      bar.removeEventListener("keydown", onKeyDown);
    };
  }, [toolbarRef]);
}
