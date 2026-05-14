// Lightweight iCalendar (RFC 5545) helpers — no external deps.
// Used by /api/ical/export/:id (outbound) and /api/ical/sync (inbound).

const crypto = require('crypto');

function pad(n) { return String(n).padStart(2, '0'); }

// Format as YYYYMMDD (date-only VEVENT — standard for property blocks)
function fmtDate(input) {
  const d = (input instanceof Date) ? input : new Date(input);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function fmtStamp(d = new Date()) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

// Build a VCALENDAR string from booking-shaped rows
function buildCalendar({ propertyId, propertyName, hostname, events }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//StayDekho//Property Calendar//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escape(propertyName || `Property ${propertyId}`)} — StayDekho`,
  ];
  const stamp = fmtStamp();
  for (const ev of events) {
    const uid = ev.uid || `sd-${propertyId}-${ev.id || crypto.randomBytes(6).toString('hex')}@${hostname || 'staydekho'}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${fmtDate(ev.start)}`,
      `DTEND;VALUE=DATE:${fmtDate(ev.end)}`,
      `SUMMARY:${escape(ev.summary || 'Blocked — StayDekho')}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// Parse iCalendar text → array of {uid, summary, start, end}
function parseCalendar(text) {
  // Unfold continuation lines per RFC 5545 (lines starting with space/tab continue the previous line)
  const unfolded = String(text).replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);

  const events = [];
  let cur = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT')   {
      if (cur && cur.start && cur.end) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;

    // Split on first colon; param part may contain ';'
    const ci = line.indexOf(':');
    if (ci === -1) continue;
    const left = line.slice(0, ci);
    const val  = line.slice(ci + 1);
    const name = left.split(';')[0].toUpperCase();

    if (name === 'UID')     cur.uid = val;
    else if (name === 'SUMMARY') cur.summary = val.replace(/\\,/g, ',').replace(/\\n/g, '\n').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
    else if (name === 'DTSTART') cur.start = isoFromIcal(val);
    else if (name === 'DTEND')   cur.end   = isoFromIcal(val);
  }
  return events;
}

function isoFromIcal(v) {
  // Accept YYYYMMDD or YYYYMMDDTHHMMSSZ
  const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

module.exports = { buildCalendar, parseCalendar };
