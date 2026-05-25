export type TeamImportRow = { name: string; link: string; late_penalty: number };

/** Same display name twice → "Name", "Name (2)", "Name (3)", … (DB requires unique team names). */
export function assignUniqueTeamNames(rows: TeamImportRow[]): {
  teams: TeamImportRow[];
  renamed: number;
} {
  const seen = new Map<string, number>();
  let renamed = 0;
  const teams = rows.map((team) => {
    const base = team.name.trim();
    const key = base.toLowerCase();
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    if (occurrence > 1) renamed++;
    const name = occurrence === 1 ? base : `${base} (${occurrence})`;
    return { ...team, name };
  });
  return { teams, renamed };
}
