import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Clock, CheckCircle, Trash2, Calendar, FileText, Square, CheckSquare, Search, 
  ChevronRight, ChevronDown, Filter, EyeOff, LayoutGrid, ListFilter, AlertCircle, PlusCircle, CheckSquare2,
  Download, RefreshCw, Eye, BookOpen, Terminal, Info, X, Sparkles, Users, Link2, Check
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
  onDownloadHtml?: (task: TodoTask) => void;
  onViewHtml?: (task: TodoTask) => void;
  filterCourseIdTrigger?: string | null;
  onClearFilterCourseIdTrigger?: () => void;
  viewingTaskId?: string | null;
  getFeedbackImageUrl?: (task: TodoTask, fileUrl: string) => string | null;
  firstWeekDate?: string;
  onFirstWeekDateChange?: (date: string) => void;
  liveCoursesByAccount?: Record<string, Set<string>>;
}

export default function ActivityTimeline({ 
  tasks, 
  onToggleComplete, 
  onDeleteTask, 
  onOpenNewTaskModal,
  navigationTrigger,
  onClearNavigationTrigger,
  onDownloadHtml,
  onViewHtml,
  filterCourseIdTrigger,
  onClearFilterCourseIdTrigger,
  viewingTaskId,
  getFeedbackImageUrl,
  firstWeekDate,
  onFirstWeekDateChange,
  liveCoursesByAccount
}: ActivityTimelineProps) {
  const { t, language } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [showCompleted, setShowCompleted] = useState<boolean>(true);
  const [openDropdown, setOpenDropdown] = useState<'account' | 'course' | 'type' | null>(null);
  const [courseSearch, setCourseSearch] = useState('');
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);

  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fall through to the legacy path below
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const handleCopyActivityLink = async (task: TodoTask) => {
    if (!task.activityUrl) return;
    const ok = await copyToClipboard(task.activityUrl);
    if (ok) {
      setCopiedTaskId(task.id);
      window.setTimeout(() => setCopiedTaskId(prev => (prev === task.id ? null : prev)), 2000);
    }
  };
  
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
      setSelectedCourseIds([String(filterCourseIdTrigger)]);
      setShowCompleted(false);
      if (onClearFilterCourseIdTrigger) {
        onClearFilterCourseIdTrigger();
      }
    }
  }, [filterCourseIdTrigger, onClearFilterCourseIdTrigger]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    if (openDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openDropdown]);

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
    
    // Basing date from custom selected first week or default
    const startDateStr = firstWeekDate || '2026-04-13';
    const [sy, sm, sd] = startDateStr.split('-').map(Number);
    const basingDate = new Date(sy || 2026, (sm || 4) - 1, sd || 13, 0, 0, 0);
    const baseDay = basingDate.getDay();
    const baseDiffToMonday = baseDay === 0 ? -6 : 1 - baseDay;
    const basingMonday = new Date(basingDate);
    basingMonday.setDate(basingDate.getDate() + baseDiffToMonday);
    basingMonday.setHours(0, 0, 0, 0);
    
    // Find the Monday of the week date d belongs to
    const day = d.getDay(); // 0 is Sunday, 1 is Monday...
    const diffToMonday = day === 0 ? -6 : 1 - day; // how many days to get to Monday
    
    const monday = new Date(d);
    monday.setDate(d.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const msInWeek = 7 * 24 * 60 * 60 * 1000;
    const weekIndex = Math.floor((monday.getTime() - basingMonday.getTime()) / msInWeek);
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

  const getTaskAccountKey = (task: TodoTask): string => {
    if (task.moodleUsername) {
      return `${task.moodleServer || 'a'}_${task.moodleUsername.trim().toLowerCase()}`;
    }
    return 'manual';
  };

  // A subject belongs to the current period when it appears in the live Moodle
  // course list of its account. Fall back to a date approximation (21-day
  // grace) only when no live course data is available for the account.
  const PAST_SEMESTER_GRACE_MS = 21 * 24 * 60 * 60 * 1000;
  const isPastSemesterByDate = (task: TodoTask, nowTime: number): boolean => {
    if (!task.closureDate) return false;
    return new Date(task.closureDate).getTime() < nowTime - PAST_SEMESTER_GRACE_MS;
  };
  const liveAccountKey = (task: TodoTask) =>
    `${task.moodleServer || ''}|${(task.moodleUsername || '').toLowerCase()}`;
  const isCurrentSubject = (task: TodoTask): boolean => {
    if (!task.courseId) return true;
    const liveIds = liveCoursesByAccount?.[liveAccountKey(task)];
    if (!liveIds) return !isPastSemesterByDate(task, now.getTime());
    return liveIds.has(String(task.courseId));
  };

  // Find unique accounts in current-period tasks
  const uniqueAccounts = useMemo(() => {
    const map = new Map<string, { key: string; label: string; serverLabel: string; count: number }>();
    tasks.forEach(t => {
      if (!isCurrentSubject(t)) return;
      const key = getTaskAccountKey(t);
      if (!map.has(key)) {
        const label = t.moodleUsername || (language === 'es' ? 'Manual' : 'Manual');
        const serverLabel = t.moodleServer === 'upsdt' 
          ? 'UPSDT' 
          : (t.moodleServer === 'a' ? 'UNEMI P/S' : (t.moodleServer ? 'UNEMI Online' : ''));
        map.set(key, { key, label, serverLabel, count: 0 });
      }
      map.get(key)!.count += 1;
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [tasks, liveCoursesByAccount, language]);

  // Find unique courses in task base for filtering
  const uniqueCourses = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    tasks.forEach(t => {
      if (!t.courseId || !t.courseName) return;
      if (!isCurrentSubject(t)) return;
      const key = getTaskAccountKey(t);
      if (selectedAccounts.length > 0 && !selectedAccounts.includes(key)) return;
      const id = String(t.courseId);
      if (!map.has(id)) {
        map.set(id, { id, name: t.courseName, count: 0 });
      }
      map.get(id)!.count += 1;
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks, liveCoursesByAccount, selectedAccounts]);

  // Type options with counts
  const typeOptions = useMemo(() => {
    const counts: Record<string, number> = {
      TAREA: 0,
      CUESTIONARIO: 0,
      ACTIVIDAD: 0,
      MANUAL: 0,
    };
    tasks.forEach(t => {
      if (!isCurrentSubject(t)) return;
      const key = getTaskAccountKey(t);
      if (selectedAccounts.length > 0 && !selectedAccounts.includes(key)) return;
      if (selectedCourseIds.length > 0 && (!t.courseId || !selectedCourseIds.includes(String(t.courseId)))) return;
      if (counts[t.type] !== undefined) {
        counts[t.type] += 1;
      }
    });

    return [
      { id: 'TAREA', label: t('timeline.typeTask'), icon: '📝', count: counts['TAREA'] || 0 },
      { id: 'CUESTIONARIO', label: t('timeline.typeQuiz'), icon: '⏱️', count: counts['CUESTIONARIO'] || 0 },
      { id: 'ACTIVIDAD', label: t('timeline.typeActivity'), icon: '💬', count: counts['ACTIVIDAD'] || 0 },
      { id: 'MANUAL', label: t('timeline.typeManual'), icon: '📌', count: counts['MANUAL'] || 0 },
    ];
  }, [tasks, liveCoursesByAccount, selectedAccounts, selectedCourseIds, t]);

  const toggleAccount = (key: string) => {
    setSelectedAccounts(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const toggleAllAccounts = () => {
    if (selectedAccounts.length === uniqueAccounts.length) {
      setSelectedAccounts([]);
    } else {
      setSelectedAccounts(uniqueAccounts.map(a => a.key));
    }
  };

  const toggleCourse = (id: string) => {
    setSelectedCourseIds(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const toggleAllCourses = () => {
    if (selectedCourseIds.length === uniqueCourses.length) {
      setSelectedCourseIds([]);
    } else {
      setSelectedCourseIds(uniqueCourses.map(c => c.id));
    }
  };

  const toggleType = (id: string) => {
    setSelectedTypes(prev => 
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const toggleAllTypes = () => {
    if (selectedTypes.length === typeOptions.length) {
      setSelectedTypes([]);
    } else {
      setSelectedTypes(typeOptions.map(t => t.id));
    }
  };

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
    let atypicalDeadlineEmoji = '';
    if (!task.completed && task.closureDate) {
      const deadline = new Date(task.closureDate);
      const now = new Date();
      if (deadline.getTime() > now.getTime()) {
        const hours = deadline.getHours();
        const minutes = deadline.getMinutes();
        const inExcludedRange = (hours === 23 && minutes >= 57) || (hours === 0 && minutes === 0);
        if (!inExcludedRange) atypicalDeadlineEmoji = '⚠️';
      }
    }

    const withAtypicalDeadline = (emoji: string) =>
      atypicalDeadlineEmoji && emoji !== atypicalDeadlineEmoji
        ? `${emoji}${atypicalDeadlineEmoji}`
        : emoji || atypicalDeadlineEmoji;

    // 1. Actividad completada/entregada pero sin nota visible o pendiente = ⏱️
    if ((task.completed || task.status === 'Entregado') && !task.grade) {
      return withAtypicalDeadline('⏱️');
    }

    // 2. Actividad no realizada y pasado fecha de cierre = ☠️
    if (!task.completed && task.closureDate) {
      const deadline = new Date(task.closureDate).getTime();
      const now = new Date().getTime();
      if (deadline < now) {
        return withAtypicalDeadline('☠️');
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
          return withAtypicalDeadline('🔥');
        }
        
        const date = new Date(task.closureDate);
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const inExcludedRange = (hours === 23 && minutes >= 57) || (hours === 0 && minutes === 0);
        if (!inExcludedRange) {
          return withAtypicalDeadline('');
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
          if (pctVal >= 90 && pctVal <= 100) return withAtypicalDeadline('😄');
          if (pctVal >= 80 && pctVal < 90) return withAtypicalDeadline('🙂');
          if (pctVal >= 70 && pctVal < 80) return withAtypicalDeadline('😢');
          if (pctVal >= 60 && pctVal < 70) return withAtypicalDeadline('😢');
          if (pctVal > 0 && pctVal < 60) return withAtypicalDeadline('👎');
        }
      }
    }

    return withAtypicalDeadline('');
  };

  // Filter & SORT calculations:
  // Sorting rules:
  // 1. Items WITHOUT closing dates are pushed to the very end
  // 2. Items WITH closing dates are ordered chronologically ascending (closest deadline first)
  // 3. Completed items can be optionally hidden
  const filteredTasks = useMemo(() => {
    return tasks
      .filter(task => {
        const q = searchQuery.trim().toLowerCase();
        const matchesSearch = !q || 
          task.title.toLowerCase().includes(q) || 
          (task.description && task.description.toLowerCase().includes(q)) ||
          (task.courseName && task.courseName.toLowerCase().includes(q));

        const matchesAccount = selectedAccounts.length === 0 || selectedAccounts.includes(getTaskAccountKey(task));
        const matchesCourse = selectedCourseIds.length === 0 || (task.courseId && selectedCourseIds.includes(String(task.courseId)));
        const matchesType = selectedTypes.length === 0 || selectedTypes.includes(task.type);
        const matchesCompleted = showCompleted || !task.completed;
        const matchesSemester = isCurrentSubject(task);

        return matchesSearch && matchesAccount && matchesCourse && matchesType && matchesCompleted && matchesSemester;
      })
      .sort((a, b) => {
        if (!a.closureDate) return 1;
        if (!b.closureDate) return -1;
        const timeA = new Date(a.closureDate).getTime();
        const timeB = new Date(b.closureDate).getTime();
        return timeA - timeB;
      });
  }, [tasks, searchQuery, selectedAccounts, selectedCourseIds, selectedTypes, showCompleted, liveCoursesByAccount]);

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

              {task.grupo && (
                <span
                  className="text-[10px] font-medium px-2 py-0.5 rounded-md border bg-violet-50 text-violet-700 border-violet-200 flex items-center gap-1"
                  title={language === 'es' ? `Actividad en grupo: ${task.grupo}` : `Group activity: ${task.grupo}`}
                >
                  <Users className="w-3 h-3 shrink-0" />
                  <span>{language === 'es' ? 'Grupo:' : 'Group:'} {task.grupo}</span>
                </span>
              )}

              {task.grade && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border bg-emerald-50 text-emerald-800 border-emerald-200">
                  {language === 'es' ? 'Nota:' : 'Grade:'} {task.grade} {task.gradeOver ? `/ ${task.gradeOver}` : ''}
                </span>
              )}

              {/* DEDICATED QUIZ OPEN DURATION & STATUS BADGE - ONLY ON QUIZZES */}
              {task.type === 'CUESTIONARIO' && (() => {
                const nowMs = now.getTime();
                const apMs = task.apertureDateISO ? new Date(task.apertureDateISO).getTime() : null;
                const clMs = task.closureDate ? new Date(task.closureDate).getTime() : null;

                let isOpenNow = false;
                if (task.quiz_info?.abierto !== undefined && task.quiz_info?.abierto !== null) {
                  isOpenNow = task.quiz_info.abierto;
                } else if (apMs && clMs) {
                  isOpenNow = nowMs >= apMs && nowMs <= clMs;
                } else if (clMs) {
                  isOpenNow = nowMs <= clMs;
                } else if (apMs) {
                  isOpenNow = nowMs >= apMs;
                }

                // Calculate duration of the open window
                let windowDuration = '';
                if (apMs && clMs && clMs > apMs) {
                  const durMs = clMs - apMs;
                  const days = Math.floor(durMs / (24 * 3600 * 1000));
                  const hrs = Math.floor((durMs % (24 * 3600 * 1000)) / (3600 * 1000));
                  const mins = Math.round((durMs % (3600 * 1000)) / (60 * 1000));
                  if (days > 0) {
                    windowDuration = hrs > 0 ? `${days}d ${hrs}h` : `${days}d`;
                  } else if (hrs > 0) {
                    windowDuration = mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
                  } else {
                    windowDuration = `${mins}m`;
                  }
                } else if (task.quiz_info?.limite_tiempo) {
                  windowDuration = task.quiz_info.limite_tiempo;
                }

                // Calculate remaining time until close if currently open
                let remainingStr = '';
                if (clMs && clMs > nowMs) {
                  const diff = clMs - nowMs;
                  const d = Math.floor(diff / (24 * 3600 * 1000));
                  const h = Math.floor((diff % (24 * 3600 * 1000)) / (3600 * 1000));
                  const m = Math.floor((diff % (3600 * 1000)) / (60 * 1000));
                  remainingStr = d > 0 ? `${d}d ${h}h` : (h > 0 ? `${h}h ${m}m` : `${m}m`);
                }

                if (isOpenNow) {
                  return (
                    <span 
                      className="text-[10px] font-bold px-2 py-0.5 rounded-md border bg-emerald-50 text-emerald-800 border-emerald-300 shadow-2xs flex items-center gap-1.5"
                      title={language === 'es' ? 'El cuestionario se encuentra abierto ahora' : 'The quiz is currently open'}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
                      <span>
                        {language === 'es' 
                          ? (windowDuration ? `Abierto ahora (Ventana: ${windowDuration})` : (remainingStr ? `Abierto ahora (Quedan ${remainingStr})` : 'Abierto ahora'))
                          : (windowDuration ? `Open now (Window: ${windowDuration})` : (remainingStr ? `Open now (${remainingStr} left)` : 'Open now'))}
                      </span>
                    </span>
                  );
                } else {
                  const isPastClose = clMs && nowMs > clMs;
                  const isFutureOpen = apMs && nowMs < apMs;

                  if (isPastClose) {
                    return (
                      <span 
                        className="text-[10px] font-medium px-2 py-0.5 rounded-md border bg-slate-100 text-slate-600 border-slate-200 flex items-center gap-1"
                        title={language === 'es' ? 'El cuestionario ya cerró su plazo' : 'The quiz has closed'}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0"></span>
                        <span>
                          {language === 'es'
                            ? (windowDuration ? `Cerrado • Estuvo abierto ${windowDuration}` : 'Cerrado')
                            : (windowDuration ? `Closed • Was open for ${windowDuration}` : 'Closed')}
                        </span>
                      </span>
                    );
                  }

                  if (isFutureOpen) {
                    return (
                      <span 
                        className="text-[10px] font-medium px-2 py-0.5 rounded-md border bg-indigo-50 text-indigo-700 border-indigo-200 flex items-center gap-1"
                        title={language === 'es' ? 'El cuestionario aún no abre' : 'The quiz is not open yet'}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0"></span>
                        <span>
                          {language === 'es'
                            ? (windowDuration ? `Aún no abre • Estará abierto ${windowDuration}` : 'Aún no abre')
                            : (windowDuration ? `Not open yet • Open for ${windowDuration}` : 'Not open yet')}
                        </span>
                      </span>
                    );
                  }

                  return (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-md border bg-slate-100 text-slate-600 border-slate-200 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0"></span>
                      <span>
                        {language === 'es'
                          ? (windowDuration ? `Ventana: ${windowDuration}` : 'Cuestionario')
                          : (windowDuration ? `Window: ${windowDuration}` : 'Quiz')}
                      </span>
                    </span>
                  );
                }
              })()}

              {task.type === 'CUESTIONARIO' && (() => {
                const knownReviews = (task.quiz_info?.intentos || []).filter(attempt => typeof attempt.revision_permitida === 'boolean');
                if (knownReviews.length === 0) return null;
                const availableCount = knownReviews.filter(attempt => attempt.revision_permitida).length;
                const isAvailable = availableCount > 0;
                return (
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 ${isAvailable ? 'bg-violet-50 text-violet-800 border-violet-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}
                    title={language === 'es' ? 'Disponibilidad de revisión de intentos finalizados' : 'Review availability for finished attempts'}
                  >
                    {isAvailable
                      ? (language === 'es' ? `Revisión disponible (${availableCount})` : `Review available (${availableCount})`)
                      : (language === 'es' ? 'Revisión cerrada' : 'Review closed')}
                  </span>
                );
              })()}

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
            {task.activityUrl && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyActivityLink(task);
                }}
                aria-label={language === 'es' ? 'Copiar enlace de la actividad' : 'Copy activity link'}
                className={`text-[10px] font-medium p-1 rounded-md transition-colors cursor-pointer ${
                  copiedTaskId === task.id
                    ? 'text-emerald-600 bg-emerald-50'
                    : 'text-slate-400 hover:text-blue-600 hover:bg-slate-100'
                }`}
                title={
                  copiedTaskId === task.id
                    ? (language === 'es' ? 'Enlace copiado' : 'Link copied')
                    : (language === 'es' ? 'Copiar enlace de la actividad' : 'Copy activity link')
                }
              >
                {copiedTaskId === task.id ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <Link2 className="w-3 h-3" />
                )}
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
      
      {/* FROZEN FILTERS BAR - STICKY ON TOP */}
      <div 
        id="timeline-frozen-filters-bar"
        ref={filterDropdownRef}
        className="sticky top-[52px] sm:top-[56px] z-30 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl p-2.5 sm:p-3 shadow-xs space-y-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          
          {/* Search Input */}
          <div className="relative flex-1 min-w-[180px] sm:min-w-[220px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={language === 'es' ? 'Buscar actividad o materia...' : 'Search activity or course...'}
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors"
            />
            {searchQuery && (
              <button 
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Account Filter (Checkbox Popover) */}
          <div className="relative">
            <button
              id="filter-account-btn"
              type="button"
              onClick={() => setOpenDropdown(openDropdown === 'account' ? null : 'account')}
              className={`px-3 py-1.5 text-xs rounded-xl border flex items-center space-x-1.5 transition-all cursor-pointer font-medium select-none ${
                selectedAccounts.length > 0
                  ? 'bg-blue-50 text-blue-700 border-blue-300 font-bold shadow-2xs'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title={language === 'es' ? 'Filtrar por cuenta' : 'Filter by account'}
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span>
                {selectedAccounts.length === 0
                  ? (language === 'es' ? 'Cuentas: Todas' : 'Accounts: All')
                  : `${language === 'es' ? 'Cuentas' : 'Accounts'} (${selectedAccounts.length})`}
              </span>
              <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${openDropdown === 'account' ? 'rotate-180' : ''}`} />
            </button>

            {/* Account Dropdown Popover */}
            {openDropdown === 'account' && (
              <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-72 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-3 space-y-2.5 animate-in fade-in duration-150">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 text-xs">
                  <span className="font-bold text-slate-800">{language === 'es' ? 'Filtrar por Cuentas' : 'Filter by Accounts'}</span>
                  <button
                    type="button"
                    onClick={toggleAllAccounts}
                    className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer"
                  >
                    {selectedAccounts.length === uniqueAccounts.length 
                      ? t('timeline.deselectAll') 
                      : t('timeline.selectAll')}
                  </button>
                </div>

                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {uniqueAccounts.length === 0 ? (
                    <p className="text-xs text-slate-400 py-2 text-center">{t('timeline.noOptions')}</p>
                  ) : (
                    uniqueAccounts.map(acct => {
                      const isChecked = selectedAccounts.includes(acct.key);
                      return (
                        <label
                          key={acct.key}
                          className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer select-none text-xs"
                        >
                          <div className="flex items-center space-x-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleAccount(acct.key)}
                              className="w-3.5 h-3.5 text-blue-600 rounded-md border-slate-300 focus:ring-blue-500 cursor-pointer"
                            />
                            <div className="truncate">
                              <span className="font-semibold text-slate-800 truncate block">{acct.label}</span>
                              {acct.serverLabel && (
                                <span className="text-[10px] text-slate-400 font-mono">{acct.serverLabel}</span>
                              )}
                            </div>
                          </div>
                          <span className="text-[11px] font-mono text-slate-400 font-bold ml-2 shrink-0">
                            {acct.count}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Subject / Course Filter (Checkbox Popover) */}
          <div className="relative">
            <button
              id="filter-course-btn"
              type="button"
              onClick={() => setOpenDropdown(openDropdown === 'course' ? null : 'course')}
              className={`px-3 py-1.5 text-xs rounded-xl border flex items-center space-x-1.5 transition-all cursor-pointer font-medium select-none ${
                selectedCourseIds.length > 0
                  ? 'bg-blue-50 text-blue-700 border-blue-300 font-bold shadow-2xs'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title={language === 'es' ? 'Filtrar por materia' : 'Filter by subject'}
            >
              <BookOpen className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate max-w-[140px] sm:max-w-[200px]">
                {selectedCourseIds.length === 0
                  ? (language === 'es' ? `Materias: Todas (${uniqueCourses.length})` : `Courses: All (${uniqueCourses.length})`)
                  : `${language === 'es' ? 'Materias' : 'Courses'} (${selectedCourseIds.length})`}
              </span>
              <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${openDropdown === 'course' ? 'rotate-180' : ''}`} />
            </button>

            {/* Course Dropdown Popover */}
            {openDropdown === 'course' && (
              <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-3 space-y-2.5 animate-in fade-in duration-150">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 text-xs">
                  <span className="font-bold text-slate-800">{language === 'es' ? 'Filtrar por Materias' : 'Filter by Courses'}</span>
                  <button
                    type="button"
                    onClick={toggleAllCourses}
                    className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer"
                  >
                    {selectedCourseIds.length === uniqueCourses.length 
                      ? t('timeline.deselectAll') 
                      : t('timeline.selectAll')}
                  </button>
                </div>

                {/* Course search input if more than 4 courses */}
                {uniqueCourses.length > 4 && (
                  <div className="relative">
                    <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      value={courseSearch}
                      onChange={(e) => setCourseSearch(e.target.value)}
                      placeholder={language === 'es' ? 'Buscar materia...' : 'Search course...'}
                      className="w-full pl-7 pr-3 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                )}

                <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                  {uniqueCourses
                    .filter(c => !courseSearch || c.name.toLowerCase().includes(courseSearch.toLowerCase()))
                    .map(course => {
                      const isChecked = selectedCourseIds.includes(course.id);
                      return (
                        <label
                          key={course.id}
                          className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer select-none text-xs"
                        >
                          <div className="flex items-center space-x-2.5 min-w-0 mr-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleCourse(course.id)}
                              className="w-3.5 h-3.5 text-blue-600 rounded-md border-slate-300 focus:ring-blue-500 cursor-pointer shrink-0"
                            />
                            <span className="font-semibold text-slate-800 truncate" title={course.name}>
                              {course.name}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-slate-400 font-bold shrink-0">
                            {course.count}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

          {/* Type Filter (Checkbox Popover) */}
          <div className="relative">
            <button
              id="filter-type-btn"
              type="button"
              onClick={() => setOpenDropdown(openDropdown === 'type' ? null : 'type')}
              className={`px-3 py-1.5 text-xs rounded-xl border flex items-center space-x-1.5 transition-all cursor-pointer font-medium select-none ${
                selectedTypes.length > 0
                  ? 'bg-blue-50 text-blue-700 border-blue-300 font-bold shadow-2xs'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title={language === 'es' ? 'Filtrar por tipo de actividad' : 'Filter by activity type'}
            >
              <Filter className="w-3.5 h-3.5 shrink-0" />
              <span>
                {selectedTypes.length === 0
                  ? (language === 'es' ? 'Tipos: Todos' : 'Types: All')
                  : `${language === 'es' ? 'Tipos' : 'Types'} (${selectedTypes.length})`}
              </span>
              <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${openDropdown === 'type' ? 'rotate-180' : ''}`} />
            </button>

            {/* Type Dropdown Popover */}
            {openDropdown === 'type' && (
              <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-64 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-3 space-y-2.5 animate-in fade-in duration-150">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 text-xs">
                  <span className="font-bold text-slate-800">{language === 'es' ? 'Filtrar por Tipo' : 'Filter by Type'}</span>
                  <button
                    type="button"
                    onClick={toggleAllTypes}
                    className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer"
                  >
                    {selectedTypes.length === typeOptions.length 
                      ? t('timeline.deselectAll') 
                      : t('timeline.selectAll')}
                  </button>
                </div>

                <div className="space-y-1">
                  {typeOptions.map(tOpt => {
                    const isChecked = selectedTypes.includes(tOpt.id);
                    return (
                      <label
                        key={tOpt.id}
                        className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer select-none text-xs"
                      >
                        <div className="flex items-center space-x-2.5">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleType(tOpt.id)}
                            className="w-3.5 h-3.5 text-blue-600 rounded-md border-slate-300 focus:ring-blue-500 cursor-pointer"
                          />
                          <span className="text-sm shrink-0">{tOpt.icon}</span>
                          <span className="font-semibold text-slate-800">{tOpt.label}</span>
                        </div>
                        <span className="text-[11px] font-mono text-slate-400 font-bold ml-2">
                          {tOpt.count}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Show / Hide Completed Activities Toggle */}
          <button
            type="button"
            onClick={() => setShowCompleted(!showCompleted)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl border flex items-center space-x-1.5 transition-colors cursor-pointer whitespace-nowrap select-none ${
              showCompleted 
                ? 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100' 
                : 'bg-blue-50 text-blue-700 border-blue-200 shadow-2xs'
            }`}
            title={showCompleted ? (language === 'es' ? 'Ocultar actividades hechas' : 'Hide done activities') : (language === 'es' ? 'Mostrar actividades hechas' : 'Show done activities')}
          >
            <EyeOff className="w-3.5 h-3.5 shrink-0" />
            <span>{showCompleted ? (language === 'es' ? 'Hechas' : 'Done') : (language === 'es' ? 'Ocultas' : 'Hidden')}</span>
          </button>

          {/* Reset all filters button if any filter is active */}
          {(selectedAccounts.length > 0 || selectedCourseIds.length > 0 || selectedTypes.length > 0 || searchQuery) && (
            <button
              type="button"
              onClick={() => {
                setSelectedAccounts([]);
                setSelectedCourseIds([]);
                setSelectedTypes([]);
                setSearchQuery('');
                setCourseSearch('');
              }}
              className="px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100/70 border border-rose-200 rounded-xl transition-colors cursor-pointer flex items-center space-x-1 select-none"
              title={language === 'es' ? 'Restablecer todos los filtros' : 'Reset all filters'}
            >
              <X className="w-3 h-3" />
              <span>{t('timeline.clearFilters')}</span>
            </button>
          )}

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
