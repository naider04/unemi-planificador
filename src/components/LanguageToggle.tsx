import React from 'react';
import { Languages } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

interface LanguageToggleProps {
  className?: string;
}

export const LanguageToggle: React.FC<LanguageToggleProps> = ({ className = '' }) => {
  const { language, setLanguage, toggleLanguage, t } = useLanguage();

  return (
    <div 
      className={`inline-flex items-center bg-gray-100/90 hover:bg-gray-100 p-0.5 rounded-xl border border-gray-200/80 shadow-3xs transition-all ${className}`}
      id="language-toggle-wrapper"
    >
      <button
        type="button"
        id="language-toggle-btn"
        onClick={toggleLanguage}
        className="flex items-center space-x-1.5 px-2 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer select-none focus:outline-hidden"
        title={language === 'es' ? 'Switch to English' : 'Cambiar a Español'}
        aria-label={t('nav.switchLanguage')}
      >
        <Languages className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        <div className="flex items-center space-x-1 text-[11px] font-mono font-extrabold">
          <span
            onClick={(e) => {
              e.stopPropagation();
              setLanguage('es');
            }}
            className={`px-1.5 py-0.5 rounded-md transition-all ${
              language === 'es'
                ? 'bg-white text-blue-700 shadow-xs font-black'
                : 'text-gray-400 hover:text-gray-700 font-semibold'
            }`}
          >
            ES
          </span>
          <span className="text-gray-300">/</span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              setLanguage('en');
            }}
            className={`px-1.5 py-0.5 rounded-md transition-all ${
              language === 'en'
                ? 'bg-white text-blue-700 shadow-xs font-black'
                : 'text-gray-400 hover:text-gray-700 font-semibold'
            }`}
          >
            EN
          </span>
        </div>
      </button>
    </div>
  );
};

export default LanguageToggle;
