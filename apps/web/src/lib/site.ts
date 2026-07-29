/**
 * RITAA constants. Every value here is taken verbatim from the RITAA Website
 * Requirement brief — do not invent contact details or addresses.
 */

export const RITAA = {
  shortName: "RITAA",
  name: "Ramco Institute of Technology Alumni Association",
  established: 2017,
  institute: "Ramco Institute of Technology",
  address: "North Venganallur Village, Rajapalayam, Virudhunagar - 626117",
  phone: "(04563) 233400",
  email: "alumni@ritrjpm.ac.in",
  website: "www.alumni.ritrjpm.ac.in",
  /** The brief's closing line. Used once, on the homepage. */
  creed:
    "Let's build a community that grows beyond college — where every alumnus finds support, connection, and opportunity.",
  vision:
    "A digital ecosystem where RIT alumni connect, collaborate, contribute, and grow together.",
} as const;

/** Office bearers, exactly as listed in the brief's "Submit Your Proposal" table. */
export const OFFICE_BEARERS = [
  {
    name: "Arunprasanth",
    designation: "Secretary",
    email: "alumni@ritrjpm.ac.in",
    phone: "7094994736",
  },
  {
    name: "Thojesh Nandha",
    designation: "Vice President",
    email: "Pro.alumni@ritrjpm.ac.in",
    phone: "9384191645",
  },
  {
    name: "Jothi Krishna",
    designation: "Coordinator - RACE",
    email: "race@ritrjpm.ac.in",
    phone: "7598859516",
  },
] as const;

/** Module 1 — the four roles named in the brief. */
export const ROLES = [
  {
    id: "alumni",
    label: "Alumni",
    blurb: "Full directory, careers, mentorship, events and giving.",
  },
  {
    id: "entrepreneur",
    label: "Entrepreneurs",
    blurb: "Everything alumni get, plus the RACE zone and venture profile.",
  },
  {
    id: "admin",
    label: "Admins",
    blurb: "Member management, moderation, analytics and reports.",
  },
  {
    id: "guest",
    label: "Guests",
    blurb: "Public pages only — stories, events and giving.",
  },
] as const;

export const DEPARTMENTS = [
  "CSE",
  "IT",
  "ECE",
  "EEE",
  "MECH",
  "CIVIL",
  "AIDS",
] as const;

export const DEPARTMENT_NAMES: Record<string, string> = {
  CSE: "Computer Science & Engineering",
  IT: "Information Technology",
  ECE: "Electronics & Communication",
  EEE: "Electrical & Electronics",
  MECH: "Mechanical Engineering",
  CIVIL: "Civil Engineering",
  AIDS: "AI & Data Science",
};

export const REGIONS = [
  "Rajapalayam",
  "Madurai",
  "Chennai",
  "Coimbatore",
  "Bengaluru",
  "Hyderabad",
  "Pune",
  "Delhi NCR",
  "Overseas",
] as const;

/** Batch years run from the association's founding to the current cohort. */
export const BATCH_YEARS = Array.from(
  { length: new Date().getFullYear() - RITAA.established + 1 },
  (_, i) => RITAA.established + i,
);

export const NAV = [
  { href: "/directory", label: "Directory" },
  { href: "/careers", label: "Careers" },
  { href: "/mentorship", label: "Mentorship" },
  { href: "/race", label: "Entrepreneurs" },
  { href: "/events", label: "Events" },
  { href: "/stories", label: "Stories" },
  { href: "/giving", label: "Giving" },
  { href: "/about", label: "About" },
] as const;

/** Formats paise-free rupee amounts the way Indian donors expect to read them. */
export function inr(amount: number, opts?: { compact?: boolean }) {
  if (opts?.compact) {
    if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(2)} Cr`;
    if (amount >= 100_000) return `₹${(amount / 100_000).toFixed(1)} L`;
    if (amount >= 1_000) return `₹${(amount / 1_000).toFixed(0)}k`;
  }
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function formatEventDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Initials for the monogram avatars used across the site. */
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
