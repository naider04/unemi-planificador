import React, { useState, useEffect } from 'react';
import { Shield, Key, User, Server, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { MoodleSession } from '../types';

interface LoginPanelProps {
  onLoginSuccess: (session: MoodleSession) => void;
  activeSession: MoodleSession | null;
  onLogout: () => void;
  prefillUsername?: string;
  prefillServer?: 'a' | 'b' | 'upsdt';
  loginErrorMessage?: string | null;
}

const platformOptions = [
  {
    id: 'a' as const,
    name: 'UNEMI presencial/semipresencial',
    logo: '/aula-unemi.png',
    sub: 'aulagradoa.unemi.edu.ec'
  },
  {
    id: 'b' as const,
    name: 'UNEMI online',
    logo: '/aula-unemi.png',
    sub: 'aulagradob.unemi.edu.ec'
  },
  {
    id: 'upsdt' as const,
    name: 'UPSDT',
    logo: '/aula-upsdt.png',
    sub: 'aulas.upsdt.edu.ec'
  }
];

export default function LoginPanel({ 
  onLoginSuccess, 
  activeSession, 
  onLogout,
  prefillUsername = '',
  prefillServer = 'a',
  loginErrorMessage = null
}: LoginPanelProps) {
  const [username, setUsername] = useState(prefillUsername);
  const [password, setPassword] = useState('');
  const [server, setServer] = useState<'a' | 'b' | 'upsdt'>(prefillServer);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(loginErrorMessage);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (prefillUsername) {
      setUsername(prefillUsername);
    } else {
      setUsername('');
    }
  }, [prefillUsername]);

  useEffect(() => {
    if (prefillServer) {
      setServer(prefillServer);
    } else {
      setServer('a');
    }
  }, [prefillServer]);

  useEffect(() => {
    if (loginErrorMessage) {
      setError(loginErrorMessage);
    } else {
      setError(null);
    }
  }, [loginErrorMessage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Por favor, ingresa tu usuario y contraseña.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/moodle/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, server })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        const sessionObj: MoodleSession = {
          username,
          server,
          cookies: data.moodleSession
        };
        onLoginSuccess(sessionObj);
        setSuccessMsg('¡Conexión establecida con éxito!');
        setUsername('');
        setPassword('');
      } else {
        setError(data.error || 'La autenticación falló. Revisa tus credenciales.');
      }
    } catch (err: any) {
      setError('Error al conectar con el servidor. Revisa tu conexión de red o vuelve a intentarlo.');
    } finally {
      setLoading(false);
    }
  };

  if (activeSession) {
    const matchedOpt = platformOptions.find(o => o.id === activeSession.server);
    return (
      <div id="login-panel-connected" className="bg-white border border-gray-100 rounded-2xl p-6 shadow-xs">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600">
              <CheckCircle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Moodle Conectado</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Usuario: <span className="font-mono text-gray-700">{activeSession.username}</span>
              </p>
              <div className="flex items-center space-x-1.5 mt-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">
                  {matchedOpt ? matchedOpt.name : activeSession.server.toUpperCase()}
                </span>
              </div>
            </div>
          </div>
          <button
            id="btn-logout"
            onClick={onLogout}
            className="text-xs font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100/70 px-3 py-1.5 rounded-lg transition-colors duration-150"
          >
            Desconectar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div id="login-panel-form" className="bg-white border border-gray-100 rounded-2xl p-6 shadow-xs">
      <div className="flex items-center space-x-3 mb-5">
        <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-sm sm:text-base font-bold text-gray-900">Conectar Aula Virtual</h2>
          <p className="hidden sm:block text-[10px] sm:text-xs text-gray-500">Accede de forma segura para sincronizar tus fechas y tareas.</p>
        </div>
      </div>

      {error && (
        <div id="login-error" className="flex items-start space-x-2 bg-red-50 border border-red-100 rounded-xl p-3.5 mb-4 text-red-700 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {successMsg && (
        <div id="login-success" className="flex items-start space-x-2 bg-emerald-50 border border-emerald-100 rounded-xl p-3.5 mb-4 text-emerald-700 text-xs">
          <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{successMsg}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Server selection */}
        <div>
          <label className="block text-[10px] sm:text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wider">Aula Virtual / Institución</label>
          <div className="grid grid-cols-3 sm:grid-cols-1 gap-2">
            {platformOptions.map((opt) => (
              <button
                key={opt.id}
                id={`server-${opt.id}`}
                type="button"
                onClick={() => setServer(opt.id)}
                className={`flex flex-col sm:flex-row items-center justify-center sm:justify-start space-y-1.5 sm:space-y-0 sm:space-x-3 p-2 sm:p-3 rounded-xl text-xs font-semibold border transition-all duration-150 text-center sm:text-left cursor-pointer flex-1 ${
                  server === opt.id
                    ? 'bg-blue-50/50 text-blue-900 border-blue-500 ring-2 ring-blue-100 shadow-xs'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-gray-50 flex items-center justify-center border border-gray-150 p-1 shrink-0">
                  <img
                    src={opt.logo}
                    alt={opt.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-bold block text-gray-950 truncate text-[10px] sm:text-xs">
                    <span className="sm:hidden">{opt.id === 'a' ? 'UNEMI P/S' : opt.id === 'b' ? 'UNEMI Online' : 'UPSDT'}</span>
                    <span className="hidden sm:inline">{opt.name}</span>
                  </span>
                  <span className="hidden sm:block text-[10px] text-gray-400 font-mono mt-0.5">
                    {opt.sub}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Username */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">Usuario / Correo</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              <User className="w-4 h-4" />
            </div>
            <input
              id="username-input"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ej. mi_usuario"
              disabled={loading}
              className="block w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-xs placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-blue-100 focus:border-blue-500 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">Contraseña</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              <Key className="w-4 h-4" />
            </div>
            <input
              id="password-input"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              disabled={loading}
              className="block w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-xs placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-blue-100 focus:border-blue-500 disabled:opacity-50"
            />
          </div>
        </div>

        <button
          id="btn-submit-login"
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center space-x-2 py-3 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 text-white font-medium text-xs rounded-xl transition-all shadow-sm focus:outline-hidden"
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Conectando con Moodle...</span>
            </>
          ) : (
            <span>Conectar Cuenta</span>
          )}
        </button>
      </form>
    </div>
  );
}
