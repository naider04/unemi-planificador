export interface Course {
  id: string;
  text: string;
  url: string;
}

export interface Activity {
  name: string;
  url: string;
  type: 'TAREA' | 'CUESTIONARIO' | 'ACTIVIDAD';
  icon: string;
  section: string;
  completionStatus: string[];
  aperture?: string | null;
  closure?: string | null;
  closureDateISO?: string | null;
  courseId?: string;
  courseName?: string;
  status?: string | null; // e.g. "Enviado", "Sin enviar"
  grade?: string | null; // e.g. "9.0"
  gradeOver?: string | null; // e.g. "10.0"
  timeRemaining?: string | null;
}

export interface QuizAttempt {
  numero: string | null;
  estado: string | null;
  comenzado: string | null;
  completado: string | null;
  duracion: string | null;
  calificacion: string | null;
  calificacion_sobre: string | null;
  porcentaje: string | null;
  revision_url: string | null;
}

export interface QuizInfo {
  intentos_permitidos: string | null;
  limite_tiempo: string | null;
  calificacion_final: string | null;
  calificacion_sobre: string | null;
  porcentaje: string | null;
  intentos: QuizAttempt[];
  no_mas_intentos?: boolean;
}

export interface ActivityDetails {
  aperture: string | null;
  apertureDateISO?: string | null;
  closure: string | null;
  closureDateISO: string | null;
  tipo_actividad: string | null;
  grupo?: string | null;
  intento?: string | null;
  estado_entrega?: string | null;
  estado_calificacion?: string | null;
  tiempo_restante?: string | null;
  ultima_modificacion?: string | null;
  calificacion?: string | null;
  calificacion_sobre?: string | null;
  calificado_por?: string | null;
  fecha_calificacion?: string | null;
  comentario_calificador?: string | null;
  archivos_enviados?: { nombre: string; url: string }[];
  archivos_adicionales?: { texto: string; url: string }[];
  requisitos_pendientes?: string[];
  requisitos_completados?: string[];
  detalle?: string | null;
  quiz_info?: QuizInfo | null;
  advertencia_preguntas?: string | null;
  por_hacer_calificacion?: boolean;
  hecho_calificacion?: boolean;
}

// Local Todo Task Structure
export interface TodoTask {
  id: string;
  title: string;
  courseId?: string;
  courseName?: string;
  activityUrl?: string; // If sourced from Moodle
  type: 'TAREA' | 'CUESTIONARIO' | 'ACTIVIDAD' | 'MANUAL';
  description?: string;
  closureDate: string | null; // ISO Date String
  aperture?: string | null;
  apertureDateISO?: string | null;
  completed: boolean;
  createdAt: string;
  status?: string | null;
  grade?: string | null;
  gradeOver?: string | null;
  gradingStatus?: string | null;
  estado_calificacion?: string | null;
  estado_entrega?: string | null;
  comentario_calificador?: string | null;
  advertencia_preguntas?: string | null;
  por_hacer_calificacion?: boolean;
  hecho_calificacion?: boolean;
  grupo?: string | null;
  moodleUsername?: string | null;
  moodleServer?: 'a' | 'b' | null;
  lastSyncedAt?: string;
}

export interface MoodleSession {
  username: string;
  server: 'a' | 'b';
  cookies: string;
  expired?: boolean;
}

export interface MoodleNotification {
  id: string;
  moodleUsername: string;
  moodleServer: 'a' | 'b';
  timestamp: number;
  title: string;
  message: string;
  type: 'new' | 'deadline' | 'status' | 'grade' | 'general';
  read: boolean;
  activityUrl?: string;
  courseName?: string;
}
