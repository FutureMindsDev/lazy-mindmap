import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface NativeDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}

/**
 * Native <dialog> wrapper following modern-web-guidance:
 * - Uses showModal() without redundant role="dialog" or aria-modal
 * - Uses closedby="any" with Safari pointerdown/pointerup fallback
 * - Resets dialog.returnValue = '' on close
 */
export function NativeDialog({ open, onClose, title, children, maxWidth }: NativeDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = "";
      onClose();
    };
    dialog.addEventListener("close", handleClose);

    // Safari fallback for closedby="any"
    let cleanupOutside: (() => void) | undefined;
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      const onPointerDown = (e: PointerEvent) => {
        if (dialog.open) pressedOutside = isOutside(e);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (dialog.open && pressedOutside && isOutside(e)) {
          dialog.close();
        }
        pressedOutside = false;
      };
      dialog.addEventListener("pointerdown", onPointerDown);
      dialog.addEventListener("pointerup", onPointerUp);
      cleanupOutside = () => {
        dialog.removeEventListener("pointerdown", onPointerDown);
        dialog.removeEventListener("pointerup", onPointerUp);
      };
    }

    return () => {
      dialog.removeEventListener("close", handleClose);
      cleanupOutside?.();
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="mf-dialog"
      aria-labelledby={titleId}
      style={maxWidth ? { maxWidth } : undefined}
      {...({ closedby: "any" } as Record<string, string>)}
    >
      <div className="mf-dialog-header">
        <h2 id={titleId}>{title}</h2>
        <form method="dialog">
          <button
            type="submit"
            value="close"
            className="mf-btn"
            aria-label={`Close ${title}`}
            autoFocus
          >
            <X size={18} aria-hidden="true" />
          </button>
        </form>
      </div>
      <div className="mf-dialog-body">{children}</div>
    </dialog>
  );
}
