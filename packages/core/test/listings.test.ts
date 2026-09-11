import { describe, it, expect } from 'vitest';
import { listingLinks, listingSlug } from '../src/index';

const ADDR = '1234 Peralta Blvd, Fremont, CA 94536';

describe('listing links', () => {
  it('gives nothing at all until there is an address', () => {
    expect(listingLinks('')).toEqual([]);
    expect(listingLinks('   ')).toEqual([]);
    expect(listingLinks(undefined as any)).toEqual([]);
  });

  it('returns the four sites, in the order they are shown', () => {
    expect(listingLinks(ADDR).map(l => l.id)).toEqual(['maps', 'zillow', 'redfin', 'realtor']);
  });

  it('every link is https and carries the address', () => {
    for (const l of listingLinks(ADDR)) {
      expect(l.href.startsWith('https://')).toBe(true);
      expect(decodeURIComponent(l.href)).toContain('Peralta');
      expect(l.title.length).toBeGreaterThan(0);
    }
  });

  it('escapes the address rather than pasting spaces into a URL', () => {
    for (const l of listingLinks(ADDR)) expect(l.href).not.toMatch(/\s/);
  });

  it('says which links are a search rather than the listing itself', () => {
    const byId = Object.fromEntries(listingLinks(ADDR).map(l => [l.id, l]));
    expect(byId.maps.kind).toBe('direct');
    expect(byId.zillow.kind).toBe('direct');
    expect(byId.redfin.kind).toBe('search');
    expect(byId.realtor.kind).toBe('search');
    /* a search link must scope itself to the site, or it is just a web search */
    expect(decodeURIComponent(byId.redfin.href)).toContain('site:redfin.com');
    expect(decodeURIComponent(byId.realtor.href)).toContain('site:realtor.com');
  });

  it('survives an address with quotes, ampersands and unicode', () => {
    const odd = '12 O’Brien & Sons Ct #3, San José, CA';
    for (const l of listingLinks(odd)) {
      expect(() => new URL(l.href)).not.toThrow();
      expect(l.href).not.toMatch(/["<>]/);
    }
  });

  it('slugifies an address the way a listing site path does', () => {
    expect(listingSlug(ADDR)).toBe('1234-Peralta-Blvd_Fremont_CA-94536');
  });
});
