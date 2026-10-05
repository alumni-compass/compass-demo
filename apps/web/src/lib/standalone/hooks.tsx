"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";

import { applyMutation, getState, resolveQuery, subscribeState } from "./engine";
import { getServerSignedIn, getSignedInSnapshot, subscribeSession } from "./session";

const PATHS = [
  "auth.getCurrentUser",
  "auth.configuredAuthMethods",
  "access.roleFor",
  "access.verificationFor",
  "access.verificationQueue",
  "access.setVerified",
  "access.assignRole",
  "directory.stats",
  "directory.batchCounts",
  "directory.departmentCounts",
  "directory.featured",
  "directory.search",
  "directorySearch.search",
  "directorySearch.companyCounts",
  "events.list",
  "events.bySlug",
  "events.rsvp",
  "eventAdmin.myRsvp",
  "eventAdmin.rsvpSummary",
  "eventAdmin.attendeesFor",
  "eventAdmin.scheduleReminder",
  "eventAdmin.mailerStatus",
  "stories.list",
  "stories.bySlug",
  "stories.featured",
  "stories.albums",
  "giving.listCampaigns",
  "giving.bySlug",
  "giving.donorWall",
  "giving.givingTotals",
  "givingReports.fundUsageSummary",
  "givingReports.givingByBatch",
  "givingReports.givingTimeline",
  "givingReports.campaignLedger",
  "race.listVentures",
  "race.categories",
  "race.raceStats",
  "race.submitVenture",
  "raceProfiles.byId",
  "raceProfiles.related",
  "raceProfiles.helpDirectory",
  "raceProfiles.openAsks",
  "profiles.byEmail",
  "profiles.completeness",
  "profiles.upsertProfile",
  "profiles.setFieldVisibility",
  "profiles.setLocationConsent",
  "profiles.generateAvatarUploadUrl",
  "profiles.setAvatar",
  "profiles.removeAvatar",
  "profileFields.list",
  "profileFields.listAll",
  "profileFields.updateField",
  "profileFields.setOptions",
  "profileFields.moveField",
  "profileFields.ensureDefaults",
  "network.networkStats",
  "network.pendingCount",
  "network.myNetwork",
  "network.suggestions",
  "network.edgeStates",
  "network.profileEdge",
  "network.requestConnection",
  "network.respondToConnection",
  "network.withdrawConnection",
  "network.removeConnection",
  "messaging.unreadCount",
  "messaging.myConversations",
  "messaging.conversation",
  "messaging.openConversation",
  "messaging.sendMessage",
  "messaging.markRead",
  "communities.listCommunities",
  "communities.myCommunities",
  "communities.moderationCount",
  "communities.communityBySlug",
  "communities.membersOf",
  "communities.joinRequests",
  "communities.pendingCommunities",
  "communities.requestToJoin",
  "communities.createCommunity",
  "communities.reviewJoinRequest",
  "communities.leaveCommunity",
  "communities.setMemberRole",
  "communities.reviewCommunity",
  "feed.generalFeed",
  "feed.communityFeed",
  "feed.commentsFor",
  "feed.feedStats",
  "feed.createPost",
  "feed.toggleLike",
  "feed.votePoll",
  "feed.addComment",
  "feed.deleteComment",
  "feed.deletePost",
  "feed.sharePost",
  "feed.setPostHidden",
  "careers.listJobs",
  "careers.listMentors",
  "careers.mentorTopics",
  "careers.postJob",
  "careers.requestMentorship",
  "mentoring.myMentorProfile",
  "mentoring.requestsForMentor",
  "mentoring.requestsForSeeker",
  "mentoring.mentorshipStats",
  "mentoring.updateStatus",
  "mentoring.leaveFeedback",
  "referrals.requestReferral",
  "presence.map",
  "questions.allVerificationQuestions",
  "questions.verificationQuestions",
  "questions.profileQuestions",
  "questions.allProfileQuestions",
  "questions.communityQuestions",
  "questions.myProfileAnswers",
  "questions.myVerificationAnswers",
  "questions.addQuestion",
  "questions.editQuestion",
  "questions.setQuestionActive",
  "questions.reorderQuestion",
  "questions.answerProfileQuestions",
  "questions.answerVerificationQuestions",
  "lookups.cached",
  "lookups.companies",
  "lookups.positions",
  "lookups.resolveLocation",
  "lookups.locateTypedLocation",
  "roster.importFormat",
  "roster.importHistory",
  "roster.rosterStats",
  "roster.canSearchRoster",
  "roster.search",
  "roster.importRows",
  "roster.recordImportBatch",
  "roster.undoImport",
  "adminOps.pendingVentures",
  "adminOps.pendingVerifications",
  "adminOps.membersForVerification",
  "adminOps.postsForModeration",
] as const;

function ref(path: string) {
  return { __path: path };
}

function buildApi() {
  const api: Record<string, Record<string, { __path: string }>> = {};
  for (const path of PATHS) {
    const [mod, name] = path.split(".");
    api[mod!] ??= {};
    api[mod!]![name!] = ref(path);
  }
  return api;
}

export const api = buildApi() as any;

type QueryRef = { __path: string };

export function useQuery(query: QueryRef | "skip", args?: unknown): any {
  const signedIn = useSyncExternalStore(subscribeSession, getSignedInSnapshot, getServerSignedIn);
  const data = useSyncExternalStore(subscribeState, getState, getState);
  if (query === "skip" || args === "skip") return undefined;
  return resolveQuery(query.__path, args ?? {}, signedIn, data);
}

export function useMutation(mutation: QueryRef) {
  const path = mutation.__path;
  return useCallback((args?: any) => {
    return Promise.resolve().then(() => applyMutation(path, args ?? {}));
  }, [path]);
}

export function useAction(action: QueryRef) {
  return useMutation(action);
}

export function Authenticated({ children }: { children: ReactNode }) {
  const signedIn = useSyncExternalStore(subscribeSession, getSignedInSnapshot, getServerSignedIn);
  if (!signedIn) return null;
  return <>{children}</>;
}

export function Unauthenticated({ children }: { children: ReactNode }) {
  const signedIn = useSyncExternalStore(subscribeSession, getSignedInSnapshot, getServerSignedIn);
  if (signedIn) return null;
  return <>{children}</>;
}

export function AuthLoading(_props: { children?: ReactNode }) {
  return null;
}
