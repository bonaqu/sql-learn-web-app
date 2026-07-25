import { curriculumLessons } from '../data/complete-curriculum';
import { reviewCards, type ReviewCard } from '../data/review-cards';
import { tasks } from '../data/course-catalog';
import { loadAuthSession } from './auth';
import { loadCurriculumProgress, type CurriculumProgressV1 } from './curriculum-progress';
import { hasIndependentTaskEvidence, loadProgress, type Progress } from './progress';

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';
export type ReviewIntroductionSource = 'lesson' | 'independent-practice' | 'legacy-practice';
export type ReviewEvidence = { source: ReviewIntroductionSource; at: string };

export type ReviewSchedule = {
  cardId: string;
  dueAt: string;
  intervalDays: number;
  ease: number;
  repetitions: number;
  lapses: number;
  introducedAt?: string;
  introductionSource?: ReviewIntroductionSource;
  lastReviewedAt?: string;
};

export type ReviewState = {
  version: 1;
  schedules: Record<string, ReviewSchedule>;
};

export const REVIEW_CHANGED_EVENT = 'sql-academy-review-changed';
const MINUTE = 60_000;
const DAY = 86_400_000;
const NOT_INTRODUCED_AT = '9999-12-31T23:59:59.999Z';
const SOURCE_PRIORITY: Record<ReviewIntroductionSource, number> = {
  'independent-practice': 3,
  lesson: 2,
  'legacy-practice': 1
};

function userId() {
  return loadAuthSession()?.userId || 'guest';
}

function storageKey(id = userId()) {
  return `sql-academy-spaced-review-v1:${id}`;
}

export function initialReviewSchedule(cardId: string): ReviewSchedule {
  return {
    cardId,
    dueAt: NOT_INTRODUCED_AT,
    intervalDays: 0,
    ease: 2.5,
    repetitions: 0,
    lapses: 0
  };
}

function evidenceTime(evidence: ReviewEvidence) {
  const value = new Date(evidence.at).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function reviewEvidenceForModule(
  moduleId: string,
  progress: Progress,
  curriculum: CurriculumProgressV1,
  now = Date.now()
): ReviewEvidence | null {
  const candidates: ReviewEvidence[] = [];
  const lesson = curriculumLessons.find(item =>
    item.module === moduleId && curriculum.completedLessons.includes(item.id)
  );
  if (lesson) candidates.push({ source: 'lesson', at: curriculum.updatedAt });

  const moduleTasks = tasks.filter(task => task.module === moduleId);
  for (const task of moduleTasks.filter(item => hasIndependentTaskEvidence(progress, item.id))) {
    candidates.push({
      source: 'independent-practice',
      at: progress.taskStats[task.id]?.lastIndependentAt
        || progress.taskStats[task.id]?.completedAt
        || new Date(now).toISOString()
    });
  }

  if (!candidates.some(item => item.source === 'independent-practice')) {
    const legacy = moduleTasks.find(task => progress.completed.includes(task.id));
    if (legacy) {
      candidates.push({
        source: 'legacy-practice',
        at: progress.taskStats[legacy.id]?.completedAt || new Date(now).toISOString()
      });
    }
  }

  return candidates.sort((left, right) =>
    evidenceTime(right) - evidenceTime(left)
    || SOURCE_PRIORITY[right.source] - SOURCE_PRIORITY[left.source]
  )[0] || null;
}

export function introduceReviewSchedule(
  previous: ReviewSchedule,
  evidence: ReviewEvidence | null,
  now = Date.now()
): ReviewSchedule {
  if (previous.introducedAt || !evidence) return previous;
  const evidenceTimestamp = evidenceTime(evidence);
  const introducedAt = evidenceTimestamp
    ? new Date(evidenceTimestamp).toISOString()
    : new Date(now).toISOString();
  const dueAt = evidenceTimestamp && now - evidenceTimestamp >= 10 * MINUTE
    ? new Date(now).toISOString()
    : new Date(now + 10 * MINUTE).toISOString();
  return {
    ...previous,
    introducedAt,
    introductionSource: evidence.source,
    dueAt
  };
}

export function introduceEligibleReviewCards(
  state: ReviewState,
  progress: Progress,
  curriculum: CurriculumProgressV1,
  now = Date.now()
) {
  let changed = false;
  const schedules = { ...state.schedules };
  for (const card of reviewCards) {
    const previous = schedules[card.id] || initialReviewSchedule(card.id);
    const next = introduceReviewSchedule(
      previous,
      reviewEvidenceForModule(card.moduleId, progress, curriculum, now),
      now
    );
    schedules[card.id] = next;
    if (next !== previous) changed = true;
  }
  return { state: { version: 1 as const, schedules }, changed };
}

export function loadReviewState(id = userId(), now = Date.now()): ReviewState {
  let parsed: ReviewState | null = null;
  if (typeof localStorage !== 'undefined') {
    try {
      parsed = JSON.parse(localStorage.getItem(storageKey(id)) || 'null') as ReviewState | null;
    } catch {
      parsed = null;
    }
  }
  const schedules = { ...(parsed?.version === 1 ? parsed.schedules : {}) };
  for (const card of reviewCards) schedules[card.id] ||= initialReviewSchedule(card.id);
  const introduced = introduceEligibleReviewCards(
    { version: 1, schedules },
    loadProgress(),
    loadCurriculumProgress(),
    now
  );
  if (introduced.changed && typeof localStorage !== 'undefined') {
    localStorage.setItem(storageKey(id), JSON.stringify(introduced.state));
  }
  return introduced.state;
}

export function saveReviewState(state: ReviewState, id = userId()) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey(id), JSON.stringify(state));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(REVIEW_CHANGED_EVENT, { detail: state }));
  return state;
}

function addDays(now: number, days: number) {
  return new Date(now + days * DAY).toISOString();
}

export function gradeReviewSchedule(
  previous: ReviewSchedule,
  grade: ReviewGrade,
  now = Date.now()
): ReviewSchedule {
  if (!previous.introducedAt) return previous;
  let intervalDays = previous.intervalDays;
  let ease = previous.ease;
  let repetitions = previous.repetitions;
  let lapses = previous.lapses;
  let dueAt: string;

  if (grade === 'again') {
    intervalDays = 0;
    ease = Math.max(1.3, ease - 0.2);
    repetitions = 0;
    lapses += 1;
    dueAt = new Date(now + 10 * MINUTE).toISOString();
  } else if (grade === 'hard') {
    intervalDays = Math.max(1, Math.round(Math.max(1, intervalDays) * 1.2));
    ease = Math.max(1.3, ease - 0.05);
    repetitions += 1;
    dueAt = addDays(now, intervalDays);
  } else if (grade === 'good') {
    intervalDays = repetitions === 0 ? 1 : repetitions === 1 ? 3 : Math.max(2, Math.round(intervalDays * ease));
    repetitions += 1;
    dueAt = addDays(now, intervalDays);
  } else {
    intervalDays = repetitions === 0 ? 4 : Math.max(4, Math.round(Math.max(1, intervalDays) * (ease + 0.3)));
    ease = Math.min(3.2, ease + 0.1);
    repetitions += 1;
    dueAt = addDays(now, intervalDays);
  }

  return {
    ...previous,
    dueAt,
    intervalDays,
    ease: Math.round(ease * 100) / 100,
    repetitions,
    lapses,
    lastReviewedAt: new Date(now).toISOString()
  };
}

export function gradeReviewCard(cardId: string, grade: ReviewGrade, id = userId(), now = Date.now()) {
  const state = loadReviewState(id, now);
  const previous = state.schedules[cardId] || initialReviewSchedule(cardId);
  const next = gradeReviewSchedule(previous, grade, now);
  if (next === previous) return state;
  state.schedules[cardId] = next;
  return saveReviewState(state, id);
}

export function dueReviewCards(state = loadReviewState(), now = Date.now()): ReviewCard[] {
  return reviewCards
    .filter(card => state.schedules[card.id]?.introducedAt)
    .filter(card => new Date(state.schedules[card.id]?.dueAt || NOT_INTRODUCED_AT).getTime() <= now)
    .sort((left, right) => {
      const leftSchedule = state.schedules[left.id];
      const rightSchedule = state.schedules[right.id];
      return (rightSchedule?.lapses || 0) - (leftSchedule?.lapses || 0)
        || new Date(leftSchedule?.dueAt || 0).getTime() - new Date(rightSchedule?.dueAt || 0).getTime()
        || left.id.localeCompare(right.id);
    });
}

export function nextReviewAt(state = loadReviewState()) {
  const future = Object.values(state.schedules)
    .filter(item => item.introducedAt)
    .map(item => new Date(item.dueAt).getTime())
    .filter(value => Number.isFinite(value))
    .sort((left, right) => left - right);
  return future.length ? new Date(future[0]) : null;
}

export function reviewStats(state = loadReviewState(), now = Date.now()) {
  const schedules = Object.values(state.schedules);
  const available = schedules.filter(item => item.introducedAt);
  return {
    available: available.length,
    due: available.filter(item => new Date(item.dueAt).getTime() <= now).length,
    learned: available.filter(item => item.repetitions > 0).length,
    mature: available.filter(item => item.intervalDays >= 21).length,
    lapses: available.reduce((sum, item) => sum + item.lapses, 0),
    locked: schedules.length - available.length
  };
}
