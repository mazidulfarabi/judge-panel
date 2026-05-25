const MAX_PROXY_BYTES = 5 * 1024 * 1024;

export function extractDriveFileId(link: string): string | null {
  if (!link?.trim()) return null;
  if (/\/folders\//i.test(link)) return null;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /\/presentation\/d\/([a-zA-Z0-9_-]+)/,
    /\/document\/d\/([a-zA-Z0-9_-]+)/,
    /\/open\?[^#]*\bid=([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
  ];
  for (const p of patterns) {
    const m = link.match(p);
    if (m) return m[1];
  }
  return null;
}

export function driveEmbedUrl(link: string): string {
  const id = extractDriveFileId(link);
  if (!id) return link;
  if (/\/presentation\//i.test(link)) {
    return `https://docs.google.com/presentation/d/${id}/embed?start=false&loop=false`;
  }
  return `https://drive.google.com/file/d/${id}/preview`;
}

export type DriveFetchResult =
  | { ok: true; data: Uint8Array; contentType: string }
  | { ok: false; error: string; code: "access" | "too_large" | "invalid" };

async function fetchUrl(url: string): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; JudgePortal/1.0)" },
    redirect: "follow",
  });
}

function looksLikeLoginPage(html: string): boolean {
  return /accounts\.google\.com|sign in to continue|you need access/i.test(html);
}

export async function fetchDrivePublicFile(fileId: string): Promise<DriveFetchResult> {
  const base = `https://drive.google.com/uc?export=download&id=${fileId}`;

  let res = await fetchUrl(base);
  let ct = (res.headers.get("content-type") || "").toLowerCase();

  if (ct.includes("text/html")) {
    const html = await res.text();
    if (looksLikeLoginPage(html)) {
      return {
        ok: false,
        error:
          "Google Drive denied access. Share each file (not only the folder) as “Anyone with the link” and use a direct file link.",
        code: "access",
      };
    }
    const confirm =
      html.match(/confirm=([0-9A-Za-z_]+)/)?.[1] ||
      html.match(/download_warning[^>]*confirm=([0-9A-Za-z_]+)/)?.[1];
    if (confirm) {
      res = await fetchUrl(`${base}&confirm=${confirm}`);
      ct = (res.headers.get("content-type") || "").toLowerCase();
    } else {
      return {
        ok: false,
        error: "Could not download from Google Drive. Check the file link and sharing settings.",
        code: "access",
      };
    }
  }

  const contentLength = res.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_PROXY_BYTES) {
    return {
      ok: false,
      error: "File is too large to preview in the portal. Use Open in new tab.",
      code: "too_large",
    };
  }

  const data = new Uint8Array(await res.arrayBuffer());

  if (data.length > MAX_PROXY_BYTES) {
    return {
      ok: false,
      error: "File is too large to preview in the portal. Use Open in new tab.",
      code: "too_large",
    };
  }

  const head = new TextDecoder().decode(data.slice(0, 200)).toLowerCase();
  if (head.includes("<!doctype") || head.includes("<html")) {
    if (looksLikeLoginPage(head)) {
      return {
        ok: false,
        error:
          "Google Drive denied access. Share each file as “Anyone with the link” (folder sharing alone is not enough).",
        code: "access",
      };
    }
    return {
      ok: false,
      error: "Could not download file from Google Drive.",
      code: "access",
    };
  }

  const contentType = (res.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
  return { ok: true, data, contentType };
}
