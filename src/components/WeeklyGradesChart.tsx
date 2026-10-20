import React, { useState, useMemo } from 'react';
import { TodoTask } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { TrendingUp, Award, Calendar, AlertCircle } from 'lucide-react';

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

export default function WeeklyGradesChart({
  tasks,
  firstWeekDate,
  selectedAccounts = [],
  liveCoursesByAccount,
}: WeeklyGradesChartProps) {
  const { t, language } = useLanguage();
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const [displayMode, setDisplayMode] = useState<'percent' | 'score10'>('percent');

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

  // Compute weekly points
  const weekPoints: WeekGradePoint[] = useMemo(() => {
    // 1. Determine basing Monday from firstWeekDate (or default)
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

    const weeksMap: Record<number, {
      weekNumber: number;
      weekLabel: string;
      mondayTime: number;
      dateRangeLabel: string;
      activities: EvaluatedActivity[];
      sumGrades: number;
      sumMaxGrades: number;
    }> = {};

    tasks.forEach(task => {
      // Must be current academic period
      if (!isCurrentSubject(task)) return;

      // Filter by selected accounts if any
      if (selectedAccounts.length > 0 && !selectedAccounts.includes(getTaskAccountKey(task))) {
        return;
      }

      // Must have a closing date to be positioned on a calendar week
      if (!task.closureDate) return;

      // Check evaluation criteria:
      // A) Graded: grade !== null
      // B) Overdue unsubmitted: !completed and closureDate < now -> counts as 0%
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

      // If not evaluated yet (e.g. pending future activity not yet graded), skip
      if (!isEvaluated) return;

      // Calculate the Monday of this activity's closureDate
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

      // Format date range (e.g. "13 abr - 19 abr")
      const monthNamesEs = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
      const monthNamesEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const mNames = language === 'es' ? monthNamesEs : monthNamesEn;

      const dateRangeLabel = `${monday.getDate()} ${mNames[monday.getMonth()]} - ${sunday.getDate()} ${mNames[sunday.getMonth()]}`;
      const weekLabel = weekNumber > 0 
        ? `${language === 'es' ? 'Semana' : 'Week'} ${weekNumber}`
        : (language === 'es' ? 'Semana Indefinida' : 'Special Week');

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

      const pct = gradeOver > 0 ? (earnedGrade / gradeOver) * 100 : 0;
      weeksMap[weekNumber].activities.push({
        id: task.id,
        title: task.title,
        courseName: task.courseName,
        grade: earnedGrade,
        gradeOver,
        percentage: pct,
        isOverdueUnsubmitted,
      });

      weeksMap[weekNumber].sumGrades += earnedGrade;
      weeksMap[weekNumber].sumMaxGrades += gradeOver;
    });

    // Don't create points in weeks that didn't have any activity (weeksMap only contains weeks with evaluated items)
    return Object.values(weeksMap)
      .map(w => {
        const avgPercentage = w.sumMaxGrades > 0 ? (w.sumGrades / w.sumMaxGrades) * 100 : 0;
        const avgGrade10 = w.sumMaxGrades > 0 ? (w.sumGrades / w.sumMaxGrades) * 10 : 0;
        return {
          ...w,
          avgPercentage,
          avgGrade10,
        };
      })
      .sort((a, b) => a.mondayTime - b.mondayTime);
  }, [tasks, firstWeekDate, selectedAccounts, liveCoursesByAccount, language]);

  // Derived metrics for summary chip headers
  const bestWeek = useMemo(() => {
    if (weekPoints.length === 0) return null;
    return [...weekPoints].sort((a, b) => b.avgPercentage - a.avgPercentage)[0];
  }, [weekPoints]);

  const lowestWeek = useMemo(() => {
    if (weekPoints.length === 0) return null;
    return [...weekPoints].sort((a, b) => a.avgPercentage - b.avgPercentage)[0];
  }, [weekPoints]);

  // SVG Chart Dimensions
  const svgWidth = 720;
  const svgHeight = 260;
  const padLeft = 45;
  const padRight = 35;
  const padTop = 25;
  const padBottom = 45;
  const innerWidth = svgWidth - padLeft - padRight;
  const innerHeight = svgHeight - padTop - padBottom;

  // Coordinate mappers
  const getY = (percentage: number) => {
    const clamped = Math.max(0, Math.min(100, percentage));
    return padTop + innerHeight * (1 - clamped / 100);
  };

  const getX = (index: number) => {
    if (weekPoints.length <= 1) return padLeft + innerWidth / 2;
    return padLeft + (innerWidth / (weekPoints.length - 1)) * index;
  };

  // Build SVG path
  const linePoints = weekPoints.map((pt, idx) => ({
    x: getX(idx),
    y: getY(pt.avgPercentage),
    point: pt,
  }));

  const linePathD = useMemo(() => {
    if (linePoints.length === 0) return '';
    if (linePoints.length === 1) return '';
    
    // Smooth bezier curve
    return linePoints.reduce((acc, curr, idx) => {
      if (idx === 0) return `M ${curr.x} ${curr.y}`;
      const prev = linePoints[idx - 1];
      const cx1 = prev.x + (curr.x - prev.x) / 3;
      const cy1 = prev.y;
      const cx2 = curr.x - (curr.x - prev.x) / 3;
      const cy2 = curr.y;
      return `${acc} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${curr.x} ${curr.y}`;
    }, '');
  }, [linePoints]);

  // Area fill under line path
  const areaPathD = useMemo(() => {
    if (linePoints.length < 2) return '';
    const bottomY = padTop + innerHeight;
    const first = linePoints[0];
    const last = linePoints[linePoints.length - 1];
    return `${linePathD} L ${last.x} ${bottomY} L ${first.x} ${bottomY} Z`;
  }, [linePathD, linePoints, innerHeight]);

  // Y-axis grid marks (0%, 25%, 50%, 75%, 100%)
  const yAxisTicks = [0, 25, 50, 75, 100];
  const passingY = getY(70);

  const activePoint = hoveredPointIndex !== null ? weekPoints[hoveredPointIndex] : null;

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
              {language === 'es' ? 'Evolución Semanal de Calificaciones' : 'Weekly Grade Evolution'}
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            {language === 'es' 
              ? 'Promedio semanal de actividades evaluadas. Tareas no entregadas vencidas cuentan como 0.'
              : 'Weekly average of evaluated tasks. Overdue unsubmitted tasks count as 0.'}
          </p>
        </div>

        {/* Display Scale Switch: % vs /10 */}
        <div className="flex items-center space-x-1.5 self-start sm:self-center bg-slate-100/80 p-1 rounded-xl border border-slate-200/60 text-xs font-semibold select-none">
          <button
            type="button"
            onClick={() => setDisplayMode('percent')}
            className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
              displayMode === 'percent'
                ? 'bg-white text-blue-600 font-bold shadow-2xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            % (0 - 100%)
          </button>
          <button
            type="button"
            onClick={() => setDisplayMode('score10')}
            className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
              displayMode === 'score10'
                ? 'bg-white text-blue-600 font-bold shadow-2xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            / 10 (0 - 10.0)
          </button>
        </div>
      </div>

      {/* Summary chips */}
      {weekPoints.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 font-semibold text-slate-600 flex items-center space-x-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>{weekPoints.length} {weekPoints.length === 1 ? (language === 'es' ? 'semana evaluada' : 'evaluated week') : (language === 'es' ? 'semanas evaluadas' : 'evaluated weeks')}</span>
          </span>

          {bestWeek && (
            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold flex items-center space-x-1.5">
              <Award className="w-3.5 h-3.5 text-emerald-600" />
              <span>
                {language === 'es' ? 'Mejor:' : 'Best:'} <strong>{bestWeek.weekLabel}</strong> ({displayMode === 'percent' ? `${bestWeek.avgPercentage.toFixed(1)}%` : `${bestWeek.avgGrade10.toFixed(2)}/10`})
              </span>
            </span>
          )}

          {lowestWeek && weekPoints.length > 1 && (
            <span className="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-semibold flex items-center space-x-1.5">
              <span>
                {language === 'es' ? 'Más baja:' : 'Lowest:'} <strong>{lowestWeek.weekLabel}</strong> ({displayMode === 'percent' ? `${lowestWeek.avgPercentage.toFixed(1)}%` : `${lowestWeek.avgGrade10.toFixed(2)}/10`})
              </span>
            </span>
          )}

          <span className="text-[11px] text-slate-400 ml-auto hidden sm:inline">
            <span className="inline-block w-2.5 h-0.5 bg-amber-500 mr-1 align-middle" />
            {language === 'es' ? '70% / 7.0 Mínimo Aprobatorio' : '70% / 7.0 Passing Min.'}
          </span>
        </div>
      )}

      {/* SVG Canvas or Empty State */}
      {weekPoints.length === 0 ? (
        <div className="bg-slate-50/60 border border-dashed border-slate-200 rounded-2xl p-8 text-center space-y-2">
          <AlertCircle className="w-7 h-7 text-slate-300 mx-auto" />
          <p className="text-xs font-bold text-slate-700">
            {language === 'es'
              ? 'Aún no hay semanas con actividades evaluadas o vencidas'
              : 'No weeks with evaluated or overdue activities yet'}
          </p>
          <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
            {language === 'es'
              ? 'Los puntos se graficarán automáticamente conforme se registren calificaciones en Moodle o venzan plazos de entrega.'
              : 'Points will automatically appear as grades are recorded in Moodle or deadlines pass.'}
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
                const label = displayMode === 'percent' ? `${tick}%` : (tick / 10).toFixed(1);
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
                      {label}
                    </text>
                  </g>
                );
              })}

              {/* 70% (7.0) Passing Threshold Line */}
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

              {/* Area fill under curve */}
              {areaPathD && (
                <path d={areaPathD} fill="url(#weeklyGradeAreaGradient)" />
              )}

              {/* Connecting curve */}
              {linePathD && (
                <path
                  d={linePathD}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Data points & X-axis labels */}
              {linePoints.map(({ x, y, point }, idx) => {
                const isHovered = hoveredPointIndex === idx;
                const isPassing = point.avgPercentage >= 70;
                const isExcellent = point.avgPercentage >= 90;

                const fillColor = isExcellent ? '#10b981' : isPassing ? '#3b82f6' : '#ef4444';
                const strokeColor = '#ffffff';

                const displayVal = displayMode === 'percent'
                  ? `${point.avgPercentage.toFixed(1)}%`
                  : point.avgGrade10.toFixed(2);

                return (
                  <g 
                    key={point.weekNumber} 
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredPointIndex(idx)}
                    onClick={() => setHoveredPointIndex(hoveredPointIndex === idx ? null : idx)}
                  >
                    {/* Vertical guide line on hover */}
                    {isHovered && (
                      <line
                        x1={x}
                        y1={padTop}
                        x2={x}
                        y2={padTop + innerHeight}
                        stroke="#94a3b8"
                        strokeWidth="1"
                        strokeDasharray="2 2"
                      />
                    )}

                    {/* Point Outer Glow on Hover */}
                    {isHovered && (
                      <circle
                        cx={x}
                        cy={y}
                        r="12"
                        fill={fillColor}
                        opacity="0.25"
                      />
                    )}

                    {/* Main point circle */}
                    <circle
                      cx={x}
                      cy={y}
                      r={isHovered ? '7' : '5'}
                      fill={fillColor}
                      stroke={strokeColor}
                      strokeWidth="2.5"
                      filter="url(#pointShadow)"
                      className="transition-all duration-150"
                    />

                    {/* Value label directly above point */}
                    <text
                      x={x}
                      y={y - 10}
                      textAnchor="middle"
                      className={`text-[10px] font-mono font-bold select-none ${
                        isExcellent ? 'fill-emerald-700' : isPassing ? 'fill-blue-700' : 'fill-rose-600'
                      }`}
                    >
                      {displayVal}
                    </text>

                    {/* X-axis week label */}
                    <text
                      x={x}
                      y={padTop + innerHeight + 16}
                      textAnchor="middle"
                      className={`text-[11px] select-none ${
                        isHovered ? 'font-black fill-blue-700' : 'font-bold fill-slate-700'
                      }`}
                    >
                      {`Sem ${point.weekNumber}`}
                    </text>

                    {/* X-axis date range sublabel */}
                    <text
                      x={x}
                      y={padTop + innerHeight + 28}
                      textAnchor="middle"
                      className="text-[9px] fill-slate-400 font-mono select-none"
                    >
                      {point.dateRangeLabel.split('-')[0].trim()}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Interactive Tooltip Card on Point Hover */}
          {activePoint && (
            <div 
              className="mt-3 bg-slate-900 text-white p-3.5 sm:p-4 rounded-2xl shadow-xl space-y-2.5 animate-in fade-in duration-150"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center space-x-2">
                  <Calendar className="w-3.5 h-3.5 text-blue-400" />
                  <span className="font-bold text-xs text-white">
                    {activePoint.weekLabel}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    ({activePoint.dateRangeLabel})
                  </span>
                </div>

                <div className="flex items-center space-x-2 font-mono">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                    activePoint.avgPercentage >= 90
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : activePoint.avgPercentage >= 70
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  }`}>
                    {activePoint.avgPercentage.toFixed(1)}% · {activePoint.avgGrade10.toFixed(2)} / 10
                  </span>
                </div>
              </div>

              {/* Evaluated activities list */}
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {language === 'es' ? 'Actividades evaluadas esta semana:' : 'Evaluated activities this week:'} ({activePoint.activities.length})
                </p>
                {activePoint.activities.map(act => (
                  <div 
                    key={act.id} 
                    className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-slate-800/60 border border-slate-700/60"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="font-semibold text-slate-200 truncate">{act.title}</p>
                      {act.courseName && (
                        <p className="text-[10px] text-slate-400 truncate">{act.courseName}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      {act.isOverdueUnsubmitted ? (
                        <span className="text-[10px] font-bold text-rose-400 bg-rose-950/60 border border-rose-800 px-1.5 py-0.5 rounded">
                          0 / {act.gradeOver} ({language === 'es' ? 'No entregado' : 'Unsubmitted'})
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
