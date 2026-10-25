import React, { useState, useEffect } from 'react';
import { Shield, Key, User, Server, AlertCircle, CheckCircle, RefreshCw, Globe } from 'lucide-react';
import { MoodleSession } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { createOtherServerKey, getServerLabel, isOtherServer, normalizeBaseUrl } from '../shared/platforms';

interface LoginPanelProps {
  onLoginSuccess: (session: MoodleSession) => void;
  activeSession: MoodleSession | null;
  onLogout: () => void;
  prefillUsername?: string;
  prefillServer?: string;
  prefillBaseUrl?: string | null;
  loginErrorMessage?: string | null;
}

export default function LoginPanel({ 
  onLoginSuccess, 
  activeSession, 
  onLogout,
  prefillUsername = '',
  prefillServer = 'a',
  prefillBaseUrl = null,
  loginErrorMessage = null
}: LoginPanelProps) {
  const { t } = useLanguage();
  const [username, setUsername] = useState(prefillUsername);
  const [password, setPassword] = useState('');
  const [server, setServer] = useState<string>(isOtherServer(prefillServer) ? 'other' : prefillServer);
  const [otherUrl, setOtherUrl] = useState(prefillBaseUrl || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(loginErrorMessage);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const platformOptions = [
    {
      id: 'a',
      name: t('login.unemiPS'),
      shortName: 'UNEMI P/S',
      logo: '/aula-unemi.png',
      sub: 'aulagradoa.unemi.edu.ec'
    },
    {
      id: 'b',
      name: t('login.unemiOnline'),
      shortName: 'UNEMI Online',
      logo: '/aula-unemi.png',
      sub: 'aulagradob.unemi.edu.ec'
    },
    {
      id: 'other',
      name: t('login.otherPlatform'),
      shortName: t('login.otherPlatformShort'),
      logo: '',
      sub: t('login.otherPlatformSub')
    }
  ];

  useEffect(() => {
    if (prefillUsername) {
      setUsername(prefillUsername);
    } else {
      setUsername('');
    }
  }, [prefillUsername]);

  useEffect(() => {
    if (prefillServer) {
      setServer(isOtherServer(prefillServer) ? 'other' : prefillServer);
    } else {
      setServer('a');
    }
    if (prefillBaseUrl) {
      setOtherUrl(prefillBaseUrl);
    }
  }, [prefillServer, prefillBaseUrl]);

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
      setError(t('login.enterCredentials'));
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      let payloadServer = server;
      let baseUrl: string | null = null;

      if (server === 'other') {
        try {
          baseUrl = normalizeBaseUrl(otherUrl);
        } catch {
          setError(t('login.invalidUrl'));
          return;
        }
        if (!baseUrl) {
          setError(t('login.urlRequired'));
          return;
        }
        payloadServer = createOtherServerKey(baseUrl);
      }

      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/moodle/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, server: payloadServer, baseUrl })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        const sessionObj: MoodleSession = {
          username,
          server: data.server || payloadServer,
          baseUrl: data.base || baseUrl,
          cookies: data.moodleSession
        };
        onLoginSuccess(sessionObj);
        setSuccessMsg(t('login.connectedSuccess'));
        setUsername('');
        setPassword('');
      } else {
        setError(data.error || t('login.authFailed'));
      }
    } catch (err: any) {
      setError(t('login.networkError'));
    } finally {
      setLoading(false);
    }
  };

  if (activeSession) {
    const matchedOpt = platformOptions.find(o => o.id === activeSession.server);
    const activePlatformName = matchedOpt
      ? matchedOpt.name
      : getServerLabel(activeSession.server, activeSession.baseUrl);
    return (
      <div id="login-panel-connected" className="bg-white border border-gray-100 rounded-2xl p-6 shadow-xs">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600">
              <CheckCircle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">{t('login.connected')}</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {t('login.user')} <span className="font-mono text-gray-700">{activeSession.username}</span>
              </p>
              <div className="flex items-center space-x-1.5 mt-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">
                  {activePlatformName}
                </span>
              </div>
            </div>
          </div>
          <button
            id="btn-logout"
            onClick={onLogout}
            className="text-xs font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100/70 px-3 py-1.5 rounded-lg transition-colors duration-150 cursor-pointer"
          >
            {t('login.disconnect')}
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
          <h2 className="text-sm sm:text-base font-bold text-gray-900">{t('login.connectTitle')}</h2>
          <p className="hidden sm:block text-[10px] sm:text-xs text-gray-500">{t('login.connectSubtitle')}</p>
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
          <label className="block text-[10px] sm:text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wider">{t('login.institution')}</label>
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
                  {opt.logo ? (
                    <img
                      src={opt.logo}
                      alt={opt.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <Globe className="w-5 h-5 text-gray-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-bold block text-gray-950 truncate text-[10px] sm:text-xs">
                    <span className="sm:hidden">{opt.shortName}</span>
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

        {/* Custom Moodle platform URL */}
        {server === 'other' && (
          <div>
            <label className="block text-[10px] sm:text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">{t('login.platformUrl')}</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <Globe className="w-4 h-4" />
              </div>
              <input
                id="other-platform-url"
                type="text"
                required
                value={otherUrl}
                onChange={(e) => setOtherUrl(e.target.value)}
                placeholder="https://moodle.example.com"
                disabled={loading}
                className="block w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-xs placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-blue-100 focus:border-blue-500 disabled:opacity-50"
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">{t('login.platformUrlHelp')}</p>
          </div>
        )}

        {/* Username */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">{t('login.username')}</label>
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
              placeholder={t('login.usernamePlaceholder')}
              disabled={loading}
              className="block w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-xs placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-blue-100 focus:border-blue-500 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">{t('login.password')}</label>
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
              placeholder={t('login.passwordPlaceholder')}
              disabled={loading}
              className="block w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-xs placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-blue-100 focus:border-blue-500 disabled:opacity-50"
            />
          </div>
        </div>

        <button
          id="btn-submit-login"
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center space-x-2 py-3 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 text-white font-medium text-xs rounded-xl transition-all shadow-sm focus:outline-hidden cursor-pointer"
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>{t('login.connectingBtn')}</span>
            </>
          ) : (
            <span>{t('login.connectBtn')}</span>
          )}
        </button>
      </form>
    </div>
  );
}

