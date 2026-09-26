// Shared leaderboard helpers: the weekly boundary and the display sort.
// Kept pure and browser-safe so tests/game.test.mjs can assert the week
// math the server's date_trunc('week') must agree with, and so the
// leaderboard card and any future surface sort identically.

// The Monday 00:00 UTC start of the ISO week containing the given time.
// Matches Postgres date_trunc('week', ...) for TIMESTAMPTZ values, which
// also truncates a Sunday to the Monday six days earlier (Postgres treats
// a Sunday as the last day of the week that just ran, not the first of
// the week to come).
export function weekStartUtc(date) {
  const d = new Date(date.getTime());
  const day = d.getUTCDay(); // 0 = Sunday
  const shift = (day === 0) ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - shift);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Rank rows score-desc, ties broken by handle alphabetically, friends with
// no score last. Sorts in place and returns the array, like Array#sort.
export function sortScoreRows(rows, { getScore = (r) => r.bestRound, getScore2 = null } = {}) {
  const hasScore = (r) => getScore(r) !== null && getScore(r) !== undefined;
  return [...rows].sort((a, b) => {
    // Unscored friends sort after every scored row, by handle.
    const ha = hasScore(a);
    const hb = hasScore(b);
    if (ha !== hb) return ha ? -1 : 1;
    if (!ha) return String(a.username).localeCompare(String(b.username), 'en');
    const sa = getScore(a);
    const sb = getScore(b);
    if (sb !== sa) return sb - sa;
    if (getScore2) {
      const ta = getScore2(a) || 0;
      const tb = getScore2(b) || 0;
      if (tb !== ta) return tb - ta;
    }
    return String(a.username).localeCompare(String(b.username), 'en');
  });
}
