import type { ReactNode } from "react";
import { useAppLock } from "../preferences/AppLockContext.tsx";
import { LocalContentUnlockGate } from "./LocalContentUnlockGate.tsx";

export function LocalContentBoundary({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const { localContentLocked } = useAppLock();
  return localContentLocked ? <LocalContentUnlockGate /> : <>{children}</>;
}
