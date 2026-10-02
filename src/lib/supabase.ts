import { createClient } from '@supabase/supabase-js';
import type { Apartment, Booking, GuestArchive, Location } from '@/types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});

// Load cached data from localStorage for instant offline-first display.
const CACHE_KEY = 'pms_cloud_cache_v1';

interface CacheShape {
  locations: Location[];
  apartments: Apartment[];
  bookings: Booking[];
  guests_archive: GuestArchive[];
}

function loadCache(): CacheShape | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CacheShape;
  } catch {
    return null;
  }
}

function saveCache(data: CacheShape): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('Failed to save cache', err);
  }
}

// Fetch all data from Supabase, expanding relations client-side.
// Falls back to localStorage cache on network failure (offline-first).
export async function fetchAll(): Promise<CacheShape> {
  try {
    const [locRes, aptRes, bookRes, archRes] = await Promise.all([
      supabase.from('locations').select('*'),
      supabase.from('apartments').select('*'),
      supabase.from('bookings').select('*'),
      supabase.from('guests_archive').select('*'),
    ]);

    if (locRes.error) throw locRes.error;
    if (aptRes.error) throw aptRes.error;
    if (bookRes.error) throw bookRes.error;
    if (archRes.error) throw archRes.error;

    const locations = (locRes.data as Location[]).sort((a, b) => {
      if (a.display_order !== b.display_order) return a.display_order - b.display_order;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

    const bookingsMap = new Map<string, Booking>();
    for (const bk of bookRes.data as Booking[]) bookingsMap.set(bk.id, bk);

    const apartments = (aptRes.data as Apartment[])
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
      .map((apt) => ({
        ...apt,
        location: apt.location_id ? locations.find((l) => l.id === apt.location_id) ?? null : null,
        current_booking: apt.current_booking_id ? bookingsMap.get(apt.current_booking_id) ?? null : null,
      }));

    const bookings = (bookRes.data as Booking[])
      .sort((a, b) => (a.check_in < b.check_in ? 1 : a.check_in > b.check_in ? -1 : 0))
      .map((bk) => ({
        ...bk,
        apartment: bk.apartment_id ? (aptRes.data as Apartment[]).find((a) => a.id === bk.apartment_id) ?? null : null,
      }));

    const guests_archive = (archRes.data as GuestArchive[]).sort((a, b) =>
      a.archived_at < b.archived_at ? 1 : a.archived_at > b.archived_at ? -1 : 0,
    );

    const result: CacheShape = { locations, apartments, bookings, guests_archive };
    saveCache(result);
    return result;
  } catch (err) {
    console.error('fetchAll failed, using cache:', err);
    const cached = loadCache();
    if (cached) return cached;
    return { locations: [], apartments: [], bookings: [], guests_archive: [] };
  }
}

// Synchronous fetch from localStorage cache — for instant first paint.
export function fetchAllSync(): CacheShape {
  const cached = loadCache();
  if (cached) return cached;
  return { locations: [], apartments: [], bookings: [], guests_archive: [] };
}
