import { randomUUID } from "node:crypto";

export interface LessonInput {
  id?: string;
  title: string;
  duration?: number;
  preview?: boolean;
  videoUrl?: string;
  description?: string;
}

export interface ModuleInput {
  id?: string;
  title: string;
  lessons: LessonInput[];
}

/**
 * Gives every section and lesson a stable id (keeping any the client sent) and
 * derives the lesson count. The count is the single figure progress is
 * measured against, so it must come from the curriculum, never from a field an
 * admin can type into.
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
      preview: Boolean(lesson.preview),
      videoUrl: (lesson.videoUrl ?? "").trim(),
      description: (lesson.description ?? "").trim(),
    })),
  }));

  const lessonIds = normalized.flatMap((m) => m.lessons.map((l) => l.id));
  const totalMinutes = normalized.reduce(
    (sum, m) => sum + m.lessons.reduce((s, l) => s + l.duration, 0),
    0,
  );
  return { curriculum: normalized, lessonCount: lessonIds.length, lessonIds, totalMinutes };
}

/** All lesson ids of a stored course, in order. */
export function lessonIdsOf(course: { curriculum?: { lessons?: { id?: string }[] }[] | null }): string[] {
  return (course.curriculum ?? []).flatMap((m) => (m.lessons ?? []).map((l) => String(l.id)));
}

/**
 * Removes paid video links from a course headed to someone who hasn't bought
 * it. Free-preview lessons keep theirs.
 */
export function stripPaidVideos<T extends Record<string, unknown>>(course: T): T {
  const curriculum = (course.curriculum as ModuleInput[] | undefined) ?? [];
  return {
    ...course,
    curriculum: curriculum.map((m) => ({
      ...m,
      lessons: (m.lessons ?? []).map((l) => ({
        ...l,
        videoUrl: l.preview ? l.videoUrl ?? "" : "",
        hasVideo: Boolean(l.videoUrl),
      })),
    })),
  };
}
