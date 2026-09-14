import { randomUUID } from "node:crypto";

export interface LessonInput {
  id?: string;
  title: string;
  duration?: number;
  /** Where the recording lives — admin-only, emailed to a buyer once paid. */
  videoUrl?: string;
}

export interface ModuleInput {
  id?: string;
  title: string;
  lessons: LessonInput[];
}

/**
 * Gives every section and lesson a stable id (keeping any the client sent) and
 * derives the lesson count for the course card / syllabus. There's no
 * in-app player — this is a marketing syllabus, not something progress is
 * tracked against — but stable ids still make reordering in the admin editor
 * painless, and the video link on each lesson is what the enrollment email
 * pulls from.
 */
export function normalizeCurriculum(curriculum: ModuleInput[]) {
  const seen = new Set<string>();
  const uniqueId = (candidate?: string) => {
    let id = candidate?.trim() || randomUUID();
    while (seen.has(id)) id = randomUUID();
    seen.add(id);
    return id;
  };

  const normalized = curriculum.map((module) => ({
    id: uniqueId(module.id),
    title: module.title.trim(),
    lessons: module.lessons.map((lesson) => ({
      id: uniqueId(lesson.id),
      title: lesson.title.trim(),
      duration: Math.max(0, Math.round(Number(lesson.duration) || 0)),
      videoUrl: (lesson.videoUrl ?? "").trim(),
    })),
  }));

  const lessonCount = normalized.reduce((sum, m) => sum + m.lessons.length, 0);
  const totalMinutes = normalized.reduce(
    (sum, m) => sum + m.lessons.reduce((s, l) => s + l.duration, 0),
    0,
  );
  return { curriculum: normalized, lessonCount, totalMinutes };
}

/** Lesson count of a stored course's curriculum. */
export function lessonCountOf(course: { curriculum?: { lessons?: unknown[] }[] | null }): number {
  return (course.curriculum ?? []).reduce((sum, m) => sum + (m.lessons?.length ?? 0), 0);
}

/**
 * Removes video links from a course headed to the public catalogue — they're
 * for a paying buyer's inbox, not a visitor still deciding whether to buy.
 */
export function stripLessonVideos<T extends Record<string, unknown>>(course: T): T {
  const curriculum = (course.curriculum as { lessons?: LessonInput[] }[] | undefined) ?? [];
  return {
    ...course,
    curriculum: curriculum.map((m) => ({
      ...m,
      lessons: (m.lessons ?? []).map(({ videoUrl: _videoUrl, ...lesson }) => lesson),
    })),
  };
}
