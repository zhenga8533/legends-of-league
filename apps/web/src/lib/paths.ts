/** Joins a site-relative path onto the deploy base path (e.g. "/legends-of-league/"). */
export function joinBase(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedPath}`;
}

export function withBase(path: string): string {
  return joinBase(import.meta.env.BASE_URL, path);
}
