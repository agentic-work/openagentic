import React from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';

/**
 * GlassCard (JSX) — TERMINAL GLASS (elevated) re-skin.
 *
 * Mirror of GlassCard.tsx: a real frosted glass surface via the token-driven
 * .glass-surface classes in theme.css. `hover` adds the glow-lift. Prop API
 * unchanged.
 */
const GlassCard = ({
  children,
  className = '',
  hover = false,
  padding = 'p-6',
  onClick,
  as = 'div',
  ...props
}) => {
  const Component = as;

  const cardClasses = classNames(
    'glass-surface',
    hover && ['glass-surface-hover', onClick && 'cursor-pointer'],
    padding,
    className
  );

  return (
    <Component
      className={cardClasses}
      onClick={onClick}
      {...props}
    >
      <div className="relative z-10">
        {children}
      </div>
    </Component>
  );
};

GlassCard.propTypes = {
  children: PropTypes.node,
  className: PropTypes.string,
  hover: PropTypes.bool,
  padding: PropTypes.string,
  onClick: PropTypes.func,
  as: PropTypes.any,
};

export default GlassCard;
