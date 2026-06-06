import React, { useState, useEffect } from 'react';
import { 
  Calendar, Layers, Lock, BookOpen, Award, CheckCircle2, 
  Sparkles, Clock, AlertCircle, Bookmark, CheckSquare 
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
          localStorage.setItem('unemi_tasks', JSON.stringify(loadedTasks));
          localStorage.setItem('unemi_tz_migrated_v3', 'true');
        }

        setTasks(loadedTasks);
      } else {
        // Welcoming introductory tasks
        setTasks([
          {
            id: 'welcome-1',
            title: '¡Conecta tu Aula Virtual UNEMI!',
            type: 'MANUAL',
            description: 'Dirígete a la pestaña "Explorar Moodle" o "Conectar Moodle" para ingresar tus credenciales y poder descargar todas tus tareas ordenadas automáticamente.',
            closureDate: new Date(Date.now() + 86400000 * 2).toISOString(), // 2 days in future
            completed: false,
            createdAt: new Date().toISOString()
          },
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
          
          <div className="md:col-span-5 space-y-1">
            <div className="flex items-center space-x-1.5 text-blue-600 text-xs font-bold">
              <Sparkles className="w-4 h-4" />
              <span>Sincronizador Inteligente</span>
            </div>
            <h2 className="text-base md:text-lg font-bold text-gray-900 leading-snug">Sincroniza tus fechas de Aula Virtual</h2>
            <p className="text-xs text-gray-500 leading-relaxed max-w-md">
              Manten tus deberes y cuestionarios actualizados. Este gestor escanea de forma remota, organiza cierres académicos cronológicamente y evita penalizaciones por entregas tardías.
            </p>
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
