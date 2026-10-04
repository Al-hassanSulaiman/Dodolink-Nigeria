/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export const EASE = [0.22, 1, 0.36, 1] as const;
export const asset = (name: string) => `${import.meta.env.BASE_URL}images/${name}`;

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? 'brand-light' : ''}`}>
      <img src={asset('dodolink-icon.png')} alt="DodoLink NG" />
      <span>DodoLink NG</span>
    </div>
  );
}

export function SceneShell({ children, className, label }: {
  children: ReactNode; className: string; label: string;
}) {
  return (
    <motion.section
      aria-label={label}
      data-shot={label}
      className={`film-scene ${className}`}
      initial={{ opacity: 0.3, scale: 1.05 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.1, rotate: 1.5 }}
      transition={{ duration: 0.48, ease: EASE }}
    >
      {children}
    </motion.section>
  );
}

export function Reveal({ children, delay = 0, className = '' }: {
  children: ReactNode; delay?: number; className?: string;
}) {
  return (
    <div className={`line-mask ${className}`}>
      <motion.div
        initial={{ y: '104%', rotate: 3 }}
        animate={{ y: 0, rotate: 0 }}
        transition={{ delay, duration: 0.58, ease: EASE }}
      >{children}</motion.div>
    </div>
  );
}

export function Phone({ image, className = '', pan = false }: {
  image: string; className?: string; pan?: boolean;
}) {
  return (
    <div className={`phone-shell ${className}`}>
      <div className="phone-screen">
        <motion.img
          src={asset(image)}
          alt="Actual DodoLink app screen"
          initial={{ y: 0, scale: 1.04 }}
          animate={{ y: pan ? '-3%' : 0, scale: 1.04 }}
          transition={{ delay: 1, duration: 3, ease: 'easeInOut' }}
        />
      </div>
      <span className="phone-speaker" />
      <span className="phone-home" />
      <span className="phone-side" />
    </div>
  );
}