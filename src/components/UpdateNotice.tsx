import { useEffect, useRef } from "react";
import { useLive } from "../hooks/useLive";
import { useToast } from "../store/toast";

/** Shows a short message once per new version found, pointing to Settings. Renders nothing itself. */
export function UpdateNotice() {
  const { data } = useLive(() => window.sidb.data.updates.status(), ["updates"]);
  const shown = useRef<string | null>(null);
  const version = data?.available ? data.latest?.version : undefined;
  useEffect(() => {
    if (!version || shown.current === version) return;
    shown.current = version;
    useToast.getState().show(`SIDB ${version} is available. Open Settings > About and updates to get it.`);
  }, [version]);
  return null;
}
