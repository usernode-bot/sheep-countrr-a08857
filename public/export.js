// Grown-ups CSV export: one pure module so both the browser button and the
// node test suite build the exact same rows from the same plain objects.
// The data model never feeds anything here; it is only read.

function csvCell(value) {
  // RFC 4180: wrap a cell containing a quote, comma, CR or LF, and double
  // any embedded quote. Usernames are the one free-text cell, so this is
  // what keeps a stray comma from shifting a column.
  const text = String(value == null ? '' : value);
  if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function csvRow(cells) {
  return cells.map(csvCell).join(',');
}

export function bestRoundsCsv(state) {
  const rows = [
    csvRow(['difficulty', 'best_round']),
  ];
  for (const difficulty of ['easy', 'normal', 'hard', 'expert']) {
    rows.push(csvRow([difficulty, (state.bestRounds && state.bestRounds[difficulty]) || 1]));
  }
  return rows.join('\r\n') + '\r\n';
}

export function weeklyHistoryCsv(runs) {
  const rows = [
    csvRow(['ended_at', 'round_reached', 'speed_round']),
  ];
  const list = Array.isArray(runs) ? runs : [];
  for (const run of list) {
    rows.push(csvRow([
      run.endedAt || '',
      run.roundReached != null ? run.roundReached : '',
      run.speedRound ? 'yes' : 'no',
    ]));
  }
  return rows.join('\r\n') + '\r\n';
}
