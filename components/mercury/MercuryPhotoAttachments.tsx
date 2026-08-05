"use client";

/**
 * PhotoAttachments — reusable photo evidence uploader.
 *
 * Used on Bad Order, Incident Report, and Stock Receiving detail pages so
 * a photo (damaged item, incident scene, condition of stock on arrival)
 * can be attached as evidence. Uploads go straight from the browser to
 * Vercel Blob storage (via /api/upload for the token), and only the
 * public Blob URLs are saved back to Supabase in the `attachment_urls`
 * column of the calling table.
 *
 * Usage:
 *   <PhotoAttachments
 *     urls={header.attachment_urls || []}
 *     pathPrefix={`bad-orders/${header.id}`}
 *     onChange={(urls) => saveAttachmentUrls(urls)}
 *   />
 */

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

export default function PhotoAttachments({
  urls,
  pathPrefix,
  onChange,
  readOnly = false,
}: {
  urls: string[];
  pathPrefix: string;
  onChange: (urls: string[]) => void | Promise<void>;
  readOnly?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const newUrls: string[] = [];
      for (const file of Array.from(files)) {
        const blob = await upload(`${pathPrefix}/${Date.now()}-${file.name}`, file, {
          access: "public",
          handleUploadUrl: "/api/mercury/upload",
        });
        newUrls.push(blob.url);
      }
      await onChange([...urls, ...newUrls]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removeUrl(url: string) {
    await onChange(urls.filter((u) => u !== url));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">
        {urls.map((url) => (
          <div key={url} className="relative group">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <img
                src={url}
                alt="Attachment"
                className="h-24 w-24 rounded-md border border-gray-200 object-cover"
              />
            </a>
            {!readOnly && (
              <button
                type="button"
                onClick={() => removeUrl(url)}
                className="absolute -right-2 -top-2 hidden h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs text-white group-hover:flex"
                title="Remove"
              >
                ✕
              </button>
            )}
          </div>
        ))}

        {!readOnly && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-gray-300 text-xs text-gray-500 hover:border-brand hover:text-brand disabled:opacity-50"
          >
            <span className="text-xl leading-none">+</span>
            <span>{uploading ? "Uploading…" : "Add Photo"}</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}
