// A fast CSV reader that returns, for every input, exactly the answer csv-reader 1.0.0 returns:
// {columns, rows, errors} for an input {text, header}, under csv-reader's broken-row policy:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled ("" inside it is one
//     quote; each CRLF or lone CR inside it is read as LF); what follows its closing quote, up to the
//     next comma or line break, is appended as it stands (quote_junk, when the field ends); a quote
//     that never closes is a literal character and the text after it is read again as unquoted
//     (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed;
//   - columns is the first record when header is true, else null; rows holds the records after it
//     (every record when header is false), each padded with "" (short_row) or cut (long_row) to the
//     first record's width;
//   - each error is {code, line, row} in the order met: line the 1-based line its record starts on
//     (every LF, CRLF and lone CR inside quotes counted), row its record's index in rows, null for
//     the header; a record's short_row or long_row is recorded when the record ends.
//
// Written for speed: whole clean lines are split in one pass, fields are cut out with indexOf-guided
// slices instead of character-by-character joins, and only the rare broken shapes (stray CRs, CRs
// inside quotes, junk after a closing quote) fall back to a character loop. Pure: nothing is kept
// from one call to the next.

// How the field being read ended, kept in a scratch variable the two readers set before returning.
const ENDED_COMMA = 0;
const ENDED_BREAK = 1;
const ENDED_EOF = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // Scratch results of the field readers: how the field ended, and how many characters it kept
  // (the readers' own starting value is not counted).
  let fEnded = ENDED_EOF;
  let fAdded = 0;

  // The character loop for an unquoted field, used when the slice fast path meets a CR: stray CRs
  // are dropped one error at a time and the kept text is joined from the slices between them.
  function readUnquotedSlow(value, added) {
    let seg = pos;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        // ','
        value += text.slice(seg, pos);
        added += pos - seg;
        pos += 1;
        fEnded = ENDED_COMMA;
        fAdded = added;
        return value;
      }
      if (c === 10) {
        // LF
        value += text.slice(seg, pos);
        added += pos - seg;
        pos += 1;
        line += 1;
        fEnded = ENDED_BREAK;
        fAdded = added;
        return value;
      }
      if (c === 13) {
        // CR: part of a CRLF line break, or a stray CR to drop.
        if (text.charCodeAt(pos + 1) === 10) {
          value += text.slice(seg, pos);
          added += pos - seg;
          pos += 2;
          line += 1;
          fEnded = ENDED_BREAK;
          fAdded = added;
          return value;
        }
        value += text.slice(seg, pos);
        added += pos - seg;
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += 1;
        seg = pos;
        continue;
      }
      pos += 1;
    }
    value += text.slice(seg, pos);
    added += pos - seg;
    fEnded = ENDED_EOF;
    fAdded = added;
    return value;
  }

  // Reads unquoted characters onto `value` up to the next comma or line break.
  function readUnquoted(value) {
    // The field ends at the first comma or LF at or after pos; a CR can only matter before it (as a
    // stray CR) or as the first half of the CRLF that ends the field at that LF.
    const ci = text.indexOf(',', pos);
    const ni = text.indexOf('\n', pos);
    let end;
    let term;
    if (ci === -1) {
      end = ni;
      term = ENDED_BREAK;
    } else if (ni === -1 || ci < ni) {
      end = ci;
      term = ENDED_COMMA;
    } else {
      end = ni;
      term = ENDED_BREAK;
    }
    if (end === -1) {
      // The field runs to the end of the text.
      const rest = text.slice(pos);
      if (rest.indexOf('\r') === -1) {
        fAdded = rest.length;
        pos = len;
        fEnded = ENDED_EOF;
        return value === '' ? rest : value + rest;
      }
      return readUnquotedSlow(value, 0);
    }
    let vend = end;
    if (term === ENDED_BREAK && end > pos && text.charCodeAt(end - 1) === 13) vend = end - 1;
    const s = text.slice(pos, vend);
    if (s.indexOf('\r') === -1) {
      fAdded = s.length;
      pos = end + 1;
      if (term === ENDED_BREAK) line += 1;
      fEnded = term;
      return value === '' ? s : value + s;
    }
    return readUnquotedSlow(value, 0);
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it is read again
        // as unquoted (the lines scanned inside the dead quote do not count).
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      const seg = text.slice(pos, q);
      if (seg.indexOf('\r') === -1) {
        // No CR inside this stretch: LFs are kept as they stand and each one moves the line.
        let k = seg.indexOf('\n');
        while (k !== -1) {
          line += 1;
          k = seg.indexOf('\n', k + 1);
        }
        value += seg;
      } else {
        // CRs inside quotes: each CRLF or lone CR is read as one LF. Join from slices.
        let built = '';
        let i = 0;
        let last = 0;
        while (i < seg.length) {
          const c = seg.charCodeAt(i);
          if (c === 13) {
            built += seg.slice(last, i) + '\n';
            line += 1;
            i += seg.charCodeAt(i + 1) === 10 ? 2 : 1;
            last = i;
            continue;
          }
          if (c === 10) line += 1;
          i += 1;
        }
        built += seg.slice(last);
        value += built;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one literal quote; the field goes on.
        value += '"';
        pos = q + 2;
        continue;
      }
      pos = q + 1; // the closing quote
      break;
    }
    if (pos >= len) {
      fEnded = ENDED_EOF;
      fAdded = 0;
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fEnded = ENDED_COMMA;
      fAdded = 0;
      return value;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fEnded = ENDED_BREAK;
      fAdded = 0;
      return value;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fEnded = ENDED_BREAK;
      fAdded = 0;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    const v = readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return v;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    let fields = null;

    // Fast path: a whole record on one line whose text holds no CR and no quote at a field start
    // reads exactly as its comma split — every quote in it is a literal character of an unquoted
    // field, and no quoted field can reach past the line's end.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? len : nl;
    let contentEnd = lineEnd;
    if (nl !== -1 && lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13) contentEnd = lineEnd - 1;
    if (contentEnd > pos) {
      const content = text.slice(pos, contentEnd);
      if (content.indexOf('\r') === -1) {
        let clean = true;
        let qi = content.indexOf('"');
        if (qi === 0) {
          clean = false;
        } else {
          while (qi !== -1) {
            if (content.charCodeAt(qi - 1) === 44) {
              clean = false;
              break;
            }
            qi = content.indexOf('"', qi + 1);
          }
        }
        if (clean) {
          fields = content.split(',');
          pos = nl === -1 ? len : nl + 1;
          if (nl !== -1) line += 1;
        }
      }
    }

    if (fields === null) {
      fields = [];
      let quoted = false;
      do {
        quoted = text.charCodeAt(pos) === 34;
        fields.push(quoted ? readQuoted() : readUnquoted(''));
      } while (fEnded === ENDED_COMMA);

      // A line that held only stray CRs is left with no characters: no record (its errors stay).
      if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    }

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
