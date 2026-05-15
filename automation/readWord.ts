import mammoth from 'mammoth';

export interface Passenger {
  seqNum: string;
  groupSize: number;
  lastName: string;
  firstName: string;
  fullNameRaw: string;
  pnr: string;
  travelClass: string;
}

// Matches: 001 01AL LUHAYB/RAED MR    9737GJ  F  HK ...
// Groups: (seqNum)(groupSize)(nameField)(pnr)(class)
// Name field starts immediately after the 2-digit group size.
// The delimiter between name and PNR is always 2+ spaces.
const PASSENGER_REGEX =
  /^(\d{3})\s+(\d{2})([A-Z][A-Z/ ]+?)\s{2,}([A-Z0-9]{6})\s+([A-Z])\b/;

// Valid travel class codes per CLAUDE.md
const VALID_CLASSES = new Set(['F','J','D','I','Z','Y','B','M','K','H','L','Q','T','O','A']);

export function parsePassengerLine(line: string): Passenger | null {
  const trimmed = line.trim();

  // Skip blank lines and known junk patterns
  if (!trimmed) return null;
  if (/^[)>]/.test(trimmed)) return null;      // starts with ) or >
  if (/^m\s*$/i.test(trimmed)) return null;    // lone "m"

  const match = PASSENGER_REGEX.exec(trimmed);
  if (!match) return null;

  const [, seqNum, groupSizeStr, nameField, pnr, travelClass] = match;

  // Must contain a slash to be a valid name field
  const slashIdx = nameField.indexOf('/');
  if (slashIdx === -1) return null;

  // Must be a recognised class code
  if (!VALID_CLASSES.has(travelClass)) return null;

  const lastName = nameField.slice(0, slashIdx).trim();
  const firstNameRaw = nameField.slice(slashIdx + 1).trim();
  // Strip trailing title (MR / MRS / MS / DR)
  const firstName = firstNameRaw.replace(/\s+(MR|MRS|MS|DR)$/i, '').trim();

  return {
    seqNum: seqNum.trim(),
    groupSize: parseInt(groupSizeStr, 10),
    lastName,
    firstName,
    fullNameRaw: nameField.trim(),
    pnr: pnr.trim(),
    travelClass: travelClass.trim(),
  };
}

export async function readWordFile(filePath: string): Promise<Passenger[]> {
  const result = await mammoth.extractRawText({ path: filePath });
  const lines = result.value.split('\n');
  const passengers: Passenger[] = [];

  for (const line of lines) {
    const p = parsePassengerLine(line);
    if (p) passengers.push(p);
  }

  return passengers;
}
