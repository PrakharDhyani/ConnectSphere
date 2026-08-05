/**
 * Staging area for chat attachments before they're sent.
 *
 * Flow: pick/drop/paste files → they appear as local previews immediately
 * (object URLs, so there's no wait) → `upload()` POSTs them to
 * /rooms/:id/attachments and returns storage descriptors → the caller puts
 * those on ONE `message:send`. Uploading separately from sending keeps binary
 * data off the socket and means a failed upload never leaves a half-message.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api.js";

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // must match the backend cap
export const MAX_FILES = 10;

let nextId = 1;

export function useChatUploads(roomId) {
  const [staged, setStaged] = useState([]); // [{ id, file, previewUrl, kind }]
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  // Object URLs must be revoked or the blobs leak for the tab's lifetime. A ref
  // lets the unmount cleanup see every URL ever created without re-running.
  const urls = useRef(new Set());

  useEffect(
    () => () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current.clear();
    },
    []
  );

  const add = useCallback((fileList) => {
    const incoming = [...fileList];
    if (!incoming.length) return;
    setError(null);

    setStaged((prev) => {
      const room = MAX_FILES - prev.length;
      if (room <= 0) {
        setError(`You can attach up to ${MAX_FILES} files per message`);
        return prev;
      }
      const accepted = [];
      for (const file of incoming.slice(0, room)) {
        if (file.size > MAX_FILE_BYTES) {
          setError(`“${file.name}” is larger than 25 MB`);
          continue;
        }
        const isMedia = /^(image|video)\//.test(file.type);
        const previewUrl = isMedia ? URL.createObjectURL(file) : null;
        if (previewUrl) urls.current.add(previewUrl);
        accepted.push({
          id: nextId++,
          file,
          previewUrl,
          kind: file.type.split("/")[0], // image | video | audio | …
        });
      }
      if (incoming.length > room) setError(`Only the first ${room} file(s) were added`);
      return [...prev, ...accepted];
    });
  }, []);

  const remove = useCallback((id) => {
    setStaged((prev) => {
      const hit = prev.find((s) => s.id === id);
      if (hit?.previewUrl) {
        URL.revokeObjectURL(hit.previewUrl);
        urls.current.delete(hit.previewUrl);
      }
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setStaged((prev) => {
      prev.forEach((s) => {
        if (s.previewUrl) {
          URL.revokeObjectURL(s.previewUrl);
          urls.current.delete(s.previewUrl);
        }
      });
      return [];
    });
    setProgress(0);
    setError(null);
  }, []);

  /** Upload everything staged. Returns attachment descriptors, or null on failure. */
  const upload = useCallback(async () => {
    if (!staged.length) return [];
    setUploading(true);
    setProgress(0);
    setError(null);
    try {
      const form = new FormData();
      staged.forEach((s) => form.append("files", s.file, s.file.name));
      const res = await api.post(`/rooms/${roomId}/attachments`, form, {
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
        },
      });
      return res.data.data.attachments;
    } catch (err) {
      const status = err.response?.status;
      setError(
        status === 501
          ? "File storage isn't configured on this server"
          : err.response?.data?.error?.message || "Upload failed"
      );
      return null;
    } finally {
      setUploading(false);
    }
  }, [roomId, staged]);

  return { staged, add, remove, clear, upload, uploading, progress, error, setError };
}
