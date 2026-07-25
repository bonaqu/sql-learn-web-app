import { reviewCards, type ReviewCard } from '../data/review-cards';
import { loadAuthSession } from './auth';

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

export type ReviewSchedule = {
  cardId: string;
  dueAt: string;
  intervalDays: number;
  ease: number;
  repetitions: number;
  lapses: number;
  lastReviewedAt?: string;
};

export type ReviewState = {
  version: 1;
  schedules: Record<string, ReviewSchedule>;
};

export const REVIEW_CHANGED_EVENT = 'sql-academy-review-changed';
const MINUTE = 60_000;
const DAY = 86_400_000;

function userId() {
  return loadAuthSession()?.userId || 'guest';
}

function storageKey(id = userId()) {
  return `sql-academy-spaced-review-v1:${id}`;
}

function initialSchedule(cardId: string, now = Date.now()): ReviewSchedule {
  return { cardId, dueAt: new Date(now).toISOString(), intervalDays: 0, ease: 2.5, repetitions: 0, lapses: 0 };
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
  for (const card of reviewCards) schedules[card.id] ||= initialSchedule(card.id, now);
  return { version: 1, schedules };
}

export function saveReviewState(state: ReviewState, id = userId()) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey(id), JSON.stringify(state));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(REVIEW_CHANGED_EVENT, { detail: state }));
  return state;
}

function addDays(now: number, days: number) {
  return new Date(now + days * DAY).toISOString();
}

export function gradeReviewCard(cardId: string, grade: ReviewGrade, id = userId(), now = Date.now()) {
  const state = loadReviewState(id, now);
  const previous = state.schedules[cardId] || initialSchedule(cardId, now);
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

  state.schedules[cardId] = {
    ...previous,
    dueAt,
    intervalDays,
    ease: Math.round(ease * 100) / 100,
    repetitions,
    lapses,
    lastReviewedAt: new Date(now).toISOString()
  };
  return saveReviewState(state, id);
}

export function dueReviewCards(state = loadReviewState(), now = Date.now()): ReviewCard[] {
  return reviewCards
    .filter(card => new Date(state.schedules[card.id]?.dueAt || 0).getTime() <= now)
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
    .map(item => new Date(item.dueAt).getTime())
    .filter(value => Number.isFinite(value))
    .sort((left, right) => left - right);
  return future.length ? new Date(future[0]) : null;
}

export function reviewStats(state = loadReviewState(), now = Date.now()) {
  const schedules = Object.values(state.schedules);
  return {
    due: schedules.filter(item => new Date(item.dueAt).getTime() <= now).length,
    learned: schedules.filter(item => item.repetitions > 0).length,
    mature: schedules.filter(item => item.intervalDays >= 21).length,
    lapses: schedules.reduce((sum, item) => sum + item.lapses, 0)
  };
}
