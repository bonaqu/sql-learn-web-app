import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Link2 } from 'lucide-react';
import { curriculumLessons } from '../data/complete-curriculum';
import { openAcademyLesson } from '../lib/academy-navigation';
import LessonContinuityPanel from './LessonContinuityPanel';

function activeLessonId() {
  const studio = document.querySelector<HTMLElement>('[data-testid="curriculum-studio"]');
  const title = studio?.querySelector<HTMLElement>('.curriculum-lesson-hero h1')?.textContent?.trim();
  if (!studio || !title) return null;
  return curriculumLessons.find(lesson => lesson.title === title)?.id || null;
}

export default function CurriculumContinuityCompanion() {
  const [lessonId, setLessonId] = useState<string | null>(() => activeLessonId());
  const [expanded, setExpanded] = useState(false);
  const lesson = useMemo(() => curriculumLessons.find(item => item.id === lessonId) || null, [lessonId]);

  useEffect(() => {
    let frame = 0;
    const sync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = activeLessonId();
        setLessonId(current => current === next ? current : next);
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

  if (!lesson) return null;

  return <aside
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
  </aside>;
}
