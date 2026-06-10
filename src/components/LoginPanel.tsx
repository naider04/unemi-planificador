import React, { useState, useEffect } from 'react';
import { Shield, Key, User, Server, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { MoodleSession } from '../types';

interface LoginPanelProps {
  onLoginSuccess: (session: MoodleSession) => void;
  activeSession: MoodleSession | null;
  onLogout: () => void;
  prefillUsername?: string;
  prefillServer?: 'a' | 'b';
  loginErrorMessage?: string | null;
}

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
  const [server, setServer] = useState<'a' | 'b'>(prefillServer);
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
      setError('Por favor, ingresa tu usuario y contraseña de UNEMI.');
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
                  {activeSession.server === 'a' ? 'Aula Grado A' : 'Aula Grado B'}
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
          <h2 className="text-base font-bold text-gray-900">Conectar Aula Virtual UNEMI</h2>
          <p className="text-xs text-gray-500">Accede de forma segura para sincronizar tus fechados y tareas.</p>
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
        {/* Server Toggle */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">Servidor Aula</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              id="server-a"
              type="button"
              onClick={() => setServer('a')}
              className={`flex items-center justify-center space-x-1.5 py-2.5 px-4 rounded-xl text-xs font-medium border transition-all duration-150 ${
                server === 'a'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-100'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>Aula Grado A</span>
            </button>
            <button
              id="server-b"
              type="button"
              onClick={() => setServer('b')}
              className={`flex items-center justify-center space-x-1.5 py-2.5 px-4 rounded-xl text-xs font-medium border transition-all duration-150 ${
                server === 'b'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-100'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>Aula Grado B</span>
            </button>
          </div>
        </div>

        {/* Username */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">Usuario UNEMI</label>
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
