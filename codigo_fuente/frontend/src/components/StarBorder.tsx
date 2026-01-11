import React from 'react';

type StarBorderProps<T extends React.ElementType> = React.ComponentPropsWithoutRef<T> & {
  as?: T;
  className?: string;
  children?: React.ReactNode;
  color?: string;
  speed?: React.CSSProperties['animationDuration'];
  thickness?: number;
};

const StarBorder = <T extends React.ElementType = 'div'>({
  as,
  className = '',
  color = '#0070B7', 
  speed = '6s',
  thickness = 2,
  children,
  ...rest
}: StarBorderProps<T>) => {
  const Component = as || 'div';

  return (
    <Component
      className={`relative rounded-[20px] overflow-hidden ${className}`}
      {...(rest as any)}
      style={{
        padding: `${thickness}px`,
        background: `linear-gradient(90deg, ${color}15, transparent, ${color}15)`,
        ...(rest as any).style,
      }}
    >
      <div className="absolute inset-0 rounded-[20px]">
        <div
          className="absolute top-0 left-0 w-full h-[2px] animate-star-movement-top"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${color} 50%, transparent 100%)`,
            animationDuration: speed,
            transformOrigin: 'left center',
          }}
        />

        <div
          className="absolute bottom-0 left-0 w-full h-[2px] animate-star-movement-top"
          style={{
            background: `linear-gradient(270deg, transparent 0%, ${color} 50%, transparent 100%)`,
            animationDuration: speed,
            animationDelay: '0.3s',
            transformOrigin: 'right center',
          }}
        />
      </div>

      <div className="relative z-10 rounded-[18px] bg-white/85 backdrop-blur-xl overflow-hidden">
        {children}
      </div>
    </Component>
  );
};

export default StarBorder;