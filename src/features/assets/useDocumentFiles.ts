import { useEffect, useState } from "react";
import type { Attachment } from "../../../shared/model";
import { getAttachments } from "../../lib/api";
import { errorMessage } from "../search/domain";

export function useDocumentFiles(recordId?: string, refreshKey?: string) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setFiles([]);
    setError("");
    if (!recordId || recordId.startsWith("offline-")) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void getAttachments(recordId)
      .then((next) => {
        if (active) setFiles(next);
      })
      .catch((failure) => {
        if (active) setError(errorMessage(failure));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [recordId, refreshKey, revision]);
  return {
    files,
    error,
    loading,
    reload: () => setRevision((value) => value + 1),
  };
}
