import React, { useState, useEffect } from 'react';
import { 
  Clock, CheckCircle, Trash2, Calendar, FileText, Square, CheckSquare, Search, 
  ChevronRight, ChevronDown, Filter, EyeOff, LayoutGrid, ListFilter, AlertCircle, PlusCircle, CheckSquare2,
  Download
} from 'lucide-react';
import { TodoTask } from '../types';

interface ActivityTimelineProps {
  tasks: TodoTask[];
  onToggleComplete: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onOpenNewTaskModal: () => void;
  onNavigateToMoodleActivity?: (courseId: string, activityUrl: string) => void;
  onClearAgenda?: () => void;
  navigationTrigger?: string | null;
  onClearNavigationTrigger?: () => void;
}

export default function ActivityTimeline({ 
  tasks, 
  onToggleComplete, 
  onDeleteTask, 
  onOpenNewTaskModal,
  onNavigateToMoodleActivity,
  onClearAgenda,
  navigationTrigger,
  onClearNavigationTrigger
}: ActivityTimelineProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCarrera, setSelectedCarrera] = useState<string>('all');
  const [selectedCourseId, setSelectedCourseId] = useState<string>('all');
  const [showCompleted, setShowCompleted] = useState<boolean>(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [collapsedWeeks, setCollapsedWeeks] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<'timeline' | 'weekly'>('timeline');
  const [weeklyAnchorDate, setWeeklyAnchorDate] = useState<Date>(() => new Date());

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
      return dateObj.toLocaleDateString('es-EC', options);
    } catch {
      return dateObj.toISOString();
    }
  };

  const handleDownloadCSV = () => {
    // Solo incluir actividades reales escaneadas (tipo diferente a 'MANUAL')
    const scannedTasks = tasks.filter(t => t.type !== 'MANUAL');

    const headers = [
      'ID de Actividad',
      'Título',
      'Tipo Académico',
      'Grupo / Individual',
      'ID del Curso',
      'Materia',
      'Enlace de la Actividad',
      'Detalle/Descripción',
      'Fecha de Apertura (ISO)',
      'Fecha de Apertura Formateada',
      'Fecha de Cierre (ISO)',
      'Fecha de Cierre Formateada',
      'Completada',
      'Fecha de Registro',
      'Estado de Entrega',
      'Calificación',
      'Calificación Máxima',
      'Estado de Calificación',
      'Retroalimentación del Docente'
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

    const rows = scannedTasks.map(task => [
      task.id || '',
      task.title || '',
      task.type || '',
      task.grupo ? task.grupo : 'Individual',
      task.courseId || '',
      task.courseName || '',
      task.activityUrl || '',
      task.description || '',
      task.apertureDateISO || '',
      task.apertureDateISO ? formatCalendarDate(task.apertureDateISO) : (task.aperture || ''),
      task.closureDate || '',
      task.closureDate ? formatCalendarDate(task.closureDate) : '',
      task.completed ? 'Sí' : 'No',
      task.createdAt || '',
      task.status || task.estado_entrega || '',
      task.grade || '',
      task.gradeOver || '',
      task.estado_calificacion || task.gradingStatus || '',
      task.comentario_calificador || ''
    ]);

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
    if (!dateStr) return { weekNumber: 9999, label: 'Actividades sin fecha de cierre específica', mondaySort: 9999999999999 };
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
      ? 'Actividades sin fecha de cierre específica'
      : weekNumber > 0 
        ? `Semana ${weekNumber}`
        : `Semana Especial / Extra`;

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

  // Find unique careers in task base
  const uniqueCarreras = Array.from(
    new Set(
      tasks
        .map(t => getCourseDetails(t.courseName).carrera)
        .filter(Boolean)
    )
  ).sort();

  // Find unique courses in task base for filtering
  const uniqueCourses = Array.from(
    new Map(
      tasks
        .filter(t => t.courseId && t.courseName)
        .filter(t => selectedCarrera === 'all' || getCourseDetails(t.courseName).carrera === selectedCarrera)
        .map(t => [t.courseId, t.courseName])
    ).entries()
  );

  // Auto-reset subject filter if the current subject does not belong to the newly selected career
  useEffect(() => {
    if (selectedCourseId !== 'all') {
      const match = tasks.find(t => t.courseId === selectedCourseId);
      if (match) {
        const itemCarrera = getCourseDetails(match.courseName).carrera;
        if (selectedCarrera !== 'all' && itemCarrera !== selectedCarrera) {
          setSelectedCourseId('all');
        }
      }
    }
  }, [selectedCarrera, selectedCourseId, tasks]);

  // Parse remaining duration in a human readable way
  const getRemainingTime = (isoString: string | null, completed: boolean) => {
    if (completed) return { text: 'Completado', color: 'text-emerald-600 bg-emerald-50 border-emerald-100/50' };
    if (!isoString) return { text: 'Sin fecha de cierre', color: 'text-gray-500 bg-gray-50 border-gray-100' };

    const deadline = new Date(isoString);
    const now = new Date();
    const diff = deadline.getTime() - now.getTime();

    if (diff < 0) {
      return { text: 'Cerrado/Vencido', color: 'text-rose-600 bg-rose-50 border-rose-100/50' };
    }

    const hrs = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hrs / 24);
    const remainingHrs = hrs % 24;

    if (days > 0) {
      if (days === 1) {
        return { 
          text: `Falta 1 día y ${remainingHrs} hrs`, 
          color: 'text-amber-700 bg-amber-50 border-amber-100/50 hover:bg-amber-100/40' 
        };
      }
      return { 
        text: `Faltan ${days} días`, 
        color: 'text-slate-700 bg-slate-50 border-slate-100 hover:bg-slate-100/60' 
      };
    } else {
      if (hrs === 0) {
        const mins = Math.floor(diff / (1000 * 60)) % 60;
        return { 
          text: `¡Faltan ${mins} minutos!`, 
          color: 'text-rose-700 bg-rose-50 border-rose-100 animate-pulse font-bold' 
        };
      }
      return { 
        text: `¡Faltan ${hrs} horas!`, 
        color: 'text-rose-700 bg-rose-50 border-rose-100 animate-pulse-slow' 
      };
    }
  };

  // Helper to format Spanish calendar strings
  const formatCalendarDate = (isoString: string | null) => {
    if (!isoString) return 'Sin fecha límite';
    const date = new Date(isoString);
    const options: Intl.DateTimeFormatOptions = { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Guayaquil'
    };
    return date.toLocaleDateString('es-EC', options);
  };

  const getTaskEmoji = (task: TodoTask): string => {
    // 3. Actividad no realizada y pasado fecha de cierre = ☠️
    if (!task.completed && task.closureDate) {
      const deadline = new Date(task.closureDate).getTime();
      const now = new Date().getTime();
      if (deadline < now) {
        return '☠️';
      }
    }

    // 4. Actividades que cierran en menos de un día = ⚠️
    if (!task.completed && task.closureDate) {
      const deadline = new Date(task.closureDate).getTime();
      const now = new Date().getTime();
      const diff = deadline - now;
      if (diff > 0 && diff < 24 * 60 * 60 * 1000) {
        return '⚠️';
      }
    }

    // 5. Actividades que cierran en menos de 10 días = 💪
    if (!task.completed && task.closureDate) {
      const deadline = new Date(task.closureDate).getTime();
      const now = new Date().getTime();
      const diff = deadline - now;
      if (diff >= 24 * 60 * 60 * 1000 && diff < 10 * 24 * 60 * 60 * 1000) {
        return '💪';
      }
    }

    // 2. Agrega emojis a las actividades con estas reglas de notas
    if (task.grade) {
      const g = parseFloat(task.grade);
      if (!isNaN(g)) {
        const max = task.gradeOver ? parseFloat(task.gradeOver) : 10;
        if (max > 0) {
          const pctVal = (g / max) * 100;
          if (pctVal >= 90 && pctVal <= 100) return '😄';
          if (pctVal >= 80 && pctVal < 90) return '🙂';
          if (pctVal >= 70 && pctVal < 80) return '🥲'; // sonriente con lagrima
          if (pctVal >= 60 && pctVal < 70) return '🥲'; // carita triste (con lagrimas as instructions copy)
          if (pctVal > 0 && pctVal < 60) return '👎';
        }
      }
    }

    return '';
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
      const matchesCarrera = selectedCarrera === 'all' || getCourseDetails(task.courseName).carrera === selectedCarrera;
      const matchesCourse = selectedCourseId === 'all' || task.courseId === selectedCourseId;
      const matchesCompleted = showCompleted || !task.completed;
      return matchesSearch && matchesCarrera && matchesCourse && matchesCompleted;
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

  return (
    <div id="timeline-card-wrapper" className="space-y-6">
      
      {/* 1. Header Toolbar Filters */}
      <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-xs">
        
        {/* Core numbers */}
        <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 mb-4 border-b border-gray-100 gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 flex items-center space-x-2">
              <span>Agenda de Actividades</span>
              <span className="text-xs font-mono font-bold bg-blue-50 text-blue-600 px-2.5 py-0.5 rounded-full">
                {pendingCount} pendientes
              </span>
            </h2>
            <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
              Planifica tu semana. Las tareas de Moodle se sincronizan con su fecha de vencimiento real.
            </p>
          </div>
          
          <div className="flex items-center space-x-2 shrink-0 flex-wrap gap-y-2">
            {/* View Mode Switching Tabs */}
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/60 mr-1 shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('timeline')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer ${
                  viewMode === 'timeline'
                    ? 'bg-white text-blue-600 shadow-2xs'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5 animate-in fade-in" />
                <span>Línea de Tiempo</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('weekly')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer ${
                  viewMode === 'weekly'
                    ? 'bg-white text-blue-600 shadow-2xs'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <Calendar className="w-3.5 h-3.5 animate-in fade-in" />
                <span>Vista Semanal</span>
              </button>
            </div>

            {onClearAgenda && tasks.length > 0 && (
              <button
                id="btn-clear-agenda"
                onClick={() => {
                  if (confirmClear) {
                    onClearAgenda();
                    setConfirmClear(false);
                  } else {
                    setConfirmClear(true);
                    setTimeout(() => setConfirmClear(false), 5000);
                  }
                }}
                className={`px-3 py-2 text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-all cursor-pointer active:scale-[0.97] border ${
                  confirmClear
                    ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600 animate-pulse'
                    : 'bg-rose-50 hover:bg-rose-100 text-rose-600 border-rose-100 hover:border-rose-200'
                }`}
                title={confirmClear ? 'Haz clic de nuevo para eliminar absolutamente todo por completo' : 'Vaciar la agenda completa'}
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                <span>{confirmClear ? '¿CONFIRMAR VACIAR TODO?' : 'Vaciar Agenda'}</span>
              </button>
            )}

            <button
              id="btn-download-csv"
              onClick={handleDownloadCSV}
              disabled={tasks.filter(t => t.type !== 'MANUAL').length === 0}
              className={`p-2 rounded-xl border flex items-center space-x-1 text-xs font-semibold transition-all ${
                tasks.filter(t => t.type !== 'MANUAL').length === 0
                  ? 'bg-gray-50 border-gray-150 text-gray-400 cursor-not-allowed opacity-60'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100/50 cursor-pointer active:scale-[0.98]'
              }`}
              title="Descargar todas las actividades escaneadas de Moodle en formato CSV"
            >
              <Download className="w-4.5 h-4.5" />
              <span>Descargar CSV</span>
            </button>
            
            <button
              id="btn-add-manual-task"
              onClick={onOpenNewTaskModal}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-sm flex items-center space-x-1.5 transition-all"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Nueva Actividad</span>
            </button>
          </div>
        </div>

        {/* Dynamic Filters panel */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-1">
          {/* Search */}
          <div className="md:col-span-4 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              id="task-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar actividad o palabra clave..."
              className="block w-full pl-9 pr-3 py-2 border border-gray-150 rounded-xl text-xs placeholder-gray-400 focus:outline-hidden focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Careers Filter */}
          <div className="md:col-span-3 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              <Filter className="w-4 h-4" />
            </div>
            <select
              id="task-career-filter"
              value={selectedCarrera}
              onChange={(e) => setSelectedCarrera(e.target.value)}
              className="block w-full pl-9 pr-3 py-2 border border-gray-150 rounded-xl text-xs text-gray-700 focus:outline-hidden focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">Todas las Carreras ({uniqueCarreras.length})</option>
              {uniqueCarreras.map(carr => (
                <option key={carr} value={carr}>{carr === 'Otros' ? 'Otros / Manuales' : carr}</option>
              ))}
            </select>
          </div>

          {/* Subjects Filter */}
          <div className="md:col-span-3 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              <Filter className="w-4 h-4" />
            </div>
            <select
              id="task-subject-filter"
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="block w-full pl-9 pr-3 py-2 border border-gray-150 rounded-xl text-xs text-gray-700 focus:outline-hidden focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">Todas las Materias ({uniqueCourses.length})</option>
              {uniqueCourses.map(([cid, cname]) => (
                <option key={cid} value={cid}>{cname}</option>
              ))}
            </select>
          </div>

          {/* Hide Completed Selector */}
          <div className="md:col-span-2 flex items-center justify-between md:justify-end px-1 gap-2">
            <label className="text-xs text-gray-500 cursor-pointer select-none">Mostrar Completadas</label>
            <button
              id="toggle-show-completed"
              onClick={() => setShowCompleted(!showCompleted)}
              className={`w-10 h-6 flex items-center rounded-full p-0.5 transition-colors duration-150 ${
                showCompleted ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <div
                className={`bg-white w-5 h-5 rounded-full shadow-xs transform duration-150 ${
                  showCompleted ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

      </div>

      {/* 2. Tasks Timeline View Sheet */}
      {viewMode === 'weekly' ? (() => {
        const getMondayOfDate = (d: Date) => {
          const copy = new Date(d);
          const day = copy.getDay();
          const diff = day === 0 ? -6 : 1 - day;
          copy.setDate(copy.getDate() + diff);
          copy.setHours(0, 0, 0, 0);
          return copy;
        };

        const formatShortDate = (d: Date) => {
          return d.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' });
        };

        const monday = getMondayOfDate(weeklyAnchorDate);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);

        const weekdaysName = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
        const daysOfWeekList = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(monday);
          d.setDate(monday.getDate() + i);
          return d;
        });

        const tasksWithoutClosureDate = filteredTasks.filter(t => !t.closureDate);

        return (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Weekly navigation toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-white border border-gray-150 rounded-2xl p-4 gap-3 shadow-2xs">
              <div className="flex items-center space-x-2">
                <Calendar className="w-5 h-5 text-blue-600 animate-pulse-slow" />
                <span className="text-xs sm:text-sm font-extrabold text-gray-800">
                  Semana del {formatShortDate(monday)} al {formatShortDate(sunday)} del {monday.getFullYear()}
                </span>
                {(() => {
                  const today = new Date();
                  const diff = monday.getTime() - getMondayOfDate(today).getTime();
                  if (diff === 0) {
                    return (
                      <span className="ml-1 px-2.5 py-0.5 text-[9px] bg-amber-500 text-white border border-amber-400 font-sans uppercase font-bold rounded-full animate-pulse inline-block">
                        Esta Semana
                      </span>
                    );
                  }
                  return null;
                })()}
              </div>
              <div className="flex items-center space-x-1.5 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => {
                    const prev = new Date(weeklyAnchorDate);
                    prev.setDate(prev.getDate() - 7);
                    setWeeklyAnchorDate(prev);
                  }}
                  className="px-3 py-1.5 text-xs border border-gray-200 hover:bg-slate-50 text-gray-700 rounded-lg font-bold cursor-pointer transition-all duration-150"
                >
                  ← Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setWeeklyAnchorDate(new Date())}
                  className="px-3 py-1.5 text-xs border border-blue-100 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg font-extrabold cursor-pointer transition-all duration-150"
                >
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = new Date(weeklyAnchorDate);
                    next.setDate(next.getDate() + 7);
                    setWeeklyAnchorDate(next);
                  }}
                  className="px-3 py-1.5 text-xs border border-gray-200 hover:bg-slate-50 text-gray-700 rounded-lg font-bold cursor-pointer transition-all duration-150"
                >
                  Siguiente →
                </button>
              </div>
            </div>

            {/* Render 7 day boxes */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-3">
              {daysOfWeekList.map((dayDate, idx) => {
                const dayTasks = filteredTasks.filter(t => {
                  if (!t.closureDate) return false;
                  const taskD = new Date(t.closureDate);
                  return taskD.getFullYear() === dayDate.getFullYear() &&
                         taskD.getMonth() === dayDate.getMonth() &&
                         taskD.getDate() === dayDate.getDate();
                });

                const today = new Date();
                const isDayToday = dayDate.getFullYear() === today.getFullYear() &&
                                   dayDate.getMonth() === today.getMonth() &&
                                   dayDate.getDate() === today.getDate();

                return (
                  <div 
                    key={idx} 
                    className={`flex flex-col border rounded-2xl p-3 min-h-[160px] bg-white transition-all ${
                      isDayToday 
                        ? 'border-blue-400 bg-blue-50/5 ring-1 ring-blue-300/20 shadow-xs' 
                        : 'border-slate-150 hover:border-slate-200'
                    }`}
                  >
                    {/* Day Label with date */}
                    <div className="flex items-center justify-between pb-1.5 border-b border-gray-100 mb-2">
                      <span className={`text-[10px] font-extrabold font-sans uppercase tracking-wider ${
                        isDayToday ? 'text-blue-600' : 'text-slate-500'
                      }`}>
                        {weekdaysName[idx]}
                      </span>
                      <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                        isDayToday ? 'bg-blue-500 text-white font-extrabold' : 'bg-slate-100 text-gray-500'
                      }`}>
                        {dayDate.getDate()} {dayDate.toLocaleDateString('es-EC', { month: 'short' }).substring(0, 3)}
                      </span>
                    </div>

                    {/* Tasks inside this weekday */}
                    <div className="flex-1 space-y-1.5 overflow-y-auto">
                      {dayTasks.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full min-h-[100px] text-center opacity-40 select-none">
                          <span className="text-sm">☕</span>
                          <span className="text-[9px] font-sans font-medium text-slate-400 mt-0.5">Sin entregas</span>
                        </div>
                      ) : (
                        dayTasks.map(task => {
                          const isClickable = !!(task.activityUrl && onNavigateToMoodleActivity);
                          return (
                            <div
                              key={task.id}
                              onClick={() => {
                                if (isClickable) {
                                  onNavigateToMoodleActivity(task.courseId || '', task.activityUrl || '');
                                }
                              }}
                              className={`group/task relative p-2.5 rounded-xl border text-left transition-all ${
                                task.completed
                                  ? 'bg-emerald-50/20 border-emerald-100/50 hover:bg-emerald-50/40 text-gray-400'
                                  : isClickable
                                    ? 'bg-slate-50/65 border-gray-200/80 hover:border-blue-300 hover:bg-blue-50/10 cursor-pointer shadow-3xs'
                                    : 'bg-slate-50/65 border-gray-200/80 shadow-3xs'
                              }`}
                              title={isClickable ? 'Presionar para navegar a la actividad en Moodle' : task.title}
                            >
                              <div className="flex items-center justify-between gap-1 flex-wrap mb-1">
                                {task.courseName && (
                                  <span className="text-[8px] font-bold text-slate-500 truncate max-w-[80px]" title={task.courseName}>
                                    {task.courseName.split('-')[0]?.trim() || task.courseName}
                                  </span>
                                )}
                                <div className="flex items-center space-x-1 shrink-0">
                                  <span className="text-[10px] select-none" title={task.grupo ? "Grupal" : "Individual"}>
                                    {task.grupo ? '👥' : '👤'}
                                  </span>
                                  <span className={`text-[7px] font-mono font-extrabold px-1 py-0.2 rounded uppercase ${
                                    task.type === 'TAREA' 
                                      ? 'bg-orange-50 text-orange-700' 
                                      : task.type === 'CUESTIONARIO' 
                                        ? 'bg-purple-50 text-purple-700' 
                                        : 'bg-sky-50 text-sky-700'
                                  }`}>
                                    {task.type === 'TAREA' ? 'Tarea' : task.type === 'CUESTIONARIO' ? 'Quiz' : 'Act.'}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-start gap-1.5">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleComplete(task.id);
                                  }}
                                  className={`mt-0.5 shrink-0 transition-transform active:scale-90 duration-100 ${
                                    task.completed ? 'text-emerald-500' : 'text-gray-300 hover:text-blue-500'
                                  }`}
                                >
                                  {task.completed ? (
                                    <CheckSquare2 className="w-3.5 h-3.5 stroke-[2.2]" />
                                  ) : (
                                    <Square className="w-3.5 h-3.5 stroke-[1.8]" />
                                  )}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <p className={`text-[10px] font-extrabold leading-normal hover:underline ${
                                    task.completed 
                                      ? 'line-through text-gray-400' 
                                      : 'text-gray-800 group-hover/task:text-blue-600 transition-colors'
                                  }`}>
                                    {getTaskEmoji(task) && `${getTaskEmoji(task)} `}
                                    {task.title}
                                  </p>
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <span className="text-[8px] text-gray-400 font-mono">
                                      Hora de cierre: {new Date(task.closureDate!).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false })}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Unscheduled pending tasks */}
            {tasksWithoutClosureDate.length > 0 && (
              <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4 mt-2">
                <h4 className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <span>📌</span> Pendientes Sin Fecha de Vencimiento ({tasksWithoutClosureDate.length})
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {tasksWithoutClosureDate.map(task => {
                    const isClickable = !!(task.activityUrl && onNavigateToMoodleActivity);
                    return (
                      <div
                        key={task.id}
                        onClick={() => {
                          if (isClickable) {
                            onNavigateToMoodleActivity(task.courseId || '', task.activityUrl || '');
                          }
                        }}
                        className={`flex items-start gap-2.5 p-3 bg-white border rounded-xl hover:shadow-2xs transition-all ${
                          task.completed
                            ? 'border-emerald-50/60 bg-emerald-50/10 text-gray-400'
                            : isClickable
                              ? 'border-slate-150 hover:border-blue-300 hover:bg-blue-50/5 cursor-pointer shadow-3xs'
                              : 'border-slate-150 shadow-3xs'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleComplete(task.id);
                          }}
                          className={`mt-0.5 shrink-0 transition-transform active:scale-95 duration-100 ${
                            task.completed ? 'text-emerald-500' : 'text-gray-300 hover:text-blue-500'
                          }`}
                        >
                          {task.completed ? (
                            <CheckSquare2 className="w-4 h-4 stroke-[2.2]" />
                          ) : (
                            <Square className="w-4 h-4 stroke-[1.8]" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0 text-left">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-[8px] font-extrabold uppercase px-1.5 bg-slate-100 rounded text-slate-500">
                              {task.type}
                            </span>
                            <span className="text-[10px] select-none shrink-0" title={task.grupo ? "Grupal" : "Individual"}>
                              {task.grupo ? '👥' : '👤'}
                            </span>
                          </div>
                          <p className={`text-[11px] font-bold leading-normal mt-1 hover:underline truncate ${
                            task.completed ? 'line-through text-gray-400' : 'text-gray-850'
                          }`}>
                            {task.title}
                          </p>
                          {task.courseName && (
                            <p className="text-[8px] text-gray-400 font-medium truncate mt-0.5">
                              {task.courseName}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })() : filteredTasks.length === 0 ? (
        <div id="timeline-empty-state" className="bg-white border border-gray-100 rounded-3xl p-12 text-center shadow-xs">
          <AlertCircle className="w-10 h-10 text-gray-200 mx-auto mb-2" />
          <p className="text-xs font-bold text-gray-700">Sin actividades detectadas</p>
          <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto leading-relaxed">
            No hay actividades que coincidan con tus filtros. Agrega una actividad manual o sincroniza tus materias de Moodle en la pestaña siguiente.
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
          <div id="timeline-rendered-body" className="space-y-6">
            {sortedGroups.map(group => {
              const isCurrent = isCurrentWeek(group.mondaySort);
              const isCollapsed = collapsedWeeks[group.label] !== undefined 
                ? collapsedWeeks[group.label] 
                : !isCurrent;

              return (
                <div key={group.label} className="space-y-3">
                  {/* Academic Week Header Banner */}
                  <button
                    type="button"
                    onClick={() => {
                      setCollapsedWeeks(prev => ({
                        ...prev,
                        [group.label]: !isCollapsed
                      }));
                    }}
                    className={`w-full flex items-center space-x-2.5 border rounded-xl px-3 py-2 text-left transition-all hover:bg-slate-50 cursor-pointer ${
                      isCurrent 
                        ? 'bg-blue-50 border-blue-400 text-blue-950 shadow-xs ring-1 ring-blue-300/30' 
                        : 'bg-slate-50/70 border-slate-200/40 text-slate-800'
                    }`}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                    )}
                    <Calendar className={`w-4 h-4 shrink-0 ${isCurrent ? 'text-blue-605' : 'text-slate-500'}`} />
                    <div className="flex-1 min-w-0 pr-2">
                      <span className="text-xs font-bold font-sans text-slate-850">
                        {group.label}
                      </span>
                      {isCurrent && (
                        <span className="ml-2 px-2.5 py-0.5 text-[10px] bg-amber-500 text-white border border-amber-400 font-sans uppercase tracking-wider font-extrabold rounded-full shadow-xs animate-pulse inline-block">
                          Semana Actual
                        </span>
                      )}
                    </div>
                    {(() => {
                      const completedCount = group.tasks.filter(t => t.completed).length;
                      const pendingCount = group.tasks.length - completedCount;
                      const weekEmojis = group.tasks.map(t => getTaskEmoji(t)).filter(e => e !== '');
                      return (
                        <div className="flex items-center space-x-1.5 shrink-0">
                          {weekEmojis.length > 0 && (
                            <span className="mr-1.5 text-xs select-none" title="Emojis en esta week">
                              {weekEmojis.join(' ')}
                            </span>
                          )}
                          <span className="text-[10px] font-bold bg-emerald-50/90 border border-emerald-250/25 text-emerald-700 px-2 py-0.5 rounded-md font-mono">
                            Enviadas: {completedCount}
                          </span>
                          <span className="text-[10px] font-bold bg-slate-100 border border-slate-250/15 text-slate-600 px-2 py-0.5 rounded-md font-mono">
                            No enviadas: {pendingCount}
                          </span>
                        </div>
                      );
                    })()}
                  </button>

                  {/* Left timeline rule of weekly segmented cards */}
                  {!isCollapsed && (
                    <div className="relative pl-6 md:pl-8 border-l-2 border-slate-200/50 ml-4 space-y-6 pt-2 pb-2">
                      {group.mondaySort === 9999999999999 ? (
                        group.tasks.map((task) => {
                          const remaining = getRemainingTime(task.closureDate, task.completed);
                          const isClickable = !!(task.activityUrl && onNavigateToMoodleActivity);
                          
                          return (
                            <div key={task.id} id={`timeline-row-${task.id}`} className="relative group">
                              <div className={`absolute -left-[30px] md:-left-[34px] top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 bg-white flex items-center justify-center transition-all duration-200 ${
                                task.completed 
                                  ? 'border-emerald-500 bg-emerald-50 scale-110' 
                                  : 'border-blue-500 hover:scale-105'
                              }`}>
                                {task.completed && <CheckCircle className="w-2.5 h-2.5 text-emerald-600 shrink-0" />}
                              </div>

                              <div 
                                onClick={() => {
                                  if (isClickable) {
                                    onNavigateToMoodleActivity(task.courseId || '', task.activityUrl || '');
                                  }
                                }}
                                className={`bg-white border rounded-2xl p-4 md:p-5 shadow-2xs hover:shadow-xs transition-all duration-205 flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                                  task.completed 
                                    ? 'border-emerald-50/70 bg-emerald-50/10' 
                                    : 'border-gray-100 hover:border-gray-205'
                                } ${
                                  isClickable 
                                    ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/5' 
                                    : ''
                                }`}
                              >
                                <div className="flex items-start space-x-3.5 flex-1 min-w-0">
                                  <button
                                    id={`check-task-${task.id}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onToggleComplete(task.id);
                                    }}
                                    className={`mt-0.5 shrink-0 transition-transform active:scale-95 duration-100 ${
                                      task.completed ? 'text-emerald-500' : 'text-gray-300 hover:text-blue-500'
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
                                        <span className="text-[10px] font-bold text-slate-500 truncate max-w-[200px]" title={task.courseName}>
                                          {task.courseName.split('-')[0]?.trim() || task.courseName}
                                        </span>
                                      )}
                                      <span className="text-[11px] text-gray-300">•</span>
                                      <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
                                        task.type === 'TAREA' 
                                          ? 'bg-orange-50 text-orange-700 border border-orange-100/50' 
                                          : task.type === 'CUESTIONARIO' 
                                            ? 'bg-purple-50 text-purple-700 border border-purple-100/50' 
                                            : 'bg-sky-50 text-sky-700 border border-sky-100/50'
                                      }`}>
                                        {task.type}
                                      </span>
                                    </div>

                                    <h3 className="text-xs md:text-sm font-bold mt-1 leading-snug flex items-center gap-1 min-w-0">
                                      {getTaskEmoji(task) && (
                                        <span className="shrink-0 no-underline inline-block font-normal text-slate-800" style={{ textDecoration: 'none' }}>
                                          {getTaskEmoji(task)}
                                        </span>
                                      )}
                                      <span className={`truncate hover:underline ${
                                        task.completed ? 'text-gray-400 line-through' : 'text-gray-955 group-hover:text-blue-600 transition-colors'
                                      }`}>
                                        {task.title}
                                      </span>
                                    </h3>

                                    {(task.type === 'TAREA' || task.type === 'CUESTIONARIO') && (
                                      <div className="flex flex-wrap gap-1.5 mt-2">
                                        {(() => {
                                          const statusStr = task.status || (task.completed ? 'Entregado' : 'No entregado');
                                          const isCalificado = statusStr.toLowerCase().includes('calificad');
                                          const isEntregado = statusStr.toLowerCase().includes('entregad') || statusStr.toLowerCase().includes('enviad') || statusStr.toLowerCase().includes('finalizad');
                                          const isBorrador = statusStr.toLowerCase().includes('borrador');
                                          
                                          let bgClass = 'bg-slate-50 text-slate-700 border-slate-200';
                                          if (isCalificado) bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                                          else if (isEntregado) bgClass = 'bg-blue-50 text-blue-700 border-blue-200/60';
                                          else if (isBorrador) bgClass = 'bg-amber-50 text-amber-700 border-amber-200';
                                          else if (statusStr.toLowerCase().includes('no entrenado') || statusStr.toLowerCase().includes('sin entregar') || statusStr.toLowerCase().includes('no entregad')) bgClass = 'bg-rose-50 text-rose-700 border-rose-200';

                                          return (
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border flex items-center gap-1 ${bgClass}`}>
                                              <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0"></span>
                                              {statusStr}
                                            </span>
                                          );
                                        })()}

                                        {task.grade && (
                                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg border bg-gradient-to-r from-teal-50/80 to-emerald-50/80 text-teal-800 border-teal-200/60">
                                            Nota: {task.grade} {task.gradeOver ? `/ ${task.gradeOver}` : ''}
                                          </span>
                                        )}

                                        {(task.estado_calificacion || task.gradingStatus) && (
                                          (() => {
                                            const gradStr = task.estado_calificacion || task.gradingStatus || '';
                                            const isGraded = gradStr.toLowerCase().includes('calificad');
                                            const bgGradClass = isGraded 
                                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200/80' 
                                              : 'bg-amber-50 text-amber-800 border-amber-200/80';
                                            return (
                                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border flex items-center gap-1 ${bgGradClass}`}>
                                                <span className="font-semibold text-slate-500 text-[9px] uppercase">Estado Calif:</span>
                                                <span>{gradStr}</span>
                                              </span>
                                            );
                                          })()
                                        )}
                                      </div>
                                    )}

                                    {task.advertencia_preguntas && (
                                      <div className="mt-2 text-[10px] text-amber-700 bg-amber-50/50 border border-amber-100 rounded-lg px-2 py-1 flex items-center space-x-1.5 w-fit">
                                        <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                        <span className="font-semibold">{task.advertencia_preguntas}</span>
                                      </div>
                                    )}

                                    {task.por_hacer_calificacion && (
                                      <div className="mt-2 text-[10px] text-xs font-semibold text-amber-700 bg-amber-50/45 border border-amber-200/55 rounded-lg px-2 py-1 flex items-center space-x-1.5 w-fit animate-in fade-in duration-350">
                                        <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                        <span>
                                          Pendiente - Realizar test/actividad en Moodle
                                        </span>
                                      </div>
                                    )}

                                    {task.hecho_calificacion && (
                                      <div className="mt-2 text-[10px] text-emerald-700 bg-emerald-50/45 border border-emerald-200/55 rounded-lg px-2 py-1 flex items-center space-x-1.5 w-fit animate-in fade-in duration-350">
                                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                        <span>
                                          Completado - Calificación en proceso en Moodle
                                        </span>
                                      </div>
                                    )}

                                    {task.comentario_calificador && (
                                      <div className="mt-2 bg-gray-50/85 border border-gray-150 rounded-xl p-2.5 text-gray-600 max-w-md animate-in fade-in duration-200">
                                        <p className="font-bold text-[9px] text-gray-500 mb-0.5 uppercase tracking-wider">Retroalimentación del Docente:</p>
                                        <p className="leading-relaxed text-[10px] font-mono italic">"{task.comentario_calificador}"</p>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="flex flex-col items-center md:items-end gap-2 mt-2 md:mt-0 pt-3 md:pt-0 border-t md:border-t-0 border-gray-150 shrink-0 select-none">
                                  <div className="text-[11px] font-medium text-slate-500 flex items-center space-x-1">
                                    {task.grupo ? (
                                      <>
                                        <span>👥</span>
                                        <span className="text-[10px] bg-blue-50 border border-blue-100/55 text-blue-700 px-1.5 py-0.5 rounded font-bold">
                                          Grupal
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <span>👤</span>
                                        <span className="text-[10px] bg-slate-50 border border-slate-150/45 text-slate-600 px-1.5 py-0.5 rounded font-bold">
                                          Individual
                                        </span>
                                      </>
                                    )}
                                  </div>
                                  <div className="flex items-center justify-between md:justify-end space-x-2.5 w-full md:w-auto">
                                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border font-mono ${remaining.color}`}>
                                      {remaining.text}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (() => {
                        const weekdays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
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

                        return (
                          <div className="space-y-6">
                            {daysArray.map((day, dayIdx) => {
                              const dayStr = day.dayDate.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' });
                              const allCompleted = day.tasks.length > 0 && day.tasks.every(t => t.completed);
                              return (
                                <div key={dayIdx} className="relative pl-2 group space-y-3">
                                  {/* Chronic Timeline Bullet mark aligned with standard left timeline line */}
                                  <div className={`absolute -left-[31px] md:-left-[35px] top-[10px] w-3.5 h-3.5 rounded-full border-2 bg-white flex items-center justify-center transition-all duration-200 z-10 ${
                                    day.tasks.length === 0 
                                      ? 'border-emerald-400 bg-emerald-50/30' 
                                      : allCompleted
                                        ? 'border-emerald-500 bg-emerald-50 scale-105'
                                        : 'border-blue-500 hover:scale-105'
                                  }`}>
                                    {day.tasks.length === 0 ? (
                                      <span className="text-[7px] leading-none text-emerald-600 font-bold">✓</span>
                                    ) : allCompleted ? (
                                      <CheckCircle className="w-2 h-2 text-emerald-600 shrink-0" />
                                    ) : null}
                                  </div>

                                  {/* Day label header tag */}
                                  <div className="flex items-center space-x-2 text-xs font-bold text-slate-500 select-none pb-0.5">
                                    <div className="flex items-center space-x-1.5 bg-slate-100/90 border border-slate-200/50 px-2.5 py-0.5 rounded-lg shadow-3xs">
                                      <span className="text-slate-700 font-extrabold uppercase font-sans tracking-wide text-[9px]">{day.name}</span>
                                      <span className="text-slate-400 font-mono text-[9px] font-bold">{dayStr}</span>
                                    </div>
                                    <div className="flex-1 h-px bg-slate-150/40" />
                                  </div>

                                  {day.tasks.length === 0 ? (
                                    <div className="bg-emerald-50/15 border border-emerald-100/30 rounded-2xl p-4 text-left shadow-3xs flex items-center space-x-2.5">
                                      <span className="text-sm select-none">☕</span>
                                      <span className="text-[11px] font-extrabold text-emerald-800 tracking-wider uppercase leading-none">Día libre: Sin entregas programadas</span>
                                    </div>
                                  ) : (
                                    <div className="bg-white border border-gray-100 rounded-2xl shadow-3xs overflow-hidden divide-y divide-gray-100/80">
                                      {day.tasks.map((task) => {
                                        const remaining = getRemainingTime(task.closureDate, task.completed);
                                        const isClickable = !!(task.activityUrl && onNavigateToMoodleActivity);
                                        
                                        return (
                                          <div 
                                            key={task.id} 
                                            id={`timeline-row-${task.id}`}
                                            onClick={() => {
                                              if (isClickable) {
                                                onNavigateToMoodleActivity(task.courseId || '', task.activityUrl || '');
                                              }
                                            }}
                                            className={`p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-205 ${
                                              task.completed 
                                                ? 'bg-emerald-50/5' 
                                                : 'hover:bg-slate-50/40'
                                            } ${
                                              isClickable 
                                                ? 'cursor-pointer' 
                                                : ''
                                            }`}
                                          >
                                            <div className="flex items-start space-x-3.5 flex-1 min-w-0">
                                              {/* Checkbox trigger button */}
                                              <button
                                                id={`check-task-${task.id}`}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  onToggleComplete(task.id);
                                                }}
                                                className={`mt-0.5 shrink-0 transition-transform active:scale-95 duration-100 ${
                                                  task.completed ? 'text-emerald-500' : 'text-gray-300 hover:text-blue-500'
                                                }`}
                                              >
                                                {task.completed ? (
                                                  <CheckSquare2 className="w-5 h-5 stroke-[2.2]" />
                                                ) : (
                                                  <Square className="w-5 h-5 stroke-[1.8]" />
                                                )}
                                              </button>

                                              {/* Info lines text */}
                                              <div className="flex-1 min-w-0">
                                                <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                                                  {/* Course Name tags */}
                                                  {task.courseName && (
                                                    <span className="text-[10px] font-bold text-slate-500 truncate max-w-[200px]" title={task.courseName}>
                                                      {task.courseName.split('-')[0]?.trim() || task.courseName}
                                                    </span>
                                                  )}
                                                  <span className="text-[11px] text-gray-300">•</span>
                                                  {/* Sourcing badges category */}
                                                  <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
                                                    task.type === 'TAREA' 
                                                      ? 'bg-orange-50 text-orange-700 border border-orange-100/50' 
                                                      : task.type === 'CUESTIONARIO' 
                                                        ? 'bg-purple-50 text-purple-700 border border-purple-100/50' 
                                                        : 'bg-sky-50 text-sky-700 border border-sky-100/50'
                                                  }`}>
                                                    {task.type}
                                                  </span>
                                                </div>

                                                {/* Heading title */}
                                                <h3 className="text-xs md:text-sm font-bold mt-1 leading-snug flex items-center gap-1 min-w-0">
                                                  {getTaskEmoji(task) && (
                                                    <span className="shrink-0 no-underline inline-block font-normal text-slate-800" style={{ textDecoration: 'none' }}>
                                                      {getTaskEmoji(task)}
                                                    </span>
                                                  )}
                                                  <span className={`truncate hover:underline ${
                                                    task.completed ? 'text-gray-400 line-through' : 'text-gray-955 group-hover:text-blue-600 transition-colors'
                                                  }`}>
                                                    {task.title}
                                                  </span>
                                                </h3>

                                                {/* Grading/submission status badge block */}
                                                {(task.type === 'TAREA' || task.type === 'CUESTIONARIO') && (
                                                  <div className="flex flex-wrap gap-1.5 mt-2">
                                                    {/* Submission Status */}
                                                    {(() => {
                                                      const statusStr = task.status || (task.completed ? 'Entregado' : 'No entregado');
                                                      const isCalificado = statusStr.toLowerCase().includes('calificad');
                                                      const isEntregado = statusStr.toLowerCase().includes('entregad') || statusStr.toLowerCase().includes('enviad') || statusStr.toLowerCase().includes('finalizad');
                                                      const isBorrador = statusStr.toLowerCase().includes('borrador');
                                                      
                                                      let bgClass = 'bg-slate-50 text-slate-700 border-slate-200';
                                                      if (isCalificado) bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                                                      else if (isEntregado) bgClass = 'bg-blue-50 text-blue-700 border-blue-200/60';
                                                      else if (isBorrador) bgClass = 'bg-amber-50 text-amber-700 border-amber-200';
                                                      else if (statusStr.toLowerCase().includes('no entrenado') || statusStr.toLowerCase().includes('sin entregar') || statusStr.toLowerCase().includes('no entregad')) bgClass = 'bg-rose-50 text-rose-700 border-rose-200';

                                                      return (
                                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border flex items-center gap-1 ${bgClass}`}>
                                                          <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0"></span>
                                                          {statusStr}
                                                        </span>
                                                      );
                                                    })()}

                                                    {/* Note / Grade */}
                                                    {task.grade && (
                                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg border bg-gradient-to-r from-teal-50/80 to-emerald-50/80 text-teal-800 border-teal-200/60">
                                                        Nota: {task.grade} {task.gradeOver ? `/ ${task.gradeOver}` : ''}
                                                      </span>
                                                    )}

                                                    {/* Grading Status (Estado de Calificación) */}
                                                    {(task.estado_calificacion || task.gradingStatus) && (
                                                      (() => {
                                                        const gradStr = task.estado_calificacion || task.gradingStatus || '';
                                                        const isGraded = gradStr.toLowerCase().includes('calificad');
                                                        const bgGradClass = isGraded 
                                                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200/80' 
                                                          : 'bg-amber-50 text-amber-800 border-amber-200/80';
                                                        return (
                                                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border flex items-center gap-1 ${bgGradClass}`}>
                                                            <span className="font-semibold text-slate-500 text-[9px] uppercase">Estado Calif:</span>
                                                            <span>{gradStr}</span>
                                                          </span>
                                                        );
                                                      })()
                                                    )}
                                                  </div>
                                                )}

                                                {/* WARNINGS AND FEEDBACK OVERLAYS */}
                                                {task.advertencia_preguntas && (
                                                  <div className="mt-2 text-[10px] text-amber-700 bg-amber-50/50 border border-amber-100 rounded-lg px-2 py-1 flex items-center space-x-1.5 w-fit">
                                                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                                    <span className="font-semibold">{task.advertencia_preguntas}</span>
                                                  </div>
                                                )}

                                                {task.por_hacer_calificacion && (
                                                  <div className="mt-2 text-[10px] text-xs font-semibold text-amber-700 bg-amber-50/45 border border-amber-200/55 rounded-lg px-2 py-1 flex items-center space-x-1.5 w-fit">
                                                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                                    <span>
                                                      Pendiente - Realizar test/actividad en Moodle
                                                    </span>
                                                  </div>
                                                )}

                                                {task.hecho_calificacion && (
                                                  <div className="mt-2 text-[10px] text-emerald-700 bg-emerald-50/45 border border-emerald-200/55 rounded-lg px-2 py-1 flex items-center space-x-1.5 w-fit">
                                                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                                    <span>
                                                      Completado - Calificación en proceso en Moodle
                                                    </span>
                                                  </div>
                                                )}

                                                {task.comentario_calificador && (
                                                  <div className="mt-2 bg-gray-50/85 border border-gray-150 rounded-xl p-2.5 text-gray-600 max-w-md">
                                                    <p className="font-bold text-[9px] text-gray-500 mb-0.5 uppercase tracking-wider">Retroalimentación del Docente:</p>
                                                    <p className="leading-relaxed text-[10px] font-mono italic">"{task.comentario_calificador}"</p>
                                                  </div>
                                                )}
                                              </div>
                                            </div>

                                            {/* Right tags & remaining indicator */}
                                            <div className="flex flex-col items-center md:items-end gap-2 mt-2 md:mt-0 pt-3 md:pt-0 border-t md:border-t-0 border-gray-150 shrink-0 select-none">
                                              <div className="text-[11px] font-medium text-slate-500 flex items-center space-x-1">
                                                {task.grupo ? (
                                                  <>
                                                    <span>👥</span>
                                                    <span className="text-[10px] bg-blue-50 border border-blue-100/55 text-blue-700 px-1.5 py-0.5 rounded font-bold">
                                                      Grupal
                                                    </span>
                                                  </>
                                                ) : (
                                                  <>
                                                    <span>👤</span>
                                                    <span className="text-[10px] bg-slate-50 border border-slate-150/45 text-slate-600 px-1.5 py-0.5 rounded font-bold">
                                                      Individual
                                                    </span>
                                                  </>
                                                )}
                                              </div>
                                              <div className="flex items-center justify-between md:justify-end space-x-2.5 w-full md:w-auto">
                                                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border font-mono ${remaining.color}`}>
                                                  {remaining.text}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
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
