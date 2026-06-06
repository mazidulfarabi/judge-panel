const API = "/api";

function getToken(): string | null {
  return localStorage.getItem("token");
}

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res as unknown as T;
}

export type LoginResult = {
  token: string;
  role: "admin" | "judge";
  name: string;
  title?: string;
};

export function saveSession(data: LoginResult) {
  localStorage.setItem("token", data.token);
  localStorage.setItem("role", data.role);
  localStorage.setItem("name", data.name);
  if (data.title) localStorage.setItem("title", data.title);
}

export function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("role");
  localStorage.removeItem("name");
  localStorage.removeItem("title");
}

export function getSession() {
  return {
    token: getToken(),
    role: localStorage.getItem("role") as "admin" | "judge" | null,
    name: localStorage.getItem("name") || "",
    title: localStorage.getItem("title") || "",
  };
}
