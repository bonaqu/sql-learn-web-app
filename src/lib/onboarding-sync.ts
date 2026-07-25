import {
  emptyOnboardingProfile,
  ONBOARDING_SYNCED_EVENT,
  preferredOnboardingProfile,
  saveOnboardingProfile,
  sanitizeOnboardingProfile,
  storedOnboardingProfile,
  type CloudOnboardingProfile,
  type LearnerOnboardingProfile
} from './learner-onboarding';

const ENDPOINT = '/api/onboarding/profile';

type SyncError = Error & { status?: number };

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = new Error(`Onboarding sync failed with ${response.status}`) as SyncError;
    error.status = response.status;
    throw error;
  }
  const contract = response.headers.get('x-onboarding-contract');
  if (contract !== 'onboarding-v1') throw new Error('Unexpected onboarding API contract');
  return response.json() as Promise<T>;
}

function fingerprint(profile: LearnerOnboardingProfile | null) {
  return profile ? JSON.stringify(profile) : 'null';
}

function announce(profile: LearnerOnboardingProfile, revision: number) {
  window.dispatchEvent(new CustomEvent(ONBOARDING_SYNCED_EVENT, { detail: { profile, revision } }));
}

export async function fetchCloudOnboardingProfile() {
  return responseJson<CloudOnboardingProfile>(await fetch(ENDPOINT));
}

async function putCloudOnboardingProfile(profile: LearnerOnboardingProfile, baseRevision: number) {
  return responseJson<{ ok: true; revision: number; updatedAt: string | null }>(await fetch(ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile, baseRevision })
  }));
}

export async function syncOnboardingProfile(localOverride?: LearnerOnboardingProfile) {
  const local = localOverride || storedOnboardingProfile();
  let cloud = await fetchCloudOnboardingProfile();

  if (!local && !cloud.profile) {
    const empty = emptyOnboardingProfile();
    announce(empty, cloud.revision);
    return { profile: empty, revision: cloud.revision, localChanged: false, uploaded: false };
  }

  let merged = preferredOnboardingProfile(local, cloud.profile) || emptyOnboardingProfile();
  let localChanged = fingerprint(local) !== fingerprint(merged);

  if (cloud.profile && fingerprint(cloud.profile) === fingerprint(merged)) {
    if (localChanged) merged = saveOnboardingProfile(merged);
    announce(merged, cloud.revision);
    return { profile: merged, revision: cloud.revision, localChanged, uploaded: false };
  }

  try {
    const saved = await putCloudOnboardingProfile(merged, cloud.revision);
    if (localChanged) merged = saveOnboardingProfile(merged);
    announce(merged, saved.revision);
    return { profile: merged, revision: saved.revision, localChanged, uploaded: true };
  } catch (reason) {
    if ((reason as SyncError).status !== 409) throw reason;
    cloud = await fetchCloudOnboardingProfile();
    merged = preferredOnboardingProfile(merged, cloud.profile) || merged;
    localChanged = fingerprint(local) !== fingerprint(merged);
    if (cloud.profile && fingerprint(cloud.profile) === fingerprint(merged)) {
      if (localChanged) merged = saveOnboardingProfile(merged);
      announce(merged, cloud.revision);
      return { profile: merged, revision: cloud.revision, localChanged, uploaded: false };
    }
    const saved = await putCloudOnboardingProfile(sanitizeOnboardingProfile(merged), cloud.revision);
    if (localChanged) merged = saveOnboardingProfile(merged);
    announce(merged, saved.revision);
    return { profile: merged, revision: saved.revision, localChanged, uploaded: true };
  }
}
