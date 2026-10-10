import React, { useState } from 'react';
import { 
  RefreshCw, Sparkles, AlertCircle, CheckCircle2, 
  HelpCircle, X, Terminal, ChevronDown, ChevronUp,
  Award, ArrowRight, Info
} from 'lucide-react';
import { MoodleSession } from '../types';
import { useLanguage } from '../context/LanguageContext';

export interface AccountSyncLog {
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error' | 'performance';
  message: string;
  durationMs?: number;
}

export interface AccountSyncState {
  status: 'idle' | 'syncing' | 'paused' | 'waiting' | 'interrupted' | 'completed' | 'failed';
  currentCourse: string;
  currentActivity: string;
  processedCount: number;
  totalCount: number;
  logs?: AccountSyncLog[];
}

interface SyncStatusBarProps {
  sessions: MoodleSession[];
  getAccountSyncState: (sess: MoodleSession) => AccountSyncState;
  syncQueue: { username: string; server: string }[];
  lastSyncedTime: Date | null;
  getRelativeLastSyncedTime: () => string;
  onStartSync: (sessionsToSync: MoodleSession[]) => void;
  onCancelSync: (session: MoodleSession) => void;
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  percentComplete: number;
  onNavigateToTab?: (tab: 'login' | 'agenda') => void;
}

export default function SyncStatusBar({
  sessions,
  getAccountSyncState,
  syncQueue,
  lastSyncedTime,
  getRelativeLastSyncedTime,
  onStartSync,
  onCancelSync,
  totalTasks,
  completedTasks,
  pendingTasks,
  percentComplete,
  onNavigateToTab
}: SyncStatusBarProps) {
  const { t, language } = useLanguage();
  const [showLogsAccountKey, setShowLogsAccountKey] = useState<string | null>(null);
  const [showLegendPopover, setShowLegendPopover] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const activeSessions = sessions.filter(s => !s.expired);
  const isAnySyncing = activeSessions.some(s => {
    const st = getAccountSyncState(s);
    return st.status === 'syncing' || st.status === 'waiting';
  });

  return (
    <div id="sync-status-bar" className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-2xs space-y-3">
      {/* Primary unified summary row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5">
        
        {/* Left: Title, pending tasks, connected accounts and last synced */}
        <div className="space-y-1">
          <div className="flex items-center space-x-2.5">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              {language === 'es' ? 'Agenda de Actividades' : 'Activity Agenda'}
            </h2>
            <span className="text-xs font-bold bg-blue-50 text-blue-600 px-2.5 py-0.5 rounded-full border border-blue-100">
              {t('timeline.statsPending', { count: pendingTasks })}
            </span>
          </div>

          <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
            {activeSessions.length > 0 && (
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="font-semibold text-slate-700 hover:text-blue-600 flex items-center space-x-1 cursor-pointer transition-colors"
                title={t('sync.viewAccountDetails')}
              >
                <span>{activeSessions.length} {activeSessions.length === 1 ? t('sync.account') : t('sync.accounts')}</span>
                {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
              </button>
            )}

            {activeSessions.length > 0 && <span className="text-slate-300">•</span>}

            {lastSyncedTime ? (
              <span className="text-slate-400">
                {t('sync.lastSynced', { time: getRelativeLastSyncedTime() })}
              </span>
            ) : (
              <span className="text-slate-400">
                {t('sync.notSyncedRecently')}
              </span>
            )}
          </div>
        </div>

        {/* Right: Progress bar, single Legend button, and ALWAYS VISIBLE Sync button */}
        <div className="flex items-center flex-wrap sm:flex-nowrap gap-2.5 self-start md:self-center">
          
          {/* Progress bar pill */}
          <div className="flex items-center space-x-2.5 bg-slate-50 border border-slate-200/80 px-3 py-1.5 rounded-xl">
            <Award className={`w-4 h-4 shrink-0 ${percentComplete === 100 ? 'text-emerald-500' : 'text-blue-500'}`} />
            <div className="text-xs">
              <span className="font-bold text-slate-800 font-mono">{percentComplete}%</span>
              <span className="text-[11px] text-slate-400 font-medium ml-1.5 hidden sm:inline">
                ({completedTasks}/{totalTasks} {language === 'es' ? 'hechas' : 'done'})
              </span>
            </div>
            <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-300 ${percentComplete === 100 ? 'bg-emerald-500' : 'bg-blue-600'}`}
                style={{ width: `${percentComplete}%` }}
              />
            </div>
          </div>

          {/* Unified Legend Popover button */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowLegendPopover(!showLegendPopover)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center space-x-1.5 cursor-pointer transition-colors ${
                showLegendPopover 
                  ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-2xs' 
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900 shadow-2xs'
              }`}
              title={t('sync.legendTitle')}
            >
              <Info className="w-3.5 h-3.5 text-slate-500" />
              <span>{language === 'es' ? 'Leyenda' : 'Legend'}</span>
            </button>

            {/* Popover */}
            {showLegendPopover && (
              <>
                <div 
                  className="fixed inset-0 z-40 bg-transparent" 
                  onClick={() => setShowLegendPopover(false)} 
                />
                <div 
                  id="icons-legend-popover"
                  className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-4 space-y-3 animate-in fade-in zoom-in-95 duration-150"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <span className="text-xs font-bold text-slate-900 flex items-center space-x-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                      <span>{t('sync.legendHeading')}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowLegendPopover(false)}
                      className="text-slate-400 hover:text-slate-600 p-0.5 rounded-lg cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                    <div className="flex items-center space-x-1.5 bg-slate-50/70 p-1.5 rounded-lg border border-slate-100">
                      <span className="text-sm shrink-0">🔥</span>
                      <span className="text-slate-700 font-medium">{t('sync.legend.imminent')}</span>
                    </div>
                    <div className="flex items-center space-x-1.5 bg-slate-50/70 p-1.5 rounded-lg border border-slate-100">
                      <span className="text-sm shrink-0">😄</span>
                      <span className="text-emerald-700 font-medium">{t('sync.legend.excellent')}</span>
                    </div>
                    <div className="flex items-center space-x-1.5 bg-slate-50/70 p-1.5 rounded-lg border border-slate-100">
                      <span className="text-sm shrink-0">💪</span>
                      <span className="text-slate-700 font-medium">{t('sync.legend.pending')}</span>
                    </div>
                    <div className="flex items-center space-x-1.5 bg-slate-50/70 p-1.5 rounded-lg border border-slate-100">
                      <span className="text-sm shrink-0">🙂</span>
                      <span className="text-blue-700 font-medium">{t('sync.legend.acceptable')}</span>
                    </div>
                    <div className="flex items-center space-x-1.5 bg-slate-50/70 p-1.5 rounded-lg border border-slate-100">
                      <span className="text-sm shrink-0">⏱️</span>
                      <span className="text-slate-700 font-medium">{language === 'es' ? 'Entregado (Sin nota)' : 'Submitted (Ungraded)'}</span>
                    </div>
                    <div className="flex items-center space-x-1.5 bg-slate-50/70 p-1.5 rounded-lg border border-slate-100">
                      <span className="text-sm shrink-0">😢</span>
                      <span className="text-amber-700 font-medium">{t('sync.legend.regular')}</span>
                    </div>
                    <div className="flex items-center space-x-1.5 bg-slate-50/70 p-1.5 rounded-lg border border-slate-100">
                      <span className="text-sm shrink-0">☠️</span>
                      <span className="text-rose-600 font-medium">{t('sync.legend.overdue')}</span>
                    </div>
                    <div className="flex items-center space-x-1.5 bg-slate-50/70 p-1.5 rounded-lg border border-slate-100">
                      <span className="text-sm shrink-0">👎</span>
                      <span className="text-rose-700 font-medium">{t('sync.legend.failed')}</span>
                    </div>
                    <div className="col-span-2 flex items-center space-x-1.5 bg-slate-50/70 p-1.5 rounded-lg border border-slate-100">
                      <span className="text-sm shrink-0">⚠️</span>
                      <span className="text-amber-800 font-medium">{language === 'es' ? 'Cierre atípico (Fin de semana / Fuera de hora habitual)' : 'Atypical deadline (Weekend / Off-hours)'}</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ALWAYS VISIBLE PROMINENT SYNC BUTTON */}
          <button
            type="button"
            id="sync-all-btn"
            disabled={activeSessions.length === 0 || isAnySyncing}
            onClick={() => onStartSync(activeSessions)}
            className={`inline-flex items-center space-x-2 px-4 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer select-none active:scale-95 whitespace-nowrap ${
              isAnySyncing
                ? 'bg-blue-50 text-blue-700 border border-blue-200 animate-pulse'
                : activeSessions.length === 0
                ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
            title={activeSessions.length === 0 ? t('sync.connectFirst') : t('sync.syncAllActive')}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isAnySyncing ? 'animate-spin' : ''}`} />
            <span>{isAnySyncing ? t('sync.syncingBtn') : (language === 'es' ? 'Sincronizar' : 'Sync')}</span>
          </button>

        </div>

      </div>

      {/* Active Sync Progress Banner (when any account is syncing) */}
      {isAnySyncing && (
        <div className="space-y-2 pt-2 border-t border-slate-100">
          {activeSessions.map((sess) => {
            const sState = getAccountSyncState(sess);
            if (sState.status !== 'syncing' && sState.status !== 'waiting') return null;
            const progressPercent = sState.totalCount > 0 
              ? Math.round((sState.processedCount / sState.totalCount) * 100) 
              : 15;

            return (
              <div key={`${sess.server}_${sess.username}`} className="bg-blue-50/60 border border-blue-100 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-1.5">
                    <RefreshCw className="w-3.5 h-3.5 text-blue-600 animate-spin" />
                    <span className="font-bold text-blue-900">{sess.username}</span>
                    <span className="text-[10px] text-blue-600 font-semibold uppercase font-mono">
                      ({sess.server === 'upsdt' ? 'UPSDT' : sess.server === 'a' ? 'UNEMI P/S' : 'UNEMI Online'})
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[11px] font-mono text-blue-700 font-bold">
                      {t('sync.progressOf', { current: sState.processedCount, total: sState.totalCount || '?' })}
                    </span>
                    <button
                      type="button"
                      onClick={() => onCancelSync(sess)}
                      className="text-[10px] font-bold text-rose-600 hover:text-rose-800 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md cursor-pointer"
                    >
                      {t('sync.cancel')}
                    </button>
                  </div>
                </div>

                <div className="w-full bg-blue-200/60 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-blue-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span className="truncate max-w-[280px] sm:max-w-md">
                    {sState.currentCourse || t('sync.connecting')}
                  </span>
                  <span className="italic text-[10px] text-slate-400 truncate">
                    {sState.currentActivity || t('sync.analyzing')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Expandable Per-Account Details */}
      {isExpanded && activeSessions.length > 0 && (
        <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {activeSessions.map((sess) => {
            const sState = getAccountSyncState(sess);
            const sKey = `${sess.server}_${sess.username.trim().toLowerCase()}`;
            const isQueued = syncQueue.some(q => q.username.toLowerCase() === sess.username.toLowerCase() && q.server === sess.server);

            return (
              <div key={sKey} className="p-3 bg-slate-50/70 border border-slate-200/70 rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 truncate">
                    {sess.username}
                  </span>
                  <div className="flex items-center space-x-1.5">
                    {sState.status === 'completed' && (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                        {t('sync.upToDate')}
                      </span>
                    )}
                    {sState.status === 'failed' && (
                      <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                        {t('sync.error')}
                      </span>
                    )}
                    {sState.status === 'idle' && !isQueued && (
                      <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                        {t('sync.ready')}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={sState.status === 'syncing' || sState.status === 'waiting'}
                    onClick={() => onStartSync([sess])}
                    className="flex-1 py-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold rounded-lg transition-colors flex items-center justify-center space-x-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>{t('sync.syncBtn')}</span>
                  </button>

                  {sState.logs && sState.logs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowLogsAccountKey(showLogsAccountKey === sKey ? null : sKey)}
                      className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
                      title={t('sync.viewLog')}
                    >
                      <Terminal className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Logs drop */}
                {showLogsAccountKey === sKey && sState.logs && sState.logs.length > 0 && (
                  <div className="p-2 bg-slate-900 text-slate-200 rounded-lg font-mono text-[9px] max-h-28 overflow-y-auto space-y-1">
                    {sState.logs.slice(-10).map((log, idx) => (
                      <div key={idx} className="flex items-start space-x-1">
                        <span className="text-slate-500">{log.timestamp}</span>
                        <span className="text-slate-300 break-words">{log.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Prompt to connect if 0 accounts */}
      {activeSessions.length === 0 && (
        <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl flex items-center justify-between gap-2">
          <div className="flex items-center space-x-2 text-amber-800 text-xs font-semibold">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{t('sync.emptyBanner')}</span>
          </div>
          {onNavigateToTab && (
            <button
              type="button"
              onClick={() => onNavigateToTab('login')}
              className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shrink-0 transition-colors cursor-pointer"
            >
              {t('sync.connect')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

