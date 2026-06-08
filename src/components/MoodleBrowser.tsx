import React, { useState, useEffect } from 'react';
import { 
  BookOpen, Folder, Calendar, FileText, CheckCircle, Clock, 
  ExternalLink, ArrowLeft, RefreshCw, Layers, Sparkles, Download, CheckCircle2, AlertTriangle, Eye, HelpCircle, HardDriveDownload,
  ChevronDown, ChevronRight
} from 'lucide-react';
import { Course, Activity, ActivityDetails, MoodleSession, TodoTask } from '../types';

const apiBase = import.meta.env.VITE_API_URL || '';

interface MoodleBrowserProps {
  session: MoodleSession;
  onImportTasks: (tasks: TodoTask[]) => void;
  existingTaskUrls: string[];
  tasks?: TodoTask[];
  navigationTrigger?: { courseId: string; activityUrl: string } | null;
  onClearNavigationTrigger?: () => void;
  onNavigateToAgendaActivity?: (activityUrl: string) => void;
  onSessionError?: (session: MoodleSession, message: string) => void;
}

const isStatusSubmitted = (estadoEntrega: string | null | undefined): boolean => {
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

export default function MoodleBrowser({ 
  session, 
  onImportTasks, 
  existingTaskUrls,
  tasks = [],
  navigationTrigger,
  onClearNavigationTrigger,
  onNavigateToAgendaActivity,
  onSessionError
}: MoodleBrowserProps) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [sections, setSections] = useState<{ text: string; url: string }[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [activityDetails, setActivityDetails] = useState<ActivityDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [downloadingHtml, setDownloadingHtml] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [confirmSyncAll, setConfirmSyncAll] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string, type: 'info' | 'success' | 'error' } | null>(null);

  const handleSessionError = (apiErrorMsg: string) => {
    const lowerMessage = apiErrorMsg ? apiErrorMsg.toLowerCase() : '';
    if (
      lowerMessage.includes('fetch failed') ||
      lowerMessage.includes('expiró la sesión') ||
      lowerMessage.includes('sesión') ||
      lowerMessage.includes('expired') ||
      lowerMessage.includes('autenticar') ||
      lowerMessage.includes('credenciales') ||
      lowerMessage.includes('login')
    ) {
      if (onSessionError) {
        onSessionError(session, apiErrorMsg || 'La sesión de Moodle expiró o se cerró.');
      }
    }
  };

  const showToast = (text: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToastMsg({ text, type });
    setTimeout(() => {
      setToastMsg((prev) => (prev?.text === text ? null : prev));
    }, 6000);
  };

  // Synchronizer for Moodle timeline clicking / navigation triggers
  useEffect(() => {
    if (navigationTrigger && courses.length > 0) {
      const targetCourse = courses.find(c => c.id === navigationTrigger.courseId);
      if (targetCourse) {
        if (selectedCourse?.id === targetCourse.id) {
          const actToSelect = activities.find(a => a.url === navigationTrigger.activityUrl);
          if (actToSelect) {
            viewActivityDetails(actToSelect);
            if (onClearNavigationTrigger) {
              onClearNavigationTrigger();
            }
            setTimeout(() => {
              const elementId = `act-item-${navigationTrigger.activityUrl.split('id=').pop()}`;
              const el = document.getElementById(elementId);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2', 'transition-all');
                setTimeout(() => {
                  el.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2');
                }, 3000);
              }
            }, 350);
          }
        } else {
          selectCourse(targetCourse);
        }
      }
    }
  }, [navigationTrigger, courses, selectedCourse, activities]);

  // Fetch courses on mount
  useEffect(() => {
    fetchCourses();
  }, [session]);

  const fetchCourses = async () => {
    setLoadingCourses(true);
    setError(null);
    try {
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
        const errMsg = data.error || 'No se pudieron extraer los cursos. ¿Expiró la sesión? Re-auténticate.';
        setError(errMsg);
        handleSessionError(errMsg);
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Error de comunicación (fetch failed) al consultar tus materias.';
      setError(errMsg);
      handleSessionError(errMsg || 'fetch failed');
    } finally {
      setLoadingCourses(false);
    }
  };

  const selectCourse = async (course: Course) => {
    setSelectedCourse(course);
    setActivities([]);
    setSections([]);
    setSelectedActivity(null);
    setActivityDetails(null);
    setLoadingActivities(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/api/moodle/course-activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moodleSession: session.cookies,
          server: session.server,
          courseUrl: course.url
        })
      });
      const data = await res.json();
      if (res.ok && data.activities) {
        // Enforce mapping server course info
        const mappedActs = data.activities.map((act: any) => ({
          ...act,
          courseId: course.id,
          courseName: course.text
        }));
        setActivities(mappedActs);
        setSections(data.sections || []);
      } else {
        const errMsg = data.error || 'No se pudieron cargar las actividades de la materia.';
        setError(errMsg);
        handleSessionError(errMsg);
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Error (fetch failed) al descargar las secciones del curso.';
      setError(errMsg);
      handleSessionError(errMsg || 'fetch failed');
    } finally {
      setLoadingActivities(false);
    }
  };

  const viewActivityDetails = async (activity: Activity) => {
    setSelectedActivity(activity);
    setActivityDetails(null);
    setLoadingDetails(true);
    try {
      const res = await fetch(`${apiBase}/api/moodle/activity-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moodleSession: session.cookies,
          server: session.server,
          activityUrl: activity.url
        })
      });
      const data = await res.json();
      if (res.ok && data.details) {
        setActivityDetails(data.details);
      } else {
        console.error('Error fetching details:', data.error);
      }
    } catch (err) {
      console.error('Network error viewActivityDetails:', err);
    } finally {
      setLoadingDetails(false);
    }
  };

  // Automated date resolver and bulk importer
  const syncCourseDeadlines = async () => {
    if (!activities.length || !selectedCourse) return;
    
    // Pick assignments and quizzes in this course
    const listToScan = activities.filter(act => act.type === 'TAREA' || act.type === 'CUESTIONARIO');
    if (!listToScan.length) {
      showToast('Esta materia no tiene tareas o cuestionarios asignados para sincronizar.', 'info');
      return;
    }

    setSyncProgress({ current: 0, total: listToScan.length, label: 'Iniciando escaneo masivo...' });
    const importedList: TodoTask[] = [];

    for (let i = 0; i < listToScan.length; i++) {
      const act = listToScan[i];
      setSyncProgress({
        current: i + 1,
        total: listToScan.length,
        label: `Analizando: ${act.name.substring(0, 30)}...`
      });

      try {
        const res = await fetch(`${apiBase}/api/moodle/activity-details`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            moodleSession: session.cookies,
            server: session.server,
            activityUrl: act.url
          })
        });

        if (res.ok) {
          const data = await res.json();
          if (data.details) {
            const details: ActivityDetails = data.details;
            
            // Build the Todo item
            const computedStats = computeTaskStats(act.type, details);
            const newTodo: TodoTask = {
              id: `moodle-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
              title: act.name,
              courseId: selectedCourse.id,
              courseName: selectedCourse.text,
              activityUrl: act.url,
              type: act.type,
              description: details.detalle || undefined,
              closureDate: details.closureDateISO || null,
              aperture: details.aperture || null,
              apertureDateISO: details.apertureDateISO || null,
              completed: !details.por_hacer_calificacion && (
                           isStatusSubmitted(details.estado_entrega) || 
                           details.quiz_info?.intentos?.some(att => att.estado?.toLowerCase().includes('terminado')) || 
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
              moodleUsername: session.username,
              moodleServer: session.server,
            };
            importedList.push(newTodo);
          }
        }
      } catch (err) {
        console.error('Error in batch sync activity:', act.name, err);
      }

      // Small delay to protect Moodle servers from rate-limits
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (importedList.length > 0) {
      onImportTasks(importedList);
    }
    
    setSyncProgress(null);
    showToast(`Sincronización completada. Se importaron o actualizaron ${importedList.length} actividades formativas en tu agenda.`, 'success');
  };

  const normalizeName = (name: string) => {
    return name.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  };

  const formatCalendarDate = (isoString: string | null) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '';
      const options: Intl.DateTimeFormatOptions = { 
        weekday: 'short', 
        day: 'numeric', 
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Guayaquil'
      };
      return date.toLocaleDateString('es-EC', options);
    } catch {
      return '';
    }
  };

  const computeTaskStats = (type: string, details: ActivityDetails) => {
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
          const finishedAttempt = qi.intentos.find(att => 
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
      } else if (isStatusSubmitted(details.estado_entrega)) {
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

  const isSectionOfInterest = (name: string) => {
    const norm = normalizeName(name);
    // Sub-segment folders of interest to remain expanded
    const interesting = [
      'actividades autonomas',
      'actividades contacto con el docente',
      'foro',
      'actividades de practica experimental',
      'examen',
      'simulador'
    ];
    return interesting.some(sec => norm.includes(sec));
  };

  const isSectionCollapsed = (sectionName: string) => {
    if (collapsedSections[sectionName] !== undefined) {
      return collapsedSections[sectionName];
    }
    // Collapse by default on load if it is NOT of interest to the user
    return !isSectionOfInterest(sectionName);
  };

  const toggleSection = (sectionName: string) => {
    setCollapsedSections(prev => ({
      ...prev,
      [sectionName]: !isSectionCollapsed(sectionName)
    }));
  };

  // Global automatic synchronizer for ALL courses mapped in Moodle
  const syncAllCoursesDeadlines = async () => {
    if (!courses.length) {
      showToast('No se detectaron materias. Por favor refresca la lista antes de sincronizar.', 'error');
      return;
    }

    setSyncProgress({ current: 0, total: courses.length, label: 'Mapeando materias de UNEMI en paralelo...' });
    const globalImportedList: TodoTask[] = [];

    try {
      // 1. Fetch course activities in parallel
      const coursesActivities = await Promise.all(
        courses.map(async (course, cIdx) => {
          try {
            const res = await fetch(`${apiBase}/api/moodle/course-activities`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                moodleSession: session.cookies,
                server: session.server,
                courseUrl: course.url
              })
            });
            const data = await res.json();
            if (res.ok && data.activities) {
              const mapped = data.activities.map((act: any) => ({
                ...act,
                courseId: course.id,
                courseName: course.text
              }));
              return { course, activities: mapped };
            }
          } catch (e) {
            console.error(`Failed course activities fetch for: ${course.text}`, e);
          }
          return { course, activities: [] };
        })
      );

      // Gather all actionable activities
      const allActionableActs: { act: Activity; course: Course }[] = [];
      coursesActivities.forEach(({ course, activities: acts }) => {
        const actionable = acts.filter(act => act.type === 'TAREA' || act.type === 'CUESTIONARIO');
        actionable.forEach(act => {
          allActionableActs.push({ act, course });
        });
      });

      if (allActionableActs.length === 0) {
        setSyncProgress(null);
        showToast('Sincronización global terminada. No descubrimos nuevas tareas o cuestionarios en tus materias.', 'info');
        return;
      }

      setSyncProgress({ current: 0, total: allActionableActs.length, label: `Iniciando consulta para ${allActionableActs.length} actividades...` });

      // 2. Fetch activity details concurrently (batch size: 4)
      const concurrencyLimit = 4;
      for (let i = 0; i < allActionableActs.length; i += concurrencyLimit) {
        const batch = allActionableActs.slice(i, i + concurrencyLimit);
        
        await Promise.all(
          batch.map(async ({ act, course }, bIdx) => {
            const currentNum = i + bIdx + 1;
            setSyncProgress(prev => ({
              current: currentNum <= allActionableActs.length ? currentNum : prev?.current || currentNum,
              total: allActionableActs.length,
              label: `[Actividad ${currentNum}/${allActionableActs.length}] Extrayendo fechas para: ${act.name.substring(0, 20)}...`
            }));

            try {
              const res = await fetch(`${apiBase}/api/moodle/activity-details`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  moodleSession: session.cookies,
                  server: session.server,
                  activityUrl: act.url
                })
              });

              if (res.ok) {
                const data = await res.json();
                if (data.details) {
                  const details: ActivityDetails = data.details;
                  const computedStats = computeTaskStats(act.type, details);
                  const newTodo: TodoTask = {
                    id: `moodle-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
                    title: act.name,
                    courseId: course.id,
                    courseName: course.text,
                    activityUrl: act.url,
                    type: act.type,
                    description: details.detalle || undefined,
                    closureDate: details.closureDateISO || null,
                    aperture: details.aperture || null,
                    apertureDateISO: details.apertureDateISO || null,
                    completed: !details.por_hacer_calificacion && (
                               isStatusSubmitted(details.estado_entrega) || 
                               details.quiz_info?.intentos?.some(att => att.estado?.toLowerCase().includes('terminado')) || 
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
                    moodleUsername: session.username,
                    moodleServer: session.server,
                  };
                  globalImportedList.push(newTodo);
                }
              }
            } catch (errDetail) {
              console.error(`Failed to scrape specific task detail: ${act.name}`, errDetail);
            }
          })
        );

        // Gentle pause between concurrent runs
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      if (globalImportedList.length > 0) {
        onImportTasks(globalImportedList);
        showToast(`¡Sincronización terminada! Procesadas y guardadas exitosamente ${globalImportedList.length} actividades formativas.`, 'success');
      } else {
        showToast('Sincronización global finalizada. No se encontraron nuevas actividades.', 'info');
      }

    } catch (errSyncAll) {
      console.error('Error general in global synchronization:', errSyncAll);
      showToast('Sucedió un error general de comunicación al sincronizar tus materias.', 'error');
    } finally {
      setSyncProgress(null);
    }
  };

  const importSingleActivity = () => {
    if (!selectedActivity || !selectedCourse || !activityDetails) return;

    const computedStats = computeTaskStats(selectedActivity.type, activityDetails);
    const completed = !activityDetails.por_hacer_calificacion && (
                      isStatusSubmitted(activityDetails.estado_entrega) || 
                      activityDetails.quiz_info?.intentos?.some(att => att.estado?.toLowerCase().includes('terminado')) || 
                      (activityDetails.hecho_calificacion === true) ||
                      (computedStats.status === 'Calificado' || computedStats.status === 'Entregado') ||
                      false);

    const newTodo: TodoTask = {
      id: `moodle-${Date.now()}`,
      title: selectedActivity.name,
      courseId: selectedCourse.id,
      courseName: selectedCourse.text,
      activityUrl: selectedActivity.url,
      type: selectedActivity.type,
      description: activityDetails.detalle || undefined,
      closureDate: activityDetails.closureDateISO || null,
      aperture: activityDetails.aperture || null,
      apertureDateISO: activityDetails.apertureDateISO || null,
      completed,
      createdAt: new Date().toISOString(),
      status: computedStats.status,
      grade: computedStats.grade,
      gradeOver: computedStats.gradeOver,
      gradingStatus: activityDetails.estado_calificacion || null,
      estado_calificacion: activityDetails.estado_calificacion || null,
      estado_entrega: activityDetails.estado_entrega || null,
      comentario_calificador: activityDetails.comentario_calificador || null,
      advertencia_preguntas: activityDetails.advertencia_preguntas || null,
      por_hacer_calificacion: activityDetails.por_hacer_calificacion || false,
      hecho_calificacion: activityDetails.hecho_calificacion || false,
      grupo: activityDetails.grupo || null,
      moodleUsername: session.username,
      moodleServer: session.server,
    };

    onImportTasks([newTodo]);
    showToast('¡Actividad agendada con éxito en tu calendario!', 'success');
  };

  const downloadRawHtml = async () => {
    if (!selectedActivity) return;
    setDownloadingHtml(true);
    try {
      const res = await fetch(`${apiBase}/api/moodle/download-raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moodleSession: session.cookies,
          server: session.server,
          url: selectedActivity.url
        })
      });
      const data = await res.json();
      if (res.ok && data.html) {
        // Trigger browser download
        const blob = new Blob([data.html], { type: 'text/html;charset=utf-8' });
        const urlObj = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = urlObj;
        
        // Sanitize name for the filename
        const safeName = selectedActivity.name
          .replace(/[^a-z0-9áéíóúñ]/gi, '_')
          .replace(/__+/g, '_')
          .substring(0, 80);
        
        a.download = `${safeName || 'pagina_moodle'}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(urlObj);
      } else {
        showToast(data.error || 'Error al descargar la página HTML de Moodle.', 'error');
      }
    } catch (err) {
      showToast('Error de comunicación al intentar descargar el documento.', 'error');
    } finally {
      setDownloadingHtml(false);
    }
  };

  const viewRawHtml = async () => {
    if (!selectedActivity) return;
    setDownloadingHtml(true);
    try {
      const res = await fetch(`${apiBase}/api/moodle/download-raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moodleSession: session.cookies,
          server: session.server,
          url: selectedActivity.url
        })
      });
      const data = await res.json();
      if (res.ok && data.html) {
        const blob = new Blob([data.html], { type: 'text/html;charset=utf-8' });
        const urlObj = window.URL.createObjectURL(blob);
        window.open(urlObj, '_blank');
        setTimeout(() => window.URL.revokeObjectURL(urlObj), 15000);
      } else {
        showToast(data.error || 'Error al ver la página HTML de Moodle.', 'error');
      }
    } catch (err) {
      showToast('Error de comunicación al intentar ver el documento.', 'error');
    } finally {
      setDownloadingHtml(false);
    }
  };

  // Group activities helper
  const groupedActivities = activities.reduce<Record<string, Activity[]>>((acc, act) => {
    if (!acc[act.section]) acc[act.section] = [];
    acc[act.section].push(act);
    return acc;
  }, {});

  return (
    <div id="moodle-browser-container" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      
      {/* LEFT COLUMN: Course selector list & Section Index */}
      <div className="lg:col-span-4 space-y-4">
        {selectedCourse ? (
          /* Sub-navigation Header */
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-xs">
            <button
              id="back-to-courses"
              onClick={() => {
                setSelectedCourse(null);
                setActivities([]);
                setSections([]);
                setSelectedActivity(null);
                setActivityDetails(null);
              }}
              className="flex items-center space-x-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 transition-colors mb-3"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Ver mis materias</span>
            </button>
            <div className="flex items-start space-x-3">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl mt-1 shrink-0">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900 line-clamp-2">{selectedCourse.text}</h3>
                <p className="text-xs text-gray-400 mt-1 font-mono">ID: {selectedCourse.id}</p>
              </div>
            </div>

            {/* Sync Bulk Button */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              <button
                id="bulk-sync-deadlines"
                disabled={loadingActivities || !!syncProgress}
                onClick={syncCourseDeadlines}
                className="w-full flex items-center justify-center space-x-2 text-xs font-semibold bg-gray-900 text-white rounded-xl py-2.5 hover:bg-gray-800 disabled:opacity-50 hover:scale-[1.01] active:scale-[0.99] transition-all"
              >
                <Sparkles className="w-4 h-4 animate-pulse text-amber-300" />
                <span>Sincronizar Fechas y Agenda</span>
              </button>
            </div>
          </div>
        ) : (
          /* Main Title */
          <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2.5">
                <Layers className="w-5 h-5 text-gray-700" />
                <h2 className="text-base font-bold text-gray-900">Navegador Moodle</h2>
              </div>
              <button
                id="refresh-courses"
                onClick={fetchCourses}
                disabled={loadingCourses}
                className="p-1.5 hover:bg-gray-50 rounded-lg text-gray-400 hover:text-gray-900 transition-colors"
                title="Refrescar materias"
              >
                <RefreshCw className={`w-4 h-4 ${loadingCourses ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-4 text-xs text-red-700">
                {error}
              </div>
            )}

            {/* Courses list */}
            {loadingCourses ? (
              <div className="space-y-3 py-6">
                {[1, 2, 3].map(n => (
                  <div key={n} className="h-16 bg-gray-50 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : courses.length === 0 ? (
              <div className="text-center py-10 px-4">
                <BookOpen className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-xs text-gray-500">No se detectaron materias. Presiona refrescar o reconecta tu cuenta.</p>
              </div>
            ) : (
              <div className="space-y-4">
                 {/* Global Fast Sync Button */}
                <button
                  id="sync-all-courses-hdr-btn"
                  type="button"
                  disabled={loadingCourses || !!syncProgress}
                  onClick={() => {
                    if (confirmSyncAll) {
                      syncAllCoursesDeadlines();
                      setConfirmSyncAll(false);
                    } else {
                      setConfirmSyncAll(true);
                      setTimeout(() => setConfirmSyncAll(false), 5000);
                    }
                  }}
                  className={`w-full flex items-center justify-center space-x-2 text-xs font-bold rounded-xl py-2.5 transition-all shadow-xs cursor-pointer active:scale-[0.98] disabled:opacity-50 font-sans ${
                    confirmSyncAll
                      ? 'bg-amber-500 hover:bg-amber-600 text-white border border-amber-300 animate-pulse'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                  title="Sincronizar tareas y exámenes de todas las materias de forma automática"
                >
                  <Sparkles className={`w-3.5 h-3.5 animate-pulse ${confirmSyncAll ? 'text-white' : 'text-amber-300'}`} />
                  <span>{confirmSyncAll ? '¿CONFIRMAR ESCANEO EN MILES DE AULAS UNEMI?' : 'Sincronizar Todas las Materias'}</span>
                </button>

                <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
                  {courses.map((course) => (
                  <button
                    key={course.id}
                    id={`course-item-${course.id}`}
                    onClick={() => selectCourse(course)}
                    className="w-full text-left p-3.5 hover:bg-gray-50 rounded-xl border border-transparent hover:border-gray-100 transition-all flex items-start space-x-3 group"
                  >
                    <div className="p-2 bg-gray-50 text-gray-400 group-hover:bg-blue-50 group-hover:text-blue-600 rounded-lg shrink-0 mt-0.5 transition-colors">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 line-clamp-2 leading-relaxed group-hover:text-blue-600 transition-colors">
                        {course.text}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          </div>
        )}

        {/* Sync Progress Tracker */}
        {syncProgress && (
          <div id="moodle-sync-status" className="bg-blue-50 border border-blue-100 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-blue-800">Sincronizando Materia</span>
              <span className="text-xs font-mono font-bold text-blue-800">
                {syncProgress.current} / {syncProgress.total}
              </span>
            </div>
            <div className="w-full bg-blue-100 h-2 rounded-full overflow-hidden mb-1.5">
              <div 
                className="bg-blue-600 h-full transition-all duration-300 rounded-full"
                style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
              />
            </div>
            <p className="text-[10px] text-blue-600 font-mono font-medium truncate">{syncProgress.label}</p>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: Activities Explorer / Raw Details */}
      <div id="moodle-activity-explorer" className="lg:col-span-8">
        
        {/* State: No Course Selected */}
        {!selectedCourse && (
          <div className="bg-white border border-gray-100 rounded-3xl p-12 text-center h-full flex flex-col justify-center items-center shadow-xs min-h-[300px]">
            <Layers className="w-12 h-12 text-gray-200 mb-3 stroke-[1.5]" />
            <h3 className="text-sm font-bold text-gray-800 mb-1">Explorador de Cursos</h3>
            <p className="text-xs text-gray-400 max-w-sm leading-relaxed">
              Elige una materia del menú lateral para auditar sus tareas, lecciones, cuestionarios e inclusive ver tus notas y retroalimentaciones directas del catedrático.
            </p>
          </div>
        )}

        {/* State: Course Selected but Loading */}
        {selectedCourse && loadingActivities && (
          <div className="bg-white border border-gray-100 rounded-3xl p-12 text-center shadow-xs min-h-[350px] flex flex-col justify-center items-center">
            <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mb-3 stroke-[2]" />
            <p className="text-xs text-gray-500 font-medium">Leyendo las carpetas y actividades en {selectedCourse.text}...</p>
          </div>
        )}

        {/* State: Activities fully fetched */}
        {selectedCourse && !loadingActivities && (
          <div className="space-y-6">
            
            {/* Split Screen Grid: Activities Tree Left, Slide-In Detail Right */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              
              {/* TREE SUB-PANEL */}
              <div className="md:col-span-7 bg-white border border-gray-100 rounded-2xl p-5 shadow-xs max-h-[560px] overflow-y-auto">
                <h3 className="text-xs font-bold text-gray-400 mb-4 uppercase tracking-wider">Actividades del Curso</h3>

                {activities.length === 0 ? (
                  <div className="text-center py-10">
                    <HelpCircle className="w-6 h-6 text-gray-300 mx-auto mb-2" />
                    <p className="text-xs text-gray-400">No se encontraron actividades mapeables en las secciones académicas.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(groupedActivities).map(([sectionName, list]) => {
                      const activitiesList = list as Activity[];
                      const collapsed = isSectionCollapsed(sectionName);
                      return (
                        <div key={sectionName} className="space-y-2 border border-slate-100/60 rounded-xl p-1.5 bg-slate-50/20">
                          {/* Folder Toggle Heading */}
                          <button
                            type="button"
                            onClick={() => toggleSection(sectionName)}
                            className="w-full flex items-center justify-between py-1.5 px-2 bg-slate-50 hover:bg-slate-100 rounded-lg text-slate-700 transition-colors cursor-pointer text-left"
                          >
                            <div className="flex items-center space-x-1.5 min-w-0">
                              <Folder className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="text-xs font-bold truncate">{sectionName}</span>
                            </div>
                            <div className="flex items-center space-x-2 shrink-0">
                              <span className="text-[9px] font-semibold bg-white border border-slate-150 text-slate-500 px-1.5 py-0.5 rounded-md font-mono">
                                {activitiesList.length} {activitiesList.length === 1 ? 'it' : 'its'}
                              </span>
                              {collapsed ? (
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                              )}
                            </div>
                          </button>

                          {/* Activities list (rendered only if expanded) */}
                          {!collapsed && (
                            <div className="space-y-1 pl-1 pt-1.5 animate-in fade-in duration-200">
                              {activitiesList.map((act) => {
                                const isSelected = selectedActivity?.url === act.url;
                                const isSavedInAgenda = existingTaskUrls.includes(act.url);
                                const matchingTask = tasks?.find(t => t.activityUrl === act.url);
                                const closureISO = matchingTask?.closureDate || act.closureDateISO || null;
                                const closureText = matchingTask?.closureDate ? formatCalendarDate(matchingTask.closureDate) : (act.closure || null);

                              return (
                                <div
                                  key={act.url}
                                  id={`act-item-${act.url.split('id=').pop()}`}
                                  onClick={() => viewActivityDetails(act)}
                                  className={`w-full text-left p-3 rounded-xl border flex flex-col space-y-2 transition-all text-xs cursor-pointer ${
                                    isSelected 
                                      ? 'bg-blue-50/60 border-blue-200 text-blue-900 font-medium shadow-2xs' 
                                      : 'bg-white hover:bg-slate-50 border-slate-100 text-slate-700'
                                  }`}
                                >
                                  <div className="flex items-start space-x-2.5 w-full">
                                    <span className="text-base shrink-0 mt-0.5">{act.icon}</span>
                                    <div className="flex-1 min-w-0">
                                      <p className="truncate leading-relaxed font-semibold">{act.name}</p>
                                      {act.completionStatus.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {act.completionStatus.map((badge, idx) => (
                                            <span 
                                              key={idx} 
                                              className={`text-[9px] font-mono font-medium px-1.5 py-0.5 rounded ${
                                                badge.startsWith('Hecho') 
                                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100/50' 
                                                  : 'bg-amber-50 text-amber-700 border border-amber-100/50'
                                              }`}
                                            >
                                              {badge}
                                            </span>
                                          ))}
                                          {isSavedInAgenda && (
                                            <span className="text-[9px] font-mono font-bold bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">
                                              En Agenda
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Action / Date Row */}
                                  <div className="flex items-center justify-between gap-1 mt-1 pt-1 border-t border-slate-100/60">
                                    {(closureISO || closureText) ? (
                                      <div className="flex items-center space-x-1.5 text-[10px] font-semibold text-rose-700 bg-rose-50/70 border border-rose-150/40 rounded-lg px-2 py-0.5 w-fit">
                                        <Clock className="w-3 h-3 text-rose-500 shrink-0" />
                                        <span className="truncate max-w-[124px]">
                                          {closureText || (closureISO ? formatCalendarDate(closureISO) : '')}
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="flex items-center space-x-1.5 text-[10px] font-medium text-slate-400 italic">
                                        <Clock className="w-3 h-3 text-slate-300 shrink-0" />
                                        <span>Sin fecha límite</span>
                                      </div>
                                    )}

                                    {isSavedInAgenda && onNavigateToAgendaActivity && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onNavigateToAgendaActivity(act.url);
                                        }}
                                        className="px-2 py-0.5 text-[9px] font-bold bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-150 rounded-md flex items-center space-x-0.5 cursor-pointer transition-all active:scale-95 shrink-0"
                                      >
                                        <span>Ver en Agenda</span>
                                        <ChevronRight className="w-3 h-3 shrink-0" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );})}
                  </div>
                )}
              </div>

              {/* DETAILED SCRAPER INFORMATION SIDE BAR */}
              <div id="activity-details-panel" className="md:col-span-5 bg-white border border-gray-100 rounded-2xl p-5 shadow-xs max-h-[560px] overflow-y-auto">
                <h3 className="text-xs font-bold text-gray-400 mb-4 uppercase tracking-wider">Auditoría de Actividad</h3>

                {!selectedActivity ? (
                  <div className="text-center py-20 text-gray-400">
                    <Eye className="w-8 h-8 mx-auto mb-2 text-gray-200 stroke-[1.5]" />
                    <p className="text-xs leading-relaxed max-w-[200px] mx-auto">Selecciona cualquier tarea o cuestionario para extraer su estado.</p>
                  </div>
                ) : loadingDetails ? (
                  <div className="text-center py-20 flex flex-col items-center">
                    <RefreshCw className="w-6 h-6 text-blue-600 animate-spin mb-3 stroke-[2]" />
                    <p className="text-xs text-gray-500 font-medium font-mono">Scraping HTML Moodle...</p>
                  </div>
                ) : !activityDetails ? (
                  <div className="text-center py-10 text-red-600 text-xs">
                    No se pudieron descargar los detalles de esta actividad específica.
                  </div>
                ) : (
                  /* Formatted scrape details sheet */
                  <div className="space-y-4">
                    <div>
                      <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full uppercase">
                        {activityDetails.tipo_actividad}
                      </span>
                      <h4 className="text-xs font-bold text-gray-900 mt-2 leading-relaxed">
                        {selectedActivity.name}
                      </h4>
                    </div>

                    {/* Deadline date callout card */}
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                      <div className="flex items-center space-x-2 text-gray-800 text-xs mb-1.5">
                        <Calendar className="w-4 h-4 text-slate-500 shrink-0" />
                        <span className="font-semibold">Fecha de Cierre:</span>
                      </div>
                      <p className="text-xs font-semibold text-slate-900 leading-relaxed max-w-[200px]">
                        {activityDetails.closure || 'Indeterminada / No especificada'}
                      </p>
                      {activityDetails.tiempo_restante && (
                        <div className="flex items-center space-x-1.5 text-[10px] text-amber-700 bg-amber-50 rounded-md px-2 py-1 mt-2">
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          <span className="font-medium font-mono truncate">{activityDetails.tiempo_restante}</span>
                        </div>
                      )}
                    </div>

                    {/* Alerts and Warnings Indicators extracted from Moodle */}
                    {activityDetails.advertencia_preguntas && (
                      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs flex items-start space-x-2 animate-in fade-in duration-300">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div className="flex-1 space-y-0.5">
                          <p className="font-bold text-amber-800">Aviso General Moodle:</p>
                          <p className="text-[11px] leading-relaxed text-amber-700">{activityDetails.advertencia_preguntas}</p>
                        </div>
                      </div>
                    )}

                    {activityDetails.por_hacer_calificacion && (
                      <div className="bg-amber-50 border border-amber-200 text-amber-950 rounded-xl p-3 text-xs flex items-start space-x-2 animate-in fade-in duration-300">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div className="flex-1 space-y-0.5">
                          <p className="font-bold text-amber-900">Actividad Pendiente:</p>
                          <p className="text-[11px] leading-relaxed text-amber-800">
                            <strong>Por hacer - Recibir una calificación:</strong> Esta actividad o test aún no ha sido realizado o enviado en Moodle.
                          </p>
                        </div>
                      </div>
                    )}

                    {activityDetails.hecho_calificacion && (
                      <div className="bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-xl p-3 text-xs flex items-start space-x-2 animate-in fade-in duration-300">
                        <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <div className="flex-1 space-y-0.5">
                          <p className="font-bold text-emerald-900">Actividad Completada:</p>
                          <p className="text-[11px] leading-relaxed text-emerald-800">
                            <strong>Hecho - Recibir una calificación:</strong> La actividad/test ha sido completado y entregado con éxito. Sin embargo, la calificación está en proceso de revisión o aún no es visible para estudiantes.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Submission / Grade matrices for assign */}
                    {activityDetails.tipo_actividad === 'Tarea' && (
                      <div className="space-y-2.5 border-t border-gray-100 pt-3 text-xs text-gray-700">
                        {activityDetails.grupo && (
                          <div className="flex justify-between items-center bg-blue-50/40 border border-blue-100/50 p-2.5 rounded-lg text-blue-900">
                            <span className="font-semibold text-blue-700">Grupo:</span>
                            <span className="font-bold bg-blue-100/70 border border-blue-200/50 px-2.5 py-0.5 rounded text-[10px]">
                              {activityDetails.grupo}
                            </span>
                          </div>
                        )}
                        {activityDetails.estado_entrega && (
                          <div className="flex justify-between items-center bg-gray-50/50 p-2 rounded-lg">
                            <span className="font-semibold text-gray-500">Entrega:</span>
                            <span className={`font-semibold py-0.5 px-2 rounded-full text-[10px] ${
                              isStatusSubmitted(activityDetails.estado_entrega)
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-amber-50 text-amber-700'
                            }`}>
                              {activityDetails.estado_entrega}
                            </span>
                          </div>
                        )}
                        {activityDetails.estado_calificacion && (
                          <div className="flex justify-between items-center bg-gray-50/50 p-2 rounded-lg">
                            <span className="font-semibold text-gray-500">Estado Calif:</span>
                            <span className="font-semibold">{activityDetails.estado_calificacion}</span>
                          </div>
                        )}
                        {activityDetails.calificacion && (
                          <div className="flex justify-between items-center bg-emerald-50/50 border border-emerald-100/50 p-2.5 rounded-lg text-emerald-900">
                            <span className="font-bold">Calificación:</span>
                            <span className="font-mono font-bold text-sm">
                              {activityDetails.calificacion} / {activityDetails.calificacion_sobre || '10'}
                            </span>
                          </div>
                        )}
                        {activityDetails.comentario_calificador && (
                          <div className="bg-gray-50/80 border border-gray-100 rounded-xl p-3 text-gray-600 mt-2">
                            <p className="font-bold text-gray-700 mb-1">Comentario del Docente:</p>
                            <p className="leading-relaxed text-[11px] font-mono italic">{activityDetails.comentario_calificador}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Quizzes specific detailed sheet */}
                    {activityDetails.tipo_actividad === 'Cuestionario' && activityDetails.quiz_info && (
                      <div className="space-y-3 border-t border-gray-100 pt-3 text-xs">
                        <div className="grid grid-cols-2 gap-2 text-gray-700">
                          {activityDetails.quiz_info.intentos_permitidos && (
                            <div className="bg-gray-50 p-2 rounded-lg">
                              <span className="block text-[10px] text-gray-400 font-bold uppercase">Intentos Máx</span>
                              <span className="font-semibold text-gray-800">{activityDetails.quiz_info.intentos_permitidos}</span>
                            </div>
                          )}
                          {activityDetails.quiz_info.limite_tiempo && (
                            <div className="bg-gray-50 p-2 rounded-lg">
                              <span className="block text-[10px] text-gray-400 font-bold uppercase">Límite</span>
                              <span className="font-semibold text-gray-800">{activityDetails.quiz_info.limite_tiempo}</span>
                            </div>
                          )}
                        </div>

                        {activityDetails.quiz_info.calificacion_final && (
                          <div className="bg-emerald-50 border border-emerald-100 p-2.5 rounded-xl text-emerald-900 flex justify-between items-center">
                            <span className="font-bold">Nota Cuestionario:</span>
                            <span className="font-mono font-bold text-sm">
                              {activityDetails.quiz_info.calificacion_final} / {activityDetails.quiz_info.calificacion_sobre || '10'}
                              {activityDetails.quiz_info.porcentaje && <span className="text-[11px] font-normal ml-1">({activityDetails.quiz_info.porcentaje}%)</span>}
                            </span>
                          </div>
                        )}

                        {/* Attempts detail lists */}
                        {activityDetails.quiz_info.intentos.length > 0 && (
                          <div className="space-y-2 mt-2">
                            <p className="font-bold text-gray-800 text-[11px] uppercase tracking-wider">Historial de Intentos:</p>
                            {activityDetails.quiz_info.intentos.map((att) => (
                              <div key={att.numero} className="border border-gray-100 rounded-xl p-2.5 space-y-1.5 bg-gray-50/20 text-[11px]">
                                <div className="flex justify-between font-bold text-gray-800">
                                  <span>Intento #{att.numero}</span>
                                  <span className="text-blue-600 font-mono">{att.calificacion ? `${att.calificacion} pts` : att.estado}</span>
                                </div>
                                <div className="text-gray-500 font-mono text-[10px] space-y-0.5">
                                  {att.comenzado && <p>Comienzo: {att.comenzado}</p>}
                                  {att.duracion && <p>Duración: {att.duracion}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Description attachment listing */}
                    {activityDetails.archivos_adicionales && activityDetails.archivos_adicionales.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Guías y Materiales Adjuntos:</p>
                        {activityDetails.archivos_adicionales.map((file, idx) => (
                          <a
                            key={idx}
                            href={file.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center space-x-1.5 text-xs text-blue-600 hover:underline bg-blue-50/30 p-1.5 rounded-lg border border-blue-100/30 font-medium"
                          >
                            <HardDriveDownload className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate flex-1">{file.texto}</span>
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Bottom actionable integration panel */}
                    <div className="mt-5 space-y-2">
                      {existingTaskUrls.includes(selectedActivity.url) && onNavigateToAgendaActivity ? (
                        <button
                          type="button"
                          onClick={() => onNavigateToAgendaActivity(selectedActivity.url)}
                          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition-shadow shadow-sm active:scale-[0.99] duration-100 shrink-0 cursor-pointer text-center"
                        >
                          <ChevronRight className="w-4 h-4 text-white shrink-0" />
                          <span>Ver en Mi Agenda</span>
                        </button>
                      ) : (
                        <button
                          id="import-single-task"
                          onClick={importSingleActivity}
                          className="w-full py-2.5 bg-gray-950 hover:bg-gray-800 text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all"
                        >
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span>Agendar Actividad</span>
                        </button>
                      )}
                      <div className="grid grid-cols-3 gap-1.5">
                        <a
                          id="open-moodle-raw"
                          href={selectedActivity.url}
                          target="_blank"
                          rel="noreferrer"
                          className="py-2 border border-gray-200 hover:bg-gray-50 text-gray-700 bg-white rounded-xl text-[10px] font-semibold flex items-center justify-center space-x-0.5 transition-all"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          <span className="truncate">UNEMI</span>
                        </a>
                        <button
                          id="view-moodle-html"
                          onClick={viewRawHtml}
                          disabled={downloadingHtml}
                          className="py-2 border border-teal-200 hover:bg-teal-600 hover:text-white hover:border-teal-600 text-teal-700 bg-teal-50 rounded-xl text-[10px] font-semibold flex items-center justify-center space-x-0.5 transition-all disabled:opacity-50 cursor-pointer"
                        >
                          {downloadingHtml ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                          ) : (
                            <Eye className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span className="truncate">Ver HTML</span>
                        </button>
                        <button
                          id="download-moodle-raw"
                          onClick={downloadRawHtml}
                          disabled={downloadingHtml}
                          className="py-2 border border-amber-200 hover:bg-amber-600 hover:text-white hover:border-amber-600 text-amber-700 bg-amber-50 rounded-xl text-[10px] font-semibold flex items-center justify-center space-x-0.5 transition-all disabled:opacity-50 cursor-pointer"
                        >
                          {downloadingHtml ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                          ) : (
                            <Download className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span className="truncate">Bajar HTML</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

            </div>

          </div>
        )}

      </div>

      {/* Dynamic Toast feedback banner */}
      {toastMsg && (
        <div 
          id="toast-notification-moodle"
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-2xl shadow-xl flex items-center space-x-2.5 max-w-sm border animate-fade-in transition-all ${
            toastMsg.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
              : toastMsg.type === 'error'
                ? 'bg-rose-50 text-rose-800 border-rose-200'
                : 'bg-blue-50 text-blue-800 border-blue-200'
          }`}
        >
          {toastMsg.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : toastMsg.type === 'error' ? (
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          ) : (
            <Sparkles className="w-5 h-5 text-blue-600 shrink-0" />
          )}
          <span className="text-xs font-bold font-sans leading-tight">{toastMsg.text}</span>
          <button 
            type="button"
            onClick={() => setToastMsg(null)}
            className="text-[10px] bg-white/50 hover:bg-white rounded px-1.5 py-0.5 ml-2 font-mono hover:scale-105 active:scale-[0.93] text-gray-500 hover:text-gray-900 border border-transparent hover:border-gray-200 cursor-pointer transition-all"
          >
            cerrar
          </button>
        </div>
      )}

    </div>
  );
}
