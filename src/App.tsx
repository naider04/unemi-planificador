import React, { useState, useEffect } from 'react';
import { 
  Calendar, Layers, Lock, BookOpen, Award, CheckCircle2, 
  Sparkles, Clock, AlertCircle, Bookmark, CheckSquare, Eye, RefreshCw, Download, BarChart3,
  Bell, BellOff
} from 'lucide-react';

import { MoodleSession, TodoTask, Course, MoodleNotification } from './types';
import LoginPanel from './components/LoginPanel';
import MoodleBrowser from './components/MoodleBrowser';
import ActivityTimeline from './components/ActivityTimeline';
import NewTaskModal from './components/NewTaskModal';
import StatsPanel from './components/StatsPanel';
import { fetchUserCacheFromFirestore, saveUserCacheToFirestore } from './firebase';

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
      };
    } else {
      merged.push(nt);
    }
  });
  return merged;
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
  const [sessions, setSessions] = useState<MoodleSession[]>([]);
  const [activeSessionIndex, setActiveSessionIndex] = useState<number>(0);
  const [isDbLoaded, setIsDbLoaded] = useState<boolean>(false);
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [activeTab, setActiveTab] = useState<'agenda' | 'browser' | 'login' | 'stats'>('agenda');
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [moodleNavigation, setMoodleNavigation] = useState<{ courseId: string; activityUrl: string } | null>(null);
  const [agendaNavigation, setAgendaNavigation] = useState<string | null>(null);
  const [prefillLogin, setPrefillLogin] = useState<{ username: string; server: 'a' | 'b' | 'upsdt'; errorMsg: string } | null>(null);
  const [timelineFilterCourseId, setTimelineFilterCourseId] = useState<string | null>(null);
  const [syncedAccountsCount, setSyncedAccountsCount] = useState<number | null>(null);
  const [isVerifyingSessions, setIsVerifyingSessions] = useState<boolean>(false);

  // Global Sync State
  const [globalSync, setGlobalSync] = useState<{
    status: 'idle' | 'syncing' | 'paused' | 'interrupted' | 'completed' | 'failed';
    currentCourse: string;
    currentActivity: string;
    processedCount: number;
    totalCount: number;
    queue: {
      sessionIndex: number;
      username: string;
      server: 'a' | 'b' | 'upsdt';
      courseId: string;
      courseName: string;
      activityUrl: string;
      type: 'TAREA' | 'CUESTIONARIO';
      activityName: string;
    }[];
    logs?: {
      timestamp: string;
      type: 'info' | 'success' | 'warn' | 'error' | 'performance';
      message: string;
      durationMs?: number;
    }[];
  }>({
    status: 'idle',
    currentCourse: '',
    currentActivity: '',
    processedCount: 0,
    totalCount: 0,
    queue: []
  });

  const [syncingTaskId, setSyncingTaskId] = useState<string | null>(null);
  const [lastSyncedTime, setLastSyncedTime] = useState<number | null>(null);
  
  const [notifications, setNotifications] = useState<MoodleNotification[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [showSyncLogs, setShowSyncLogs] = useState(false);

  const getRelativeNotifTime = (timestamp: number) => {
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'ahora';
    if (diffMins < 60) return `hace ${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `hace ${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `hace ${diffDays}d`;
  };

  const markNotificationRead = (notifId: string) => {
    setNotifications(prev => {
      const updated = prev.map(n => n.id === notifId ? { ...n, read: true } : n);
      localStorage.setItem('unemi_notifications', JSON.stringify(updated));
      return updated;
    });
  };

  const markAllNotificationsRead = () => {
    setNotifications(prev => {
      const updated = prev.map(n => ({ ...n, read: true }));
      localStorage.setItem('unemi_notifications', JSON.stringify(updated));
      return updated;
    });
  };

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
          newNotifications.push({
            id: `new_task_${incomingTask.id || now}_${Math.random().toString(36).substr(2, 5)}`,
            moodleUsername: incomingTask.moodleUsername || '',
            moodleServer: incomingTask.moodleServer || 'a',
            timestamp: now,
            title: '🆕 Nueva Actividad Detectada',
            message: `Nueva ${incomingTask.type.toLowerCase()}: "${incomingTask.title}" en la materia ${incomingTask.courseName || 'Moodle'}.`,
            type: 'new',
            read: false,
            activityUrl: incomingTask.activityUrl,
            courseName: incomingTask.courseName
          });
        } else {
          if (incomingTask.closureDate && existingTask.closureDate && incomingTask.closureDate !== existingTask.closureDate) {
            const formatShortDate = (isoStr: string) => {
              try {
                const date = new Date(isoStr);
                return date.toLocaleString('es-EC', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
              } catch {
                return isoStr;
              }
            };
            newNotifications.push({
              id: `deadline_change_${incomingTask.id || now}_${Math.random().toString(36).substr(2, 5)}`,
              moodleUsername: incomingTask.moodleUsername || '',
              moodleServer: incomingTask.moodleServer || 'a',
              timestamp: now,
              title: '📅 Cambio de Deadline',
              message: `El plazo de "${existingTask.title}" cambió de ${formatShortDate(existingTask.closureDate)} a ${formatShortDate(incomingTask.closureDate)}.`,
              type: 'deadline',
              read: false,
              activityUrl: incomingTask.activityUrl,
              courseName: existingTask.courseName
            });
          }

          if (incomingTask.grade && incomingTask.grade !== existingTask.grade) {
            newNotifications.push({
              id: `grade_${incomingTask.id || now}_${Math.random().toString(36).substr(2, 5)}`,
              moodleUsername: incomingTask.moodleUsername || '',
              moodleServer: incomingTask.moodleServer || 'a',
              timestamp: now,
              title: '⭐ Nueva Calificación',
              message: `Recibiste una nota para "${existingTask.title}": ${incomingTask.grade}/${incomingTask.gradeOver || '10'}.`,
              type: 'grade',
              read: false,
              activityUrl: incomingTask.activityUrl,
              courseName: existingTask.courseName
            });
          }

          if (incomingTask.status && existingTask.status && incomingTask.status !== existingTask.status) {
            newNotifications.push({
              id: `status_${incomingTask.id || now}_${Math.random().toString(36).substr(2, 5)}`,
              moodleUsername: incomingTask.moodleUsername || '',
              moodleServer: incomingTask.moodleServer || 'a',
              timestamp: now,
              title: '🔄 Estado Actualizado',
              message: `El estado de "${existingTask.title}" cambió de "${existingTask.status}" a "${incomingTask.status}".`,
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

      // Restore Global Sync State
      const cachedSync = localStorage.getItem('unemi_global_sync_state');
      if (cachedSync) {
        try {
          const parsed = JSON.parse(cachedSync);
          setGlobalSync(parsed);
        } catch (e) {
          console.error('Error recovering global sync state cache:', e);
        }
      }

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

          for (const s of loadedSessions) {
            try {
              const firestoreCache = await fetchUserCacheFromFirestore(s.server, s.username);
              if (firestoreCache) {
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

  // 1b. Auto-save user cache to Firestore whenever state changes
  useEffect(() => {
    if (!isDbLoaded) return;
    sessions.forEach(s => {
      saveUserCacheToFirestore(s.server, s.username, tasks, lastSyncedTime, notifications)
        .catch(err => console.error(`Error auto-saving cache to Firestore for ${s.username}:`, err));
    });
  }, [tasks, lastSyncedTime, sessions, isDbLoaded, notifications]);

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
    setActiveTab('browser'); // take them to Moodle browser immediately
    setPrefillLogin(null); // Clear any active reconnect/prefill error values

    // Async fetch and merge this user's cache from Firestore immediately on login
    try {
      const firestoreCache = await fetchUserCacheFromFirestore(newSession.server, newSession.username);
      if (firestoreCache && firestoreCache.tasks && firestoreCache.tasks.length > 0) {
        setTasks(prevTasks => {
          const merged = mergeTasksLists(prevTasks, firestoreCache.tasks);
          localStorage.setItem('unemi_tasks', JSON.stringify(merged));
          return merged;
        });
        if (firestoreCache.lastSyncedTime && (!lastSyncedTime || firestoreCache.lastSyncedTime > lastSyncedTime)) {
          setLastSyncedTime(firestoreCache.lastSyncedTime);
          localStorage.setItem('unemi_last_global_sync_time', String(firestoreCache.lastSyncedTime));
        }
      }
    } catch (err) {
      console.error(`Error loading database cache for ${newSession.username} on login:`, err);
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

    let friendlyMsg = 'Tu sesión en el aula virtual ha expirado o se ha cerrado.';
    if (rawMsg.toLowerCase().includes('fetch failed')) {
      friendlyMsg = 'Sesión cerrada o error de conexión de red (Fetch failed). Vuelve a conectar tu cuenta para re-autenticarte.';
    } else if (rawMsg) {
      friendlyMsg = `Se interrumpió la conexión (${rawMsg}). Por favor, ingresa tus datos de acceso nuevamente en Moodle.`;
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

  const handleImportTasks = (newTasks: TodoTask[]) => {
    const merged = [...tasks];
    newTasks.forEach(nt => {
      // Deduplicate by activityUrl
      const existingIdx = merged.findIndex(t => t.activityUrl === nt.activityUrl && nt.activityUrl);
      if (existingIdx !== -1) {
        const currentTitle = merged[existingIdx].title;
        const incomingTitle = nt.title || '';
        const isGeneric = (t: string) => {
          const l = (t || '').toLowerCase();
          return l.includes('continuar') || l.includes('volver') || l.includes('regresar') || l.includes('siguiente') || l === 'ver' || l === 'ir' || l === 'ir a';
        };
        const updatedTitle = (!isGeneric(incomingTitle) || isGeneric(currentTitle)) ? incomingTitle : currentTitle;

        // Keep descriptions intact if modified, but update dates & completions from scraper details
        merged[existingIdx] = {
          ...merged[existingIdx],
          title: updatedTitle,
          closureDate: nt.closureDate,
          aperture: nt.aperture,
          apertureDateISO: nt.apertureDateISO,
          completed: nt.completed,
          status: nt.status,
          grade: nt.grade,
          gradeOver: nt.gradeOver,
          gradingStatus: nt.gradingStatus,
          estado_calificacion: nt.estado_calificacion,
          advertencia_preguntas: nt.advertencia_preguntas,
          por_hacer_calificacion: nt.por_hacer_calificacion,
          hecho_calificacion: nt.hecho_calificacion,
          grupo: nt.grupo,
          moodleUsername: nt.moodleUsername,
          moodleServer: nt.moodleServer
        };
      } else {
        merged.push(nt);
      }
    });

    setTasks(merged);
    localStorage.setItem('unemi_tasks', JSON.stringify(merged));
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
      if (!data.job) {
        setGlobalSync(prev => ({ ...prev, status: 'idle' }));
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
          queue: [] as any[],
          logs: job.logs || []
        };

        setGlobalSync(nextState);

        // Save progress to local cache too
        localStorage.setItem('unemi_global_sync_state', JSON.stringify(nextState));

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
        setLastSyncedTime(finishedTime);
        localStorage.setItem('unemi_last_global_sync_time', String(finishedTime));

        if (job.validSessionCount !== undefined) {
          setSyncedAccountsCount(job.validSessionCount);
          localStorage.setItem('unemi_synced_accounts_count', String(job.validSessionCount));
        } else {
          setSyncedAccountsCount(sessions.length);
          localStorage.setItem('unemi_synced_accounts_count', String(sessions.length));
        }

        setGlobalSync({
          status: 'completed',
          currentCourse: '',
          currentActivity: '',
          processedCount: job.totalCount,
          totalCount: job.totalCount,
          queue: [],
          logs: job.logs || []
        });

        localStorage.setItem('unemi_global_sync_state', JSON.stringify({
          status: 'completed',
          currentCourse: '',
          currentActivity: '',
          processedCount: job.totalCount,
          totalCount: job.totalCount,
          queue: [],
          logs: job.logs || []
        }));

        // Process a final merge of all tasks
        if (job.tasks && job.tasks.length > 0) {
          setTasks(prevTasks => {
            detectAndGenerateNotifications(prevTasks, job.tasks);

            const merged = [...prevTasks];
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
        localStorage.removeItem('unemi_sync_key');
        return false;
      } else if (job.status === 'failed') {
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
          localStorage.removeItem('unemi_sync_key');
          
          const firstExpired = expiredList.length > 0
            ? sessions.find(s => expiredList.some((e: any) => e.username.toLowerCase() === s.username.toLowerCase() && e.server === s.server))
            : sessions[0];

          setPrefillLogin({
            username: firstExpired?.username || sessions[0]?.username || '',
            server: firstExpired?.server || sessions[0]?.server || 'a',
            errorMsg: 'Las cuentas o sesiones conectadas han expirado o se cerraron. Por favor ingresa tus datos de acceso en "Conectar Moodle" para continuar.'
          });
          // Do not automatically redirect to Connections tab to avoid breaking the user's focus
          setGlobalSync({
            status: 'failed',
            currentCourse: 'Sesiones expiradas',
            currentActivity: errMsg,
            processedCount: job.processedCount,
            totalCount: job.totalCount,
            queue: [],
            logs: job.logs || []
          });
          localStorage.setItem('unemi_global_sync_state', JSON.stringify({
            status: 'failed',
            currentCourse: 'Sesiones expiradas',
            currentActivity: errMsg,
            processedCount: job.processedCount,
            totalCount: job.totalCount,
            queue: [],
            logs: job.logs || []
          }));
          return false;
        }

        setGlobalSync({
          status: 'failed',
          currentCourse: 'Sincronización interrumpida',
          currentActivity: job.error || 'Ocurrió un error en la conexión',
          processedCount: job.processedCount,
          totalCount: job.totalCount,
          queue: [],
          logs: job.logs || []
        });
        localStorage.setItem('unemi_global_sync_state', JSON.stringify({
          status: 'failed',
          currentCourse: 'Terminado con error',
          currentActivity: job.error || 'Error',
          processedCount: job.processedCount,
          totalCount: job.totalCount,
          queue: [],
          logs: job.logs || []
        }));
        localStorage.removeItem('unemi_sync_key');
        return false;
      } else {
        setGlobalSync(prev => ({ ...prev, status: 'idle' }));
        localStorage.removeItem('unemi_sync_key');
        return false;
      }
    } catch (err) {
      console.error('Error polling background sync:', err);
      // Let next poll turn retry
      return true;
    }
  };

  // Poll loop mechanism
  useEffect(() => {
    let active = true;
    let timer: any = null;

    const tick = async () => {
      const savedKey = localStorage.getItem('unemi_sync_key') || (sessions.length > 0 ? sessions.map(s => `${s.server}_${s.username.trim().toLowerCase()}`).sort().join('_') : null);
      if (!savedKey) {
        setGlobalSync(prev => ({ ...prev, status: 'idle' }));
        return;
      }

      const shouldContinue = await pollBackgroundSync(savedKey);
      if (active && shouldContinue) {
        timer = setTimeout(tick, 2000);
      }
    };

    // If syncing on mount/state update, run the ticker
    if (globalSync.status === 'syncing') {
      tick();
    }

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [globalSync.status, sessions]);

  // Trigger server-side background sync
  const startGlobalSync = async () => {
    if (sessions.length === 0) {
      alert('Por favor conecta al menos una cuenta de Moodle para poder sincronizar.');
      return;
    }

    setSyncedAccountsCount(sessions.length);
    localStorage.setItem('unemi_synced_accounts_count', String(sessions.length));

    const key = sessions.map(s => `${s.server}_${s.username.trim().toLowerCase()}`).sort().join('_');
    localStorage.setItem('unemi_sync_key', key);

    setGlobalSync({
      status: 'syncing',
      currentCourse: 'Enviando petición...',
      currentActivity: 'Iniciando el scraping de todas tus materias...',
      processedCount: 0,
      totalCount: 0,
      queue: []
    });

    localStorage.setItem('unemi_global_sync_state', JSON.stringify({
      status: 'syncing',
      currentCourse: 'Mapeando materias...',
      currentActivity: 'Conectando con aulas virtuales...',
      processedCount: 0,
      totalCount: 0,
      queue: []
    }));

    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/moodle/sync/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions })
      });

      if (!res.ok) {
        throw new Error('El servidor remoto retornó un error de red');
      }

      const data = await res.json();
      if (data.key) {
        pollBackgroundSync(data.key);
      }
    } catch (err: any) {
      setGlobalSync({
        status: 'failed',
        currentCourse: 'Sincronización interrumpida',
        currentActivity: err.message || 'Error al conectar con la API de sincronización',
        processedCount: 0,
        totalCount: 0,
        queue: []
      });
      localStorage.setItem('unemi_global_sync_state', JSON.stringify({
        status: 'failed',
        currentCourse: 'Terminado con error',
        currentActivity: err.message || 'Error',
        processedCount: 0,
        totalCount: 0,
        queue: []
      }));
    }
  };

  const pauseGlobalSync = () => {
    // Standard pause mapped to cancel to avoid blocking, since background processing is server side
    cancelGlobalSync();
  };

  const cancelGlobalSync = async () => {
    const key = sessions.map(s => `${s.server}_${s.username.trim().toLowerCase()}`).sort().join('_');
    localStorage.removeItem('unemi_sync_key');
    setGlobalSync({
      status: 'idle',
      currentCourse: '',
      currentActivity: '',
      processedCount: 0,
      totalCount: 0,
      queue: []
    });
    localStorage.removeItem('unemi_global_sync_state');

    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      await fetch(`${apiBase}/api/moodle/sync/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      });
    } catch (e) {
      // Ignored silently
    }
  };

  const handleUpdateSingleTask = async (taskId: string) => {
    const rawMatch = tasks.find(t => t.id === taskId);
    if (!rawMatch || !rawMatch.activityUrl || !rawMatch.moodleUsername || !rawMatch.moodleServer) return;

    setSyncingTaskId(taskId);
    try {
      const sess = sessions.find(s => s.username.toLowerCase() === rawMatch.moodleUsername?.toLowerCase() && s.server === rawMatch.moodleServer);
      if (!sess) {
        alert('No se encontró una sesión activa relacionada para esa actividad. Por favor ve a la pestaña "Conectar Moodle" y reconéctala.');
        setSyncingTaskId(null);
        return;
      }

      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/moodle/activity-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moodleSession: sess.cookies,
          server: sess.server,
          activityUrl: rawMatch.activityUrl
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.details) {
          const details = data.details;
          
          const computeStatsLocal = (type: string, det: any) => {
            let status = 'No entregado';
            let grade: string | null = null;
            let gradeOver: string | null = null;

            if (det.por_hacer_calificacion) {
              return { status: 'No entregado', grade: null, gradeOver: null };
            }

            if (type === 'CUESTIONARIO') {
              if (det.quiz_info) {
                const qi = det.quiz_info;
                if (qi.calificacion_final) {
                  status = 'Calificado';
                  grade = qi.calificacion_final;
                  gradeOver = qi.calificacion_sobre;
                } else if (qi.intentos && qi.intentos.length > 0) {
                  const finishedAttempt = qi.intentos.find((att: any) => 
                    att.estado?.toLowerCase().includes('terminado') || 
                    att.estado?.toLowerCase().includes('finalizado')
                  );
                  if (finishedAttempt) {
                    status = finishedAttempt.calificacion ? 'Calificado' : 'Entregado';
                    grade = finishedAttempt.calificacion;
                    gradeOver = finishedAttempt.calificacion_sobre;
                  } else {
                    status = 'Entregado';
                  }
                } else if (det.hecho_calificacion) {
                  status = 'Entregado';
                }
              } else if (det.hecho_calificacion) {
                status = 'Entregado';
              }
            } else if (type === 'TAREA') {
              const isCalificado = det.estado_calificacion?.toLowerCase().includes('calificado') || !!det.calificacion;
              if (isCalificado) {
                status = 'Calificado';
                grade = det.calificacion || null;
                gradeOver = det.calificacion_sobre || null;
              } else if (isStatusSubmittedLocal(det.estado_entrega)) {
                status = 'Entregado';
              } else {
                const estEntrega = det.estado_entrega?.toLowerCase() || '';
                if (estEntrega.includes('borrador')) {
                  status = 'Borrador';
                } else if (estEntrega.includes('no entregado') || estEntrega.includes('sin entregar') || estEntrega.includes('no se ha enviado')) {
                  status = 'No entregado';
                } else if (det.hecho_calificacion) {
                  status = 'Entregado';
                } else {
                  status = 'No entregado';
                }
              }
            }
            return { status, grade, gradeOver };
          };

          const stats = computeStatsLocal(rawMatch.type, details);
          const updatedTask: TodoTask = {
            ...rawMatch,
            description: details.detalle || undefined,
            closureDate: details.closureDateISO || null,
            aperture: details.aperture || null,
            apertureDateISO: details.apertureDateISO || null,
            completed: !details.por_hacer_calificacion && (
                         isStatusSubmittedLocal(details.estado_entrega) || 
                         details.quiz_info?.intentos?.some((att: any) => att.estado?.toLowerCase().includes('terminado')) || 
                         (details.hecho_calificacion === true) ||
                         (stats.status === 'Calificado' || stats.status === 'Entregado') ||
                         false
                       ),
            status: stats.status,
            grade: stats.grade,
            gradeOver: stats.gradeOver,
            gradingStatus: (stats.grade || stats.status === 'Calificado' || (details.estado_calificacion && details.estado_calificacion.toLowerCase().includes('calificad'))) ? 'Calificado' : (details.estado_calificacion || null),
            estado_calificacion: (stats.grade || stats.status === 'Calificado' || (details.estado_calificacion && details.estado_calificacion.toLowerCase().includes('calificad'))) ? 'Calificado' : (details.estado_calificacion || null),
            estado_entrega: details.estado_entrega || null,
            comentario_calificador: details.comentario_calificador || null,
            advertencia_preguntas: details.advertencia_preguntas || null,
            por_hacer_calificacion: details.por_hacer_calificacion || false,
            hecho_calificacion: details.hecho_calificacion || false,
            grupo: details.grupo || null,
            lastSyncedAt: new Date().toISOString()
          };

          // Detect single task notification changes on manual/single sync
          const singleNotifs: MoodleNotification[] = [];
          const nowNotif = Date.now();
          
          if (updatedTask.closureDate && rawMatch.closureDate && updatedTask.closureDate !== rawMatch.closureDate) {
            const formatShortDate = (isoStr: string) => {
              try {
                const date = new Date(isoStr);
                return date.toLocaleString('es-EC', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
              } catch {
                return isoStr;
              }
            };
            singleNotifs.push({
              id: `deadline_change_${updatedTask.id}_${nowNotif}`,
              moodleUsername: updatedTask.moodleUsername || '',
              moodleServer: updatedTask.moodleServer || 'a',
              timestamp: nowNotif,
              title: '📅 Cambio de Deadline',
              message: `El plazo de "${updatedTask.title}" cambió de ${formatShortDate(rawMatch.closureDate)} a ${formatShortDate(updatedTask.closureDate)}.`,
              type: 'deadline',
              read: false,
              activityUrl: updatedTask.activityUrl,
              courseName: updatedTask.courseName
            });
          }

          if (updatedTask.grade && updatedTask.grade !== rawMatch.grade) {
            singleNotifs.push({
              id: `grade_${updatedTask.id}_${nowNotif}`,
              moodleUsername: updatedTask.moodleUsername || '',
              moodleServer: updatedTask.moodleServer || 'a',
              timestamp: nowNotif,
              title: '⭐ Nueva Calificación',
              message: `Recibiste una nota para "${updatedTask.title}": ${updatedTask.grade}/${updatedTask.gradeOver || '10'}.`,
              type: 'grade',
              read: false,
              activityUrl: updatedTask.activityUrl,
              courseName: updatedTask.courseName
            });
          }

          if (updatedTask.status && rawMatch.status && updatedTask.status !== rawMatch.status) {
            singleNotifs.push({
              id: `status_${updatedTask.id}_${nowNotif}`,
              moodleUsername: updatedTask.moodleUsername || '',
              moodleServer: updatedTask.moodleServer || 'a',
              timestamp: nowNotif,
              title: '🔄 Estado Actualizado',
              message: `El estado de "${updatedTask.title}" cambió de "${rawMatch.status}" a "${updatedTask.status}".`,
              type: 'status',
              read: false,
              activityUrl: updatedTask.activityUrl,
              courseName: updatedTask.courseName
            });
          }

          if (singleNotifs.length > 0) {
            setNotifications(prev => {
              const merged = [...singleNotifs, ...prev];
              localStorage.setItem('unemi_notifications', JSON.stringify(merged));
              return merged;
            });
          }

          setTasks(prevTasks => {
            const copy = [...prevTasks];
            const matchIdx = copy.findIndex(t => t.id === taskId);
            if (matchIdx !== -1) {
              copy[matchIdx] = updatedTask;
            }
            localStorage.setItem('unemi_tasks', JSON.stringify(copy));
            return copy;
          });
        }
      } else {
        const data = await res.json().catch(() => ({}));
        const errStr = data.error || '';
        if (errStr.includes('sesión') || errStr.includes('sesion') || errStr.includes('expiró') || errStr.includes('expirada') || errStr.includes('inválida') || errStr.includes('invalida') || res.status === 401) {
          handleSessionError(sess, errStr || 'La sesión expiró.', false);
        } else {
          alert('No se pudo actualizar de forma remota la actividad seleccionada.');
        }
      }
    } catch (e) {
      console.error('Failed to update single task:', e);
    } finally {
      setSyncingTaskId(null);
    }
  };

  const handleDownloadHtml = async (task: TodoTask) => {
    if (!task.activityUrl || !task.moodleUsername || !task.moodleServer) return;
    const matchSess = sessions.find(s => s.username.toLowerCase() === task.moodleUsername?.toLowerCase() && s.server === task.moodleServer);
    if (!matchSess) {
      alert('No se encontró una sesión activa para esta cuenta. Por favor vuelve a conectar la cuenta.');
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
        alert(data.error || 'Error al descargar la página de Moodle.');
      }
    } catch (err) {
      console.error('Error downloading HTML:', err);
      alert('Error de red al intentar descargar la página.');
    }
  };

  const handleViewHtml = async (task: TodoTask) => {
    if (!task.activityUrl || !task.moodleUsername || !task.moodleServer) return;
    const matchSess = sessions.find(s => s.username.toLowerCase() === task.moodleUsername?.toLowerCase() && s.server === task.moodleServer);
    if (!matchSess) {
      alert('No se encontró una sesión activa para esta cuenta. Por favor vuelve a conectar la cuenta.');
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
        const w = window.open(urlObj, '_blank');
        if (!w) {
          const a = document.createElement('a');
          a.href = urlObj;
          a.target = '_blank';
          a.click();
        }
      } else {
        alert(data.error || 'Error al obtener la página de Moodle.');
      }
    } catch (err) {
      console.error('Error viewing HTML:', err);
      alert('Error de red al intentar cargar la página.');
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

      {/* Navigation Top Header */}
      <nav id="navbar-top-wrapper" className="relative sticky top-0 bg-white/80 backdrop-blur-md border-b border-gray-100 z-40">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3.5 flex items-center justify-between">
          
          {/* Logo Name */}
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-600 rounded-xl text-white shadow-xs">
              <Calendar className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900 leading-tight">Moodle Agenda</h1>
              <p className="text-[10px] text-gray-400 font-medium">Gestor de Aula Virtual Moodle</p>
            </div>
          </div>

          {/* Connection badge status & Notifications bell */}
          <div className="flex items-center space-x-4">
            {sessions.length > 0 ? (
              <div className="hidden md:flex flex-wrap items-center gap-1.5">
                {sessions.map((sess, idx) => (
                  <div 
                    key={idx}
                    onClick={() => {
                      setActiveSessionIndex(idx);
                      setActiveTab('browser');
                    }}
                    className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer select-none transition-all ${
                      idx === activeSessionIndex
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                    }`}
                    title={`Hacer activo: ${sess.username}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${idx === activeSessionIndex ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'}`}></span>
                    <span>{sess.username} ({sess.server === 'upsdt' ? 'UPSDT' : (sess.server === 'a' ? 'UNEMI P/S' : 'UNEMI Online')})</span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="hidden md:flex items-center space-x-1 text-xs text-gray-400 bg-gray-50 border border-gray-100 px-3 py-1 rounded-full">
                Moodle Desconectado
              </span>
            )}

            {/* Notification Bell Icon & dropdown */}
            <div className="relative">
              <button 
                type="button"
                onClick={() => setIsNotifOpen(!isNotifOpen)}
                className="relative p-2 text-gray-600 hover:text-blue-600 bg-gray-50 hover:bg-blue-100/50 rounded-xl transition-all border border-gray-100 cursor-pointer flex items-center justify-center focus:outline-hidden"
                id="bell-icon-btn"
                title="Notificaciones de cambios"
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
                  id="notifications-popover-panel"
                  className="absolute right-0 mt-2.5 w-80 md:w-96 bg-white border border-gray-150 rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-3 duration-200"
                >
                  {/* Popover Header */}
                  <div className="p-3 bg-gray-50/80 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center space-x-1.5">
                      <span className="p-1 px-1.5 bg-blue-100 text-blue-700 rounded-sm font-bold text-[9px] uppercase tracking-wider">Moodle</span>
                      <h4 className="text-xs font-extrabold text-gray-800">Alertas de Actividades</h4>
                    </div>
                    <div className="flex items-center space-x-2">
                      {notifications.some(n => !n.read) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); markAllNotificationsRead(); }}
                          className="text-[9px] text-blue-600 hover:text-blue-700 font-bold hover:underline cursor-pointer whitespace-nowrap"
                        >
                          Marcar leídas
                        </button>
                      )}
                      {notifications.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); clearAllNotifications(); }}
                          className="text-[9px] text-gray-400 hover:text-rose-600 font-bold hover:underline cursor-pointer whitespace-nowrap"
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Popover List */}
                  <div className="max-h-[300px] overflow-y-auto divide-y divide-gray-100">
                    {notifications.length === 0 ? (
                      <div className="p-8 text-center space-y-2">
                        <div className="mx-auto w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
                          <BellOff className="w-4 h-4 text-gray-400" />
                        </div>
                        <p className="text-[11px] text-gray-500 font-bold">¡Sin notificaciones!</p>
                        <p className="text-[10px] text-gray-400 leading-normal">Aquí se anunciarán los cambios en tus materias cada vez que sincronices.</p>
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
                        }

                        return (
                          <div 
                            key={notif.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              markNotificationRead(notif.id);
                              if (notif.activityUrl) {
                                const matchingSessIdx = sessions.findIndex(s => s.username.toLowerCase() === notif.moodleUsername.toLowerCase() && s.server === notif.moodleServer);
                                if (matchingSessIdx !== -1) {
                                  setActiveSessionIndex(matchingSessIdx);
                                  setMoodleNavigation({ courseId: '', activityUrl: notif.activityUrl });
                                  setActiveTab('browser');
                                  setIsNotifOpen(false);
                                }
                              }
                            }}
                            className={`p-3 flex items-start space-x-2.5 cursor-pointer hover:bg-gray-50 transition-all border-l-3 ${borderLeft} ${notif.read ? 'bg-white opacity-60' : bgClass}`}
                          >
                            <div className="text-sm shrink-0 select-none mt-0.5">{icon}</div>
                            <div className="space-y-0.5 overflow-hidden min-w-0 flex-1">
                              <p className={`text-[11px] leading-tight text-gray-800 ${notif.read ? 'font-medium' : 'font-extrabold'}`}>
                                {notif.title}
                              </p>
                              <p className="text-[10px] text-gray-500 leading-snug break-words font-medium">
                                {notif.message}
                              </p>
                              <div className="flex items-center space-x-1.5 text-[9px] font-bold text-gray-400 mt-1">
                                <span>{getRelativeNotifTime(notif.timestamp)}</span>
                                <span>•</span>
                                <span className="uppercase text-[8px] bg-gray-100 text-gray-600 px-1 py-0.2 rounded-xs">
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
                    <p className="text-[9px] text-gray-400 font-semibold">Alertas Inteligentes Moodle</p>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </nav>

      {/* Main Container Grid layout */}
      <main className="max-w-7xl mx-auto px-4 md:px-6 mt-6 relative z-10 space-y-6">
        
        <div id="analytics-grid-row" className="bg-white border border-gray-150/40 rounded-3xl p-5 md:p-6 shadow-2xs grid grid-cols-1 md:grid-cols-12 gap-5 items-stretch">
          
          <div className="md:col-span-5 space-y-2.5 flex flex-col justify-center">
            <div className="flex items-center space-x-1.5 text-blue-600 text-[11px] font-bold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Sincronizador Inteligente Multi-Cuenta</span>
            </div>
            <h2 className="text-sm md:text-base font-extrabold text-gray-900 leading-snug">Sincronizador de Materias</h2>
            
            {/* Sync control block */}
            <div className="p-3.5 bg-slate-50 border border-slate-100 rounded-2xl space-y-2 shadow-2xs max-w-md w-full">
              {globalSync.status === 'idle' && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-gray-500 font-medium">Sincroniza todas las materias de tus {sessions.length} cuentas en segundo plano.</p>
                  <button
                    type="button"
                    onClick={() => startGlobalSync()}
                    disabled={sessions.length === 0}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition-all shadow-xs active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-white shrink-0" />
                    <span>Sincronizar Todas las Materias</span>
                  </button>
                  {sessions.length === 0 && (
                    <p className="text-[9px] text-rose-500 font-bold text-center">⚠️ Conecta una cuenta para habilitar la sincronización.</p>
                  )}
                </div>
              )}

              {globalSync.status === 'syncing' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 min-w-0">
                      <span className="text-[10px] font-extrabold text-blue-600 uppercase tracking-wider shrink-0 animate-pulse">Sincronizando...</span>
                      {globalSync.logs && globalSync.logs.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowSyncLogs(!showSyncLogs)}
                          className="text-[9px] text-gray-400 hover:text-gray-600 font-bold hover:underline cursor-pointer focus:outline-hidden shrink-0 normal-case"
                        >
                          {showSyncLogs ? '(ocultar)' : '(ver proceso)'}
                        </button>
                      )}
                    </div>
                    <span className="text-[11px] font-mono font-bold text-gray-600 shrink-0">{globalSync.processedCount} de {globalSync.totalCount || '?'}</span>
                  </div>
                  <div className="w-full bg-blue-100/40 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className="bg-blue-600 h-full rounded-full transition-all duration-300"
                      style={{ width: `${globalSync.totalCount > 0 ? (globalSync.processedCount / globalSync.totalCount) * 100 : 10}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-gray-500 leading-tight space-y-0.5">
                    <p className="font-semibold text-gray-700 truncate">Materia: <span className="font-extrabold text-slate-800">{globalSync.currentCourse || 'Descubriendo...'}</span></p>
                    <p className="italic truncate text-slate-500">Detalle: {globalSync.currentActivity || 'Buscando actividades...'}</p>
                  </div>
                  <div className="flex space-x-1.5 pt-1">
                    <button
                      type="button"
                      onClick={pauseGlobalSync}
                      className="flex-1 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 text-[10px] font-bold rounded-lg cursor-pointer transition-all text-center"
                    >
                      Pausar
                    </button>
                    <button
                      type="button"
                      onClick={cancelGlobalSync}
                      className="flex-1 py-1 bg-red-50 hover:bg-red-100 border border-red-200 text-red-800 text-[10px] font-bold rounded-lg cursor-pointer transition-all text-center"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {globalSync.status === 'paused' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center space-x-1.5 min-w-0">
                      <span className="font-extrabold text-amber-600 uppercase shrink-0">Sincronización Pausada</span>
                      {globalSync.logs && globalSync.logs.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowSyncLogs(!showSyncLogs)}
                          className="text-[9px] text-gray-400 hover:text-gray-600 font-bold hover:underline cursor-pointer focus:outline-hidden shrink-0 normal-case"
                        >
                          {showSyncLogs ? '(ocultar)' : '(ver proceso)'}
                        </button>
                      )}
                    </div>
                    <span className="font-mono text-gray-500 shrink-0">{globalSync.processedCount} de {globalSync.totalCount}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => startGlobalSync()}
                    className="w-full py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-bold flex items-center justify-center space-x-1.5 cursor-pointer transition-all"
                  >
                    <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                    <span>Reanudar Sincronización</span>
                  </button>
                  <button
                    type="button"
                    onClick={cancelGlobalSync}
                    className="w-full py-1 border border-red-200 text-red-600 hover:bg-red-50 text-[9px] font-bold rounded-lg cursor-pointer text-center"
                  >
                    Reiniciar de Cero
                  </button>
                </div>
              )}

              {globalSync.status === 'interrupted' && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <p className="text-[11px] text-red-600 font-extrabold flex items-center gap-1.5">
                      <span>⚠️ ¡Sincronización Interrumpida!</span>
                      {globalSync.logs && globalSync.logs.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowSyncLogs(!showSyncLogs)}
                          className="text-[9px] text-gray-400 normal-case hover:text-gray-600 font-bold hover:underline cursor-pointer focus:outline-hidden"
                        >
                          {showSyncLogs ? '(ocultar proceso)' : '(ver proceso)'}
                        </button>
                      )}
                    </p>
                    <p className="text-[10px] text-gray-500 leading-normal">Se detectó que la sincronización previa fue interrumpida. Puedes reanudarla desde donde se quedó para ahorrar tiempo.</p>
                  </div>
                  <div className="flex space-x-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => startGlobalSync()}
                      className="flex-grow py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-extrabold rounded-lg flex items-center justify-center space-x-1 cursor-pointer transition-all shadow-2xs"
                    >
                      <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                      <span>Reanudar ({globalSync.processedCount} / {globalSync.totalCount})</span>
                    </button>
                    <button
                      type="button"
                      onClick={cancelGlobalSync}
                      className="py-1.5 px-3 border border-red-200 text-red-700 hover:bg-red-50 text-[10px] font-bold rounded-lg cursor-pointer transition-all"
                    >
                      Reiniciar
                    </button>
                  </div>
                </div>
              )}

              {globalSync.status === 'completed' && (
                <div className="space-y-2 text-left">
                  <div className="space-y-1">
                    <p className="text-[11px] text-emerald-600 font-extrabold flex items-center gap-1.5 font-sans leading-none">
                      <span className="inline-block w-2 bg-emerald-500 rounded-full animate-pulse h-2 shrink-0" />
                      <span>¡Todas las materias actualizadas!</span>
                      {globalSync.logs && globalSync.logs.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowSyncLogs(!showSyncLogs)}
                          className="text-[9px] text-gray-450 normal-case hover:text-gray-600 font-bold hover:underline cursor-pointer focus:outline-hidden ml-1"
                        >
                          {showSyncLogs ? '(ocultar)' : '(ver proceso)'}
                        </button>
                      )}
                    </p>
                    {lastSyncedTime && (
                      <p className="text-[9px] text-slate-500 font-bold leading-normal">
                        Última sincronización completa {syncedAccountsCount !== null ? `(${syncedAccountsCount} cuenta${syncedAccountsCount !== 1 ? 's' : ''} sincronizada${syncedAccountsCount !== 1 ? 's' : ''})` : ''}: {getRelativeLastSyncedTime()}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => startGlobalSync()}
                    className="w-full py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-[10px] font-bold rounded-xl cursor-pointer transition-all flex items-center justify-center space-x-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span>Actualizar todo de nuevo</span>
                  </button>
                </div>
              )}

              {globalSync.status === 'failed' && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <p className="text-[11px] text-rose-600 font-extrabold flex items-center gap-1.5 leading-none">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      <span>Sincronización Fallida</span>
                      {globalSync.logs && globalSync.logs.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowSyncLogs(!showSyncLogs)}
                          className="text-[9px] text-gray-400 normal-case hover:text-gray-600 font-bold hover:underline cursor-pointer focus:outline-hidden ml-1"
                        >
                          {showSyncLogs ? '(ocultar)' : '(ver proceso)'}
                        </button>
                      )}
                    </p>
                    <p className="text-[10px] text-slate-500 leading-normal bg-rose-50/70 border border-rose-100 rounded-xl p-2.5 font-medium">
                      {globalSync.currentActivity || 'No se pudo contactar con las aulas virtuales.'}
                    </p>
                  </div>
                  <div className="flex space-x-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => startGlobalSync()}
                      className="flex-grow py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-extrabold rounded-lg flex items-center justify-center space-x-1 cursor-pointer transition-all shadow-2xs"
                    >
                      <RefreshCw className="w-3 h-3 shrink-0" />
                      <span>Reintentar</span>
                    </button>
                    <button
                      type="button"
                      onClick={cancelGlobalSync}
                      className="py-1.5 px-3 border border-gray-200 text-gray-700 hover:bg-gray-50 text-[10px] font-bold rounded-lg cursor-pointer transition-all"
                    >
                      Cerrar
                    </button>
                  </div>
                </div>
              )}
              
              {/* Registro de rendimiento y tiempos detailed container */}
              {showSyncLogs && globalSync.logs && globalSync.logs.length > 0 && (
                <div className="mt-3.5 p-3 bg-slate-900 border border-slate-950 text-slate-100 rounded-2xl shadow-inner space-y-2 font-mono text-[10px]">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="font-extrabold text-[9px] text-slate-400 flex items-center gap-1.5">
                      <span className="inline-block w-2 bg-blue-500 rounded-full animate-ping h-2 shrink-0" />
                      REGISTRO DE RENDIMIENTO
                    </span>
                    <span className="text-[9px] text-slate-500 font-extrabold">
                      {globalSync.logs.length} ENTRADAS
                    </span>
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800 scrolling-touch pr-1">
                    {globalSync.logs.map((log, idx) => {
                      let badgeColor = "text-blue-400 bg-blue-950/40";
                      if (log.type === 'success') { badgeColor = "text-emerald-400 bg-emerald-950/40"; }
                      if (log.type === 'warn') { badgeColor = "text-amber-400 bg-amber-950/30"; }
                      if (log.type === 'error') { badgeColor = "text-rose-400 bg-rose-950/40"; }
                      if (log.type === 'performance') { badgeColor = "text-purple-400 bg-purple-950/30"; }

                      return (
                        <div key={idx} className="flex items-start space-x-1.5 py-0.5 border-b border-slate-800/10 last:border-0 leading-normal">
                          <span className="text-slate-500 shrink-0 font-light select-none">{log.timestamp}</span>
                          <span className={`px-1 rounded-sm text-[8px] font-bold tracking-wider shrink-0 select-none uppercase ${badgeColor}`}>
                            {log.type}
                          </span>
                          <span className="flex-1 text-slate-300 font-sans break-words whitespace-pre-wrap">{log.message}</span>
                          {log.durationMs !== undefined && (
                            <span className="px-1 py-0.5 rounded-sm bg-slate-800/80 text-[8.5px] font-bold text-amber-500 shrink-0 select-none">
                              {log.durationMs >= 1000 ? `${(log.durationMs / 1000).toFixed(2)}s` : `${log.durationMs}ms`}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Columna Derecha: Indicador de emojis superior y Estadísticas alineadas */}
          <div className="md:col-span-7 flex flex-col justify-between space-y-4">
            
            {/* Guía de Indicadores de Actividades */}
            <div className="bg-slate-50/60 border border-slate-100 rounded-2xl p-4 space-y-2.5">
              <span className="font-extrabold text-gray-400 uppercase tracking-widest text-[9px] flex items-center gap-1.5 select-none font-sans leading-none">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                Guía de Indicadores de Actividades
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2 text-[9.5px] font-bold text-gray-500 select-none">
                <div className="flex items-center space-x-1.5">
                  <span className="text-sm shrink-0">🔥</span>
                  <span className="truncate">Inminente {"(<30h)"}</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-sm shrink-0">😄</span>
                  <span className="text-emerald-600 truncate">Excelente (≥90%)</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-sm shrink-0">💪</span>
                  <span className="truncate">Pendiente {"(<10d)"}</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-sm shrink-0">🙂</span>
                  <span className="text-blue-650 truncate">Aceptable (80-89%)</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-sm shrink-0">⏱️</span>
                  <span className="truncate">Entregado {"(Sin nota)"}</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-sm shrink-0">😢</span>
                  <span className="text-amber-600 truncate">Regular (60-79%)</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-sm shrink-0">☠️</span>
                  <span className="truncate">Vencido</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-sm shrink-0">👎</span>
                  <span className="text-rose-600 truncate">Reprobado {"(<60%)"}</span>
                </div>
                <div className="flex items-center space-x-1.5 col-span-2 sm:col-span-1 text-[8.5px] text-slate-400 font-extrabold uppercase tracking-wider">
                  <span className="text-sm shrink-0 select-none">⚠️</span>
                  <span className="truncate">Cierre Atípico (Sin fecha)</span>
                </div>
              </div>
            </div>

            {/* Dos cuadros estadísticos con el mismo ancho */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full items-stretch animate-fade-in">
              {/* Stat 1: Completed Rate */}
              <div className="bg-gray-50/50 border border-gray-100 rounded-2xl p-4 flex items-center space-x-4 h-full">
                <div className={`p-3 rounded-xl shrink-0 ${percentComplete === 100 ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50/60 text-blue-600'}`}>
                  <Award className="w-5 h-5 stroke-[1.8]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline">
                    <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Cumplimiento</span>
                    <span className="text-xs font-bold text-gray-800">{percentComplete}%</span>
                  </div>
                  <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden mt-1.5">
                    <div 
                      className={`h-full rounded-full transition-all duration-300 ${percentComplete === 100 ? 'bg-emerald-500' : 'bg-blue-600'}`} 
                      style={{ width: `${percentComplete}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1.5 leading-none">
                    {completedTasks} completadas • {pendingTasks} pendientes
                  </p>
                </div>
              </div>

              {/* Stat 2: Connection details */}
              <div className="bg-gray-50/50 border border-gray-100 rounded-2xl p-4 flex items-center space-x-3 h-full">
                <div className={`p-3 rounded-xl shrink-0 ${session ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50/70 text-amber-600'}`}>
                  <BookOpen className="w-5 h-5 stroke-[1.8]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Materia Mapeadas</p>
                  <h3 className="text-sm font-bold text-gray-800 mt-0.5 truncate">
                    {courses.length > 0 ? `${courses.length} cursos` : '0 materias'}
                  </h3>
                  <p className="text-[10px] text-gray-400 leading-none mt-1 truncate">
                    {session 
                      ? `Origen: ${session.server === 'upsdt' ? 'UPSDT' : (session.server === 'a' ? 'UNEMI Presencial/Semipresencial' : 'UNEMI Online')}` 
                      : 'Conecta tu cuenta Moodle'}
                  </p>
                </div>
              </div>
            </div>

          </div>

        </div>

        {/* Tab selection controls */}
        <div id="tab-controls-root" className="flex border-b border-gray-200 gap-x-2">
          
          <button
            id="tab-agenda-btn"
            onClick={() => setActiveTab('agenda')}
            className={`pb-2.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center space-x-1.5 ${
              activeTab === 'agenda'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
            }`}
          >
            <Calendar className="w-4 h-4 shrink-0" />
            <span>Mi Agenda ({totalTasks})</span>
          </button>

          <button
            id="tab-browser-btn"
            onClick={() => {
              if (sessions.length === 0) {
                setActiveTab('login');
              } else {
                setActiveTab('browser');
              }
            }}
            className={`pb-2.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center space-x-1.5 ${
              activeTab === 'browser'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
            }`}
          >
            <BookOpen className="w-4 h-4 shrink-0" />
            <span>Explorar Moodle</span>
            {sessions.length === 0 && (
              <span className="text-[9px] font-bold bg-amber-50 text-amber-600 border border-amber-100 rounded px-1 ml-1 scale-90">
                Bloqueado
              </span>
            )}
          </button>

          <button
            id="tab-login-btn"
            onClick={() => setActiveTab('login')}
            className={`pb-2.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center space-x-1.5 ${
              activeTab === 'login'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
            }`}
          >
            <Lock className="w-4 h-4 shrink-0" />
            <span>{sessions.length > 0 ? `Mis Conexiones (${sessions.length})` : 'Conectar Moodle'}</span>
          </button>

          <button
            id="tab-stats-btn"
            onClick={() => setActiveTab('stats')}
            className={`pb-2.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center space-x-1.5 ${
              activeTab === 'stats'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
            }`}
          >
            <BarChart3 className="w-4 h-4 shrink-0" />
            <span>Mis Stats</span>
          </button>

        </div>

        {/* Workspace Display */}
        <div id="workspace-tab-display" className="space-y-6">
          
          {/* TAB 1: AGENDA (Timeline) */}
          {activeTab === 'agenda' && (
            <ActivityTimeline
              tasks={tasks}
              onToggleComplete={onToggleComplete}
              onDeleteTask={onDeleteTask}
              onOpenNewTaskModal={() => setIsNewTaskModalOpen(true)}
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
                setMoodleNavigation({ courseId, activityUrl });
                setActiveTab('browser');
              }}
              onClearAgenda={onClearAgenda}
              navigationTrigger={agendaNavigation}
              onClearNavigationTrigger={() => setAgendaNavigation(null)}
              onRefreshSingleTask={handleUpdateSingleTask}
              syncingTaskId={syncingTaskId}
              onDownloadHtml={handleDownloadHtml}
              onViewHtml={handleViewHtml}
              filterCourseIdTrigger={timelineFilterCourseId}
              onClearFilterCourseIdTrigger={() => setTimelineFilterCourseId(null)}
            />
          )}

          {/* TAB 2: MOODLE BROWSER */}
          {activeTab === 'browser' && (
            <div className="space-y-4">
              {/* Elegant accounts / active browsers tab list */}
              <div id="moodle-browser-tabs" className="flex flex-wrap items-center bg-gray-100/70 p-2 rounded-2xl gap-2 border border-gray-200/50 shadow-3xs">
                <span className="text-[10px] uppercase font-bold text-gray-500 px-2 tracking-wider">
                  Navegadores Activos:
                </span>
                {sessions.map((sess, idx) => (
                  <button
                    key={`${sess.username}-${sess.server}-${idx}`}
                    onClick={() => setActiveSessionIndex(idx)}
                    className={`flex items-center space-x-2 py-1.5 px-3.5 rounded-xl text-xs font-bold border transition-all duration-150 cursor-pointer ${
                      activeSessionIndex === idx
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span className="truncate max-w-[120px] font-mono">{sess.username}</span>
                    <span className="text-[9px] opacity-75 font-mono px-1 bg-black/10 rounded uppercase">
                      {sess.server === 'upsdt' ? 'UPSDT' : (sess.server === 'a' ? 'UNEMI P/S' : 'UNEMI Online')}
                    </span>
                  </button>
                ))}

                <button
                  onClick={() => {
                    setPrefillLogin(null);
                    setActiveTab('login');
                  }}
                  className="flex items-center space-x-1 py-1.5 px-3 rounded-xl text-xs font-bold border border-dashed border-gray-300 bg-white text-gray-500 hover:text-blue-600 hover:border-blue-600 cursor-pointer transition-all duration-150"
                  title="Conectar otra cuenta en un navegador nuevo"
                >
                  <span className="font-semibold text-xs">+</span>
                  <span>Nueva Cuenta</span>
                </button>
              </div>

              {/* Render all browsers, showing only the active one */}
              {sessions.map((sess, idx) => (
                <div 
                  key={`${sess.username}-${sess.server}-${idx}`}
                  style={{ display: activeSessionIndex === idx ? 'block' : 'none' }}
                >
                  <MoodleBrowser
                    session={sess}
                    existingTaskUrls={tasks.filter(t => t.activityUrl).map(t => t.activityUrl as string)}
                    tasks={tasks}
                    onImportTasks={handleImportTasks}
                    navigationTrigger={activeSessionIndex === idx ? moodleNavigation : null}
                    onClearNavigationTrigger={activeSessionIndex === idx ? () => setMoodleNavigation(null) : undefined}
                    onNavigateToAgendaActivity={(activityUrl) => {
                      setAgendaNavigation(activityUrl);
                      setActiveTab('agenda');
                    }}
                    onSessionError={(sess, msg) => handleSessionError(sess, msg, false)}
                    onGoToConnections={() => setActiveTab('login')}
                  />
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: LOGIN PANEL */}
          {activeTab === 'login' && (
            <div className="max-w-md mx-auto space-y-4">
              <LoginPanel
                onLoginSuccess={handleLoginSuccess}
                activeSession={null}
                onLogout={handleLogout}
                prefillUsername={prefillLogin?.username}
                prefillServer={prefillLogin?.server}
                loginErrorMessage={prefillLogin?.errorMsg}
              />

              {sessions.length > 0 && (
                <div className="bg-white border border-gray-150/40 rounded-2xl p-5 shadow-xs space-y-3">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Cuentas Conectadas ({sessions.length})</h3>
                    {isVerifyingSessions && (
                      <span className="text-[10px] text-blue-650 font-extrabold animate-pulse flex items-center space-x-1">
                        <RefreshCw className="w-3 h-3 shrink-0 animate-spin" />
                        <span>Verificando sesión...</span>
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {sessions.map((sess, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-100 rounded-xl">
                        <div className="flex items-center space-x-2.5 min-w-0">
                          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            sess.expired 
                              ? 'bg-rose-500' 
                              : idx === activeSessionIndex 
                                ? 'bg-emerald-500 animate-pulse' 
                                : 'bg-emerald-400'
                          }`}></span>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-gray-800 truncate font-mono">{sess.username}</p>
                            <p className="text-[10px] text-gray-400 capitalize">
                              {sess.server === 'upsdt' ? 'UPSDT' : (sess.server === 'a' ? 'UNEMI Presencial/Semipresencial' : 'UNEMI Online')}{' '}
                              {sess.expired ? (
                                <span className="text-rose-500 font-semibold">(Sesión Expirada)</span>
                              ) : (
                                idx === activeSessionIndex ? '(Navegador Actual)' : ''
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          {sess.expired ? (
                            <button
                              onClick={() => {
                                setPrefillLogin({
                                  username: sess.username,
                                  server: sess.server,
                                  errorMsg: 'Por favor, ingresa tus datos de acceso para volver a conectar tu cuenta.'
                                });
                                setActiveTab('login');
                              }}
                              className="text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer mr-1"
                            >
                              Reconectar
                            </button>
                          ) : (
                            idx !== activeSessionIndex && (
                              <button
                                onClick={() => {
                                  setActiveSessionIndex(idx);
                                  setActiveTab('browser');
                                }}
                                className="text-[10px] font-semibold text-blue-600 hover:bg-blue-50 hover:text-blue-700 px-2.5 py-1 rounded-lg border border-blue-100 transition-colors cursor-pointer"
                              >
                                Ver navegador
                              </button>
                            )
                          )}
                          <button
                            onClick={() => {
                              const updated = sessions.filter((_, sIdx) => sIdx !== idx);
                              setSessions(updated);
                              localStorage.setItem('unemi_sessions', JSON.stringify(updated));
                              if (updated.length === 0) {
                                setActiveSessionIndex(0);
                                setActiveTab('login');
                              } else if (activeSessionIndex >= updated.length) {
                                setActiveSessionIndex(updated.length - 1);
                              }
                            }}
                            className="text-[10px] font-semibold text-red-600 hover:bg-red-50 hover:text-red-700 px-2.5 py-1 rounded-lg border border-red-100 transition-colors cursor-pointer"
                          >
                            {sess.expired ? 'Quitar Cuenta' : 'Cerrar Sesión'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: STATISTICS PANEL */}
          {activeTab === 'stats' && (
            <StatsPanel 
              tasks={tasks} 
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
                setMoodleNavigation({ courseId, activityUrl });
                setActiveTab('browser');
              }}
              onViewUpcomingActivities={(courseId) => {
                setTimelineFilterCourseId(courseId);
                setActiveTab('agenda');
              }}
            />
          )}

        </div>

      </main>

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
