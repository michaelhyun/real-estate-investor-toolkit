/* Deep links from a deal's address out to the places you would check it.

   Two of these four sites publish a stable URL you can build by hand; two do
   not, and the honest fallback for those is a site-scoped search, which costs
   one extra click and never lands on a 404. Which is which is recorded on
   each entry rather than hidden, so a wrong guess is one edit here and not a
   hunt through the page.

   Nothing is fetched. These are anchors the browser follows when clicked, so
   the address never leaves the machine until you choose to go. */

export type LinkKind = 'direct' | 'search';

export interface ListingLink {
  id: string;
  label: string;
  href: string;
  /** hover text, which says plainly when a link is a search rather than the listing */
  title: string;
  kind: LinkKind;
}

/** "123 Main St, Fremont, CA 94536" -> "123-Main-St_Fremont_CA-94536" */
const slugify = (s: string) =>
  s.split(',').map(part => part.trim().replace(/\s+/g, '-')).filter(Boolean).join('_');

const siteSearch = (address: string, site: string) =>
  `https://www.google.com/search?q=${encodeURIComponent(`${address} site:${site}`)}`;

export function listingLinks(address: string): ListingLink[] {
  const q = (address || '').trim();
  if (!q) return [];
  const enc = encodeURIComponent(q);
  return [
    {
      id: 'maps', label: 'Maps', kind: 'direct',
      href: `https://www.google.com/maps/search/?api=1&query=${enc}`,
      title: 'Open this address in Google Maps',
    },
    {
      id: 'zillow', label: 'Zillow', kind: 'direct',
      href: `https://www.zillow.com/homes/${enc}_rb/`,
      title: 'Open this address on Zillow',
    },
    {
      id: 'redfin', label: 'Redfin', kind: 'search',
      href: siteSearch(q, 'redfin.com'),
      title: 'Redfin has no address URL you can build, so this searches the site',
    },
    {
      id: 'realtor', label: 'Realtor', kind: 'search',
      href: siteSearch(q, 'realtor.com'),
      title: 'Realtor.com has no address URL you can build, so this searches the site',
    },
  ];
}

/** Exposed for the rare case a site changes and one link needs rebuilding. */
export const listingSlug = slugify;
