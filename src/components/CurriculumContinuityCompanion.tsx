import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Link2 } from 'lucide-react';
import { curriculumLessons } from '../data/complete-curriculum';
import { openAcademyLesson } from '../lib/academy-navigation';
import LessonContinuityPanel from './LessonContinuityPanel';

function curriculumSnapshot() {
  const studio = document.querySelector<HTMLElement>('[data-testid="curriculum-studio"]');
  const title = studio?.querySelector<HTMLElement>('.curriculum-lesson-hero h1')?.textContent?.trim();
  const lessonId = title
    ? curriculumLessons.find(lesson => lesson.title === title)?.id || null
    : null;
  return { studio, lessonId };
}

export default function CurriculumContinuityCompanion() {
  const initial = curriculumSnapshot();
  const [studio, setStudio] = useState<HTMLElement | null>(initial.studio);
  const [lessonId, setLessonId] = useState<string | null>(initial.lessonId);
  const [expanded, setExpanded] = useState(false);
  const lesson = useMemo(() => curriculumLessons.find(item => item.id === lessonId) || null, [lessonId]);

  useEffect(() => {
    let frame = 0;
    const sync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = curriculumSnapshot();
        setStudio(current => current === next.studio ? current : next.studio);
        setLessonId(current => current === next.lessonId ? current : next.lessonId);
      });
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    sync();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  if (!studio || !lesson) return null;

  return createPortal(<aside
    className={`curriculum-continuity-companion ${expanded ? 'expanded' : 'collapsed'}`}
    data-testid="curriculum-continuity-companion"
    aria-label="Связность текущего урока"
  >
    <button
      type="button"
      className="curriculum-continuity-toggle"
      aria-expanded={expanded}
      onClick={() => setExpanded(value => !value)}
    >
      <Link2 />
      <span><strong>Связь урока</strong><small>{lesson.title} · от прошлого к следующему evidence</small></span>
      {expanded ? <ChevronDown /> : <ChevronUp />}
    </button>
    {expanded && <div className="curriculum-continuity-body">
      <LessonContinuityPanel lessonId={lesson.id} direction="incoming" onOpenLesson={openAcademyLesson} />
      <LessonContinuityPanel lessonId={lesson.id} direction="outgoing" onOpenLesson={openAcademyLesson} />
    </div>}
  </aside>, studio);
}
