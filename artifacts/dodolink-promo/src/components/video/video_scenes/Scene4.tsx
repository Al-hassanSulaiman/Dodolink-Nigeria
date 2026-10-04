import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';
import { Brand, EASE, Phone, Reveal, SceneShell } from '../film';

const steps = ['Create your store', 'List your products', 'Chat with customers'];

export function Scene4() {
  const [step, setStep] = useState(-1);
  const [handoff, setHandoff] = useState(false);
  useSceneTimer([
    { time: 1300, callback: () => setStep(0) },
    { time: 2800, callback: () => setStep(1) },
    { time: 4300, callback: () => setStep(2) },
    { time: 5050, callback: () => setHandoff(true) },
  ]);
  return (
    <SceneShell className="scene-sell" label="Grow your business">
      <Brand />
      <div className="sell-copy">
        <p className="eyebrow">GOT A BUSINESS?</p>
        <Reveal delay={0.18}><h2>Give it</h2></Reveal>
        <Reveal delay={0.55}><h2>a home.</h2></Reveal>
        <motion.p className="sell-subline" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 0.85 }}>On DodoLink.</motion.p>
      </div>
      <div className="store-lines"><span /><span /><span /></div>
      <motion.div className="phone-stage sell-phone"
        initial={{ rotate: -6, scale: 0.95, clipPath: 'inset(22% 0 22% 0)' }}
        animate={{ rotate: handoff ? -2 : 6, scale: handoff ? 0.9 : 1.03, clipPath: 'inset(0% 0 0% 0)' }}
        transition={{ duration: handoff ? 0.9 : 0.8, ease: EASE }}>
        <Phone image="seller.jpg" pan />
      </motion.div>
      <div className="step-stage">
        <AnimatePresence mode="sync">
          {step >= 0 && (
            <motion.div key={step} className="seller-step"
              initial={{ y: 25, opacity: 0, scale: 0.96 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -20, opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE }}>
              <span className="step-number">0{step + 1}</span>
              <span>{steps[step]}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <motion.div className="seller-aperture" animate={{ scale: handoff ? 1 : 0 }}
        transition={{ duration: 0.9, ease: EASE }} />
    </SceneShell>
  );
}