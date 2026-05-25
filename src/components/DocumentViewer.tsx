import { useEffect, useState } from "react";
import { fetchDocument } from "../api";
import { driveEmbedUrl, extractDriveFileId } from "../criteria";

type Props = {
  /** API path, e.g. `/judge/team/abc/document` */
  apiPath: string;
  /** Original Drive link for fallback embed and “open in tab”. */
  driveLink: string;
  title: string;
};

export default function DocumentViewer({ apiPath, driveLink, title }: Props) {
  const [mode, setMode] = useState<"loading" | "blob" | "embed" | "error">("loading");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [embedUrl, setEmbedUrl] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let revoked: string | null = null;
    setMode("loading");
    setMessage("");
    setBlobUrl(null);

    const fileId = extractDriveFileId(driveLink);
    if (!fileId) {
      setMode("error");
      setMessage(
        /\/folders\//i.test(driveLink)
          ? "This is a folder link. Import a direct link to each team’s PDF or slides file."
          : "Invalid Google Drive link. Use a direct file link (Share → Anyone with the link)."
      );
      return;
    }

    fetchDocument(apiPath)
      .then(async (result) => {
        if (result.type === "blob") {
          const buf = await result.blob.slice(0, 4).arrayBuffer();
          const bytes = new Uint8Array(buf);
          const isPdf =
            result.blob.type.includes("pdf") ||
            (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
          if (isPdf) {
            revoked = URL.createObjectURL(result.blob);
            setBlobUrl(revoked);
            setMode("blob");
            return;
          }
        }
        const embed =
          result.type === "fallback" ? result.embedUrl : driveEmbedUrl(driveLink);
        setEmbedUrl(embed || driveEmbedUrl(driveLink));
        setMessage(
          result.type === "fallback"
            ? result.message || ""
            : "Using Google Drive preview for this file type."
        );
        setMode("embed");
      })
      .catch((e) => {
        setEmbedUrl(driveEmbedUrl(driveLink));
        setMessage(e instanceof Error ? e.message : "Could not load preview");
        setMode("embed");
      });

    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [apiPath, driveLink]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const openLink = driveLink || embedUrl;

  return (
    <div className="doc-viewer">
      {mode === "loading" && <p className="doc-viewer-status">Loading preview…</p>}

      {mode === "blob" && blobUrl && (
        <iframe className="pdf-frame" title={title} src={`${blobUrl}#toolbar=1&navpanes=0`} />
      )}

      {mode === "embed" && (
        <>
          {message && <p className="doc-viewer-hint">{message}</p>}
          <iframe className="pdf-frame" title={title} src={embedUrl} />
        </>
      )}

      {mode === "error" && (
        <div className="doc-viewer-error">
          <p>{message}</p>
        </div>
      )}

      {openLink && (
        <p className="doc-viewer-open">
          <a href={openLink} target="_blank" rel="noreferrer">
            Open in new tab
          </a>
        </p>
      )}
    </div>
  );
}
