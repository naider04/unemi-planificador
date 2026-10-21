import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Calendar, Lock, Award, CheckCircle2, 
  Sparkles, Clock, AlertCircle, Bookmark, CheckSquare, Eye, RefreshCw, Download, BarChart3,
  Bell, BellOff, Trash2, ArrowLeft, ArrowRight, ExternalLink,
  SlidersHorizontal, ChevronDown, UserPlus, LogOut, X, Users, Settings2, Key
} from 'lucide-react';

import { MoodleSession, TodoTask, Course, MoodleNotification } from './types';
import LoginPanel from './components/LoginPanel';
import ActivityTimeline from './components/ActivityTimeline';
import NewTaskModal from './components/NewTaskModal';
import StatsPanel from './components/StatsPanel';
import SyncStatusBar from './components/SyncStatusBar';
import { fetchUserCacheFromFirestore, saveUserCacheToFirestore } from './firebase';
import { useLanguage } from './context/LanguageContext';
import LanguageToggle from './components/LanguageToggle';

export function mergeTasksLists(currentTasks: TodoTask[], newTasks: TodoTask[]): TodoTask[] {
  const merged = [...currentTasks];
  newTasks.forEach(nt => {
    let idx = -1;
    if (nt.activityUrl) {
      idx = merged.findIndex(t => t.activityUrl === nt.activityUrl);
    } else {
      idx = merged.findIndex(s => s.id === nt.id);
    }

    if (idx !== -1) {
      merged[idx] = {
        ...merged[idx],
        ...nt,
        completed: merged[idx].completed || nt.completed,
        section: nt.section ?? merged[idx].section ?? null,
      };
    } else {
      merged.push(nt);
    }
  });
  return merged;
}

const taskAccountKey = (t: TodoTask): string =>
  t.moodleUsername && t.moodleServer
    ? `${t.moodleServer}_${t.moodleUsername.trim().toLowerCase()}`
    : '';

export function reconcileTasksWithFreshSync(
  currentTasks: TodoTask[],
  authoritativeTasks: TodoTask[]
): { reconciled: TodoTask[]; removed: TodoTask[] } {
  // Collect the authoritative activity URLs per successfully-synced account.
  // An account is considered successfully synced only when the fresh sync
  // produced at least one activity for it; otherwise we keep its tasks
  // untouched (e.g. the account failed or errored mid-sync).
  const urlsByAccount = new Map<string, Set<string>>();
  authoritativeTasks.forEach(t => {
    const key = taskAccountKey(t);
    if (!key) return;
    if (!urlsByAccount.has(key)) urlsByAccount.set(key, new Set());
    if (t.activityUrl) urlsByAccount.get(key)!.add(t.activityUrl);
  });

  const removed: TodoTask[] = [];
  const reconciled = currentTasks.filter(t => {
    // Manual/local tasks (no Moodle URL) are always preserved.
    if (!t.activityUrl) return true;
    const key = taskAccountKey(t);
    // Tasks for accounts not covered by this sync run are preserved.
    if (!key || !urlsByAccount.has(key)) return true;
    const urls = urlsByAccount.get(key)!;
    // Nothing came back for this account at all -> don't guess, keep.
    if (!urls || urls.size === 0) return true;
    if (urls.has(t.activityUrl)) return true;
    removed.push(t);
    return false;
  });

  return { reconciled, removed };
}

const isStatusSubmittedLocal = (estadoEntrega: string | null | undefined): boolean => {
  if (!estadoEntrega) return false;
  const estLower = estadoEntrega.toLowerCase();
  if (
    estLower.includes('no se ha enviado nada') || 
    estLower.includes('no entregado') || 
    estLower.includes('sin entregar') || 
    estLower.includes('no enviado') ||
    estLower.includes('sin enviar')
  ) {
    return false;
  }
  if (estLower.includes('enviado') || estLower.includes('entregado')) {
    return true;
  }
  return false;
};

export default function App() {
  const { t, language } = useLanguage();
  const [sessions, setSessions] = useState<MoodleSession[]>([]);
  const [activeSessionIndex, setActiveSessionIndex] = useState<number>(0);
  const [isDbLoaded, setIsDbLoaded] = useState<boolean>(false);
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  // Live "current period" subjects fetched per connected Moodle account:
  // key = `${server}|${username.toLowerCase()}`, value = Set of course IDs.
  const [liveCoursesByAccount, setLiveCoursesByAccount] = useState<Record<string, Set<string>>>({});
  const [activeTab, setActiveTab] = useState<'agenda' | 'login' | 'stats'>('agenda');

  // Alert and Loading states for Activity detail fetching/opening
  const [showConnectionsAlert, setShowConnectionsAlert] = useState<boolean>(false);
  const [isShaking, setIsShaking] = useState<boolean>(false);
  const [viewingTaskId, setViewingTaskId] = useState<string | null>(null);

  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [agendaNavigation, setAgendaNavigation] = useState<string | null>(null);
  const [prefillLogin, setPrefillLogin] = useState<{ username: string; server: 'a' | 'b' | 'upsdt'; errorMsg: string } | null>(null);
  const [timelineFilterCourseId, setTimelineFilterCourseId] = useState<string | null>(null);
  const [syncedAccountsCount, setSyncedAccountsCount] = useState<number | null>(null);
  const [isVerifyingSessions, setIsVerifyingSessions] = useState<boolean>(false);

  // Inline account relogin (expired accounts) in the "More options" dropdown
  const [reloginOpenFor, setReloginOpenFor] = useState<string | null>(null);
  const [reloginPassword, setReloginPassword] = useState('');
  const [reloginLoadingFor, setReloginLoadingFor] = useState<string | null>(null);
  const [reloginErrorFor, setReloginErrorFor] = useState<string | null>(null);

  // Account Sync State for each account individually
  const [accountSyncs, setAccountSyncs] = useState<Record<string, {
    status: 'idle' | 'syncing' | 'paused' | 'waiting' | 'interrupted' | 'completed' | 'failed';
    currentCourse: string;
    currentActivity: string;
    processedCount: number;
    totalCount: number;
    logs?: {
      timestamp: string;
      type: 'info' | 'success' | 'warn' | 'error' | 'performance';
      message: string;
      durationMs?: number;
    }[];
  }>>(() => {
    try {
      const cached = localStorage.getItem('unemi_account_sync_states');
      if (!cached) return {};
      const parsed = JSON.parse(cached) as Record<string, any>;
      // Only restore informative terminal states. Transient states ('syncing',
      // 'waiting', 'paused', 'interrupted') come from an interrupted session and
      // must not survive a reload, otherwise an account stuck at 'waiting' is
      // never queued again (syncQueue resets) and blocks the whole app forever.
      const restored: Record<string, any> = {};
      for (const [key, value] of Object.entries(parsed)) {
        const status = value?.status;
        if (status === 'completed' || status === 'failed') {
          restored[key] = value;
          continue;
        }
        restored[key] = {
          status: 'idle',
          currentCourse: '',
          currentActivity: '',
          processedCount: 0,
          totalCount: 0,
          logs: value?.logs || []
        };
      }
      return restored;
    } catch {
      return {};
    }
  });

  const getAccountSyncState = (sess: MoodleSession) => {
    const key = `${sess.server}_${sess.username.trim().toLowerCase()}`;
    return accountSyncs[key] || {
      status: 'idle',
      currentCourse: '',
      currentActivity: '',
      processedCount: 0,
      totalCount: 0,
      logs: []
    };
  };

  const updateAccountSyncState = (sess: MoodleSession, newState: Partial<{
    status: 'idle' | 'syncing' | 'paused' | 'waiting' | 'interrupted' | 'completed' | 'failed';
    currentCourse: string;
    currentActivity: string;
    processedCount: number;
    totalCount: number;
    logs?: {
      timestamp: string;
      type: 'info' | 'success' | 'warn' | 'error' | 'performance';
      message: string;
      durationMs?: number;
    }[];
  }>) => {
    const key = `${sess.server}_${sess.username.trim().toLowerCase()}`;
    setAccountSyncs(prev => {
      const updated = {
        ...prev,
        [key]: {
          ...(prev[key] || {
            status: 'idle',
            currentCourse: '',
            currentActivity: '',
            processedCount: 0,
            totalCount: 0,
            logs: []
          }),
          ...newState
        }
      };
      localStorage.setItem('unemi_account_sync_states', JSON.stringify(updated));
      return updated;
    });
  };

  const [lastSyncedTime, setLastSyncedTime] = useState<number | null>(null);
  const [syncQueue, setSyncQueue] = useState<MoodleSession[]>([]);
  
  const [notifications, setNotifications] = useState<MoodleNotification[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [showSyncLogs, setShowSyncLogs] = useState(false);
  const [showLogsAccountKey, setShowLogsAccountKey] = useState<string | null>(null);

  // First week of academic calendar state
  const [firstWeekDate, setFirstWeekDate] = useState<string>(() => {
    try {
      return localStorage.getItem('moodle_first_week_date') || '2026-04-13';
    } catch {
      return '2026-04-13';
    }
  });

  const handleFirstWeekDateChange = (date: string) => {
    setFirstWeekDate(date);
    try {
      localStorage.setItem('moodle_first_week_date', date);
    } catch (e) {
      console.error(e);
    }
  };

  // More options dropdown state & ref for click outside
  const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState(false);
  const moreOptionsRef = useRef<HTMLDivElement>(null);
  const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreOptionsRef.current && !moreOptionsRef.current.contains(event.target as Node)) {
        setIsMoreOptionsOpen(false);
      }
    };
    if (isMoreOptionsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMoreOptionsOpen]);

  const updateLastSyncedTimeAndHistory = (time: number) => {
    setLastSyncedTime(time);
    localStorage.setItem('unemi_last_global_sync_time', String(time));
    localStorage.setItem('unemi_sync_reminder_history', JSON.stringify({
      sent3: false,
      sent7: false,
      lastSyncRef: time
    }));
  };

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
    return Notification.permission === 'granted';
  };

  const triggerNativeNotification = (title: string, body: string, id: string) => {
    const cachedSent = localStorage.getItem('unemi_local_notifs_sent');
    let sentList: string[] = [];
    if (cachedSent) {
      try {
        sentList = JSON.parse(cachedSent);
      } catch {
        sentList = [];
      }
    }

    if (sentList.includes(id)) {
      return;
    }

    sentList.push(id);
    localStorage.setItem('unemi_local_notifs_sent', JSON.stringify(sentList));

    const now = Date.now();
    setNotifications(prev => {
      const isDouble = prev.some(n => n.id === id);
      if (isDouble) return prev;
      const newNotif: MoodleNotification = {
        id,
        moodleUsername: sessions[activeSessionIndex]?.username || 'Sistema',
        moodleServer: sessions[activeSessionIndex]?.server || 'a',
        timestamp: now,
        title,
        message: body,
        type: 'status',
        read: false
      };
      const updated = [newNotif, ...prev];
      localStorage.setItem('unemi_notifications', JSON.stringify(updated));
      return updated;
    });

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon: '/aula-unemi.png'
        });
      } catch (e) {
        console.error('Failed to trigger window Notification:', e);
      }
    }
  };

  const isTodayValue = (isoString: string | null) => {
    if (!isoString) return false;
    try {
      const date = new Date(isoString);
      const today = new Date();
      return date.getFullYear() === today.getFullYear() &&
             date.getMonth() === today.getMonth() &&
             date.getDate() === today.getDate();
    } catch {
      return false;
    }
  };

  const checkAndTriggerOfflineNotifications = () => {
    if (!isDbLoaded) return;
    
    const now = Date.now();
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    const isPending = (t: TodoTask) => {
      if (t.completed) return false;
      if (isStatusSubmittedLocal(t.status)) return false;
      if (isStatusSubmittedLocal(t.estado_entrega)) return false;
      return true;
    };

    tasks.forEach(task => {
      if (!task.closureDate) return;
      const taskDate = new Date(task.closureDate);
      const timeDiff = taskDate.getTime() - now;

      // 1. "Test de ____ vence hoy a las ___" (solo para cuestionarios)
      const isQuiz = task.type === 'CUESTIONARIO' || 
                     /quiz|cuestionario|examen|evalua|lecci/i.test(task.title);
      
      const isToday = isTodayValue(task.closureDate);

      if (isQuiz && isToday && isPending(task) && timeDiff > 0) {
        const timeStr = taskDate.toLocaleTimeString(language === 'en' ? 'en-US' : 'es-EC', { hour: '2-digit', minute: '2-digit', hour12: false });
        const notifId = `local_quiz_today_${task.id}_${task.closureDate}`;
        triggerNativeNotification(
          t('notif.quizDueTodayTitle'),
          t('notif.quizDueTodayBody', { title: task.type === 'CUESTIONARIO' ? task.title : (task.courseName || ''), time: timeStr }),
          notifId
        );
      }

      // 2. 3 hours before: "____ vence hoy y no ha sido entregada aun"
      // strictly for non-quizzes, non-group activities
      const isGroup = task.grupo && task.grupo.trim() !== '' && 
                      !task.grupo.toLowerCase().includes('no tiene');
      
      if (!isQuiz && !isGroup && isToday && isPending(task) && timeDiff > 0 && timeDiff <= 3 * 60 * 60 * 1000) {
        const notifId = `local_warn_3h_${task.id}_${task.closureDate}`;
        triggerNativeNotification(
          t('notif.pendingDueTodayTitle'),
          t('notif.pendingDueTodayBody', { title: task.title }),
          notifId
        );
      }
    });

    // 3. Every Sunday send a weekly summary
    if (today.getDay() === 0) {
      const sundayKey = `sunday_summary_${todayStr}`;
      
      const cachedSent = localStorage.getItem('unemi_local_notifs_sent');
      let sentList: string[] = [];
      if (cachedSent) {
        try { sentList = JSON.parse(cachedSent); } catch { sentList = []; }
      }

      if (!sentList.includes(sundayKey)) {
        const nextWeekStart = new Date();
        nextWeekStart.setDate(nextWeekStart.getDate() + 1); // Monday
        nextWeekStart.setHours(0, 0, 0, 0);

        const nextWeekEnd = new Date(nextWeekStart);
        nextWeekEnd.setDate(nextWeekEnd.getDate() + 6); // next Sunday
        nextWeekEnd.setHours(23, 59, 59, 999);

        let testsCount = 0;
        let tasksCount = 0;

        tasks.forEach(task => {
          if (!task.closureDate || !isPending(task)) return;
          const taskDate = new Date(task.closureDate);
          if (taskDate >= nextWeekStart && taskDate <= nextWeekEnd) {
            const isQuiz = task.type === 'CUESTIONARIO' || 
                           /quiz|cuestionario|examen|evalua|lecci/i.test(task.title);
            if (isQuiz) {
              testsCount++;
            } else {
              tasksCount++;
            }
          }
        });

        if (testsCount > 0 || tasksCount > 0) {
          triggerNativeNotification(
            t('notif.weeklySummaryTitle'),
            t('notif.weeklySummaryBody', { tasks: tasksCount, tests: testsCount }),
            sundayKey
          );
        }
      }
    }

    // 4. "Sincroniza tus actividades: No has sincronizado tus actividades desde hace [int] dias"
    if (lastSyncedTime) {
      let tracker = { sent3: false, sent7: false, lastSyncRef: lastSyncedTime };
      const cachedTracker = localStorage.getItem('unemi_sync_reminder_history');
      if (cachedTracker) {
        try {
          tracker = JSON.parse(cachedTracker);
        } catch {
          tracker = { sent3: false, sent7: false, lastSyncRef: lastSyncedTime };
        }
      }
      
      if (tracker.lastSyncRef !== lastSyncedTime) {
        tracker.lastSyncRef = lastSyncedTime;
        tracker.sent3 = false;
        tracker.sent7 = false;
        localStorage.setItem('unemi_sync_reminder_history', JSON.stringify(tracker));
      }

      const daysDiff = (now - lastSyncedTime) / (1000 * 60 * 60 * 24);
      
      if (daysDiff >= 3 && daysDiff < 7 && !tracker.sent3) {
        tracker.sent3 = true;
        localStorage.setItem('unemi_sync_reminder_history', JSON.stringify(tracker));
        triggerNativeNotification(
          t('notif.syncReminderTitle'),
          t('notif.syncReminderBody', { days: 3 }),
          `sync_reminder_3d_${lastSyncedTime}`
        );
      } else if (daysDiff >= 7 && !tracker.sent7) {
        tracker.sent7 = true;
        localStorage.setItem('unemi_sync_reminder_history', JSON.stringify(tracker));
        triggerNativeNotification(
          t('notif.syncReminderTitle'),
          t('notif.syncReminderBody', { days: 7 }),
          `sync_reminder_7d_${lastSyncedTime}`
        );
      }
    }
  };

  const getRelativeNotifTime = (timestamp: number) => {
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return t('time.justNow');
    if (diffMins < 60) return t('time.minutesAgo', { min: diffMins });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t('time.hoursAgo', { hrs: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    return t('time.daysAgo', { days: diffDays });
  };

  const markNotificationRead = (notifId: string) => {
    setNotifications(prev => {
      const updated = prev.map(n => n.id === notifId ? { ...n, read: true } : n);
      localStorage.setItem('unemi_notifications', JSON.stringify(updated));
      return updated;
    });
  };

  const notifPanelRef = useRef<HTMLDivElement>(null);
  const notifBtnRef = useRef<HTMLButtonElement>(null);

  // Snapshot of the task list captured right before each sync starts. The
  // progressive merge during a 'syncing' poll overwrites closureDate/grade/status
  // in state, which previously masked all change notifications at 'completed'.
  const syncBaselineRef = useRef<Record<string, TodoTask[]>>({});

  const markAllNotificationsRead = useCallback(() => {
    setNotifications(prev => {
      const updated = prev.map(n => ({ ...n, read: true }));
      localStorage.setItem('unemi_notifications', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const closeNotifications = useCallback(() => {
    setIsNotifOpen(false);
    // Mark seen notifications as read when closing.
    // When opened next time: if no new notifications arrived, they will be blurred.
    // If new notifications arrived, only new ones will be unblurred.
    setNotifications(prev => {
      const updated = prev.map(n => ({ ...n, read: true }));
      localStorage.setItem('unemi_notifications', JSON.stringify(updated));
      return updated;
    });
  }, []);

  useEffect(() => {
    if (!isNotifOpen) return;
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (
        notifPanelRef.current &&
        !notifPanelRef.current.contains(target) &&
        notifBtnRef.current &&
        !notifBtnRef.current.contains(target)
      ) {
        closeNotifications();
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('touchstart', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('touchstart', handleClickOutside, true);
    };
  }, [isNotifOpen, closeNotifications]);

  const clearAllNotifications = () => {
    if (window.confirm('¿Seguro que deseas limpiar todas las notificaciones?')) {
      setNotifications([]);
      localStorage.setItem('unemi_notifications', JSON.stringify([]));
    }
  };

  const detectAndGenerateNotifications = (
    currentTasksList: TodoTask[],
    incomingTasksList: TodoTask[]
  ) => {
    const newNotifications: MoodleNotification[] = [];
    const now = Date.now();

    // Only generate change/discovery notifications if there is already some data.
    const isFirstTimeSync = currentTasksList.length === 0;

    if (isFirstTimeSync) {
      const accounts = Array.from(new Set(incomingTasksList.map(t => `${t.moodleServer === 'a' ? 'Aula A' : 'Aula B'}: ${t.moodleUsername}`)));
      if (accounts.length > 0) {
        newNotifications.push({
          id: `first_sync_${now}`,
          moodleUsername: incomingTasksList[0].moodleUsername || '',
          moodleServer: incomingTasksList[0].moodleServer || 'a',
          timestamp: now,
          title: '🎉 Primera Sincronización',
          message: `¡Se sincronizaron con éxito ${incomingTasksList.length} actividades de las cuentas: ${accounts.join(', ')}!`,
          type: 'general',
          read: false
        });
      }
    } else {
      incomingTasksList.forEach(incomingTask => {
        const existingTask = currentTasksList.find(t => t.activityUrl === incomingTask.activityUrl);

        if (!existingTask) {
          const formatClosureDate = (isoStr?: string | null) => {
            if (!isoStr) return 'Sin fecha de cierre';
            try {
              const d = new Date(isoStr);
              if (isNaN(d.getTime())) return 'Sin fecha de cierre';
              return d.toLocaleString(language === 'en' ? 'en-US' : 'es-EC', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            } catch {
              return t('time.noDeadline');
            }
          };

          const formattedClosureDate = formatClosureDate(incomingTask.closureDate);

          newNotifications.push({
            id: `new_task_${incomingTask.id || now}_${Math.random().toString(36).substr(2, 5)}`,
            moodleUsername: incomingTask.moodleUsername || '',
            moodleServer: incomingTask.moodleServer || 'a',
            timestamp: now,
            title: t('notif.newActivityTitle'),
            message: t('notif.newActivityBody', { course: incomingTask.courseName || 'Moodle', date: formattedClosureDate }),
            type: 'new',
            read: false,
            activityUrl: incomingTask.activityUrl,
            courseName: incomingTask.courseName
          });
        } else {
          const prevClosure = existingTask.closureDate || null;
          const nextClosure = incomingTask.closureDate || null;
          if (prevClosure !== nextClosure) {
            const formatShortDate = (isoStr?: string | null) => {
              if (!isoStr) return t('time.noDeadline');
              try {
                const date = new Date(isoStr);
                if (isNaN(date.getTime())) return t('time.noDeadline');
                return date.toLocaleString(language === 'en' ? 'en-US' : 'es-EC', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
              } catch {
                return isoStr;
              }
            };

            // Classify the change:
            // - no date -> date: the teacher set a deadline
            // - date -> no date: the teacher removed the deadline
            // - past -> future: reopened; a later date: extended; an earlier date: shortened
            let deadlineKind: 'reopened' | 'extended' | 'shortened' | 'set' | 'removed';
            if (!prevClosure && nextClosure) {
              deadlineKind = 'set';
            } else if (prevClosure && !nextClosure) {
              deadlineKind = 'removed';
            } else {
              const oldTime = new Date(prevClosure as string).getTime();
              const newTime = new Date(nextClosure as string).getTime();
              deadlineKind = 'shortened';
              if (!isNaN(oldTime) && !isNaN(newTime)) {
                if (oldTime <= now && newTime > now) {
                  deadlineKind = 'reopened';
                } else if (newTime > oldTime) {
                  deadlineKind = 'extended';
                }
              }
            }

            const deadlineKeyByKind = {
              reopened: { title: 'notif.deadlineReopenedTitle', body: 'notif.deadlineReopenedBody' },
              extended: { title: 'notif.deadlineExtendedTitle', body: 'notif.deadlineExtendedBody' },
              shortened: { title: 'notif.deadlineShortenedTitle', body: 'notif.deadlineShortenedBody' },
              set: { title: 'notif.deadlineSetTitle', body: 'notif.deadlineSetBody' },
              removed: { title: 'notif.deadlineRemovedTitle', body: 'notif.deadlineRemovedBody' }
            }[deadlineKind];

            newNotifications.push({
              id: `deadline_change_${incomingTask.id || now}_${Math.random().toString(36).substr(2, 5)}`,
              moodleUsername: incomingTask.moodleUsername || '',
              moodleServer: incomingTask.moodleServer || 'a',
              timestamp: now,
              title: t(deadlineKeyByKind.title),
              message: t(deadlineKeyByKind.body, { title: existingTask.title, oldDate: formatShortDate(prevClosure), newDate: formatShortDate(nextClosure) }),
              type: 'deadline',
              read: false,
              activityUrl: incomingTask.activityUrl,
              courseName: existingTask.courseName
            });
          }

          const isGraded = (task: TodoTask) =>
            task.status?.toLowerCase().includes('calificado') ||
            task.gradingStatus?.toLowerCase().includes('calificado') ||
            task.estado_calificacion?.toLowerCase().includes('calificado') ||
            task.grade !== null && task.grade !== undefined && task.grade !== '';
          const newlyGraded = isGraded(incomingTask) && !isGraded(existingTask);
          const gradeChanged = incomingTask.grade !== null && incomingTask.grade !== undefined && incomingTask.grade !== '' && incomingTask.grade !== existingTask.grade;

          if (newlyGraded || gradeChanged) {
            newNotifications.push({
              id: `grade_${incomingTask.id || now}_${Math.random().toString(36).substr(2, 5)}`,
              moodleUsername: incomingTask.moodleUsername || '',
              moodleServer: incomingTask.moodleServer || 'a',
              timestamp: now,
              title: t('notif.newGradeTitle'),
              message: incomingTask.grade !== null && incomingTask.grade !== undefined && incomingTask.grade !== ''
                ? t('notif.newGradeBody', { title: existingTask.title, grade: incomingTask.grade, gradeOver: incomingTask.gradeOver || '10' })
                : t('notif.statusUpdatedBody', { title: existingTask.title, oldStatus: existingTask.status || t('sync.legend.ungraded'), newStatus: incomingTask.status || t('csv.graded') }),
              type: 'grade',
              read: false,
              activityUrl: incomingTask.activityUrl,
              courseName: existingTask.courseName
            });
          }

          if (!newlyGraded && incomingTask.status && existingTask.status && incomingTask.status !== existingTask.status) {
            newNotifications.push({
              id: `status_${incomingTask.id || now}_${Math.random().toString(36).substr(2, 5)}`,
              moodleUsername: incomingTask.moodleUsername || '',
              moodleServer: incomingTask.moodleServer || 'a',
              timestamp: now,
              title: t('notif.statusUpdatedTitle'),
              message: t('notif.statusUpdatedBody', { title: existingTask.title, oldStatus: existingTask.status, newStatus: incomingTask.status }),
              type: 'status',
              read: false,
              activityUrl: incomingTask.activityUrl,
              courseName: existingTask.courseName
            });
          }
        }
      });
    }

    if (newNotifications.length > 0) {
      setNotifications(prev => {
        const merged = [...newNotifications, ...prev];
        localStorage.setItem('unemi_notifications', JSON.stringify(merged));
        return merged;
      });
    }
  };

  // Notify about activities that vanished from Moodle (hidden/deleted/replaced
  // by the teacher) and were reconciled out of the agenda.
  const notifyDisappearedActivities = (removedTasks: TodoTask[]) => {
    if (removedTasks.length === 0) return;
    const now = Date.now();
    const newNotifications: MoodleNotification[] = removedTasks.map(task => ({
      id: `activity_removed_${now}_${Math.random().toString(36).substr(2, 5)}`,
      moodleUsername: task.moodleUsername || '',
      moodleServer: task.moodleServer || 'a',
      timestamp: now,
      title: t('notif.activityRemovedTitle'),
      message: t('notif.activityRemovedBody', {
        title: task.title,
        course: task.courseName || 'Moodle'
      }),
      type: 'removed',
      read: false,
      activityUrl: task.activityUrl,
      courseName: task.courseName
    }));

    setNotifications(prev => {
      const merged = [...newNotifications, ...prev];
      localStorage.setItem('unemi_notifications', JSON.stringify(merged));
      return merged;
    });
  };

  const session = sessions[activeSessionIndex] || null;

  // 1. Initial Load from LocalStorage and Firestore Cache
  useEffect(() => {
    try {
      sessionStorage.removeItem('unemi_collapsed_weeks');
    } catch (e) {
      console.error(e);
    }
    try {
      const cachedSessions = localStorage.getItem('unemi_sessions');
      let loadedSessions: MoodleSession[] = [];
      if (cachedSessions) {
        loadedSessions = JSON.parse(cachedSessions);
      } else {
        const cachedSession = localStorage.getItem('unemi_session');
        if (cachedSession) {
          loadedSessions = [JSON.parse(cachedSession)];
          localStorage.setItem('unemi_sessions', JSON.stringify(loadedSessions));
        }
      }
      setSessions(loadedSessions);

      const cachedTasks = localStorage.getItem('unemi_tasks');
      let localTasks: TodoTask[] = [];
      if (cachedTasks) {
        localTasks = JSON.parse(cachedTasks);

        // GMT-5 Timezone Migration for legacy tasks to fix a +5 hours difference
        const hasMigrated = localStorage.getItem('unemi_tz_migrated_v3');
        if (!hasMigrated) {
          localTasks = localTasks.map(task => {
            const updated = { ...task };
            if (task.closureDate && task.closureDate.endsWith('Z')) {
              const d = new Date(task.closureDate);
              d.setMinutes(d.getMinutes() + 300);
              updated.closureDate = d.toISOString();
            }
            if (task.apertureDateISO && task.apertureDateISO.endsWith('Z')) {
              const d = new Date(task.apertureDateISO);
              d.setMinutes(d.getMinutes() + 300);
              updated.apertureDateISO = d.toISOString();
            }
            return updated;
          });
          localStorage.setItem('unemi_tz_migrated_v3', 'true');
        }

        // Defensive: clear false activities
        localTasks = localTasks.filter(t => t.id !== 'welcome-1' && t.id !== 'welcome-2');
      }

      // Load last sync timestamp
      const cachedLastSync = localStorage.getItem('unemi_last_global_sync_time');
      let localSyncedTime = cachedLastSync ? Number(cachedLastSync) : null;
      if (localSyncedTime) {
        setLastSyncedTime(localSyncedTime);
      }

      // Load synced accounts count
      const cachedCount = localStorage.getItem('unemi_synced_accounts_count');
      if (cachedCount) {
        setSyncedAccountsCount(Number(cachedCount));
      }

      // Load notifications cache
      const cachedNotifications = localStorage.getItem('unemi_notifications');
      let localNotifications: MoodleNotification[] = [];
      if (cachedNotifications) {
        try {
          localNotifications = JSON.parse(cachedNotifications);
        } catch (e) {
          console.error('Error parsing local notifications:', e);
        }
      }
      setNotifications(localNotifications);



      // Load user caches from Firestore
      const loadAllFirestoreCaches = async () => {
        if (loadedSessions.length === 0) {
          setTasks(localTasks);
          localStorage.setItem('unemi_tasks', JSON.stringify(localTasks));
          setNotifications(localNotifications);
          localStorage.setItem('unemi_notifications', JSON.stringify(localNotifications));
          setIsDbLoaded(true);
          return;
        }

        try {
          let mergedTasks = [...localTasks];
          let mergedNotifications = [...localNotifications];
          let maxSyncTime = localSyncedTime;
          let syncedFirstWeekDate: string | null = null;

          for (const s of loadedSessions) {
            try {
              const firestoreCache = await fetchUserCacheFromFirestore(s.server, s.username);
              if (firestoreCache) {
                if (firestoreCache.firstWeekDate) {
                  syncedFirstWeekDate = firestoreCache.firstWeekDate;
                }
                if (firestoreCache.tasks && firestoreCache.tasks.length > 0) {
                  mergedTasks = mergeTasksLists(mergedTasks, firestoreCache.tasks);
                }
                if (firestoreCache.notifications && firestoreCache.notifications.length > 0) {
                  firestoreCache.notifications.forEach(fn => {
                    if (!mergedNotifications.some(mn => mn.id === fn.id)) {
                      mergedNotifications.push(fn);
                    } else {
                      const existingIdx = mergedNotifications.findIndex(mn => mn.id === fn.id);
                      if (existingIdx !== -1) {
                        mergedNotifications[existingIdx] = {
                          ...fn,
                          read: mergedNotifications[existingIdx].read || fn.read
                        };
                      }
                    }
                  });
                }
                if (firestoreCache.lastSyncedTime && (!maxSyncTime || firestoreCache.lastSyncedTime > maxSyncTime)) {
                  maxSyncTime = firestoreCache.lastSyncedTime;
                }
              }
            } catch (err) {
              console.error(`Error loading Firestore cache for ${s.username}:`, err);
            }
          }

          setTasks(mergedTasks);
          localStorage.setItem('unemi_tasks', JSON.stringify(mergedTasks));
          setNotifications(mergedNotifications);
          localStorage.setItem('unemi_notifications', JSON.stringify(mergedNotifications));
          if (syncedFirstWeekDate) {
            setFirstWeekDate(syncedFirstWeekDate);
            localStorage.setItem('moodle_first_week_date', syncedFirstWeekDate);
          }
          if (maxSyncTime) {
            setLastSyncedTime(maxSyncTime);
            localStorage.setItem('unemi_last_global_sync_time', String(maxSyncTime));
          }
        } catch (err) {
          console.error("General error loading Firestore caches on startup:", err);
          setTasks(localTasks);
          setNotifications(localNotifications);
        } finally {
          setIsDbLoaded(true);
        }
      };

      loadAllFirestoreCaches();

    } catch (err) {
      console.error('Error loading localStorage keys:', err);
      setIsDbLoaded(true);
    }
  }, []);

  // 1b. Auto-save user cache to Firestore whenever state changes (debounced by 10 seconds)
  useEffect(() => {
    if (!isDbLoaded) return;
    const timer = setTimeout(() => {
      sessions.forEach(s => {
        saveUserCacheToFirestore(s.server, s.username, tasks, lastSyncedTime, notifications, firstWeekDate)
          .catch(err => console.error(`Error auto-saving cache to Firestore for ${s.username}:`, err));
      });
    }, 10000); // 10s debounce to avoid exhausting Firestore write streams during high-frequency syncs
    return () => clearTimeout(timer);
  }, [tasks, lastSyncedTime, sessions, isDbLoaded, notifications, firstWeekDate]);

  // Fetch the live Moodle subject list for every connected account so the app
  // can tell which subjects belong to the current academic period (instead of
  // inferring it from activity dates).
  useEffect(() => {
    if (sessions.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.allSettled(
        sessions.map(async (sess) => {
          const apiBase = import.meta.env.VITE_API_URL || '';
          const res = await fetch(`${apiBase}/api/moodle/courses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ moodleSession: sess.cookies, server: sess.server })
          });
          const data = await res.json();
          if (!res.ok || !data.courses) {
            throw new Error(data.error || 'Fetch courses failed');
          }
          return {
            key: `${sess.server}|${sess.username.toLowerCase()}`,
            ids: new Set<string>(data.courses.map((c: { id: string }) => String(c.id)))
          };
        })
      );
      if (cancelled) return;
      const map: Record<string, Set<string>> = {};
      results.forEach(r => {
        if (r.status === 'fulfilled') map[r.value.key] = r.value.ids;
      });
      setLiveCoursesByAccount(map);
    })();
    return () => { cancelled = true; };
  }, [sessions]);

  // Fetch courses cache sequentially once connected
  useEffect(() => {
    if (session) {
      fetchCoursesCache();
    }
  }, [session]);

  const fetchCoursesCache = async () => {
    if (!session) return;
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/moodle/courses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moodleSession: session.cookies,
          server: session.server
        })
      });
      const data = await res.json();
      if (res.ok && data.courses) {
        setCourses(data.courses);
      } else {
        const errMsg = data.error || 'La sesión de Moodle ha expirado o es inválida.';
        handleSessionError(session, errMsg, false);
      }
    } catch (err: any) {
      console.error('Error fetching courses cache list:', err);
      handleSessionError(session, err?.message || 'Error de conexión.', false);
    }
  };

  // Trigger verification of all sessions whenever entering the "Mis conexiones" tab (activeTab === 'login')
  useEffect(() => {
    if (activeTab === 'login') {
      verifyAllSessions();
    }
  }, [activeTab]);

  const verifyAllSessions = async () => {
    if (sessions.length === 0 || isVerifyingSessions) return;
    setIsVerifyingSessions(true);
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const updatedSessions = await Promise.all(
        sessions.map(async (sess) => {
          try {
            const res = await fetch(`${apiBase}/api/moodle/courses`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                moodleSession: sess.cookies,
                server: sess.server
              })
            });
            if (res.ok) {
              return { ...sess, expired: false };
            } else {
              return { ...sess, expired: true };
            }
          } catch (err) {
            console.error(`Error verifying session for ${sess.username}:`, err);
            return { ...sess, expired: true };
          }
        })
      );

      setSessions(updatedSessions);
      localStorage.setItem('unemi_sessions', JSON.stringify(updatedSessions));
    } catch (err) {
      console.error('Error verifying all sessions:', err);
    } finally {
      setIsVerifyingSessions(false);
    }
  };

  // 2. State Actions handlers
  const handleLoginSuccess = async (newSession: MoodleSession) => {
    // 1. Async fetch and merge this user's cache from Firestore immediately on login BEFORE state updates
    let fetchedTasks: TodoTask[] = [];
    let fetchedNotifications: MoodleNotification[] = [];
    let fetchedSyncedTime: number | null = null;

    try {
      const firestoreCache = await fetchUserCacheFromFirestore(newSession.server, newSession.username);
      if (firestoreCache) {
        if (firestoreCache.tasks && firestoreCache.tasks.length > 0) {
          fetchedTasks = firestoreCache.tasks;
        }
        if (firestoreCache.notifications && firestoreCache.notifications.length > 0) {
          fetchedNotifications = firestoreCache.notifications;
        }
        if (firestoreCache.lastSyncedTime) {
          fetchedSyncedTime = firestoreCache.lastSyncedTime;
        }
      }
    } catch (err) {
      console.error(`Error loading database cache for ${newSession.username} on login:`, err);
    }

    const existsIdx = sessions.findIndex(
      s => s.username.toLowerCase() === newSession.username.toLowerCase() && s.server === newSession.server
    );
    let updatedSessions = [...sessions];
    const sessionWithCleanStatus = { ...newSession, expired: false };
    if (existsIdx !== -1) {
      updatedSessions[existsIdx] = sessionWithCleanStatus;
    } else {
      updatedSessions.push(sessionWithCleanStatus);
    }
    setSessions(updatedSessions);
    localStorage.setItem('unemi_sessions', JSON.stringify(updatedSessions));
    
    const idx = updatedSessions.findIndex(
      s => s.username.toLowerCase() === newSession.username.toLowerCase() && s.server === newSession.server
    );
    setActiveSessionIndex(idx !== -1 ? idx : updatedSessions.length - 1);
    
    // Switch tab to login to stay on "Mis conexiones" tab (no auto-redirect to browser)
    setActiveTab('login');
    setPrefillLogin(null); // Clear any active reconnect/prefill error values

    // 2. Merge and set fetched tasks
    if (fetchedTasks.length > 0) {
      setTasks(prevTasks => {
        const merged = mergeTasksLists(prevTasks, fetchedTasks);
        localStorage.setItem('unemi_tasks', JSON.stringify(merged));
        return merged;
      });
    }

    // 3. Merge and set fetched notifications
    if (fetchedNotifications.length > 0) {
      setNotifications(prevNotifs => {
        const merged = [...prevNotifs];
        fetchedNotifications.forEach(fn => {
          if (!merged.some(mn => mn.id === fn.id)) {
            merged.push(fn);
          } else {
            const existingIdx = merged.findIndex(mn => mn.id === fn.id);
            if (existingIdx !== -1) {
              merged[existingIdx] = {
                ...fn,
                read: merged[existingIdx].read || fn.read
              };
            }
          }
        });
        localStorage.setItem('unemi_notifications', JSON.stringify(merged));
        return merged;
      });
    }

    // 4. Update last synced time
    if (fetchedSyncedTime && (!lastSyncedTime || fetchedSyncedTime > lastSyncedTime)) {
      setLastSyncedTime(fetchedSyncedTime);
      localStorage.setItem('unemi_last_global_sync_time', String(fetchedSyncedTime));
    }

    // Automatically trigger background global sync on login / reconnect
    startGlobalSync(updatedSessions);
  };

  // Inline re-login for expired accounts (password field inside "More options")
  const handleRelogin = async (sess: MoodleSession) => {
    const acctKey = `${sess.server}_${sess.username.trim().toLowerCase()}`;
    if (!reloginPassword) {
      setReloginErrorFor(t('login.enterCredentials'));
      return;
    }

    setReloginLoadingFor(acctKey);
    setReloginErrorFor(null);

    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/moodle/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: sess.username, password: reloginPassword, server: sess.server })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        const updated = sessions.map(s =>
          s.username.toLowerCase() === sess.username.toLowerCase() && s.server === sess.server
            ? { ...s, cookies: data.moodleSession, expired: false }
            : s
        );
        setSessions(updated);
        localStorage.setItem('unemi_sessions', JSON.stringify(updated));
        setReloginOpenFor(null);
        setReloginPassword('');
        setReloginErrorFor(null);
        startGlobalSync(updated);
      } else {
        setReloginErrorFor(data.error || t('login.authFailed'));
      }
    } catch (err) {
      console.error(`Error during relogin for ${sess.username}:`, err);
      setReloginErrorFor(t('login.networkError'));
    } finally {
      setReloginLoadingFor(null);
    }
  };

  const handleLogout = () => {
    const updatedSessions = sessions.filter((_, idx) => idx !== activeSessionIndex);
    setSessions(updatedSessions);
    localStorage.setItem('unemi_sessions', JSON.stringify(updatedSessions));
    setCourses([]);
    
    if (updatedSessions.length === 0) {
      setActiveSessionIndex(0);
      setActiveTab('login');
    } else {
      setActiveSessionIndex(Math.max(0, activeSessionIndex - 1));
    }
  };

  const handleSessionError = (failedSession: MoodleSession, rawMsg: string, forceRedirect: boolean = false) => {
    setSessions(prev => {
      const updated = prev.map(s => {
        if (s.username.toLowerCase() === failedSession.username.toLowerCase() && s.server === failedSession.server) {
          return { ...s, expired: true };
        }
        return s;
      });
      localStorage.setItem('unemi_sessions', JSON.stringify(updated));
      return updated;
    });

    let friendlyMsg = 'Sesión de Moodle expirada o cerrada.';
    if (rawMsg.toLowerCase().includes('fetch failed')) {
      friendlyMsg = 'Conexión interrumpida (Fetch failed). Vuelve a conectar la cuenta para re-autenticar.';
    } else if (rawMsg) {
      friendlyMsg = `Conexión interrumpida (${rawMsg}). Vuelve a conectar e iniciar sesión.`;
    }

    setPrefillLogin({
      username: failedSession.username,
      server: failedSession.server,
      errorMsg: friendlyMsg
    });

    if (forceRedirect) {
      setActiveTab('login');
    }
  };

  const onToggleComplete = (id: string) => {
    const updated = tasks.map(task => 
      task.id === id ? { ...task, completed: !task.completed } : task
    );
    setTasks(updated);
    localStorage.setItem('unemi_tasks', JSON.stringify(updated));
  };

  const onDeleteTask = (id: string) => {
    const updated = tasks.filter(task => task.id !== id);
    setTasks(updated);
    localStorage.setItem('unemi_tasks', JSON.stringify(updated));
  };

  const onClearAgenda = () => {
    setTasks([]);
    localStorage.removeItem('unemi_tasks');
  };

  const handleRemoveAccount = (idx: number) => {
    const removed = sessions[idx];
    if (!removed) return;

    const removedKey = `${removed.server}_${removed.username.trim().toLowerCase()}`;
    const removedLiveKey = `${removed.server}|${removed.username.toLowerCase()}`;

    const updatedSessions = sessions.filter((_, sIdx) => sIdx !== idx);
    setSessions(updatedSessions);
    localStorage.setItem('unemi_sessions', JSON.stringify(updatedSessions));

    // Purge the activities/tasks that belong to the removed account.
    const updatedTasks = tasks.filter(t => {
      if (!t.moodleUsername || !t.moodleServer) return true;
      return `${t.moodleServer}_${t.moodleUsername.trim().toLowerCase()}` !== removedKey;
    });
    setTasks(updatedTasks);
    localStorage.setItem('unemi_tasks', JSON.stringify(updatedTasks));

    // Purge notifications generated for the removed account.
    const updatedNotifications = notifications.filter(n => {
      if (!n.moodleUsername || !n.moodleServer) return true;
      return `${n.moodleServer}_${n.moodleUsername.trim().toLowerCase()}` !== removedKey;
    });
    setNotifications(updatedNotifications);
    localStorage.setItem('unemi_notifications', JSON.stringify(updatedNotifications));

    // Purge the per-account sync state and any queued/in-flight sync.
    setAccountSyncs(prev => {
      if (!(removedKey in prev)) return prev;
      const next = { ...prev };
      delete next[removedKey];
      localStorage.setItem('unemi_account_sync_states', JSON.stringify(next));
      return next;
    });
    setSyncQueue(prev => prev.filter(s => `${s.server}_${s.username.trim().toLowerCase()}` !== removedKey));

    // Purge the live course list cached for the removed account.
    setLiveCoursesByAccount(prev => {
      if (!(removedLiveKey in prev)) return prev;
      const next = { ...prev };
      delete next[removedLiveKey];
      return next;
    });

    if (activeSessionIndex >= updatedSessions.length) {
      setActiveSessionIndex(Math.max(0, updatedSessions.length - 1));
    } else if (activeSessionIndex > idx) {
      setActiveSessionIndex(activeSessionIndex - 1);
    }

    if (updatedSessions.length === 0) {
      setActiveSessionIndex(0);
      setActiveTab('login');
    }
  };

  const [timeTick, setTimeTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeTick(t => t + 1);
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const getRelativeLastSyncedTime = () => {
    if (!lastSyncedTime) return '';
    try {
      const diffMs = Date.now() - lastSyncedTime;
      if (diffMs < 0) return 'hace un momento';
      const seconds = Math.floor(diffMs / 1000);
      if (seconds < 60) return 'hace un momento';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `hace ${minutes}m`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `hace ${hours}h`;
      const days = Math.floor(hours / 24);
      return `hace ${days}d`;
    } catch {
      return '';
    }
  };

  const handleSaveManualTask = (newTask: TodoTask) => {
    const updatedTask = { ...newTask };
    if (session) {
      updatedTask.moodleUsername = session.username;
      updatedTask.moodleServer = session.server;
    }
    const updated = [updatedTask, ...tasks];
    setTasks(updated);
    localStorage.setItem('unemi_tasks', JSON.stringify(updated));
  };

  // Poll background sync helper
  const pollBackgroundSync = async (key: string) => {
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/moodle/sync/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      });

      if (!res.ok) {
        throw new Error('STATUS CODE ' + res.status);
      }

      const data = await res.json();
      const matchSess = sessions.find(s => `${s.server}_${s.username.trim().toLowerCase()}` === key);

      if (!data.job) {
        delete syncBaselineRef.current[key];
        if (matchSess) {
          updateAccountSyncState(matchSess, { status: 'idle' });
        }
        return false;
      }

      const job = data.job;

      // Check if server sync is still running
      if (job.status === 'syncing') {
        const nextState = {
          status: 'syncing' as const,
          currentCourse: job.currentCourse || 'Escaneando...',
          currentActivity: job.currentActivity || 'Buscando actividades...',
          processedCount: job.processedCount,
          totalCount: job.totalCount,
          logs: job.logs || []
        };

        if (matchSess) {
          updateAccountSyncState(matchSess, nextState);
        }

        if (job.validSessionCount !== undefined) {
          setSyncedAccountsCount(job.validSessionCount);
          localStorage.setItem('unemi_synced_accounts_count', String(job.validSessionCount));
        }

        // Merge task updates retrieved so far
        if (job.tasks && job.tasks.length > 0) {
          setTasks(prevTasks => {
            const merged = [...prevTasks];
            job.tasks.forEach((srvTask: any) => {
              const matchIdx = merged.findIndex(t => t.activityUrl === srvTask.activityUrl);
              if (matchIdx !== -1) {
                // Update existing task
                merged[matchIdx] = {
                  ...merged[matchIdx],
                  ...srvTask,
                  id: merged[matchIdx].id // preserve local ID
                };
              } else {
                merged.push(srvTask);
              }
            });
            localStorage.setItem('unemi_tasks', JSON.stringify(merged));
            return merged;
          });
        }
        return true;
      } else if (job.status === 'completed') {
        const finishedTime = Date.now();
        updateLastSyncedTimeAndHistory(finishedTime);

        if (job.validSessionCount !== undefined) {
          setSyncedAccountsCount(job.validSessionCount);
          localStorage.setItem('unemi_synced_accounts_count', String(job.validSessionCount));
        } else {
          setSyncedAccountsCount(sessions.length);
          localStorage.setItem('unemi_synced_accounts_count', String(sessions.length));
        }

        const nextState = {
          status: 'completed' as const,
          currentCourse: '',
          currentActivity: '',
          processedCount: job.totalCount,
          totalCount: job.totalCount,
          logs: job.logs || []
        };

        if (matchSess) {
          updateAccountSyncState(matchSess, nextState);
        }

        // Compare incoming tasks against the pre-sync snapshot (falling back to
        // current state if none was captured) so deadline/grade/status changes
        // are not masked by the progressive merge done while 'syncing'.
        const syncBaseline = syncBaselineRef.current[key];
        delete syncBaselineRef.current[key];

        // Process a final merge of all tasks
        if (job.tasks && job.tasks.length > 0) {
          setTasks(prevTasks => {
            detectAndGenerateNotifications(syncBaseline ?? prevTasks, job.tasks);

            // Drop tasks that vanished from Moodle (hidden/removed/replaced by
            // a teacher) for accounts that were successfully synced this run.
            const { reconciled, removed } = reconcileTasksWithFreshSync(prevTasks, job.tasks);
            if (removed.length > 0) {
              notifyDisappearedActivities(removed);
            }

            const merged = [...reconciled];
            job.tasks.forEach((srvTask: any) => {
              const matchIdx = merged.findIndex(t => t.activityUrl === srvTask.activityUrl);
              if (matchIdx !== -1) {
                merged[matchIdx] = {
                  ...merged[matchIdx],
                  ...srvTask,
                  id: merged[matchIdx].id
                };
              } else {
                merged.push(srvTask);
              }
            });
            localStorage.setItem('unemi_tasks', JSON.stringify(merged));
            return merged;
          });
        }
        const currentActiveSyncKey = localStorage.getItem('unemi_sync_key');
        if (currentActiveSyncKey === key) {
          localStorage.removeItem('unemi_sync_key');
        }
        return false;
      } else if (job.status === 'failed') {
        delete syncBaselineRef.current[key];
        const errMsg = job.error || '';
        if (errMsg.includes('No hay sesiones abiertas actualmente') || (job.expiredSessions && job.expiredSessions.length > 0)) {
          const expiredList = job.expiredSessions || [];
          setSessions(prev => {
            const updated = prev.map(s => {
              const isMatch = expiredList.length > 0
                ? expiredList.some((e: any) => e.username.toLowerCase() === s.username.toLowerCase() && e.server === s.server)
                : true;
              return isMatch ? { ...s, expired: true } : s;
            });
            localStorage.setItem('unemi_sessions', JSON.stringify(updated));
            return updated;
          });
          const currentActiveSyncKey = localStorage.getItem('unemi_sync_key');
          if (currentActiveSyncKey === key) {
            localStorage.removeItem('unemi_sync_key');
          }
          
          const firstExpired = expiredList.length > 0
            ? sessions.find(s => expiredList.some((e: any) => e.username.toLowerCase() === s.username.toLowerCase() && e.server === s.server))
            : sessions[0];

          setPrefillLogin({
            username: firstExpired?.username || sessions[0]?.username || '',
            server: firstExpired?.server || sessions[0]?.server || 'a',
            errorMsg: 'Las cuentas o sesiones conectadas han expirado o se cerraron. Por favor ingresa tus datos de acceso en "Conectar Moodle" para continuar.'
          });
          
          const nextState = {
            status: 'failed' as const,
            currentCourse: 'Sesiones expiradas',
            currentActivity: errMsg,
            processedCount: job.processedCount,
            totalCount: job.totalCount,
            logs: job.logs || []
          };

          if (matchSess) {
            updateAccountSyncState(matchSess, nextState);
          }
          return false;
        }

        const nextState = {
          status: 'failed' as const,
          currentCourse: 'Sincronización interrumpida',
          currentActivity: job.error || 'Ocurrió un error en la conexión',
          processedCount: job.processedCount,
          totalCount: job.totalCount,
          logs: job.logs || []
        };

        if (matchSess) {
          updateAccountSyncState(matchSess, nextState);
        }
        const currentActiveSyncKey = localStorage.getItem('unemi_sync_key');
        if (currentActiveSyncKey === key) {
          localStorage.removeItem('unemi_sync_key');
        }
        return false;
      } else {
        delete syncBaselineRef.current[key];
        if (matchSess) {
          updateAccountSyncState(matchSess, { status: 'idle' });
        }
        const currentActiveSyncKey = localStorage.getItem('unemi_sync_key');
        if (currentActiveSyncKey === key) {
          localStorage.removeItem('unemi_sync_key');
        }
        return false;
      }
    } catch (err) {
      console.error('Error polling background sync:', err);
      // Let next poll turn retry
      return true;
    }
  };

  // Poll loop mechanism
  const syncingAccountKey = Object.keys(accountSyncs).find(k => accountSyncs[k]?.status === 'syncing') || null;

  useEffect(() => {
    let active = true;
    let timer: any = null;

    if (!syncingAccountKey) return;

    const tick = async () => {
      const shouldContinue = await pollBackgroundSync(syncingAccountKey);
      if (active && shouldContinue) {
        timer = setTimeout(tick, 2000);
      }
    };

    tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [syncingAccountKey, sessions]);

  // Trigger server-side background sync
  const startGlobalSync = async (sessionsToSync?: MoodleSession[]) => {
    const list = sessionsToSync || sessions;
    if (list.length === 0) {
      alert(t('app.syncConnectAtLeastOne'));
      return;
    }

    if (list.length > 1) {
      // Add all of them to the sync queue if they aren't already queued or syncing
      setSyncQueue(prev => {
        const updated = [...prev];
        list.forEach(s => {
          const isAlreadyQueued = updated.some(q => q.username.toLowerCase() === s.username.toLowerCase() && q.server === s.server);
          const sKey = `${s.server}_${s.username.trim().toLowerCase()}`;
          const currentStatus = accountSyncs[sKey]?.status;
          const isAlreadySyncing = currentStatus === 'syncing';
          
          if (!isAlreadyQueued && !isAlreadySyncing) {
            updated.push(s);
            // Mark its status as 'waiting' immediately!
            updateAccountSyncState(s, {
              status: 'waiting',
              currentCourse: 'Esperando turno...',
              currentActivity: 'En cola para sincronización...',
              processedCount: 0,
              totalCount: 0,
              logs: []
            });
          }
        });
        return updated;
      });
      return;
    }

    // If it's a single session
    const singleSession = list[0];
    const sKey = `${singleSession.server}_${singleSession.username.trim().toLowerCase()}`;

    // Check if another account is currently syncing
    const isAnySyncing = Object.keys(accountSyncs).some(k => accountSyncs[k]?.status === 'syncing');
    if (isAnySyncing) {
      // Mark as waiting and add to queue if not already there
      setSyncQueue(prev => {
        const isAlreadyQueued = prev.some(q => q.username.toLowerCase() === singleSession.username.toLowerCase() && q.server === singleSession.server);
        if (!isAlreadyQueued) {
          updateAccountSyncState(singleSession, {
            status: 'waiting',
            currentCourse: 'Esperando turno...',
            currentActivity: 'En cola para sincronización...',
            processedCount: 0,
            totalCount: 0,
            logs: []
          });
          return [...prev, singleSession];
        }
        return prev;
      });
      return;
    }

    // Start sync for this single session!
    // Capture the pre-sync task list so change notifications compare against the
    // original values even if a 'syncing' poll has already merged new ones.
    syncBaselineRef.current[sKey] = tasks;

    updateAccountSyncState(singleSession, {
      status: 'syncing',
      currentCourse: 'Enviando petición...',
      currentActivity: 'Iniciando el scraping de tu cuenta...',
      processedCount: 0,
      totalCount: 0,
      logs: []
    });

    localStorage.setItem('unemi_sync_key', sKey);

    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/moodle/sync/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: [singleSession] })
      });

      if (!res.ok) {
        throw new Error('El servidor remoto retornó un error de red');
      }

      const data = await res.json();
      if (data.key) {
        pollBackgroundSync(data.key);
      }
    } catch (err: any) {
      updateAccountSyncState(singleSession, {
        status: 'failed',
        currentCourse: 'Sincronización interrumpida',
        currentActivity: err.message || 'Error al conectar con la API de sincronización',
        processedCount: 0,
        totalCount: 0
      });
    }
  };

  const pauseGlobalSync = (sess: MoodleSession) => {
    cancelGlobalSync(sess);
  };

  const cancelGlobalSync = async (sess: MoodleSession) => {
    const sKey = `${sess.server}_${sess.username.trim().toLowerCase()}`;
    delete syncBaselineRef.current[sKey];
    // Remove from queue if it is there
    setSyncQueue(prev => prev.filter(q => q.username.toLowerCase() !== sess.username.toLowerCase() || q.server !== sess.server));

    updateAccountSyncState(sess, {
      status: 'idle',
      currentCourse: '',
      currentActivity: '',
      processedCount: 0,
      totalCount: 0,
      logs: []
    });

    const currentActiveSyncKey = localStorage.getItem('unemi_sync_key');
    if (currentActiveSyncKey === sKey) {
      localStorage.removeItem('unemi_sync_key');
    }

    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      await fetch(`${apiBase}/api/moodle/sync/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: sKey })
      });
    } catch (e) {
      // Ignored silently
    }
  };

  // FIFO Queue to schedule sync requests sequentially when no account is actively syncing
  useEffect(() => {
    const isAnySyncing = Object.keys(accountSyncs).some(k => accountSyncs[k]?.status === 'syncing');
    if (!isAnySyncing && syncQueue.length > 0) {
      const nextSession = syncQueue[0];
      setSyncQueue(prev => prev.slice(1));
      startGlobalSync([nextSession]);
    }
  }, [accountSyncs, syncQueue]);

  // Set up tracking tracker on startup or change
  useEffect(() => {
    if (lastSyncedTime) {
      const cached = localStorage.getItem('unemi_sync_reminder_history');
      if (!cached) {
        localStorage.setItem('unemi_sync_reminder_history', JSON.stringify({
          sent3: false,
          sent7: false,
          lastSyncRef: lastSyncedTime
        }));
      }
    }
  }, [lastSyncedTime]);

  // Run offline notification checks whenever tasks or sync time updates
  useEffect(() => {
    if (isDbLoaded && tasks.length > 0) {
      checkAndTriggerOfflineNotifications();
    }
  }, [tasks, lastSyncedTime, isDbLoaded]);

  // Tick every 60 seconds to execute offline notification alerts calculations automatically
  useEffect(() => {
    const interval = setInterval(() => {
      checkAndTriggerOfflineNotifications();
    }, 60000);
    return () => clearInterval(interval);
  }, [tasks, lastSyncedTime, isDbLoaded]);

  const handleDownloadHtml = async (task: TodoTask) => {
    if (!task.activityUrl || !task.moodleUsername || !task.moodleServer) return;
    const matchSess = sessions.find(s => s.username.toLowerCase() === task.moodleUsername?.toLowerCase() && s.server === task.moodleServer);
    if (!matchSess) {
      alert(t('app.noActiveSessionDownload'));
      return;
    }
    
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/moodle/download-raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moodleSession: matchSess.cookies,
          server: matchSess.server,
          url: task.activityUrl
        })
      });
      const data = await res.json();
      if (res.ok && data.html) {
        const blob = new Blob([data.html], { type: 'text/html;charset=utf-8' });
        const urlObj = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = urlObj;
        const safeName = task.title
          .replace(/[^a-z0-9áéíóúñ]/gi, '_')
          .replace(/__+/g, '_')
          .substring(0, 80);
        a.download = `${safeName || 'pagina_moodle'}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(urlObj);
      } else {
        alert(data.error || t('app.downloadHtmlError'));
      }
    } catch (err) {
      console.error('Error downloading HTML:', err);
      alert(t('app.networkErrorDownload'));
    }
  };

  const handleViewHtml = async (task: TodoTask) => {
    if (!task.activityUrl || !task.moodleUsername || !task.moodleServer) return;
    const matchSess = sessions.find(s => s.username.toLowerCase() === task.moodleUsername?.toLowerCase() && s.server === task.moodleServer);
    if (!matchSess) {
      if (!showConnectionsAlert) {
        setShowConnectionsAlert(true);
      } else {
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 500);
      }
      return;
    }
    
    setViewingTaskId(task.id);
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/moodle/download-raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moodleSession: matchSess.cookies,
          server: matchSess.server,
          url: task.activityUrl
        })
      });
      const data = await res.json();
      if (res.ok && data.html) {
        const blob = new Blob([data.html], { type: 'text/html;charset=utf-8' });
        const urlObj = window.URL.createObjectURL(blob);
        const w = window.open(urlObj, '_blank');
        if (!w) {
          const a = document.createElement('a');
          a.href = urlObj;
          a.target = '_blank';
          a.click();
        }
      } else {
        alert(data.error || t('app.viewHtmlError'));
      }
    } catch (err) {
      console.error('Error viewing HTML:', err);
      alert(t('app.networkErrorViewHtml'));
    } finally {
      setViewingTaskId(null);
    }
  };

  // Metrics Calculations
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.completed).length;
  const pendingTasks = totalTasks - completedTasks;
  const percentComplete = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div id="app-root-container" className="min-h-screen bg-slate-50/50 text-slate-800 pb-16 font-sans">
      
      {/* Visual background gradient accents */}
      <span className="absolute top-0 left-0 right-0 h-64 bg-linear-to-b from-blue-50/50 to-transparent pointer-events-none" />

      {/* Navigation Top Header - Sticky & Frozen on top */}
      <header id="navbar-top-wrapper" className="sticky top-0 bg-white/95 backdrop-blur-md border-b border-slate-200/80 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-2.5 flex items-center justify-between gap-3">
          
          {/* Logo Name */}
          <div className="flex items-center space-x-3 shrink-0">
            <div className="p-2 bg-blue-600 rounded-xl text-white shadow-xs">
              <Calendar className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-sm font-bold text-gray-900 leading-tight">{t('nav.title')}</h1>
              <p className="text-[10px] text-gray-400 font-medium">{t('nav.subtitle')}</p>
            </div>
          </div>

          {/* Frozen Tab Navigation Menu - Simplified to 2 core views */}
          <div id="tab-controls-root" className="flex items-center space-x-1 sm:space-x-1.5 bg-slate-100/90 p-1.5 rounded-2xl border border-slate-200/70">
            <button
              id="tab-agenda-btn"
              onClick={() => setActiveTab("agenda")}
              className={`px-3.5 sm:px-4 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer whitespace-nowrap ${
                activeTab === "agenda"
                  ? "bg-white text-blue-600 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
              }`}
            >
              <Calendar className="w-4 h-4 shrink-0" />
              <span>{t('tab.agenda')}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                activeTab === "agenda" ? "bg-blue-50 text-blue-700" : "bg-slate-200/60 text-slate-600"
              }`}>
                {totalTasks}
              </span>
            </button>

            <button
              id="tab-stats-btn"
              onClick={() => setActiveTab("stats")}
              className={`px-3.5 sm:px-4 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer whitespace-nowrap ${
                activeTab === "stats"
                  ? "bg-white text-blue-600 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
              }`}
            >
              <BarChart3 className="w-4 h-4 shrink-0" />
              <span>{t('tab.stats')}</span>
            </button>
          </div>

          {/* Connection badge status, Notifications bell, and More Options */}
          <div className="flex items-center space-x-2 sm:space-x-2.5 shrink-0">

            {/* Always-Visible Sync Button in Frozen Header */}
            <button
              type="button"
              id="header-sync-btn"
              disabled={sessions.filter(s => !s.expired).length === 0 || sessions.some(s => {
                const st = getAccountSyncState(s);
                return st.status === 'syncing' || st.status === 'waiting';
              })}
              onClick={() => startGlobalSync()}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 border cursor-pointer select-none shadow-2xs active:scale-95 ${
                sessions.some(s => {
                  const st = getAccountSyncState(s);
                  return st.status === 'syncing' || st.status === 'waiting';
                })
                  ? 'bg-blue-50 text-blue-700 border-blue-300 animate-pulse'
                  : sessions.filter(s => !s.expired).length === 0
                  ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600'
              }`}
              title={sessions.filter(s => !s.expired).length === 0 ? t('sync.connectFirst') : t('sync.syncAllActive')}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${sessions.some(s => {
                const st = getAccountSyncState(s);
                return st.status === 'syncing' || st.status === 'waiting';
              }) ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">
                {sessions.some(s => {
                  const st = getAccountSyncState(s);
                  return st.status === 'syncing' || st.status === 'waiting';
                }) ? t('sync.syncingBtn') : (language === 'es' ? 'Sincronizar' : 'Sync')}
              </span>
            </button>

            {/* Notification Bell Icon & dropdown */}
            <div className="relative">
              <button 
                type="button"
                ref={notifBtnRef}
                onClick={() => {
                  if (isNotifOpen) {
                    closeNotifications();
                  } else {
                    setIsNotifOpen(true);
                  }
                }}
                className="relative p-2 text-gray-600 hover:text-blue-600 bg-gray-50 hover:bg-blue-100/50 rounded-xl transition-all border border-gray-100 cursor-pointer flex items-center justify-center focus:outline-hidden"
                id="bell-icon-btn"
                title={t('nav.notifications')}
              >
                <Bell className={`w-4.5 h-4.5 ${notifications.some(n => !n.read) ? 'text-blue-600' : 'text-gray-500'}`} />
                {notifications.some(n => !n.read) && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] bg-rose-500 text-[9px] font-bold text-white flex items-center justify-center px-1 rounded-full ring-2 ring-white animate-pulse shadow-xs">
                    {notifications.filter(n => !n.read).length}
                  </span>
                )}
              </button>

              {/* Notifications Popover dropdown */}
              {isNotifOpen && (
                <div 
                  ref={notifPanelRef}
                  id="notifications-popover-panel"
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 mt-2.5 w-80 md:w-96 bg-white border border-gray-150 rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-3 duration-200"
                >
                  {/* Popover Header */}
                  <div className="p-3 bg-gray-50/80 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center space-x-1.5">
                      <span className="p-1 px-1.5 bg-blue-100 text-blue-700 rounded-sm font-bold text-[9px] uppercase tracking-wider">Moodle</span>
                      <h4 className="text-xs font-extrabold text-gray-800">{t('nav.activityAlerts')}</h4>
                    </div>
                    <div className="flex items-center space-x-2">
                      {notifications.some(n => !n.read) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); markAllNotificationsRead(); }}
                          className="text-[9px] text-blue-600 hover:text-blue-700 font-bold hover:underline cursor-pointer whitespace-nowrap"
                        >
                          {t('nav.markRead')}
                        </button>
                      )}
                    </div>
                  </div>

                  {('Notification' in window) && (
                    <div className="p-2.5 bg-blue-50/70 border-b border-blue-100 flex items-center justify-between text-[11px] text-blue-800 font-bold px-3">
                      <span>{t('nav.integratedNotifications')}</span>
                      {Notification.permission === 'granted' ? (
                        <span className="text-[10px] text-emerald-600 bg-emerald-100/50 px-2 py-0.5 rounded-full font-extrabold select-none">
                          {t('nav.notificationsEnabled')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const granted = await requestNotificationPermission();
                            if (granted) {
                              alert(t('nav.notifBrowserGranted'));
                            } else {
                              alert(t('nav.notifBrowserPrompt'));
                            }
                            setTimeTick(t => t + 1);
                          }}
                          className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-[10px] font-bold shadow-xs cursor-pointer select-none whitespace-nowrap transition-all"
                        >
                          {t('nav.notificationsEnableBtn')}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Popover List */}
                  <div className="max-h-[300px] overflow-y-auto divide-y divide-gray-100">
                    {notifications.length === 0 ? (
                      <div className="p-8 text-center space-y-2">
                        <div className="mx-auto w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
                          <BellOff className="w-4 h-4 text-gray-400" />
                        </div>
                        <p className="text-[11px] text-gray-500 font-bold">{t('nav.noNotifications')}</p>
                        <p className="text-[10px] text-gray-400 leading-normal">{t('nav.noNotificationsDesc')}</p>
                      </div>
                    ) : (
                      notifications.map((notif) => {
                        let icon = '📢';
                        let bgClass = 'bg-blue-50/20';
                        let borderLeft = 'border-l-blue-500';
                        if (notif.type === 'new') {
                          icon = '🆕';
                          bgClass = 'bg-emerald-50/20';
                          borderLeft = 'border-l-emerald-500';
                        } else if (notif.type === 'deadline') {
                          icon = '📅';
                          bgClass = 'bg-amber-50/20';
                          borderLeft = 'border-l-amber-500';
                        } else if (notif.type === 'grade') {
                          icon = '⭐';
                          bgClass = 'bg-indigo-50/20';
                          borderLeft = 'border-l-indigo-500';
                        } else if (notif.type === 'status') {
                          icon = '🔄';
                          bgClass = 'bg-sky-50/20';
                          borderLeft = 'border-l-sky-500';
                        } else if (notif.type === 'removed') {
                          icon = '🗑️';
                          bgClass = 'bg-rose-50/20';
                          borderLeft = 'border-l-rose-500';
                        }

                        return (
                          <div 
                            key={notif.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              markNotificationRead(notif.id);
                              if (notif.activityUrl) {
                                setAgendaNavigation(null);
                                setTimeout(() => {
                                  setAgendaNavigation(notif.activityUrl);
                                }, 20);
                                setActiveTab('agenda');
                                closeNotifications();
                              }
                            }}
                            className={`p-3 flex items-start space-x-2.5 cursor-pointer hover:bg-gray-50 transition-all border-l-3 ${borderLeft} ${notif.read ? 'bg-white opacity-60' : bgClass}`}
                          >
                            <div className="text-sm shrink-0 select-none mt-0.5">{icon}</div>
                            <div className="space-y-0.5 overflow-hidden min-w-0 flex-1">
                              <p className={`text-[11px] leading-tight text-gray-800 ${notif.read ? 'font-medium' : 'font-extrabold'}`}>
                                {notif.title}
                              </p>
                              <p className="text-[10px] text-gray-500 leading-snug break-words font-medium whitespace-pre-line">
                                {notif.message}
                              </p>
                              <div className="flex items-center space-x-1.5 text-[9px] font-bold text-gray-400 mt-1">
                                <span className="uppercase text-[8px] bg-gray-100 text-gray-600 px-1 py-0.2 rounded-sm font-semibold">
                                  {notif.moodleServer === 'upsdt' ? 'UPSDT' : (notif.moodleServer === 'a' ? 'UNEMI P/S' : 'UNEMI Online')}
                                </span>
                              </div>
                            </div>
                            {!notif.read && (
                              <span className="w-1.5 h-1.5 bg-blue-600 rounded-full shrink-0 mt-1.5" />
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div className="p-2 border-t border-gray-100 bg-gray-50 text-center">
                    <p className="text-[9px] text-gray-400 font-semibold">{t('nav.smartAlerts')}</p>
                  </div>
                </div>
              )}
            </div>

            {/* FROZEN "MORE OPTIONS" BUTTON & DROPDOWN */}
            <div className="relative" ref={moreOptionsRef}>
              <button
                id="more-options-btn"
                type="button"
                onClick={() => setIsMoreOptionsOpen(!isMoreOptionsOpen)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 border cursor-pointer select-none ${
                  isMoreOptionsOpen
                    ? 'bg-blue-50 text-blue-700 border-blue-300 shadow-2xs'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200 shadow-2xs'
                }`}
                title={t('nav.moreOptions')}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-600" />
                <span className="hidden sm:inline">{t('nav.moreOptions')}</span>
                
                {/* Account status indicator badge */}
                {sessions.length > 0 ? (
                  <span className={`w-2 h-2 rounded-full ${sessions.some(s => s.expired) ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-slate-300" />
                )}
                
                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 ${isMoreOptionsOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* More Options Dropdown Panel */}
              {isMoreOptionsOpen && (
                <div
                  id="more-options-dropdown-panel"
                  className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-150"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Dropdown Header */}
                  <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                    <div className="flex items-center space-x-2">
                      <Settings2 className="w-4 h-4 text-blue-600" />
                      <h3 className="text-xs font-bold text-slate-900">{t('options.title')}</h3>
                    </div>
                    <LanguageToggle />
                  </div>

                  {/* Section 1: Connected Accounts */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        {t('options.connectedAccounts')} ({sessions.length})
                      </span>
                      {sessions.length > 0 && (
                        <span className="text-[10px] text-slate-400">
                          {sessions.filter(s => !s.expired).length} {language === 'es' ? 'activas' : 'active'}
                        </span>
                      )}
                    </div>

                    {sessions.length === 0 ? (
                      <div className="p-3 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center">
                        <p className="text-xs text-slate-500">{t('options.noAccounts')}</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                        {sessions.map((sess, idx) => {
                          const serverLabel = sess.server === 'upsdt' 
                            ? 'UPSDT' 
                            : (sess.server === 'a' ? 'UNEMI P/S' : 'UNEMI Online');
                          const acctKey = `${sess.server}_${sess.username.trim().toLowerCase()}`;
                          const isReloginOpen = reloginOpenFor === acctKey;
                          const isReloginLoading = reloginLoadingFor === acctKey;
                          const reloginError = reloginOpenFor && reloginErrorFor ? reloginErrorFor : null;

                          return (
                            <div
                              key={idx}
                              className="rounded-xl border bg-slate-50 border-slate-200 text-slate-700 text-xs"
                            >
                              <div className="p-2.5 flex items-center justify-between">
                                <div className="flex items-center space-x-2 min-w-0">
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                                    sess.expired ? 'bg-rose-500' : 'bg-emerald-500'
                                  }`} />
                                  <div className="min-w-0">
                                    <div className="flex items-center space-x-1.5 truncate">
                                      <span className="font-bold truncate">{sess.username}</span>
                                      <span className="text-[9px] px-1.5 py-0.2 bg-white/80 border border-slate-200 rounded font-semibold text-slate-500 shrink-0">
                                        {serverLabel}
                                      </span>
                                    </div>
                                    {sess.expired && (
                                      <span className="text-[10px] text-rose-500 font-bold block">{language === 'es' ? 'Expirada' : 'Expired'}</span>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center space-x-1 shrink-0 ml-2">
                                  {sess.expired && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (isReloginOpen) {
                                          setReloginOpenFor(null);
                                          setReloginPassword('');
                                          setReloginErrorFor(null);
                                        } else {
                                          setReloginOpenFor(acctKey);
                                          setReloginPassword('');
                                          setReloginErrorFor(null);
                                        }
                                      }}
                                      className="p-1 text-blue-600 hover:bg-white rounded-lg transition-colors cursor-pointer"
                                      title={language === 'es' ? 'Iniciar sesión de nuevo' : 'Log in again'}
                                    >
                                      <RefreshCw className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveAccount(idx)}
                                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-white rounded-lg transition-colors cursor-pointer"
                                    title={language === 'es' ? 'Quitar cuenta' : 'Remove account'}
                                  >
                                    <LogOut className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              {isReloginOpen && (
                                <div className="px-2.5 pb-2.5">
                                  <div className="bg-white border border-slate-200 rounded-xl p-2.5 space-y-2">
                                    <div className="relative">
                                      <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400">
                                        <Key className="w-3.5 h-3.5" />
                                      </div>
                                      <input
                                        type="password"
                                        value={reloginPassword}
                                        onChange={(e) => setReloginPassword(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') handleRelogin(sess);
                                        }}
                                        placeholder={t('login.passwordPlaceholder')}
                                        disabled={isReloginLoading}
                                        className="block w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-blue-100 focus:border-blue-500 disabled:opacity-50"
                                      />
                                    </div>
                                    {reloginError && (
                                      <p className="text-[10px] text-rose-600 font-semibold flex items-center space-x-1">
                                        <AlertCircle className="w-3 h-3 shrink-0" />
                                        <span>{reloginError}</span>
                                      </p>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleRelogin(sess)}
                                      disabled={isReloginLoading}
                                      className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg text-[11px] font-bold flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
                                    >
                                      {isReloginLoading ? (
                                        <>
                                          <RefreshCw className="w-3 h-3 animate-spin" />
                                          <span>{t('login.connectingBtn')}</span>
                                        </>
                                      ) : (
                                        <span>{language === 'es' ? 'Reconectar cuenta' : 'Reconnect account'}</span>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Button to add an account */}
                    <button
                      id="add-account-from-options-btn"
                      type="button"
                      onClick={() => {
                        setIsMoreOptionsOpen(false);
                        setIsAddAccountModalOpen(true);
                      }}
                      className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>{t('options.addAccount')}</span>
                    </button>
                  </div>

                  {/* Section 2: First Week Date Configuration */}
                  <div className="pt-2 border-t border-slate-100 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="first-week-date-input" className="text-[11px] font-bold text-slate-700 flex items-center space-x-1.5">
                        <Calendar className="w-3.5 h-3.5 text-blue-600" />
                        <span>{t('options.firstWeekDate')}</span>
                      </label>
                      {firstWeekDate !== '2026-04-13' && (
                        <button
                          type="button"
                          onClick={() => handleFirstWeekDateChange('2026-04-13')}
                          className="text-[10px] text-blue-600 hover:underline font-semibold cursor-pointer"
                        >
                          {language === 'es' ? 'Restablecer' : 'Reset'}
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-tight">
                      {t('options.firstWeekDesc')}
                    </p>
                    <input
                      id="first-week-date-input"
                      type="date"
                      value={firstWeekDate}
                      onChange={(e) => handleFirstWeekDateChange(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500 font-medium text-slate-800"
                    />
                  </div>

                  {/* Quick Connections view shortcut */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('login');
                        setIsMoreOptionsOpen(false);
                      }}
                      className="text-slate-500 hover:text-blue-600 font-bold transition-colors cursor-pointer flex items-center space-x-1"
                    >
                      <Lock className="w-3 h-3" />
                      <span>{language === 'es' ? 'Ver conexiones' : 'View connections'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        startGlobalSync();
                        setIsMoreOptionsOpen(false);
                      }}
                      className="text-blue-600 hover:text-blue-700 font-bold transition-colors cursor-pointer flex items-center space-x-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>{language === 'es' ? 'Sincronizar' : 'Sync'}</span>
                    </button>
                  </div>

                </div>
              )}
            </div>
          </div>

        </div>
      </header>

      {/* Main Container Grid layout */}
      <main className="max-w-7xl mx-auto px-4 md:px-6 mt-6 relative z-10 space-y-6">

        {/* Sync & Overview Status Bar (Shown on Agenda or when sync in progress) */}
        {(activeTab === "agenda" || sessions.some(s => {
          const st = getAccountSyncState(s);
          return st.status === "syncing" || st.status === "waiting";
        })) && (
          <SyncStatusBar
            sessions={sessions}
            getAccountSyncState={getAccountSyncState}
            syncQueue={syncQueue}
            lastSyncedTime={lastSyncedTime}
            getRelativeLastSyncedTime={getRelativeLastSyncedTime}
            onStartSync={startGlobalSync}
            onCancelSync={cancelGlobalSync}
            totalTasks={totalTasks}
            completedTasks={completedTasks}
            pendingTasks={pendingTasks}
            percentComplete={percentComplete}
            onNavigateToTab={(t) => setActiveTab(t)}
          />
        )}

        {/* Workspace Display */}
        <div id="workspace-tab-display" className="space-y-6">
          
          {/* TAB 1: AGENDA (Timeline) */}
          {activeTab === 'agenda' && (
            <ActivityTimeline
              tasks={tasks}
              onToggleComplete={onToggleComplete}
              onDeleteTask={onDeleteTask}
              onOpenNewTaskModal={() => setIsNewTaskModalOpen(true)}
              navigationTrigger={agendaNavigation}
              onClearNavigationTrigger={() => setAgendaNavigation(null)}
              onDownloadHtml={handleDownloadHtml}
              onViewHtml={handleViewHtml}
              filterCourseIdTrigger={timelineFilterCourseId}
              onClearFilterCourseIdTrigger={() => setTimelineFilterCourseId(null)}
              viewingTaskId={viewingTaskId}
              firstWeekDate={firstWeekDate}
              onFirstWeekDateChange={handleFirstWeekDateChange}
              liveCoursesByAccount={liveCoursesByAccount}
              getFeedbackImageUrl={(task, fileUrl) => {
                const match = sessions.find(
                  s => s.username.toLowerCase() === task.moodleUsername?.toLowerCase() && s.server === task.moodleServer
                );
                if (!match) return null;
                return `/api/moodle/proxy?url=${encodeURIComponent(fileUrl)}&server=${match.server}&username=${match.username}&session=${encodeURIComponent(match.cookies)}`;
              }}
            />
          )}

          {/* TAB 3: SIMPLIFIED CONNECTIONS PANEL */}
          {activeTab === 'login' && (
            <div className="max-w-2xl mx-auto space-y-5">
              {/* Back to Agenda button */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setActiveTab('agenda')}
                  className="text-xs font-bold text-slate-600 hover:text-blue-600 flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{language === 'es' ? 'Volver a Mi Agenda' : 'Back to My Agenda'}</span>
                </button>
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-400 font-medium">
                    {sessions.length} {language === 'es' ? 'cuentas conectadas' : 'connected accounts'}
                  </span>
                </div>
              </div>

              {/* Connected Accounts Card (if any) */}
              {sessions.length > 0 && (
                <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                    <div className="flex items-center space-x-2">
                      <Users className="w-4 h-4 text-blue-600" />
                      <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        {t('options.connectedAccounts')} ({sessions.length})
                      </h3>
                    </div>
                    {isVerifyingSessions && (
                      <span className="text-[10px] text-blue-600 font-bold animate-pulse flex items-center space-x-1">
                        <RefreshCw className="w-3 h-3 shrink-0 animate-spin" />
                        <span>Verificando...</span>
                      </span>
                    )}
                  </div>

                  <div className="space-y-2">
                    {sessions.map((sess, idx) => {
                      const serverLabel = sess.server === 'upsdt' 
                        ? 'UPSDT' 
                        : (sess.server === 'a' ? 'UNEMI Presencial / Semi' : 'UNEMI Online');

                      return (
                        <div 
                          key={idx} 
                          className="p-3.5 rounded-xl border bg-slate-50 border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="flex items-center space-x-3 min-w-0">
                            <span className={`w-3 h-3 rounded-full shrink-0 ${
                              sess.expired ? 'bg-rose-500' : 'bg-emerald-500'
                            }`} />
                            <div className="min-w-0">
                              <div className="flex items-center space-x-2">
                                <span className="text-xs font-bold text-slate-900 font-mono truncate">{sess.username}</span>
                                <span className="text-[10px] px-2 py-0.5 bg-white border border-slate-200 rounded-md font-bold text-slate-600">
                                  {serverLabel}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                {sess.expired && (
                                  <span className="text-rose-600 font-bold">{language === 'es' ? 'Expirada' : 'Expired'}</span>
                                )}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2 self-end sm:self-auto shrink-0">
                            {sess.expired ? (
                              <button
                                onClick={() => {
                                  setPrefillLogin({
                                    username: sess.username,
                                    server: sess.server,
                                    errorMsg: 'Por favor ingresa tus credenciales para reactivar esta cuenta.'
                                  });
                                }}
                                className="text-xs font-bold text-blue-600 bg-white hover:bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
                              >
                                {language === 'es' ? 'Reconectar' : 'Reconnect'}
                              </button>
                            ) : null}

                            <button
                              onClick={() => handleRemoveAccount(idx)}
                              className="text-xs font-bold text-rose-600 hover:bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
                            >
                              <LogOut className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Login / Add Account Form Card */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-4">
                <div className="flex items-center space-x-2.5 pb-2 border-b border-slate-100">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                    <UserPlus className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      {sessions.length > 0 ? (language === 'es' ? 'Agregar otra cuenta' : 'Add another account') : (language === 'es' ? 'Conectar tu cuenta' : 'Connect your account')}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {language === 'es' ? 'Soporte para UNEMI (Presencial, Semipresencial, Online) y UPSDT' : 'Support for UNEMI and UPSDT'}
                    </p>
                  </div>
                </div>

                <LoginPanel
                  onLoginSuccess={handleLoginSuccess}
                  activeSession={null}
                  onLogout={handleLogout}
                  prefillUsername={prefillLogin?.username}
                  prefillServer={prefillLogin?.server}
                  loginErrorMessage={prefillLogin?.errorMsg}
                />
              </div>
            </div>
          )}

          {/* TAB 4: STATISTICS PANEL */}
          {activeTab === 'stats' && (
            <StatsPanel 
              tasks={tasks} 
              liveCoursesByAccount={liveCoursesByAccount}
              firstWeekDate={firstWeekDate}
              onNavigateToMoodleActivity={(courseId, activityUrl) => {
                const matchedTask = tasks.find(t => t.activityUrl === activityUrl);
                if (matchedTask && matchedTask.moodleUsername && matchedTask.moodleServer) {
                  const sIdx = sessions.findIndex(
                    s => s.username.toLowerCase() === matchedTask.moodleUsername?.toLowerCase() && s.server === matchedTask.moodleServer
                  );
                  if (sIdx !== -1) {
                    setActiveSessionIndex(sIdx);
                  }
                }
                setAgendaNavigation(activityUrl);
                setActiveTab('agenda');
              }}
              onViewUpcomingActivities={(courseId) => {
                setTimelineFilterCourseId(courseId);
                setActiveTab('agenda');
              }}
            />
          )}

        </div>

      </main>

      {/* Quick Add Account Modal Dialog */}
      {isAddAccountModalOpen && (
        <div 
          id="add-account-modal-overlay"
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setIsAddAccountModalOpen(false)}
        >
          <div 
            id="add-account-modal-card"
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                  <UserPlus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{t('options.addAccount')}</h3>
                  <p className="text-xs text-slate-400">UNEMI (Presencial, Semi, Online) o UPSDT</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddAccountModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <LoginPanel
              onLoginSuccess={(newSession) => {
                handleLoginSuccess(newSession);
                setIsAddAccountModalOpen(false);
              }}
              activeSession={null}
              onLogout={() => {}}
            />
          </div>
        </div>
      )}

      {/* Insertion manual task modal popup */}
      <NewTaskModal
        courses={courses}
        isOpen={isNewTaskModalOpen}
        onClose={() => setIsNewTaskModalOpen(false)}
        onSaveTask={handleSaveManualTask}
      />

    </div>
  );
}
