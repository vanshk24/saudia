import { Passenger } from './readWord';

export interface ParseResult {
  passengers: Passenger[];
  passengersByPnr: Record<string, Passenger[]>;
  totalPassengers: number;
  uniquePnrs: number;
}

/**
 * Groups a flat passenger list by PNR.
 * Returns a serialisable result (plain object, not Map) for safe IPC transfer.
 */
export function groupPassengers(passengers: Passenger[]): ParseResult {
  const passengersByPnr: Record<string, Passenger[]> = {};

  for (const p of passengers) {
    if (!passengersByPnr[p.pnr]) {
      passengersByPnr[p.pnr] = [];
    }
    passengersByPnr[p.pnr].push(p);
  }

  return {
    passengers,
    passengersByPnr,
    totalPassengers: passengers.length,
    uniquePnrs: Object.keys(passengersByPnr).length,
  };
}
