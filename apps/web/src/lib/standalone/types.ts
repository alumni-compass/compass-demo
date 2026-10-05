/** Local stand-ins for the Convex types the UI already imports. */

export type Id<Table extends string = string> = string & { __table?: Table };

/** Stand-in for Convex's inferred return type. The local data layer is untyped. */
export type FunctionReturnType<_Query> = any;

export type Role = "alumni" | "entrepreneur" | "admin" | "guest";

export class ConvexError<T = string> extends Error {
  data: T;
  constructor(data: T) {
    super(typeof data === "string" ? data : "Request failed");
    this.name = "ConvexError";
    this.data = data;
  }
}

export type DemoUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

export type Alumni = {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  firstName: string;
  lastName: string;
  batch: number;
  department: string;
  designation: string;
  company: string;
  region: string;
  location: string;
  locationLat: number | null;
  locationLng: number | null;
  locationConsent: boolean;
  locationUpdatedAt: number | null;
  locationSource: "device" | "manual" | null;
  address: string;
  companyDomain: string;
  workLocation: string;
  skills: string[];
  industries: string[];
  bio: string;
  avatarUrl: string | null;
  linkedinUrl?: string;
  verified: boolean;
  featured: boolean;
  openToMentor: boolean;
  mentorTopics: string[];
  hiddenFields: string[];
  sharedFields: string[];
  joinedAt: number;
};

export type PortalState = {
  alumni: Alumni[];
  events: any[];
  rsvps: any[];
  reminders: any[];
  stories: any[];
  albums: any[];
  campaigns: any[];
  donations: any[];
  ventures: any[];
  jobs: any[];
  connections: any[];
  conversations: any[];
  messages: any[];
  communities: any[];
  communityMembers: any[];
  posts: any[];
  comments: any[];
  likes: any[];
  questions: any[];
  answers: any[];
  profileFields: any[];
  mentorship: any[];
  verifications: any[];
  roles: { email: string; role: Role }[];
  students: any[];
  importBatches: any[];
};
