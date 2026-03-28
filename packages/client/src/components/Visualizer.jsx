import { motion } from 'framer-motion';

const MIN_SCALE = 1;
const MAX_VOLUME = 1;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default function Visualizer({ state = 'IDLE', volume = 0 }) {
  const normalizedVolume = clamp(volume, 0, MAX_VOLUME);
  const pulseStrength = normalizedVolume * 0.3;

  let animation = {
    scale: [MIN_SCALE, 1.05, MIN_SCALE],
    rotate: [0, 0, 0],
    filter: [
      'saturate(1) brightness(1)',
      'saturate(1.08) brightness(1.08)',
      'saturate(1) brightness(1)',
    ],
    transition: {
      duration: 4.2,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  };

  if (state === 'LISTENING') {
    animation = {
      scale: [1.01, 1.04, 0.995, 1.02],
      rotate: [0, -0.65, 0.55, 0],
      filter: [
        'saturate(1.1) brightness(1.05)',
        'saturate(1.25) brightness(1.15)',
        'saturate(1.1) brightness(1.05)',
      ],
      transition: {
        duration: 1.15,
        repeat: Infinity,
        ease: 'easeInOut',
      },
    };
  }

  if (state === 'SPEAKING') {
    animation = {
      scale: [1.035, 1.1 + pulseStrength, 1.015],
      rotate: [0, 0.45, -0.35, 0],
      filter: [
        'saturate(1.24) brightness(1.1)',
        `saturate(${1.42 + normalizedVolume * 0.3}) brightness(${1.26 + normalizedVolume * 0.3})`,
        'saturate(1.24) brightness(1.1)',
      ],
      transition: {
        duration: 0.38,
        repeat: Infinity,
        ease: 'easeInOut',
      },
    };
  }

  if (state === 'PROCESSING') {
    animation = {
      scale: [1.01, 1.04, 1.01],
      rotate: [0, 3, 6, 3, 0],
      filter: [
        'saturate(1.12) brightness(1.06)',
        'saturate(1.3) brightness(1.15)',
        'saturate(1.12) brightness(1.06)',
      ],
      transition: {
        duration: 0.9,
        repeat: Infinity,
        ease: 'linear',
      },
    };
  }

  const auraScale =
    state === 'SPEAKING'
      ? 1.22 + normalizedVolume * 0.34
      : state === 'PROCESSING'
        ? 1.18
        : 1.12;

  return (
    <div className="visualizer-stage" role="img" aria-label={`Avatar de Aira en estado ${state}`}>
      <motion.div
        className={`aira-orb aira-orb--${state.toLowerCase()}`}
        animate={animation}
        initial={false}
      >
        <motion.div
          className="aira-orb__aura"
          animate={{ scale: [1, auraScale, 1], opacity: [0.48, 0.74, 0.48] }}
          transition={{
            duration: state === 'SPEAKING' ? 0.5 : state === 'PROCESSING' ? 1 : 2.8,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <div className="aira-orb__core" />
        <div className="aira-orb__grain" />
      </motion.div>
    </div>
  );
}
