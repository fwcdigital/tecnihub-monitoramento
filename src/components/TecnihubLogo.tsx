import React from 'react';

interface TecnihubLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
  inverted?: boolean;
}

export const TecnihubLogo: React.FC<TecnihubLogoProps> = ({
  className = '',
  size = 'md',
  showSubtitle = true,
  inverted = false
}) => {
  const iconSizes = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-10 h-10'
  };

  const textSizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg'
  };

  const primaryFill = inverted ? '#090A0C' : '#FFFFFF';

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {/* TECNIHUB Vector Icon matching official brand emblem */}
      <div className={`relative flex items-center justify-center ${iconSizes[size]} shrink-0`}>
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Left T / L block structure */}
          {/* Vertical Stem */}
          <rect x="20" y="30" width="8" height="35" fill={primaryFill} />
          {/* Top Bar of Left Structure */}
          <rect x="20" y="40" width="30" height="6.5" fill={primaryFill} />
          {/* Bottom Bar of Left Structure */}
          <rect x="20" y="58.5" width="30" height="6.5" fill={primaryFill} />
          
          {/* Right 3 Parallel Bars (E / Data stream) */}
          <rect x="50.5" y="40" width="29.5" height="6.5" fill={primaryFill} />
          <rect x="50.5" y="49.25" width="29.5" height="6.5" fill={primaryFill} />
          <rect x="50.5" y="58.5" width="29.5" height="6.5" fill={primaryFill} />
        </svg>
      </div>

      {/* Brand & Tool Name Typography */}
      <div className="flex flex-col">
        <div className="flex items-center gap-1.5 leading-none">
          <span className={`font-brand tracking-wider uppercase ${textSizes[size]} ${inverted ? 'text-neutral-900' : 'text-white'}`}>
            TECNIHUB
          </span>
        </div>
        {showSubtitle && (
          <span className={`text-[11px] font-medium tracking-widest uppercase mt-0.5 ${inverted ? 'text-neutral-500' : 'text-neutral-400'}`}>
            Monitoramento
          </span>
        )}
      </div>
    </div>
  );
};
