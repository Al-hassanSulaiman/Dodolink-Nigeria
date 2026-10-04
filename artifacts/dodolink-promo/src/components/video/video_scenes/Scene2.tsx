import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';
import { Brand, EASE, Phone, Reveal, SceneShell } from '../film';

export function Scene2() {
  const [handoff, setHandoff] = useState(false);
  useSceneTimer([{ time: 4100, callback: () => setHandoff(true) }]);
  return (
    <SceneShell className="scene-discover" label="Discover stores">
      <Brand />
      <div className="discover-copy">
        <motion.p className="eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}>DISCOVER</motion.p>
        <Reveal delay={0.2}><h2>Your next</h2></Reveal>
        <Reveal delay={0.48}><h2>great find.</h2></Reveal>
      </div>
      <motion.div className="discover-orbit"
        initial={{ scale: 0.7, rotate: -15 }}
        animate={{ scale: handoff ? 1.35 : 1, rotate: 10 }}
        transition={{ duration: 4.8, ease: EASE }} />
      <motion.div
        className="phone-stage discover-phone"
        initial={{ scale: 1.22, rotate: -10, y: '9cqw' }}
        animate={{ scale: handoff ? 1.03 : 1, rotate: handoff ? 0 : -5, y: 0 }}
        transition={{ duration: handoff ? 0.85 : 0.8, ease: EASE }}
      ><Phone image="marketplace.jpg" pan /></motion.div>
      <motion.div className="category-tape"
        initial={{ x: '8%', opacity: 0 }} animate={{ x: '-3%', opacity: 1 }}
        transition={{ delay: 1.4, duration: 3.4, ease: EASE }}>
        Fashion <span>·</span> Phones <span>·</span> Everyday finds
      </motion.div>
      <motion.p className="discover-note" initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.3, duration: 0.5 }}>
        Browse local stores
      </motion.p>
    </SceneShell>
  );
}