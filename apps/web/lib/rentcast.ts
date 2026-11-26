/* Property facts from RentCast, using the key the owner pasted into the Rental
   Analyzer. The key lives only in this browser's localStorage; without one the
   lookup quietly returns nothing. */

export interface PropertyFacts { beds?: number; baths?: number; sqft?: number; year?: number }

export function rentcastKey(): string {
  try { return (localStorage.getItem('rentcastKey') || '').trim(); } catch { return ''; }
}

export async function lookupProperty(address: string): Promise<PropertyFacts | null> {
  const key = rentcastKey();
  if (!key) return null;
  const res = await fetch('https://api.rentcast.io/v1/properties?address=' + encodeURIComponent(address),
    { headers: { 'X-Api-Key': key, Accept: 'application/json' } });
  if (!res.ok) return null;
  const d = (await res.json())?.[0];
  if (!d) return null;
  const facts: PropertyFacts = {};
  if (d.bedrooms) facts.beds = Number(d.bedrooms);
  if (d.bathrooms) facts.baths = Number(d.bathrooms);
  if (d.squareFootage) facts.sqft = Number(d.squareFootage);
  if (d.yearBuilt) facts.year = Number(d.yearBuilt);
  return Object.keys(facts).length ? facts : null;
}
