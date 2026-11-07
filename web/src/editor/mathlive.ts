type MathLive = typeof import('mathlive');
let mathlive: Promise<MathLive> | null = null;

/** MathLive (≈1 MB) loads the first time it is needed (the LyX style, Conceal TeX). Its fonts are bundled. */
export function loadMathLive(): Promise<MathLive> {
  mathlive ??= (async () => {
    await import('mathlive/fonts.css');
    const ML = await import('mathlive');
    ML.MathfieldElement.fontsDirectory = null;
    ML.MathfieldElement.soundsDirectory = null;
    ML.MathfieldElement.plonkSound = null;
    return ML;
  })();
  mathlive.catch(() => (mathlive = null));
  return mathlive;
}
