import React from 'react';

interface OpenAgenticLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const OpenAgenticLogo: React.FC<OpenAgenticLogoProps> = ({ size = 'md', className = '' }) => {
  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8', 
    lg: 'w-12 h-12'
  };

  return (
    <div className={`${sizeClasses[size]} ${className} flex items-center justify-center rounded-lg text-white font-bold`} style={{ background: 'var(--color-primary)' }}>
      <span className="text-xs">A</span>
    </div>
  );
};

export default OpenAgenticLogo;