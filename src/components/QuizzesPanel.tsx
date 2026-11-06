import React, { useState, useMemo } from 'react';
import { 
  FileCheck, Clock, Award, CheckCircle2, AlertCircle, 
  ExternalLink, Search, RefreshCw, Eye, BookOpen, 
  Filter, Sparkles, HelpCircle, ChevronRight, 
  Flame, CheckSquare, Calendar, Users, ArrowUpRight
} from 'lucide-react';
import { TodoTask, MoodleSession } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { getServerLabel } from '../shared/platforms';

interface QuizzesPanelProps {
  tasks: TodoTask[];
  sessions: MoodleSession[];
  liveCoursesByAccount?: Record<string, Set<string>>;
  onNavigateToAgenda?: (activityUrl?: string) => void;
  onViewHtml?: (task: TodoTask) => void;
  viewingTaskId?: string | null;
}

export interface EvaluatedQuiz {
  task: TodoTask;
  isOpen: boolean;
  isUpcoming: boolean;
  isClosed: boolean;
  isDone: boolean; // Has student completed at least 1 attempt or submitted
  attemptsCount: number;
  attemptsAllowedStr: string;
  attemptsAllowedNum: number | null; // null if unlimited
  remainingAttempts: number | null; // null if unlimited or unknown
  hasReviewOpen: boolean;
  reviewableAttemptsCount: number;
  grade: string | null;
  gradeOver: string | null;
  gradePercent: number | null;
  timeLimit: string | null;
  windowDuration: string | null;
  remainingTimeStr: string | null;
  apertureDate: Date | null;
  closureDate: Date | null;
}

export default function QuizzesPanel({
  tasks,
  sessions,
  liveCoursesByAccount,
  onNavigateToAgenda,
  onViewHtml,
  viewingTaskId
}: QuizzesPanelProps) {
  const { t, language } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'open_pending' | 'open_done' | 'reviews' | 'done' | 'upcoming' | 'closed'>('open');
  const [selectedCourse, setSelectedCourse] = useState<string>('all');
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'urgency' | 'course' | 'grade' | 'attempts'>('urgency');

  const now = new Date();
  const nowMs = now.getTime();

  // Helper to parse numeric values safely
  const parseNum = (val: string | null | undefined): number | null => {
    if (!val) return null;
    const clean = String(val).replace(/,/g, '.').replace(/[^\d.-]/g, '').trim();
    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
  };

  // Identify all quizzes
  const allQuizzes = useMemo(() => {
    return tasks.filter(task => {
      if (task.type === 'CUESTIONARIO') return true;
      const lowerTitle = (task.title || '').toLowerCase();
      return /quiz|cuestionario|examen|evalua|lecci|test\b/i.test(lowerTitle);
    });
  }, [tasks]);

  // Evaluate detailed status for every quiz
  const evaluatedQuizzes: EvaluatedQuiz[] = useMemo(() => {
    return allQuizzes.map(task => {
      const apMs = task.apertureDateISO ? new Date(task.apertureDateISO).getTime() : null;
      const clMs = task.closureDate ? new Date(task.closureDate).getTime() : null;
      const apertureDate = apMs ? new Date(apMs) : null;
      const closureDate = clMs ? new Date(clMs) : null;

      // Determine open status
      let isOpen = false;
      if (task.quiz_info?.abierto !== undefined && task.quiz_info?.abierto !== null) {
        isOpen = task.quiz_info.abierto;
      } else if (apMs && clMs) {
        isOpen = nowMs >= apMs && nowMs <= clMs;
      } else if (clMs) {
        isOpen = nowMs <= clMs;
      } else if (apMs) {
        isOpen = nowMs >= apMs;
      }

      const isUpcoming = Boolean(apMs && nowMs < apMs);
      const isClosed = Boolean(clMs && nowMs > clMs);

      // Attempts evaluation
      const attemptsList = task.quiz_info?.intentos || [];
      const hasCompletedAttempt = attemptsList.some(
        att => att.estado?.toLowerCase().includes('terminad') || att.estado?.toLowerCase().includes('finish') || att.calificacion != null
      );
      const isDone = task.completed || 
                     hasCompletedAttempt || 
                     (attemptsList.length > 0) || 
                     (task.grade !== null && task.grade !== undefined && task.grade !== '') ||
                     (task.status && /entregad|enviad|calificad|terminad|finalizad/i.test(task.status));

      const attemptsCount = attemptsList.length > 0 ? attemptsList.length : (isDone ? 1 : 0);

      // Attempts allowed
      let attemptsAllowedStr = task.quiz_info?.intentos_permitidos || (language === 'es' ? '1 intento' : '1 attempt');
      let attemptsAllowedNum: number | null = null;
      let remainingAttempts: number | null = null;

      if (task.quiz_info?.intentos_permitidos) {
        const raw = task.quiz_info.intentos_permitidos.trim().toLowerCase();
        if (raw.includes('ilimitad') || raw.includes('unlimited') || raw === '0') {
          attemptsAllowedStr = t('quizzes.unlimitedAttempts');
          attemptsAllowedNum = null;
          remainingAttempts = null;
        } else {
          const matchNum = raw.match(/\d+/);
          if (matchNum) {
            attemptsAllowedNum = parseInt(matchNum[0], 10);
            remainingAttempts = Math.max(0, attemptsAllowedNum - attemptsCount);
            attemptsAllowedStr = `${attemptsAllowedNum} ${attemptsAllowedNum === 1 ? (language === 'es' ? 'intento' : 'attempt') : (language === 'es' ? 'intentos' : 'attempts')}`;
          }
        }
      } else {
        attemptsAllowedNum = 1;
        remainingAttempts = Math.max(0, 1 - attemptsCount);
      }

      // Reviews evaluation
      let reviewableAttemptsCount = 0;
      attemptsList.forEach(att => {
        if (att.revision_permitida === true) {
          reviewableAttemptsCount++;
        }
      });
      const hasReviewOpen = reviewableAttemptsCount > 0;

      // Grade evaluation
      const grade = task.quiz_info?.calificacion_final || task.grade || null;
      const gradeOver = task.quiz_info?.calificacion_sobre || task.gradeOver || '10.0';
      const numGrade = parseNum(grade);
      const numGradeOver = parseNum(gradeOver) || 10;
      const gradePercent = numGrade !== null && numGradeOver > 0 ? (numGrade / numGradeOver) * 100 : null;

      // Window duration string
      let windowDuration: string | null = null;
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

      // Time left until close
      let remainingTimeStr: string | null = null;
      if (isOpen && clMs && clMs > nowMs) {
        const diff = clMs - nowMs;
        const d = Math.floor(diff / (24 * 3600 * 1000));
        const h = Math.floor((diff % (24 * 3600 * 1000)) / (3600 * 1000));
        const m = Math.floor((diff % (3600 * 1000)) / (60 * 1000));
        if (d > 0) {
          remainingTimeStr = language === 'es' ? `${d}d ${h}h restantes` : `${d}d ${h}h left`;
        } else if (h > 0) {
          remainingTimeStr = language === 'es' ? `${h}h ${m}m restantes` : `${h}h ${m}m left`;
        } else {
          remainingTimeStr = language === 'es' ? `¡${m} minutos restantes!` : `¡${m} minutes left!`;
        }
      }

      return {
        task,
        isOpen,
        isUpcoming,
        isClosed,
        isDone,
        attemptsCount,
        attemptsAllowedStr,
        attemptsAllowedNum,
        remainingAttempts,
        hasReviewOpen,
        reviewableAttemptsCount,
        grade,
        gradeOver,
        gradePercent,
        timeLimit: task.quiz_info?.limite_tiempo || null,
        windowDuration,
        remainingTimeStr,
        apertureDate,
        closureDate
      };
    });
  }, [allQuizzes, nowMs, language, t]);

  // High-level Metrics
  const metrics = useMemo(() => {
    const total = evaluatedQuizzes.length;
    const openNow = evaluatedQuizzes.filter(q => q.isOpen);
    const openPending = openNow.filter(q => !q.isDone);
    const openDone = openNow.filter(q => q.isDone);
    const reviewsOpen = evaluatedQuizzes.filter(q => q.hasReviewOpen);
    const totalReviewableAttempts = evaluatedQuizzes.reduce((acc, q) => acc + q.reviewableAttemptsCount, 0);
    const allDone = evaluatedQuizzes.filter(q => q.isDone);
    const totalAttemptsDone = evaluatedQuizzes.reduce((acc, q) => acc + q.attemptsCount, 0);

    // Calculate average grade among quizzes that have grades
    const graded = evaluatedQuizzes.filter(q => q.gradePercent !== null);
    const avgPercent = graded.length > 0 
      ? Math.round(graded.reduce((acc, q) => acc + (q.gradePercent || 0), 0) / graded.length)
      : null;

    return {
      total,
      openCount: openNow.length,
      openPendingCount: openPending.length,
      openDoneCount: openDone.length,
      reviewsOpenCount: reviewsOpen.length,
      totalReviewableAttempts,
      allDoneCount: allDone.length,
      totalAttemptsDone,
      avgPercent,
      gradedCount: graded.length
    };
  }, [evaluatedQuizzes]);

  // Unique Courses & Accounts for Filters
  const uniqueCourses = useMemo(() => {
    const map = new Map<string, string>();
    evaluatedQuizzes.forEach(q => {
      if (q.task.courseId && q.task.courseName) {
        map.set(String(q.task.courseId), q.task.courseName);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [evaluatedQuizzes]);

  const uniqueAccounts = useMemo(() => {
    const set = new Set<string>();
    evaluatedQuizzes.forEach(q => {
      if (q.task.moodleUsername) set.add(q.task.moodleUsername);
    });
    return Array.from(set);
  }, [evaluatedQuizzes]);

  // Filter & Sort
  const filteredQuizzes = useMemo(() => {
    return evaluatedQuizzes.filter(q => {
      // Search
      const query = searchQuery.trim().toLowerCase();
      if (query) {
        const titleMatch = (q.task.title || '').toLowerCase().includes(query);
        const courseMatch = (q.task.courseName || '').toLowerCase().includes(query);
        if (!titleMatch && !courseMatch) return false;
      }

      // Status
      if (statusFilter === 'open' && !q.isOpen) return false;
      if (statusFilter === 'open_pending' && (!q.isOpen || q.isDone)) return false;
      if (statusFilter === 'open_done' && (!q.isOpen || !q.isDone)) return false;
      if (statusFilter === 'reviews' && !q.hasReviewOpen) return false;
      if (statusFilter === 'done' && !q.isDone) return false;
      if (statusFilter === 'upcoming' && !q.isUpcoming) return false;
      if (statusFilter === 'closed' && !q.isClosed) return false;

      // Course
      if (selectedCourse !== 'all' && String(q.task.courseId) !== selectedCourse) return false;

      // Account
      if (selectedAccount !== 'all' && q.task.moodleUsername !== selectedAccount) return false;

      return true;
    }).sort((a, b) => {
      if (sortBy === 'urgency') {
        // Open & pending first, then open & done, then upcoming, then closed
        if (a.isOpen && !a.isDone && (!b.isOpen || b.isDone)) return -1;
        if (b.isOpen && !b.isDone && (!a.isOpen || a.isDone)) return 1;
        if (a.isOpen && !b.isOpen) return -1;
        if (!a.isOpen && b.isOpen) return 1;
        
        // Closest closing date first
        const timeA = a.closureDate ? a.closureDate.getTime() : Infinity;
        const timeB = b.closureDate ? b.closureDate.getTime() : Infinity;
        return timeA - timeB;
      }
      if (sortBy === 'grade') {
        const gA = a.gradePercent ?? -1;
        const gB = b.gradePercent ?? -1;
        return gB - gA;
      }
      if (sortBy === 'attempts') {
        return b.attemptsCount - a.attemptsCount;
      }
      if (sortBy === 'course') {
        return (a.task.courseName || '').localeCompare(b.task.courseName || '');
      }
      return 0;
    });
  }, [evaluatedQuizzes, searchQuery, statusFilter, selectedCourse, selectedAccount, sortBy]);

  // Open Quizzes currently pending (Urgent highlight)
  const urgentPendingOpenQuizzes = useMemo(() => {
    return evaluatedQuizzes.filter(q => q.isOpen && !q.isDone);
  }, [evaluatedQuizzes]);

  const formatDate = (d: Date | null) => {
    if (!d) return language === 'es' ? 'Sin fecha' : 'No date';
    return d.toLocaleString(language === 'es' ? 'es-EC' : 'en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div id="quizzes-panel" className="space-y-6">
      
      {/* 1. SECTION HEADER */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-2xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
                <FileCheck className="w-5 h-5 stroke-[2.2]" />
              </div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                {t('quizzes.title')}
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              {t('quizzes.subtitle')}
            </p>
          </div>

          {/* Quick badge summary */}
          <div className="flex items-center space-x-2 shrink-0">
            <span className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border ${
              metrics.openCount > 0 
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 shadow-2xs animate-pulse-slow' 
                : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${metrics.openCount > 0 ? 'bg-emerald-500 animate-ping' : 'bg-slate-400'}`} />
              <span>
                {metrics.openCount} {language === 'es' ? (metrics.openCount === 1 ? 'abierto ahora' : 'abiertos ahora') : (metrics.openCount === 1 ? 'open right now' : 'open right now')}
              </span>
            </span>

            {metrics.reviewsOpenCount > 0 && (
              <span className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border bg-violet-50 text-violet-800 border-violet-200 shadow-2xs">
                <Sparkles className="w-3.5 h-3.5 text-violet-600" />
                <span>
                  {metrics.reviewsOpenCount} {language === 'es' ? (metrics.reviewsOpenCount === 1 ? 'revisión activa' : 'revisiones activas') : (metrics.reviewsOpenCount === 1 ? 'review open' : 'reviews open')}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* 2. HERO KPI METRIC CARDS */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
          
          {/* CARD 1: ABIERTOS AHORA (THE MOST IMPORTANT METRIC) */}
          <div 
            onClick={() => setStatusFilter('open')}
            className={`p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden ${
              statusFilter === 'open' 
                ? 'bg-emerald-500/10 border-emerald-400 shadow-xs ring-2 ring-emerald-200' 
                : 'bg-emerald-50/50 hover:bg-emerald-50 border-emerald-200/80 shadow-2xs'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-emerald-900 uppercase tracking-wider flex items-center space-x-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>{t('quizzes.openNow')}</span>
              </span>
              <span className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg">
                <Clock className="w-3.5 h-3.5" />
              </span>
            </div>
            
            <div className="mt-2 flex items-baseline space-x-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-950 font-mono">
                {metrics.openCount}
              </span>
              <span className="text-xs text-emerald-700 font-medium">
                {language === 'es' ? 'en ventana activa' : 'active now'}
              </span>
            </div>

            <div className="mt-2 text-[10px] text-emerald-800 flex items-center justify-between border-t border-emerald-200/60 pt-1.5">
              <span>{metrics.openPendingCount} {language === 'es' ? 'por rendir' : 'to take'}</span>
              <span>•</span>
              <span>{metrics.openDoneCount} {language === 'es' ? 'ya rendidos' : 'taken'}</span>
            </div>
          </div>

          {/* CARD 2: REVISIONES HABILITADAS */}
          <div 
            onClick={() => setStatusFilter('reviews')}
            className={`p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden ${
              statusFilter === 'reviews' 
                ? 'bg-violet-500/10 border-violet-400 shadow-xs ring-2 ring-violet-200' 
                : 'bg-violet-50/50 hover:bg-violet-50 border-violet-200/80 shadow-2xs'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-violet-900 uppercase tracking-wider flex items-center space-x-1">
                <Sparkles className="w-3 h-3 text-violet-600" />
                <span>{t('quizzes.reviewsOpen')}</span>
              </span>
              <span className="p-1.5 bg-violet-100 text-violet-700 rounded-lg">
                <Eye className="w-3.5 h-3.5" />
              </span>
            </div>

            <div className="mt-2 flex items-baseline space-x-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-violet-950 font-mono">
                {metrics.reviewsOpenCount}
              </span>
              <span className="text-xs text-violet-700 font-medium">
                {language === 'es' ? 'cuestionarios' : 'quizzes'}
              </span>
            </div>

            <div className="mt-2 text-[10px] text-violet-800 border-t border-violet-200/60 pt-1.5 truncate">
              {metrics.totalReviewableAttempts} {language === 'es' ? 'intentos con retroalimentación' : 'attempts with feedback'}
            </div>
          </div>

          {/* CARD 3: INTENTOS REALIZADOS */}
          <div 
            onClick={() => setStatusFilter('done')}
            className={`p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden ${
              statusFilter === 'done' 
                ? 'bg-blue-500/10 border-blue-400 shadow-xs ring-2 ring-blue-200' 
                : 'bg-blue-50/50 hover:bg-blue-50 border-blue-200/80 shadow-2xs'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider flex items-center space-x-1">
                <CheckCircle2 className="w-3 h-3 text-blue-600" />
                <span>{t('quizzes.attemptsDone')}</span>
              </span>
              <span className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                <CheckSquare className="w-3.5 h-3.5" />
              </span>
            </div>

            <div className="mt-2 flex items-baseline space-x-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-blue-950 font-mono">
                {metrics.totalAttemptsDone}
              </span>
              <span className="text-xs text-blue-700 font-medium">
                {language === 'es' ? 'intentos enviados' : 'attempts sent'}
              </span>
            </div>

            <div className="mt-2 text-[10px] text-blue-800 border-t border-blue-200/60 pt-1.5">
              {metrics.allDoneCount} {language === 'es' ? `de ${metrics.total} cuestionarios completados` : `of ${metrics.total} completed`}
            </div>
          </div>

          {/* CARD 4: PROMEDIO DE CALIFICACIONES */}
          <div 
            className="p-4 rounded-2xl border bg-slate-50/80 border-slate-200 shadow-2xs relative overflow-hidden"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center space-x-1">
                <Award className="w-3.5 h-3.5 text-amber-600" />
                <span>{t('quizzes.avgGrade')}</span>
              </span>
              <span className="p-1.5 bg-amber-100 text-amber-700 rounded-lg">
                <Award className="w-3.5 h-3.5" />
              </span>
            </div>

            <div className="mt-2 flex items-baseline space-x-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-mono">
                {metrics.avgPercent !== null ? `${(metrics.avgPercent / 10).toFixed(1)}` : '—'}
              </span>
              <span className="text-xs text-slate-500 font-medium">
                {metrics.avgPercent !== null ? `/ 10 (${metrics.avgPercent}%)` : (language === 'es' ? 'Sin notas aún' : 'No grades yet')}
              </span>
            </div>

            <div className="mt-2 text-[10px] text-slate-500 border-t border-slate-200 pt-1.5">
              {metrics.gradedCount} {language === 'es' ? 'evaluaciones calificadas' : 'graded evaluations'}
            </div>
          </div>

        </div>

        {/* 3. URGENT ALERT: OPEN QUIZZES NOT YET COMPLETED */}
        {urgentPendingOpenQuizzes.length > 0 && (
          <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-200">
            <div className="flex items-start space-x-3">
              <div className="p-2 bg-amber-100 text-amber-700 rounded-xl shrink-0 mt-0.5">
                <Flame className="w-4 h-4 text-amber-600" />
              </div>
              <div className="space-y-0.5">
                <h4 className="text-xs sm:text-sm font-bold text-amber-900">
                  {t('quizzes.urgentAlertTitle')}
                </h4>
                <p className="text-xs text-amber-800 leading-normal">
                  {t('quizzes.urgentAlertBody', { count: urgentPendingOpenQuizzes.length })}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStatusFilter('open_pending')}
              className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shrink-0 transition-colors shadow-2xs cursor-pointer self-start sm:self-auto"
            >
              {language === 'es' ? `Ver pendientes (${urgentPendingOpenQuizzes.length})` : `View pending (${urgentPendingOpenQuizzes.length})`}
            </button>
          </div>
        )}
      </div>

      {/* 4. FILTERS & SEARCH CONTROLS */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-3 sm:p-4 shadow-2xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          
          {/* Search box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('quizzes.searchPlaceholder')}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-purple-500 font-medium text-slate-800"
            />
          </div>

          {/* Course select */}
          {uniqueCourses.length > 0 && (
            <select
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden text-slate-700 font-medium cursor-pointer"
            >
              <option value="all">{language === 'es' ? 'Todas las materias' : 'All courses'}</option>
              {uniqueCourses.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}

          {/* Account select (if multi-account) */}
          {uniqueAccounts.length > 1 && (
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden text-slate-700 font-medium cursor-pointer"
            >
              <option value="all">{language === 'es' ? 'Todas las cuentas' : 'All accounts'}</option>
              {uniqueAccounts.map(acc => (
                <option key={acc} value={acc}>{acc}</option>
              ))}
            </select>
          )}

          {/* Sort selector */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden text-slate-700 font-medium cursor-pointer"
          >
            <option value="urgency">{language === 'es' ? 'Ordenar: Urgencia / Cierre próximo' : 'Sort: Urgency / Closest deadline'}</option>
            <option value="grade">{language === 'es' ? 'Ordenar: Mayor calificación' : 'Sort: Highest grade'}</option>
            <option value="attempts">{language === 'es' ? 'Ordenar: Más intentos' : 'Sort: Most attempts'}</option>
            <option value="course">{language === 'es' ? 'Ordenar: Materia (A-Z)' : 'Sort: Course (A-Z)'}</option>
          </select>
        </div>

        {/* Quick status tabs pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setStatusFilter('open')}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
              statusFilter === 'open' 
                ? 'bg-emerald-600 text-white shadow-2xs' 
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${statusFilter === 'open' ? 'bg-white' : 'bg-emerald-500'}`} />
            <span>{t('quizzes.filterOpenNow')} ({metrics.openCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('open_pending')}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
              statusFilter === 'open_pending' 
                ? 'bg-amber-600 text-white shadow-2xs' 
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <span>{language === 'es' ? 'Abiertos sin rendir' : 'Open & Pending'} ({metrics.openPendingCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('reviews')}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
              statusFilter === 'reviews' 
                ? 'bg-violet-600 text-white shadow-2xs' 
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <Sparkles className="w-3 h-3" />
            <span>{t('quizzes.filterReviews')} ({metrics.reviewsOpenCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('done')}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              statusFilter === 'done' 
                ? 'bg-blue-600 text-white shadow-2xs' 
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            {t('quizzes.filterDone')} ({metrics.allDoneCount})
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('upcoming')}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              statusFilter === 'upcoming' 
                ? 'bg-indigo-600 text-white shadow-2xs' 
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            {t('quizzes.filterUpcoming')}
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('closed')}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              statusFilter === 'closed' 
                ? 'bg-slate-700 text-white shadow-2xs' 
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            {t('quizzes.filterClosed')}
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              statusFilter === 'all' 
                ? 'bg-slate-900 text-white shadow-2xs' 
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            {t('quizzes.all')} ({metrics.total})
          </button>
        </div>
      </div>

      {/* 5. LIST OF QUIZZES */}
      <div className="space-y-3">
        {filteredQuizzes.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-3">
            <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center mx-auto">
              <FileCheck className="w-6 h-6 stroke-[1.8]" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">
              {statusFilter === 'open' ? t('quizzes.allCaughtUp') : t('quizzes.emptyTitle')}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {t('quizzes.emptyDesc')}
            </p>
          </div>
        ) : (
          filteredQuizzes.map((quiz) => {
            const { task } = quiz;
            const attemptsList = task.quiz_info?.intentos || [];
            const serverLabel = getServerLabel(task.moodleServer, task.moodleBaseUrl);

            return (
              <div 
                key={task.id}
                className={`bg-white border rounded-2xl p-4 sm:p-5 transition-all shadow-2xs space-y-3 relative ${
                  quiz.isOpen 
                    ? 'border-emerald-300 ring-1 ring-emerald-100/80 bg-linear-to-r from-emerald-50/20 via-white to-white' 
                    : 'border-slate-200/90 hover:border-slate-300'
                }`}
              >
                {/* Top header row: Subject & Badges */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center space-x-2 min-w-0">
                    <span className="text-[10px] uppercase font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md truncate max-w-[220px]">
                      {task.courseName || (language === 'es' ? 'Materia General' : 'General Course')}
                    </span>
                    {task.moodleUsername && (
                      <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-50 border border-slate-200 px-1.5 py-0.2 rounded shrink-0">
                        {serverLabel}
                      </span>
                    )}
                  </div>

                  {/* Status badge */}
                  <div className="flex items-center space-x-1.5 shrink-0">
                    {quiz.isOpen ? (
                      <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-lg border bg-emerald-50 text-emerald-800 border-emerald-300 flex items-center space-x-1 shadow-2xs">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                        <span>{t('quizzes.statusOpen')}</span>
                        {quiz.remainingTimeStr && (
                          <span className="text-[10px] text-emerald-700 font-medium">
                            • {quiz.remainingTimeStr}
                          </span>
                        )}
                      </span>
                    ) : quiz.isUpcoming ? (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg border bg-indigo-50 text-indigo-700 border-indigo-200 flex items-center space-x-1">
                        <Clock className="w-3 h-3 shrink-0" />
                        <span>{t('quizzes.statusUpcoming')}</span>
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-lg border bg-slate-100 text-slate-600 border-slate-200">
                        {t('quizzes.statusClosed')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Title and main information */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0 flex-1">
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">
                      {task.title}
                    </h3>

                    {/* Window details & timings */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      {quiz.apertureDate && (
                        <span>
                          <strong className="text-slate-700">{t('quizzes.cardAperture')}</strong> {formatDate(quiz.apertureDate)}
                        </span>
                      )}
                      {quiz.closureDate && (
                        <span>
                          <strong className="text-slate-700">{t('quizzes.cardClosure')}</strong> {formatDate(quiz.closureDate)}
                        </span>
                      )}
                      {quiz.windowDuration && (
                        <span className="text-slate-400">
                          ({t('quizzes.cardWindow')} {quiz.windowDuration})
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Final Grade pill */}
                  <div className="flex items-center space-x-2 shrink-0 self-start sm:self-center">
                    {quiz.grade ? (
                      <div className="px-3 py-1.5 rounded-xl border bg-emerald-50 border-emerald-200 text-right">
                        <p className="text-[10px] text-emerald-700 font-bold uppercase tracking-wider">{t('quizzes.finalGrade')}</p>
                        <p className="text-sm font-extrabold text-emerald-950 font-mono">
                          {quiz.grade} {quiz.gradeOver ? `/ ${quiz.gradeOver}` : ''}
                        </p>
                      </div>
                    ) : (
                      <div className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-200 text-right">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{t('quizzes.finalGrade')}</p>
                        <p className="text-xs font-semibold text-slate-600">
                          {quiz.isDone ? t('quizzes.ungraded') : (language === 'es' ? 'Pendiente' : 'Pending')}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Metrics Breakdown Grid for this Quiz */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-slate-50/80 border border-slate-100 rounded-xl p-2.5">
                  {/* Attempts Allowed */}
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">
                      {t('quizzes.attemptsAllowed')}
                    </span>
                    <span className="font-bold text-slate-800">
                      {quiz.attemptsAllowedStr}
                    </span>
                  </div>

                  {/* Attempts Done */}
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">
                      {t('quizzes.attemptsCompleted')}
                    </span>
                    <span className={`font-bold ${quiz.attemptsCount > 0 ? 'text-blue-700' : 'text-slate-500'}`}>
                      {quiz.attemptsCount} {quiz.attemptsAllowedNum ? `/ ${quiz.attemptsAllowedNum}` : (language === 'es' ? 'intentos' : 'attempts')}
                    </span>
                  </div>

                  {/* Remaining attempts */}
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">
                      {t('quizzes.remainingAttempts')}
                    </span>
                    <span className={`font-bold ${
                      quiz.remainingAttempts !== null && quiz.remainingAttempts > 0 
                        ? 'text-emerald-700' 
                        : (quiz.remainingAttempts === 0 ? 'text-slate-400' : 'text-slate-700')
                    }`}>
                      {quiz.remainingAttempts !== null 
                        ? `${quiz.remainingAttempts} ${quiz.remainingAttempts === 1 ? (language === 'es' ? 'disponible' : 'available') : (language === 'es' ? 'disponibles' : 'available')}`
                        : (language === 'es' ? 'Sin límite' : 'Unlimited')}
                    </span>
                  </div>

                  {/* Time limit */}
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">
                      {t('quizzes.timeLimit')}
                    </span>
                    <span className="font-bold text-slate-800">
                      {quiz.timeLimit ? `⏱️ ${quiz.timeLimit}` : t('quizzes.noTimeLimit')}
                    </span>
                  </div>
                </div>

                {/* Attempts list & review buttons (if attempts were parsed) */}
                {attemptsList.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider flex items-center space-x-1">
                      <span>{language === 'es' ? 'Detalle de Intentos:' : 'Attempts Breakdown:'}</span>
                    </p>

                    <div className="space-y-1.5">
                      {attemptsList.map((att, attIdx) => {
                        const canReview = att.revision_permitida === true;

                        return (
                          <div 
                            key={att.attemptId || attIdx} 
                            className="flex flex-col sm:flex-row sm:items-center justify-between p-2 rounded-xl border bg-white border-slate-200/80 text-xs gap-2"
                          >
                            <div className="flex items-center space-x-2">
                              <span className="px-2 py-0.5 rounded-md bg-slate-100 font-bold text-slate-700 font-mono text-[11px]">
                                {language === 'es' ? `Intento ${att.numero || attIdx + 1}` : `Attempt ${att.numero || attIdx + 1}`}
                              </span>
                              <span className="text-slate-600 font-medium">
                                {att.estado || (language === 'es' ? 'Terminado' : 'Finished')}
                              </span>
                              {att.duracion && (
                                <span className="text-[11px] text-slate-400">
                                  ({att.duracion})
                                </span>
                              )}
                              {att.calificacion && (
                                <span className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 text-[11px]">
                                  {language === 'es' ? 'Nota:' : 'Grade:'} {att.calificacion} / {att.calificacion_sobre || '10.0'}
                                </span>
                              )}
                            </div>

                            {/* Direct Review Action */}
                            <div className="flex items-center space-x-2 shrink-0">
                              {canReview ? (
                                <a
                                  href={att.revision_url || task.activityUrl || '#'}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-bold text-[11px] transition-colors shadow-2xs"
                                >
                                  <Sparkles className="w-3 h-3" />
                                  <span>{t('quizzes.reviewAttempt', { num: att.numero || attIdx + 1 })}</span>
                                  <ExternalLink className="w-3 h-3 ml-0.5" />
                                </a>
                              ) : (
                                <span className="text-[10px] text-slate-400 font-medium italic">
                                  {t('quizzes.reviewLocked')}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Actions row: Open in Moodle, View on Agenda */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center space-x-2 text-xs">
                    {quiz.isOpen && !quiz.isDone && (
                      <span className="text-[11px] font-bold text-amber-600 flex items-center space-x-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{language === 'es' ? '¡Ventana abierta para rendir!' : 'Window open to take quiz!'}</span>
                      </span>
                    )}
                    {quiz.isOpen && quiz.isDone && quiz.remainingAttempts !== 0 && (
                      <span className="text-[11px] font-bold text-emerald-700 flex items-center space-x-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{language === 'es' ? 'Intento enviado (Puedes rendir otro si lo deseas)' : 'Attempt submitted (Extra attempt available)'}</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-2 shrink-0 ml-auto">
                    {onViewHtml && task.activityUrl && (
                      <button
                        type="button"
                        onClick={() => onViewHtml(task)}
                        disabled={viewingTaskId === task.id}
                        className="px-2.5 py-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center space-x-1"
                        title={language === 'es' ? 'Previsualizar página de Moodle' : 'Preview Moodle page'}
                      >
                        {viewingTaskId === task.id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                        <span>HTML</span>
                      </button>
                    )}

                    {onNavigateToAgenda && (
                      <button
                        type="button"
                        onClick={() => onNavigateToAgenda(task.activityUrl || undefined)}
                        className="px-2.5 py-1 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center space-x-1"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{t('quizzes.viewInAgenda')}</span>
                      </button>
                    )}

                    {task.activityUrl && (
                      <a
                        href={task.activityUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-xl text-xs font-bold transition-all shadow-2xs ${
                          quiz.isOpen && !quiz.isDone
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white animate-pulse'
                            : 'bg-purple-600 hover:bg-purple-700 text-white'
                        }`}
                      >
                        <span>{t('quizzes.openInMoodle')}</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>

              </div>
            );
          })
        )}
      </div>

    </div>
  );
}
