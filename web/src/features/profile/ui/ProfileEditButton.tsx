import { lazy, Suspense, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const ProfileEditor = lazy(() =>
  import("./ProfileEditor").then((module) => ({
    default: module.ProfileEditor,
  })),
);

/** Open the same editor from account settings, profile cards and public profiles. */
export function ProfileEditButton({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <Suspense>
            <ProfileEditor onClose={() => setOpen(false)} />
          </Suspense>,
          document.body,
        )}
    </>
  );
}
