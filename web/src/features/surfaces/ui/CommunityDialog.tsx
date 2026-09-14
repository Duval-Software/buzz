import { X, type LucideIcon, PanelsTopLeft } from "lucide-react";
import { useLayoutEffect, useId, useRef, type ReactNode } from "react";
import "./community-dialog.css";

/** Shared modal frame with native focus containment and opener restoration. */
export function CommunityDialog({
  children,
  label,
  description,
  icon: Icon = PanelsTopLeft,
  busy = false,
  onClose,
}: {
  children: ReactNode;
  label: string;
  description?: string;
  icon?: LucideIcon;
  busy?: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("[data-dialog-autofocus]")?.focus();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) onClose();
      }}
      className="hive-app hive-dialog"
    >
      <header className="hive-dialog-header">
        <span className="hive-dialog-icon">
          <Icon size={22} aria-hidden="true" />
        </span>
        <div>
          <h2 id={titleId}>{label}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <button
          className="hive-dialog-close"
          type="button"
          aria-label="Close"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="hive-dialog-body">{children}</div>
    </dialog>
  );
}
