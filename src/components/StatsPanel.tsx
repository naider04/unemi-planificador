import React, { useState } from 'react';
import { TodoTask } from '../types';
import { Award, ChevronDown, ChevronUp, AlertCircle, BookOpen, Clock, CalendarDays, CheckCircle2, Filter } from 'lucide-react';

interface StatsPanelProps {
  tasks: TodoTask[];
  onNavigateToMoodleActivity?: (courseId: string, activityUrl: string) => void;
  onViewUpcomingActivities?: (courseId: string) => void;
}

interface CourseStats {
  courseName: string;
  courseId?: string;
  gradedTasksCount: number;
  unsubmittedTasksCount: number;
  sumGrades: number;
  sumMaxGrades: number;
  percentage: number | null;
  tasksList: {
    id: string;
    title: string;
    activityUrl?: string;
    grade: number;
    gradeOver: number;
    percentage: number;
    isOverdueUnsubmitted: boolean;
    closureDate: string | null;
  }[];
}

export default function StatsPanel({ tasks, onNavigateToMoodleActivity, onViewUpcomingActivities }: StatsPanelProps) {
  const [expandedCourses, setExpandedCourses] = useState<Record<string, boolean>>({});
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState<boolean>(false);

  const parseVal = (v: string | null | undefined): number | null => {
    if (v === null || v === undefined) return null;
    const clean = v.replace(/,/g, '.').trim();
    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
  };

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

  // Find unique accounts in task base
  const uniqueAccounts = Array.from(
    new Set(
      tasks
        .map(t => t.moodleUsername || 'Manual')
        .filter(Boolean)
    )
  ).sort() as string[];

  // Filter tasks by selected accounts
  const filteredTasks = tasks.filter(task => {
    if (selectedAccounts.length === 0) return true;
    return selectedAccounts.includes(task.moodleUsername || 'Manual');
  });

  // Group and compute stats for each course
  const coursesMap: Record<string, CourseStats> = {};

  filteredTasks.forEach(task => {
    if (!task.courseName) return;
    const courseKey = task.courseName;

    if (!coursesMap[courseKey]) {
      coursesMap[courseKey] = {
        courseName: task.courseName,
        courseId: task.courseId,
        gradedTasksCount: 0,
        unsubmittedTasksCount: 0,
        sumGrades: 0,
        sumMaxGrades: 0,
        percentage: null,
        tasksList: []
      };
    }

    const stats = coursesMap[courseKey];
    const grade = parseVal(task.grade);
    const gradeOver = parseVal(task.gradeOver) ?? 10.0; // default denominator is 10

    // Check if task is graded
    if (grade !== null) {
      stats.gradedTasksCount++;
      stats.sumGrades += grade;
      stats.sumMaxGrades += gradeOver;
      
      const pct = gradeOver > 0 ? (grade / gradeOver) * 100 : 0;
      stats.tasksList.push({
        id: task.id,
        title: task.title,
        activityUrl: task.activityUrl,
        grade,
        gradeOver,
        percentage: pct,
        isOverdueUnsubmitted: false,
        closureDate: task.closureDate
      });
    } 
    // Check if task is an unsubmitted overdue work (counts as 0%)
    else if (!task.completed && task.closureDate && new Date(task.closureDate) < new Date()) {
      stats.unsubmittedTasksCount++;
      // sumGrades += 0 (nothing to add)
      stats.sumMaxGrades += gradeOver;

      stats.tasksList.push({
        id: task.id,
        title: task.title,
        activityUrl: task.activityUrl,
        grade: 0,
        gradeOver,
        percentage: 0,
        isOverdueUnsubmitted: true,
        closureDate: task.closureDate
      });
    }
  });

  // Calculate percentages and convert map to array
  const courseStatsList: CourseStats[] = Object.values(coursesMap).map(stats => {
    if (stats.sumMaxGrades > 0) {
      stats.percentage = (stats.sumGrades / stats.sumMaxGrades) * 100;
    }
    // Sort this course's specific tasks descending so lowest scores or overdue tasks appear at top of list
    stats.tasksList.sort((a, b) => a.percentage - b.percentage);
    return stats;
  });

  // Sort courses:
  // "ordenadas con las que en promedio saco menores porcentajes... en el top. Las materias con mejores notas irían en el bottom."
  // If no grades, we put them at the very bottom (or percentage is null).
  courseStatsList.sort((a, b) => {
    if (a.percentage === null) return 1;
    if (b.percentage === null) return -1;
    return a.percentage - b.percentage;
  });

  const toggleCourseExpand = (courseName: string) => {
    setExpandedCourses(prev => ({
      ...prev,
      [courseName]: !prev[courseName]
    }));
  };

  const hasAnyGrades = courseStatsList.some(c => c.percentage !== null);

  return (
    <div id="timeline-card-wrapper" className="space-y-6">
      
      {/* Dynamic Summary Cards */}
      <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-xs">
        <div className="flex items-center space-x-3 mb-3">
          <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
            <Award className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Rendimiento Académico por Materia</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Tus materias ordenadas de menor a mayor promedio. Los trabajos no entregados vencidos penalizan con <span className="font-semibold text-rose-600">0%</span>.
            </p>
          </div>
        </div>

        {/* Filters Block */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-4 mt-2">
          {/* Label or left spacer */}
          <div className="md:col-span-3 flex items-center">
            <span className="text-xs font-bold text-gray-500">Filtrar rendimiento por cuenta:</span>
          </div>
          {/* Account Multi-select Container */}
          <div className="md:col-span-3 relative" id="account-filter-container">
            <button
              type="button"
              onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
              className="flex items-center justify-between w-full px-3 py-2 border border-gray-150 bg-white rounded-xl text-xs text-gray-700 focus:outline-hidden focus:ring-1 focus:ring-blue-500 focus:border-blue-500 cursor-pointer text-left relative"
            >
              <div className="flex items-center space-x-2 truncate pr-4">
                <Filter className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <span className="truncate">
                  {selectedAccounts.length === 0 
                    ? `Todas las Cuentas (${uniqueAccounts.length})` 
                    : `${selectedAccounts.length} cuenta${selectedAccounts.length > 1 ? 's' : ''}`
                  }
                </span>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 absolute right-3 top-2.5" />
            </button>

            {isAccountDropdownOpen && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setIsAccountDropdownOpen(false)} 
                />
                <div className="absolute left-0 right-0 mt-1.5 bg-white border border-gray-150 rounded-xl shadow-lg z-50 p-2.5 space-y-1 max-h-60 overflow-y-auto">
                  <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-gray-100 px-1 text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                    <span>Filtrar Cuentas</span>
                    {selectedAccounts.length > 0 && (
                      <button 
                        type="button"
                        onClick={() => setSelectedAccounts([])}
                        className="text-blue-600 hover:text-blue-700 cursor-pointer"
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                  {uniqueAccounts.length === 0 ? (
                    <div className="text-center py-2 text-xs text-gray-400 font-medium">
                      No hay cuentas disponibles
                    </div>
                  ) : (
                    uniqueAccounts.map(account => {
                      const isChecked = selectedAccounts.includes(account);
                      const accountCareers = Array.from(
                        new Set(
                          tasks
                            .filter(t => (t.moodleUsername || 'Manual') === account)
                            .map(t => getCourseDetails(t.courseName).carrera)
                            .filter((c): c is string => !!c && c !== 'Otros')
                        )
                      );
                      const careersText = accountCareers.length > 0 ? ` (${accountCareers.join(', ')})` : '';
                      return (
                        <label 
                          key={account} 
                          className="flex items-center space-x-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer transition-all text-xs font-semibold select-none text-gray-700"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              if (isChecked) {
                                setSelectedAccounts(selectedAccounts.filter(a => a !== account));
                              } else {
                                setSelectedAccounts([...selectedAccounts, account]);
                              }
                            }}
                            className="w-3.5 h-3.5 rounded-md border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          <span className="truncate">
                            {account === 'Manual' ? 'Tareas Manuales / Locales' : `${account}${careersText}`}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {!hasAnyGrades ? (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-8 text-center text-gray-400">
            <AlertCircle className="w-8 h-8 mx-auto text-gray-300 mb-2" />
            <p className="text-xs font-bold text-gray-600">Aún no se registran actividades calificadas o vencidas en tu agenda.</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Sincroniza tus materias en "Explorar Moodle" para descargar tus notas reales.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
            {(() => {
              const withGrades = courseStatsList.filter(c => c.percentage !== null);
              const lowest = withGrades[0];
              const highest = withGrades[withGrades.length - 1];
              
              // Calculate global weighted average
              let totalObtained = 0;
              let totalPossible = 0;
              withGrades.forEach(c => {
                totalObtained += c.sumGrades;
                totalPossible += c.sumMaxGrades;
              });
              const globalAvg = totalPossible > 0 ? (totalObtained / totalPossible) * 100 : 0;

              return (
                <>
                  <div className="bg-rose-50/40 border border-rose-100 rounded-2xl p-4 flex flex-col justify-between">
                    <div>
                      <span className="text-[10px] font-sans font-extrabold uppercase tracking-wider text-rose-600">Mayor Alerta ⭐</span>
                      <h4 className="text-xs font-bold text-gray-800 line-clamp-1 mt-1" title={lowest?.courseName}>
                        {lowest?.courseName.split('-')[0]?.trim() || lowest?.courseName}
                      </h4>
                    </div>
                    <div className="mt-2.5 flex items-baseline gap-1.5">
                      <span className="text-lg font-black text-rose-700">{lowest?.percentage?.toFixed(1)}%</span>
                      <span className="text-[10px] text-rose-550 font-mono">({lowest?.sumGrades.toFixed(1)}/{lowest?.sumMaxGrades.toFixed(1)})</span>
                    </div>
                  </div>

                  <div className="bg-blue-50/40 border border-blue-100 rounded-2xl p-4 flex flex-col justify-between">
                    <div>
                      <span className="text-[10px] font-sans font-extrabold uppercase tracking-wider text-blue-600">Promedio General 📈</span>
                      <h4 className="text-xs font-bold text-gray-800 mt-1">Acumulado Total</h4>
                    </div>
                    <div className="mt-2.5 flex items-baseline gap-1.5">
                      <span className="text-lg font-black text-blue-700">{globalAvg.toFixed(1)}%</span>
                      <span className="text-[10px] text-blue-550 font-mono">({totalObtained.toFixed(1)}/{totalPossible.toFixed(1)})</span>
                    </div>
                  </div>

                  <div className="bg-emerald-50/40 border border-emerald-100 rounded-2xl p-4 flex flex-col justify-between">
                    <div>
                      <span className="text-[10px] font-sans font-extrabold uppercase tracking-wider text-emerald-600">Mejor Rendimiento ✨</span>
                      <h4 className="text-xs font-bold text-gray-800 line-clamp-1 mt-1" title={highest?.courseName}>
                        {highest?.courseName.split('-')[0]?.trim() || highest?.courseName}
                      </h4>
                    </div>
                    <div className="mt-2.5 flex items-baseline gap-1.5">
                      <span className="text-lg font-black text-emerald-700">{highest?.percentage?.toFixed(1)}%</span>
                      <span className="text-[10px] text-emerald-550 font-mono">({highest?.sumGrades.toFixed(1)}/{highest?.sumMaxGrades.toFixed(1)})</span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* Courses List Ordered Lowest Grade to Highest Grade (Descending percentage at top) */}
      <div className="space-y-4">
        {courseStatsList.map((course, idx) => {
          const isExpanded = expandedCourses[course.courseName] ?? false;
          const isFailing = course.percentage !== null && course.percentage < 70;
          const isExcellent = course.percentage !== null && course.percentage >= 90;
          
          return (
            <div 
              key={course.courseName}
              className={`bg-white border rounded-3xl overflow-hidden transition-all duration-250 ${
                isExpanded ? 'shadow-xs border-blue-200' : 'border-gray-150 hover:border-gray-300'
              }`}
            >
              {/* Header block */}
              <div 
                onClick={() => toggleCourseExpand(course.courseName)}
                className="p-5 flex items-center justify-between cursor-pointer select-none bg-slate-50/30 hover:bg-slate-50/60 transition-colors"
              >
                <div className="flex-1 min-w-0 pr-4">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-mono font-extrabold text-blue-600 uppercase bg-blue-50 px-2 py-0.5 rounded-md">
                      Materia {idx + 1}
                    </span>
                    {course.unsubmittedTasksCount > 0 && (
                      <span className="text-[9px] font-bold text-rose-600 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                        ⚠️ {course.unsubmittedTasksCount} sin entregar
                      </span>
                    )}
                  </div>
                  <h3 className="text-sm font-bold text-gray-800 mt-1.5 leading-tight truncate" title={course.courseName}>
                    {course.courseName}
                  </h3>
                </div>

                <div className="flex items-center space-x-4 shrink-0">
                  <div className="text-right">
                    {course.percentage !== null ? (
                      <>
                        <div className="flex items-baseline justify-end gap-1.5">
                          <span className="text-xs font-mono font-bold text-gray-500">
                            {course.sumGrades.toFixed(2)} / {course.sumMaxGrades.toFixed(2)}
                          </span>
                          <span className={`text-sm font-black ${
                            isFailing ? 'text-rose-600' : isExcellent ? 'text-emerald-600' : 'text-blue-600'
                          }`}>
                            {course.percentage.toFixed(1)}%
                          </span>
                        </div>
                        <p className="text-[9px] text-gray-400 mt-0.5">
                          {course.gradedTasksCount} calificado{course.gradedTasksCount !== 1 ? 's' : ''}
                        </p>
                      </>
                    ) : (
                      <span className="text-xs font-bold text-gray-400 italic">Sin calificaciones</span>
                    )}
                  </div>

                  <div className="text-gray-400">
                    {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </div>
                </div>
              </div>

              {/* Collapsed tasks list */}
              {isExpanded && (
                <div className="border-t border-gray-100 bg-white p-5 animate-in slide-in-from-top-1 duration-150">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                    <h4 className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">
                      Desglose de Calificaciones ({course.tasksList.length} ítems analizados)
                    </h4>
                    {onViewUpcomingActivities && course.courseId && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewUpcomingActivities(course.courseId!);
                        }}
                        className="py-1 px-2.5 bg-blue-50 hover:bg-blue-100 text-blue-600 text-[11px] font-bold rounded-xl transition-all flex items-center space-x-1.5 cursor-pointer border border-blue-200/50 w-fit"
                      >
                        <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                        <span>Ver próximas actividades</span>
                      </button>
                    )}
                  </div>
                  
                  {course.tasksList.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">No hay notas registradas para esta materia.</p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {course.tasksList.map(taskItem => {
                        const isTaskFailing = taskItem.percentage < 70;
                        const isClickable = !!(taskItem.activityUrl && onNavigateToMoodleActivity);
                        
                        return (
                          <div 
                            key={taskItem.id} 
                            onClick={() => {
                              if (isClickable && onNavigateToMoodleActivity) {
                                onNavigateToMoodleActivity(course.courseId || '', taskItem.activityUrl || '');
                              }
                            }}
                            className={`py-3 flex items-start justify-between gap-4 group transition-colors ${
                              isClickable ? 'cursor-pointer hover:bg-slate-50/50' : ''
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className={`text-xs font-semibold leading-relaxed group-hover:text-blue-600 transition-colors ${
                                taskItem.isOverdueUnsubmitted ? 'text-rose-700 font-bold line-through opacity-75' : 'text-gray-700'
                              }`}>
                                {taskItem.isOverdueUnsubmitted ? '❌ ' : '📝 '}
                                {taskItem.title}
                              </p>
                              <div className="flex items-center space-x-2 mt-1">
                                {taskItem.isOverdueUnsubmitted ? (
                                  <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.2 rounded font-sans uppercase">
                                    No entregado (Vencido)
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded font-sans uppercase">
                                    Nota de Moodle
                                  </span>
                                )}
                                {taskItem.closureDate && (
                                  <span className="text-[9px] text-gray-400 font-mono">
                                    Cerró: {new Date(taskItem.closureDate).toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <span className={`text-xs font-mono font-extrabold ${
                                isTaskFailing ? 'text-rose-600' : 'text-gray-700'
                              }`}>
                                {taskItem.grade.toFixed(2)} / {taskItem.gradeOver.toFixed(2)}
                              </span>
                              <div className={`text-[10px] font-black mt-0.5 ${
                                isTaskFailing ? 'text-rose-600' : 'text-emerald-600'
                              }`}>
                                {taskItem.percentage.toFixed(1)}%
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
