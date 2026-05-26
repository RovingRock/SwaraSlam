// ─── Constants ────────────────────────────────────────────────────────────────
export const SA_PITCHES = [
  { label:"C",  freq:130.81 }, { label:"C#", freq:138.59 },
  { label:"D",  freq:146.83 }, { label:"D#", freq:155.56 },
  { label:"E",  freq:164.81 }, { label:"F",  freq:174.61 },
  { label:"F#", freq:185.00 }, { label:"G",  freq:196.00 },
  { label:"G#", freq:207.65 }, { label:"A",  freq:220.00 },
  { label:"A#", freq:233.08 }, { label:"B",  freq:246.94 },
];

export const ALL_SWARAS_BASE = [
  { name:"Sa",   short:"S",  dv:"स",   ratio:1.0000, semitone:0  },
  { name:"Re♭",  short:"r",  dv:"रे♭", ratio:1.0667, semitone:1  },
  { name:"Re",   short:"R",  dv:"रे",  ratio:1.1250, semitone:2  },
  { name:"Ga♭",  short:"g",  dv:"ग♭",  ratio:1.2000, semitone:3  },
  { name:"Ga",   short:"G",  dv:"ग",   ratio:1.2500, semitone:4  },
  { name:"Ma",   short:"m",  dv:"म",   ratio:1.3333, semitone:5  },
  { name:"Ma#",  short:"M",  dv:"म#",  ratio:1.4063, semitone:6  },
  { name:"Pa",   short:"P",  dv:"प",   ratio:1.5000, semitone:7  },
  { name:"Dha♭", short:"d",  dv:"ध♭",  ratio:1.6000, semitone:8  },
  { name:"Dha",  short:"D",  dv:"ध",   ratio:1.6667, semitone:9  },
  { name:"Ni♭",  short:"n",  dv:"नि♭", ratio:1.7778, semitone:10 },
  { name:"Ni",   short:"N",  dv:"नि",  ratio:1.8750, semitone:11 },
  { name:"Sa'",  short:"S'", dv:"सं",  ratio:2.0000, semitone:12 },
];

const buildThreeOctavePool = (idxArr) =>
  [0,1,2].flatMap(oct =>
    idxArr.map(i => {
      const b = ALL_SWARAS_BASE[i];
      const rm = oct === 0 ? 0.5 : oct === 2 ? 2.0 : 1.0;
      return { ...b, octave: oct, ratio: b.ratio * rm, absSemitone: b.semitone + (oct - 1) * 13 };
    })
  );

const SHUDDHA_IDX = [0,2,4,5,7,9,11,12];
const ALL_IDX     = [0,1,2,3,4,5,6,7,8,9,10,11,12];

export const LEVEL_CONFIG = [
  { label:"Shuddha",        pool: SHUDDHA_IDX.map(i => ({ ...ALL_SWARAS_BASE[i], octave:1, absSemitone: ALL_SWARAS_BASE[i].semitone })), maxJump:3  },
  { label:"Komal & Tivra",  pool: ALL_IDX.map(i => ({ ...ALL_SWARAS_BASE[i], octave:1, absSemitone: ALL_SWARAS_BASE[i].semitone })),     maxJump:6  },
  { label:"Advanced Jumps", pool: ALL_IDX.map(i => ({ ...ALL_SWARAS_BASE[i], octave:1, absSemitone: ALL_SWARAS_BASE[i].semitone })),     maxJump:13 },
  { label:"Three Octaves",  pool: buildThreeOctavePool(ALL_IDX),                                                                          maxJump:13 },
];

export const SETS_PER_LEVEL = 5;
export const BASE_BPM       = 80;
export const BPM_INCREMENT  = 20;
export const LEAD_IN_BEATS  = 4;
export const ACTIVE_BEATS   = 8;
export const NOTE_DUR       = 0.36;
export const CLICK_FREQ     = 1200;
export const CLICK_DUR      = 0.018;

export const TOTAL_PER_LEVEL  = ACTIVE_BEATS * SETS_PER_LEVEL;
export const TOTAL_ALL_LEVELS = TOTAL_PER_LEVEL * LEVEL_CONFIG.length;
