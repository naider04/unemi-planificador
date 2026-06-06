import React, { useState } from 'react';
import { X, Calendar, BookOpen, Tag, PlusCircle, AlignLeft } from 'lucide-react';
import { TodoTask, Course } from '../types';

interface NewTaskModalProps {
  courses: Course[];
  isOpen: boolean;
  onClose: () => void;
  onSaveTask: (task: TodoTask) => void;
}

export default function NewTaskModal({ courses, isOpen, onClose, onSaveTask }: NewTaskModalProps) {
  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState('manual');
  const [customCourseName, setCustomCourseName] = useState('');
  const [type, setType] = useState<'TAREA' | 'CUESTIONARIO' | 'ACTIVIDAD' | 'MANUAL'>('MANUAL');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title) {
      alert('Por favor, ingresa el título de la actividad.');
      return;
    }

    let finalCourseId: string | undefined = undefined;
    let finalCourseName: string | undefined = undefined;

    if (courseId !== 'manual') {
      const parentCourse = courses.find(c => c.id === courseId);
      if (parentCourse) {
        finalCourseId = parentCourse.id;
        finalCourseName = parentCourse.text;
      }
    } else if (customCourseName.trim()) {
      finalCourseId = `manual-${Date.now()}`;
      finalCourseName = customCourseName.trim();
    }

    const newTask: TodoTask = {
      id: `manual-activity-${Date.now()}`,
      title,
      courseId: finalCourseId,
      courseName: finalCourseName,
      type,
      description: description.trim() || undefined,
      closureDate: dueDate ? new Date(dueDate).toISOString() : null,
      completed: false,
      createdAt: new Date().toISOString()
    };

    onSaveTask(newTask);
    
    // Clear state
    setTitle('');
    setCourseId('manual');
    setCustomCourseName('');
    setType('MANUAL');
    setDescription('');
    setDueDate('');
    onClose();
  };

  return (
    <div id="new-task-modal-backdrop" className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
      <div 
        id="new-task-modal"
        className="bg-white border border-gray-100 rounded-3xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center space-x-2">
            <PlusCircle className="text-blue-600 w-5 h-5" />
            <h3 className="text-sm font-bold text-gray-900">Programar Nueva Actividad</h3>
          </div>
          <button 
            id="close-modal-btn"
            onClick={onClose} 
            className="p-1 hover:bg-gray-150 rounded-lg text-gray-400 hover:text-gray-900 transition-colors"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Content form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1 uppercase tracking-wider">Título de la Actividad *</label>
            <input
              id="new-task-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ej. Resolver cuestionario de Práctica 1"
              className="text-xs w-full px-3.5 py-2.5 border border-gray-200 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Sourcing Category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1 uppercase tracking-wider">Tipo Actividad</label>
              <div className="relative">
                <Tag className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                <select
                  id="new-task-type"
                  value={type}
                  onChange={(e: any) => setType(e.target.value)}
                  className="text-xs w-full pl-9 pr-3 py-2.5 bg-white border border-gray-200 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="MANUAL">⚙️ Actividad Manual</option>
                  <option value="TAREA">📝 Tarea Académica</option>
                  <option value="CUESTIONARIO">📋 Cuestionario / Examen</option>
                  <option value="ACTIVIDAD">📚 General</option>
                </select>
              </div>
            </div>

            {/* Closing Deadline Date */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1 uppercase tracking-wider">Cierre (Fecha & Hora)</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                <input
                  id="new-task-date"
                  type="datetime-local"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="text-xs w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Context Course Association */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1 uppercase tracking-wider">Asociar Materia</label>
              <div className="relative">
                <BookOpen className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                <select
                  id="new-task-course-select"
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                  className="text-xs w-full pl-9 pr-3 py-2.5 bg-white border border-gray-200 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="manual">Materia Personalizada / Ninguna</option>
                  {courses.map(course => (
                    <option key={course.id} value={course.id}>{course.text}</option>
                  ))}
                </select>
              </div>
            </div>

            {courseId === 'manual' && (
              <div className="animate-fade-in">
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wider">Nombre Materia Personalizada</label>
                <input
                  id="new-task-custom-course"
                  type="text"
                  value={customCourseName}
                  onChange={(e) => setCustomCourseName(e.target.value)}
                  placeholder="ej. Algebra Lineal o Investigaciones Libres"
                  className="text-xs w-full px-3.5 py-2.5 border border-gray-200 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            )}
          </div>

          {/* Helper notes / descriptor */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1 uppercase tracking-wider">Detalles / Anotaciones</label>
            <div className="relative">
              <AlignLeft className="absolute left-3 top-3.5 w-4 h-4 text-gray-400" />
              <textarea
                id="new-task-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Apunta guías de estudio, temas de examen, compañeros de grupo..."
                className="text-xs w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex space-x-2 pt-4 border-t border-gray-100 justify-end">
            <button
              id="cancel-modal-btn"
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 rounded-xl transition-all"
            >
              Cancelar
            </button>
            <button
              id="save-task-btn"
              type="submit"
              className="px-6 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-all"
            >
              Guardar Actividad
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
