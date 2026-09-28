'use strict';

// Minimal CSV helpers mirroring ContactController csvField/csvValue plus an
// RFC-4180-compatible parser (quoted fields, escaped quotes, CRLF) equivalent
// to Apache Commons CSVFormat.DEFAULT for the shapes used by import/export.

// Quote a single CSV output field (export).
function csvField(value) {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Parse full CSV text into { headers: string[], records: string[][] }.
// Handles quoted fields, "" escapes, \r\n and \n. Throws on unbalanced quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  // A quote only opens a quoted section at the very start of a field
  // (matches Apache Commons CSV DEFAULT used by the Java backend: a quote
  // in the middle of a bare field, e.g. Excel's ="+123" cells, is literal).
  let fieldStart = true;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    row.push(field);
    field = '';
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (text[i + 1] === ',' || text[i + 1] === '\r' || text[i + 1] === '\n' || i + 1 >= text.length) {
          inQuotes = false;
          i += 1;
        } else {
          // Lenient (matches Apache Commons CSV DEFAULT used by the Java
          // backend): a bare quote inside a quoted field that is not an
          // escape ("") nor the closing quote is kept literally. This is
          // what makes Excel-style phone cells like "="+123"" survive.
          field += '"';
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"') {
      if (fieldStart) {
        inQuotes = true;
        fieldStart = false;
      } else {
        field += '"';
      }
      i += 1;
    } else if (ch === ',') {
      pushField();
      fieldStart = true;
      i += 1;
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i += 2;
      else i += 1;
      pushRow();
      fieldStart = true;
    } else if (ch === '\n') {
      i += 1;
      pushRow();
      fieldStart = true;
    } else {
      field += ch;
      fieldStart = false;
      i += 1;
    }
  }
  if (inQuotes) throw new Error('Unbalanced quotes in CSV');
  // Trailing content without newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return { headers: [], records: [] };
  return { headers: rows[0], records: rows.slice(1) };
}

// Get a cell value by header aliases (normalized). Mirrors csvValue(): trims,
// empty -> null. Missing column -> null.
function csvValue(headers, record, normalizedHeaders, aliases) {
  for (let i = 0; i < headers.length; i++) {
    if (aliases.has(normalizedHeaders[i])) {
      const v = i < record.length ? record[i] : null;
      if (v != null) {
        const t = String(v).trim();
        return t === '' ? null : t;
      }
      return null;
    }
  }
  return null;
}

module.exports = { csvField, parseCsv, csvValue };
