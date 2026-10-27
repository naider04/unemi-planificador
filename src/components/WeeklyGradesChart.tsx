import React, { useState, useMemo } from 'react';
import { TodoTask } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { TrendingUp, Award, Calendar, AlertCircle, BookOpen, GraduationCap, X } from 'lucide-react';

interface WeeklyGradesChartProps {
  tasks: TodoTask[];
  firstWeekDate?: string;
  selectedAccounts?: string[];
  liveCoursesByAccount?: Record<string, Set<string>>;
}

interface EvaluatedActivity {
  id: string;
  title: string;
  courseName?: string;
  courseId?: string;
  careerId: string;
  careerName: string;
  grade: number;
  gradeOver: number;
  percentage: number;
  isOverdueUnsubmitted: boolean;
}

interface WeekGradePoint {
  weekNumber: number;
  weekLabel: string;
  mondayTime: number;
  dateRangeLabel: string;
  activities: EvaluatedActivity[];
  sumGrades: number;
  sumMaxGrades: number;
  avgPercentage: number;
  avgGrade10: number;
}

interface SeriesPoint {
  weekIndex: number;
  weekNumber: number;
  x: number;
  y: number;
  avgPercentage: number;
  avgGrade10: number;
  sumGrades: number;
  sumMaxGrades: number;
  activities: EvaluatedActivity[];
}

interface ChartSeries {
  id: string;
  name: string;
  subLabel?: string;
  color: string;
  dashStyle: string;
  careerId?: string;
  careerName?: string;
  points: SeriesPoint[];
  overallPercentage: number;
  overallGrade10: number;
  totalActivities: number;
}

type SeparationMode = 'general' | 'subject' | 'career';

const CAREER_PALETTE = [
  '#2563eb', // Blue
  '#059669', // Emerald
  '#7c3aed', // Violet
  '#d97706', // Amber
  '#db2777', // Pink
  '#0891b2', // Cyan
  '#ea580c', // Orange
  '#4f46e5', // Indigo
];

const SUBJECT_PALETTE = [
  '#2563eb', // Blue
  '#10b981', // Emerald
  '#8b5cf6', // Violet
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#f97316', // Orange
  '#6366f1', // Indigo
  '#14b8a6', // Teal
  '#84cc16', // Lime
  '#e11d48', // Rose
  '#0284c7', // Sky
];

export default function WeeklyGradesChart({
  tasks,
  firstWeekDate,
  selectedAccounts = [],
  liveCoursesByAccount,
}: WeeklyGradesChartProps) {
  const { t, language } = useLanguage();
  const [separationMode, setSeparationMode] = useState<SeparationMode>('general');
  const [hoveredWeekIndex, setHoveredWeekIndex] = useState<number | null>(null);
  const [hoveredSeriesId, setHoveredSeriesId] = useState<string | null>(null);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);

  // Helper to parse Moodle grade strings (stripping html tags and entities)
  const parseVal = (v: string | null | undefined): number | null => {
    if (v === null || v === undefined) return null;
    const clean = String(v)
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#0?160;/gi, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/,/g, '.')
      .trim();
    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
  };

  const PAST_SEMESTER_GRACE_MS = 21 * 24 * 60 * 60 * 1000;
  const nowTime = Date.now();

  const isCurrentSubject = (task: TodoTask): boolean => {
    if (!task.courseId) return true;
    const liveIds = liveCoursesByAccount?.[`${task.moodleServer || ''}|${(task.moodleUsername || '').toLowerCase()}`];
    if (!liveIds) {
      if (!task.closureDate) return false;
      return new Date(task.closureDate).getTime() >= nowTime - PAST_SEMESTER_GRACE_MS;
    }
    return liveIds.has(String(task.courseId));
  };

  const getTaskAccountKey = (task: TodoTask): string => {
    if (task.moodleUsername) {
      return `${task.moodleServer || 'a'}_${task.moodleUsername.trim().toLowerCase()}`;
    }
    return 'manual';
  };

  // Helper to get career information from task
  const getTaskCareer = (task: TodoTask): { id: string; name: string; serverLabel: string; username: string } => {
    const username = (task.moodleUsername || '').trim();
    const server = task.moodleServer || 'a';
    const serverLabel = server === 'upsdt'
      ? 'UPSDT'
      : (server === 'a' ? 'UNEMI P/S' : (server === 'b' ? 'UNEMI Online' : 'UNEMI'));

    if (username) {
      const id = `${server}_${username.toLowerCase()}`;
      return {
        id,
        name: `${serverLabel}${username ? ` (${username})` : ''}`,
        serverLabel,
        username,
      };
    }
    return {
      id: 'manual',
      name: language === 'es' ? 'Manual' : 'Manual',
      serverLabel: language === 'es' ? 'Manual' : 'Manual',
      username: '',
    };
  };

  // 1. Process all evaluated activities and structure them
  const {
    allEvaluatedActivities,
    allWeeks,
    uniqueCareers,
    uniqueSubjects,
  } = useMemo(() => {
    const startDateStr = firstWeekDate || '2026-04-13';
    const [sy, sm, sd] = startDateStr.split('-').map(Number);
    const basingDate = new Date(sy || 2026, (sm || 4) - 1, sd || 13, 0, 0, 0);
    const baseDay = basingDate.getDay();
    const baseDiffToMonday = baseDay === 0 ? -6 : 1 - baseDay;
    const basingMonday = new Date(basingDate);
    basingMonday.setDate(basingDate.getDate() + baseDiffToMonday);
    basingMonday.setHours(0, 0, 0, 0);

    const msInWeek = 7 * 24 * 60 * 60 * 1000;
    const now = new Date();

    const evaluated: (EvaluatedActivity & { weekNumber: number; mondayTime: number; dateRangeLabel: string; weekLabel: string })[] = [];
    const weeksMap: Record<number, {
      weekNumber: number;
      weekLabel: string;
      mondayTime: number;
      dateRangeLabel: string;
      activities: EvaluatedActivity[];
      sumGrades: number;
      sumMaxGrades: number;
    }> = {};

    const careersMap = new Map<string, { id: string; name: string; serverLabel: string; username: string }>();
    const subjectsMap = new Map<string, { id: string; name: string; careerId: string; careerName: string }>();

    tasks.forEach(task => {
      if (!isCurrentSubject(task)) return;

      if (selectedAccounts.length > 0 && !selectedAccounts.includes(getTaskAccountKey(task))) {
        return;
      }

      if (!task.closureDate) return;

      const grade = parseVal(task.grade);
      const gradeOver = parseVal(task.gradeOver) ?? 10.0;
      const isOverdueUnsubmitted = !task.completed && new Date(task.closureDate) < now;

      let isEvaluated = false;
      let earnedGrade = 0;

      if (grade !== null) {
        isEvaluated = true;
        earnedGrade = grade;
      } else if (isOverdueUnsubmitted) {
        isEvaluated = true;
        earnedGrade = 0;
      }

      if (!isEvaluated) return;

      const career = getTaskCareer(task);
      if (!careersMap.has(career.id)) {
        careersMap.set(career.id, career);
      }

      const subjectId = task.courseId ? String(task.courseId) : (task.courseName?.trim() || 'manual');
      const subjectName = task.courseName?.trim() || (task.courseId ? `Curso ${task.courseId}` : (language === 'es' ? 'Sin Asignatura' : 'No Subject'));

      if (!subjectsMap.has(subjectId)) {
        subjectsMap.set(subjectId, {
          id: subjectId,
          name: subjectName,
          careerId: career.id,
          careerName: career.name,
        });
      }

      // Calculate Monday of closureDate
      const d = new Date(task.closureDate);
      const day = d.getDay();
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const monday = new Date(d);
      monday.setDate(d.getDate() + diffToMonday);
      monday.setHours(0, 0, 0, 0);

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const weekIndex = Math.floor((monday.getTime() - basingMonday.getTime()) / msInWeek);
      const weekNumber = weekIndex + 1;

      const monthNamesEs = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
      const monthNamesEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const mNames = language === 'es' ? monthNamesEs : monthNamesEn;

      const dateRangeLabel = `${monday.getDate()} ${mNames[monday.getMonth()]} - ${sunday.getDate()} ${mNames[sunday.getMonth()]}`;
      const weekLabel = weekNumber > 0
        ? `${language === 'es' ? 'Semana' : 'Week'} ${weekNumber}`
        : (language === 'es' ? 'Semana Indefinida' : 'Special Week');

      const pct = gradeOver > 0 ? (earnedGrade / gradeOver) * 100 : 0;

      const item: EvaluatedActivity = {
        id: task.id,
        title: task.title,
        courseName: task.courseName,
        courseId: task.courseId ? String(task.courseId) : undefined,
        careerId: career.id,
        careerName: career.name,
        grade: earnedGrade,
        gradeOver,
        percentage: pct,
        isOverdueUnsubmitted,
      };

      evaluated.push({
        ...item,
        weekNumber,
        mondayTime: monday.getTime(),
        dateRangeLabel,
        weekLabel,
      });

      if (!weeksMap[weekNumber]) {
        weeksMap[weekNumber] = {
          weekNumber,
          weekLabel,
          mondayTime: monday.getTime(),
          dateRangeLabel,
          activities: [],
          sumGrades: 0,
          sumMaxGrades: 0,
        };
      }

      weeksMap[weekNumber].activities.push(item);
      weeksMap[weekNumber].sumGrades += earnedGrade;
      weeksMap[weekNumber].sumMaxGrades += gradeOver;
    });

    const sortedWeeks: WeekGradePoint[] = Object.values(weeksMap)
      .map(w => ({
        ...w,
        avgPercentage: w.sumMaxGrades > 0 ? (w.sumGrades / w.sumMaxGrades) * 100 : 0,
        avgGrade10: w.sumMaxGrades > 0 ? (w.sumGrades / w.sumMaxGrades) * 10 : 0,
      }))
      .sort((a, b) => a.mondayTime - b.mondayTime);

    // Clean up career display names: if all careers have distinct serverLabel, use serverLabel
    const careerList = Array.from(careersMap.values());
    const serverCounts: Record<string, number> = {};
    careerList.forEach(c => {
      serverCounts[c.serverLabel] = (serverCounts[c.serverLabel] || 0) + 1;
    });
    careerList.forEach(c => {
      if (serverCounts[c.serverLabel] === 1 && c.id !== 'manual') {
        c.name = c.serverLabel;
      }
    });

    const subjectList = Array.from(subjectsMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    return {
      allEvaluatedActivities: evaluated,
      allWeeks: sortedWeeks,
      uniqueCareers: careerList,
      uniqueSubjects: subjectList,
    };
  }, [tasks, firstWeekDate, selectedAccounts, liveCoursesByAccount, language]);

  // Separation conditions
  const canSeparateBySubject = uniqueSubjects.length > 1;
  const canSeparateByCareer = uniqueCareers.length > 1;

  // Available modes
  const availableModes = useMemo<SeparationMode[]>(() => {
    const modes: SeparationMode[] = ['general'];
    if (canSeparateBySubject) modes.push('subject');
    if (canSeparateByCareer) modes.push('career');
    return modes;
  }, [canSeparateBySubject, canSeparateByCareer]);

  // Fallback to general if currently selected mode is no longer available
  const effectiveMode = useMemo<SeparationMode>(() => {
    if (separationMode === 'subject' && !canSeparateBySubject) return 'general';
    if (separationMode === 'career' && !canSeparateByCareer) return 'general';
    return separationMode;
  }, [separationMode, canSeparateBySubject, canSeparateByCareer]);

  // Color assignments:
  // 1) Career color map
  const careerColorMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    uniqueCareers.forEach((career, idx) => {
      map[career.id] = CAREER_PALETTE[idx % CAREER_PALETTE.length];
    });
    return map;
  }, [uniqueCareers]);

  // 2) Subject color & dash style map:
  // - If user has MORE than 1 career:
  //   "when separated by subject use the same color on subjects that belong to the same career"
  // - If user has ONLY 1 career:
  //   "when separated by subject and the user doesn't have more than just one career then color anyhow you want"
  const { subjectColorMap, subjectDashMap } = useMemo(() => {
    const colorMap: Record<string, string> = {};
    const dashMap: Record<string, string> = {};

    if (canSeparateByCareer) {
      // Multiple careers: Use the career's color for all subjects of that career
      const DASH_STYLES = ['', '6 3', '2 2', '8 3 2 3', '10 4'];
      const subjectsCountPerCareer: Record<string, number> = {};

      uniqueSubjects.forEach(subject => {
        colorMap[subject.id] = careerColorMap[subject.careerId] || CAREER_PALETTE[0];
        const count = subjectsCountPerCareer[subject.careerId] || 0;
        dashMap[subject.id] = DASH_STYLES[count % DASH_STYLES.length];
        subjectsCountPerCareer[subject.careerId] = count + 1;
      });
    } else {
      // Single career: Color each subject distinctively
      uniqueSubjects.forEach((subject, idx) => {
        colorMap[subject.id] = SUBJECT_PALETTE[idx % SUBJECT_PALETTE.length];
        dashMap[subject.id] = '';
      });
    }

    return { subjectColorMap: colorMap, subjectDashMap: dashMap };
  }, [canSeparateByCareer, uniqueSubjects, careerColorMap]);

  // SVG Layout Dimensions
  const svgWidth = 720;
  const svgHeight = 260;
  const padLeft = 45;
  const padRight = 35;
  const padTop = 25;
  const padBottom = 45;
  const innerWidth = svgWidth - padLeft - padRight;
  const innerHeight = svgHeight - padTop - padBottom;

  const getY = (percentage: number) => {
    const clamped = Math.max(0, Math.min(100, percentage));
    return padTop + innerHeight * (1 - clamped / 100);
  };

  const getX = (index: number) => {
    if (allWeeks.length <= 1) return padLeft + innerWidth / 2;
    return padLeft + (innerWidth / (allWeeks.length - 1)) * index;
  };

  // Build series depending on effectiveMode
  const chartSeriesList = useMemo<ChartSeries[]>(() => {
    if (allWeeks.length === 0) return [];

    if (effectiveMode === 'general') {
      const points: SeriesPoint[] = allWeeks.map((week, idx) => ({
        weekIndex: idx,
        weekNumber: week.weekNumber,
        x: getX(idx),
        y: getY(week.avgPercentage),
        avgPercentage: week.avgPercentage,
        avgGrade10: week.avgGrade10,
        sumGrades: week.sumGrades,
        sumMaxGrades: week.sumMaxGrades,
        activities: week.activities,
      }));

      const totalSum = allWeeks.reduce((acc, w) => acc + w.sumGrades, 0);
      const totalMax = allWeeks.reduce((acc, w) => acc + w.sumMaxGrades, 0);
      const overallPercentage = totalMax > 0 ? (totalSum / totalMax) * 100 : 0;

      return [{
        id: 'general',
        name: language === 'es' ? 'Promedio General' : 'Overall Average',
        color: '#2563eb',
        dashStyle: '',
        points,
        overallPercentage,
        overallGrade10: (overallPercentage / 100) * 10,
        totalActivities: allWeeks.reduce((acc, w) => acc + w.activities.length, 0),
      }];
    }

    if (effectiveMode === 'career') {
      return uniqueCareers.map(career => {
        const points: SeriesPoint[] = [];
        let totalGrades = 0;
        let totalMax = 0;
        let totalActs = 0;

        allWeeks.forEach((week, idx) => {
          const acts = week.activities.filter(a => a.careerId === career.id);
          if (acts.length > 0) {
            const sumG = acts.reduce((acc, a) => acc + a.grade, 0);
            const sumM = acts.reduce((acc, a) => acc + a.gradeOver, 0);
            const pct = sumM > 0 ? (sumG / sumM) * 100 : 0;
            totalGrades += sumG;
            totalMax += sumM;
            totalActs += acts.length;

            points.push({
              weekIndex: idx,
              weekNumber: week.weekNumber,
              x: getX(idx),
              y: getY(pct),
              avgPercentage: pct,
              avgGrade10: (pct / 100) * 10,
              sumGrades: sumG,
              sumMaxGrades: sumM,
              activities: acts,
            });
          }
        });

        const overallPct = totalMax > 0 ? (totalGrades / totalMax) * 100 : 0;

        return {
          id: career.id,
          name: career.name,
          color: careerColorMap[career.id] || '#2563eb',
          dashStyle: '',
          careerId: career.id,
          points,
          overallPercentage: overallPct,
          overallGrade10: (overallPct / 100) * 10,
          totalActivities: totalActs,
        };
      }).filter(s => s.points.length > 0);
    }

    // effectiveMode === 'subject'
    return uniqueSubjects.map(subject => {
      const points: SeriesPoint[] = [];
      let totalGrades = 0;
      let totalMax = 0;
      let totalActs = 0;

      allWeeks.forEach((week, idx) => {
        const acts = week.activities.filter(a => {
          const sId = a.courseId ? String(a.courseId) : (a.courseName?.trim() || 'manual');
          return sId === subject.id;
        });

        if (acts.length > 0) {
          const sumG = acts.reduce((acc, a) => acc + a.grade, 0);
          const sumM = acts.reduce((acc, a) => acc + a.gradeOver, 0);
          const pct = sumM > 0 ? (sumG / sumM) * 100 : 0;
          totalGrades += sumG;
          totalMax += sumM;
          totalActs += acts.length;

          points.push({
            weekIndex: idx,
            weekNumber: week.weekNumber,
            x: getX(idx),
            y: getY(pct),
            avgPercentage: pct,
            avgGrade10: (pct / 100) * 10,
            sumGrades: sumG,
            sumMaxGrades: sumM,
            activities: acts,
          });
        }
      });

      const overallPct = totalMax > 0 ? (totalGrades / totalMax) * 100 : 0;

      return {
        id: subject.id,
        name: subject.name,
        subLabel: canSeparateByCareer ? subject.careerName : undefined,
        color: subjectColorMap[subject.id] || '#2563eb',
        dashStyle: subjectDashMap[subject.id] || '',
        careerId: subject.careerId,
        careerName: subject.careerName,
        points,
        overallPercentage: overallPct,
        overallGrade10: (overallPct / 100) * 10,
        totalActivities: totalActs,
      };
    }).filter(s => s.points.length > 0);
  }, [allWeeks, effectiveMode, uniqueCareers, uniqueSubjects, careerColorMap, subjectColorMap, subjectDashMap, canSeparateByCareer, language]);

  // Derived metrics for summary chip headers in general mode
  const bestWeek = useMemo(() => {
    if (allWeeks.length === 0) return null;
    return [...allWeeks].sort((a, b) => b.avgPercentage - a.avgPercentage)[0];
  }, [allWeeks]);

  const lowestWeek = useMemo(() => {
    if (allWeeks.length === 0) return null;
    return [...allWeeks].sort((a, b) => a.avgPercentage - b.avgPercentage)[0];
  }, [allWeeks]);

  // Helper to construct smooth bezier line path from points
  const buildSmoothPath = (pts: { x: number; y: number }[]): string => {
    if (pts.length < 2) return '';
    return pts.reduce((acc, curr, idx) => {
      if (idx === 0) return `M ${curr.x} ${curr.y}`;
      const prev = pts[idx - 1];
      const cx1 = prev.x + (curr.x - prev.x) / 3;
      const cy1 = prev.y;
      const cx2 = curr.x - (curr.x - prev.x) / 3;
      const cy2 = curr.y;
      return `${acc} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${curr.x} ${curr.y}`;
    }, '');
  };

  // General mode area fill path
  const generalAreaPathD = useMemo(() => {
    if (effectiveMode !== 'general' || chartSeriesList.length === 0) return '';
    const pts = chartSeriesList[0].points;
    if (pts.length < 2) return '';
    const lineD = buildSmoothPath(pts);
    const bottomY = padTop + innerHeight;
    const first = pts[0];
    const last = pts[pts.length - 1];
    return `${lineD} L ${last.x} ${bottomY} L ${first.x} ${bottomY} Z`;
  }, [effectiveMode, chartSeriesList, innerHeight]);

  const yAxisTicks = [0, 25, 50, 75, 100];
  const passingY = getY(70);

  // Active week for hover details card
  const activeWeek = hoveredWeekIndex !== null && allWeeks[hoveredWeekIndex] ? allWeeks[hoveredWeekIndex] : null;

  return (
    <div className="bg-white border border-slate-200/90 rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
      
      {/* Header with Title and Mode Switch */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="space-y-1">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <TrendingUp className="w-4 h-4 stroke-[2.2]" />
            </div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
              {t('weekly.title', 'Evolución Semanal de Calificaciones')}
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            {t('weekly.subtitle', 'Promedio semanal de actividades evaluadas. Tareas no entregadas vencidas cuentan como 0.')}
          </p>
        </div>

        {/* Dynamic Mode Switcher: Only render buttons that are possible to separate */}
        {availableModes.length > 1 && (
          <div className="flex items-center space-x-1 self-start sm:self-center bg-slate-100/80 p-1 rounded-xl border border-slate-200/60 text-xs font-semibold select-none">
            {/* General Mode Button */}
            <button
              type="button"
              onClick={() => {
                setSeparationMode('general');
                setSelectedSeriesId(null);
              }}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                effectiveMode === 'general'
                  ? 'bg-white text-blue-600 font-bold shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {t('weekly.modeGeneral', 'General')}
            </button>

            {/* Separated by Subject Button: Only shown if uniqueSubjects > 1 */}
            {canSeparateBySubject && (
              <button
                type="button"
                onClick={() => {
                  setSeparationMode('subject');
                  setSelectedSeriesId(null);
                }}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer flex items-center space-x-1.5 ${
                  effectiveMode === 'subject'
                    ? 'bg-white text-blue-600 font-bold shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>{t('weekly.modeSubject', 'Materias')}</span>
                <span className="text-[10px] opacity-75 font-mono px-1 py-0.2 bg-slate-200/70 rounded">
                  {uniqueSubjects.length}
                </span>
              </button>
            )}

            {/* Separated by Career Button: Only shown if uniqueCareers > 1 */}
            {canSeparateByCareer && (
              <button
                type="button"
                onClick={() => {
                  setSeparationMode('career');
                  setSelectedSeriesId(null);
                }}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer flex items-center space-x-1.5 ${
                  effectiveMode === 'career'
                    ? 'bg-white text-blue-600 font-bold shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>{t('weekly.modeCareer', 'Carreras')}</span>
                <span className="text-[10px] opacity-75 font-mono px-1 py-0.2 bg-slate-200/70 rounded">
                  {uniqueCareers.length}
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Summary chips */}
      {allWeeks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 font-semibold text-slate-600 flex items-center space-x-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>
              {allWeeks.length === 1 
                ? t('weekly.evaluatedWeek', { count: allWeeks.length })
                : t('weekly.evaluatedWeeks', { count: allWeeks.length })}
            </span>
          </span>

          {effectiveMode === 'general' && bestWeek && (
            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold flex items-center space-x-1.5">
              <Award className="w-3.5 h-3.5 text-emerald-600" />
              <span>
                {t('weekly.best', 'Mejor:')} <strong>{bestWeek.weekLabel}</strong> ({bestWeek.avgPercentage.toFixed(1)}%)
              </span>
            </span>
          )}

          {effectiveMode === 'general' && lowestWeek && allWeeks.length > 1 && (
            <span className="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-semibold flex items-center space-x-1.5">
              <span>
                {t('weekly.lowest', 'Más baja:')} <strong>{lowestWeek.weekLabel}</strong> ({lowestWeek.avgPercentage.toFixed(1)}%)
              </span>
            </span>
          )}

          {effectiveMode !== 'general' && (
            <span className="px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 font-semibold flex items-center space-x-1.5">
              {effectiveMode === 'career' ? (
                <>
                  <GraduationCap className="w-3.5 h-3.5 text-blue-600" />
                  <span>{uniqueCareers.length} {language === 'es' ? 'carreras comparadas' : 'careers compared'}</span>
                </>
              ) : (
                <>
                  <BookOpen className="w-3.5 h-3.5 text-blue-600" />
                  <span>{uniqueSubjects.length} {language === 'es' ? 'materias comparadas' : 'subjects compared'}</span>
                </>
              )}
            </span>
          )}

          {selectedSeriesId && (
            <button
              type="button"
              onClick={() => setSelectedSeriesId(null)}
              className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-semibold flex items-center space-x-1.5 hover:bg-amber-100 transition-colors cursor-pointer"
            >
              <span>{t('weekly.resetFilter', 'Mostrar todas')}</span>
              <X className="w-3 h-3" />
            </button>
          )}

          <span className="text-[11px] text-slate-400 ml-auto hidden sm:inline">
            <span className="inline-block w-2.5 h-0.5 bg-amber-500 mr-1 align-middle" />
            {t('weekly.passingMin', '70% / 7.0 Mínimo Aprobatorio')}
          </span>
        </div>
      )}

      {/* SVG Canvas or Empty State */}
      {allWeeks.length === 0 ? (
        <div className="bg-slate-50/60 border border-dashed border-slate-200 rounded-2xl p-8 text-center space-y-2">
          <AlertCircle className="w-7 h-7 text-slate-300 mx-auto" />
          <p className="text-xs font-bold text-slate-700">
            {t('weekly.emptyTitle', 'Aún no hay semanas con actividades evaluadas o vencidas')}
          </p>
          <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
            {t('weekly.emptyDesc', 'Los puntos se graficarán automáticamente conforme se registren calificaciones en Moodle o venzan plazos de entrega.')}
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Responsive SVG Graphic */}
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full h-auto min-w-[550px] select-none"
            >
              <defs>
                <linearGradient id="weeklyGradeAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                </linearGradient>

                <filter id="pointShadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.15" />
                </filter>
              </defs>

              {/* Horizontal Grid lines and Y-axis labels */}
              {yAxisTicks.map(tick => {
                const y = getY(tick);
                return (
                  <g key={tick}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={svgWidth - padRight}
                      y2={y}
                      stroke={tick === 0 ? '#cbd5e1' : '#f1f5f9'}
                      strokeWidth={tick === 0 ? '1.5' : '1'}
                      strokeDasharray={tick === 0 ? undefined : '3 3'}
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 3.5}
                      textAnchor="end"
                      className="text-[10px] fill-slate-400 font-mono font-semibold"
                    >
                      {`${tick}%`}
                    </text>
                  </g>
                );
              })}

              {/* 70% Passing Threshold Line */}
              <line
                x1={padLeft}
                y1={passingY}
                x2={svgWidth - padRight}
                y2={passingY}
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                opacity="0.75"
              />

              {/* Area fill under curve (General Mode only) */}
              {generalAreaPathD && (
                <path d={generalAreaPathD} fill="url(#weeklyGradeAreaGradient)" />
              )}

              {/* Vertical Guide Line on Week Hover */}
              {hoveredWeekIndex !== null && (
                <line
                  x1={getX(hoveredWeekIndex)}
                  y1={padTop}
                  x2={getX(hoveredWeekIndex)}
                  y2={padTop + innerHeight}
                  stroke="#94a3b8"
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                />
              )}

              {/* Render Lines for each Series */}
              {chartSeriesList.map(series => {
                const isHovered = hoveredSeriesId === series.id;
                const isSelected = selectedSeriesId === series.id;
                const isDimmed = (hoveredSeriesId !== null && !isHovered) || (selectedSeriesId !== null && !isSelected);

                const strokeWidth = isHovered || isSelected ? 3.5 : (effectiveMode === 'general' ? 3 : 2.2);
                const opacity = isDimmed ? 0.2 : (isHovered || isSelected ? 1 : 0.85);

                const lineD = buildSmoothPath(series.points);

                return (
                  <g key={series.id} className="transition-opacity duration-150">
                    {/* Connecting curve */}
                    {lineD && (
                      <path
                        d={lineD}
                        fill="none"
                        stroke={series.color}
                        strokeWidth={strokeWidth}
                        strokeDasharray={series.dashStyle || undefined}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={opacity}
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredSeriesId(series.id)}
                        onMouseLeave={() => setHoveredSeriesId(null)}
                        onClick={() => setSelectedSeriesId(selectedSeriesId === series.id ? null : series.id)}
                      />
                    )}

                    {/* Points along this series */}
                    {series.points.map(pt => {
                      const isWeekActive = hoveredWeekIndex === pt.weekIndex;
                      const isPointHovered = isWeekActive && (isHovered || hoveredSeriesId === null);
                      const isPassing = pt.avgPercentage >= 70;
                      const isExcellent = pt.avgPercentage >= 90;

                      // Fill color:
                      // In general mode, reflect grade health; in separated mode, use the series color
                      const ptFillColor = effectiveMode === 'general'
                        ? (isExcellent ? '#10b981' : isPassing ? '#3b82f6' : '#ef4444')
                        : series.color;

                      return (
                        <g
                          key={`${series.id}_${pt.weekNumber}`}
                          className="cursor-pointer"
                          onMouseEnter={() => {
                            setHoveredWeekIndex(pt.weekIndex);
                            setHoveredSeriesId(series.id);
                          }}
                          onMouseLeave={() => {
                            setHoveredSeriesId(null);
                          }}
                          onClick={() => setSelectedSeriesId(selectedSeriesId === series.id ? null : series.id)}
                        >
                          {/* Point Glow on Hover */}
                          {isPointHovered && (
                            <circle
                              cx={pt.x}
                              cy={pt.y}
                              r="11"
                              fill={ptFillColor}
                              opacity="0.28"
                            />
                          )}

                          {/* Outer halo for isolated points with only 1 week */}
                          {series.points.length === 1 && (
                            <circle
                              cx={pt.x}
                              cy={pt.y}
                              r="8"
                              fill="none"
                              stroke={ptFillColor}
                              strokeWidth="1.5"
                              strokeDasharray="2 2"
                              opacity={opacity}
                            />
                          )}

                          {/* Main point circle */}
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r={isPointHovered ? 6.5 : (effectiveMode === 'general' ? 5 : 4)}
                            fill={ptFillColor}
                            stroke="#ffffff"
                            strokeWidth={isPointHovered ? 2.5 : 2}
                            filter="url(#pointShadow)"
                            opacity={opacity}
                          />

                          {/* Value label directly above point in general mode */}
                          {effectiveMode === 'general' && (
                            <text
                              x={pt.x}
                              y={pt.y - 10}
                              textAnchor="middle"
                              className={`text-[10px] font-mono font-bold select-none ${
                                isExcellent ? 'fill-emerald-700' : isPassing ? 'fill-blue-700' : 'fill-rose-600'
                              }`}
                            >
                              {`${pt.avgPercentage.toFixed(1)}%`}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                );
              })}

              {/* X-axis week labels and interactive hover columns */}
              {allWeeks.map((week, idx) => {
                const x = getX(idx);
                const isHovered = hoveredWeekIndex === idx;

                return (
                  <g key={week.weekNumber}>
                    {/* Transparent column hit-test rect for smooth hover */}
                    <rect
                      x={x - (innerWidth / (allWeeks.length || 1)) / 2}
                      y={padTop}
                      width={innerWidth / (allWeeks.length || 1)}
                      height={innerHeight + padBottom}
                      fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredWeekIndex(idx)}
                      onClick={() => setHoveredWeekIndex(hoveredWeekIndex === idx ? null : idx)}
                    />

                    {/* Week label */}
                    <text
                      x={x}
                      y={padTop + innerHeight + 16}
                      textAnchor="middle"
                      className={`text-[11px] select-none pointer-events-none ${
                        isHovered ? 'font-black fill-blue-700' : 'font-bold fill-slate-700'
                      }`}
                    >
                      {`Sem ${week.weekNumber}`}
                    </text>

                    {/* Date range sublabel */}
                    <text
                      x={x}
                      y={padTop + innerHeight + 28}
                      textAnchor="middle"
                      className="text-[9px] fill-slate-400 font-mono select-none pointer-events-none"
                    >
                      {week.dateRangeLabel.split('-')[0].trim()}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Interactive Legend for Separated Modes */}
          {effectiveMode !== 'general' && (
            <div className="pt-2 border-t border-slate-100">
              {effectiveMode === 'career' ? (
                /* Career Legend */
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      {t('weekly.modeCareer', 'Carreras')} ({uniqueCareers.length})
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {language === 'es' ? 'Haz click para aislar una carrera' : 'Click to isolate a career'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {chartSeriesList.map(series => {
                      const isHovered = hoveredSeriesId === series.id;
                      const isSelected = selectedSeriesId === series.id;
                      const isDimmed = (hoveredSeriesId !== null && !isHovered) || (selectedSeriesId !== null && !isSelected);

                      return (
                        <button
                          key={series.id}
                          type="button"
                          onMouseEnter={() => setHoveredSeriesId(series.id)}
                          onMouseLeave={() => setHoveredSeriesId(null)}
                          onClick={() => setSelectedSeriesId(isSelected ? null : series.id)}
                          className={`flex items-center space-x-2 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-blue-50/80 border-blue-400 shadow-xs'
                              : isDimmed
                              ? 'opacity-40 border-slate-200 bg-slate-50'
                              : 'bg-white border-slate-200/80 hover:border-slate-300'
                          }`}
                        >
                          <span
                            className="w-3 h-3 rounded-full shrink-0 shadow-2xs"
                            style={{ backgroundColor: series.color }}
                          />
                          <span className="text-slate-800">{series.name}</span>
                          <span className="font-mono text-[11px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded">
                            {series.overallPercentage.toFixed(1)}%
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Subject Legend */
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      {t('weekly.modeSubject', 'Materias')} ({uniqueSubjects.length})
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {canSeparateByCareer
                        ? (language === 'es' ? 'Materias de la misma carrera comparten el mismo color' : 'Subjects from the same career share color')
                        : (language === 'es' ? 'Haz click para aislar una materia' : 'Click to isolate a subject')}
                    </span>
                  </div>

                  {canSeparateByCareer ? (
                    /* Grouped by Career */
                    <div className="space-y-2">
                      {uniqueCareers.map(career => {
                        const careerColor = careerColorMap[career.id] || '#2563eb';
                        const subjectsInCareer = chartSeriesList.filter(s => s.careerId === career.id);
                        if (subjectsInCareer.length === 0) return null;

                        return (
                          <div
                            key={career.id}
                            className="p-2.5 rounded-2xl bg-slate-50/60 border border-slate-200/70 space-y-1.5"
                          >
                            <div className="flex items-center space-x-2">
                              <span
                                className="w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: careerColor }}
                              />
                              <span className="text-xs font-bold text-slate-800">
                                {career.name}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                ({subjectsInCareer.length} {language === 'es' ? 'materias' : 'subjects'})
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 pl-4">
                              {subjectsInCareer.map(series => {
                                const isHovered = hoveredSeriesId === series.id;
                                const isSelected = selectedSeriesId === series.id;
                                const isDimmed = (hoveredSeriesId !== null && !isHovered) || (selectedSeriesId !== null && !isSelected);

                                return (
                                  <button
                                    key={series.id}
                                    type="button"
                                    onMouseEnter={() => setHoveredSeriesId(series.id)}
                                    onMouseLeave={() => setHoveredSeriesId(null)}
                                    onClick={() => setSelectedSeriesId(isSelected ? null : series.id)}
                                    className={`flex items-center space-x-1.5 px-2 py-1 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                                      isSelected
                                        ? 'bg-blue-50 border-blue-400 shadow-xs'
                                        : isDimmed
                                        ? 'opacity-40 border-slate-200 bg-white'
                                        : 'bg-white border-slate-200 hover:border-slate-300'
                                    }`}
                                  >
                                    <span
                                      className="inline-block w-3 h-1 rounded shrink-0"
                                      style={{
                                        backgroundColor: series.color,
                                        borderBottom: series.dashStyle ? '1px dashed #ffffff' : undefined,
                                      }}
                                    />
                                    <span className="text-slate-800 truncate max-w-[170px]" title={series.name}>
                                      {series.name}
                                    </span>
                                    <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1 py-0.2 rounded">
                                      {series.overallPercentage.toFixed(1)}%
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Single Career: Flat list with distinctive vibrant colors */
                    <div className="flex flex-wrap items-center gap-2">
                      {chartSeriesList.map(series => {
                        const isHovered = hoveredSeriesId === series.id;
                        const isSelected = selectedSeriesId === series.id;
                        const isDimmed = (hoveredSeriesId !== null && !isHovered) || (selectedSeriesId !== null && !isSelected);

                        return (
                          <button
                            key={series.id}
                            type="button"
                            onMouseEnter={() => setHoveredSeriesId(series.id)}
                            onMouseLeave={() => setHoveredSeriesId(null)}
                            onClick={() => setSelectedSeriesId(isSelected ? null : series.id)}
                            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-blue-50/80 border-blue-400 shadow-xs'
                                : isDimmed
                                ? 'opacity-40 border-slate-200 bg-slate-50'
                                : 'bg-white border-slate-200/80 hover:border-slate-300'
                            }`}
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs"
                              style={{ backgroundColor: series.color }}
                            />
                            <span className="text-slate-800 truncate max-w-[180px]" title={series.name}>
                              {series.name}
                            </span>
                            <span className="font-mono text-[11px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded">
                              {series.overallPercentage.toFixed(1)}%
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Interactive Tooltip Card on Week Hover */}
          {activeWeek && (
            <div className="mt-3 bg-slate-900 text-white p-3.5 sm:p-4 rounded-2xl shadow-xl space-y-3 animate-in fade-in duration-150">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center space-x-2">
                  <Calendar className="w-3.5 h-3.5 text-blue-400" />
                  <span className="font-bold text-xs text-white">
                    {activeWeek.weekLabel}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    ({activeWeek.dateRangeLabel})
                  </span>
                </div>

                <div className="flex items-center space-x-2 font-mono">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                    activeWeek.avgPercentage >= 90
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : activeWeek.avgPercentage >= 70
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  }`}>
                    {activeWeek.avgPercentage.toFixed(1)}% · {activeWeek.avgGrade10.toFixed(2)} / 10
                  </span>
                </div>
              </div>

              {/* Breakdown in separated mode */}
              {effectiveMode !== 'general' && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    {effectiveMode === 'career'
                      ? (language === 'es' ? 'Rendimiento por carrera esta semana:' : 'Career performance this week:')
                      : (language === 'es' ? 'Rendimiento por materia esta semana:' : 'Subject performance this week:')}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {chartSeriesList.map(series => {
                      const pt = series.points.find(p => p.weekNumber === activeWeek.weekNumber);
                      if (!pt) return null;

                      return (
                        <div
                          key={series.id}
                          className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700/60 text-xs"
                        >
                          <div className="flex items-center space-x-2 min-w-0 pr-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: series.color }}
                            />
                            <div className="truncate">
                              <p className="font-semibold text-slate-200 truncate">{series.name}</p>
                              {series.subLabel && (
                                <p className="text-[10px] text-slate-400 truncate">{series.subLabel}</p>
                              )}
                            </div>
                          </div>
                          <span className={`font-mono text-xs font-bold shrink-0 ${
                            pt.avgPercentage >= 70 ? 'text-emerald-400' : 'text-rose-400'
                          }`}>
                            {pt.avgPercentage.toFixed(1)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Evaluated activities list */}
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {t('weekly.evaluatedActivitiesThisWeek', 'Actividades evaluadas esta semana:')} ({activeWeek.activities.length})
                </p>
                {activeWeek.activities.map(act => (
                  <div
                    key={act.id}
                    className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-slate-800/60 border border-slate-700/60"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="font-semibold text-slate-200 truncate">{act.title}</p>
                      <div className="flex items-center space-x-2 text-[10px] text-slate-400">
                        {act.courseName && <span className="truncate">{act.courseName}</span>}
                        {canSeparateByCareer && act.careerName && (
                          <span className="text-slate-500">· {act.careerName}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {act.isOverdueUnsubmitted ? (
                        <span className="text-[10px] font-bold text-rose-400 bg-rose-950/60 border border-rose-800 px-1.5 py-0.5 rounded">
                          0 / {act.gradeOver} ({t('weekly.unsubmitted', 'No entregado')})
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] font-bold text-emerald-400">
                          {act.grade.toFixed(2)} / {act.gradeOver}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

    </div>
  );
}
