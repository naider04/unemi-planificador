import React, { useState, useEffect } from 'react';
import { 
  Calendar, Layers, Lock, BookOpen, Award, CheckCircle2, 
  Sparkles, Clock, AlertCircle, Bookmark, CheckSquare, Eye, RefreshCw, Download 
} from 'lucide-react';

import { MoodleSession, TodoTask, Course } from './types';
import LoginPanel from './components/LoginPanel';
import MoodleBrowser from './components/MoodleBrowser';
import ActivityTimeline from './components/ActivityTimeline';
import NewTaskModal from './components/NewTaskModal';

export default function App() {
  const [sessions, setSessions] = useState<MoodleSession[]>([]);
  const [activeSessionIndex, setActiveSessionIndex] = useState<number>(0);
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [activeTab, setActiveTab] = useState<'agenda' | 'browser' | 'login'>('agenda');
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [moodleNavigation, setMoodleNavigation] = useState<{ courseId: string; activityUrl: string } | null>(null);
  const [agendaNavigation, setAgendaNavigation] = useState<string | null>(null);
  const [prefillLogin, setPrefillLogin] = useState<{ username: string; server: 'a' | 'b'; errorMsg: string } | null>(null);

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
      server: 'a' | 'b';
      courseId: string;
      courseName: string;
      activityUrl: string;
      type: 'TAREA' | 'CUESTIONARIO';
      activityName: string;
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

  const session = sessions[activeSessionIndex] || null;

  // 1. Initial Load from LocalStorage
  useEffect(() => {
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
      if (cachedTasks) {
        let loadedTasks: TodoTask[] = JSON.parse(cachedTasks);

        // GMT-5 Timezone Migration for legacy tasks to fix a +5 hours difference
        const hasMigrated = localStorage.getItem('unemi_tz_migrated_v3');
        if (!hasMigrated) {
          loadedTasks = loadedTasks.map(task => {
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

        // Defensive: clear false activity and update
        loadedTasks = loadedTasks.filter(t => t.id !== 'welcome-1');
        localStorage.setItem('unemi_tasks', JSON.stringify(loadedTasks));
        setTasks(loadedTasks);
      } else {
        // Welcoming introductory tasks
        setTasks([
          {
            id: 'welcome-2',
            title: 'O agrega tareas manuales',
            type: 'MANUAL',
            description: 'Puedes pulsar el botón "Nueva Actividad" para agendar tus estudios, exámenes o recordatorios personales.',
            closureDate: null,
            completed: false,
            createdAt: new Date().toISOString()
          }
        ]);
      }

      // Restore Global Sync State
      const cachedSync = localStorage.getItem('unemi_global_sync_state');
      if (cachedSync) {
        try {
          const parsed = JSON.parse(cachedSync);
          if (parsed.status === 'syncing') {
            // An active sync was interrupted by page reload
            parsed.status = 'interrupted';
            localStorage.setItem('unemi_global_sync_state', JSON.stringify(parsed));
          }
          setGlobalSync(parsed);
        } catch (e) {
          console.error('Error recovering global sync state cache:', e);
        }
      }
    } catch (err) {
      console.error('Error loading localStorage keys:', err);
    }
  }, []);

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
      }
    } catch (err) {
      console.error('Error fetching courses cache list:', err);
    }
  };

  // 2. State Actions handlers
  const handleLoginSuccess = (newSession: MoodleSession) => {
    const existsIdx = sessions.findIndex(
      s => s.username.toLowerCase() === newSession.username.toLowerCase() && s.server === newSession.server
    );
    let updatedSessions = [...sessions];
    if (existsIdx !== -1) {
      updatedSessions[existsIdx] = newSession;
    } else {
      updatedSessions.push(newSession);
    }
    setSessions(updatedSessions);
    localStorage.setItem('unemi_sessions', JSON.stringify(updatedSessions));
    
    const idx = updatedSessions.findIndex(
      s => s.username.toLowerCase() === newSession.username.toLowerCase() && s.server === newSession.server
    );
    setActiveSessionIndex(idx !== -1 ? idx : updatedSessions.length - 1);
    setActiveTab('browser'); // take them to Moodle browser immediately
    setPrefillLogin(null); // Clear any active reconnect/prefill error values
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

  const handleSessionError = (failedSession: MoodleSession, rawMsg: string) => {
    let friendlyMsg = 'Tu sesión en el aula virtual de UNEMI ha expirado o se ha cerrado.';
    if (rawMsg.toLowerCase().includes('fetch failed')) {
      friendlyMsg = 'Sesión cerrada o error de conexión de red (Fetch failed). Vuelve a conectar tu cuenta para re-autenticarte.';
    } else if (rawMsg) {
      friendlyMsg = `Se interrumpió la conexión (${rawMsg}). Por favor, ingresa tus datos de acceso nuevamente en el Classroom de UNEMI.`;
    }

    setPrefillLogin({
      username: failedSession.username,
      server: failedSession.server,
      errorMsg: friendlyMsg
    });

    setActiveTab('login');
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
    const updated = [newTask, ...tasks];
    setTasks(updated);
    localStorage.setItem('unemi_tasks', JSON.stringify(updated));
  };

  // Global Sync Engine Implementation (Resumeable Background Handler)
  const startGlobalSync = async (resumeQueue?: typeof globalSync.queue) => {
    if (sessions.length === 0) {
      alert('Por favor conecta al menos una cuenta de Moodle para poder sincronizar.');
      return;
    }

    let workingQueue: typeof globalSync.queue = [];
    let initialCount = 0;
    let initialProcessed = 0;

    if (resumeQueue && resumeQueue.length > 0) {
      workingQueue = [...resumeQueue];
      initialCount = globalSync.totalCount || resumeQueue.length;
      initialProcessed = globalSync.processedCount || 0;
      setGlobalSync(prev => {
        const nextState = { ...prev, status: 'syncing' as const };
        localStorage.setItem('unemi_global_sync_state', JSON.stringify(nextState));
        return nextState;
      });
    } else {
      setGlobalSync({
        status: 'syncing',
        currentCourse: 'Mapeando materias...',
        currentActivity: 'Buscando actividades...',
        processedCount: 0,
        totalCount: 0,
        queue: []
      });

      const coursesBySession: { sessIdx: number; courses: Course[] }[] = [];
      for (let sIdx = 0; sIdx < sessions.length; sIdx++) {
        const sess = sessions[sIdx];
        try {
          const apiBase = import.meta.env.VITE_API_URL || '';
          const res = await fetch(`${apiBase}/api/moodle/courses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              moodleSession: sess.cookies,
              server: sess.server
            })
          });
          const data = await res.json();
          if (res.ok && data.courses) {
            coursesBySession.push({ sessIdx: sIdx, courses: data.courses });
          }
        } catch (e) {
          console.error(`Failed courses fetch for ${sess.username} during global sync:`, e);
        }
      }

      for (const coursesObj of coursesBySession) {
        const sess = sessions[coursesObj.sessIdx];
        for (const course of coursesObj.courses) {
          setGlobalSync(prev => ({
            ...prev,
            currentCourse: `${sess.username}: ${course.text}`,
            currentActivity: 'Escaneando tareas/cuestionarios...'
          }));
          try {
            const apiBase = import.meta.env.VITE_API_URL || '';
            const res = await fetch(`${apiBase}/api/moodle/course-activities`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                moodleSession: sess.cookies,
                server: sess.server,
                courseUrl: course.url
              })
            });
            const data = await res.json();
            if (res.ok && data.activities) {
              const actionable = data.activities.filter((act: any) => act.type === 'TAREA' || act.type === 'CUESTIONARIO');
              actionable.forEach((act: any) => {
                workingQueue.push({
                  sessionIndex: coursesObj.sessIdx,
                  username: sess.username,
                  server: sess.server,
                  courseId: course.id,
                  courseName: course.text,
                  activityUrl: act.url,
                  type: act.type,
                  activityName: act.name
                });
              });
            }
          } catch (e) {
            console.error(`Failed course activities fetch for ${sess.username} - ${course.text}:`, e);
          }
        }
      }

      initialCount = workingQueue.length;
      if (initialCount === 0) {
        setGlobalSync({
          status: 'completed',
          currentCourse: 'Terminado',
          currentActivity: 'No se encontraron actividades formativas.',
          processedCount: 0,
          totalCount: 0,
          queue: []
        });
        localStorage.setItem('unemi_global_sync_state', JSON.stringify({
          status: 'completed',
          currentCourse: 'Terminado',
          currentActivity: 'No se encontraron actividades.',
          processedCount: 0,
          totalCount: 0,
          queue: [],
          lastActive: Date.now()
        }));
        return;
      }

      setGlobalSync(prev => ({
        ...prev,
        totalCount: initialCount,
        queue: workingQueue
      }));
    }

    let processed = initialProcessed;
    let isInterrupted = false;

    // Helper to compute task stats locally
    const computeStatsLocal = (type: string, details: any) => {
      let status = 'No entregado';
      let grade: string | null = null;
      let gradeOver: string | null = null;

      if (details.por_hacer_calificacion) {
        return { status: 'No entregado', grade: null, gradeOver: null };
      }

      if (type === 'CUESTIONARIO') {
        if (details.quiz_info) {
          const qi = details.quiz_info;
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
          } else if (details.hecho_calificacion) {
            status = 'Entregado';
          }
        } else if (details.hecho_calificacion) {
          status = 'Entregado';
        }
      } else if (type === 'TAREA') {
        const isCalificado = details.estado_calificacion?.toLowerCase().includes('calificado') || !!details.calificacion;
        if (isCalificado) {
          status = 'Calificado';
          grade = details.calificacion || null;
          gradeOver = details.calificacion_sobre || null;
        } else if (
          details.estado_entrega && (
            details.estado_entrega.toLowerCase().includes('enviado') ||
            details.estado_entrega.toLowerCase().includes('entregado')
          )
        ) {
          status = 'Entregado';
        } else {
          const estEntrega = details.estado_entrega?.toLowerCase() || '';
          if (estEntrega.includes('borrador')) {
            status = 'Borrador';
          } else if (estEntrega.includes('no entregado') || estEntrega.includes('sin entregar') || estEntrega.includes('no se ha enviado')) {
            status = 'No entregado';
          } else if (details.hecho_calificacion) {
            status = 'Entregado';
          } else {
            status = 'No entregado';
          }
        }
      }
      return { status, grade, gradeOver };
    };

    while (workingQueue.length > 0) {
      const currentPersistedStateStr = localStorage.getItem('unemi_global_sync_state');
      if (currentPersistedStateStr) {
        const cps = JSON.parse(currentPersistedStateStr);
        if (cps.status === 'paused' || cps.status === 'interrupted') {
          isInterrupted = true;
          break;
        }
      }

      const currentItem = workingQueue.shift()!;
      const sess = sessions[currentItem.sessionIndex];
      if (!sess) {
        processed++;
        continue;
      }

      setGlobalSync(prev => ({
        ...prev,
        currentCourse: currentItem.courseName,
        currentActivity: currentItem.activityName,
        processedCount: processed,
        queue: [...workingQueue]
      }));

      localStorage.setItem('unemi_global_sync_state', JSON.stringify({
        status: 'syncing',
        currentCourse: currentItem.courseName,
        currentActivity: currentItem.activityName,
        processedCount: processed,
        totalCount: initialCount,
        queue: workingQueue,
        lastActive: Date.now()
      }));

      try {
        const apiBase = import.meta.env.VITE_API_URL || '';
        const res = await fetch(`${apiBase}/api/moodle/activity-details`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            moodleSession: sess.cookies,
            server: sess.server,
            activityUrl: currentItem.activityUrl
          })
        });

        if (res.ok) {
          const data = await res.json();
          if (data.details) {
            const details = data.details;
            const computedStats = computeStatsLocal(currentItem.type, details);
            
            const newTodo: TodoTask = {
              id: `moodle-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
              title: currentItem.activityName,
              courseId: currentItem.courseId,
              courseName: currentItem.courseName,
              activityUrl: currentItem.activityUrl,
              type: currentItem.type,
              description: details.detalle || undefined,
              closureDate: details.closureDateISO || null,
              aperture: details.aperture || null,
              apertureDateISO: details.apertureDateISO || null,
              completed: !details.por_hacer_calificacion && (
                           (details.estado_entrega && (details.estado_entrega.toLowerCase().includes('enviado') || details.estado_entrega.toLowerCase().includes('entregado'))) || 
                           details.quiz_info?.intentos?.some((att: any) => att.estado?.toLowerCase().includes('terminado')) || 
                           (details.hecho_calificacion === true) ||
                           (computedStats.status === 'Calificado' || computedStats.status === 'Entregado') ||
                           false
                         ),
              createdAt: new Date().toISOString(),
              status: computedStats.status,
              grade: computedStats.grade,
              gradeOver: computedStats.gradeOver,
              gradingStatus: details.estado_calificacion || null,
              estado_calificacion: details.estado_calificacion || null,
              estado_entrega: details.estado_entrega || null,
              comentario_calificador: details.comentario_calificador || null,
              advertencia_preguntas: details.advertencia_preguntas || null,
              por_hacer_calificacion: details.por_hacer_calificacion || false,
              hecho_calificacion: details.hecho_calificacion || false,
              grupo: details.grupo || null,
              moodleUsername: currentItem.username,
              moodleServer: currentItem.server,
              lastSyncedAt: new Date().toISOString()
            };

            setTasks(prevTasks => {
              const copy = [...prevTasks];
              const matchIdx = copy.findIndex(t => t.activityUrl === currentItem.activityUrl && currentItem.activityUrl);
              if (matchIdx !== -1) {
                copy[matchIdx] = {
                  ...copy[matchIdx],
                  ...newTodo,
                  id: copy[matchIdx].id
                };
              } else {
                copy.push(newTodo);
              }
              localStorage.setItem('unemi_tasks', JSON.stringify(copy));
              return copy;
            });
          }
        }
      } catch (err) {
        console.error(`Global sync failed detail load:`, err);
      }

      processed++;
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (!isInterrupted) {
      setGlobalSync({
        status: 'completed',
        currentCourse: '',
        currentActivity: '',
        processedCount: initialCount,
        totalCount: initialCount,
        queue: []
      });
      localStorage.setItem('unemi_global_sync_state', JSON.stringify({
        status: 'completed',
        currentCourse: '',
        currentActivity: '',
        processedCount: initialCount,
        totalCount: initialCount,
        queue: [],
        lastActive: Date.now()
      }));
    }
  };

  const pauseGlobalSync = () => {
    setGlobalSync(prev => {
      const newState = { ...prev, status: 'paused' as const };
      localStorage.setItem('unemi_global_sync_state', JSON.stringify({
        ...newState,
        lastActive: Date.now()
      }));
      return newState;
    });
  };

  const cancelGlobalSync = () => {
    setGlobalSync({
      status: 'idle',
      currentCourse: '',
      currentActivity: '',
      processedCount: 0,
      totalCount: 0,
      queue: []
    });
    localStorage.removeItem('unemi_global_sync_state');
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
              } else if (
                det.estado_entrega && (
                  det.estado_entrega.toLowerCase().includes('enviado') ||
                  det.estado_entrega.toLowerCase().includes('entregado')
                )
              ) {
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
                         (details.estado_entrega && (details.estado_entrega.toLowerCase().includes('enviado') || details.estado_entrega.toLowerCase().includes('entregado'))) || 
                         details.quiz_info?.intentos?.some((att: any) => att.estado?.toLowerCase().includes('terminado')) || 
                         (details.hecho_calificacion === true) ||
                         (stats.status === 'Calificado' || stats.status === 'Entregado') ||
                         false
                       ),
            status: stats.status,
            grade: stats.grade,
            gradeOver: stats.gradeOver,
            gradingStatus: details.estado_calificacion || null,
            estado_calificacion: details.estado_calificacion || null,
            estado_entrega: details.estado_entrega || null,
            comentario_calificador: details.comentario_calificador || null,
            advertencia_preguntas: details.advertencia_preguntas || null,
            por_hacer_calificacion: details.por_hacer_calificacion || false,
            hecho_calificacion: details.hecho_calificacion || false,
            grupo: details.grupo || null,
            lastSyncedAt: new Date().toISOString()
          };

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
        alert('No se pudo actualizar de forma remota la actividad seleccionada.');
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
              <h1 className="text-sm font-bold text-gray-900 leading-tight">UNEMI Agenda</h1>
              <p className="text-[10px] text-gray-400 font-medium">Gestor de Aula Grado UNEMI</p>
            </div>
          </div>

          {/* Connection badge status */}
          <div className="flex items-center space-x-3">
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
                    <span>{sess.username} ({sess.server === 'a' ? 'Aula A' : 'Aula B'})</span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="hidden md:flex items-center space-x-1 text-xs text-gray-400 bg-gray-50 border border-gray-100 px-3 py-1 rounded-full">
                Moodle Desconectado
              </span>
            )}
          </div>

        </div>
      </nav>

      {/* Main Container Grid layout */}
      <main className="max-w-7xl mx-auto px-4 md:px-6 mt-6 relative z-10 space-y-6">
        
        {/* Academic Analytics summary panel */}
        <div id="analytics-grid-row" className="bg-white border border-gray-150/40 rounded-3xl p-5 md:p-6 shadow-2xs grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
          
          <div className="md:col-span-5 space-y-2.5">
            <div className="flex items-center space-x-1.5 text-blue-600 text-[11px] font-bold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Sincronizador Inteligente Multi-Cuenta</span>
            </div>
            <h2 className="text-sm md:text-base font-extrabold text-gray-900 leading-snug">Sincronizador de Materias</h2>
            
            {/* Sync control block */}
            <div className="p-3.5 bg-slate-50 border border-slate-100 rounded-2xl space-y-2 max-w-md shadow-2xs">
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
                    <span className="text-[10px] font-extrabold text-blue-600 uppercase tracking-wider animate-pulse">Sincronizando...</span>
                    <span className="text-[11px] font-mono font-bold text-gray-600">{globalSync.processedCount} de {globalSync.totalCount || '?'}</span>
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
                    <span className="font-extrabold text-amber-600 uppercase">Sincronización Pausada</span>
                    <span className="font-mono text-gray-500">{globalSync.processedCount} de {globalSync.totalCount}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => startGlobalSync(globalSync.queue)}
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
                    <p className="text-[11px] text-red-600 font-extrabold flex items-center gap-1">⚠️ ¡Sincronización Interrumpida!</p>
                    <p className="text-[10px] text-gray-500 leading-normal">Se detectó que la sincronización previa fue interrumpida. Puedes reanudarla desde donde se quedó para ahorrar tiempo.</p>
                  </div>
                  <div className="flex space-x-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => startGlobalSync(globalSync.queue)}
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
                <div className="space-y-1.5">
                  <p className="text-[11px] text-emerald-600 font-extrabold flex items-center gap-1">✅ ¡Todas las materias actualizadas!</p>
                  <button
                    type="button"
                    onClick={() => startGlobalSync()}
                    className="w-full py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-250 text-emerald-800 text-[10px] font-semibold rounded-lg cursor-pointer transition-all flex items-center justify-center space-x-1"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span>Actualizar todo de nuevo</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Stat 1: Completed Rate */}
          <div className="md:col-span-4 bg-gray-50/50 border border-gray-100 rounded-2xl p-4 flex items-center space-x-4">
            <div className={`p-3 rounded-xl shrink-0 ${percentComplete === 100 ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50/60 text-blue-600'}`}>
              <Award className="w-6 h-6 stroke-[1.8]" />
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
          <div className="md:col-span-3 bg-gray-50/50 border border-gray-100 rounded-2xl p-4 flex items-center space-x-3">
            <div className={`p-3 rounded-xl shrink-0 ${session ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50/70 text-amber-600'}`}>
              <BookOpen className="w-5 h-5 stroke-[1.8]" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Materia Mapeadas</p>
              <h3 className="text-sm font-bold text-gray-800 mt-0.5">{courses.length > 0 ? `${courses.length} cursos` : '0 materias'}</h3>
              <p className="text-[10px] text-gray-400 leading-none mt-1">
                {session ? 'Origen: Aula Virtual UNEMI' : 'Conecta tu cuenta Moodle'}
              </p>
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
                      {sess.server === 'a' ? 'A' : 'B'}
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
                    onSessionError={handleSessionError}
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
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Cuentas Conectadas ({sessions.length})</h3>
                  <div className="space-y-2">
                    {sessions.map((sess, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-100 rounded-xl">
                        <div className="flex items-center space-x-2.5 min-w-0">
                          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${idx === activeSessionIndex ? 'bg-emerald-500 animate-pulse' : 'bg-emerald-400'}`}></span>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-gray-800 truncate font-mono">{sess.username}</p>
                            <p className="text-[10px] text-gray-400 capitalize">
                              {sess.server === 'a' ? 'Aula Grado A' : 'Aula Grado B'} {idx === activeSessionIndex ? '(Navegador Actual)' : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          {idx !== activeSessionIndex && (
                            <button
                              onClick={() => {
                                setActiveSessionIndex(idx);
                                setActiveTab('browser');
                              }}
                              className="text-[10px] font-semibold text-blue-600 hover:bg-blue-50 hover:text-blue-700 px-2.5 py-1 rounded-lg border border-blue-100 transition-colors cursor-pointer"
                            >
                              Ver navegador
                            </button>
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
                            Cerrar Sesión
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
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
