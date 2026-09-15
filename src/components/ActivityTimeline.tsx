import React, { useState, useEffect } from 'react';
import { 
  Clock, CheckCircle, Trash2, Calendar, FileText, Square, CheckSquare, Search, 
  ChevronRight, ChevronDown, Filter, EyeOff, LayoutGrid, ListFilter, AlertCircle, PlusCircle, CheckSquare2,
  Download, RefreshCw, Eye, BookOpen, Terminal, Info, X, Sparkles
} from 'lucide-react';
import { TodoTask } from '../types';
import { useLanguage } from '../context/LanguageContext';

interface ActivityTimelineProps {
  tasks: TodoTask[];
  onToggleComplete: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onOpenNewTaskModal?: () => void;
  navigationTrigger?: string | null;
  onClearNavigationTrigger?: () => void;
  onRefreshSingleTask?: (id: string) => void;
  syncingTaskId?: string | null;
  onDownloadHtml?: (task: TodoTask) => void;
  onViewHtml?: (task: TodoTask) => void;
  filterCourseIdTrigger?: string | null;
  onClearFilterCourseIdTrigger?: () => void;
  viewingTaskId?: string | null;
  getFeedbackImageUrl?: (task: TodoTask, fileUrl: string) => string | null;
}

export default function ActivityTimeline({ 
  tasks, 
  onToggleComplete, 
  onDeleteTask, 
  onOpenNewTaskModal,
  navigationTrigger,
  onClearNavigationTrigger,
  onRefreshSingleTask,
  syncingTaskId,
  onDownloadHtml,
  onViewHtml,
  filterCourseIdTrigger,
  onClearFilterCourseIdTrigger,
  viewingTaskId,
  getFeedbackImageUrl
}: ActivityTimelineProps) {
  const { t, language } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState<boolean>(false);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [showCompleted, setShowCompleted] = useState<boolean>(true);
  const [showPastSemester, setShowPastSemester] = useState<boolean>(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  
  const [collapsedWeeksState, setCollapsedWeeksState] = useState<Record<string, boolean>>(() => {
    try {
      const cached = sessionStorage.getItem('unemi_collapsed_weeks');
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  });

  const setCollapsedWeeks = (val: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => {
    setCollapsedWeeksState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      try {
        sessionStorage.setItem('unemi_collapsed_weeks', JSON.stringify(next));
      } catch (e) {
        console.error(e);
      }
      return next;
    });
  };

  const collapsedWeeks = collapsedWeeksState;

  useEffect(() => {
    if (filterCourseIdTrigger) {
      setSelectedCourseId(filterCourseIdTrigger);
      setShowCompleted(false);
      if (onClearFilterCourseIdTrigger) {
        onClearFilterCourseIdTrigger();
      }
    }
  }, [filterCourseIdTrigger, onClearFilterCourseIdTrigger]);

  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatEcuadorTime = (dateObj: Date) => {
    try {
      const options: Intl.DateTimeFormatOptions = {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'America/Guayaquil',
        hour12: true
      };
      return dateObj.toLocaleDateString(language === 'es' ? 'es-EC' : 'en-US', options);
    } catch {
      return dateObj.toISOString();
    }
  };

  const handleDownloadCSV = () => {
    // Solo incluir actividades reales escaneadas (tipo diferente a 'MANUAL')
    const scannedTasks = tasks.filter(t => t.type !== 'MANUAL');

    const headers = [
      t('csv.id'),
      t('csv.title'),
      t('csv.type'),
      t('csv.group'),
      t('csv.courseId'),
      t('csv.courseName'),
      t('csv.url'),
      t('csv.description'),
      t('csv.apertureIso'),
      t('csv.apertureFormatted'),
      t('csv.closureIso'),
      t('csv.closureFormatted'),
      t('csv.completed'),
      t('csv.registeredAt'),
      t('csv.submissionStatus'),
      t('csv.grade'),
      t('csv.maxGrade'),
      t('csv.gradingStatus'),
      t('csv.feedback')
    ];

    const escapeCSVField = (val: any) => {
      if (val === null || val === undefined) return '';
      let str = String(val).trim();
      // Duplicar las comillas dobles para escapar en formato CSV
      str = str.replace(/"/g, '""');
      // Si el campo contiene comas, comillas o saltos de línea, envolverlo entre comillas dobles
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str}"`;
      }
      return str;
    };

    const nowTime = new Date().getTime();
    const rows = scannedTasks.map(task => {
      const isSkeleton = !task.completed && task.closureDate && (new Date(task.closureDate).getTime() < nowTime);
      const displayGrade = task.grade ? task.grade : (isSkeleton ? '0.00' : '');
      const displayStatus = ((task.status === 'Calificado' || task.grade) ? t('csv.graded') : (task.estado_calificacion || task.gradingStatus || (task.hecho_calificacion ? t('csv.gradeHidden') : '')));
      const hasPassed = task.closureDate ? (new Date(task.closureDate).getTime() < nowTime) : false;
      const displayEntrega = task.completed
        ? (task.status || task.estado_entrega || t('csv.submitted'))
        : (hasPassed ? t('csv.notSubmitted') : t('csv.toSubmit'));

      return [
        task.id || '',
        task.title || '',
        task.type || '',
        task.grupo ? task.grupo : t('csv.individual'),
        task.courseId || '',
        task.courseName || '',
        task.activityUrl || '',
        task.description || '',
        task.apertureDateISO || '',
        task.apertureDateISO ? formatCalendarDate(task.apertureDateISO) : (task.aperture || ''),
        task.closureDate || '',
        task.closureDate ? formatCalendarDate(task.closureDate) : '',
        task.completed ? t('csv.yes') : t('csv.no'),
        task.createdAt || '',
        displayEntrega,
        displayGrade,
        task.gradeOver || '',
        displayStatus,
        task.comentario_calificador || ''
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(escapeCSVField).join(','))
    ].join('\n');

    // Añadir BOM de UTF-8 (\uFEFF) para forzar a Excel a leer correctamente los caracteres en español (tildes, eñes)
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    // Generar un nombre de archivo amigable con la fecha actual local
    const nowStr = new Date().toISOString().slice(0, 10);
    link.setAttribute('download', `agenda_actividades_escaneadas_${nowStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Check if a given Monday timestamp belongs to the current week
  const isCurrentWeek = (mondayMs: number) => {
    const today = new Date();
    // Find Monday of today
    const day = today.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const todayMonday = new Date(today);
    todayMonday.setDate(today.getDate() + diffToMonday);
    todayMonday.setHours(0, 0, 0, 0);
    return todayMonday.getTime() === mondayMs;
  };

  // Helper to locate which academic week a task belongs to
  const getWeekInfo = (dateStr: string | null) => {
    if (!dateStr) return { weekNumber: 9999, label: t('timeline.weekNoDeadline'), mondaySort: 9999999999999 };
    const d = new Date(dateStr);
    const BASING_START = new Date('2026-04-13T00:00:00'); // Start of Semester Week 1 (Monday)
    
    // Find the Monday of the week date d belongs to
    const day = d.getDay(); // 0 is Sunday, 1 is Monday...
    const diffToMonday = day === 0 ? -6 : 1 - day; // how many days to get to Monday
    
    const monday = new Date(d);
    monday.setDate(d.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const msInWeek = 7 * 24 * 60 * 60 * 1000;
    const weekIndex = Math.floor((monday.getTime() - BASING_START.getTime()) / msInWeek);
    const weekNumber = weekIndex + 1;

    const label = weekNumber === 9999
      ? t('timeline.weekNoDeadline')
      : weekNumber > 0 
        ? t('timeline.weekTitle', { number: weekNumber })
        : t('timeline.weekSpecial');

    return { weekNumber, label, mondaySort: monday.getTime() };
  };

  // Synchronizer for Agenda navigation triggers from Moodle browser back to Agenda
  useEffect(() => {
    if (navigationTrigger) {
      const matchedTask = tasks.find(t => t.activityUrl === navigationTrigger);
      if (matchedTask) {
        const info = getWeekInfo(matchedTask.closureDate);
        const groupLabel = info.label;

        // Auto-expand this specific week
        setCollapsedWeeks(prev => ({
          ...prev,
          [groupLabel]: false // force expanded
        }));

        if (onClearNavigationTrigger) {
          onClearNavigationTrigger();
        }

        setTimeout(() => {
          const elementId = `timeline-row-${matchedTask.id}`;
          const el = document.getElementById(elementId);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const cardEl = el.querySelector('.bg-white, .bg-emerald-50\\/10');
            if (cardEl) {
              cardEl.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2', 'transition-all', 'duration-300');
              setTimeout(() => {
                cardEl.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2');
              }, 3000);
            }
          }
        }, 350);
      }
    }
  }, [navigationTrigger, tasks]);

  // Helper to extract carrera and curso from courseName
  const getCourseDetails = (courseName: string | null | undefined) => {
    if (!courseName) return { materia: '', codigo: '', curso: 'N/A', carrera: 'Otros' };
    const parts = courseName.split(' - ').map(p => p.trim());
    if (parts.length >= 4) {
      return {
        materia: parts[0],
        codigo: parts[1],
        curso: parts[2],
        carrera: parts[3]
      };
    } else if (parts.length === 3) {
      if (parts[1].startsWith('[') && parts[1].endsWith(']')) {
        return {
          materia: parts[0],
          codigo: parts[1],
          curso: 'N/A',
          carrera: parts[2]
        };
      }
    }
    const codeIndex = parts.findIndex(p => p.startsWith('[') && p.endsWith(']'));
    if (codeIndex !== -1) {
      const materia = parts.slice(0, codeIndex).join(' - ');
      const codigo = parts[codeIndex];
      let curso = 'N/A';
      let carrera = 'Otros';
      const remaining = parts.slice(codeIndex + 1);
      if (remaining.length === 2) {
        curso = remaining[0];
        carrera = remaining[1];
      } else if (remaining.length === 1) {
        carrera = remaining[0];
      }
      return { materia, codigo, curso, carrera };
    }
    return { materia: courseName, codigo: '', curso: 'N/A', carrera: 'Otros' };
  };

  // Find unique account-career combinations in task base
  const uniqueAccountCareers = Array.from(
    new Set(
      tasks
        .map(t => {
          const username = t.moodleUsername || 'Manual';
          const carrera = getCourseDetails(t.courseName).carrera;
          return `${username}|${carrera}`;
        })
        .filter(Boolean)
    )
  ).sort();

  // Find unique courses in task base for filtering
  const uniqueCourses = Array.from(
    new Map(
      tasks
        .filter(t => t.courseId && t.courseName)
        .filter(t => selectedAccounts.length === 0 || selectedAccounts.includes(`${t.moodleUsername || 'Manual'}|${getCourseDetails(t.courseName).carrera}`))
        .map(t => [t.courseId, t.courseName])
    ).entries()
  );

  // Auto-reset subject filter if the current subject does not belong to the newly selected accounts and careers
  useEffect(() => {
    if (selectedCourseId !== 'all') {
      const match = tasks.find(t => t.courseId === selectedCourseId);
      if (match) {
        const itemAccountKey = `${match.moodleUsername || 'Manual'}|${getCourseDetails(match.courseName).carrera}`;
        if (selectedAccounts.length > 0 && !selectedAccounts.includes(itemAccountKey)) {
          setSelectedCourseId('all');
        }
      }
    }
  }, [selectedAccounts, selectedCourseId, tasks]);

  // Parse remaining duration in a human readable way
  const getRemainingTime = (isoString: string | null, completed: boolean) => {
    if (completed) return { text: t('time.completed'), color: 'text-emerald-600 bg-emerald-50 border-emerald-100/50' };
    if (!isoString) return { text: t('time.noDeadline'), color: 'text-gray-500 bg-gray-50 border-gray-100' };

    const deadline = new Date(isoString);
    const now = new Date();
    const diff = deadline.getTime() - now.getTime();

    if (diff < 0) {
      return { text: t('time.closedOverdue'), color: 'text-rose-600 bg-rose-50 border-rose-100/50' };
    }

    const hrs = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hrs / 24);
    const remainingHrs = hrs % 24;

    if (days > 0) {
      if (days === 1) {
        return { 
          text: t('time.oneDayHrsLeft', { hrs: remainingHrs }), 
          color: 'text-amber-700 bg-amber-50 border-amber-100/50 hover:bg-amber-100/40' 
        };
      }
      return { 
        text: t('time.daysLeft', { days }), 
        color: 'text-slate-700 bg-slate-50 border-slate-100 hover:bg-slate-100/60' 
      };
    } else {
      if (hrs === 0) {
        const mins = Math.floor(diff / (1000 * 60)) % 60;
        return { 
          text: t('time.minutesLeft', { mins }), 
          color: 'text-rose-700 bg-rose-50 border-rose-100 animate-pulse font-bold' 
        };
      }
      return { 
        text: t('time.hoursLeft', { hrs }), 
        color: 'text-rose-700 bg-rose-50 border-rose-100 animate-pulse-slow' 
      };
    }
  };

  // Helper to format Spanish calendar strings
  const formatCalendarDate = (isoString: string | null) => {
    if (!isoString) return t('time.noDeadline');
    const date = new Date(isoString);
    const options: Intl.DateTimeFormatOptions = { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Guayaquil'
    };
    return date.toLocaleDateString(language === 'es' ? 'es-EC' : 'en-US', options);
  };

  const getRelativeSyncTime = (lastSyncedAtStr?: string) => {
    if (!lastSyncedAtStr) return null;
    try {
      const past = new Date(lastSyncedAtStr).getTime();
      const diffMs = Date.now() - past;
      if (diffMs < 0) return t('time.justNow');
      const seconds = Math.floor(diffMs / 1000);
      if (seconds < 60) return t('time.justNow');
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return t('time.minutesAgo', { min: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t('time.hoursAgo', { hrs: hours });
      const days = Math.floor(hours / 24);
      return t('time.daysAgo', { days });
    } catch {
      return null;
    }
  };

  const getTaskEmoji = (task: TodoTask): string => {
    // 1. Actividad completada/entregada pero sin nota visible o pendiente = ⏱️
    if ((task.completed || task.status === 'Entregado') && !task.grade) {
      return '⏱️';
    }

    // 2. Actividad no realizada y pasado fecha de cierre = ☠️
    if (!task.completed && task.closureDate) {
      const deadline = new Date(task.closureDate).getTime();
      const now = new Date().getTime();
      if (deadline < now) {
        return '☠️';
      }
    }

    // 3. Actividades que cierran en menos de 30 horas = 🔥
    // And ⚠️ helper for activities closing outside 23:57 to 00:00 range (almost 3 minutes)
    if (!task.completed && task.closureDate) {
      const deadline = new Date(task.closureDate).getTime();
      const now = new Date().getTime();
      const diff = deadline - now;
      if (diff > 0) {
        if (diff < 30 * 60 * 60 * 1000) {
          return '🔥';
        }
        
        const date = new Date(task.closureDate);
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const inExcludedRange = (hours === 23 && minutes >= 57) || (hours === 0 && minutes === 0);
        if (!inExcludedRange) {
          return '⚠️';
        }

        // Actividades que cierran en menos de 10 días = 💪
        if (diff < 10 * 24 * 60 * 60 * 1000) {
          return '💪';
        }
      }
    }

    // 4. Emojis para actividades con calificaciones (😢 reemplaza 🥲 que no se ve en algunos navegadores)
    if (task.grade) {
      const g = parseFloat(task.grade);
      if (!isNaN(g)) {
        const max = task.gradeOver ? parseFloat(task.gradeOver) : 10;
        if (max > 0) {
          const pctVal = (g / max) * 100;
          if (pctVal >= 90 && pctVal <= 100) return '😄';
          if (pctVal >= 80 && pctVal < 90) return '🙂';
          if (pctVal >= 70 && pctVal < 80) return '😢';
          if (pctVal >= 60 && pctVal < 70) return '😢';
          if (pctVal > 0 && pctVal < 60) return '👎';
        }
      }
    }

    return '';
  };

  // A task is considered "past semester" when its deadline closed well before
  // today (grace of 21 days). Such tasks come from previous semesters that the
  // app keeps merged in localStorage/Firestore, so they are hidden by default.
  const PAST_SEMESTER_GRACE_MS = 21 * 24 * 60 * 60 * 1000;
  const isPastSemesterTask = (task: TodoTask, nowTime: number): boolean => {
    if (!task.closureDate) return false;
    return new Date(task.closureDate).getTime() < nowTime - PAST_SEMESTER_GRACE_MS;
  };

  // Filter & SORT calculations:
  // Sorting rules:
  // 1. Items WITHOUT closing dates are pushed to the very end
  // 2. Items WITH closing dates are ordered chronologically ascending (closest deadline first)
  // 3. Completed items can be optionally hidden
  const filteredTasks = tasks
    .filter(task => {
      const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            (task.description && task.description.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesAccount = selectedAccounts.length === 0 || selectedAccounts.includes(`${task.moodleUsername || 'Manual'}|${getCourseDetails(task.courseName).carrera}`);
      const matchesCourse = selectedCourseId === 'all' || task.courseId === selectedCourseId;
      const matchesType = selectedType === 'all' || task.type === selectedType;
      const matchesCompleted = showCompleted || !task.completed;
      const matchesSemester = showPastSemester || !isPastSemesterTask(task, now.getTime());
      return matchesSearch && matchesAccount && matchesCourse && matchesType && matchesCompleted && matchesSemester;
    })
    .sort((a, b) => {
      if (!a.closureDate) return 1;
      if (!b.closureDate) return -1;
      const timeA = new Date(a.closureDate).getTime();
      const timeB = new Date(b.closureDate).getTime();
      return timeA - timeB;
    });

  // Calculate stats
  const pendingCount = tasks.filter(t => !t.completed).length;
  const completedCount = tasks.filter(t => t.completed).length;
  const percentComplete = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  const renderTaskCard = (task: TodoTask) => {
    const remaining = getRemainingTime(task.closureDate, task.completed);
    const isClickable = !!task.activityUrl;

    return (
      <div 
        key={task.id} 
        id={`timeline-row-${task.id}`}
        onClick={() => {
          if (isClickable && task.activityUrl) {
            window.open(task.activityUrl, '_blank', 'noopener,noreferrer');
          }
        }}
        className={`p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
          task.completed ? 'bg-slate-50/40 text-slate-400' : 'bg-white hover:bg-slate-50/60'
        } ${isClickable ? 'cursor-pointer' : ''}`}
      >
        <div className="flex items-start space-x-3 flex-1 min-w-0">
          <button
            id={`check-task-${task.id}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleComplete(task.id);
            }}
            className={`mt-0.5 shrink-0 transition-transform active:scale-95 cursor-pointer ${
              task.completed ? 'text-emerald-500' : 'text-slate-300 hover:text-blue-500'
            }`}
          >
            {task.completed ? (
              <CheckSquare2 className="w-5 h-5 stroke-[2.2]" />
            ) : (
              <Square className="w-5 h-5 stroke-[1.8]" />
            )}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
              {task.courseName && (
                <span className="text-[11px] font-semibold text-slate-500 truncate max-w-[220px]" title={task.courseName}>
                  {task.courseName.split('-')[0]?.trim() || task.courseName}
                </span>
              )}
              <span className="text-slate-300 text-xs">•</span>
              <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
                task.type === 'TAREA' 
                  ? 'bg-orange-50 text-orange-700 border border-orange-100' 
                  : task.type === 'CUESTIONARIO' 
                    ? 'bg-purple-50 text-purple-700 border border-purple-100' 
                    : 'bg-sky-50 text-sky-700 border border-sky-100'
              }`}>
                {task.type}
              </span>
              {task.grupo ? (
                <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded font-medium">
                  {t('timeline.groupBadge')}
                </span>
              ) : null}
            </div>

            <h3 className="text-xs sm:text-sm font-bold mt-1 leading-snug flex items-center gap-1.5 min-w-0">
              {getTaskEmoji(task) && (
                <span className="shrink-0 no-underline inline-block font-normal text-slate-800">
                  {getTaskEmoji(task)}
                </span>
              )}
              <span className={`truncate ${
                task.completed ? 'text-slate-400 line-through' : 'text-slate-900 hover:text-blue-600'
              }`}>
                {task.title}
              </span>
              {viewingTaskId === task.id && (
                <span className="inline-flex items-center space-x-1 bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded text-[10px] font-bold animate-pulse shrink-0">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  <span>{language === 'es' ? 'Abriendo...' : 'Opening...'}</span>
                </span>
              )}
            </h3>

            {/* Badges row: Status, Grade, Warnings */}
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {(() => {
                const statusStr = task.status || (task.completed ? (language === 'es' ? 'Entregado' : 'Submitted') : (language === 'es' ? 'No entregado' : 'Not submitted'));
                const isCalificado = statusStr.toLowerCase().includes('calificad');
                const isEntregado = statusStr.toLowerCase().includes('entregad') || statusStr.toLowerCase().includes('enviad') || statusStr.toLowerCase().includes('finalizad');
                const isBorrador = statusStr.toLowerCase().includes('borrador');
                
                let bgClass = 'bg-slate-50 text-slate-600 border-slate-200';
                if (isCalificado) bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                else if (isEntregado) bgClass = 'bg-blue-50 text-blue-700 border-blue-200';
                else if (isBorrador) bgClass = 'bg-amber-50 text-amber-700 border-amber-200';
                else if (statusStr.toLowerCase().includes('no entregad') || statusStr.toLowerCase().includes('sin entregar')) bgClass = 'bg-rose-50 text-rose-700 border-rose-200';

                return (
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md border flex items-center gap-1 ${bgClass}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0"></span>
                    {statusStr}
                  </span>
                );
              })()}

              {task.grade && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border bg-emerald-50 text-emerald-800 border-emerald-200">
                  {language === 'es' ? 'Nota:' : 'Grade:'} {task.grade} {task.gradeOver ? `/ ${task.gradeOver}` : ''}
                </span>
              )}

              {task.advertencia_preguntas && (
                <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-1.5 py-0.5 flex items-center space-x-1">
                  <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />
                  <span>{task.advertencia_preguntas}</span>
                </span>
              )}

              {task.por_hacer_calificacion && (
                <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-1.5 py-0.5">
                  {language === 'es' ? 'Pendiente test en Moodle' : 'Pending test on Moodle'}
                </span>
              )}
            </div>

            {/* Teacher feedback snippet if present */}
            {task.comentario_calificador && (
              <div className="mt-2 bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-slate-600 text-xs">
                <p className="font-bold text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">{language === 'es' ? 'Comentario del docente:' : 'Teacher comment:'}</p>
                <p className="italic text-slate-700">"{task.comentario_calificador}"</p>
              </div>
            )}
          </div>
        </div>

        {/* Right action & remaining time */}
        <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border font-mono ${remaining.color}`}>
            {remaining.text}
          </span>

          <div className="flex items-center space-x-1">
            {task.type !== 'MANUAL' && onRefreshSingleTask && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRefreshSingleTask(task.id);
                }}
                disabled={syncingTaskId === task.id}
                className="text-[10px] font-medium text-slate-400 hover:text-blue-600 p-1 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
                title={language === 'es' ? 'Actualizar estado desde Moodle' : 'Update status from Moodle'}
              >
                <RefreshCw className={`w-3 h-3 ${syncingTaskId === task.id ? 'animate-spin text-blue-600' : ''}`} />
              </button>
            )}

            {onDeleteTask && task.type === 'MANUAL' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteTask(task.id);
                }}
                className="text-[10px] font-medium text-slate-400 hover:text-rose-600 p-1 rounded-md hover:bg-rose-50 transition-colors cursor-pointer"
                title={language === 'es' ? 'Eliminar tarea manual' : 'Delete manual task'}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div id="timeline-card-wrapper" className="space-y-4">
      
      {/* 1. Clean Toolbar & Filters */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-2xs space-y-4">
        
        {/* Header summary row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center space-x-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <span>{language === 'es' ? 'Agenda de Actividades' : 'Activity Agenda'}</span>
                <span className="text-xs font-bold bg-blue-50 text-blue-600 px-2.5 py-0.5 rounded-full border border-blue-100">
                  {t('timeline.statsPending', { count: pendingCount })}
                </span>
              </h2>
              <div className="flex items-center space-x-2 text-xs text-slate-400 mt-1">
                <span>{completedCount} {language === 'es' ? 'de' : 'of'} {tasks.length} {language === 'es' ? 'completadas' : 'completed'} ({percentComplete}%)</span>
                <div className="w-20 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${percentComplete}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-2 shrink-0">
            {/* Legend button */}
            <button
              type="button"
              onClick={() => setShowLegend(!showLegend)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl flex items-center space-x-1.5 border transition-colors cursor-pointer ${
                showLegend 
                  ? 'bg-blue-50 text-blue-700 border-blue-200' 
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200'
              }`}
              title={t('sync.legendTitle')}
            >
              <Info className="w-3.5 h-3.5" />
              <span>{language === 'es' ? 'Leyenda' : 'Legend'}</span>
            </button>
          </div>
        </div>

        {/* Legend Popover panel */}
        {showLegend && (
          <div className="p-3.5 bg-blue-50/60 border border-blue-100 rounded-xl text-xs space-y-2 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <span className="font-bold text-blue-900 text-xs flex items-center space-x-1.5">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                <span>{t('sync.legendHeading')}</span>
              </span>
              <button 
                onClick={() => setShowLegend(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 pt-1 text-[11px]">
              <div className="flex items-center space-x-1.5 bg-white p-1.5 rounded-lg border border-slate-100">
                <span className="text-base">🔥</span>
                <span className="text-slate-700">{t('sync.legend.imminent')}</span>
              </div>
              <div className="flex items-center space-x-1.5 bg-white p-1.5 rounded-lg border border-slate-100">
                <span className="text-base">💪</span>
                <span className="text-slate-700">{t('sync.legend.pending')}</span>
              </div>
              <div className="flex items-center space-x-1.5 bg-white p-1.5 rounded-lg border border-slate-100">
                <span className="text-base">⏱️</span>
                <span className="text-slate-700">{language === 'es' ? 'Entregado (Sin nota)' : 'Submitted (Ungraded)'}</span>
              </div>
              <div className="flex items-center space-x-1.5 bg-white p-1.5 rounded-lg border border-slate-100">
                <span className="text-base">😄</span>
                <span className="text-slate-700">{t('sync.legend.excellent')}</span>
              </div>
              <div className="flex items-center space-x-1.5 bg-white p-1.5 rounded-lg border border-slate-100">
                <span className="text-base">🙂</span>
                <span className="text-slate-700">{t('sync.legend.acceptable')}</span>
              </div>
              <div className="flex items-center space-x-1.5 bg-white p-1.5 rounded-lg border border-slate-100">
                <span className="text-base">😢</span>
                <span className="text-slate-700">{t('sync.legend.regular')}</span>
              </div>
              <div className="flex items-center space-x-1.5 bg-white p-1.5 rounded-lg border border-slate-100">
                <span className="text-base">👎</span>
                <span className="text-slate-700">{t('sync.legend.failed')}</span>
              </div>
              <div className="flex items-center space-x-1.5 bg-white p-1.5 rounded-lg border border-slate-100">
                <span className="text-base">☠️</span>
                <span className="text-slate-700">{t('sync.legend.overdue')}</span>
              </div>
              <div className="flex items-center space-x-1.5 bg-white p-1.5 rounded-lg border border-slate-100">
                <span className="text-base">⚠️</span>
                <span className="text-slate-700">{language === 'es' ? 'Cierre atípico' : 'Atypical deadline'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Search & Filter Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          {/* Search */}
          <div className="sm:col-span-4 relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={language === 'es' ? 'Buscar actividad o materia...' : 'Search activity or course...'}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Subjects dropdown */}
          <div className="sm:col-span-3">
            <select
              id="task-subject-filter"
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500 cursor-pointer"
            >
              <option value="all">{language === 'es' ? `Todas las materias (${uniqueCourses.length})` : `All courses (${uniqueCourses.length})`}</option>
              {uniqueCourses.map(([cid, cname]) => (
                <option key={cid} value={cid}>{cname}</option>
              ))}
            </select>
          </div>

          {/* Type dropdown */}
          <div className="sm:col-span-3">
            <select
              id="task-type-filter"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500 cursor-pointer"
            >
              <option value="all">{t('timeline.allTypes')}</option>
              <option value="TAREA">{t('timeline.typeTask')}</option>
              <option value="CUESTIONARIO">{t('timeline.typeQuiz')}</option>
              <option value="ACTIVIDAD">{t('timeline.typeActivity')}</option>
              <option value="MANUAL">{t('timeline.typeManual')}</option>
            </select>
          </div>

          {/* View toggles */}
          <div className="sm:col-span-2 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setShowPastSemester(!showPastSemester)}
              className={`w-full px-2 py-1.5 text-xs font-semibold rounded-xl border flex items-center justify-center space-x-1.5 transition-colors cursor-pointer ${
                showPastSemester 
                  ? 'bg-slate-50 text-slate-700 border-slate-200' 
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}
              title={language === 'es' ? 'Muestra u oculta actividades de semestres anteriores (cerradas hace más de 21 días)' : 'Show or hide activities from previous semesters (closed more than 21 days ago)'}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>{showPastSemester ? (language === 'es' ? 'Ver pasado' : 'Show past') : (language === 'es' ? 'Ocultar pasado' : 'Hide past')}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowCompleted(!showCompleted)}
              className={`w-full px-2 py-1.5 text-xs font-semibold rounded-xl border flex items-center justify-center space-x-1.5 transition-colors cursor-pointer ${
                showCompleted 
                  ? 'bg-slate-50 text-slate-700 border-slate-200' 
                  : 'bg-blue-50 text-blue-700 border-blue-200'
              }`}
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span>{showCompleted ? (language === 'es' ? 'Ocultar Hechas' : 'Hide Completed') : (language === 'es' ? 'Ver Hechas' : 'Show Completed')}</span>
            </button>
          </div>
        </div>

      </div>

      {/* 2. Tasks Timeline View */}
      {filteredTasks.length === 0 ? (
        <div id="timeline-empty-state" className="bg-white border border-slate-200/80 rounded-2xl p-10 text-center shadow-2xs">
          <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-bold text-slate-700">{t('timeline.noFilteredActivities')}</p>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {language === 'es' ? 'No hay actividades que coincidan con los filtros seleccionados.' : 'No activities match the selected filters.'}
          </p>
        </div>
      ) : (() => {
        // Group activity items under corresponding weeks
        const groupsRecord: Record<string, { label: string; mondaySort: number; tasks: TodoTask[] }> = {};

        filteredTasks.forEach(task => {
          const info = getWeekInfo(task.closureDate);
          const key = info.label;
          if (!groupsRecord[key]) {
            groupsRecord[key] = {
              label: key,
              mondaySort: info.mondaySort,
              tasks: []
            };
          }
          groupsRecord[key].tasks.push(task);
        });

        // Order weeks chronologically
        const sortedGroups = Object.values(groupsRecord).sort((a, b) => a.mondaySort - b.mondaySort);

        return (
          <div id="timeline-rendered-body" className="space-y-4">
            {sortedGroups.map(group => {
              const isCurrent = isCurrentWeek(group.mondaySort);
              const isCollapsed = collapsedWeeks[group.label] !== undefined 
                ? collapsedWeeks[group.label] 
                : !isCurrent;
              const pendingInGroup = group.tasks.filter(t => !t.completed).length;
                const completedInGroup = group.tasks.length - pendingInGroup;

              return (
                <div key={group.label} className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-2xs">
                  {/* Academic Week Header Banner */}
                  <div
                    onClick={() => {
                      setCollapsedWeeks(prev => ({
                        ...prev,
                        [group.label]: !isCollapsed
                      }));
                    }}
                    className="p-3.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between cursor-pointer select-none hover:bg-slate-100/70 transition-colors"
                  >
                    <div className="flex items-center space-x-2.5">
                      <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-xs text-slate-800">
                          {group.label}
                        </span>
                        {isCurrent && (
                          <span className="text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.2 rounded-full">
                            {t('timeline.currentWeekBadge')}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 text-xs text-slate-400 font-medium">
                      <span>
                        {t('timeline.done')}: {completedInGroup}/{group.tasks.length}
                      </span>
                    </div>
                  </div>

                  {/* Week Activities Content */}
                  {!isCollapsed && (
                    <div className="p-3 sm:p-4">
                      {group.mondaySort === 9999999999999 ? (
                        <div className="divide-y divide-slate-100 border border-slate-200/70 rounded-xl overflow-hidden">
                          {group.tasks.map(task => renderTaskCard(task))}
                        </div>
                      ) : (() => {
                        const weekdays = language === 'es' 
                          ? ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
                          : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
                        const mondayDate = new Date(group.mondaySort);

                        const daysArray = weekdays.map((name, index) => {
                          const dayDate = new Date(mondayDate);
                          dayDate.setDate(mondayDate.getDate() + index);
                          return {
                            name,
                            dayDate,
                            tasks: [] as TodoTask[]
                          };
                        });

                        group.tasks.forEach(task => {
                          if (task.closureDate) {
                            const taskD = new Date(task.closureDate);
                            const day = taskD.getDay();
                            const idx = day === 0 ? 6 : day - 1;
                            if (idx >= 0 && idx < 7) {
                              daysArray[idx].tasks.push(task);
                            } else {
                              daysArray[0].tasks.push(task);
                            }
                          } else {
                            daysArray[0].tasks.push(task);
                          }
                        });

                        const daysWithTasks = daysArray.filter(day => day.tasks.length > 0);

                        if (daysWithTasks.length === 0) {
                          return (
                            <div className="p-4 text-center text-xs text-slate-400 bg-slate-50/50 rounded-xl border border-slate-100">
                              {language === 'es' ? 'Todas las actividades de esta semana están completadas' : 'All activities for this week are completed'}
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-4">
                            {daysWithTasks.map((day, dayIdx) => {
                              const dayStr = day.dayDate.toLocaleDateString(language === 'es' ? "es-EC" : "en-US", { day: "numeric", month: "short" });
                              return (
                                <div key={dayIdx} className="space-y-1.5">
                                  <div className="flex items-center space-x-2 text-xs text-slate-500 font-semibold px-1">
                                    <span className="text-slate-800 capitalize font-bold">{day.name}, {dayStr}</span>
                                    <span className="text-[10px] text-slate-400">({day.tasks.length})</span>
                                    <div className="flex-1 h-px bg-slate-100 ml-2" />
                                  </div>
                                  <div className="divide-y divide-slate-100 border border-slate-200/70 rounded-xl overflow-hidden bg-white shadow-2xs">
                                    {day.tasks.map(task => renderTaskCard(task))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

    </div>
  );
}
